// Bootstrap idempotent du catalogue, lancé une fois au démarrage du conteneur
// (voir le CMD du Dockerfile). Objectif : « tout marche avec une commande »
// (make) même hors-ligne, à la soutenance.
//
// Fixture-first : si le catalogue est vide, on importe la fixture committée
// (catalog_seed.json) — instantané, déterministe, mêmes ids sur toutes les
// machines. La fixture manquante seulement, on retombe sur un seed IGDB live
// (creds + réseau requis). Si le catalogue contient déjà des jeux, on ne touche
// à rien (survit à chaque `make re`). Pour agrandir/rafraîchir depuis IGDB :
// `make seed [SEED_COUNT=N]`.
import { existsSync, readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CatalogGameRecord, GamesSyncService } from './games/games-sync.service';
import { PrismaService } from './prisma/prisma.service';

// Chemin relatif à /app (cwd du conteneur) = backend/catalog_seed.json côté
// hôte, car docker-compose ne bind-mount que ./backend.
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
  // On ne bloque jamais le démarrage de l'app : on log et on sort en 0 pour que
  // le `&& npm run start:dev` du CMD enchaîne (catalogue vide plutôt que
  // crash-loop du conteneur).
  console.error('Catalog bootstrap failed:', (err as Error).message ?? err);
  process.exit(0);
});
