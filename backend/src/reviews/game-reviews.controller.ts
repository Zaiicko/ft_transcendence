import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalUser } from '../auth/optional-user.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { ReviewsService } from './reviews.service';

@Controller('games/:gameId/reviews')
export class GameReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  findAll(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: ListReviewsDto,
    @OptionalUser() viewer?: { id: number },
  ) {
    return this.reviewsService.findForGame(gameId, query.sort, query.page, query.limit, viewer?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('gameId', ParseIntPipe) gameId: number,
    @CurrentUser() user: { id: number },
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(user.id, gameId, dto);
  }
}
