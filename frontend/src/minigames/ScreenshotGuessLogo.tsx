import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

// Decorative "logo" for the screenshot-guess card on the mini-games hub:
// fetches a real round screenshot (the same endpoint local play draws from)
// purely to animate it zooming out from a cropped detail to the full frame,
// on a loop — a little preview of the game itself. Zoom rather than blur
// (unlike CoverGuessLogo): this game has its own no-blur mode, so a
// blur-reveal animation would misrepresent it. The roundToken that comes
// with it is never used; it just expires unused like any other local round
// nobody played.
export default function ScreenshotGuessLogo({ className }: { className?: string }) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ screenshotUrl: string }>('/minigames/screenshot-guess/round?difficulty=easy&exclude=')
      .then((r) => {
        if (!cancelled) setScreenshotUrl(r.screenshotUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800 ${className ?? ''}`}>
      {screenshotUrl && (
        <img
          src={screenshotUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-full w-full animate-screenshot-guess-reveal object-cover"
        />
      )}
    </div>
  );
}
