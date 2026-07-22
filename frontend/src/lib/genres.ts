import type { TFunction } from 'i18next';

// Les genres viennent d'IGDB (stockés en anglais dans la BDD). La liste est
// finie et connue : on la traduit via le namespace i18n `genres`, en retombant
// sur le nom brut si un genre n'a pas (encore) de clé. Aucun nom de genre IGDB
// ne contient de « . » ou « : », donc utiliser le nom comme clé est sûr.
export function translateGenre(name: string, t: TFunction): string {
  return t(`genres.${name}`, { defaultValue: name });
}
