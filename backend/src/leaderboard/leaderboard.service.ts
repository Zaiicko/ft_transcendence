import { Injectable } from '@nestjs/common';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { VERIFIED_COMPLETION_PLATFORMS } from '../common/completion-platforms';
import { PrismaService } from '../prisma/prisma.service';

// Three leaderboards, each a per-user count: completions (GameCompletion,
// platform-verified 100% only), played (GameCompletion, any platform — i.e.
// every "Fait" game, verified or not), reviews (Review).
export type LeaderboardMetric = 'completions' | 'played' | 'reviews';
// Friends (me + accepted friends) or site-wide.
export type LeaderboardScope = 'friends' | 'global';
// All-time, or a rolling 30-day window on createdAt.
export type LeaderboardWindow = 'all' | 'month';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const actorSelect = { id: true, username: true, avatarUrl: true } as const;

// Closed whitelist: a table name can't be a bound parameter, so it goes through
// Prisma.raw — safe only because it never comes from user input.
const TABLE: Record<LeaderboardMetric, string> = {
  completions: 'GameCompletion',
  played: 'GameCompletion',
  reviews: 'Review',
};

// completions/played share the GameCompletion table, which allows several rows
// per game (one per platform — e.g. a manual mark later confirmed by a verified
// Steam sync). Counting rows would double-count that game, so those two count
// distinct games instead; reviews has one row per review and counts rows as-is.
const scoreExpr = (metric: LeaderboardMetric): Prisma.Sql =>
  metric === 'reviews' ? Prisma.sql`COUNT(*)` : Prisma.sql`COUNT(DISTINCT "gameId")`;

export interface LeaderboardRow {
  rank: number;
  user: { id: number; username: string; avatarUrl: string | null };
  score: number;
}

export interface LeaderboardResult {
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  rows: LeaderboardRow[];
  // Viewer's position even when outside the displayed top. null when score is 0.
  me: { rank: number; score: number } | null;
}

// Freshly recorded milestone, returned for real-time feed broadcast.
export interface RecordedMilestone {
  id: number;
  subject: { id: number; username: string; avatarUrl: string | null };
  metric: LeaderboardMetric;
  scope: 'global' | 'friends';
  viewerId: number | null; // null = global (all the subject's friends), else the observer
  rank: number;
  createdAt: Date;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  // Accepted friend IDs, both directions (same as the feed).
  private async friendIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  // Shared WHERE fragment for both queries (top N and viewer rank): one source
  // of truth for the metric/scope/window filters.
  private whereSql(
    metric: LeaderboardMetric,
    userIds: number[] | undefined,
    since: Date | undefined,
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (metric === 'completions') {
      parts.push(Prisma.sql`"platform" = ANY(${[...VERIFIED_COMPLETION_PLATFORMS]})`);
    }
    if (metric === 'reviews') parts.push(Prisma.sql`"userId" IS NOT NULL`);
    if (userIds) parts.push(Prisma.sql`"userId" = ANY(${userIds})`);
    if (since) parts.push(Prisma.sql`"createdAt" >= ${since}`);
    if (parts.length === 0) return Prisma.sql`TRUE`;
    return Prisma.join(parts, ' AND ');
  }

