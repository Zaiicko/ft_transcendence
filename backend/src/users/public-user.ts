import { User } from '@prisma/client';

export type PublicUser = Omit<
  User,
  'passwordHash' | 'twoFactorSecret' | 'providerId' | 'psnAccountId' | 'xboxXuid'
> & {
  // Lets the frontend offer "add a password" (provider accounts without one)
  // vs "change my password" — the hash itself never leaves the backend.
  hasPassword: boolean;
  // Whether a PlayStation account is linked. The internal account ID stays
  // backend-only; the online ID is kept for display (`psnOnlineId`).
  psnLinked: boolean;
  // Whether an Xbox account is linked. The internal XUID stays backend-only;
  // the gamertag is kept for display (`xboxGamertag`). Mirror of psnLinked.
  xboxLinked: boolean;
};

// Strip auth-internal fields before a User ever leaves the backend
export function toPublicUser(user: User): PublicUser {
  const { passwordHash, twoFactorSecret, providerId, psnAccountId, xboxXuid, ...publicUser } = user;
  return {
    ...publicUser,
    hasPassword: passwordHash !== null,
    psnLinked: psnAccountId !== null,
    xboxLinked: xboxXuid !== null,
  };
}
