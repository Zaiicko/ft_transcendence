// Chargé avant chaque fichier de spec : bascule Prisma sur la base de TEST.
// Les tests créent/suppriment des données librement — jamais sur la base de dev.
//
// IDEMPOTENT : Jest ré-exécute ce fichier pour chaque spec (registre de
// modules réinitialisé) alors que process.env persiste — sans le nettoyage
// des suffixes, l'URL deviendrait saveboxd_test_test_test…
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const match = url.match(/\/([^/?]+)(\?.*)?$/);
  if (!match) throw new Error(`Unrecognized DATABASE_URL: ${url}`);
  const baseName = match[1].replace(/(_test)+$/, '');
  return url.replace(/\/[^/?]+(\?.*)?$/, `/${baseName}_test$1`);
}

process.env.DATABASE_URL = testDatabaseUrl();