  async getLeaderboard(
    viewerId: number,
    metric: LeaderboardMetric,
    scope: LeaderboardScope,
    window: LeaderboardWindow,
    limit = DEFAULT_LIMIT,
  ): Promise<LeaderboardResult> {
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

    // "friends" includes me so I can see my own place; "global" has no filter.
    const userIds =
      scope === 'friends' ? [viewerId, ...(await this.friendIds(viewerId))] : undefined;
    const since = window === 'month' ? new Date(Date.now() - MONTH_MS) : undefined;

    const table = Prisma.raw(`"${TABLE[metric]}"`);
    const where = this.whereSql(metric, userIds, since);

    // Sorted and truncated by Postgres — every user is never loaded in memory.
    // Ties go to whoever reached the score first, hence MAX("createdAt") ASC.
    const raw = await this.prisma.$queryRaw<{ userId: number; score: number }[]>(Prisma.sql`
      SELECT "userId", ${scoreExpr(metric)}::int AS "score"
      FROM ${table}
      WHERE ${where}
      GROUP BY "userId"
      ORDER BY "score" DESC, MAX("createdAt") ASC
      LIMIT ${limit}
    `);

    const users = await this.prisma.user.findMany({
      where: { id: { in: raw.map((r) => r.userId) } },
      select: actorSelect,
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows: LeaderboardRow[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const u = byId.get(raw[i].userId);
      if (!u) continue; // user deleted meanwhile
      rows.push({ rank: i + 1, user: u, score: raw[i].score });
    }

    const me = await this.computeMyRank(viewerId, metric, table, where);
    return { metric, scope, window, rows, me };
  }

  // Global all-time top N with no viewer (no personal rank): powers the public
  // home page for signed-out visitors. Same sort and tie-break as above.
  async getPublicTop(metric: LeaderboardMetric, limit = 3): Promise<LeaderboardRow[]> {
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const table = Prisma.raw(`"${TABLE[metric]}"`);
    const where = this.whereSql(metric, undefined, undefined);

    const raw = await this.prisma.$queryRaw<{ userId: number; score: number }[]>(Prisma.sql`
      SELECT "userId", ${scoreExpr(metric)}::int AS "score"
      FROM ${table}
      WHERE ${where}
      GROUP BY "userId"
      ORDER BY "score" DESC, MAX("createdAt") ASC
      LIMIT ${limit}
    `);

    const users = await this.prisma.user.findMany({
      where: { id: { in: raw.map((r) => r.userId) } },
      select: actorSelect,
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows: LeaderboardRow[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const u = byId.get(raw[i].userId);
      if (!u) continue;
      rows.push({ rank: i + 1, user: u, score: raw[i].score });
    }
    return rows;
  }

  // Global all-time rank per metric, kept only for podiums (rank <= 3) — shown
  // as a badge next to the username.
  async getRankBadges(userId: number): Promise<{ metric: LeaderboardMetric; rank: number }[]> {
    const metrics: LeaderboardMetric[] = ['completions', 'played', 'reviews'];
    const badges: { metric: LeaderboardMetric; rank: number }[] = [];
    for (const metric of metrics) {
      const table = Prisma.raw(`"${TABLE[metric]}"`);
      const where = this.whereSql(metric, undefined, undefined);
      const me = await this.computeMyRank(userId, metric, table, where);
      if (me && me.rank <= 3) badges.push({ metric, rank: me.rank });
    }
    return badges;
  }

  // Detects "entered the top 3" milestones triggered by one action on `metric`.
  // Returns only the newly created ones, for the feed push. Cost is independent
  // of the friend count — the friends scope is resolved set-wise in SQL.
  async recordMilestones(
    subjectId: number,
    metric: LeaderboardMetric,
  ): Promise<RecordedMilestone[]> {
    const table = Prisma.raw(`"${TABLE[metric]}"`);
    const where = this.whereSql(metric, undefined, undefined);

    const score_ = scoreExpr(metric);

    // Subject's score and last occurrence. Ties: the earliest MAX(createdAt) wins.
    const mine = await this.prisma.$queryRaw<{ score: number; lastAt: Date | null }[]>(Prisma.sql`
      SELECT ${score_}::int AS "score", MAX("createdAt") AS "lastAt"
      FROM ${table} WHERE ${where} AND "userId" = ${subjectId}
    `);
    const score = mine[0]?.score ?? 0;
    const lastAt = mine[0]?.lastAt ?? null;
    if (score === 0 || !lastAt) return [];

    const candidates: { scope: 'global' | 'friends'; viewerId: number | null; rank: number }[] = [];

    // --- GLOBAL: exact rank, same tie-break as the leaderboard ---
    const aboveGlobal = await this.prisma.$queryRaw<{ above: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "above" FROM (
        SELECT "userId" FROM ${table} WHERE ${where} GROUP BY "userId"
        HAVING ${score_} > ${score} OR (${score_} = ${score} AND MAX("createdAt") < ${lastAt})
      ) t
    `);
    const globalRank = (aboveGlobal[0]?.above ?? 0) + 1;

    if (globalRank <= 3) {
      candidates.push({ scope: 'global', viewerId: null, rank: globalRank });
    }

    // --- FRIENDS: one set-based query returns every observer whose circle puts
    // the subject in the top 3, with no application-side loop. Runs even when
    // the subject is already global top 3, so both cards can fire.
    const hits = await this.prisma.$queryRaw<{ viewer: number; rank: number }[]>(Prisma.sql`
      WITH scores AS (
        SELECT "userId" AS uid, ${score_}::int AS sc, MAX("createdAt") AS last
        FROM ${table} WHERE ${where} GROUP BY "userId"
      ),
      viewers AS (
        SELECT DISTINCT
          CASE WHEN "requesterId" = ${subjectId} THEN "addresseeId" ELSE "requesterId" END AS v
        FROM "Friendship"
        WHERE "status" = 'ACCEPTED' AND ${subjectId} IN ("requesterId", "addresseeId")
      ),
      members AS (
        SELECT v AS v, v AS uid FROM viewers
        UNION
        SELECT viewers.v AS v,
               CASE WHEN f."requesterId" = viewers.v THEN f."addresseeId" ELSE f."requesterId" END AS uid
        FROM viewers
        JOIN "Friendship" f ON f."status" = 'ACCEPTED'
          AND (f."requesterId" = viewers.v OR f."addresseeId" = viewers.v)
      )
      SELECT m.v AS "viewer",
             (COUNT(*) FILTER (
                WHERE sc.sc > ${score} OR (sc.sc = ${score} AND sc.last < ${lastAt})
             ))::int + 1 AS "rank"
      FROM members m
      JOIN scores sc ON sc.uid = m.uid
      WHERE m.uid <> ${subjectId}
      GROUP BY m.v
      HAVING COUNT(*) FILTER (
        WHERE sc.sc > ${score} OR (sc.sc = ${score} AND sc.last < ${lastAt})
      ) <= 2
    `);
    for (const h of hits) candidates.push({ scope: 'friends', viewerId: h.viewer, rank: h.rank });

    if (candidates.length === 0) return [];

    // Anti-spam: keep only new best ranks per (scope, viewer), so climbing
    // 3 -> 2 -> 1 fires once per step and never oscillates.
    const existing = await this.prisma.leaderboardMilestone.findMany({
      where: { subjectId, metric },
      select: { scope: true, viewerId: true, rank: true },
    });
    const bestByKey = new Map<string, number>();
    for (const e of existing) {
      const k = `${e.scope}:${e.viewerId ?? 'null'}`;
      const cur = bestByKey.get(k);
      if (cur === undefined || e.rank < cur) bestByKey.set(k, e.rank);
    }
    const toCreate = candidates.filter((c) => {
      const best = bestByKey.get(`${c.scope}:${c.viewerId ?? 'null'}`);
      return best === undefined || c.rank < best;
    });
    if (toCreate.length === 0) return [];

    const created: RecordedMilestone[] = [];
    for (const c of toCreate) {
      const row = await this.prisma.leaderboardMilestone.create({
        data: { subjectId, metric, scope: c.scope, viewerId: c.viewerId, rank: c.rank },
        select: {
          id: true,
          rank: true,
          viewerId: true,
          createdAt: true,
          subject: { select: actorSelect },
        },
      });
      created.push({
        id: row.id,
        subject: row.subject,
        metric,
        scope: c.scope,
        viewerId: row.viewerId,
        rank: row.rank,
        createdAt: row.createdAt,
      });
    }
    return created;
  }

  // Viewer's exact rank, computed in Postgres: count who is ahead, with the
  // same tie-break as the top N. `where` already carries scope/window/metric.
  private async computeMyRank(
    viewerId: number,
    metric: LeaderboardMetric,
    table: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<{ rank: number; score: number } | null> {
    const score_ = scoreExpr(metric);
    const mine = await this.prisma.$queryRaw<{ score: number; lastAt: Date | null }[]>(Prisma.sql`
      SELECT ${score_}::int AS "score", MAX("createdAt") AS "lastAt"
      FROM ${table}
      WHERE ${where} AND "userId" = ${viewerId}
    `);
    const myScore = mine[0]?.score ?? 0;
    const myLastAt = mine[0]?.lastAt ?? null;
    if (myScore === 0 || !myLastAt) return null; // nothing in this metric, so unranked

    // Ahead = strictly higher score, or same score reached earlier.
    const above = await this.prisma.$queryRaw<{ above: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "above" FROM (
        SELECT "userId"
        FROM ${table}
        WHERE ${where}
        GROUP BY "userId"
        HAVING ${score_} > ${myScore}
            OR (${score_} = ${myScore} AND MAX("createdAt") < ${myLastAt})
      ) t
    `);
    return { rank: (above[0]?.above ?? 0) + 1, score: myScore };
  }
}
