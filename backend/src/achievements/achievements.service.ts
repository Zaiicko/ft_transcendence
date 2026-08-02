import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FeedGateway } from '../feed/feed.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_ACHIEVEMENTS,
  ACHIEVEMENT_FAMILIES,
  AchievementFamily,
  buildAchievementFeedItem,
} from './achievements.catalog';

// One achievement as returned to the profile: definition, unlocked state and
// current progress (for the X/Y bar on locked ones).
export interface AchievementView {
  key: string;
  family: AchievementFamily;
  tier: number;
  threshold: number;
  icon: string;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number; // current metric value, capped at the threshold
}

type GameRef = { id: number; title: string; coverUrl: string | null };

// Profile response: the achievements plus the games illustrating some families
// (rated 10 = favourites, rated 0 = harsh reviews).
export interface AchievementsPayload {
  items: AchievementView[];
  ratedGames: { favorite: GameRef[]; harsh: GameRef[] };
}

const gameRefSelect = { id: true, title: true, coverUrl: true } as const;

@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: FeedGateway,
  ) {}

  // One-off backfill: when no achievement exists yet (first deploy of the
  // feature), silently unlock what existing data already earned — no
  // notification, no feed, or the whole history would announce at once.
  async onModuleInit(): Promise<void> {
    try {
      if ((await this.prisma.userAchievement.count()) > 0) return;
      const users = await this.prisma.user.findMany({ select: { id: true } });
      if (users.length === 0) return;
      this.logger.log(`Backfill des succès pour ${users.length} utilisateurs…`);
      for (const u of users) await this.evaluate(u.id, ACHIEVEMENT_FAMILIES, false);
      this.logger.log('Backfill des succès terminé.');
    } catch (err) {
      this.logger.warn(`backfill failed: ${(err as Error).message}`);
    }
  }

  // Current value of a family's metric for one user.
  private async metric(userId: number, family: AchievementFamily): Promise<number> {
    switch (family) {
      case 'completions':
        return (
          await this.prisma.gameCompletion.findMany({
            where: { userId },
            distinct: ['gameId'],
            select: { gameId: true },
          })
        ).length;
      case 'perfect':
        return (
          await this.prisma.gameCompletion.findMany({
            where: { userId, platform: { not: 'manual' } },
            distinct: ['gameId'],
            select: { gameId: true },
          })
        ).length;
      case 'linked': {
        const u = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { steamId: true, xboxXuid: true, psnAccountId: true },
        });
        return (u?.steamId ? 1 : 0) + (u?.xboxXuid ? 1 : 0) + (u?.psnAccountId ? 1 : 0);
      }
      case 'reviews':
        return this.prisma.review.count({ where: { userId } });
      case 'popular':
        // Likes received on this user's reviews.
        return this.prisma.reviewLike.count({ where: { review: { userId } } });
      case 'supporter':
        // Likes given to other people's reviews.
        return this.prisma.reviewLike.count({ where: { userId } });
      case 'favorite':
        return this.prisma.review.count({ where: { userId, rating: 10 } });
      case 'harsh':
        return this.prisma.review.count({ where: { userId, rating: 0 } });
      case 'veteran': {
        // Account age in months (~30 days).
        const u = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { createdAt: true },
        });
        if (!u) return 0;
        return Math.floor((Date.now() - u.createdAt.getTime()) / (30 * 24 * 3600 * 1000));
      }
      case 'lists':
        return this.prisma.gameList.count({ where: { userId } });
      case 'friends':
        return this.prisma.friendship.count({
          where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
        });
      case 'genres': {
        // Distinct genres across completed games (implicit m2m join).
        const rows = await this.prisma.$queryRaw<{ n: number }[]>`
          SELECT COUNT(DISTINCT gg."B")::int AS n
          FROM "GameCompletion" c
          JOIN "_GameToGenre" gg ON gg."A" = c."gameId"
          WHERE c."userId" = ${userId}
        `;
        return rows[0]?.n ?? 0;
      }
      case 'studio': {
        // Most rated games belonging to a single studio.
        const rows = await this.prisma.$queryRaw<{ n: number }[]>`
          SELECT COUNT(DISTINCT r."gameId")::int AS n
          FROM "Review" r
          JOIN "_CompanyToGame" cg ON cg."B" = r."gameId"
          WHERE r."userId" = ${userId} AND r."gameId" IS NOT NULL
          GROUP BY cg."A"
          ORDER BY n DESC
          LIMIT 1
        `;
        return rows[0]?.n ?? 0;
      }
    }
  }

  // Recomputes the families an action touches and unlocks the tiers crossed
  // (idempotent insert), notifies the user and pushes a feed card to their
  // friends. Best-effort: never blocks the triggering action.
  async evaluate(
    userId: number,
    families: AchievementFamily[],
    notify = true,
  ): Promise<void> {
    try {
      const defs = ALL_ACHIEVEMENTS.filter((a) => families.includes(a.family));
      if (defs.length === 0) return;

      // Tiers not unlocked yet
      const owned = new Set(
        (
          await this.prisma.userAchievement.findMany({
            where: { userId, key: { in: defs.map((d) => d.key) } },
            select: { key: true },
          })
        ).map((r) => r.key),
      );
      const pending = defs.filter((d) => !owned.has(d.key));
      if (pending.length === 0) return;

      // One measurement per family involved
      const fams = [...new Set(pending.map((d) => d.family))];
      const values = new Map<AchievementFamily, number>();
      await Promise.all(fams.map(async (f) => values.set(f, await this.metric(userId, f))));

      const toUnlock = pending.filter((d) => (values.get(d.family) ?? 0) >= d.threshold);
      if (toUnlock.length === 0) return;

      await this.prisma.userAchievement.createMany({
        // `announced` is true only for a real action, which is what makes it
        // show up in the feed; a backfill (notify=false) stays invisible.
        data: toUnlock.map((d) => ({ userId, key: d.key, announced: notify })),
        skipDuplicates: true,
      });

      // Backfill: rows are inserted but nothing is announced.
      if (!notify) return;

      // Personal notification (honours the user's preferences)
      for (const d of toUnlock) await this.notifications.achievementUnlocked(userId, d.key);

      // Feed card for friends
      const rows = await this.prisma.userAchievement.findMany({
        where: { userId, key: { in: toUnlock.map((d) => d.key) } },
        select: {
          id: true,
          key: true,
          unlockedAt: true,
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
      });
      const friends = await this.friendIds(userId);
      for (const row of rows) {
        const item = buildAchievementFeedItem(row);
        if (!item) continue;
        for (const fid of friends) this.gateway.emitToUser(fid, 'feed:new', item);
      }
    } catch (err) {
      this.logger.warn(`evaluate failed: ${(err as Error).message}`);
    }
  }

  // Every catalog achievement with this user's state (unlocked + progress), for
  // the profile's "Achievements" section. Unlocked first, then by family.
  async getForUser(userId: number): Promise<AchievementsPayload> {
    const [unlocked, values, favGames, harshGames] = await Promise.all([
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { key: true, unlockedAt: true },
      }),
      (async () => {
        const map = new Map<AchievementFamily, number>();
        await Promise.all(
          ACHIEVEMENT_FAMILIES.map(async (f) => map.set(f, await this.metric(userId, f))),
        );
        return map;
      })(),
      // Games rated 10 (favourites) and 0 (harsh), most recent first.
      this.prisma.review.findMany({
        where: { userId, rating: 10, gameId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: { game: { select: gameRefSelect } },
      }),
      this.prisma.review.findMany({
        where: { userId, rating: 0, gameId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: { game: { select: gameRefSelect } },
      }),
    ]);
    const unlockedAt = new Map(unlocked.map((u) => [u.key, u.unlockedAt]));

    // Silent self-repair: achievements already earned (progress >= threshold)
    // but never stored are inserted here. Required for families with no action
    // trigger, like "veteran", which unlocks purely with time. No notification
    // or feed — this is catch-up only.
    const missing = ALL_ACHIEVEMENTS.filter(
      (a) => !unlockedAt.has(a.key) && (values.get(a.family) ?? 0) >= a.threshold,
    );
    if (missing.length > 0) {
      await this.prisma.userAchievement.createMany({
        data: missing.map((a) => ({ userId, key: a.key })),
        skipDuplicates: true,
      });
      const now = new Date();
      for (const a of missing) unlockedAt.set(a.key, now);
    }

    const items = ALL_ACHIEVEMENTS.map((a) => {
      const at = unlockedAt.get(a.key) ?? null;
      const current = values.get(a.family) ?? 0;
      return {
        key: a.key,
        family: a.family,
        tier: a.tier,
        threshold: a.threshold,
        icon: a.icon,
        unlocked: at !== null,
        unlockedAt: at ? at.toISOString() : null,
        progress: Math.min(current, a.threshold),
      };
    }).sort((x, y) => {
      // Unlocked first, then whichever is closest to unlocking (progress %)
      if (x.unlocked !== y.unlocked) return x.unlocked ? -1 : 1;
      if (x.unlocked && y.unlocked) return (y.unlockedAt! > x.unlockedAt! ? 1 : -1);
      return y.progress / y.threshold - x.progress / x.threshold;
    });

    return {
      items,
      ratedGames: {
        favorite: favGames.map((r) => r.game!).filter(Boolean),
        harsh: harshGames.map((r) => r.game!).filter(Boolean),
      },
    };
  }

  // Accepted friends of a user (the feed recipients).
  private async friendIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
  }
}
