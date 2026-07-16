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

type ReviewSort = 'popular' | 'recent';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, gameId: number, dto: CreateReviewDto) {
    try {
      return await this.prisma.review.create({
        data: { ...dto, userId, gameId },
      });
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

  findForGame(gameId: number, sort: ReviewSort, page: number, limit: number) {
    return this.prisma.review.findMany({
      where: { gameId },
      orderBy: sort === 'popular' ? { likes: { _count: 'desc' } } : { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: publicAuthor,
        _count: { select: { likes: true, dislikes: true, comments: true } },
      },
    });
  }

  async findOne(id: number) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        user: publicAuthor,
        _count: { select: { likes: true, dislikes: true, comments: true } },
      },
    });
    if (!review) throw new NotFoundException();
    return review;
  }

  async update(userId: number, id: number, dto: UpdateReviewDto) {
    await this.assertOwner(id, userId);
    return this.prisma.review.update({ where: { id }, data: dto });
  }

  async remove(userId: number, id: number) {
    await this.assertOwner(id, userId);
    await this.prisma.review.delete({ where: { id } });
  }

  async like(userId: number, reviewId: number) {
    try {
      // Atomic: liking always clears any existing dislike from the same user
      await this.prisma.$transaction([
        this.prisma.reviewDislike.deleteMany({ where: { userId, reviewId } }),
        this.prisma.reviewLike.create({ data: { userId, reviewId } }),
      ]);
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
    await this.prisma.reviewLike.deleteMany({ where: { userId, reviewId } });
  }

  async dislike(userId: number, reviewId: number) {
    try {
      await this.prisma.$transaction([
        this.prisma.reviewLike.deleteMany({ where: { userId, reviewId } }),
        this.prisma.reviewDislike.create({ data: { userId, reviewId } }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') return;
        if (e.code === 'P2003') throw new NotFoundException('Review not found');
      }
      throw e;
    }
  }

  async undislike(userId: number, reviewId: number) {
    await this.prisma.reviewDislike.deleteMany({ where: { userId, reviewId } });
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
      select: { userId: true },
    });
    if (!review) throw new NotFoundException();
    if (review.userId !== userId) throw new ForbiddenException();
  }
}
