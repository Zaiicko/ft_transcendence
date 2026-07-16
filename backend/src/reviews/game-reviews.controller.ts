import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

@Controller('games/:gameId/reviews')
export class GameReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  findAll(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query('sort') sort: 'popular' | 'recent' = 'recent',
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.reviewsService.findForGame(gameId, sort, page, limit);
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
