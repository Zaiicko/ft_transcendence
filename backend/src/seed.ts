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
  // Seuil de votes IGDB : baisser pour dépasser ~6,8k jeux (voir seedPopular).
  const minRatings = Number(process.env.SEED_MIN_RATINGS ?? 20);
  console.log(`Seeding the ${count} most rated IGDB games (min ${minRatings} ratings)...`);

  const sync = app.get(GamesSyncService);
  const imported = await sync.seedPopular(count, minRatings);

  console.log(`Done — ${imported} games imported/updated.`);
  await app.close();
}

main().catch((err) => {
  console.error('Seed failed:', err.message ?? err);
  process.exit(1);
});
