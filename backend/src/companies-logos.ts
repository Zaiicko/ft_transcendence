// Standalone logo backfill — run with `npm run companies:logos`.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CompaniesService } from './companies/companies.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const updated = await app.get(CompaniesService).syncLogos();
  console.log(`Done — ${updated} company logos filled.`);
  await app.close();
}

main().catch((err) => {
  console.error('Logo sync failed:', err.message ?? err);
  process.exit(1);
});
