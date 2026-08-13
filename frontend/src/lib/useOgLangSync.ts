import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
// Reads/writes window.location directly rather than useSearchParams' snapshot:
// this can run in the same commit as ReviewsSection's own ?review= sync (a
// sibling/child effect), and both must merge onto whatever the other just
// wrote instead of clobbering it from a stale closure.
export function useOgLangSync() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const want = apiLang();
    const params = new URLSearchParams(window.location.search);
    const current = params.get('lang') ?? '';
    if (current === want) return;
    if (want) params.set('lang', want);
    else params.delete('lang');
    const qs = params.toString();
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.resolvedLanguage, i18n.language, location.pathname]);
}
