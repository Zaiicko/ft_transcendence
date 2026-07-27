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

// Un succès tel que renvoyé au profil : définition + état (débloqué ou non) +
// progression courante (pour la barre X/Y sur les succès verrouillés).
export interface AchievementView {
  key: string;
  family: AchievementFamily;
  tier: number;
  threshold: number;
  icon: string;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number; // valeur courante de la métrique (bornée au seuil)
}

type GameRef = { id: number; title: string; coverUrl: string | null };

// Réponse du profil : les succès + les jeux qui illustrent certaines familles
// (notés 10 = coups de cœur, notés 0 = critiques sévères).
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

  // Amorçage unique : si aucun succès n'existe encore (première mise en service
  // de la feature), on débloque en SILENCE les succès déjà mérités par l'existant
  // — pas de notif ni de feed, sinon tout l'historique s'annoncerait d'un coup.
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

  // Valeur courante de la métrique d'une famille pour un utilisateur.
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
        // Nb de comptes plateforme liés : Steam / Xbox / PlayStation.
        const u = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { steamId: true, xboxXuid: true, psnAccountId: true },
        });
        return (u?.steamId ? 1 : 0) + (u?.xboxXuid ? 1 : 0) + (u?.psnAccountId ? 1 : 0);
      }
      case 'reviews':
        return this.prisma.review.count({ where: { userId } });
      case 'popular':
        // Total de j'aime reçus sur les critiques de l'utilisateur.
        return this.prisma.reviewLike.count({ where: { review: { userId } } });
      case 'supporter':
        // Total de j'aime DONNÉS aux critiques des autres.
        return this.prisma.reviewLike.count({ where: { userId } });
      case 'favorite':
        // Critiques notées 10/10.
        return this.prisma.review.count({ where: { userId, rating: 10 } });
      case 'harsh':
        // Critiques notées 0.
        return this.prisma.review.count({ where: { userId, rating: 0 } });
      case 'veteran': {
        // Ancienneté du compte, en mois (~30 j).
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
        // Nb de genres distincts parmi les jeux terminés (join m2m implicite).
        const rows = await this.prisma.$queryRaw<{ n: number }[]>`
          SELECT COUNT(DISTINCT gg."B")::int AS n
          FROM "GameCompletion" c
          JOIN "_GameToGenre" gg ON gg."A" = c."gameId"
          WHERE c."userId" = ${userId}
        `;
        return rows[0]?.n ?? 0;
      }
      case 'studio': {
        // Max de jeux notés appartenant à un même studio.
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

  // Recalcule les familles concernées par une action et débloque les paliers
  // franchis (insert idempotent) ; notifie l'utilisateur et pousse une carte de
  // feed à ses amis. Best-effort : ne bloque jamais l'action déclenchante.
  async evaluate(
    userId: number,
    families: AchievementFamily[],
    notify = true,
  ): Promise<void> {
    try {
      const defs = ALL_ACHIEVEMENTS.filter((a) => families.includes(a.family));
      if (defs.length === 0) return;

      // Paliers pas encore débloqués
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

      // Une seule mesure par famille concernée
      const fams = [...new Set(pending.map((d) => d.family))];
      const values = new Map<AchievementFamily, number>();
      await Promise.all(fams.map(async (f) => values.set(f, await this.metric(userId, f))));

      const toUnlock = pending.filter((d) => (values.get(d.family) ?? 0) >= d.threshold);
      if (toUnlock.length === 0) return;

      await this.prisma.userAchievement.createMany({
        data: toUnlock.map((d) => ({ userId, key: d.key })),
        skipDuplicates: true,
      });

      // Backfill / amorçage : on insère mais on n'annonce rien.
      if (!notify) return;

      // Notification perso (respecte les préférences)
      for (const d of toUnlock) await this.notifications.achievementUnlocked(userId, d.key);

      // Carte de feed pour les amis
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

  // Tous les succès du catalogue avec l'état (débloqué + progression) d'un user,
  // pour la section « Succès » du profil. Débloqués d'abord, puis par famille.
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
      // Jeux notés 10 (coups de cœur) et 0 (critiques sévères), récents d'abord.
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

    // Auto-réparation silencieuse : les succès déjà mérités (progression ≥ seuil)
    // mais pas encore enregistrés sont insérés à la volée. Indispensable pour les
    // familles SANS déclencheur d'action (ex. « vétéran », qui se débloque avec le
    // temps). Aucune notif/feed ici — simple rattrapage.
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
      // Débloqués d'abord, puis les plus proches d'être débloqués (progression %)
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

  // Amis acceptés d'un utilisateur (destinataires du feed).
  private async friendIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
  }
}
