import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// process.cwd() is /app both in dev (nest start --watch) and prod (node dist/main)
export const UPLOADS_ROOT = join(process.cwd(), 'uploads');
export const AVATARS_DIR = join(UPLOADS_ROOT, 'avatars');
export const LIST_COVERS_DIR = join(UPLOADS_ROOT, 'list-covers');

export function ensureUploadDirs(): void {
  for (const dir of [UPLOADS_ROOT, AVATARS_DIR, LIST_COVERS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
