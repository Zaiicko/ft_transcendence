import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../lib/api';
import type {
  LeaderboardMetric,
  LeaderboardResult,
  LeaderboardRow,
  LeaderboardScope,
  LeaderboardWindow,
} from '../lib/types';

const METRICS: { key: LeaderboardMetric; labelKey: string }[] = [
  { key: 'completions', labelKey: 'leaderboard.metricCompletions' },
  { key: 'played', labelKey: 'leaderboard.metricPlayed' },
  { key: 'reviews', labelKey: 'leaderboard.metricReviews' },
];
const SCOPES: { key: LeaderboardScope; labelKey: string }[] = [
  { key: 'global', labelKey: 'leaderboard.scopeGlobal' },
  { key: 'friends', labelKey: 'leaderboard.scopeFriends' },
];
const WINDOWS: { key: LeaderboardWindow; labelKey: string }[] = [
  { key: 'all', labelKey: 'leaderboard.windowAll' },
  { key: 'month', labelKey: 'leaderboard.windowMonth' },
];

// Teinte or / argent / bronze pour le podium (anneau d'avatar + score).
const PLACE = {
  1: { ring: 'ring-amber-400', text: 'text-amber-400', bar: 'from-amber-300 to-amber-500' },
  2: { ring: 'ring-zinc-400', text: 'text-zinc-400', bar: 'from-zinc-300 to-zinc-400' },
  3: { ring: 'ring-amber-700', text: 'text-amber-600', bar: 'from-amber-600 to-amber-800' },
} as const;

export default function Leaderboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [metric, setMetric] = useState<LeaderboardMetric>('completions');
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [window, setWindow] = useState<LeaderboardWindow>('all');
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Nb de lignes chargées. Le backend plafonne à 100 (LeaderboardService).
  const [limit, setLimit] = useState(20);
  const MAX = 100;
  const STEP = 20;

  // Tout changement de FILTRE réaffiche le chargement et repart au top 20.
  // Ajustement d'état AU RENDU (pattern React officiel) plutôt qu'un setLoading
  // synchrone dans l'effet → évite la règle react-hooks/set-state-in-effect.
  const queryKey = `${metric}-${scope}-${window}`;
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (queryKey !== prevQueryKey) {
    setPrevQueryKey(queryKey);
    setLoading(true);
    setLimit(20);
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<LeaderboardResult>(
      `/leaderboard?metric=${metric}&scope=${scope}&window=${window}&limit=${limit}`,
    )
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // `limit` augmente sans repasser par le skeleton (loading reste false) : la
    // liste s'allonge simplement au clic sur « Voir plus ».
  }, [metric, scope, window, limit]);

  const rows = data?.rows ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  // Barres de progression relatives au 1ᵉʳ (score max).
  const topScore = rows[0]?.score ?? 1;
  const meInRows = rows.some((r) => r.user.id === user?.id);
  const metricLabel = t(METRICS.find((m) => m.key === metric)!.labelKey);

  return (
    <div className="mx-auto max-w-3xl">
      {/* En-tête brandé, centré */}
      <div className="mb-7 text-center">
        <div className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          <span className="text-accent">●</span> {t('leaderboard.eyebrow')}
        </div>
        <h1 className="font-display mt-1.5 text-3xl font-extrabold tracking-tight">
          {t('leaderboard.title')}
        </h1>
      </div>

      {/* Filtres en pilules, centrés */}
      <div className="flex flex-col items-center gap-3">
        <SegmentedTabs
          options={METRICS.map((m) => ({ key: m.key, label: t(m.labelKey) }))}
          value={metric}
          onChange={(k) => setMetric(k as LeaderboardMetric)}
          variant="primary"
        />
        <div className="flex flex-wrap justify-center gap-2">
          <SegmentedTabs
            options={SCOPES.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
            value={scope}
            onChange={(k) => setScope(k as LeaderboardScope)}
            variant="secondary"
          />
          <SegmentedTabs
            options={WINDOWS.map((w) => ({ key: w.key, label: t(w.labelKey) }))}
            value={window}
            onChange={(k) => setWindow(k as LeaderboardWindow)}
            variant="secondary"
          />
        </div>
      </div>

      <div className="mt-7">
        {loading ? (
          <div className="flex flex-col gap-2">
            <div className="mb-2 grid grid-cols-3 items-end gap-3">
              {[36, 44, 30].map((h, i) => (
                <div key={i} className={`animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-900`} style={{ height: `${h * 3}px` }} />
              ))}
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-900" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<TrophyIcon />}
            title={t('leaderboard.emptyTitle')}
            description={scope === 'friends' ? t('leaderboard.emptyFriends') : t('leaderboard.emptyGlobal')}
          >
            {scope === 'friends' && (
              <Link
                to="/friends"
                className="mt-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110"
              >
                {t('leaderboard.findFriends')}
              </Link>
            )}
          </EmptyState>
        ) : (
          <>
            {/* Podium top 3 : 2ᵉ à gauche, 1ᵉʳ au centre (surélevé), 3ᵉ à droite */}
            <div className="mb-4 grid grid-cols-3 items-end gap-3 sm:gap-4">
              <div>{podium[1] && <Pod row={podium[1]} place={2} me={podium[1].user.id === user?.id} />}</div>
              <div>{podium[0] && <Pod row={podium[0]} place={1} me={podium[0].user.id === user?.id} />}</div>
              <div>{podium[2] && <Pod row={podium[2]} place={3} me={podium[2].user.id === user?.id} />}</div>
            </div>

            {/* Reste du classement (rang 4→N) */}
            {rest.length > 0 && (
              <div className="card divide-y divide-zinc-900/[0.06] overflow-hidden !rounded-2xl dark:divide-zinc-100/[0.06]">
                {rest.map((row) => (
                  <ListRow
                    key={row.user.id}
                    row={row}
                    topScore={topScore}
                    me={row.user.id === user?.id}
                  />
                ))}
              </div>
            )}

            {/* Voir plus : recharge un palier plus large (jusqu'au plafond 100).
                Visible tant que le backend a renvoyé une page pleine. */}
            {rows.length >= limit && limit < MAX && (
              <button
                type="button"
                onClick={() => setLimit((l) => Math.min(MAX, l + STEP))}
                className="mx-auto mt-4 block rounded-lg border border-zinc-400 px-6 py-2 text-sm transition hover:opacity-70 dark:border-zinc-700"
              >
                {t('feed.loadMore')}
              </button>
            )}

            {/* Ma position, épinglée en bas — TOUJOURS visible si je ne suis pas
                déjà dans le top affiché, même non classé (score 0 → rang « — »). */}
            {!meInRows && user && (
              <div className="sticky bottom-4 mt-4">
                <div className="card !rounded-2xl border-accent/40 bg-accent/10 shadow-lg shadow-accent/20 backdrop-blur">
                  <ListRow
                    row={{ rank: data?.me?.rank ?? 0, score: data?.me?.score ?? 0, user: { id: user.id, username: user.username, avatarUrl: user.avatarUrl } }}
                    topScore={topScore}
                    me
                    displayRank={data?.me ? String(data.me.rank) : '—'}
                    pinnedLabel={t('leaderboard.you')}
                  />
                </div>
              </div>
            )}

            <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">{metricLabel}</p>
          </>
        )}
      </div>
    </div>
  );
}

