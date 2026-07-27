// Catalogue des succès « maison ». Les définitions vivent ici (pas en base) : la
// table UserAchievement ne stocke que la clé débloquée + la date. Chaque famille
// a une métrique scalaire (voir AchievementsService.metric) et des paliers
// croissants ; la clé est `${family}_${threshold}`.

export type AchievementFamily =
  | 'completions' // jeux terminés (manuel + 100 % plateforme), distincts
  | 'perfect' // 100 % plateforme (Steam/Xbox/PSN), distincts
  | 'reviews' // avis écrits
  | 'lists' // listes créées
  | 'friends' // amis (acceptés)
  | 'genres' // genres différents parmi les jeux terminés
  | 'studio' // max jeux notés d'un même studio
  | 'linked' // comptes plateforme liés (Steam / Xbox / PlayStation)
  | 'popular' // total de j'aime reçus sur ses critiques
  | 'supporter' // total de j'aime donnés aux critiques des autres
  | 'favorite' // critiques notées 10/10
  | 'harsh' // critiques notées 0
  | 'veteran'; // ancienneté du compte (mois)

export interface AchievementDef {
  key: string;
  family: AchievementFamily;
  // Palier dans la famille (1 = bronze, 2 = argent, 3 = or, 4 = platine, 5 = diamant)
  tier: number;
  threshold: number;
  // Emoji d'icône (même famille = même emoji ; la couleur du palier fait le reste)
  icon: string;
}

// Icône par famille (emoji — l'affichage utilise des SVG thématiques côté front,
// ce champ n'est plus lu par l'UI mais gardé pour compat/logs).
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

// Forme d'une carte de succès dans le feed (construite à l'identique par le
// broadcast temps réel et par getFeed pour un rendu cohérent).
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
