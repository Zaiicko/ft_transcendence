import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { ReviewsService } from './reviews.service';

@Controller('companies/:companyId/reviews')
export class CompanyReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('stats')
  stats(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.reviewsService.getAverageRating({ companyId });
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query() query: ListReviewsDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.reviewsService.findForCompany(
      companyId,
      query.sort,
      query.page,
      query.limit,
      viewer?.sub,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('companyId', ParseIntPipe) companyId: number,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.createForCompany(user.sub, companyId, dto);
  }
}