// Marche du podium : avatar cerclé de la couleur du rang, médaille, pseudo, score.
// « toi » est signalé par un label sous le pseudo (pas un contour de carte : il
// entrerait en conflit avec la couronne ambre du 1ᵉʳ).
function Pod({ row, place, me }: { row: LeaderboardRow; place: 1 | 2 | 3; me: boolean }) {
  const { t } = useTranslation();
  const c = PLACE[place];
  const first = place === 1;
  return (
    <Link
      to={`/u/${row.user.username}`}
      className={`card relative flex flex-col items-center gap-1.5 !rounded-2xl px-2 text-center transition hover:-translate-y-0.5 ${
        first ? 'pb-4 pt-6 shadow-lg shadow-amber-400/25' : 'pb-3 pt-4'
      }`}
    >
      {first && <CrownIcon className="absolute -top-3 z-10 h-6 w-6 text-amber-400" />}
      <span className={`rounded-full ring-2 ${me ? 'ring-accent' : c.ring}`}>
        <Avatar username={row.user.username} avatarUrl={row.user.avatarUrl} size={first ? 60 : 48} />
      </span>
      <span className="flex items-center gap-1">
        <MedalIcon className={`h-4 w-4 ${c.text}`} />
        <span className={`font-display text-sm font-extrabold ${c.text}`}>{place}</span>
      </span>
      <span className="w-full truncate text-sm font-semibold">{row.user.username}</span>
      {me && (
        <span className="-mt-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
          {t('leaderboard.you')}
        </span>
      )}
      <span className={`font-display text-xl font-extrabold tabular-nums tracking-tight ${first ? c.text : ''}`}>
        {row.score}
      </span>
    </Link>
  );
}

// Ligne du classement (rang 4+) : rang, avatar, pseudo + barre de progression
// relative au 1ᵉʳ, score. Réutilisée pour la ligne « toi » épinglée.
function ListRow({
  row,
  topScore,
  me,
  pinnedLabel,
  displayRank,
}: {
  row: LeaderboardRow;
  topScore: number;
  me: boolean;
  pinnedLabel?: string;
  // Rang affiché (override) — « — » pour un joueur non classé (score 0).
  displayRank?: string;
}) {
  const pct = row.score > 0 ? Math.max(4, Math.round((row.score / topScore) * 100)) : 0;
  return (
    <Link
      to={`/u/${row.user.username}`}
      className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-900/[0.03] dark:hover:bg-zinc-100/[0.03]"
    >
      <span className={`w-7 shrink-0 text-center font-display text-base font-extrabold tabular-nums ${me ? 'text-accent' : 'text-zinc-400 dark:text-zinc-500'}`}>
        {displayRank ?? row.rank}
      </span>
      <Avatar username={row.user.username} avatarUrl={row.user.avatarUrl} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{row.user.username}</span>
          {pinnedLabel && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent">· {pinnedLabel}</span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 max-w-[16rem] overflow-hidden rounded-full bg-zinc-900/10 dark:bg-zinc-100/10">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className={`shrink-0 font-display text-lg font-extrabold tabular-nums ${me ? 'text-accent' : ''}`}>
        {row.score}
      </span>
    </Link>
  );
}

// Groupe de boutons « segmenté ». variant primary = pilules pleines (métrique),
// secondary = groupe compact encadré (portée/fenêtre).
function SegmentedTabs({
  options,
  value,
  onChange,
  variant,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  variant: 'primary' | 'secondary';
}) {
  if (variant === 'primary') {
    return (
      <div className="flex flex-wrap justify-center gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              value === o.key
                ? 'bg-accent text-zinc-950'
                : 'border border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            value === o.key
              ? 'bg-accent text-zinc-950'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Couronne pleine (or) posée sur le 1ᵉʳ du podium.
function CrownIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-current ${className}`} aria-hidden="true">
      <path d="M3 18h18l-1.2-8.5-4.3 3.2L12 6l-3.5 6.7L4.2 9.5 3 18z" />
    </svg>
  );
}

// Médaille façon trait — la couleur vient de `currentColor`, pilotée par la
// classe text-* selon le rang.
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

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
    </svg>
  );
}
