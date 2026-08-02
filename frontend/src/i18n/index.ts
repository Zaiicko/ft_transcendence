import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

// Native display name + flag per language, always shown in its own language (never translated).
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

// i18next-browser-languagedetector storage key — not "language", to avoid clashing with the profile's language field.
export const LANGUAGE_STORAGE_KEY = 'saveboxd_language';

// Locale loaders: each JSON is a separate dynamic chunk; only the active language (+ en fallback) loads at startup.
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

// Mirrors the LanguageDetector (localStorage then navigator), folded to a supported flat code, to preload the right locale before init.
function detectInitialLanguage(): LanguageCode {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && SUPPORTED_CODES.includes(stored)) return stored as LanguageCode;
  const nav = (navigator.language || 'en').split('-')[0];
  return (SUPPORTED_CODES.includes(nav) ? nav : 'en') as LanguageCode;
}

// Download and register a locale once (no-op if already loaded).
export async function loadLanguage(code: LanguageCode): Promise<void> {
  if (i18n.hasResourceBundle(code, 'translation')) return;
  const mod = await LOADERS[code]();
  i18n.addResourceBundle(code, 'translation', mod.default, true, true);
}

// Init promise: main.tsx awaits it before rendering, so nothing ever shows raw keys.
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
      // Fold browser regional variants down to our flat codes.
      load: 'languageOnly',
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        caches: ['localStorage'],
        // Fold regional variants (fr-FR → fr) at detection time so i18n.language is always a supported flat code.
        convertDetectedLanguage: (lng: string) => lng.split('-')[0],
      },
      interpolation: { escapeValue: false },
    });
})();

// Keep <html lang> in sync with the active language (WCAG 3.1.1), using the flat resolved code.
function syncHtmlLang() {
  document.documentElement.lang = i18n.resolvedLanguage || i18n.language || 'en';
}
i18n.on('initialized', syncHtmlLang);
i18n.on('languageChanged', syncHtmlLang);

// Base language code for the games API `?lang=` param — folded to a flat code, '' for English/unsupported (meaning "no translation").
export function apiLang(): string {
  const base = (i18n.resolvedLanguage || i18n.language || '').split('-')[0];
  return base !== 'en' && SUPPORTED_LANGUAGES.some((l) => l.code === base) ? base : '';
}

export default i18n;
