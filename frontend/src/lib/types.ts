export type AuthProvider = 'LOCAL' | 'GOOGLE' | 'STEAM' | 'DISCORD';

// Row returned by GET /games (list/search) — score = Bayesian blend of IGDB rating + user ratings (see docs/reviews-api.md).
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
  igdbRatingCount?: number | null;
  steamScore?: number | null;
  steamRatingCount?: number | null;
  genres?: { id: number; name: string }[];
  platforms?: { id: number; name: string }[];
  companies?: { id: number; name: string; logoUrl: string | null }[];
  // Only on GET /games/:id: the parent game if this is a DLC/expansion, and its own DLCs/expansions.
  parent?: { id: number; title: string; coverUrl: string | null } | null;
  dlcs?: GameDlc[];
  // Only on GET /games/recommendations: why this game is recommended (deciding genre + optional well-rated anchor game).
  reason?: RecommendationReason | null;
}

// Varied reason for a recommendation (the backend alternates types across cards). Discriminated union on `kind`:
//  - 'game'   : an anchor game (liked or played) → "because you liked/played X"
//  - 'studio' : a liked studio → "because you like X's games"
//  - 'genre'  : a liked genre → "because you like X"
export type RecommendationReason =
  | { kind: 'game'; game: { id: number; title: string; kind: 'liked' | 'played' } }
  | { kind: 'studio'; studio: { id: number; name: string } }
  | { kind: 'genre'; genre: { id: number; name: string } };

// GET /users/me/home-stats — the home "your year in games" stat strip.
export interface HomeStats {
  done: number; // games marked "done" (amber series)
  perfect: number; // 100% games on a platform (green series)
  reviews: number;
  avgRating: number | null; // null if no reviews
  achievements: { unlocked: number; total: number };
  rank: { rank: number } | null; // world rank (completions), null if unranked
}

// GET /home/landing — public home data (anonymous visitor): real site figures + global podium (all-time completions).
export interface LandingTopPlayer {
  metric: LeaderboardMetric; // #1 of this category
  user: { id: number; username: string; avatarUrl: string | null };
  score: number;
}
export interface HomeLanding {
  games: number;
  reviews: number;
  players: number;
  topPlayers: LandingTopPlayer[];
}

// GET /companies/:id — studio page + its main games.
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

// Extra content attached to a game (DLC, expansion, standalone).
export interface GameDlc {
  id: number;
  title: string;
  coverUrl: string | null;
  releaseDate?: string | null;
  gameType: string;
  igdbRating?: number | null;
}

// GET /games/facets — available catalog filters (only those actually attached to games, most-used first).
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

// List summary (card) — GET /lists/mine, public profile, etc.
export interface GameListSummary {
  id: number;
  name: string;
  isPublic: boolean;
  coverUrl: string | null; // custom cover image (upload), else null
  gameCount: number;
  covers: string[]; // up to 5 covers for the stacked preview
  contains?: boolean; // present when /lists/mine is called with ?gameId=
}

// List detail — GET /lists/:id
export interface GameListDetail {
  id: number;
  name: string;
  isPublic: boolean;
  coverUrl: string | null;
  owner: { id: number; username: string; avatarUrl: string | null };
  games: {
    id: number;
    title: string;
    coverUrl: string | null;
    releaseDate: string | null;
    // The list owner's review of this game (rating + excerpt), if rated
    review: { id: number; rating: number; title: string; text: string } | null;
  }[];
}

// ---- Notifications ----
export type NotificationType =
  | 'FRIEND_REQUEST'
  | 'FRIEND_ACCEPT'
  | 'REVIEW_LIKE'
  | 'REVIEW_COMMENT'
  | 'COMMENT_REPLY'
  | 'NEW_MESSAGE'
  | 'FRIEND_JOINED'
  | 'ACHIEVEMENT'
  | 'GAME_INVITE';

// payload depends on type; all fields are therefore optional on the front
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
    // FRIEND_JOINED: which network this contact joined through ('42' is
    // legacy — only ever appears in notifications stored before the 42
    // OAuth login was retired, kept here so old ones still render).
    via?: 'steam' | '42';
    // ACHIEVEMENT: key of the unlocked achievement
    achievementKey?: string;
    // GAME_INVITE: which mini-game match this invite targets
    matchId?: string;
    difficulty?: string;
  };
  readAt: string | null;
  createdAt: string;
}

// ---- Chat / messaging ----
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
  // Share previews: at most one non-null depending on `type`.
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

// Item from GET /reviews/highlights — user null = deleted account; exactly one of game/company is non-null.
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

// ---- Friend activity feed (GET /feed + WS event `feed:new`) ----
export type FeedActor = { id: number; username: string; avatarUrl: string | null };
export type FeedGameRef = { id: number; title: string; coverUrl: string | null };

type FeedCompanyRef = { id: number; name: string; logoUrl: string | null };

