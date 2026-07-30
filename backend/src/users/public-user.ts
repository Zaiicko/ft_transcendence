import { User } from '@prisma/client';

export type PublicUser = Omit<
  User,
  | 'passwordHash'
  | 'twoFactorSecret'
  | 'providerId'
  | 'psnAccountId'
  | 'xboxXuid'
  | 'onboardedAt'
  | 'tutorialSeenAt'
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
  // Whether the onboarding wizard has been completed or explicitly skipped.
  // The raw timestamp stays backend-only; the front only needs the boolean.
  onboarded: boolean;
  // Whether the guided tour has already been seen or skipped (drives its
  // one-time auto-start after onboarding). Raw timestamp stays backend-only.
  tutorialSeen: boolean;
};

// Strip auth-internal fields before a User ever leaves the backend
export function toPublicUser(user: User): PublicUser {
  const {
    passwordHash,
    twoFactorSecret,
    providerId,
    psnAccountId,
    xboxXuid,
    onboardedAt,
    tutorialSeenAt,
    ...publicUser
  } = user;
  return {
    ...publicUser,
    hasPassword: passwordHash !== null,
    psnLinked: psnAccountId !== null,
    xboxLinked: xboxXuid !== null,
    onboarded: onboardedAt !== null,
    tutorialSeen: tutorialSeenAt !== null,
  };
}
