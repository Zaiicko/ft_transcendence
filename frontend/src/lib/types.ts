export type AuthProvider = 'LOCAL' | 'FORTYTWO' | 'GOOGLE' | 'STEAM';

// Ligne renvoyée par GET /games (liste/recherche) — score = mélange bayésien
// note IGDB + notes utilisateurs (voir docs/reviews-api.md)
export interface GameSummary {
  id: number;
  title: string;
  coverUrl: string | null;
  screenshots?: string[];
  summary?: string | null;
  releaseDate?: string | null;
  score?: number;
  avgUserRating?: number | null;
  userRatingCount?: number;
  igdbRating?: number | null;
  genres?: { id: number; name: string }[];
}

// Item de GET /reviews/highlights — user null = compte supprimé,
// exactement un de game/company est non-null
export interface ReviewHighlight {
  id: number;
  rating: number;
  title: string;
  text: string;
  createdAt: string;
  user: { id: number; username: string; avatarUrl: string | null } | null;
  game: { id: number; title: string; coverUrl: string | null } | null;
  company: { id: number; name: string; logoUrl: string | null } | null;
  _count: { likes: number; dislikes: number; comments: number };
}

export interface PublicUser {
  id: number;
  email: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  provider: AuthProvider;
  steamId: string | null;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  emailVerifiedAt: string | null;
  language: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}
