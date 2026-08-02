// Import a catalog previously produced by `catalog-export.ts`. Only ever
// touches Game/Genre/Platform/Company via upsert on igdbId — User, Review,
// Friendship, etc. are never read or written, so this is safe to run on top
// of an existing database without losing anyone's local test data.
// Run with `npm run catalog:import` (or `make catalog-import`).
import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CatalogGameRecord, GamesSyncService } from './games/games-sync.service';

// Relative to /app (this container's cwd) = backend/catalog_export.json on
// the host, since docker-compose only bind-mounts ./backend, not the repo root
const INPUT_PATH = process.env.CATALOG_FILE ?? 'catalog_export.json';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const sync = app.get(GamesSyncService);

  const records = JSON.parse(readFileSync(INPUT_PATH, 'utf-8')) as CatalogGameRecord[];
  console.log(`Importing ${records.length} games from ${INPUT_PATH}...`);
  await sync.importCatalog(records);

  console.log('Done — your existing users/reviews/etc. were left untouched.');
  await app.close();
}

main().catch((err) => {
  console.error('Catalog import failed:', err.message ?? err);
  process.exit(1);
});
