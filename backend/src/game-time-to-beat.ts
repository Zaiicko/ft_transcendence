// Standalone time-to-beat backfill — run with `npm run time-to-beat:sync`.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GamesSyncService } from './games/games-sync.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const updated = await app.get(GamesSyncService).syncTimeToBeat();
  console.log(`Done — ${updated} games got an average completion time.`);
  await app.close();
}

main().catch((err) => {
  console.error('Time-to-beat sync failed:', err.message ?? err);
  process.exit(1);
});
