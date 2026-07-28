import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

// Native display name + flag for each language — always shown in its own
// language (never translated), same convention as e.g. GitHub/Discord's own
// language pickers.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

// Key i18next-browser-languagedetector reads/writes — deliberately not
// "language" to avoid clashing with the (unrelated) `language` field on the
// user's profile object.
export const LANGUAGE_STORAGE_KEY = 'saveboxd_language';

// Chargeurs de locales : chaque JSON est un chunk séparé (import dynamique). On
// ne télécharge QUE la langue active (+ en en repli) au démarrage ; les autres
// arrivent à la demande via loadLanguage() lors d'un changement de langue.
const LOADERS: Record<LanguageCode, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  fr: () => import('./locales/fr.json'),
  es: () => import('./locales/es.json'),
  de: () => import('./locales/de.json'),
  it: () => import('./locales/it.json'),
  pt: () => import('./locales/pt.json'),
  nl: () => import('./locales/nl.json'),
  pl: () => import('./locales/pl.json'),
  tr: () => import('./locales/tr.json'),
  zh: () => import('./locales/zh.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  ru: () => import('./locales/ru.json'),
};

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as string[];

// Réplique la détection du LanguageDetector (localStorage puis navigator),
// repliée sur un code plat supporté — pour savoir quelle locale précharger avant
// l'init (fr-FR → fr, code inconnu → en).
function detectInitialLanguage(): LanguageCode {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && SUPPORTED_CODES.includes(stored)) return stored as LanguageCode;
  const nav = (navigator.language || 'en').split('-')[0];
  return (SUPPORTED_CODES.includes(nav) ? nav : 'en') as LanguageCode;
}

// Télécharge et enregistre une locale une seule fois (no-op si déjà chargée).
export async function loadLanguage(code: LanguageCode): Promise<void> {
  if (i18n.hasResourceBundle(code, 'translation')) return;
  const mod = await LOADERS[code]();
  i18n.addResourceBundle(code, 'translation', mod.default, true, true);
}

// Promesse d'initialisation : main.tsx l'attend avant de rendre l'app, donc
// aucun composant ne s'affiche jamais avec des clés brutes.
export const i18nReady: Promise<unknown> = (async () => {
  const initial = detectInitialLanguage();
  const [enMod, initialMod] = await Promise.all([
    LOADERS.en(),
    initial === 'en' ? Promise.resolve(null) : LOADERS[initial](),
  ]);
  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: enMod.default },
        ...(initialMod ? { [initial]: { translation: initialMod.default } } : {}),
      },
      lng: initial,
      fallbackLng: 'en',
      supportedLngs: SUPPORTED_CODES,
      // "en-US" / "fr-BE" etc. from the browser fold down to our flat codes
      load: 'languageOnly',
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        caches: ['localStorage'],
        // Fold regional variants down to our flat codes AT detection time
        // (fr-FR → fr), for the navigator value AND any stale regional code
        // already sitting in localStorage — so i18n.language is always one of
        // SUPPORTED_LANGUAGES. `load: 'languageOnly'` only affects which resource
        // files load, not i18n.language itself, hence this extra fold.
        convertDetectedLanguage: (lng: string) => lng.split('-')[0],
      },
      interpolation: { escapeValue: false },
    });
})();

// <html lang> synchronisé avec la langue active (WCAG 3.1.1 — Language of Page).
// resolvedLanguage = code plat réellement chargé (fr, jamais fr-FR). Mis à jour
// à l'init ET à chaque changement de langue.
function syncHtmlLang() {
  document.documentElement.lang = i18n.resolvedLanguage || i18n.language || 'en';
}
i18n.on('initialized', syncHtmlLang);
i18n.on('languageChanged', syncHtmlLang);

// Base language code to pass as the games API `?lang=` param. The server
// validates it with @IsIn(SUPPORTED_LANGUAGES) (flat codes only), so a regional
// code (fr-FR) 400s and the page falls back to "Game not found". We fold any
// stray variant down and return '' for English or an unsupported code, meaning
// "no translation — original text". resolvedLanguage is i18next's already
// supported-matched code; i18n.language is the raw fallback.
export function apiLang(): string {
  const base = (i18n.resolvedLanguage || i18n.language || '').split('-')[0];
  return base !== 'en' && SUPPORTED_LANGUAGES.some((l) => l.code === base) ? base : '';
}

export default i18n;
