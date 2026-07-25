import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/auth.service';
import { FeedFilter, FeedService } from './feed.service';

const FILTERS: FeedFilter[] = ['reviews', 'played', 'completed', 'likes'];

@UseGuards(JwtAuthGuard)
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  // Feed d'activité des amis (avis + jeux faits + likes), pagination par curseur.
  // `type` optionnel restreint à un onglet (reviews | played | likes).
  @Get()
  getFeed(
    @CurrentUser() current: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : undefined;
    const filter = FILTERS.includes(type as FeedFilter) ? (type as FeedFilter) : undefined;
    return this.feed.getFeed(current.sub, cursor, Number.isFinite(n) ? n : undefined, filter);
  }
}
