import { Injectable, Logger } from '@nestjs/common';
import { GameType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IgdbGame, IgdbService } from './igdb/igdb.service';

const GAME_FIELDS = `fields name, summary, first_release_date, total_rating,
  total_rating_count, game_type, parent_game, cover.image_id,
  screenshots.image_id, genres.id, genres.name, platforms.id, platforms.name,
  involved_companies.company.id, involved_companies.company.name;`;

const GAME_TYPE_MAP: Record<number, GameType> = {
  0: GameType.MAIN,
  1: GameType.DLC,
  2: GameType.EXPANSION,
  4: GameType.STANDALONE,
  8: GameType.REMAKE,
  9: GameType.REMASTER,
};

// Child types worth importing under a base game — everything else that IGDB
// attaches to a parent (mods/WADs, bundles, ports, packs, updates...) is noise
const IMPORTED_DLC_TYPES = [1, 2, 4];

// IGDB allows 4 req/s — stay well under it when paginating
const PAGE_SIZE = 500;
const PAGE_DELAY_MS = 350;
const MAX_SCREENSHOTS = 6;

// Flat snapshot used by exportCatalog()/importCatalog() to share the seeded
// catalog between teammates without re-hitting IGDB/Steam. Tags carry their
// REAL igdbId so a later live IGDB sync on the importer's machine matches the
// same rows instead of creating duplicates.
export interface CatalogTagRecord {
  igdbId: number;
  name: string;
}

