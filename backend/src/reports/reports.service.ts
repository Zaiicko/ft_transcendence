import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewCommentsService } from '../reviews/comments/review-comments.service';
import { ReviewsService } from '../reviews/reviews.service';
import { CreateReportDto } from './dto/create-report.dto';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private reviewsService: ReviewsService,
    private commentsService: ReviewCommentsService,
  ) {}

  async create(reporterId: number, dto: CreateReportDto) {
    if (dto.targetType === 'REVIEW') {
      if (!dto.reviewId) throw new BadRequestException('reviewId is required');
      const review = await this.prisma.review.findUnique({
        where: { id: dto.reviewId },
        select: { userId: true },
      });
      if (!review) throw new NotFoundException();
      if (review.userId === reporterId) {
        throw new ForbiddenException("You can't report your own review");
      }
    } else {
      if (!dto.commentId) throw new BadRequestException('commentId is required');
      const comment = await this.prisma.reviewComment.findUnique({
        where: { id: dto.commentId },
        select: { userId: true, deletedAt: true },
      });
      if (!comment || comment.deletedAt) throw new NotFoundException();
      if (comment.userId === reporterId) {
        throw new ForbiddenException("You can't report your own comment");
      }
    }

    try {
      return await this.prisma.report.create({
        data: {
          reporterId,
          targetType: dto.targetType,
          reviewId: dto.targetType === 'REVIEW' ? dto.reviewId : null,
          commentId: dto.targetType === 'COMMENT' ? dto.commentId : null,
          reason: dto.reason,
          details: dto.details,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('You already reported this');
      }
      throw e;
    }
  }

  list(status: ReportStatus) {
    return this.prisma.report.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: {
        reporter: publicAuthor,
        review: {
          select: {
            id: true,
            title: true,
            text: true,
            rating: true,
            gameId: true,
            companyId: true,
            user: publicAuthor,
          },
        },
        comment: {
          select: {
            id: true,
            text: true,
            reviewId: true,
            user: publicAuthor,
            review: { select: { gameId: true, companyId: true } },
          },
        },
      },
    });
  }

  async resolve(adminId: number, id: number, action: 'delete' | 'dismiss') {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException();
    if (report.status !== 'PENDING') throw new ForbiddenException('Already resolved');

    // Mark this report + any other PENDING report on the SAME target
    // resolved FIRST, while reviewId/commentId still points at a live row —
    // deleting the content below SetNulls that FK (Report.review/comment is
    // onDelete: SetNull, precisely so the record survives), which would
    // otherwise make this updateMany's WHERE match nothing if run after.
    await this.prisma.report.updateMany({
      where: {
        status: 'PENDING',
        ...(report.reviewId ? { reviewId: report.reviewId } : { commentId: report.commentId }),
      },
      data: {
        status: action === 'delete' ? 'RESOLVED' : 'DISMISSED',
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    if (action === 'delete') {
      // The content may already be gone (author deleted it in the meantime)
      // — the report is still resolved either way.
      if (report.targetType === 'REVIEW' && report.reviewId) {
        await this.reviewsService.removeAsAdmin(report.reviewId).catch(swallowNotFound);
      } else if (report.targetType === 'COMMENT' && report.commentId) {
        await this.commentsService.removeAsAdmin(report.commentId).catch(swallowNotFound);
      }
    }

    return { ok: true };
  }
}

function swallowNotFound(e: unknown) {
  if (!(e instanceof NotFoundException)) throw e;
}
