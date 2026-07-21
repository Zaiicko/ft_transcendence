import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch } from '../lib/api';

// Grille de langues (drapeau + nom natif, jamais traduit) — utilisée dans la
// fenêtre ouverte depuis le menu rouage. Persistance immédiate en
// localStorage (via i18next-browser-languagedetector) et, si connecté, sur
// le profil (best-effort : un échec réseau ne bloque jamais le changement
// de langue local, qui reste la source de vérité affichée).
export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { user, refreshUser } = useAuth();

  function selectLanguage(code: LanguageCode) {
    void i18n.changeLanguage(code);
    if (user) {
      apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ language: code }) })
        .then(() => refreshUser())
        .catch(() => {});
    }
  }

  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {SUPPORTED_LANGUAGES.map((lang) => {
        const active = i18n.resolvedLanguage === lang.code;
        return (
          <li key={lang.code}>
            <button
              type="button"
              onClick={() => selectLanguage(lang.code)}
              aria-pressed={active}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                active
                  ? 'bg-accent font-medium text-zinc-950'
                  : 'hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10'
              }`}
            >
              <span aria-hidden="true">{lang.flag}</span>
              {lang.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
