import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IgdbService } from '../games/igdb/igdb.service';

const IGDB_LOGO_CDN = 'https://images.igdb.com/igdb/image/upload/t_logo_med/';
const SYNC_BATCH_SIZE = 500;

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly igdb: IgdbService,
  ) {}

  async findById(id: number) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        games: {
          where: { gameType: 'MAIN' },
          orderBy: [{ igdbRatingCount: { sort: 'desc', nulls: 'last' } }],
          select: { id: true, title: true, coverUrl: true, releaseDate: true, igdbRating: true },
        },
        _count: { select: { games: true, reviews: true } },
      },
    });
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return company;
  }

  // Studio search by name for the search bar, most prolific first for
  // relevance. Returns just enough to render the thumbnail.
  async search(term: string) {
    if (!term) return { data: [] };
    const data = await this.prisma.company.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      orderBy: { games: { _count: 'desc' } },
      take: 8,
      select: { id: true, name: true, logoUrl: true },
    });
    return { data };
  }

  // One-shot logo backfill for every company without one (npm run companies:logos)
  async syncLogos() {
    const missing = await this.prisma.company.findMany({
      where: { logoUrl: null },
      select: { id: true, igdbId: true },
    });
    this.logger.log(`Fetching logos for ${missing.length} companies...`);
    let updated = 0;
    for (let i = 0; i < missing.length; i += SYNC_BATCH_SIZE) {
      const batch = missing.slice(i, i + SYNC_BATCH_SIZE);
      const rows = await this.igdb.query<{ id: number; logo?: { image_id: string } }>(
        'companies',
        `fields logo.image_id; where id = (${batch.map((c) => c.igdbId).join(',')}); limit ${SYNC_BATCH_SIZE};`,
      );
      const logoByIgdbId = new Map(
        rows.filter((r) => r.logo?.image_id).map((r) => [r.id, r.logo!.image_id]),
      );
      for (const c of batch) {
        const imageId = logoByIgdbId.get(c.igdbId);
        if (!imageId) continue;
        await this.prisma.company.update({
          where: { id: c.id },
          data: { logoUrl: `${IGDB_LOGO_CDN}${imageId}.webp` },
        });
        updated++;
      }
      this.logger.log(`Logo sync progress: ${Math.min(i + SYNC_BATCH_SIZE, missing.length)}/${missing.length}`);
    }
    return updated;
  }
}
