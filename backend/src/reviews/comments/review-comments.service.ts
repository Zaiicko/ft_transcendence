import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeedService } from '../../feed/feed.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReviewsGateway } from '../reviews.gateway';
import { CreateCommentDto } from './dto/create-comment.dto';

type CommentSort = 'top' | 'recent';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

const commentInclude = (viewerId?: number): Prisma.ReviewCommentInclude => ({
  user: publicAuthor,
  _count: { select: { likes: true, dislikes: true, replies: true } },
  ...(viewerId
    ? {
        likes: { where: { userId: viewerId }, select: { id: true } },
        dislikes: { where: { userId: viewerId }, select: { id: true } },
      }
    : {}),
});

type ReactionRows = {
  likes?: { id: number }[];
  dislikes?: { id: number }[];
  deletedAt?: Date | null;
};

function toDto<T extends ReactionRows>(row: T) {
  const { likes, dislikes, deletedAt, ...rest } = row;
  return {
    ...rest,
    deleted: Boolean(deletedAt),
    myReaction: likes?.length ? 'like' : dislikes?.length ? 'dislike' : null,
  };
}

// Top-level comment = depth 0; replies allowed down to depth 3
const MAX_REPLY_DEPTH = 3;

@Injectable()
export class ReviewCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ReviewsGateway,
    private readonly notifications: NotificationsService,
    private readonly feed: FeedService,
  ) {}

  async create(userId: number, reviewId: number, dto: CreateCommentDto) {
    if (dto.parentId) {
      const parent = await this.prisma.reviewComment.findUnique({
        where: { id: dto.parentId },
        select: { reviewId: true, parentId: true, deletedAt: true },
      });
      if (!parent || parent.reviewId !== reviewId) {
        throw new BadRequestException('Parent comment does not belong to this review');
      }
      if (parent.deletedAt) {
        throw new BadRequestException('Cannot reply to a deleted comment');
      }
      // Walk up the parent chain: replying to a comment already at max depth
      // is rejected, so threads can't nest forever
      let depth = 1;
      let cursor = parent.parentId;
      while (cursor !== null) {
        depth++;
        if (depth > MAX_REPLY_DEPTH) {
          throw new BadRequestException(`Reply depth is limited to ${MAX_REPLY_DEPTH}`);
        }
        const up = await this.prisma.reviewComment.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = up?.parentId ?? null;
      }
    }
    try {
      const comment = await this.prisma.reviewComment.create({
        data: { text: dto.text, parentId: dto.parentId, userId, reviewId },
      });
      await this.emitChanged(reviewId);
      await this.notifications.commentPosted(userId, reviewId, comment.id, dto.parentId ?? null);
      return comment;
    } catch (e) {
      // P2003 = foreign key violation (review, parent comment or user missing)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new NotFoundException('Review, parent comment or user not found');
      }
      throw e;
    }
  }

  // Top-level comments only — the mockup shows the review's top comment
  // (most liked) collapsed, with replies fetched separately on demand.
  async findForReview(
    reviewId: number,
    sort: CommentSort,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    if (sort === 'top') return this.findForReviewByScore(reviewId, page, limit, viewerId);
    const rows = await this.prisma.reviewComment.findMany({
      where: { reviewId, parentId: null },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: commentInclude(viewerId),
    });
    return rows.map(toDto);
  }

  // "Top" = net score (likes - dislikes), same two-step raw-SQL pattern
  // as ReviewsService.findForGameByScore
  private async findForReviewByScore(
    reviewId: number,
    page: number,
    limit: number,
    viewerId?: number,
  ) {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT c.id
      FROM "ReviewComment" c
      LEFT JOIN (SELECT "commentId", COUNT(*) AS n FROM "ReviewCommentLike" GROUP BY "commentId") l
        ON l."commentId" = c.id
      LEFT JOIN (SELECT "commentId", COUNT(*) AS n FROM "ReviewCommentDislike" GROUP BY "commentId") d
        ON d."commentId" = c.id
      WHERE c."reviewId" = ${reviewId} AND c."parentId" IS NULL
      ORDER BY COALESCE(l.n, 0) - COALESCE(d.n, 0) DESC, c."createdAt" ASC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const comments = await this.prisma.reviewComment.findMany({
      where: { id: { in: ids } },
      include: commentInclude(viewerId),
    });
    const byId = new Map(comments.map((c) => [c.id, toDto(c)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async findReplies(commentId: number, page: number, limit: number, viewerId?: number) {
    const rows = await this.prisma.reviewComment.findMany({
      where: { parentId: commentId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: commentInclude(viewerId),
    });
    return rows.map(toDto);
  }

  async update(userId: number, id: number, text: string) {
    const { reviewId } = await this.assertOwner(id, userId);
    const comment = await this.prisma.reviewComment.update({ where: { id }, data: { text } });
    await this.emitChanged(reviewId);
    return comment;
  }

  async remove(userId: number, id: number) {
    const { reviewId } = await this.assertOwner(id, userId);
    await this.removeOrTombstone(id);
    await this.emitChanged(reviewId);
  }

  // Moderation path (ReportsService, after an admin resolves a report with
  // action=delete) — same tombstone-or-hard-delete behaviour as remove(),
  // skipping the ownership check.
  async removeAsAdmin(id: number) {
    const comment = await this.prisma.reviewComment.findUnique({
      where: { id },
      select: { reviewId: true },
    });
    if (!comment) throw new NotFoundException();
    await this.removeOrTombstone(id);
    await this.emitChanged(comment.reviewId);
  }

  // Reddit-style: a comment with replies becomes an anonymous tombstone so the
  // thread below survives; a leaf is really deleted, after which ancestor
  // tombstones left without children are pruned.
  private async removeOrTombstone(id: number) {
    const replies = await this.prisma.reviewComment.count({ where: { parentId: id } });
    if (replies > 0) {
      await this.prisma.$transaction([
        this.prisma.reviewCommentLike.deleteMany({ where: { commentId: id } }),
        this.prisma.reviewCommentDislike.deleteMany({ where: { commentId: id } }),
        this.prisma.reviewComment.update({
          where: { id },
          data: { deletedAt: new Date(), text: '', userId: null },
        }),
      ]);
      return;
    }
    let cursor: number | null = id;
    while (cursor !== null) {
      const row: { parentId: number | null } | null =
        await this.prisma.reviewComment.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      await this.prisma.reviewComment.delete({ where: { id: cursor } });
      const parentId: number | null = row?.parentId ?? null;
      if (parentId === null) return;
      const parent = await this.prisma.reviewComment.findUnique({
        where: { id: parentId },
        select: { deletedAt: true },
      });
      if (!parent?.deletedAt) return;
      const siblings = await this.prisma.reviewComment.count({ where: { parentId } });
      if (siblings > 0) return;
      cursor = parentId;
    }
  }

  async like(userId: number, commentId: number) {
    await this.assertAlive(commentId);
    try {
      await this.prisma.$transaction([
        this.prisma.reviewCommentDislike.deleteMany({ where: { userId, commentId } }),
        this.prisma.reviewCommentLike.create({ data: { userId, commentId } }),
      ]);
      await this.emitReaction(commentId);
      void this.feed.onCommentLiked(userId, commentId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Comment not found');
      }
      throw e;
    }
  }

  async unlike(userId: number, commentId: number) {
    const { count } = await this.prisma.reviewCommentLike.deleteMany({
      where: { userId, commentId },
    });
    if (count > 0) await this.emitReaction(commentId);
  }

  async dislike(userId: number, commentId: number) {
    await this.assertAlive(commentId);
    try {
      await this.prisma.$transaction([
        this.prisma.reviewCommentLike.deleteMany({ where: { userId, commentId } }),
        this.prisma.reviewCommentDislike.create({ data: { userId, commentId } }),
      ]);
      await this.emitReaction(commentId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Comment not found');
      }
      throw e;
    }
  }

  async undislike(userId: number, commentId: number) {
    const { count } = await this.prisma.reviewCommentDislike.deleteMany({
      where: { userId, commentId },
    });
    if (count > 0) await this.emitReaction(commentId);
  }

  // No reacting on a tombstone — its reactions were already purged
  private async assertAlive(commentId: number) {
    const comment = await this.prisma.reviewComment.findUnique({
      where: { id: commentId },
      select: { deletedAt: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.deletedAt) throw new BadRequestException('Comment deleted');
  }

  private async assertOwner(commentId: number, userId: number) {
    const comment = await this.prisma.reviewComment.findUnique({
      where: { id: commentId },
      select: { userId: true, reviewId: true },
    });
    if (!comment) throw new NotFoundException();
    if (comment.userId !== userId) throw new ForbiddenException();
    return comment;
  }

  private async emitChanged(reviewId: number) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { gameId: true, companyId: true },
    });
    if (review) this.gateway.emitToTarget(review, 'comment:changed', { reviewId });
  }

  // Reactions ship the fresh counts (in-place button patch client-side);
  // structural changes (create/update/delete) keep the coarser emitChanged
  private async emitReaction(commentId: number) {
    const comment = await this.prisma.reviewComment.findUnique({
      where: { id: commentId },
      select: {
        reviewId: true,
        review: { select: { gameId: true, companyId: true } },
        _count: { select: { likes: true, dislikes: true } },
      },
    });
    if (comment) {
      this.gateway.emitToTarget(comment.review, 'comment:reaction', {
        reviewId: comment.reviewId,
        commentId,
        likes: comment._count.likes,
        dislikes: comment._count.dislikes,
      });
    }
  }
}
