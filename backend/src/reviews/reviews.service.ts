import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsGateway } from './reviews.gateway';

type ReviewSort = 'popular' | 'recent' | 'discussed';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

// When a viewer is known, also fetch THEIR reaction rows (0 or 1 each) —
// turned into a `myReaction` field by toDto below
const reviewInclude = (viewerId?: number): Prisma.ReviewInclude => ({
  user: publicAuthor,
  _count: { select: { likes: true, dislikes: true, comments: true } },
  ...(viewerId
    ? {
        likes: { where: { userId: viewerId }, select: { id: true } },
        dislikes: { where: { userId: viewerId }, select: { id: true } },
      }
    : {}),
});

type ReactionRows = { likes?: { id: number }[]; dislikes?: { id: number }[] };

function toDto<T extends ReactionRows>(row: T) {
  const { likes, dislikes, ...rest } = row;
  return {
    ...rest,
    myReaction: likes?.length ? 'like' : dislikes?.length ? 'dislike' : null,
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ReviewsGateway,
  ) {}

  async create(userId: number, gameId: number, dto: CreateReviewDto) {
    try {
      const review = await this.prisma.review.create({
        data: { ...dto, userId, gameId },
        include: {
          user: publicAuthor,
          _count: { select: { likes: true, dislikes: true, comments: true } },
        },
      });
      this.gateway.emitToGame(gameId, 'review:created', review);
      return review;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // P2002 = unique constraint violation (@@unique([userId, gameId]))
        if (e.code === 'P2002') throw new ConflictException('You already reviewed this game');
        // P2003 = foreign key violation (user or game does not exist)
        if (e.code === 'P2003') throw new NotFoundException('User or game not found');
      }
      throw e;
    }
  }

  async findForGame(
    gameId: number,
    sort: ReviewSort,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    // Net score (likes - dislikes) is beyond Prisma's orderBy — raw SQL path
    if (sort === 'popular') return this.findForGameByScore(gameId, page, limit, viewerId);
    const rows = await this.prisma.review.findMany({
      where: { gameId },
      orderBy:
        sort === 'discussed'
          ? { comments: { _count: 'desc' } } // counts replies too (same reviewId)
          : { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: reviewInclude(viewerId),
    });
    return rows.map(toDto);
  }

  // Two-step scored listing: SQL computes the ordered page of ids
  // (parameterized — the template tag binds values, no injection), then
  // Prisma loads those ids with their relations and we restore the order.
  private async findForGameByScore(
    gameId: number,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT r.id
      FROM "Review" r
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewLike" GROUP BY "reviewId") l
        ON l."reviewId" = r.id
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewDislike" GROUP BY "reviewId") d
        ON d."reviewId" = r.id
      WHERE r."gameId" = ${gameId}
      ORDER BY COALESCE(l.n, 0) - COALESCE(d.n, 0) DESC, r."createdAt" DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const reviews = await this.prisma.review.findMany({
      where: { id: { in: ids } },
      include: reviewInclude(viewerId),
    });
    const byId = new Map(reviews.map((r) => [r.id, toDto(r)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async findOne(id: number, viewerId?: number) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        ...reviewInclude(viewerId),
        game: { select: { id: true, title: true, coverUrl: true } },
      },
    });
    if (!review) throw new NotFoundException();
    return toDto(review);
  }

  async update(userId: number, id: number, dto: UpdateReviewDto) {
    const { gameId } = await this.assertOwner(id, userId);
    const review = await this.prisma.review.update({ where: { id }, data: dto });
    this.gateway.emitToGame(gameId, 'review:updated', { reviewId: id });
    return review;
  }

  async remove(userId: number, id: number) {
    const { gameId } = await this.assertOwner(id, userId);
    await this.prisma.review.delete({ where: { id } });
    this.gateway.emitToGame(gameId, 'review:deleted', { reviewId: id });
  }

  async like(userId: number, reviewId: number) {
    try {
      // Atomic: liking always clears any existing dislike from the same user
      await this.prisma.$transaction([
        this.prisma.reviewDislike.deleteMany({ where: { userId, reviewId } }),
        this.prisma.reviewLike.create({ data: { userId, reviewId } }),
      ]);
      await this.emitReaction(reviewId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // Already liked — idempotent, not an error
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Review not found');
      }
      throw e;
    }
  }

  async unlike(userId: number, reviewId: number) {
    const { count } = await this.prisma.reviewLike.deleteMany({ where: { userId, reviewId } });
    if (count > 0) await this.emitReaction(reviewId);
  }

  async dislike(userId: number, reviewId: number) {
    try {
      await this.prisma.$transaction([
        this.prisma.reviewLike.deleteMany({ where: { userId, reviewId } }),
        this.prisma.reviewDislike.create({ data: { userId, reviewId } }),
      ]);
      await this.emitReaction(reviewId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Review not found');
      }
      throw e;
    }
  }

  async undislike(userId: number, reviewId: number) {
    const { count } = await this.prisma.reviewDislike.deleteMany({ where: { userId, reviewId } });
    if (count > 0) await this.emitReaction(reviewId);
  }

  // The event carries the fresh counts so clients can patch the two buttons
  // in place — no refetch, no DOM teardown, no flicker
  private async emitReaction(reviewId: number) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { gameId: true, _count: { select: { likes: true, dislikes: true } } },
    });
    if (review) {
      this.gateway.emitToGame(review.gameId, 'review:reaction', {
        reviewId,
        likes: review._count.likes,
        dislikes: review._count.dislikes,
      });
    }
  }

  // Called by the future games module for the fiche jeu's average rating
  getGameAverageRating(gameId: number) {
    return this.prisma.review.aggregate({
      where: { gameId },
      _avg: { rating: true },
      _count: true,
    });
  }

  private async assertOwner(reviewId: number, userId: number) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { userId: true, gameId: true },
    });
    if (!review) throw new NotFoundException();
    if (review.userId !== userId) throw new ForbiddenException();
    return review;
  }
}
