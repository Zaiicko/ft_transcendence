import { useEffect } from 'react';
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
// Writes straight through window.history.replaceState, deliberately
// bypassing react-router's setSearchParams/navigate. Two earlier attempts
// went through react-router (first a plain navigate() off a manually-read
// location snapshot, then setSearchParams' functional-updater form) on the
// theory that a sibling URL-writing effect on the same page — PublicProfile's
// ?tab= sync, ReviewsSection's ?review= sync — could race it in the same
// commit and clobber a stale `prev`. Both were fixed for every repro that
// theory predicted (verified with an isolated harness: real hooks, jsdom, no
// mocks — including the exact React.lazy()+Suspense structure every route
// actually uses), yet ?lang= still never appeared on landing on a profile
// page in production, only after a live language change. Since the exact
// mechanism defeating react-router's own state resolved every synthetic
// repro but not the real one, this sidesteps react-router's location state
// entirely for the write and re-asserts a few times right after mount to
// absorb whatever, still unidentified, is overwriting it.
//
// Trade-off: react-router's own useLocation()/useSearchParams() elsewhere on
// the page won't observe this change (no popstate fires for replaceState),
// so a later react-router-driven navigation on the same mounted page could
// drop ?lang= again until the next language-triggered re-run. Acceptable
// here — the address bar being correct for copy/paste is the actual goal.
export function useOgLangSync() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const want = apiLang();
    let cancelled = false;

    function apply() {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      if ((params.get('lang') ?? '') === want) return;
      if (want) params.set('lang', want);
      else params.delete('lang');
      const qs = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
      );
    }

    apply();
    const timers = [50, 150, 400, 800, 1500].map((ms) => setTimeout(apply, ms));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [i18n.resolvedLanguage, i18n.language]);
}
