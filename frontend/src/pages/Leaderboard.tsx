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

// Teinte de la médaille pour le podium (or / argent / bronze). Au-delà du top 3,
// on affiche le rang en clair. Couleurs sobres, cohérentes avec le thème.
const MEDAL_COLOR: Record<number, string> = {
  1: 'text-amber-400',
  2: 'text-zinc-400',
  3: 'text-amber-700',
};

export default function Leaderboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [metric, setMetric] = useState<LeaderboardMetric>('completions');
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [window, setWindow] = useState<LeaderboardWindow>('all');
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Tout changement de filtre réaffiche le chargement. Ajustement d'état AU
  // RENDU (pattern React officiel) plutôt qu'un setLoading synchrone dans
  // l'effet → évite la règle react-hooks/set-state-in-effect.
  const queryKey = `${metric}-${scope}-${window}`;
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (queryKey !== prevQueryKey) {
    setPrevQueryKey(queryKey);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<LeaderboardResult>(
      `/leaderboard?metric=${metric}&scope=${scope}&window=${window}`,
    )
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [metric, scope, window]);

  // Le viewer figure-t-il déjà dans les lignes affichées ? Sinon on ajoute une
  // ligne « moi » récapitulative en bas.
  const meInRows = data?.rows.some((r) => r.user.id === user?.id) ?? false;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{t('leaderboard.title')}</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t('leaderboard.subtitle')}</p>

      <div className="flex flex-col gap-3">
        {/* Métrique : le classement affiché */}
        <SegmentedTabs
          options={METRICS.map((m) => ({ key: m.key, label: t(m.labelKey) }))}
          value={metric}
          onChange={(k) => setMetric(k as LeaderboardMetric)}
          variant="primary"
        />
        {/* Portée + fenêtre : filtres secondaires */}
        <div className="flex flex-wrap gap-2">
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

      <div className="mt-6">
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-900" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState
            icon={<TrophyIcon />}
            title={t('leaderboard.emptyTitle')}
            description={
              scope === 'friends'
                ? t('leaderboard.emptyFriends')
                : t('leaderboard.emptyGlobal')
            }
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
          <div className="flex flex-col gap-2">
            {data.rows.map((row) => (
              <Row
                key={row.user.id}
                rank={row.rank}
                username={row.user.username}
                avatarUrl={row.user.avatarUrl}
                score={row.score}
                isMe={row.user.id === user?.id}
              />
            ))}

            {/* Ma position si je suis hors du top affiché */}
            {!meInRows && data.me && user && (
              <>
                <div className="my-1 flex items-center gap-2 text-xs text-zinc-400">
                  <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
                  {t('leaderboard.yourRank')}
                  <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
                </div>
                <Row
                  rank={data.me.rank}
                  username={user.username}
                  avatarUrl={user.avatarUrl}
                  score={data.me.score}
                  isMe
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Une ligne de classement. La ligne du viewer est surlignée (accent).
function Row({
  rank,
  username,
  avatarUrl,
  score,
  isMe,
}: {
  rank: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  isMe: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/u/${username}`}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
        isMe
          ? 'border-accent bg-accent/10'
          : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
      }`}
    >
      <span className="flex w-8 shrink-0 items-center justify-center">
        {rank <= 3 ? (
          <>
            <MedalIcon className={MEDAL_COLOR[rank]} />
            {/* La médaille est purement visuelle (aria-hidden) : ce texte, caché
                à l'écran mais lu par les lecteurs d'écran, annonce le rang. */}
            <span className="sr-only">{t('leaderboard.rankLabel', { rank })}</span>
          </>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-zinc-500">{rank}</span>
        )}
      </span>
      <Avatar username={username} avatarUrl={avatarUrl} size={32} />
      <span className="min-w-0 flex-1 truncate font-medium">{username}</span>
      <span className="shrink-0 text-lg font-bold tabular-nums text-accent">{score}</span>
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
      <div className="flex flex-wrap gap-2">
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

// Médaille façon trait (mêmes réglages que TrophyIcon) — la couleur vient de
// `currentColor`, pilotée par la classe text-* selon le rang.
function MedalIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 fill-none stroke-current ${className}`}
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