export interface CatalogGameRecord {
  igdbId: number;
  title: string;
  summary: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  screenshots: string[];
  igdbRating: number | null;
  igdbRatingCount: number | null;
  steamAppId: number | null;
  steamScore: number | null;
  steamRatingCount: number | null;
  gameType: GameType;
  parentIgdbId: number | null;
  genres: CatalogTagRecord[];
  platforms: CatalogTagRecord[];
  companies: CatalogTagRecord[];
}

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
      const dlcs = await this.importDlcsOf(games.map((g) => g.id));
      this.logger.log(`Seed progress: ${imported}/${count} (+${dlcs} DLCs)`);
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
    return imported;
  }

  // Fetch and import every DLC/expansion whose base game is in `parentIgdbIds`
  // (their parents are already upserted, so the parent lookup resolves)
  private async importDlcsOf(parentIgdbIds: number[]): Promise<number> {
    if (parentIgdbIds.length === 0) return 0;
    let imported = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const dlcs = await this.igdb.query<IgdbGame>(
        'games',
        `${GAME_FIELDS}
         where parent_game = (${parentIgdbIds.join(',')})
           & game_type = (${IMPORTED_DLC_TYPES.join(',')});
         limit ${PAGE_SIZE}; offset ${offset};`,
      );
      for (const dlc of dlcs) {
        await this.upsertFromIgdb(dlc);
        imported++;
      }
      if (dlcs.length < PAGE_SIZE) return imported;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
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
    await this.importDlcsOf(games.map((g) => g.id));
    return games.length;
  }

  private async upsertFromIgdb(raw: IgdbGame) {
    const companies = (raw.involved_companies ?? [])
      .map((ic) => ic.company)
      .filter((c) => c?.id && c?.name);

    // Resolve the base game locally; null when we don't have it (the game
    // then simply shows in the catalog on its own)
    const parent = raw.parent_game
      ? await this.prisma.game.findUnique({
          where: { igdbId: raw.parent_game },
          select: { id: true },
        })
      : null;

    const data = {
      gameType: GAME_TYPE_MAP[raw.game_type ?? 0] ?? GameType.OTHER,
      parentId: parent?.id ?? null,
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

  // --- Catalog sharing (teammates skip re-hitting IGDB/Steam entirely) ---
  //
  // Unlike a full DB dump, this only ever touches Game/Genre/Platform/Company
  // via upsert matched on igdbId (never on the local serial id). It can be
  // run on top of ANY existing database — User/Review/Friendship/... rows are
  // never read or written, so nobody's local test accounts or reviews are at
  // risk of being wiped or having their game references corrupted.

  async exportCatalog(): Promise<CatalogGameRecord[]> {
    const games = await this.prisma.game.findMany({
      include: {
        genres: { select: { igdbId: true, name: true } },
        platforms: { select: { igdbId: true, name: true } },
        companies: { select: { igdbId: true, name: true } },
        parent: { select: { igdbId: true } },
      },
    });
    return games.map((g) => ({
      igdbId: g.igdbId,
      title: g.title,
      summary: g.summary,
      releaseDate: g.releaseDate?.toISOString() ?? null,
      coverUrl: g.coverUrl,
      screenshots: g.screenshots,
      igdbRating: g.igdbRating,
      igdbRatingCount: g.igdbRatingCount,
      steamAppId: g.steamAppId,
      steamScore: g.steamScore,
      steamRatingCount: g.steamRatingCount,
      gameType: g.gameType,
      parentIgdbId: g.parent?.igdbId ?? null,
      genres: g.genres,
      platforms: g.platforms,
      companies: g.companies,
    }));
  }

  // Resolves a Genre/Platform/Company by its REAL igdbId (same key the live
  // IGDB sync uses, so both paths always converge on the same rows — no
  // duplicates). Cached in memory for the run since the same tag repeats
  // across thousands of games.
  private tagCache = new Map<string, number>();

  private async resolveTagId(
    kind: 'genre' | 'platform' | 'company',
    tag: CatalogTagRecord,
  ): Promise<number> {
    const key = `${kind}:${tag.igdbId}`;
    const cached = this.tagCache.get(key);
    if (cached) return cached;

    const args = {
      where: { igdbId: tag.igdbId },
      update: { name: tag.name },
      create: { igdbId: tag.igdbId, name: tag.name },
      select: { id: true },
    };
    let row: { id: number };
    switch (kind) {
      case 'genre':
        row = await this.prisma.genre.upsert(args);
        break;
      case 'platform':
        row = await this.prisma.platform.upsert(args);
        break;
      case 'company':
        row = await this.prisma.company.upsert(args);
        break;
    }
    this.tagCache.set(key, row.id);
    return row.id;
  }

  // Two passes: all games first (so every igdbId resolves to a local row),
  // then parent links — a DLC can appear before its base game in the file.
  async importCatalog(records: CatalogGameRecord[]): Promise<number> {
    this.tagCache.clear();
    let done = 0;
    for (const r of records) {
      const [genreIds, platformIds, companyIds] = await Promise.all([
        Promise.all(r.genres.map((t) => this.resolveTagId('genre', t))),
        Promise.all(r.platforms.map((t) => this.resolveTagId('platform', t))),
        Promise.all(r.companies.map((t) => this.resolveTagId('company', t))),
      ]);

      const data = {
        title: r.title,
        summary: r.summary,
        releaseDate: r.releaseDate ? new Date(r.releaseDate) : null,
        coverUrl: r.coverUrl,
        screenshots: r.screenshots,
        igdbRating: r.igdbRating,
        igdbRatingCount: r.igdbRatingCount,
        steamAppId: r.steamAppId,
        steamScore: r.steamScore,
        // ?? null: tolerate exports produced before this field existed
        steamRatingCount: r.steamRatingCount ?? null,
        gameType: r.gameType,
      };

      try {
        await this.prisma.game.upsert({
          where: { igdbId: r.igdbId },
          create: {
            igdbId: r.igdbId,
            ...data,
            genres: { connect: genreIds.map((id) => ({ id })) },
            platforms: { connect: platformIds.map((id) => ({ id })) },
            companies: { connect: companyIds.map((id) => ({ id })) },
          },
          update: {
            ...data,
            genres: { set: genreIds.map((id) => ({ id })) },
            platforms: { set: platformIds.map((id) => ({ id })) },
            companies: { set: companyIds.map((id) => ({ id })) },
          },
        });
      } catch {
        // steamAppId is unique — extremely rare local collision with a
        // pre-existing game imported through a different path. Skip it: the
        // rest of the catalog import must not be derailed by one row.
        this.logger.warn(`Skipped "${r.title}" (igdbId ${r.igdbId}) — likely a steamAppId conflict`);
      }
      done++;
      if (done % 1000 === 0) {
        this.logger.log(`Catalog import progress: ${done}/${records.length}`);
      }
    }

    let linked = 0;
    for (const r of records) {
      if (!r.parentIgdbId) continue;
      const parent = await this.prisma.game.findUnique({
        where: { igdbId: r.parentIgdbId },
        select: { id: true },
      });
      if (!parent) continue;
      await this.prisma.game.update({
        where: { igdbId: r.igdbId },
        data: { parentId: parent.id },
      });
      linked++;
    }
    this.logger.log(`Catalog import: ${records.length} games upserted, ${linked} parent links`);
    return records.length;
  }
}
