import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { HighlightsDto } from './dto/highlights.dto';
import { TranslateReviewDto } from './dto/translate-review.dto';
import { TranslateReviewsDto } from './dto/translate-reviews.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // Must stay above @Get(':id'): Express matches routes in declaration
  // order, ':id' + ParseIntPipe would 400 on the literal "highlights"
  @UseGuards(OptionalJwtAuthGuard)
  @Get('highlights')
  highlights(@Query() query: HighlightsDto, @CurrentUser() viewer?: JwtPayload) {
    return this.reviewsService.highlights(query.days, query.page, query.limit, viewer?.sub);
  }

  // A user's reviews by username, paginated and sorted (recent / popular /
  // discussed): backs "Load more" and the sort control on the profile. Two
  // segments after /reviews, so no collision with @Get(':id').
  @UseGuards(OptionalJwtAuthGuard)
  @Get('user/:username')
  forUser(
    @Param('username') username: string,
    @Query('sort') sort: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    const safeSort = (['recent', 'popular', 'discussed'] as const).includes(
      sort as 'recent' | 'popular' | 'discussed',
    )
      ? (sort as 'recent' | 'popular' | 'discussed')
      : 'recent';
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    return this.reviewsService.findForUsername(username, safeSort, page, safeLimit, viewer?.sub);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() viewer?: JwtPayload) {
    return this.reviewsService.findOne(id, viewer?.sub);
  }

  // On-demand translation of ONE review's title and text into ?lang= — public
  // and cached per language. Two segments, so no collision with @Get(':id').
  @Get(':id/translation')
  translate(@Param('id', ParseIntPipe) id: number, @Query() query: TranslateReviewDto) {
    return this.reviewsService.translateReview(id, query.lang);
  }

  // Batch auto-translation: { ids, lang } -> { [id]: { title, text } }, one
  // request for the whole displayed list. The literal "translations" path can't
  // collide with @Post(':id/like') and friends.
  @Post('translations')
  translateMany(@Body() dto: TranslateReviewsDto) {
    return this.reviewsService.translateReviews(dto.ids, dto.lang);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.update(user.sub, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reviewsService.remove(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  @HttpCode(204)
  like(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reviewsService.like(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  @HttpCode(204)
  unlike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reviewsService.unlike(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/dislike')
  @HttpCode(204)
  dislike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reviewsService.dislike(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/dislike')
  @HttpCode(204)
  undislike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.reviewsService.undislike(user.sub, id);
  }
}
