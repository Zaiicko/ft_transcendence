import { Injectable, Logger } from '@nestjs/common';
import { FriendshipStatus, PlayStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeedGateway } from './feed.gateway';

const actorSelect = { id: true, username: true, avatarUrl: true } as const;
const gameSelect = { id: true, title: true, coverUrl: true } as const;
const companySelect = { id: true, name: true, logoUrl: true } as const;

// Aperçu dénormalisé d'un avis (mêmes champs que ReviewHighlight côté front)
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

// Cible (jeu/studio) minimale pour construire les liens des « likes »
const reviewTargetSelect = {
  id: true,
  title: true,
  user: { select: actorSelect },
  game: { select: gameSelect },
  company: { select: companySelect },
} as const;

export type FeedActor = { id: number; username: string; avatarUrl: string | null };

// Filtre optionnel du feed (onglets en haut de la page). Absent = tout.
export type FeedFilter = 'reviews' | 'played' | 'likes';

// Un événement du feed. `at` sert au tri chronologique et de curseur « charger
// plus ». `id` est unique tous types confondus (préfixé) pour dédupliquer côté
// front lors du push temps réel.
export type FeedItem =
  | { id: string; kind: 'review'; at: string; review: unknown }
  | { id: string; kind: 'played'; at: string; actor: FeedActor; game: unknown }
  | { id: string; kind: 'review-like'; at: string; actor: FeedActor; review: unknown }
  | { id: string; kind: 'comment-like'; at: string; actor: FeedActor; comment: unknown };

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
  // anciens que `cursor`. Fusionne avis, jeux faits et likes des amis. `filter`
  // (onglet) restreint aux sources voulues pour que la pagination reste juste.
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
    const take = limit + 1; // +1 par source pour détecter s'il reste des items
    const wantReviews = !filter || filter === 'reviews';
    const wantPlayed = !filter || filter === 'played';
    const wantLikes = !filter || filter === 'likes';

    // On sur-échantillonne chaque source demandée, on fusionne, on trie, on tronque.
    const [reviews, playedRaw, reviewLikes, commentLikes] = await Promise.all([
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
    ]);

    // Déduplication : un « jeu fait » dont l'user a aussi écrit un avis est
    // masqué (l'avis, plus riche, le représente déjà).
    const played = await this.dedupePlayed(playedRaw);

    const items: FeedItem[] = [
      ...reviews.map((r) => this.reviewItem(r)),
      ...played.map((p) => this.playedItem(p)),
      ...reviewLikes.map((l) => this.reviewLikeItem(l)),
      ...commentLikes.map((l) => this.commentLikeItem(l)),
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

  // ---- Constructeurs d'items (partagés par getFeed et le push temps réel) ----

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

  // ---- Push temps réel (best-effort, jamais bloquant pour l'action) ----

  async onReviewCreated(reviewId: number): Promise<void> {
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: reviewSelect,
      });
      if (!review?.user) return;
      await this.broadcast(review.user.id, this.reviewItem(review));
    } catch (err) {
      this.logger.warn(`onReviewCreated failed: ${(err as Error).message}`);
    }
  }

  // Nouveau jeu « fait » (bouton explicite). Si l'user a déjà un avis sur ce
  // jeu, on n'émet pas (l'avis le représente déjà).
  async onGamePlayed(userId: number, gameId: number): Promise<void> {
    try {
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

  // Un ami a aimé un avis
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

  // Un ami a aimé un commentaire
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

  // Diffuse un item à tous les amis de l'acteur (pas à l'acteur lui-même)
  private async broadcast(actorId: number, item: FeedItem): Promise<void> {
    const friends = await this.friendIds(actorId);
    for (const id of friends) this.gateway.emitToUser(id, 'feed:new', item);
  }
}
