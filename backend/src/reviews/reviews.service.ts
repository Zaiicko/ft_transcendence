import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlayStatus, Prisma } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../translation/translation.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsGateway, ReviewTarget } from './reviews.gateway';

type ReviewSort = 'popular' | 'recent' | 'discussed';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

// When a viewer is known, also fetch THEIR reaction rows (0 or 1 each) —
// turned into a `myReaction` field by toDto below
const reviewInclude = (viewerId?: number): Prisma.ReviewInclude => ({
  user: publicAuthor,
  // comments is filtered: "[deleted]" tombstones don't count in the counter
  _count: {
    select: { likes: true, dislikes: true, comments: { where: { deletedAt: null } } },
  },
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
    private readonly notifications: NotificationsService,
    private readonly feed: FeedService,
    private readonly translation: TranslationService,
    private readonly achievements: AchievementsService,
  ) {}

  // On-demand translation (Translate button) of a review's title and text into
  // `lang`, cached per (review, language). The source language is auto-detected,
  // since a review can be written in any of them. When the review is already in
  // the target language the result comes back nearly identical, which the front
  // detects to offer "see original".
  async translateReview(id: number, lang: string): Promise<{ title: string; text: string }> {
    const cached = await this.prisma.reviewTranslation.findUnique({
      where: { reviewId_language: { reviewId: id, language: lang } },
    });
    if (cached) return { title: cached.title, text: cached.text };

    const review = await this.prisma.review.findUnique({
      where: { id },
      select: { title: true, text: true },
    });
    if (!review) throw new NotFoundException(`Review ${id} not found`);

    const [title, text] = await Promise.all([
      this.translation.translate(review.title, lang, null),
      this.translation.translate(review.text, lang, null),
    ]);
    await this.prisma.reviewTranslation.upsert({
      where: { reviewId_language: { reviewId: id, language: lang } },
      create: { reviewId: id, language: lang, title, text },
      update: { title, text },
    });
    return { title, text };
  }

  // Batch translation: cached ones in a single query, missing ones translated
  // SEQUENTIALLY to stay under DeepL's rate limit. A review that fails is simply
  // absent from the result and the front keeps the original.
  async translateReviews(
    ids: number[],
    lang: string,
  ): Promise<Record<number, { title: string; text: string }>> {
    const result: Record<number, { title: string; text: string }> = {};
    const cached = await this.prisma.reviewTranslation.findMany({
      where: { language: lang, reviewId: { in: ids } },
      select: { reviewId: true, title: true, text: true },
    });
    for (const c of cached) result[c.reviewId] = { title: c.title, text: c.text };

    for (const id of ids) {
      if (result[id]) continue;
      try {
        result[id] = await this.translateReview(id, lang);
      } catch {
        /* quota / réseau / avis absent : on saute, le front garde l'original */
      }
    }
    return result;
  }

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
        include: reviewInclude(),
      });
      this.gateway.emitToTarget(target, 'review:created', review);
      // Push the review to friends' activity feed (best-effort)
      void this.feed.onReviewCreated(review.id);
      // Reviewing a game implies you played it: mark it PLAYED (idempotent —
      // keep the original date if already marked, so the completion calendar
      // doesn't drift). Studio reviews have no "played" notion.
      if (target.gameId) await this.ensurePlayed(userId, target.gameId);
      // Achievements: review written, plus studio fan and favourite/harsh
      // depending on the rating.
      void this.achievements.evaluate(userId, ['reviews', 'studio', 'favorite', 'harsh']);
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

  // Mark a game PLAYED for a user, keeping the original playedAt if it was
  // already marked (same idempotence rule as GamesService.markPlayed).
  private async ensurePlayed(userId: number, gameId: number) {
    const current = await this.prisma.playedGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { status: true },
    });
    if (current?.status === PlayStatus.PLAYED) return;
    await this.prisma.playedGame.upsert({
      where: { userId_gameId: { userId, gameId } },
      update: { status: PlayStatus.PLAYED, playedAt: new Date() },
      create: { userId, gameId, status: PlayStatus.PLAYED, playedAt: new Date() },
    });
  }

  async findForGame(
    gameId: number,
    sort: ReviewSort,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    // Net score and tombstone-filtered "discussed" are beyond Prisma's orderBy,
    // so both take a raw SQL path
    if (sort === 'popular') return this.findByScore({ gameId }, page, limit, viewerId);
    if (sort === 'discussed') return this.findByDiscussed({ gameId }, page, limit, viewerId);
    const rows = await this.prisma.review.findMany({
      where: { gameId },
      orderBy: { createdAt: 'desc' },
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
    if (sort === 'discussed') return this.findByDiscussed({ companyId }, page, limit, viewerId);
    const rows = await this.prisma.review.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: reviewInclude(viewerId),
    });
    return rows.map(toDto);
  }

  // Two-step scored listing: SQL computes the ordered page of ids
  // (parameterized — the template tag binds values, no injection), then
  // Prisma loads those ids with their relations and we restore the order.
  private async findByScore(
    target: { gameId?: number; companyId?: number },
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
      WHERE ${this.targetFilter(target)}
      ORDER BY COALESCE(l.n, 0) - COALESCE(d.n, 0) DESC, r."createdAt" DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    return this.loadOrdered(rows.map((r) => r.id), viewerId);
  }

  // "Discussed" ranks on VISIBLE comments (tombstones excluded), matching the
  // counter shown in the UI — one story on both sides
  private async findByDiscussed(
    target: { gameId?: number; companyId?: number },
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT r.id
      FROM "Review" r
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewComment"
                 WHERE "deletedAt" IS NULL GROUP BY "reviewId") c
        ON c."reviewId" = r.id
      WHERE ${this.targetFilter(target)}
      ORDER BY COALESCE(c.n, 0) DESC, r."createdAt" DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    return this.loadOrdered(rows.map((r) => r.id), viewerId);
  }

  private targetFilter(target: { gameId?: number; companyId?: number; userId?: number }) {
    if (target.userId) return Prisma.sql`r."userId" = ${target.userId}`;
    return target.gameId
      ? Prisma.sql`r."gameId" = ${target.gameId}`
      : Prisma.sql`r."companyId" = ${target.companyId}`;
  }

  // Resolves the username then delegates to findForUser ([] when unknown).
  async findForUsername(
    username: string,
    sort: ReviewSort,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { usernameLower: username.toLowerCase() },
      select: { id: true },
    });
    if (!user) return [];
    return this.findForUser(user.id, sort, page, limit, viewerId);
  }

  // A user's reviews across every game and studio, for their profile. Each one
  // carries its target (like highlights) so it can render away from that page.
  // Same sorts as the game page: recent / popular / discussed.
  private async findForUser(
    userId: number,
    sort: ReviewSort,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    let ids: number[];
    if (sort === 'popular') {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT r.id
        FROM "Review" r
        LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewLike" GROUP BY "reviewId") l
          ON l."reviewId" = r.id
        LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewDislike" GROUP BY "reviewId") d
          ON d."reviewId" = r.id
        WHERE ${this.targetFilter({ userId })}
        ORDER BY COALESCE(l.n, 0) - COALESCE(d.n, 0) DESC, r."createdAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
      ids = rows.map((r) => r.id);
    } else if (sort === 'discussed') {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT r.id
        FROM "Review" r
        LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewComment"
                   WHERE "deletedAt" IS NULL GROUP BY "reviewId") c
          ON c."reviewId" = r.id
        WHERE ${this.targetFilter({ userId })}
        ORDER BY COALESCE(c.n, 0) DESC, r."createdAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
      ids = rows.map((r) => r.id);
    } else {
      const rows = await this.prisma.review.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true },
      });
      ids = rows.map((r) => r.id);
    }
    if (ids.length === 0) return [];
    const reviews = await this.prisma.review.findMany({
      where: { id: { in: ids } },
      include: {
        ...reviewInclude(viewerId),
        game: { select: { id: true, title: true, coverUrl: true } },
        company: { select: { id: true, name: true, logoUrl: true } },
      },
    });
    const byId = new Map(reviews.map((r) => [r.id, toDto(r)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  private async loadOrdered(ids: number[], viewerId?: number) {
    if (ids.length === 0) return [];
    const reviews = await this.prisma.review.findMany({
      where: { id: { in: ids } },
      include: reviewInclude(viewerId),
    });
    const byId = new Map(reviews.map((r) => [r.id, toDto(r)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  // Cross-catalog feed for the home page: top-scored recent reviews (text
  // only — a bare rating has nothing to say there), each carrying its
  // game/company so the card can be rendered outside any target page
  async highlights(days: number, page: number, limit: number, viewerId?: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT r.id
      FROM "Review" r
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewLike" GROUP BY "reviewId") l
        ON l."reviewId" = r.id
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewDislike" GROUP BY "reviewId") d
        ON d."reviewId" = r.id
      LEFT JOIN (SELECT "reviewId", COUNT(*) AS n FROM "ReviewComment"
                 WHERE "deletedAt" IS NULL GROUP BY "reviewId") c
        ON c."reviewId" = r.id
      WHERE r."createdAt" >= ${since} AND r.text IS NOT NULL AND r.text <> ''
      ORDER BY COALESCE(l.n, 0) - COALESCE(d.n, 0) DESC,
               COALESCE(c.n, 0) DESC, r."createdAt" DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const reviews = await this.prisma.review.findMany({
      where: { id: { in: ids } },
      include: {
        ...reviewInclude(viewerId),
        game: { select: { id: true, title: true, coverUrl: true } },
        company: { select: { id: true, name: true, logoUrl: true } },
      },
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
    // The content changed, so cached translations are stale: drop them and let
    // the next "Translate" click regenerate them.
    await this.prisma.reviewTranslation.deleteMany({ where: { reviewId: id } });
    this.gateway.emitToTarget(target, 'review:updated', { reviewId: id });
    // The rating may have changed: re-evaluate favourite / harsh.
    void this.achievements.evaluate(userId, ['favorite', 'harsh']);
    return review;
  }

  async remove(userId: number, id: number) {
    const target = await this.assertOwner(id, userId);
    await this.prisma.review.delete({ where: { id } });
    this.gateway.emitToTarget(target, 'review:deleted', { reviewId: id });
  }

  // Moderation path (ReportsService, after an admin resolves a report with
  // action=delete) — same effect as remove() but skips the ownership check.
  async removeAsAdmin(id: number) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      select: { gameId: true, companyId: true },
    });
    if (!review) throw new NotFoundException();
    await this.prisma.review.delete({ where: { id } });
    this.gateway.emitToTarget(review, 'review:deleted', { reviewId: id });
  }

  async like(userId: number, reviewId: number) {
    try {
      // Atomic: liking always clears any existing dislike from the same user
      await this.prisma.$transaction([
        this.prisma.reviewDislike.deleteMany({ where: { userId, reviewId } }),
        this.prisma.reviewLike.create({ data: { userId, reviewId } }),
      ]);
      await this.emitReaction(reviewId);
      await this.notifications.reviewLiked(userId, reviewId);
      void this.feed.onReviewLiked(userId, reviewId);
      // "Popular" goes to the review's AUTHOR, who earned the like.
      const author = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: { userId: true },
      });
      if (author?.userId) void this.achievements.evaluate(author.userId, ['popular']);
      // ...and "supporter" goes to whoever gave it.
      void this.achievements.evaluate(userId, ['supporter']);
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
  async getAverageRating(target: { gameId?: number; companyId?: number }) {
    const where = target.gameId ? { gameId: target.gameId } : { companyId: target.companyId };
    const [agg, grouped] = await Promise.all([
      this.prisma.review.aggregate({ where, _avg: { rating: true }, _count: true }),
      // 0-10 rating spread for the game page histogram.
      this.prisma.review.groupBy({ by: ['rating'], where, _count: true }),
    ]);
    const distribution = Array<number>(11).fill(0);
    for (const g of grouped) distribution[g.rating] = g._count;
    return { _avg: agg._avg, _count: agg._count, distribution };
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
