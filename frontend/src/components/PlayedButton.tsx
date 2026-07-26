import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { useRequireAuth } from '../auth/useRequireAuth';
import { apiFetch } from '../lib/api';

// Compteur "l'ont fait" + la marque du viewer (null si anonyme / pas marqué) +
// s'il a marqué le jeu « terminé » à la main (completedByMe).
type PlayedInfo = {
  count: number;
  completedCount: number;
  mine: { status: string; playedAt: string | null } | null;
  completedByMe: boolean;
};

// Deux boutons filaires : « je l'ai fait » (coche cerclée, ambre) et « terminé »
// (trophée, emerald). Le premier marque PLAYED ; le second crée une complétion
// manuelle (calendrier vert + feed). Terminer implique avoir joué → le back pose
// aussi PLAYED, d'où le rechargement de l'état après coup.
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
  const requireAuth = useRequireAuth();
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
  const completed = played?.completedByMe ?? false;

  async function toggle() {
    // Invité → redirection login (retour ici après connexion) ; sinon on agit.
    if (!requireAuth()) return;
    if (!played) return;
    if (marked) {
      await apiFetch(`/games/${gameId}/played`, { method: 'DELETE' });
      setPlayed({ ...played, count: Math.max(0, played.count - 1), mine: null });
    } else {
      const mine = await apiFetch<PlayedInfo['mine']>(`/games/${gameId}/played`, {
        method: 'PUT',
      });
      setPlayed({ ...played, count: played.count + 1, mine });
    }
  }

  async function toggleCompleted() {
    if (!requireAuth()) return;
    if (!played) return;
    await apiFetch(`/games/${gameId}/completed`, { method: completed ? 'DELETE' : 'PUT' });
    // Marquer « terminé » pose aussi PLAYED côté back → on recharge l'état complet.
    const fresh = await apiFetch<PlayedInfo>(`/games/${gameId}/played`).catch(() => null);
    if (fresh) setPlayed(fresh);
  }

  const showPhrase =
    showCount && played != null && (played.count > 0 || played.completedCount > 0);

  const knob = (active: boolean, activeCls: string) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
      active
        ? activeCls
        : onDark
          ? 'border-zinc-100/25 bg-zinc-950/30 text-zinc-200 backdrop-blur hover:border-accent hover:text-accent'
          : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
    }`;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        title={marked ? t('game.markedTitle') : t('game.markTitle')}
        aria-label={marked ? t('game.unmarkAria') : t('game.markAria')}
        className={knob(marked, 'border-accent bg-accent text-zinc-950')}
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

      <button
        type="button"
        onClick={toggleCompleted}
        title={completed ? t('game.completedTitle') : t('game.completeTitle')}
        aria-label={completed ? t('game.uncompleteAria') : t('game.completeAria')}
        aria-pressed={completed}
        className={knob(completed, 'border-emerald-500 bg-emerald-500 text-zinc-950')}
      >
        {/* Trophée filaire : "terminé" */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 fill-none stroke-current"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
          <path d="M7 6H5a2 2 0 0 0 0 4h1.5M17 6h2a2 2 0 0 1 0 4h-1.5" />
          <path d="M12 14v3M9 21h6M10 21c0-1.5.5-2.5 2-2.5s2 1 2 2.5" />
        </svg>
      </button>

      {showPhrase && (
        // Empilé (2 lignes courtes) : compact en largeur, clair à côté du bookmark.
        <span
          className={`ml-1 flex flex-col text-xs leading-tight ${
            onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {played.count > 0 && (
            <span>
              {t(played.count === 1 ? 'game.playedOne' : 'game.playedMany', { count: played.count })}
            </span>
          )}
          {played.completedCount > 0 && (
            <span>
              {t(played.completedCount === 1 ? 'game.completedCountOne' : 'game.completedCountMany', {
                count: played.completedCount,
              })}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
