import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../../auth/auth.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/optional-jwt-auth.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsDto } from './dto/list-comments.dto';
import { ReviewCommentsService } from './review-comments.service';

@Controller('reviews/:reviewId/comments')
export class ReviewCommentsController {
  constructor(private readonly commentsService: ReviewCommentsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @Query() query: ListCommentsDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.commentsService.findForReview(
      reviewId,
      query.sort,
      query.page,
      query.limit,
      viewer?.sub,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(user.sub, reviewId, dto);
  }
}
