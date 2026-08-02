// Loaded before every spec file: points Prisma at the TEST database, so specs
// can create and delete data freely and never touch the dev one.
//
// IDEMPOTENT: Jest re-runs this per spec (the module registry is reset) while
// process.env persists — without stripping the suffix the URL would grow into
// saveboxd_test_test_test.
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const match = url.match(/\/([^/?]+)(\?.*)?$/);
  if (!match) throw new Error(`Unrecognized DATABASE_URL: ${url}`);
  const baseName = match[1].replace(/(_test)+$/, '');
  return url.replace(/\/[^/?]+(\?.*)?$/, `/${baseName}_test$1`);
}

process.env.DATABASE_URL = testDatabaseUrl();
