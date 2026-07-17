import { User } from '@prisma/client';

export type PublicUser = Omit<User, 'passwordHash' | 'twoFactorSecret' | 'providerId'>;

// Strip auth-internal fields before a User ever leaves the backend
export function toPublicUser(user: User): PublicUser {
  const { passwordHash, twoFactorSecret, providerId, ...publicUser } = user;
  return publicUser;
}
