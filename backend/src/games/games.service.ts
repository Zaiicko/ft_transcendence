import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GamesSyncService } from './games-sync.service';

// Below this many local matches, a search also queries IGDB to enrich the
// catalog on the fly
const ON_DEMAND_THRESHOLD = 5;

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

  async list(page: number, limit: number) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.game.findMany({
        skip: (page - 1) * limit,
        take: limit,
        // Catalog default: most rated on IGDB first (user-rating sorts come
        // with the "advanced search" work)
        orderBy: [{ igdbRatingCount: { sort: 'desc', nulls: 'last' } }],
        include: GAME_INCLUDE,
      }),
      this.prisma.game.count(),
    ]);
    return { data, total, page, limit };
  }

  async findById(id: number) {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: GAME_INCLUDE,
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
