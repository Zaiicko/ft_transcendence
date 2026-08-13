import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiLang } from '../i18n';

// Keeps the visible URL's ?lang= in sync with the active UI language, purely
// so a link copied straight from the address bar carries enough info for the
// Open Graph card (see backend/src/og) to render in the sharer's language.
// A link preview is fetched ONCE per URL by the crawler and cached by the
// platform for everyone who later sees that message/embed — there's no
// "current viewer" to adapt to, only the sharer's language at the moment the
// link left the app. apiLang() returns '' for English (the fallback both
// here and server-side), so an English visitor's URL stays clean.
//
// Goes through setSearchParams' functional-updater form — same as
// PublicProfile's own ?tab= sync and ReviewsSection's ?review= sync — rather
// than a raw navigate() built off a manually-read location snapshot. Several
// of these URL-sync effects can fire in the very same commit (e.g. this hook
// in Game.tsx's render alongside ReviewsSection's own effect one level down),
// and only the updater form is guaranteed to resolve against each other's
// just-applied change instead of clobbering it with a stale `prev`.
export function useOgLangSync() {
  const { i18n } = useTranslation();
  const [, setSearchParams] = useSearchParams();

  useEffect(() => {
    const want = apiLang();
    setSearchParams(
      (prev) => {
        if ((prev.get('lang') ?? '') === want) return prev;
        const next = new URLSearchParams(prev);
        if (want) next.set('lang', want);
        else next.delete('lang');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.resolvedLanguage, i18n.language]);
}
