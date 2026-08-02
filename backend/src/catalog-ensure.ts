// Idempotent catalog bootstrap, run once at container start (see the
// Dockerfile CMD). The goal is "everything works with one command" (make),
// offline included, on defence day.
//
// Fixture first: an empty catalog imports the committed catalog_seed.json —
// instant, deterministic, same ids on every machine. Only a missing fixture
// falls back to a live IGDB seed, which needs credentials and network. A
// catalog that already holds games is left alone, so it survives `make re`.
// To grow or refresh it from IGDB: `make seed [SEED_COUNT=N]`.
import { existsSync, readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CatalogGameRecord, GamesSyncService } from './games/games-sync.service';
import { PrismaService } from './prisma/prisma.service';

// Relative to /app (the container cwd), which is backend/catalog_seed.json on
// the host, since docker-compose only bind-mounts ./backend.
const SEED_FILE = process.env.CATALOG_SEED_FILE ?? 'catalog_seed.json';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const sync = app.get(GamesSyncService);

  const existing = await prisma.game.count();
  if (existing > 0) {
    console.log(`Catalog already has ${existing} games — nothing to bootstrap.`);
    await app.close();
    return;
  }

  if (existsSync(SEED_FILE)) {
    const records = JSON.parse(readFileSync(SEED_FILE, 'utf-8')) as CatalogGameRecord[];
    console.log(`Empty catalog — importing ${records.length} games from ${SEED_FILE}...`);
    await sync.importCatalog(records);
  } else if (process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET) {
    const count = Number(process.env.SEED_COUNT ?? 1000);
    console.log(`Empty catalog, no fixture — seeding ${count} games from IGDB...`);
    await sync.seedPopular(count);
  } else {
    console.warn(
      `Empty catalog, no fixture (${SEED_FILE}) and no IGDB creds — starting empty. Run \`make seed\` once IGDB creds are set.`,
    );
  }
  await app.close();
}

main().catch((err) => {
  // Never blocks the app from starting: log and exit 0 so the CMD's
  // `&& npm run start:dev` still runs — an empty catalog beats a crash-looping
  // container.
  console.error('Catalog bootstrap failed:', (err as Error).message ?? err);
  process.exit(0);
});
