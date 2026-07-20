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
  // Présents uniquement sur GET /games/:id (fiche) : le jeu parent si ce jeu
  // est un DLC/extension, et la liste de ses propres DLC/extensions.
  parent?: { id: number; title: string; coverUrl: string | null } | null;
  dlcs?: GameDlc[];
}

// Contenu additionnel rattaché à un jeu (DLC, extension, standalone)
export interface GameDlc {
  id: number;
  title: string;
  coverUrl: string | null;
  releaseDate?: string | null;
  gameType: string;
  igdbRating?: number | null;
}

// GET /games/facets — filtres disponibles pour le catalogue (seulement ceux
// réellement rattachés à des jeux, les plus utilisés d'abord)
export interface GameFacet {
  id: number;
  name: string;
  count: number;
}
export interface GameFacets {
  genres: GameFacet[];
  platforms: GameFacet[];
  companies: GameFacet[];
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

// Viewer's relationship with the profile owner (drives the friend button)
export type FriendState = 'self' | 'friends' | 'incoming' | 'outgoing' | 'none';

type GameRef = { id: number; title: string; coverUrl: string | null };

// GET /users/profile/:username — privacy-safe public profile (no email)
export interface PublicProfile {
  id: number;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  provider: AuthProvider;
  steamId: string | null;
  createdAt: string;
  reviewCount: number;
  playedCount: number;
  topGames: { rating: number; game: GameRef }[];
  recentReviews: {
    id: number;
    title: string;
    rating: number;
    text: string;
    createdAt: string;
    game: GameRef | null;
    company: { id: number; name: string; logoUrl: string | null } | null;
  }[];
  calendar: { playedAt: string; game: GameRef }[];
  friendState: FriendState;
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
