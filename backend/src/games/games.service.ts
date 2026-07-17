import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GameType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameSort, ListGamesDto } from './dto/list-games.dto';
import { GamesSyncService } from './games-sync.service';

// Below this many local matches, a search also queries IGDB to enrich the
// catalog on the fly
const ON_DEMAND_THRESHOLD = 5;

// Bayesian confidence weight (IMDb-style): the IGDB rating counts as this
// many virtual user votes, so a couple of accounts can't skew a game's score
// while a real crowd of users progressively takes over.
//   score = (n·avgUsers + W·igdb/10) / (n + W)
const RATING_CONFIDENCE_WEIGHT = 10;

const GAME_INCLUDE = {
  genres: true,
  platforms: true,
  companies: true,
} satisfies Prisma.GameInclude;

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: GamesSyncService,
  ) {}

  // Combinable filters (Prisma), then computed sorts (SQL aggregates: weighted
  // score, played count) on the filtered ids — same two-step pattern as the
  // reviews net-score sort.
  async list(dto: ListGamesDto) {
    const { page, limit } = dto;
    const where: Prisma.GameWhereInput = {
      // DLCs/expansions/mods never flood the catalog — they live on their
      // parent's page. Remakes/remasters/standalones stay listed even though
      // IGDB gives them a parent (e.g. The Last of Us Remastered).
      OR: [
        { parentId: null },
        { gameType: { in: [GameType.STANDALONE, GameType.REMAKE, GameType.REMASTER] } },
      ],
      ...(dto.q && { title: { contains: dto.q, mode: 'insensitive' as const } }),
      ...(dto.genre && {
        genres: { some: { name: { contains: dto.genre, mode: 'insensitive' as const } } },
      }),
      ...(dto.platform && {
        platforms: { some: { name: { contains: dto.platform, mode: 'insensitive' as const } } },
      }),
      ...(dto.company && {
        companies: { some: { name: { contains: dto.company, mode: 'insensitive' as const } } },
      }),
    };

    const candidates = await this.prisma.game.findMany({ where, select: { id: true } });
    const total = candidates.length;
    if (total === 0) return { data: [], total, page, limit };
    const ids = candidates.map((c) => c.id);

    const orderBy: Record<GameSort, Prisma.Sql> = {
      [GameSort.RATING]: Prisma.sql`score DESC, g."igdbRatingCount" DESC NULLS LAST`,
      [GameSort.MOST_PLAYED]: Prisma.sql`"playedCount" DESC, score DESC`,
      [GameSort.RECENT]: Prisma.sql`g."releaseDate" DESC NULLS LAST`,
      [GameSort.POPULAR]: Prisma.sql`g."igdbRatingCount" DESC NULLS LAST`,
    };

    type ScoredRow = {
      id: number;
      avgUserRating: number | null;
      userRatingCount: number;
      playedCount: number;
      score: number;
    };
    const rows = await this.prisma.$queryRaw<ScoredRow[]>(Prisma.sql`
      SELECT g.id,
        r.avg                AS "avgUserRating",
        COALESCE(r.n, 0)     AS "userRatingCount",
        COALESCE(p.n, 0)     AS "playedCount",
        ((COALESCE(r.n, 0) * COALESCE(r.avg, 0)
          + ${RATING_CONFIDENCE_WEIGHT} * COALESCE(
              (g."igdbRating" / 10.0 + g."steamScore" / 10.0) / 2,
              g."igdbRating" / 10.0,
              g."steamScore" / 10.0,
              5))
          / (COALESCE(r.n, 0) + ${RATING_CONFIDENCE_WEIGHT}))::float AS score
      FROM "Game" g
      LEFT JOIN (
        SELECT "gameId", AVG(rating)::float AS avg, COUNT(*)::int AS n
        FROM "Review" GROUP BY "gameId"
      ) r ON r."gameId" = g.id
      LEFT JOIN (
        SELECT "gameId", COUNT(*)::int AS n
        FROM "PlayedGame" WHERE status = 'PLAYED' GROUP BY "gameId"
      ) p ON p."gameId" = g.id
      WHERE g.id IN (${Prisma.join(ids)})
      ORDER BY ${orderBy[dto.sort]}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`);

    const games = await this.prisma.game.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: GAME_INCLUDE,
    });
    const byId = new Map(games.map((g) => [g.id, g]));
    const data = rows.map((row) => ({
      ...byId.get(row.id)!,
      avgUserRating: row.avgUserRating,
      userRatingCount: row.userRatingCount,
      playedCount: row.playedCount,
      score: Math.round(row.score * 100) / 100,
    }));
    return { data, total, page, limit };
  }

  async findById(id: number) {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: {
        ...GAME_INCLUDE,
        // The game's page lists its rateable DLCs/expansions...
        dlcs: {
          where: {
            gameType: {
              in: [GameType.DLC, GameType.EXPANSION, GameType.STANDALONE],
            },
          },
          orderBy: { releaseDate: 'asc' },
          select: {
            id: true,
            title: true,
            coverUrl: true,
            releaseDate: true,
            gameType: true,
            igdbRating: true,
          },
        },
        // ...and a DLC's page links back to its base game
        parent: { select: { id: true, title: true, coverUrl: true } },
      },
    });
    if (!game) throw new NotFoundException(`Game ${id} not found`);
    return game;
  }

  // Local search always; the IGDB on-demand import only runs when the caller
  // explicitly asks for it (useIgdb) AND the local catalog has too few
  // matches. IGDB being down never breaks search — we log and return
  // whatever we have locally.
  async search(term: string, useIgdb = false) {
    let results = await this.searchLocal(term);
    if (useIgdb && results.length < ON_DEMAND_THRESHOLD) {
      try {
        const imported = await this.sync.importFromSearch(term);
        if (imported > 0) results = await this.searchLocal(term);
      } catch (err) {
        this.logger.warn(
          `On-demand IGDB import failed for "${term}": ${(err as Error).message}`,
        );
      }
    }
    return { data: results, total: results.length };
  }

  private searchLocal(term: string) {
    return this.prisma.game.findMany({
      where: { title: { contains: term, mode: 'insensitive' } },
      orderBy: [{ igdbRatingCount: { sort: 'desc', nulls: 'last' } }],
      take: 25,
      include: GAME_INCLUDE,
    });
  }
}