// Review/comment targeted by a "like" (enough for label + link).
export interface FeedReviewTarget {
  id: number;
  title: string;
  user: FeedActor | null;
  game: FeedGameRef | null;
  company: FeedCompanyRef | null;
}
export interface FeedCommentTarget {
  id: number;
  text: string;
  user: FeedActor | null;
  review: { id: number; game: FeedGameRef | null; company: FeedCompanyRef | null };
}

// `id` unique across all types (prefixed), `at` = action date (sort + "load more" cursor).
export type FeedItem =
  | { id: string; kind: 'review'; at: string; review: ReviewHighlight }
  | { id: string; kind: 'completed'; at: string; actor: FeedActor; game: FeedGameRef; platform: string }
  | { id: string; kind: 'review-like'; at: string; actor: FeedActor; review: FeedReviewTarget }
  | { id: string; kind: 'comment-like'; at: string; actor: FeedActor; comment: FeedCommentTarget }
  | {
      id: string;
      kind: 'rank';
      at: string;
      actor: FeedActor;
      metric: LeaderboardMetric;
      scope: 'global' | 'friends';
      rank: number;
    }
  | {
      id: string;
      kind: 'achievement';
      at: string;
      actor: FeedActor;
      key: string;
      family: AchievementFamily;
      tier: number;
      threshold: number;
      icon: string;
    };

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

// ---- Leaderboards (GET /leaderboard) ----
export type LeaderboardMetric = 'completions' | 'played' | 'reviews';
export type LeaderboardScope = 'friends' | 'global';
export type LeaderboardWindow = 'all' | 'month';

export interface LeaderboardRow {
  rank: number;
  user: { id: number; username: string; avatarUrl: string | null };
  score: number;
}

export interface LeaderboardResult {
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  rows: LeaderboardRow[];
  // Viewer's rank even outside the shown top; null if unranked.
  me: { rank: number; score: number } | null;
}

// A user's global (all-time) podium on a metric: feeds the rank badge next to the username; only ranks 1-3 are returned.
export interface LeaderboardBadge {
  metric: LeaderboardMetric;
  rank: number;
}

// ---- In-house achievements (GET /achievements/user/:id) ----
export type AchievementFamily =
  | 'completions'
  | 'perfect'
  | 'reviews'
  | 'lists'
  | 'friends'
  | 'genres'
  | 'studio'
  | 'linked'
  | 'popular'
  | 'supporter'
  | 'favorite'
  | 'harsh'
  | 'veteran';

export interface Achievement {
  key: string;
  family: AchievementFamily;
  tier: number; // 1 = bronze … 5 = diamond
  threshold: number;
  icon: string; // emoji
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number; // current value clamped to the threshold
}

// GET /achievements/user/:id — achievements + games illustrating some families (rated 10 = favorites, rated 0 = harsh reviews).
export interface AchievementsPayload {
  items: Achievement[];
  ratedGames: { favorite: GameRef[]; harsh: GameRef[] };
}

// Viewer's relationship with the profile owner (drives the friend button)
export type FriendState = 'self' | 'friends' | 'incoming' | 'outgoing' | 'none';

export type GameRef = { id: number; title: string; coverUrl: string | null };

// GET /users/profile/:username/played — every game this user has completed
export interface ProfilePlayedGame {
  playedAt: string;
  game: GameRef;
}

// A review as shown on the profile (profile seed + GET /users/profile/:username/reviews). Exactly one of game/company is non-null.
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
  psnLinked: boolean;
  xboxLinked: boolean;
  createdAt: string;
  reviewCount: number;
  playedCount: number;
  rank: { rank: number } | null; // world rank (completions), null if unranked
  topGames: { rating: number; game: GameRef }[];
  recentReviews: ProfileReview[];
  // Completion calendar — two series: `completions` = games marked "done" by hand (amber), `perfectGames` = 100% platform (green).
  completions: { playedAt: string; game: GameRef }[];
  perfectGames: { playedAt: string; game: GameRef }[];
  friendState: FriendState;
  publicLists: GameListSummary[];
  // List count shown in the tab: total (private included) for the owner, else only public ones.
  listCount: number;
}

export interface PublicUser {
  id: number;
  email: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  provider: AuthProvider;
  steamId: string | null;
  discordId: string | null;
  // PlayStation linked via psn-api: the NPSSO token and accountId stay on the backend; only the linked state + onlineId are exposed.
  psnLinked: boolean;
  psnOnlineId: string | null;
  // Xbox linked via OpenXBL: the service key and XUID stay on the backend; only the linked state + gamertag are exposed. Mirror of psnLinked.
  xboxLinked: boolean;
  xboxGamertag: string | null;
  // Whether other users can see this account's linked libraries via the
  // "View library" button on the public profile. Never affects the owner's
  // own view. Public by default (opt-out) — see backend/prisma/schema.prisma.
  libraryPublic: boolean;
  hasPassword: boolean;
  // Onboarding wizard finished or explicitly skipped. While false, redirect to /welcome (see ProtectedRoute).
  onboarded: boolean;
  // Guided tour already seen or skipped. While false (and onboarded true), it auto-starts once.
  tutorialSeen: boolean;
  twoFactorEnabled: boolean;
  emailVerifiedAt: string | null;
  language: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}
