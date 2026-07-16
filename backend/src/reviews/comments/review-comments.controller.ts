import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ReviewCommentsService } from './review-comments.service';

@Controller('reviews/:reviewId/comments')
export class ReviewCommentsController {
  constructor(private readonly commentsService: ReviewCommentsService) {}

  @Get()
  findAll(
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @Query('sort') sort: 'top' | 'recent' = 'top',
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.commentsService.findForReview(reviewId, sort, page, limit);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @CurrentUser() user: { id: number },
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(user.id, reviewId, dto);
  }
}
