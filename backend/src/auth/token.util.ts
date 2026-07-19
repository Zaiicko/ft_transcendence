import { createHash, randomBytes } from 'crypto';

// Shared by RefreshToken and VerificationToken — only the hash is ever stored,
// the raw value lives only in a cookie (refresh) or an emailed link (verification).
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
