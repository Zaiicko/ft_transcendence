import { execSync } from 'child_process';
import { testDatabaseUrl } from './set-test-env';

// Une fois avant toute la suite : crée/synchronise la base de test.
// `prisma db push` crée la base si elle n'existe pas encore.
export default function globalSetup(): void {
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
