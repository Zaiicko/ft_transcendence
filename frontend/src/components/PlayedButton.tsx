import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { useRequireAuth } from '../auth/useRequireAuth';
import { apiFetch } from '../lib/api';

// Compteur "l'ont terminé" + si le viewer l'a marqué « fait » (completedByMe).
type PlayedInfo = {
  count: number;
  completedCount: number;
  mine: { status: string; playedAt: string | null } | null;
  completedByMe: boolean;
};

// Date du jour au format YYYY-MM-DD (heure locale), pour pré-remplir le sélecteur.
function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// YYYY-MM-DD → ISO (midi local, pour ne pas décaler le jour selon le fuseau).
function toIso(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

// Bouton unique « je l'ai fait » (coche cerclée) : marque le jeu comme terminé
// (complétion manuelle → calendrier « Terminé » + feed). Marquer ouvre un petit
// sélecteur de date pré-rempli à aujourd'hui : l'user peut dater un jeu terminé
// avant son inscription ou un autre jour.
export default function PlayedButton({
  gameId,
  onDark = false,
  showCount = false,
  refreshKey = 0,
}: {
  gameId: number;
  onDark?: boolean;
  showCount?: boolean;
  // Incrémenté par le parent (ex : après avoir posté un avis) pour forcer un
  // rechargement de l'état.
  refreshKey?: number;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const [played, setPlayed] = useState<PlayedInfo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dateStr, setDateStr] = useState(todayStr);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Position fixe du popover (le bandeau de la fiche jeu masque le débordement).
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

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

  const done = played?.completedByMe ?? false;

  // Ancre le popover sous le bouton (position fixe → échappe à l'overflow).
  useLayoutEffect(() => {
    if (!pickerOpen) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      setCoords({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 256 - 8)),
        top: r.bottom + 8,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [pickerOpen]);

  async function toggle() {
    // Invité → redirection login ; déjà terminé → on retire directement ;
    // sinon on ouvre le sélecteur de date.
    if (!requireAuth() || !played) return;
    if (done) {
      await apiFetch(`/games/${gameId}/completed`, { method: 'DELETE' });
      const fresh = await apiFetch<PlayedInfo>(`/games/${gameId}/played`).catch(() => null);
      if (fresh) setPlayed(fresh);
    } else {
      setDateStr(todayStr());
      setPickerOpen((o) => !o);
    }
  }

  // Valide la date choisie et marque le jeu terminé à cette date.
  async function confirmDate() {
    if (!played || saving) return;
    setSaving(true);
    try {
      await apiFetch(`/games/${gameId}/completed`, {
        method: 'PUT',
        body: JSON.stringify({ date: toIso(dateStr) }),
      });
      const fresh = await apiFetch<PlayedInfo>(`/games/${gameId}/played`).catch(() => null);
      if (fresh) setPlayed(fresh);
      setPickerOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const showPhrase = showCount && played != null && played.completedCount > 0;

  const knob = (active: boolean, activeCls: string) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
      active
        ? activeCls
        : onDark
          ? 'border-zinc-100/25 bg-zinc-950/30 text-zinc-200 backdrop-blur hover:border-accent hover:text-accent'
          : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
    }`;

  return (
    <div ref={wrapRef} className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        title={done ? t('game.markedTitle') : t('game.markTitle')}
        aria-label={done ? t('game.unmarkAria') : t('game.markAria')}
        aria-pressed={done}
        className={knob(done, 'border-accent bg-accent text-zinc-950')}
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

      {showPhrase && (
        <span
          className={`ml-1 text-xs leading-tight ${
            onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {t(played.completedCount === 1 ? 'game.completedCountOne' : 'game.completedCountMany', {
            count: played.completedCount,
          })}
        </span>
      )}

      {pickerOpen && coords && (
        <>
          {/* Fond cliquable pour fermer sans valider */}
          <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} aria-hidden="true" />
          <div
            className="fixed z-40 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: coords.left, top: coords.top }}
          >
            <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {t('game.completeDateTitle')}
            </p>
            <input
              type="date"
              value={dateStr}
              max={todayStr()}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-accent focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('game.markDateHint')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmDate}
                disabled={saving || !dateStr}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-zinc-950 hover:opacity-90 disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
