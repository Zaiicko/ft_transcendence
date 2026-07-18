import { User } from '@prisma/client';

export type PublicUser = Omit<User, 'passwordHash' | 'twoFactorSecret' | 'providerId'> & {
  // Lets the frontend offer "add a password" (provider accounts without one)
  // vs "change my password" — the hash itself never leaves the backend.
  hasPassword: boolean;
};

// Strip auth-internal fields before a User ever leaves the backend
export function toPublicUser(user: User): PublicUser {
  const { passwordHash, twoFactorSecret, providerId, ...publicUser } = user;
  return { ...publicUser, hasPassword: passwordHash !== null };
}
