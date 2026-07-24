import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import EmptyState, { GamepadIcon, UsersIcon } from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { apiFetch, ApiError } from '../lib/api';
import type { PublicUser } from '../lib/types';

interface TrophyCounts {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
}

interface PsnGame {
  id: number;
  title: string;
  coverUrl: string | null;
  gameType: string;
  platform: string;
  trophies: { earned: TrophyCounts; defined: TrophyCounts; progress: number };
  playedStatus: string | null;
  reviewed: boolean;
}

interface TrophySummary {
  level: number;
  tier: number;
  progress: number;
  earned: TrophyCounts;
}

interface LibraryResponse {
  private: boolean;
  totalPlayed: number;
  matched: PsnGame[];
  unmatchedCount: number;
  summary: TrophySummary | null;
}

interface SuggestionsResponse {
  private: boolean;
  suggestions: PublicUser[];
}

const sum = (c: TrophyCounts) => c.bronze + c.silver + c.gold + c.platinum;

// Pastilles colorées des 4 grades de trophées (platine, or, argent, bronze).
const GRADES: { key: keyof TrophyCounts; color: string }[] = [
  { key: 'platinum', color: '#8bb9e8' },
  { key: 'gold', color: '#e6b53c' },
  { key: 'silver', color: '#b9c2cc' },
  { key: 'bronze', color: '#cd7f45' },
];

// Icône de trophée (coupe) colorée selon le grade PSN
function TrophyIcon({ color, className = '' }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
    </svg>
  );
}

function TrophyTally({ counts, className = '' }: { counts: TrophyCounts; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {GRADES.map(({ key, color }) => (
        <span key={key} className="inline-flex items-center gap-1 text-xs tabular-nums">
          <TrophyIcon color={color} className="h-3.5 w-3.5" />
          {counts[key]}
        </span>
      ))}
    </span>
  );
}

