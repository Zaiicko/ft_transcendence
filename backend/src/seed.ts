// Standalone catalog seeder — run with `npm run seed` (or `make seed` from
// the repo root). SEED_COUNT overrides the default amount of games.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GamesSyncService } from './games/games-sync.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const count = Number(process.env.SEED_COUNT ?? 1000);
  console.log(`Seeding the ${count} most rated IGDB games...`);

  const sync = app.get(GamesSyncService);
  const imported = await sync.seedPopular(count);

  console.log(`Done — ${imported} games imported/updated.`);
  await app.close();
}

main().catch((err) => {
  console.error('Seed failed:', err.message ?? err);
  process.exit(1);
});
