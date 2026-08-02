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

// Keeps one entry per game — the first seen, and input is pre-sorted, so the
// most recent. Used by the "completed" calendar, where one game can be
// completed on several platforms.
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

  // GDPR right of access (Art. 15) and portability (Art. 20): every personal
  // record in one structured JSON, downloadable from the settings. Auth secrets
  // (passwordHash, twoFactorSecret, token hashes) are excluded as security data,
  // and the third-party library caches are omitted — they are copies of public
  // Steam/PSN/Xbox profiles. Linked-account ids are kept.
  async exportData(userId: number) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        reviews: {
          include: { game: { select: { title: true } }, company: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        reviewComments: {
          include: { review: { select: { title: true } } },
          orderBy: { createdAt: 'asc' },
        },
        reviewLikes: { include: { review: { select: { title: true } } } },
        reviewDislikes: { include: { review: { select: { title: true } } } },
        playedGames: {
          include: { game: { select: { title: true } } },
          orderBy: { createdAt: 'asc' },
        },
        gameCompletions: {
          include: { game: { select: { title: true } } },
          orderBy: { completedAt: 'asc' },
        },
        achievements: { orderBy: { unlockedAt: 'asc' } },
        gameLists: {
          include: { items: { include: { game: { select: { title: true } } }, orderBy: { position: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        },
        sentFriendships: { include: { addressee: { select: { username: true } } } },
        receivedFriendships: { include: { requester: { select: { username: true } } } },
        sentMessages: {
          include: { recipient: { select: { username: true } } },
          orderBy: { createdAt: 'asc' },
        },
        receivedMessages: {
          include: { sender: { select: { username: true } } },
          orderBy: { createdAt: 'asc' },
        },
        notifications: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!u) return null;

    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: u.id,
        email: u.email,
        username: u.username,
        bio: u.bio,
        avatarUrl: u.avatarUrl,
        language: u.language,
        provider: u.provider,
        providerId: u.providerId,
        linkedAccounts: {
          steamId: u.steamId,
          discordId: u.discordId,
          psnOnlineId: u.psnOnlineId,
          xboxGamertag: u.xboxGamertag,
        },
        twoFactorEnabled: u.twoFactorEnabled,
        notificationPrefs: u.notificationPrefs,
        emailVerifiedAt: u.emailVerifiedAt,
        onboardedAt: u.onboardedAt,
        lastSeenAt: u.lastSeenAt,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      },
      reviews: u.reviews.map((r) => ({
        target: r.game?.title ?? r.company?.name ?? null,
        title: r.title,
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      comments: u.reviewComments.map((c) => ({
        onReview: c.review?.title ?? null,
        text: c.deletedAt ? '[deleted]' : c.text,
        createdAt: c.createdAt,
      })),
      likedReviews: u.reviewLikes.map((l) => l.review?.title ?? null),
      dislikedReviews: u.reviewDislikes.map((l) => l.review?.title ?? null),
      playedGames: u.playedGames.map((p) => ({
        game: p.game.title,
        status: p.status,
        playedAt: p.playedAt,
        markedAt: p.createdAt,
      })),
      completions: u.gameCompletions.map((c) => ({
        game: c.game.title,
        platform: c.platform,
        completedAt: c.completedAt,
      })),
      achievements: u.achievements.map((a) => ({ key: a.key, unlockedAt: a.unlockedAt })),
      lists: u.gameLists.map((l) => ({
        name: l.name,
        isPublic: l.isPublic,
        games: l.items.map((i) => i.game.title),
        createdAt: l.createdAt,
      })),
      friends: [
        ...u.sentFriendships.map((f) => ({
          username: f.addressee.username,
          status: f.status,
          direction: 'sent' as const,
          since: f.createdAt,
        })),
        ...u.receivedFriendships.map((f) => ({
          username: f.requester.username,
          status: f.status,
          direction: 'received' as const,
          since: f.createdAt,
        })),
      ],
      messages: [
        ...u.sentMessages.map((m) => ({
          direction: 'sent' as const,
          with: m.recipient.username,
          type: m.type,
          content: m.content,
          sentAt: m.createdAt,
          readAt: m.readAt,
        })),
        ...u.receivedMessages.map((m) => ({
          direction: 'received' as const,
          with: m.sender.username,
          type: m.type,
          content: m.content,
          sentAt: m.createdAt,
          readAt: m.readAt,
        })),
      ].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
      notifications: u.notifications.map((n) => ({
        type: n.type,
        payload: n.payload,
        createdAt: n.createdAt,
        readAt: n.readAt,
      })),
    };
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
      rank,
      totalListCount,
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
        // Latest reviews (game or company): seeds the reviews section (recent
        // sort, page 1); _count feeds the likes/comments counters
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
        // Completions, dated by completedAt. `platform` splits the two calendar
        // series: 'manual' = marked done by hand (amber), steam/xbox/psn = 100%
        // on the platform (green). A game can have one row per source, so each
        // series is deduped below (keeps the most recent, already first).
        this.prisma.gameCompletion.findMany({
          where: { userId: user.id },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true, platform: true, game: gameRef },
        }),
        this.friendState(user.id, viewerId),
        // Public lists only: private ones are never exposed here
        this.lists.publicListsOf(user.id),
        // Global completions rank, same metric as the home stats band and the
        // Leaderboard page. null when unranked.
        this.completionsRank(user.id),
        // Total lists (public + private) for the owner's tab counter; visitors
        // only ever count the public ones, below.
        this.prisma.gameList.count({ where: { userId: user.id } }),
      ]);

    // The owner sees the total, private lists included; a visitor only sees the
    // public ones we expose.
    const listCount = viewerId === user.id ? totalListCount : publicLists.length;

    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      provider: user.provider,
      steamId: user.steamId,
      // PlayStation / Xbox badges (same set as the friends list). Only the
      // linked boolean is exposed, never the internal ID.
      psnLinked: user.psnAccountId !== null,
      xboxLinked: user.xboxXuid !== null,
      createdAt: user.createdAt,
      reviewCount,
      playedCount,
      rank, // global completions rank, or null when unranked
      topGames: topReviews
        .filter((r) => r.game)
        .map((r) => ({ rating: r.rating, game: r.game! })),
      recentReviews,
      // Amber calendar series: games marked done by hand.
      completions: dedupeByGame(
        completedRaw
          .filter((c) => c.platform === 'manual')
          .map((c) => ({ playedAt: c.completedAt, game: c.game })),
      ),
      // Green calendar series: games at 100% on a platform (Steam/Xbox/PSN).
      perfectGames: dedupeByGame(
        completedRaw
          .filter((c) => c.platform !== 'manual')
          .map((c) => ({ playedAt: c.completedAt, game: c.game })),
      ),
      friendState,
      publicLists,
      listCount,
    };
  }

  // "Your year in games" summary for the signed-in home stats band: games done
  // (amber) and platform 100% (green), reviews with average rating, global rank,
  // achievements. Computed inline in Prisma — importing Leaderboard/Achievements
  // would put UsersModule in a cycle through Auth, hence the raw rank query.
  async getHomeStats(userId: number) {
    const [reviewAgg, doneRows, perfectRows, achievementCount, rank] = await Promise.all([
      this.prisma.review.aggregate({
        where: { userId },
        _count: { _all: true },
        _avg: { rating: true },
      }),
      // Distinct games marked done by hand: amber calendar series.
      this.prisma.gameCompletion.findMany({
        where: { userId, platform: 'manual' },
        distinct: ['gameId'],
        select: { gameId: true },
      }),
      // Distinct games at 100% on a platform: green series.
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
      avgRating: reviewAgg._avg.rating, // null when there is no review
      achievements: { unlocked: achievementCount, total: ALL_ACHIEVEMENTS.length },
      rank, // global completions rank, or null when unranked
    };
  }

  // Global all-time rank on the "completions" leaderboard. Same tie-break as
  // LeaderboardService (score DESC, then whoever reached it first). null at
  // score 0. Raw query so UsersModule stays off LeaderboardModule, which would
  // introduce a cycle through AuthModule.
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
  // AVATARS_DIR. split('#') drops any crop fragment (#af=...) first.
  async deleteAvatarFile(avatarUrl: string): Promise<void> {
    const filePath = join(AVATARS_DIR, basename(avatarUrl.split('#')[0]));
    if (filePath.startsWith(AVATARS_DIR) && existsSync(filePath)) {
      await unlink(filePath);
    }
  }
}
