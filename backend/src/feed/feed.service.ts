import { Injectable, Logger } from '@nestjs/common';
import { FriendshipStatus, PlayStatus, Prisma } from '@prisma/client';
import {
  LeaderboardMetric,
  LeaderboardService,
  RecordedMilestone,
} from '../leaderboard/leaderboard.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AchievementFamily,
  buildAchievementFeedItem,
} from '../achievements/achievements.catalog';
import { FeedGateway } from './feed.gateway';

const actorSelect = { id: true, username: true, avatarUrl: true } as const;
const gameSelect = { id: true, title: true, coverUrl: true } as const;
const companySelect = { id: true, name: true, logoUrl: true } as const;

// Denormalised review preview (same fields as ReviewHighlight on the front)
const reviewSelect = {
  id: true,
  rating: true,
  title: true,
  text: true,
  createdAt: true,
  user: { select: actorSelect },
  game: { select: gameSelect },
  company: { select: companySelect },
  _count: { select: { likes: true, dislikes: true, comments: true } },
} as const;

// 100% completion: actor + game + platform for the feed card
const completionSelect = {
  id: true,
  createdAt: true,
  platform: true,
  user: { select: actorSelect },
  game: { select: gameSelect },
} as const;

// Minimal target (game/studio) needed to build the "like" links
const reviewTargetSelect = {
  id: true,
  title: true,
  user: { select: actorSelect },
  game: { select: gameSelect },
  company: { select: companySelect },
} as const;

export type FeedActor = { id: number; username: string; avatarUrl: string | null };

// Optional feed filter (tabs at the top of the page). Absent = everything.
export type FeedFilter = 'reviews' | 'played' | 'completed' | 'likes' | 'achievements';

