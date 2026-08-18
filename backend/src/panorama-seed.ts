// Standalone seeder — run with `npm run panoramas:seed`. Reads
// panorama_seed.json (hand-reviewed by a human — see
// panorama-candidates-extract.ts for how the review file it's drawn from
// gets built) and upserts each row into PanoramaGuessEntry, resolving
// gameTitle against the existing catalog. Never touches an image file.
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

interface SeedRow {
  kuulaId: string;
  gameTitle: string;
}

async function main() {
  const path = join(__dirname, '..', 'panorama_seed.json');
  const rows = JSON.parse(readFileSync(path, 'utf-8')) as SeedRow[];
  console.log(`Seeding ${rows.length} panorama-guess entries from ${path}...`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const game = await prisma.game.findFirst({
      where: { title: { equals: row.gameTitle, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!game) {
      console.warn(`Skipping "${row.kuulaId}" — no catalog match for "${row.gameTitle}"`);
      skipped++;
      continue;
    }
    await prisma.panoramaGuessEntry.upsert({
      where: { kuulaId: row.kuulaId },
      create: { kuulaId: row.kuulaId, gameId: game.id },
      update: { gameId: game.id, active: true },
    });
    imported++;
  }

  await app.close();
  console.log(`Done — ${imported} imported/updated, ${skipped} skipped (no catalog match).`);
}

main().catch((err) => {
  console.error('Panorama seed failed:', err.message ?? err);
  process.exit(1);
});
