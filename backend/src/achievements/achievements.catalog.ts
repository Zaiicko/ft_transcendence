// In-house achievement catalog. Definitions live here rather than in the DB:
// UserAchievement only stores the unlocked key and its date. Each family has a
// scalar metric (see AchievementsService.metric) and rising tiers; the key is
// `${family}_${threshold}`.

export type AchievementFamily =
  | 'completions' // distinct finished games (manual + platform 100%)
  | 'perfect' // distinct platform 100% (Steam/Xbox/PSN)
  | 'reviews' // reviews written
  | 'lists' // lists created
  | 'friends' // accepted friends
  | 'genres' // distinct genres among finished games
  | 'studio' // most rated games from one studio
  | 'linked' // linked platform accounts (Steam / Xbox / PlayStation)
  | 'popular' // likes received on their reviews
  | 'supporter' // likes given to other people's reviews
  | 'favorite' // reviews rated 10/10
  | 'harsh' // reviews rated 0
  | 'veteran'; // account age in months

export interface AchievementDef {
  key: string;
  family: AchievementFamily;
  // Tier within the family (1 bronze, 2 silver, 3 gold, 4 platinum, 5 diamond)
  tier: number;
  threshold: number;
  // Icon emoji: same family means same emoji, the tier colour does the rest
  icon: string;
}

// Emoji per family. The front renders themed SVGs instead, so the UI no longer
// reads this field — kept for compatibility and logs.
const ICON: Record<AchievementFamily, string> = {
  completions: '🏁',
  perfect: '💯',
  reviews: '✍️',
  lists: '📋',
  friends: '👥',
  genres: '🧭',
  studio: '⭐',
  linked: '🔗',
  popular: '🔥',
  supporter: '❤️',
  favorite: '⭐',
  harsh: '👎',
  veteran: '⏳',
};

// Paliers par famille (ordre croissant → tier 1..n)
const TIERS: Record<AchievementFamily, number[]> = {
  completions: [1, 10, 50, 100, 250, 500, 1000],
  perfect: [1, 10, 50, 100, 250, 500, 1000],
  reviews: [1, 10, 50, 100],
  lists: [1, 3, 6],
  friends: [1, 10, 25],
  genres: [5, 15],
  studio: [5, 10],
  linked: [1, 3], // 1 = un compte lié ; 3 = Steam + Xbox + PlayStation
  popular: [10, 50, 100, 250], // total de j'aime reçus sur ses critiques
  supporter: [10, 50, 100, 250], // j'aime donnés
  favorite: [1, 10, 25], // critiques 10/10
  harsh: [1, 5, 10], // critiques notées 0
  veteran: [1, 6, 12, 24], // mois d'ancienneté
};

export const ALL_ACHIEVEMENTS: AchievementDef[] = (
  Object.keys(TIERS) as AchievementFamily[]
).flatMap((family) =>
  TIERS[family].map((threshold, i) => ({
    key: `${family}_${threshold}`,
    family,
    tier: i + 1,
    threshold,
    icon: ICON[family],
  })),
);

const BY_KEY = new Map(ALL_ACHIEVEMENTS.map((a) => [a.key, a]));

export function getAchievement(key: string): AchievementDef | undefined {
  return BY_KEY.get(key);
}

export const ACHIEVEMENT_FAMILIES = Object.keys(TIERS) as AchievementFamily[];

// Shape of an achievement card in the feed, built identically by the real-time
// broadcast and by getFeed so both render the same.
export interface AchievementFeedItem {
  id: string;
  kind: 'achievement';
  at: string;
  actor: { id: number; username: string; avatarUrl: string | null };
  key: string;
  family: AchievementFamily;
  tier: number;
  threshold: number;
  icon: string;
}

export function buildAchievementFeedItem(row: {
  id: number;
  key: string;
  unlockedAt: Date;
  user: { id: number; username: string; avatarUrl: string | null };
}): AchievementFeedItem | null {
  const def = getAchievement(row.key);
  if (!def) return null;
  return {
    id: `achievement-${row.id}`,
    kind: 'achievement',
    at: row.unlockedAt.toISOString(),
    actor: row.user,
    key: def.key,
    family: def.family,
    tier: def.tier,
    threshold: def.threshold,
    icon: def.icon,
  };
}
