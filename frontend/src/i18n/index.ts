import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import nl from './locales/nl.json';
import pl from './locales/pl.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';
import zh from './locales/zh.json';

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

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
      de: { translation: de },
      it: { translation: it },
      pt: { translation: pt },
      nl: { translation: nl },
      pl: { translation: pl },
      tr: { translation: tr },
      zh: { translation: zh },
      ja: { translation: ja },
      ko: { translation: ko },
      ru: { translation: ru },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
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
