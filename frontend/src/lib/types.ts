export type AuthProvider = 'LOCAL' | 'FORTYTWO' | 'GOOGLE';

export interface PublicUser {
  id: number;
  email: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  provider: AuthProvider;
  steamId: string | null;
  twoFactorEnabled: boolean;
  emailVerifiedAt: string | null;
  language: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}
