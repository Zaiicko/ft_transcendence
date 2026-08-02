import type { TFunction } from 'i18next';

// IGDB genres (stored in English) translated via the i18n `genres` namespace, falling back to the raw name.
export function translateGenre(name: string, t: TFunction): string {
  return t(`genres.${name}`, { defaultValue: name });
}
