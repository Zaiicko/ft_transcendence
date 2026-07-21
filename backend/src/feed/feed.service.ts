import { Injectable, Logger } from '@nestjs/common';
import { FriendshipStatus, PlayStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeedGateway } from './feed.gateway';

// Aperçu dénormalisé (mêmes champs que ReviewHighlight côté front)
const reviewSelect = {
  id: true,
  rating: true,
  title: true,
  text: true,
  createdAt: true,
  user: { select: { id: true, username: true, avatarUrl: true } },
  game: { select: { id: true, title: true, coverUrl: true } },
  company: { select: { id: true, name: true, logoUrl: true } },
  _count: { select: { likes: true, dislikes: true, comments: true } },
} as const;

const actorSelect = { id: true, username: true, avatarUrl: true } as const;

export type FeedActor = { id: number; username: string; avatarUrl: string | null };

// Un événement du feed : soit un avis, soit un « jeu fait ». `at` sert au tri
// chronologique et de curseur « charger plus ». `id` est unique tous types
// confondus (préfixé) pour dédupliquer côté front lors du push temps réel.
export type FeedItem =
  | { id: string; kind: 'review'; at: string; review: unknown }
  | { id: string; kind: 'played'; at: string; actor: FeedActor; game: unknown };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: FeedGateway,
  ) {}

  // IDs des amis acceptés (dans les deux sens de la relation)
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

  // Feed paginé par curseur (timestamp ISO) : les items strictement plus
  // anciens que `cursor`. Fusionne avis + jeux faits des amis, triés par date.
  async getFeed(
    viewerId: number,
    cursor: string | undefined,
    limit = DEFAULT_LIMIT,
  ): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const friends = await this.friendIds(viewerId);
    if (friends.length === 0) return { items: [], nextCursor: null };

    const before = cursor ? new Date(cursor) : undefined;

    // On sur-échantillonne chaque source (limit+1) pour détecter s'il reste
    // des items après fusion/troncature.
    const [reviews, playedRaw] = await Promise.all([
      this.prisma.review.findMany({
        where: { userId: { in: friends }, ...(before && { createdAt: { lt: before } }) },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        select: reviewSelect,
      }),
      this.prisma.playedGame.findMany({
        where: {
          userId: { in: friends },
          status: PlayStatus.PLAYED,
          ...(before && { createdAt: { lt: before } }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          createdAt: true,
          gameId: true,
          userId: true,
          user: { select: actorSelect },
          game: { select: { id: true, title: true, coverUrl: true } },
        },
      }),
    ]);

    // Déduplication : un « jeu fait » dont l'user a aussi écrit un avis est
    // masqué (l'avis, plus riche, le représente déjà).
    const played = await this.dedupePlayed(playedRaw);

    const items: FeedItem[] = [
      ...reviews.map((r) => ({
        id: `review-${r.id}`,
        kind: 'review' as const,
        at: r.createdAt.toISOString(),
        review: r,
      })),
      ...played.map((p) => ({
        id: `played-${p.id}`,
        kind: 'played' as const,
        at: p.createdAt.toISOString(),
        actor: p.user,
        game: p.game,
      })),
    ];

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].at : null;
    return { items: page, nextCursor };
  }

  private async dedupePlayed<
    T extends { userId: number; gameId: number },
  >(rows: T[]): Promise<T[]> {
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

  // ---- Push temps réel (best-effort, jamais bloquant pour l'action) ----

  // Appelé par ReviewsService après création d'un avis
  async onReviewCreated(reviewId: number): Promise<void> {
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: reviewSelect,
      });
      if (!review || !review.user) return;
      const item: FeedItem = {
        id: `review-${review.id}`,
        kind: 'review',
        at: review.createdAt.toISOString(),
        review,
      };
      await this.broadcast(review.user.id, item);
    } catch (err) {
      this.logger.warn(`onReviewCreated failed: ${(err as Error).message}`);
    }
  }

  // Appelé par GamesService quand un jeu passe à « fait » (bouton explicite).
  // Si l'user a déjà un avis sur ce jeu, on n'émet pas (l'avis le représente).
  async onGamePlayed(userId: number, gameId: number): Promise<void> {
    try {
      const hasReview = await this.prisma.review.findFirst({
        where: { userId, gameId },
        select: { id: true },
      });
      if (hasReview) return;
      const row = await this.prisma.playedGame.findUnique({
        where: { userId_gameId: { userId, gameId } },
        select: {
          id: true,
          createdAt: true,
          user: { select: actorSelect },
          game: { select: { id: true, title: true, coverUrl: true } },
        },
      });
      if (!row || !row.user) return;
      const item: FeedItem = {
        id: `played-${row.id}`,
        kind: 'played',
        at: row.createdAt.toISOString(),
        actor: row.user,
        game: row.game,
      };
      await this.broadcast(row.user.id, item);
    } catch (err) {
      this.logger.warn(`onGamePlayed failed: ${(err as Error).message}`);
    }
  }

  // Diffuse un item à tous les amis de l'acteur (pas à l'acteur lui-même)
  private async broadcast(actorId: number, item: FeedItem): Promise<void> {
    const friends = await this.friendIds(actorId);
    for (const id of friends) this.gateway.emitToUser(id, 'feed:new', item);
  }
}
