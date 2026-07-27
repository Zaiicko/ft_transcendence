import { AchievementFamily } from './types';

// Clés i18n par famille : nom court + gabarit de description (avec {{count}}).
export const FAMILY_NAME_KEY: Record<AchievementFamily, string> = {
  completions: 'achievements.fam.completions',
  perfect: 'achievements.fam.perfect',
  reviews: 'achievements.fam.reviews',
  lists: 'achievements.fam.lists',
  friends: 'achievements.fam.friends',
  genres: 'achievements.fam.genres',
  studio: 'achievements.fam.studio',
  linked: 'achievements.fam.linked',
  popular: 'achievements.fam.popular',
  supporter: 'achievements.fam.supporter',
  favorite: 'achievements.fam.favorite',
  harsh: 'achievements.fam.harsh',
  veteran: 'achievements.fam.veteran',
};

export const FAMILY_DESC_KEY: Record<AchievementFamily, string> = {
  completions: 'achievements.desc.completions',
  perfect: 'achievements.desc.perfect',
  reviews: 'achievements.desc.reviews',
  lists: 'achievements.desc.lists',
  friends: 'achievements.desc.friends',
  genres: 'achievements.desc.genres',
  studio: 'achievements.desc.studio',
  linked: 'achievements.desc.linked',
  popular: 'achievements.desc.popular',
  supporter: 'achievements.desc.supporter',
  favorite: 'achievements.desc.favorite',
  harsh: 'achievements.desc.harsh',
  veteran: 'achievements.desc.veteran',
};

// Décompose une clé de succès ('completions_50') en famille + seuil.
export function parseAchievementKey(key: string): { family: AchievementFamily; threshold: number } {
  const m = key.match(/^(.*)_(\d+)$/);
  return {
    family: (m?.[1] ?? key) as AchievementFamily,
    threshold: m ? Number(m[2]) : 0,
  };
}

// Couleur du palier (bronze → diamant) : pastille de l'icône d'un succès débloqué.
export function tierClasses(tier: number): string {
  switch (tier) {
    case 1:
      return 'bg-amber-700/15 text-amber-700 ring-amber-700/40 dark:text-amber-500';
    case 2:
      return 'bg-zinc-400/15 text-zinc-500 ring-zinc-400/50 dark:text-zinc-300';
    case 3:
      return 'bg-yellow-500/15 text-yellow-600 ring-yellow-500/50 dark:text-yellow-400';
    case 4:
      return 'bg-cyan-500/15 text-cyan-600 ring-cyan-500/50 dark:text-cyan-400';
    default:
      return 'bg-fuchsia-500/15 text-fuchsia-600 ring-fuchsia-500/50 dark:text-fuchsia-400';
  }
}
