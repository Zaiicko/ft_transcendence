// Export the game catalog (Game/Genre/Platform/Company only — no User/Review/
// etc.) to a JSON file so teammates can import it without re-hitting
// IGDB/Steam. Run with `npm run catalog:export` (or `make catalog-export`).
import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GamesSyncService } from './games/games-sync.service';

// Relative to /app (this container's cwd) = backend/catalog_export.json on
// the host, since docker-compose only bind-mounts ./backend, not the repo root
const OUTPUT_PATH = process.env.CATALOG_FILE ?? 'catalog_export.json';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const sync = app.get(GamesSyncService);

  const records = await sync.exportCatalog();
  writeFileSync(OUTPUT_PATH, JSON.stringify(records));

  console.log(`Exported ${records.length} games to ${OUTPUT_PATH}`);
  await app.close();
}

main().catch((err) => {
  console.error('Catalog export failed:', err.message ?? err);
  process.exit(1);
});
