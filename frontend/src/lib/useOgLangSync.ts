import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
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
// react-router-dom's setSearchParams(updater) closes over the *rendering
// component's own* searchParams snapshot (a useMemo keyed on location.search
// — see useSearchParams' source), not a fresh read at call time the way
// useState's functional updater is. So when a sibling/child effect (e.g.
// PublicProfile's ?tab= sync, ReviewsSection's ?review= sync) writes to the
// URL in the very same commit, whichever effect's navigate() lands last wins
// outright — the "updater form" does NOT protect against that the way it
// would for plain React state.
//
// Fix: depend on location.search too, so a write from anywhere else
// re-triggers this effect on the next render, where it re-reads the
// now-current params and re-applies ?lang= if it got dropped. This
// self-heals within one or two extra renders regardless of effect order,
// and is a no-op (doesn't call setSearchParams again) once ?lang= is
// already correct, so it converges instead of looping.
export function useOgLangSync() {
  const { i18n } = useTranslation();
  const location = useLocation();
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
  }, [i18n.resolvedLanguage, i18n.language, location.search]);
}
