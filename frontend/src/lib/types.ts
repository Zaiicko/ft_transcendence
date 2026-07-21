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
  companies?: { id: number; name: string; logoUrl: string | null }[];
  // Présents uniquement sur GET /games/:id (fiche) : le jeu parent si ce jeu
  // est un DLC/extension, et la liste de ses propres DLC/extensions.
  parent?: { id: number; title: string; coverUrl: string | null } | null;
  dlcs?: GameDlc[];
}

// GET /companies/:id — fiche studio + ses jeux principaux
export interface CompanyDetail {
  id: number;
  name: string;
  logoUrl: string | null;
  games: {
    id: number;
    title: string;
    coverUrl: string | null;
    releaseDate: string | null;
    igdbRating: number | null;
  }[];
  _count: { games: number; reviews: number };
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

// Résumé d'une liste (carte) — GET /lists/mine, profil public, etc.
export interface GameListSummary {
  id: number;
  name: string;
  isPublic: boolean;
  gameCount: number;
  covers: string[]; // jusqu'à 5 jaquettes pour l'aperçu empilé
  contains?: boolean; // présent quand /lists/mine est appelé avec ?gameId=
}

// Détail d'une liste — GET /lists/:id
export interface GameListDetail {
  id: number;
  name: string;
  isPublic: boolean;
  owner: { id: number; username: string; avatarUrl: string | null };
  games: { id: number; title: string; coverUrl: string | null; releaseDate: string | null }[];
}

// ---- Notifications ----
export type NotificationType =
  | 'FRIEND_REQUEST'
  | 'FRIEND_ACCEPT'
  | 'REVIEW_LIKE'
  | 'REVIEW_COMMENT'
  | 'COMMENT_REPLY'
  | 'NEW_MESSAGE'
  | 'FRIEND_JOINED';

// payload dépend du type ; tous les champs sont donc optionnels côté front
export interface AppNotification {
  id: number;
  type: NotificationType;
  payload: {
    actorId?: number;
    actorUsername?: string;
    actorAvatarUrl?: string | null;
    reviewId?: number;
    reviewTitle?: string;
    gameId?: number | null;
    companyId?: number | null;
    commentId?: number;
    // FRIEND_JOINED : via quel réseau ce contact a rejoint
    via?: 'steam' | '42';
  };
  readAt: string | null;
  createdAt: string;
}

// ---- Chat / messagerie ----
export type MessageType = 'TEXT' | 'GAME' | 'REVIEW' | 'PROFILE';

export interface ChatMessage {
  id: number;
  senderId: number;
  recipientId: number;
  type: MessageType;
  content: string | null;
  readAt: string | null;
  createdAt: string;
  sender: { id: number; username: string; avatarUrl: string | null };
  // Aperçus de partage : au plus un non-null selon `type`
  game: { id: number; title: string; coverUrl: string | null } | null;
  review: {
    id: number;
    title: string;
    rating: number;
    game: { id: number; title: string; coverUrl: string | null } | null;
    company: { id: number; name: string; logoUrl: string | null } | null;
  } | null;
  sharedUser: { id: number; username: string; avatarUrl: string | null } | null;
}

export interface ChatConversation {
  friend: { id: number; username: string; avatarUrl: string | null; isOnline: boolean };
  lastMessage: ChatMessage | null;
  unread: number;
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

// ---- Feed d'activité des amis (GET /feed + event WS `feed:new`) ----
export type FeedActor = { id: number; username: string; avatarUrl: string | null };
export type FeedGameRef = { id: number; title: string; coverUrl: string | null };

// `id` unique tous types confondus (préfixé "review-"/"played-"), `at` = date
// de l'action (tri + curseur "charger plus")
export type FeedItem =
  | { id: string; kind: 'review'; at: string; review: ReviewHighlight }
  | { id: string; kind: 'played'; at: string; actor: FeedActor; game: FeedGameRef };

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

// Viewer's relationship with the profile owner (drives the friend button)
export type FriendState = 'self' | 'friends' | 'incoming' | 'outgoing' | 'none';

type GameRef = { id: number; title: string; coverUrl: string | null };

// Un avis tel qu'affiché sur le profil (seed du profil + GET
// /users/profile/:username/reviews). Exactement un de game/company est non-null.
export interface ProfileReview {
  id: number;
  title: string;
  rating: number;
  text: string;
  createdAt: string;
  game: GameRef | null;
  company: { id: number; name: string; logoUrl: string | null } | null;
  _count: { likes: number; dislikes: number; comments: number };
}

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
  recentReviews: ProfileReview[];
  calendar: { playedAt: string; game: GameRef }[];
  friendState: FriendState;
  publicLists: GameListSummary[];
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
