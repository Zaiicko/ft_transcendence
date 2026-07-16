import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';

type CommentSort = 'top' | 'recent';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };
const withCounts = {
  user: publicAuthor,
  _count: { select: { likes: true, dislikes: true, replies: true } },
};

@Injectable()
export class ReviewCommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, reviewId: number, dto: CreateCommentDto) {
    try {
      return await this.prisma.reviewComment.create({
        data: { text: dto.text, parentId: dto.parentId, userId, reviewId },
      });
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
  findForReview(reviewId: number, sort: CommentSort, page: number, limit: number) {
    return this.prisma.reviewComment.findMany({
      where: { reviewId, parentId: null },
      orderBy: sort === 'top' ? { likes: { _count: 'desc' } } : { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: withCounts,
    });
  }

  findReplies(commentId: number, page: number, limit: number) {
    return this.prisma.reviewComment.findMany({
      where: { parentId: commentId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: withCounts,
    });
  }

  async update(userId: number, id: number, text: string) {
    await this.assertOwner(id, userId);
    return this.prisma.reviewComment.update({ where: { id }, data: { text } });
  }

  async remove(userId: number, id: number) {
    await this.assertOwner(id, userId);
    // onDelete: Cascade on parentId takes care of nested replies
    await this.prisma.reviewComment.delete({ where: { id } });
  }

  async like(userId: number, commentId: number) {
    try {
      await this.prisma.$transaction([
        this.prisma.reviewCommentDislike.deleteMany({ where: { userId, commentId } }),
        this.prisma.reviewCommentLike.create({ data: { userId, commentId } }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Comment not found');
      }
      throw e;
    }
  }

  async unlike(userId: number, commentId: number) {
    await this.prisma.reviewCommentLike.deleteMany({ where: { userId, commentId } });
  }

  async dislike(userId: number, commentId: number) {
    try {
      await this.prisma.$transaction([
        this.prisma.reviewCommentLike.deleteMany({ where: { userId, commentId } }),
        this.prisma.reviewCommentDislike.create({ data: { userId, commentId } }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Comment not found');
      }
      throw e;
    }
  }

  async undislike(userId: number, commentId: number) {
    await this.prisma.reviewCommentDislike.deleteMany({ where: { userId, commentId } });
  }

  private async assertOwner(commentId: number, userId: number) {
    const comment = await this.prisma.reviewComment.findUnique({
      where: { id: commentId },
      select: { userId: true },
    });
    if (!comment) throw new NotFoundException();
    if (comment.userId !== userId) throw new ForbiddenException();
  }
}
