import { Injectable } from '@nestjs/common';
import { FriendshipStatus, PlayStatus, Prisma } from '@prisma/client';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { AVATARS_DIR } from '../common/uploads';
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
      playedDated,
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
        // « Joué » : marquage manuel (playedAt) OU dernière date de lancement
        // remontée par une plateforme (lastPlayedAt) — les deux alimentent le
        // calendrier « joué ».
        this.prisma.playedGame.findMany({
          where: {
            userId: user.id,
            OR: [{ playedAt: { not: null } }, { lastPlayedAt: { not: null } }],
          },
          orderBy: { playedAt: 'desc' },
          select: { playedAt: true, lastPlayedAt: true, game: gameRef },
        }),
        // « Terminé » : complétions 100 % (succès Steam / platine PSN…), datées
        // par createdAt. Un même jeu peut avoir plusieurs lignes (une par
        // plateforme) → dédupliqué par jeu plus bas (garde la plus récente).
        this.prisma.gameCompletion.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, game: gameRef },
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
      // Une entrée par date (manuelle et/ou plateforme) ; on évite le doublon
      // si les deux tombent le même jour.
      calendar: playedDated.flatMap((p) => {
        const day = (d: Date) => d.toISOString().slice(0, 10);
        const out: { playedAt: Date; game: (typeof p)['game'] }[] = [];
        if (p.playedAt) out.push({ playedAt: p.playedAt, game: p.game });
        if (p.lastPlayedAt && (!p.playedAt || day(p.lastPlayedAt) !== day(p.playedAt))) {
          out.push({ playedAt: p.lastPlayedAt, game: p.game });
        }
        return out;
      }),
      // Une entrée par jeu terminé (la plus récente, déjà en tête car tri desc)
      completions: dedupeByGame(
        completedRaw.map((c) => ({ playedAt: c.createdAt, game: c.game })),
      ),
      friendState,
      publicLists,
    };
  }

  // Enregistre la dernière date de lancement remontée par une plateforme sur des
  // jeux du catalogue → calendrier « joué ». N'écrase JAMAIS playedAt/status : à
  // la création on pose PLAYED (le jeu a bien été lancé), en update seulement
  // lastPlayedAt. Appelé par les synchros Steam/Xbox/PSN.
  async recordLastPlayed(userId: number, items: { gameId: number; lastPlayed: Date }[]) {
    if (!items.length) return;
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.playedGame.upsert({
          where: { userId_gameId: { userId, gameId: it.gameId } },
          update: { lastPlayedAt: it.lastPlayed },
          create: {
            userId,
            gameId: it.gameId,
            status: PlayStatus.PLAYED,
            lastPlayedAt: it.lastPlayed,
          },
        }),
      ),
    );
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
