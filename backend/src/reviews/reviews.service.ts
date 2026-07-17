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
import { ReviewsGateway, ReviewTarget } from './reviews.gateway';

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

  create(userId: number, gameId: number, dto: CreateReviewDto) {
    return this.createForTarget(userId, { gameId, companyId: null }, dto);
  }

  createForCompany(userId: number, companyId: number, dto: CreateReviewDto) {
    return this.createForTarget(userId, { gameId: null, companyId }, dto);
  }

  private async createForTarget(userId: number, target: ReviewTarget, dto: CreateReviewDto) {
    try {
      const review = await this.prisma.review.create({
        data: { ...dto, userId, gameId: target.gameId, companyId: target.companyId },
        include: {
          user: publicAuthor,
          _count: { select: { likes: true, dislikes: true, comments: true } },
        },
      });
      this.gateway.emitToTarget(target, 'review:created', review);
      return review;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // P2002 = unique constraint violation (one review per user per target)
        if (e.code === 'P2002')
          throw new ConflictException(
            target.gameId ? 'You already reviewed this game' : 'You already reviewed this studio',
          );
        // P2003 = foreign key violation (user or target does not exist)
        if (e.code === 'P2003') throw new NotFoundException('User or target not found');
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

  async findForCompany(
    companyId: number,
    sort: ReviewSort,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    if (sort === 'popular') return this.findByScore({ companyId }, page, limit, viewerId);
    const rows = await this.prisma.review.findMany({
      where: { companyId },
      orderBy:
        sort === 'discussed' ? { comments: { _count: 'desc' } } : { createdAt: 'desc' },
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
    return this.findByScore({ gameId }, page, limit, viewerId);
  }

  private async findByScore(
    target: { gameId?: number; companyId?: number },
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    const targetFilter = target.gameId
      ? Prisma.sql`r."gameId" = ${target.gameId}`
      : Prisma.sql`r."companyId" = ${target.companyId}`;
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT r.id
      FROM "Review" r
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewLike" GROUP BY "reviewId") l
        ON l."reviewId" = r.id
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewDislike" GROUP BY "reviewId") d
        ON d."reviewId" = r.id
      WHERE ${targetFilter}
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
        company: { select: { id: true, name: true, logoUrl: true } },
      },
    });
    if (!review) throw new NotFoundException();
    return toDto(review);
  }

  async update(userId: number, id: number, dto: UpdateReviewDto) {
    const target = await this.assertOwner(id, userId);
    const review = await this.prisma.review.update({ where: { id }, data: dto });
    this.gateway.emitToTarget(target, 'review:updated', { reviewId: id });
    return review;
  }

  async remove(userId: number, id: number) {
    const target = await this.assertOwner(id, userId);
    await this.prisma.review.delete({ where: { id } });
    this.gateway.emitToTarget(target, 'review:deleted', { reviewId: id });
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
      select: {
        gameId: true,
        companyId: true,
        _count: { select: { likes: true, dislikes: true } },
      },
    });
    if (review) {
      this.gateway.emitToTarget(review, 'review:reaction', {
        reviewId,
        likes: review._count.likes,
        dislikes: review._count.dislikes,
      });
    }
  }

  // Called by the future games module for the fiche jeu's average rating
  // Community score for a game or studio page — plain mean + count. The
  // count gives the reader the confidence context; the catalog-wide ranking
  // uses the games module's bayesian blend instead.
  getAverageRating(target: { gameId?: number; companyId?: number }) {
    return this.prisma.review.aggregate({
      where: target.gameId ? { gameId: target.gameId } : { companyId: target.companyId },
      _avg: { rating: true },
      _count: true,
    });
  }

  private async assertOwner(reviewId: number, userId: number) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { userId: true, gameId: true, companyId: true },
    });
    if (!review) throw new NotFoundException();
    if (review.userId !== userId) throw new ForbiddenException();
    return review;
  }
}
