import { Injectable } from '@nestjs/common';
import { FriendshipStatus, Prisma } from '@prisma/client';
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
        // Completion calendar: only games with a recorded date
        this.prisma.playedGame.findMany({
          where: { userId: user.id, playedAt: { not: null } },
          orderBy: { playedAt: 'desc' },
          select: { playedAt: true, game: gameRef },
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
      createdAt: user.createdAt,
      reviewCount,
      playedCount,
      topGames: topReviews
        .filter((r) => r.game)
        .map((r) => ({ rating: r.rating, game: r.game! })),
      recentReviews,
      calendar: playedDated.map((p) => ({ playedAt: p.playedAt!, game: p.game })),
      friendState,
      publicLists,
    };
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
