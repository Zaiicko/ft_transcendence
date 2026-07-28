import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LanguageCode, loadLanguage, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch } from '../lib/api';

// Grille de langues (drapeau + nom natif, jamais traduit) — dans la fenêtre
// ouverte depuis le menu rouage. Le clic ne fait que MÉMORISER le choix
// (surbrillance) ; la langue n'est réellement appliquée qu'à la FERMETURE du
// sélecteur (démontage du composant), pour ne pas re-rendre toute l'app pendant
// qu'on choisit. Persistance : localStorage (via i18next) + profil si connecté
// (best-effort, un échec réseau ne bloque pas le changement local).
export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { user, refreshUser } = useAuth();

  const initial = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as LanguageCode;
  const [pending, setPending] = useState<LanguageCode>(initial);

  // Ref tenue à jour DANS un effet (jamais pendant le rendu) → permet de lire le
  // dernier choix au démontage. `initial`, lui, est figé à la valeur du montage
  // par la closure de l'effet ci-dessous (deps []).
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });

  useEffect(() => {
    return () => {
      // Lecture volontaire du dernier choix au cleanup (démontage = fermeture).
      const code = pendingRef.current;
      if (code === initial) return;
      // Charge la locale (lazy) avant de basculer, sinon flash de clés brutes.
      void loadLanguage(code).then(() => i18n.changeLanguage(code));
      if (user) {
        apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ language: code }) })
          .then(() => refreshUser())
          .catch(() => {});
      }
    };
    // Appliqué une seule fois, au démontage (= fermeture du sélecteur).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {SUPPORTED_LANGUAGES.map((lang) => {
        const active = pending === lang.code;
        return (
          <li key={lang.code}>
            <button
              type="button"
              onClick={() => setPending(lang.code)}
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