// One feed event. `at` drives both the chronological sort and the "load more"
// cursor. `id` is prefixed per type so the front can dedupe real-time pushes.
export type FeedItem =
  | { id: string; kind: 'review'; at: string; review: unknown }
  | { id: string; kind: 'played'; at: string; actor: FeedActor; game: unknown }
  | { id: string; kind: 'completed'; at: string; actor: FeedActor; game: unknown; platform: string }
  | { id: string; kind: 'review-like'; at: string; actor: FeedActor; review: unknown }
  | { id: string; kind: 'comment-like'; at: string; actor: FeedActor; comment: unknown }
  | {
      id: string;
      kind: 'rank';
      at: string;
      actor: FeedActor;
      metric: LeaderboardMetric;
      scope: 'global' | 'friends';
      rank: number;
    }
  | {
      id: string;
      kind: 'achievement';
      at: string;
      actor: FeedActor;
      key: string;
      family: AchievementFamily;
      tier: number;
      threshold: number;
      icon: string;
    };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: FeedGateway,
    private readonly leaderboard: LeaderboardService,
  ) {}

  // Accepted friend IDs, both directions of the relation
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

  // Cursor-paginated feed (ISO timestamp): items strictly older than `cursor`.
  // Merges friends' reviews, played games and likes. `filter` narrows the
  // sources so pagination stays correct per tab.
  async getFeed(
    viewerId: number,
    cursor: string | undefined,
    limit = DEFAULT_LIMIT,
    filter?: FeedFilter,
  ): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const friends = await this.friendIds(viewerId);
    if (friends.length === 0) return { items: [], nextCursor: null };

    const before = cursor ? new Date(cursor) : undefined;
    const olderThan = before ? { createdAt: { lt: before } } : {};
    const take = limit + 1; // +1 per source to detect whether more remain
    const wantReviews = !filter || filter === 'reviews';
    const wantPlayed = !filter || filter === 'played';
    const wantCompleted = !filter || filter === 'completed';
    const wantLikes = !filter || filter === 'likes';
    // Rank milestones: "all" tab only.
    const wantRank = !filter;
    // Achievements: "all" tab or the dedicated one.
    const wantAchievement = !filter || filter === 'achievements';

    // Over-sample every requested source, then merge, sort and truncate.
    const [reviews, playedRaw, completions, reviewLikes, commentLikes, milestones, achievements] =
      await Promise.all([
      wantReviews
        ? this.prisma.review.findMany({
            where: { userId: { in: friends }, ...olderThan },
            orderBy: { createdAt: 'desc' },
            take,
            select: reviewSelect,
          })
        : [],
      wantPlayed
        ? this.prisma.playedGame.findMany({
            where: { userId: { in: friends }, status: PlayStatus.PLAYED, ...olderThan },
            orderBy: { createdAt: 'desc' },
            take,
            select: {
              id: true,
              createdAt: true,
              gameId: true,
              userId: true,
              user: { select: actorSelect },
              game: { select: gameSelect },
            },
          })
        : [],
      wantCompleted
        ? this.prisma.gameCompletion.findMany({
            where: { userId: { in: friends }, ...olderThan },
            orderBy: { createdAt: 'desc' },
            take,
            select: completionSelect,
          })
        : [],
      wantLikes
        ? this.prisma.reviewLike.findMany({
            where: { userId: { in: friends }, ...olderThan },
            orderBy: { createdAt: 'desc' },
            take,
            select: {
              id: true,
              createdAt: true,
              user: { select: actorSelect },
              review: { select: reviewTargetSelect },
            },
          })
        : [],
      wantLikes
        ? this.prisma.reviewCommentLike.findMany({
            where: { userId: { in: friends }, ...olderThan },
            orderBy: { createdAt: 'desc' },
            take,
            select: {
              id: true,
              createdAt: true,
              user: { select: actorSelect },
              comment: {
                select: {
                  id: true,
                  text: true,
                  user: { select: actorSelect },
                  review: {
                    select: { id: true, game: { select: gameSelect }, company: { select: companySelect } },
                  },
                },
              },
            },
          })
        : [],
      wantRank
        ? this.prisma.leaderboardMilestone.findMany({
            where: {
              ...olderThan,
              OR: [
                // A friend's GLOBAL milestones (visible to all their friends)
                { scope: 'global', subjectId: { in: friends } },
                // "Top 3 among MY friends" milestones addressed to me
                { scope: 'friends', viewerId: viewerId },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take,
            select: {
              id: true,
              createdAt: true,
              metric: true,
              scope: true,
              rank: true,
              subject: { select: actorSelect },
            },
          })
        : [],
      wantAchievement
        ? this.prisma.userAchievement.findMany({
            where: {
              userId: { in: friends },
              announced: true,
              ...(before ? { unlockedAt: { lt: before } } : {}),
            },
            orderBy: { unlockedAt: 'desc' },
            take,
            select: {
              id: true,
              key: true,
              unlockedAt: true,
              user: { select: actorSelect },
            },
          })
        : [],
    ]);

    // A played game the user also reviewed is hidden: the richer review card
    // already stands for it.
    const played = await this.dedupePlayed(playedRaw);

    const items: FeedItem[] = [
      ...reviews.map((r) => this.reviewItem(r)),
      ...played.map((p) => this.playedItem(p)),
      ...completions.map((c) => this.completedItem(c)),
      ...reviewLikes.map((l) => this.reviewLikeItem(l)),
      ...commentLikes.map((l) => this.commentLikeItem(l)),
      ...milestones.map((m) => this.rankItem(m)),
      ...achievements
        .map((a) => buildAchievementFeedItem(a))
        .filter((x): x is NonNullable<typeof x> => x !== null),
    ];

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].at : null;
    return { items: page, nextCursor };
  }

  private async dedupePlayed<T extends { userId: number; gameId: number }>(
    rows: T[],
  ): Promise<T[]> {
    if (rows.length === 0) return rows;
    const reviewed = await this.prisma.review.findMany({
      where: {
        userId: { in: rows.map((r) => r.userId) },
        gameId: { in: rows.map((r) => r.gameId) },
      },
      select: { userId: true, gameId: true },
    });
    const seen = new Set(reviewed.map((r) => `${r.userId}:${r.gameId}`));
    return rows.filter((r) => !seen.has(`${r.userId}:${r.gameId}`));
  }

  // ---- Item builders (shared by getFeed and the real-time push) ----

  private reviewItem(r: { id: number; createdAt: Date }): FeedItem {
    return { id: `review-${r.id}`, kind: 'review', at: r.createdAt.toISOString(), review: r };
  }

  private playedItem(p: {
    id: number;
    createdAt: Date;
    user: FeedActor;
    game: unknown;
  }): FeedItem {
    return {
      id: `played-${p.id}`,
      kind: 'played',
      at: p.createdAt.toISOString(),
      actor: p.user,
      game: p.game,
    };
  }

  private completedItem(c: {
    id: number;
    createdAt: Date;
    platform: string;
    user: FeedActor;
    game: unknown;
  }): FeedItem {
    return {
      id: `completed-${c.id}`,
      kind: 'completed',
      at: c.createdAt.toISOString(),
      actor: c.user,
      game: c.game,
      platform: c.platform,
    };
  }

  private reviewLikeItem(l: {
    id: number;
    createdAt: Date;
    user: FeedActor;
    review: unknown;
  }): FeedItem {
    return {
      id: `rlike-${l.id}`,
      kind: 'review-like',
      at: l.createdAt.toISOString(),
      actor: l.user,
      review: l.review,
    };
  }

  private commentLikeItem(l: {
    id: number;
    createdAt: Date;
    user: FeedActor;
    comment: unknown;
  }): FeedItem {
    return {
      id: `clike-${l.id}`,
      kind: 'comment-like',
      at: l.createdAt.toISOString(),
      actor: l.user,
      comment: l.comment,
    };
  }

  private rankItem(m: {
    id: number;
    createdAt: Date;
    metric: string;
    scope: string;
    rank: number;
    subject: FeedActor;
  }): FeedItem {
    return {
      id: `rank-${m.id}`,
      kind: 'rank',
      at: m.createdAt.toISOString(),
      actor: m.subject,
      metric: m.metric as LeaderboardMetric,
      scope: m.scope as 'global' | 'friends',
      rank: m.rank,
    };
  }

  // ---- Real-time push (best-effort, never blocks the action) ----

  async onReviewCreated(reviewId: number): Promise<void> {
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: reviewSelect,
      });
      if (!review?.user) return;
      await this.broadcast(review.user.id, this.reviewItem(review));
      await this.onRankAction(review.user.id, 'reviews');
    } catch (err) {
      this.logger.warn(`onReviewCreated failed: ${(err as Error).message}`);
    }
  }

  // New "played" game (explicit button). No card when the user already reviewed
  // it — the review stands for it.
  async onGamePlayed(userId: number, gameId: number): Promise<void> {
    try {
      // Still counts for the "played" metric even with a review, so milestone
      // detection runs independently of the card below.
      await this.onRankAction(userId, 'played');
      const hasReview = await this.prisma.review.findFirst({
        where: { userId, gameId },
        select: { id: true },
      });
      if (hasReview) return;
      const row = await this.prisma.playedGame.findUnique({
        where: { userId_gameId: { userId, gameId } },
        select: { id: true, createdAt: true, user: { select: actorSelect }, game: { select: gameSelect } },
      });
      if (!row?.user) return;
      await this.broadcast(row.user.id, this.playedItem(row));
    } catch (err) {
      this.logger.warn(`onGamePlayed failed: ${(err as Error).message}`);
    }
  }

  // Called on every platform library sync. `completed` = catalog games currently
  // at 100% there, with the real date when the platform provides one. The first
  // sync of a platform only seeds what already exists (pushing it would announce
  // every old 100% at once); later syncs emit per new completion. Best-effort.
  async syncCompletions(
    userId: number,
    platform: string,
    completed: { gameId: number; completedAt?: Date }[],
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { completionSeed: true },
      });
      if (!user) return;
      const seed = (user.completionSeed as Record<string, boolean> | null) ?? {};
      const seeded = seed[platform] === true;

      const existing = await this.prisma.gameCompletion.findMany({
        where: { userId, platform },
        select: { gameId: true, completedAt: true },
      });
      const knownAt = new Map(existing.map((e) => [e.gameId, e.completedAt]));
      const newItems = completed.filter((c) => !knownAt.has(c.gameId));
      const newIds = newItems.map((c) => c.gameId);

      if (newItems.length > 0) {
        await this.prisma.gameCompletion.createMany({
          // completedAt omitted -> Prisma default (now); only set when the
          // platform actually gave us a date.
          data: newItems.map((c) => ({
            userId,
            gameId: c.gameId,
            platform,
            ...(c.completedAt ? { completedAt: c.completedAt } : {}),
          })),
          skipDuplicates: true,
        });
      }

      // Completing implies playing (same rule as the manual "done" button):
      // upgrade to PLAYED so the library/played calendar agree with every
      // currently-100% game. Runs over the FULL `completed` list, not just
      // newItems — completions recorded by an earlier sync (before this rule
      // existed, or from a sync that ran between deploys) still get caught up
      // here instead of being stuck un-upgraded forever.
      if (completed.length > 0) {
        await this.prisma.$transaction(
          completed.map((c) =>
            this.prisma.playedGame.upsert({
              where: { userId_gameId: { userId, gameId: c.gameId } },
              // Upgrade PLAYING/BACKLOG to PLAYED, same as the manual button;
              // never touch an existing playedAt, only set it on first creation.
              update: { status: PlayStatus.PLAYED },
              create: {
                userId,
                gameId: c.gameId,
                status: PlayStatus.PLAYED,
                playedAt: c.completedAt ?? new Date(),
              },
            }),
          ),
        );
      }

      // Backfill: rows stored before we could read the real date carry an
      // approximate completedAt. A resync with a real date on a different DAY
      // fixes them; same day is left alone to avoid a pointless write.
      const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
      const toFix = completed.filter(
        (c): c is { gameId: number; completedAt: Date } =>
          !!c.completedAt && knownAt.has(c.gameId) && !sameDay(knownAt.get(c.gameId)!, c.completedAt),
      );
      if (toFix.length > 0) {
        await this.prisma.$transaction(
          toFix.map((c) =>
            this.prisma.gameCompletion.update({
              where: { userId_gameId_platform: { userId, gameId: c.gameId, platform } },
              data: { completedAt: c.completedAt },
            }),
          ),
        );
      }

      // First pass on this platform: mark it seeded and stop. What exists is
      // stored, nothing reaches the feed.
      if (!seeded) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { completionSeed: { ...seed, [platform]: true } as Prisma.InputJsonValue },
        });
        return;
      }

      if (newIds.length === 0) return;

      // Real-time push for the completions just stored.
      const rows = await this.prisma.gameCompletion.findMany({
        where: { userId, platform, gameId: { in: newIds } },
        select: completionSelect,
      });
      for (const row of rows) {
        if (!row.user) continue;
        await this.broadcast(row.user.id, this.completedItem(row));
      }
      // One milestone check for the whole batch.
      await this.onRankAction(userId, 'completions');
    } catch (err) {
      this.logger.warn(`syncCompletions failed: ${(err as Error).message}`);
    }
  }

  // Manual completion ("Finished" button on the game page): real-time card in
  // friends' feeds plus a rank milestone. Mirrors onGamePlayed.
  async onGameCompleted(userId: number, gameId: number): Promise<void> {
    try {
      await this.onRankAction(userId, 'completions');
      const row = await this.prisma.gameCompletion.findFirst({
        where: { userId, gameId, platform: 'manual' },
        select: completionSelect,
      });
      if (!row?.user) return;
      await this.broadcast(row.user.id, this.completedItem(row));
    } catch (err) {
      this.logger.warn(`onGameCompleted failed: ${(err as Error).message}`);
    }
  }

  // A friend liked a review
  async onReviewLiked(userId: number, reviewId: number): Promise<void> {
    try {
      const row = await this.prisma.reviewLike.findUnique({
        where: { userId_reviewId: { userId, reviewId } },
        select: {
          id: true,
          createdAt: true,
          user: { select: actorSelect },
          review: { select: reviewTargetSelect },
        },
      });
      if (!row?.user) return;
      await this.broadcast(row.user.id, this.reviewLikeItem(row));
    } catch (err) {
      this.logger.warn(`onReviewLiked failed: ${(err as Error).message}`);
    }
  }

  // A friend liked a comment
  async onCommentLiked(userId: number, commentId: number): Promise<void> {
    try {
      const row = await this.prisma.reviewCommentLike.findUnique({
        where: { userId_commentId: { userId, commentId } },
        select: {
          id: true,
          createdAt: true,
          user: { select: actorSelect },
          comment: {
            select: {
              id: true,
              text: true,
              user: { select: actorSelect },
              review: {
                select: { id: true, game: { select: gameSelect }, company: { select: companySelect } },
              },
            },
          },
        },
      });
      if (!row?.user) return;
      await this.broadcast(row.user.id, this.commentLikeItem(row));
    } catch (err) {
      this.logger.warn(`onCommentLiked failed: ${(err as Error).message}`);
    }
  }

  // Broadcasts an item to every friend of the actor, not the actor themselves
  private async broadcast(actorId: number, item: FeedItem): Promise<void> {
    const friends = await this.friendIds(actorId);
    for (const id of friends) this.gateway.emitToUser(id, 'feed:new', item);
  }

  // Detects the rank milestones an action (+1 on `metric`) causes and pushes
  // them. Best-effort: never interrupts the calling action.
  async onRankAction(userId: number, metric: LeaderboardMetric): Promise<void> {
    try {
      const created = await this.leaderboard.recordMilestones(userId, metric);
      for (const m of created) await this.broadcastMilestone(m);
    } catch (err) {
      this.logger.warn(`onRankAction(${metric}) failed: ${(err as Error).message}`);
    }
  }

  // Global -> every friend of the subject; friends -> only the observer it targets.
  private async broadcastMilestone(m: RecordedMilestone): Promise<void> {
    const item = this.rankItem(m);
    if (m.scope === 'global') {
      const friends = await this.friendIds(m.subject.id);
      for (const id of friends) this.gateway.emitToUser(id, 'feed:new', item);
    } else if (m.viewerId != null) {
      this.gateway.emitToUser(m.viewerId, 'feed:new', item);
    }
  }
}
