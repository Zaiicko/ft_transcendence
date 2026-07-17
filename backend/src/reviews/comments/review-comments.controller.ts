import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OptionalUser } from '../../auth/optional-user.decorator';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsDto } from './dto/list-comments.dto';
import { ReviewCommentsService } from './review-comments.service';

@Controller('reviews/:reviewId/comments')
export class ReviewCommentsController {
  constructor(private readonly commentsService: ReviewCommentsService) {}

  @Get()
  findAll(
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @Query() query: ListCommentsDto,
    @OptionalUser() viewer?: { id: number },
  ) {
    return this.commentsService.findForReview(
      reviewId,
      query.sort,
      query.page,
      query.limit,
      viewer?.id,
    );
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
