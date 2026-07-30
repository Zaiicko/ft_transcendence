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

  // Données publiques de la home (visiteur anonyme) : chiffres réels du site +
  // le n°1 de CHAQUE catégorie de classement. Pas de guard (route ouverte, comme
  // /health). Lecture seule.
  @Get('home/landing')
  async landing() {
    const metrics: LeaderboardMetric[] = ['completions', 'played', 'reviews'];
    const [games, reviews, players, ...tops] = await Promise.all([
      this.prisma.game.count(),
      this.prisma.review.count(),
      this.prisma.user.count(),
      ...metrics.map((m) => this.leaderboard.getPublicTop(m, 1)),
    ]);
    // Un objet par catégorie ayant au moins un joueur classé (métrique + n°1).
    const topPlayers = metrics.flatMap((metric, i) => {
      const row = tops[i][0];
      return row ? [{ metric, user: row.user, score: row.score }] : [];
    });
    return { games, reviews, players, topPlayers };
  }
}
