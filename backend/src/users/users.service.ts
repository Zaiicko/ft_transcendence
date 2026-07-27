import { Injectable } from '@nestjs/common';
import { FriendshipStatus, Prisma } from '@prisma/client';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { AVATARS_DIR } from '../common/uploads';
import { ALL_ACHIEVEMENTS } from '../achievements/achievements.catalog';
import { ListsService } from '../lists/lists.service';
import { PrismaService } from '../prisma/prisma.service';

// Viewer's relationship with the profile owner, so the frontend can show the
// right friend action (or none)
export type FriendState = 'self' | 'friends' | 'incoming' | 'outgoing' | 'none';

// Only ever the game (never company) reference, shared by top games / calendar
const gameRef = { select: { id: true, title: true, coverUrl: true } } as const;

// Garde une seule entrée par jeu (la première rencontrée). Entrée = tri déjà
// fait en amont → on garde donc la plus récente. Utilisé pour le calendrier
// « terminé » où un même jeu peut être complété sur plusieurs plateformes.
function dedupeByGame<T extends { game: { id: number } }>(entries: T[]): T[] {
  const seen = new Set<number>();
  return entries.filter((e) => (seen.has(e.game.id) ? false : (seen.add(e.game.id), true)));
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lists: ListsService,
  ) {}

  // Used by AuthModule (local signup + OAuth provisioning)
  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  update(id: number, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }

  delete(id: number) {
    return this.prisma.user.delete({ where: { id } });
  }

  // Privacy-safe public profile keyed by username: identity + badges + stats +
  // recent activity. Never exposes email / 2FA / provider ids. `viewerId` (the
  // optionally-authenticated caller) only drives the friend-action state.
  async getPublicProfile(username: string, viewerId?: number) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return null;

    const [
      reviewCount,
      playedCount,
      topReviews,
      recentReviews,
      completedRaw,
      friendState,
      publicLists,
    ] = await Promise.all([
        this.prisma.review.count({ where: { userId: user.id, gameId: { not: null } } }),
        this.prisma.playedGame.count({ where: { userId: user.id } }),
        // Top 5 games by the rating this user gave them
        this.prisma.review.findMany({
          where: { userId: user.id, gameId: { not: null } },
          orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
          take: 5,
          select: { rating: true, game: gameRef },
        }),
        // Latest reviews (game or company) — seed de la section avis (sort
        // "recent", page 1) ; _count pour afficher likes/💬 (tri lisible)
        this.prisma.review.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            rating: true,
            text: true,
            createdAt: true,
            game: gameRef,
            company: { select: { id: true, name: true, logoUrl: true } },
            _count: {
              select: { likes: true, dislikes: true, comments: { where: { deletedAt: null } } },
            },
          },
        }),
        // Complétions, datées par completedAt (date réelle). `platform` distingue
        // les deux séries du calendrier : 'manual' = marqué « fait » à la main
        // (ambre) ; steam/xbox/psn = 100 % plateforme (vert). Un même jeu peut
        // avoir plusieurs lignes (une par source) → dédupliqué par jeu et par
        // série plus bas (garde la plus récente, déjà en tête car tri desc).
        this.prisma.gameCompletion.findMany({
          where: { userId: user.id },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true, platform: true, game: gameRef },
        }),
        this.friendState(user.id, viewerId),
        // Listes publiques : les privées ne sont jamais exposées ici
        this.lists.publicListsOf(user.id),
      ]);

    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      provider: user.provider,
      steamId: user.steamId,
      // Badges PlayStation / Xbox sur le profil (même jeu de badges que la liste
      // d'amis). On n'expose que le booléen de liaison, jamais l'ID interne.
      psnLinked: user.psnAccountId !== null,
      xboxLinked: user.xboxXuid !== null,
      createdAt: user.createdAt,
      reviewCount,
      playedCount,
      topGames: topReviews
        .filter((r) => r.game)
        .map((r) => ({ rating: r.rating, game: r.game! })),
      recentReviews,
      // Série ambre du calendrier : jeux marqués « fait » à la main.
      completions: dedupeByGame(
        completedRaw
          .filter((c) => c.platform === 'manual')
          .map((c) => ({ playedAt: c.completedAt, game: c.game })),
      ),
      // Série verte du calendrier : jeux 100 % sur une plateforme (Steam/Xbox/PSN).
      perfectGames: dedupeByGame(
        completedRaw
          .filter((c) => c.platform !== 'manual')
          .map((c) => ({ playedAt: c.completedAt, game: c.game })),
      ),
      friendState,
      publicLists,
    };
  }

  // Résumé chiffré « ton année en jeux » pour la bande de stats de l'accueil du
  // connecté : jeux faits (série ambre) / 100 % plateforme (série verte),
  // critiques + note moyenne, rang mondial (complétions), succès débloqués.
  // Tout est recalculé à la volée en Prisma (pas de dépendance cross-module :
  // UsersModule resterait pris dans un cycle via Auth s'il importait
  // Leaderboard/Achievements — d'où le rang calculé en requête brute ici).
  async getHomeStats(userId: number) {
    const [reviewAgg, doneRows, perfectRows, achievementCount, rank] = await Promise.all([
      this.prisma.review.aggregate({
        where: { userId },
        _count: { _all: true },
        _avg: { rating: true },
      }),
      // Jeux marqués « fait » à la main (distincts) — série ambre du calendrier.
      this.prisma.gameCompletion.findMany({
        where: { userId, platform: 'manual' },
        distinct: ['gameId'],
        select: { gameId: true },
      }),
      // Jeux 100 % sur une plateforme (distincts) — série verte.
      this.prisma.gameCompletion.findMany({
        where: { userId, platform: { not: 'manual' } },
        distinct: ['gameId'],
        select: { gameId: true },
      }),
      this.prisma.userAchievement.count({ where: { userId } }),
      this.completionsRank(userId),
    ]);

    return {
      done: doneRows.length,
      perfect: perfectRows.length,
      reviews: reviewAgg._count._all,
      avgRating: reviewAgg._avg.rating, // null si aucune critique
      achievements: { unlocked: achievementCount, total: ALL_ACHIEVEMENTS.length },
      rank, // { rank } global (complétions), ou null si non classé
    };
  }

  // Rang mondial de l'utilisateur au classement « complétions » (all-time,
  // global). Même départage que LeaderboardService (score DESC, puis premier
  // arrivé à ce score = MAX createdAt le plus ancien). null s'il n'a rien
  // complété (score 0 ⇒ non classé). Requête brute pour ne pas coupler
  // UsersModule à LeaderboardModule (cycle via AuthModule).
  private async completionsRank(userId: number): Promise<{ rank: number } | null> {
    const mine = await this.prisma.$queryRaw<{ score: number; lastAt: Date | null }[]>`
      SELECT COUNT(*)::int AS "score", MAX("createdAt") AS "lastAt"
      FROM "GameCompletion" WHERE "userId" = ${userId}
    `;
    const score = mine[0]?.score ?? 0;
    const lastAt = mine[0]?.lastAt ?? null;
    if (score === 0 || !lastAt) return null;

    const above = await this.prisma.$queryRaw<{ above: number }[]>`
      SELECT COUNT(*)::int AS "above" FROM (
        SELECT "userId"
        FROM "GameCompletion"
        GROUP BY "userId"
        HAVING COUNT(*) > ${score}
            OR (COUNT(*) = ${score} AND MAX("createdAt") < ${lastAt})
      ) t
    `;
    return { rank: (above[0]?.above ?? 0) + 1 };
  }

  // Full list of games this user has logged (any status), newest-played first
  // (undated entries last). Backs the "games played" modal on the profile —
  // the profile payload itself only carries the dated subset (calendar).
  async playedGamesOf(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!user) return null;
    return this.prisma.playedGame.findMany({
      where: { userId: user.id },
      orderBy: [{ playedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { playedAt: true, status: true, game: gameRef },
    });
  }

  private async friendState(ownerId: number, viewerId?: number): Promise<FriendState> {
    if (!viewerId) return 'none';
    if (viewerId === ownerId) return 'self';
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: ownerId },
          { requesterId: ownerId, addresseeId: viewerId },
        ],
      },
      select: { status: true, requesterId: true },
    });
    if (!friendship) return 'none';
    if (friendship.status === FriendshipStatus.ACCEPTED) return 'friends';
    return friendship.requesterId === viewerId ? 'outgoing' : 'incoming';
  }

  // avatarUrl looks like /api/uploads/avatars/<file> — only ever deletes inside
  // AVATARS_DIR. split('#') : retire un éventuel fragment de cadrage (#af=...)
  // avant de déduire le nom de fichier.
  async deleteAvatarFile(avatarUrl: string): Promise<void> {
    const filePath = join(AVATARS_DIR, basename(avatarUrl.split('#')[0]));
    if (filePath.startsWith(AVATARS_DIR) && existsSync(filePath)) {
      await unlink(filePath);
    }
  }
}
