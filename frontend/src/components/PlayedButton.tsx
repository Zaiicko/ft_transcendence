import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';

// Compteur "l'ont fait" + la marque du viewer (null si anonyme / pas marqué)
type PlayedInfo = {
  count: number;
  mine: { status: string; playedAt: string | null } | null;
};

// Knob "je l'ai fait" (coche cerclée filaire, ambre quand posé) + phrase
// compteur optionnelle. Marque PLAYED sans review — alimente le calendrier
// de complétion du profil et le compteur par jeu.
export default function PlayedButton({
  gameId,
  onDark = false,
  showCount = false,
  refreshKey = 0,
}: {
  gameId: number;
  onDark?: boolean;
  showCount?: boolean;
  // Incrémenté par le parent (ex : après avoir posté un avis, qui marque le jeu
  // "fait" côté serveur) pour forcer un rechargement de l'état "fait".
  refreshKey?: number;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [played, setPlayed] = useState<PlayedInfo | null>(null);

  // Rechargé quand la session change : `mine` dépend du cookie du viewer
  useEffect(() => {
    let cancelled = false;
    apiFetch<PlayedInfo>(`/games/${gameId}/played`)
      .then((p) => {
        if (!cancelled) setPlayed(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, user?.id, refreshKey]);

  const marked = played?.mine?.status === 'PLAYED';

  async function toggle() {
    if (!user || !played) return;
    if (marked) {
      await apiFetch(`/games/${gameId}/played`, { method: 'DELETE' });
      setPlayed({ count: Math.max(0, played.count - 1), mine: null });
    } else {
      const mine = await apiFetch<PlayedInfo['mine']>(`/games/${gameId}/played`, {
        method: 'PUT',
      });
      setPlayed({ count: played.count + 1, mine });
    }
  }

  const showPhrase = showCount && played != null && played.count > 0;
  if (!user && !showPhrase) return null;

  return (
    <div className="flex items-center gap-3">
      {user && (
        <button
          type="button"
          onClick={toggle}
          title={marked ? t('game.markedTitle') : t('game.markTitle')}
          aria-label={marked ? t('game.unmarkAria') : t('game.markAria')}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
            marked
              ? 'border-accent bg-accent text-zinc-950'
              : onDark
                ? 'border-zinc-100/25 bg-zinc-950/30 text-zinc-200 backdrop-blur hover:border-accent hover:text-accent'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
          }`}
        >
          {/* Coche cerclée filaire (trait 1.6, style TiMN) : "fait" */}
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 fill-none stroke-current"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
          </svg>
        </button>
      )}
      {showPhrase && (
        <span className={`text-xs ${onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {t(played.count === 1 ? 'game.playedOne' : 'game.playedMany', { count: played.count })}
        </span>
      )}
    </div>
  );
}
