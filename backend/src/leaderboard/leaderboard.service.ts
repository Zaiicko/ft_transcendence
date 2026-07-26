import { Injectable } from '@nestjs/common';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Trois classements possibles, chacun = un simple comptage par utilisateur :
//  - completions : nombre de jeux finis à 100 % (table GameCompletion)
//  - played      : nombre de jeux « faits » (PlayedGame, status PLAYED)
//  - reviews     : nombre d'avis écrits (Review)
export type LeaderboardMetric = 'completions' | 'played' | 'reviews';
// Portée : entre amis (moi + mes amis acceptés) ou tout le site.
export type LeaderboardScope = 'friends' | 'global';
// Fenêtre : cumul depuis toujours ou 30 derniers jours glissants (via createdAt).
export type LeaderboardWindow = 'all' | 'month';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const actorSelect = { id: true, username: true, avatarUrl: true } as const;

// Table SQL par métrique. Whitelist FERMÉE (jamais d'entrée utilisateur) : le
// nom de table ne peut pas être un paramètre lié, on l'injecte via Prisma.raw
// depuis cette map uniquement — donc sûr (pas d'injection possible).
const TABLE: Record<LeaderboardMetric, string> = {
  completions: 'GameCompletion',
  played: 'PlayedGame',
  reviews: 'Review',
};

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
  // Position du viewer même s'il n'apparaît pas dans le top affiché. null s'il
  // n'a encore rien dans cette métrique/fenêtre (score 0 ⇒ pas classé).
  me: { rank: number; score: number } | null;
}

// Jalon fraîchement enregistré, renvoyé pour diffusion temps réel dans le feed.
export interface RecordedMilestone {
  id: number;
  subject: { id: number; username: string; avatarUrl: string | null };
  metric: LeaderboardMetric;
  scope: 'global' | 'friends';
  viewerId: number | null; // null = global (tous les amis du sujet), sinon l'observateur
  rank: number;
  createdAt: Date;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  // IDs des amis acceptés (mêmes deux sens que le feed).
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

