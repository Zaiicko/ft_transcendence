import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import type { LeaderboardBadge, LeaderboardMetric } from '../lib/types';

// Teinte du podium (or / argent / bronze), cohérente avec la page Classement.
const MEDAL_COLOR: Record<number, string> = {
  1: 'text-amber-400',
  2: 'text-zinc-400',
  3: 'text-amber-700',
};

// Réutilise les libellés de métrique déjà traduits (13 langues) de la page Classement.
const METRIC_LABEL: Record<LeaderboardMetric, string> = {
  completions: 'leaderboard.metricCompletions',
  played: 'leaderboard.metricPlayed',
  reviews: 'leaderboard.metricReviews',
};

// Cache mémoire par userId : une page de reviews peut afficher plusieurs badges
// (voire le même auteur plusieurs fois) — on ne récupère les podiums qu'une fois
// par utilisateur pour la session.
const badgeCache = new Map<number, Promise<LeaderboardBadge[]>>();
function fetchBadges(userId: number): Promise<LeaderboardBadge[]> {
  let p = badgeCache.get(userId);
  if (!p) {
    p = apiFetch<LeaderboardBadge[]>(`/leaderboard/badges/${userId}`).catch(() => {
      badgeCache.delete(userId); // échec : ne pas mémoriser, réessayer plus tard
      return [];
    });
    badgeCache.set(userId, p);
  }
  return p;
}

// Badge de rang affiché à côté du pseudo quand l'utilisateur est sur un podium
// GLOBAL (top 3 all-time) d'au moins une catégorie. Au survol ou au clic, une
// bulle liste les catégories concernées et le rang. La médaille prend la teinte
// du MEILLEUR rang obtenu. N'affiche rien si aucun podium.
export default function LeaderboardRankBadge({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const [badges, setBadges] = useState<LeaderboardBadge[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBadges(userId).then((b) => !cancelled && setBadges(b));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Ferme la bulle (ouverte au clic) sur un clic extérieur.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!badges || badges.length === 0) return null;

  // Rang le plus prestigieux (1 devant 3) → teinte de la médaille du badge.
  const best = badges.reduce((m, b) => Math.min(m, b.rank), Infinity);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label={t('leaderboard.badgeAria')}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${MEDAL_COLOR[best] ?? ''}`}
      >
        <MedalIcon className="h-5 w-5" />
      </button>

      {open && (
        <span className="absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 text-left shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <span className="mb-1 block whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('leaderboard.badgeTitle')}
          </span>
          <span className="flex flex-col gap-1">
            {badges.map((b) => (
              <span key={b.metric} className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                <MedalIcon className={`h-4 w-4 shrink-0 ${MEDAL_COLOR[b.rank] ?? ''}`} />
                <span className="font-semibold tabular-nums">#{b.rank}</span>
                <span className="text-zinc-600 dark:text-zinc-300">{t(METRIC_LABEL[b.metric])}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

// Même médaille filaire que la page Classement (la couleur vient de currentColor).
function MedalIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`fill-none stroke-current ${className}`}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" />
      <path d="M11 12 5.12 2.2M13 12l5.88-9.8M8 7h8" />
      <circle cx="12" cy="17" r="5" />
      <path d="M12 18v-2h-.5" />
    </svg>
  );
}
