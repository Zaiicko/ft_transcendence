import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IgdbGame, IgdbService } from './igdb/igdb.service';

const GAME_FIELDS = `fields name, summary, first_release_date, total_rating,
  total_rating_count, cover.image_id, screenshots.image_id,
  genres.id, genres.name, platforms.id, platforms.name,
  involved_companies.company.id, involved_companies.company.name;`;

// IGDB allows 4 req/s — stay well under it when paginating
const PAGE_SIZE = 500;
const PAGE_DELAY_MS = 350;
const MAX_SCREENSHOTS = 6;

@Injectable()
export class GamesSyncService {
  private readonly logger = new Logger(GamesSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly igdb: IgdbService,
  ) {}

  // Bulk import of the most rated games. Idempotent (upsert by igdbId):
  // safe to re-run to refresh data or extend the catalog.
  async seedPopular(count: number): Promise<number> {
    let imported = 0;
    for (let offset = 0; offset < count; offset += PAGE_SIZE) {
      const limit = Math.min(PAGE_SIZE, count - offset);
      const games = await this.igdb.query<IgdbGame>(
        'games',
        `${GAME_FIELDS}
         where total_rating_count > 20 & version_parent = null;
         sort total_rating_count desc;
         limit ${limit}; offset ${offset};`,
      );
      if (games.length === 0) break;

      for (const game of games) {
        await this.upsertFromIgdb(game);
        imported++;
      }
      this.logger.log(`Seed progress: ${imported}/${count}`);
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
    return imported;
  }

  // On-demand import: fetch games matching a user search that we don't have
  // locally yet. Returns the number of games imported.
  async importFromSearch(term: string, limit = 20): Promise<number> {
    const sanitized = term.replace(/["\\]/g, '');
    const games = await this.igdb.query<IgdbGame>(
      'games',
      `${GAME_FIELDS}
       search "${sanitized}";
       where version_parent = null;
       limit ${limit};`,
    );
    for (const game of games) {
      await this.upsertFromIgdb(game);
    }
    return games.length;
  }

  private async upsertFromIgdb(raw: IgdbGame) {
    const companies = (raw.involved_companies ?? [])
      .map((ic) => ic.company)
      .filter((c) => c?.id && c?.name);

    const data = {
      title: raw.name,
      summary: raw.summary ?? null,
      releaseDate: raw.first_release_date
        ? new Date(raw.first_release_date * 1000)
        : null,
      coverUrl: raw.cover ? IgdbService.coverUrl(raw.cover.image_id) : null,
      screenshots: (raw.screenshots ?? [])
        .slice(0, MAX_SCREENSHOTS)
        .map((s) => IgdbService.screenshotUrl(s.image_id)),
      igdbRating: raw.total_rating ?? null,
      igdbRatingCount: raw.total_rating_count ?? null,
      genres: {
        connectOrCreate: (raw.genres ?? []).map((g) => ({
          where: { igdbId: g.id },
          create: { igdbId: g.id, name: g.name },
        })),
      },
      platforms: {
        connectOrCreate: (raw.platforms ?? []).map((p) => ({
          where: { igdbId: p.id },
          create: { igdbId: p.id, name: p.name },
        })),
      },
      companies: {
        connectOrCreate: companies.map((c) => ({
          where: { igdbId: c.id },
          create: { igdbId: c.id, name: c.name },
        })),
      },
    };

    return this.prisma.game.upsert({
      where: { igdbId: raw.id },
      create: { igdbId: raw.id, ...data },
      update: data,
    });
  }
}
