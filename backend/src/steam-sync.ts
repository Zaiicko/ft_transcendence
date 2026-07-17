// Standalone Steam sync — run with `npm run steam:sync` (or `make steam`).
// Maps games to their Steam AppID (via IGDB external links), then fetches the
// % of positive Steam reviews. STEAM_COUNT limits how many scores to fetch.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SteamSyncService } from './games/steam/steam-sync.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const sync = app.get(SteamSyncService);

  const mapped = await sync.mapAppIds();
  const limit = process.env.STEAM_COUNT ? Number(process.env.STEAM_COUNT) : undefined;
  const scored = await sync.syncScores(limit);

  console.log(`Done — ${mapped} new AppIDs mapped, ${scored} Steam scores stored.`);
  await app.close();
}

main().catch((err) => {
  console.error('Steam sync failed:', err.message ?? err);
  process.exit(1);
});
