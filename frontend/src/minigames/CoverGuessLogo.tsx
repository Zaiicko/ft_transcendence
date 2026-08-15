import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

// Decorative "logo" for the cover-guess card on the mini-games hub: fetches
// a real round cover (the same endpoint local play draws from) purely to
// animate it blurring/clearing on a loop — a little preview of the game
// itself. The roundToken that comes with it is never used; it just expires
// unused like any other local round nobody played.
export default function CoverGuessLogo({ className }: { className?: string }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ coverUrl: string }>('/minigames/cover-guess/round?difficulty=easy&exclude=')
      .then((r) => {
        if (!cancelled) setCoverUrl(r.coverUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800 ${className ?? ''}`}>
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-full w-full animate-cover-guess-reveal object-cover"
        />
      )}
    </div>
  );
}
