import { Controller, Get } from '@nestjs/common';
import { LeaderboardMetric, LeaderboardService } from './leaderboard/leaderboard.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up' };
  }

  // Public home data for signed-out visitors: real site counts plus the top
  // player of EACH leaderboard category. No guard — an open route like
  // /health, read-only.
  @Get('home/landing')
  async landing() {
    const metrics: LeaderboardMetric[] = ['completions', 'played', 'reviews'];
    const [games, reviews, players, ...tops] = await Promise.all([
      this.prisma.game.count(),
      this.prisma.review.count(),
      this.prisma.user.count(),
      ...metrics.map((m) => this.leaderboard.getPublicTop(m, 1)),
    ]);
    // One entry per category that has at least one ranked player.
    const topPlayers = metrics.flatMap((metric, i) => {
      const row = tops[i][0];
      return row ? [{ metric, user: row.user, score: row.score }] : [];
    });
    return { games, reviews, players, topPlayers };
  }
}
