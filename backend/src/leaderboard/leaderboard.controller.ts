import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/auth.service';
import {
  LeaderboardMetric,
  LeaderboardScope,
  LeaderboardService,
  LeaderboardWindow,
} from './leaderboard.service';

const METRICS: LeaderboardMetric[] = ['completions', 'played', 'reviews'];
const SCOPES: LeaderboardScope[] = ['friends', 'global'];
const WINDOWS: LeaderboardWindow[] = ['all', 'month'];

@UseGuards(JwtAuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  // Player ranking by metric / scope / window. Invalid parameters fall back to
  // the defaults (completions / friends / all).
  @Get()
  get(
    @CurrentUser() current: JwtPayload,
    @Query('metric') metric?: string,
    @Query('scope') scope?: string,
    @Query('window') window?: string,
    @Query('limit') limit?: string,
  ) {
    const m = METRICS.includes(metric as LeaderboardMetric)
      ? (metric as LeaderboardMetric)
      : 'completions';
    const s = SCOPES.includes(scope as LeaderboardScope)
      ? (scope as LeaderboardScope)
      : 'global';
    const w = WINDOWS.includes(window as LeaderboardWindow)
      ? (window as LeaderboardWindow)
      : 'all';
    const n = limit ? parseInt(limit, 10) : undefined;
    return this.leaderboard.getLeaderboard(
      current.sub,
      m,
      s,
      w,
      Number.isFinite(n) ? n : undefined,
    );
  }

  // A user's ranking awards (global all-time podiums), shown as a badge next to
  // their username. Distinct path from the root @Get().
  @Get('badges/:userId')
  badges(@Param('userId', ParseIntPipe) userId: number) {
    return this.leaderboard.getRankBadges(userId);
  }
}
