import { execSync } from 'child_process';
import { testDatabaseUrl } from './set-test-env';

// Once before the whole suite: creates and syncs the test database.
// `prisma db push` creates it if it doesn't exist yet.
export default function globalSetup(): void {
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
