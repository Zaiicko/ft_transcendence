import {
  Body,
  Controller,
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

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() viewer?: JwtPayload) {
    return this.reviewsService.findOne(id, viewer?.sub);
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
