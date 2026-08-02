import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { ReviewsService } from './reviews.service';

@Controller('games/:gameId/reviews')
export class GameReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('stats')
  stats(@Param('gameId', ParseIntPipe) gameId: number) {
    return this.reviewsService.getAverageRating({ gameId });
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: ListReviewsDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.reviewsService.findForGame(
      gameId,
      query.sort,
      query.page,
      query.limit,
      viewer?.sub,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('gameId', ParseIntPipe) gameId: number,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(user.sub, gameId, dto);
  }
}