  // Fragment WHERE partagé par toutes les requêtes (top N + rang du viewer) :
  // une seule source de vérité pour les filtres métrique/portée/fenêtre.
  private whereSql(
    metric: LeaderboardMetric,
    userIds: number[] | undefined,
    since: Date | undefined,
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (metric === 'played') parts.push(Prisma.sql`"status"::text = 'PLAYED'`);
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

    // Portée « amis » : moi inclus (pour voir ma place). « global » : pas de
    // restriction d'utilisateur.
    const userIds =
      scope === 'friends' ? [viewerId, ...(await this.friendIds(viewerId))] : undefined;
    const since = window === 'month' ? new Date(Date.now() - MONTH_MS) : undefined;

    const table = Prisma.raw(`"${TABLE[metric]}"`);
    const where = this.whereSql(metric, userIds, since);

    // Top N trié ET tronqué par Postgres : on ne charge jamais tous les
    // utilisateurs en mémoire (point de scalabilité). Départage : à score égal,
    // le PREMIER arrivé à ce score passe devant. Sa dernière occurrence (MAX
    // createdAt) est le moment où il a atteint son total ; la plus ancienne
    // gagne, d'où MAX("createdAt") ASC.
    const raw = await this.prisma.$queryRaw<{ userId: number; score: number }[]>(Prisma.sql`
      SELECT "userId", COUNT(*)::int AS "score"
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
      if (!u) continue; // user supprimé entre-temps : on saute
      rows.push({ rank: i + 1, user: u, score: raw[i].score });
    }

    const me = await this.computeMyRank(viewerId, table, where);
    return { metric, scope, window, rows, me };
  }

  // Récompenses de classement d'un utilisateur : pour chaque métrique, son rang
  // GLOBAL all-time, ne gardant que les podiums (rang ≤ 3). Sert à afficher un
  // badge à côté du pseudo. Même départage que le classement (score DESC puis
  // premier arrivé au score). Portée globale (userIds indéfini) et fenêtre all
  // (since indéfini).
  async getRankBadges(userId: number): Promise<{ metric: LeaderboardMetric; rank: number }[]> {
    const metrics: LeaderboardMetric[] = ['completions', 'played', 'reviews'];
    const badges: { metric: LeaderboardMetric; rank: number }[] = [];
    for (const metric of metrics) {
      const table = Prisma.raw(`"${TABLE[metric]}"`);
      const where = this.whereSql(metric, undefined, undefined);
      const me = await this.computeMyRank(userId, table, where);
      if (me && me.rank <= 3) badges.push({ metric, rank: me.rank });
    }
    return badges;
  }

  // Détecte et enregistre les jalons « entrée dans le top 3 » déclenchés par une
  // action du sujet sur `metric` (chaque action = +1 au score). Renvoie les
  // jalons NOUVELLEMENT créés (pour push feed). Coût : ~quelques requêtes
  // indexées, indépendant du nombre d'amis (la portée amis est ensembliste).
  async recordMilestones(
    subjectId: number,
    metric: LeaderboardMetric,
  ): Promise<RecordedMilestone[]> {
    const table = Prisma.raw(`"${TABLE[metric]}"`);
    const where = this.whereSql(metric, undefined, undefined);

    // Score + dernière occurrence du sujet (global all-time). Départage : le
    // premier arrivé au score passe devant ⇒ MAX(createdAt) le plus ancien gagne.
    const mine = await this.prisma.$queryRaw<{ score: number; lastAt: Date | null }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "score", MAX("createdAt") AS "lastAt"
      FROM ${table} WHERE ${where} AND "userId" = ${subjectId}
    `);
    const score = mine[0]?.score ?? 0;
    const lastAt = mine[0]?.lastAt ?? null;
    if (score === 0 || !lastAt) return [];

    const candidates: { scope: 'global' | 'friends'; viewerId: number | null; rank: number }[] = [];

    // --- GLOBAL : rang exact (même départage que le classement) ---
    const aboveGlobal = await this.prisma.$queryRaw<{ above: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "above" FROM (
        SELECT "userId" FROM ${table} WHERE ${where} GROUP BY "userId"
        HAVING COUNT(*) > ${score} OR (COUNT(*) = ${score} AND MAX("createdAt") < ${lastAt})
      ) t
    `);
    const globalRank = (aboveGlobal[0]?.above ?? 0) + 1;

    if (globalRank <= 3) {
      candidates.push({ scope: 'global', viewerId: null, rank: globalRank });
    }

    // --- AMIS : UNE requête ensembliste renvoie les observateurs V (amis du
    // sujet) dont le cercle place le sujet dans le top 3, sans boucle applicative.
    // Tournée MÊME si le sujet est top 3 global (choix « toujours les deux » :
    // un ami top 3 global déclenche aussi la carte « top 3 de tes amis »).
    const hits = await this.prisma.$queryRaw<{ viewer: number; rank: number }[]>(Prisma.sql`
      WITH scores AS (
        SELECT "userId" AS uid, COUNT(*)::int AS sc, MAX("createdAt") AS last
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

    // --- Anti-spam : ne garder que les NOUVEAUX meilleurs rangs par
    // (scope, viewer). Un utilisateur ne reçoit donc qu'un event quand il
    // progresse (3 → 2 → 1), jamais de doublon ni d'oscillation.
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

  // Rang exact du viewer, calculé côté Postgres (aucun chargement de la liste
  // complète) : on compte les utilisateurs qui le devancent, avec le MÊME
  // départage que le top N. `where` est le fragment déjà construit (portée +
  // fenêtre + métrique).
  private async computeMyRank(
    viewerId: number,
    table: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<{ rank: number; score: number } | null> {
    const mine = await this.prisma.$queryRaw<{ score: number; lastAt: Date | null }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "score", MAX("createdAt") AS "lastAt"
      FROM ${table}
      WHERE ${where} AND "userId" = ${viewerId}
    `);
    const myScore = mine[0]?.score ?? 0;
    const myLastAt = mine[0]?.lastAt ?? null;
    if (myScore === 0 || !myLastAt) return null; // rien dans cette métrique ⇒ pas classé

    // Devancé par : score strictement supérieur, OU même score mais atteint plus
    // tôt (MAX createdAt antérieur). COUNT groupé ⇒ un seul entier renvoyé.
    const above = await this.prisma.$queryRaw<{ above: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "above" FROM (
        SELECT "userId"
        FROM ${table}
        WHERE ${where}
        GROUP BY "userId"
        HAVING COUNT(*) > ${myScore}
            OR (COUNT(*) = ${myScore} AND MAX("createdAt") < ${myLastAt})
      ) t
    `);
    return { rank: (above[0]?.above ?? 0) + 1, score: myScore };
  }
}
