import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
// Depends on location.pathname, not just the language: /game/:id, /company/:id
// and /u/:username all match the SAME route regardless of which id/username,
// so react-router reuses the existing component instance instead of
// remounting it when you navigate from one game/profile to another — this
// hook's effect would otherwise only ever fire once per language choice and
// silently stop tagging the URL after that first run. Concretely: clicking a
// friend from the Friends *page* (a different route → fresh mount → works)
// looked fine, while clicking your own profile from the navbar or a search
// result — reachable from any page, including while already viewing another
// profile (same route → no remount → this hook never re-ran) — silently
// stopped tagging the URL after the first profile of the session. Verified
// with an isolated repro (real hooks, jsdom, no mocks): ?lang= was
// permanently missing on a same-route navigation once the initial retry
// window had passed, and came back the instant location.pathname was added
// to the dependency array.
//
// Writes straight through window.history.replaceState rather than
// react-router's setSearchParams/navigate: several other effects on the same
// page can also write to the URL (PublicProfile's ?tab= sync, ReviewsSection's
// ?review= sync), and setSearchParams(updater) closes over the calling
// component's own searchParams snapshot rather than reading fresh at call
// time, so it doesn't reliably compose with a sibling effect's write in the
// same commit. Re-asserting a few times after mount/navigation absorbs that.
//
// Trade-off: react-router's own useLocation()/useSearchParams() elsewhere on
// the page won't observe this change (no popstate fires for replaceState),
// so a later react-router-driven navigation on the same mounted page could
// drop ?lang= again until the next render this hook reacts to. Acceptable
// here — the address bar being correct for copy/paste is the actual goal.
export function useOgLangSync() {
  const { i18n } = useTranslation();
  const location = useLocation();

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
  }, [i18n.resolvedLanguage, i18n.language, location.pathname]);
}