// `embedded` : rendu dans la page globale « Mes bibliothèques » — on masque le
// titre h1 (l'onglet porte déjà le nom de la plateforme).
export default function PsnLibrary({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const psnLinked = Boolean(user?.psnLinked);

  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(psnLinked);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<number>>(new Set());
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    if (!psnLinked) return;
    Promise.all([
      apiFetch<LibraryResponse>('/psn/library'),
      apiFetch<SuggestionsResponse>('/psn/friends/suggestions'),
    ])
      .then(([lib, sug]) => {
        setLibrary(lib);
        setSuggestions(sug);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : t('psn.loadError'));
      })
      .finally(() => setLoading(false));
    // t n'est lu que dans le catch (message d'erreur) : le rajouter referait un
    // fetch à chaque changement de langue, non voulu — on charge une seule fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psnLinked]);

  async function togglePlayed(game: PsnGame) {
    const marked = game.playedStatus === 'PLAYED';
    await apiFetch(`/games/${game.id}/played`, { method: marked ? 'DELETE' : 'PUT' });
    setLibrary((lib) =>
      lib
        ? {
            ...lib,
            matched: lib.matched.map((m) =>
              m.id === game.id ? { ...m, playedStatus: marked ? null : 'PLAYED' } : m,
            ),
          }
        : lib,
    );
  }

  async function handleAddFriend(userId: number) {
    setRequestError(null);
    try {
      await apiFetch(`/friends/requests/${userId}`, { method: 'POST' });
      setRequested((prev) => new Set(prev).add(userId));
    } catch (err) {
      setRequestError(err instanceof ApiError ? err.message : t('psn.friendRequestError'));
    }
  }

  if (!psnLinked) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('psn.title')}</h1>
        <p className="mb-6 text-zinc-400">{t('psn.linkPrompt')}</p>
        <Link
          to="/settings"
          className="rounded border border-zinc-700 px-4 py-2 hover:bg-zinc-900"
        >
          {t('psn.linkCta')}
        </Link>
      </div>
    );
  }

  if (loading)
    return (
      <div>
        <Skeleton className="mb-3 h-8 w-52" />
        <Skeleton className="mb-6 h-4 w-72" />
        <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
          {Array.from({ length: 10 }).map((_, i) => (
            <li key={i} className="card overflow-hidden">
              <Skeleton className="aspect-[3/4] w-full rounded-none" />
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );

  if (error)
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('psn.title')}</h1>
        <p className="text-red-400">{error}</p>
      </div>
    );

  const summary = library?.summary ?? null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        {!embedded && <h1 className="text-2xl font-bold tracking-tight">{t('psn.title')}</h1>}
        {user?.psnOnlineId && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{user.psnOnlineId}</span>
        )}
      </div>

      {/* Résumé de trophées : niveau + total par grade */}
      {summary && (
        <div className="card mb-10 flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('psn.trophyLevel')}
            </p>
            <p className="text-2xl font-bold tabular-nums">{summary.level}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('psn.trophiesEarned')}
            </p>
            <TrophyTally counts={summary.earned} className="text-sm" />
          </div>
        </div>
      )}

      {/* Amis d'abord (la biblio peut être énorme) */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {t('psn.friendsHeading')}
        </h2>
        {suggestions?.private && <p className="text-zinc-400">{t('psn.friendsPrivate')}</p>}
        {suggestions && !suggestions.private && suggestions.suggestions.length === 0 && (
          <EmptyState
            icon={<UsersIcon />}
            title={t('psn.noFriendsTitle')}
            description={t('psn.noFriendsDesc')}
          />
        )}
        {requestError && <p className="mb-3 text-sm text-red-400">{requestError}</p>}
        {suggestions && suggestions.suggestions.length > 0 && (
          <ul className="flex flex-col gap-3">
            {suggestions.suggestions.map((s) => (
              <li key={s.id} className="card flex items-center gap-3 p-3">
                <Avatar username={s.username} avatarUrl={s.avatarUrl} size={40} />
                <span className="font-medium">{s.username}</span>
                <div className="ml-auto">
                  {requested.has(s.id) ? (
                    <span className="text-sm text-zinc-400">{t('psn.requestSent')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddFriend(s.id)}
                      className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent"
                    >
                      {t('psn.addFriend')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {t('psn.yourGames')}
      </h2>
      {library?.private ? (
        <p className="mb-8 text-zinc-400">{t('psn.gamesPrivate')}</p>
      ) : (
        <>
          <p className="mb-6 text-sm text-zinc-400">
            {t(library && library.unmatchedCount > 0 ? 'psn.playedUnmatched' : 'psn.played', {
              totalPlayed: library?.totalPlayed ?? 0,
              matched: library?.matched.length ?? 0,
              unmatched: library?.unmatchedCount ?? 0,
            })}
          </p>

          {library && library.matched.length > 0 ? (
            <ul className="mb-10 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
              {library.matched.map((game) => (
                <li key={game.id} className="card flex flex-col overflow-hidden">
                  <Link to={`/game/${game.id}`} className="group flex flex-1 flex-col">
                    {game.coverUrl ? (
                      <img
                        src={game.coverUrl}
                        alt=""
                        className="aspect-[3/4] w-full object-cover transition group-hover:opacity-80"
                      />
                    ) : (
                      <div className="aspect-[3/4] w-full bg-zinc-800" />
                    )}
                    <p className="p-2 pb-0 text-sm font-medium leading-tight">{game.title}</p>
                  </Link>
                  <div className="flex flex-1 flex-col gap-1 p-2 pt-1">
                    {/* Progression de trophées : x/y + % */}
                    <p className="mt-auto text-xs text-zinc-400">
                      {t('psn.trophyProgress', {
                        earned: sum(game.trophies.earned),
                        total: sum(game.trophies.defined),
                        progress: game.trophies.progress,
                      })}
                    </p>
                    <TrophyTally counts={game.trophies.earned} />
                    {game.playedStatus && game.playedStatus !== 'PLAYED' && (
                      <span className="self-start rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                        {t(game.playedStatus === 'PLAYING' ? 'psn.statusPlaying' : 'psn.statusBacklog')}
                      </span>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => togglePlayed(game)}
                        title={game.playedStatus === 'PLAYED' ? t('game.markedTitle') : t('game.markTitle')}
                        aria-label={game.playedStatus === 'PLAYED' ? t('game.unmarkAria') : t('game.markAria')}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          game.playedStatus === 'PLAYED'
                            ? 'border-accent bg-accent text-zinc-950'
                            : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4 fill-none stroke-current"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
                        </svg>
                      </button>
                      <Link
                        to={`/game/${game.id}#review`}
                        title={game.reviewed ? t('psn.reviewWritten') : t('psn.writeReview')}
                        aria-label={t(game.reviewed ? 'psn.viewReviewOf' : 'psn.writeReviewOf', {
                          title: game.title,
                        })}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          game.reviewed
                            ? 'border-accent bg-accent text-zinc-950'
                            : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4 fill-none stroke-current"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              className="mb-10"
              icon={<GamepadIcon />}
              title={t('psn.noMatchedTitle')}
              description={t('psn.noMatchedDesc')}
            />
          )}
        </>
      )}
    </div>
  );
}
