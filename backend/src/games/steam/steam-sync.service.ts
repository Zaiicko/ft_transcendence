import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IgdbService } from '../igdb/igdb.service';
import { SteamService } from './steam.service';

// external-game-sources id for Steam on IGDB
const IGDB_SOURCE_STEAM = 1;
const MAP_BATCH = 400;
// Unofficial store endpoint — stay gentle
const SCORE_DELAY_MS = 350;

@Injectable()
export class SteamSyncService {
  private readonly logger = new Logger(SteamSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly igdb: IgdbService,
    private readonly steam: SteamService,
  ) {}

  // Step 1 — resolve Steam AppIDs through IGDB's external_games references
  // (exact links, no fuzzy name matching). Idempotent: only fills the blanks.
  async mapAppIds(): Promise<number> {
    const unmapped = await this.prisma.game.findMany({
      where: { steamAppId: null },
      select: { id: true, igdbId: true },
    });
    if (unmapped.length === 0) return 0;
    const byIgdbId = new Map(unmapped.map((g) => [g.igdbId, g.id]));

    let mapped = 0;
    const igdbIds = [...byIgdbId.keys()];
    for (let i = 0; i < igdbIds.length; i += MAP_BATCH) {
      const batch = igdbIds.slice(i, i + MAP_BATCH);
      const rows = await this.igdb.query<{ game: number; uid: string }>(
        'external_games',
        `fields game, uid;
         where external_game_source = ${IGDB_SOURCE_STEAM} & game = (${batch.join(',')});
         limit 500;`,
      );
      for (const row of rows) {
        const gameId = byIgdbId.get(row.game);
        const appId = Number(row.uid);
        if (!gameId || !Number.isInteger(appId) || appId <= 0) continue;
        try {
          await this.prisma.game.update({
            where: { id: gameId },
            data: { steamAppId: appId },
          });
          mapped++;
        } catch {
          // steamAppId is unique — rare duplicate links on IGDB's side, skip
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    this.logger.log(`Steam AppID mapping: ${mapped} games mapped`);
    return mapped;
  }

  // Step 2 — fetch the % of positive Steam reviews for mapped games that
  // don't have a score yet (most-known games first). Re-run anytime.
  async syncScores(limit?: number): Promise<number> {
    const games = await this.prisma.game.findMany({
      where: { steamAppId: { not: null }, steamScore: null },
      orderBy: [{ igdbRatingCount: { sort: 'desc', nulls: 'last' } }],
      select: { id: true, steamAppId: true, title: true },
      ...(limit ? { take: limit } : {}),
    });

    let synced = 0;
    for (const game of games) {
      const { score } = await this.steam.fetchReviewSummary(game.steamAppId!);
      if (score !== null) {
        await this.prisma.game.update({
          where: { id: game.id },
          data: { steamScore: Math.round(score * 10) / 10 },
        });
        synced++;
      }
      if (synced > 0 && synced % 100 === 0) {
        this.logger.log(`Steam scores: ${synced}/${games.length}`);
      }
      await new Promise((r) => setTimeout(r, SCORE_DELAY_MS));
    }
    this.logger.log(`Steam scores: ${synced} games scored (${games.length} attempted)`);
    return synced;
  }
}
