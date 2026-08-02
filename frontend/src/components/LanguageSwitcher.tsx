import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LanguageCode, loadLanguage, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch } from '../lib/api';

// Language grid (flag + native name): the choice is applied only on CLOSE (unmount) to avoid re-rendering the app while picking.
export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { user, refreshUser } = useAuth();

  const initial = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as LanguageCode;
  const [pending, setPending] = useState<LanguageCode>(initial);

  // Ref kept current in an effect so the latest choice can be read at unmount.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });

  useEffect(() => {
    return () => {
      const code = pendingRef.current;
      if (code === initial) return;
      // Load the locale (lazy) before switching to avoid a flash of raw keys.
      void loadLanguage(code).then(() => i18n.changeLanguage(code));
      if (user) {
        apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ language: code }) })
          .then(() => refreshUser())
          .catch(() => {});
      }
    };
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
