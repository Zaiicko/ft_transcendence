import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import EmptyState, { GamepadIcon } from '../components/EmptyState';
import SectionHead from '../components/SectionHead';
import Skeleton from '../components/Skeleton';
import { apiFetch, ApiError } from '../lib/api';

interface XboxAchievements {
  earned: number;
  gamerscore: number;
  totalGamerscore: number;
  progress: number;
}

interface XboxGame {
  id: number;
  title: string;
  coverUrl: string | null;
  gameType: string;
  achievements: XboxAchievements;
  lastPlayed: string | null;
  playedStatus: string | null;
  reviewed: boolean;
  completed: boolean;
}

interface XboxSummary {
  gamerscore: number;
  games: number;
  perfect: number;
}

interface LibraryResponse {
  private: boolean;
  totalPlayed: number;
  matched: XboxGame[];
  unmatchedCount: number;
  summary: XboxSummary | null;
  syncedAt: string | null;
}

// Small Xbox Gamerscore "G" crest (mirror of the PSN trophy).
function GamerscoreIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="stroke-current" strokeWidth="2" />
      <path
        d="M14.5 9.2A3.5 3.5 0 1 0 15 14h-3"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// `embedded`: rendered inside the unified "My libraries" page (hides the h1); mirror of PsnLibrary.
export default function XboxLibrary({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const xboxLinked = Boolean(user?.xboxLinked);

  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(xboxLinked);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!xboxLinked) return;
    // Default load: serves the server cache (instant); resync (slow OpenXBL) is triggered via ?refresh=true.
    apiFetch<LibraryResponse>('/xbox/library')
      .then(setLibrary)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : t('xbox.loadError'));
      })
      .finally(() => setLoading(false));
    // t is only read in the catch — adding it would re-fetch on every language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xboxLinked]);

  // Resync the library from Xbox (?refresh=true) — after playing new games or making the profile public.
  async function refreshLibrary() {
    setSyncing(true);
    try {
      setLibrary(await apiFetch<LibraryResponse>('/xbox/library?refresh=true'));
    } catch {
      // silent: keep the current view
    } finally {
      setSyncing(false);
    }
  }

  // Same manual "Fait" toggle as the game page's PlayedButton (creates/removes
  // a GameCompletion) — completing implies playing, so playedStatus follows.
  async function toggleCompleted(game: XboxGame) {
    const marked = game.completed;
    await apiFetch(`/games/${game.id}/completed`, {
      method: marked ? 'DELETE' : 'PUT',
      ...(marked ? {} : { body: JSON.stringify({}) }),
    });
    setLibrary((lib) =>
      lib
        ? {
            ...lib,
            matched: lib.matched.map((m) =>
              m.id === game.id
                ? { ...m, completed: !marked, playedStatus: marked ? m.playedStatus : 'PLAYED' }
                : m,
            ),
          }
        : lib,
    );
  }

  if (!xboxLinked) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('xbox.title')}</h1>
        <p className="mb-6 text-zinc-400">{t('xbox.linkPrompt')}</p>
        <Link
          to="/settings"
          className="rounded border border-zinc-700 px-4 py-2 hover:bg-zinc-900"
        >
          {t('xbox.linkCta')}
        </Link>
      </div>
    );
  }

  if (loading)
    return (
      <div>
        <Skeleton className="mb-3 h-8 w-52" />
        <Skeleton className="mb-6 h-4 w-72" />
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
          {Array.from({ length: 12 }).map((_, i) => (
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
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('xbox.title')}</h1>
        <p className="text-red-400">{error}</p>
      </div>
    );

  const summary = library?.summary ?? null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4">
        {!embedded && <h1 className="text-2xl font-bold tracking-tight">{t('xbox.title')}</h1>}
        {user?.xboxGamertag && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{user.xboxGamertag}</span>
        )}
        <button
          type="button"
          onClick={refreshLibrary}
          disabled={syncing}
          className="ml-auto rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-zinc-600"
        >
          {syncing ? t('xbox.syncing') : t('xbox.refresh')}
        </button>
      </div>
      {library?.syncedAt && (
        <p className="mb-6 text-xs text-zinc-500 dark:text-zinc-400">
          {t('xbox.syncedAt', { time: new Date(library.syncedAt).toLocaleString() })}
        </p>
      )}

      {summary && (
        <div className="card mb-10 flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <GamerscoreIcon className="h-4 w-4 text-[#107C10]" />
              {t('xbox.gamerscore')}
            </p>
            <p className="text-2xl font-bold tabular-nums">{summary.gamerscore.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('xbox.gamesPlayed')}
            </p>
            <p className="text-2xl font-bold tabular-nums">{summary.games}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('xbox.perfectGames')}
            </p>
            <p className="text-2xl font-bold tabular-nums">{summary.perfect}</p>
          </div>
        </div>
      )}

      <SectionHead className="mb-3" title={t('xbox.yourGames')} />
      {library?.private ? (
        <p className="mb-8 text-zinc-400">{t('xbox.gamesPrivate')}</p>
      ) : (
        <>
          <p className="mb-6 text-sm text-zinc-400">
            {t(library && library.unmatchedCount > 0 ? 'xbox.playedUnmatched' : 'xbox.played', {
              totalPlayed: library?.totalPlayed ?? 0,
              matched: library?.matched.length ?? 0,
              unmatched: library?.unmatchedCount ?? 0,
            })}
          </p>

          {library && library.matched.length > 0 ? (
            <ul className="mb-10 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
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
                    <p className="mt-auto text-xs text-zinc-400">
                      {t('xbox.achievementProgress', {
                        earned: game.achievements.earned,
                        progress: game.achievements.progress,
                      })}
                    </p>
                    <p className="flex items-center gap-1 text-xs tabular-nums text-zinc-400">
                      <GamerscoreIcon className="h-3.5 w-3.5 text-[#107C10]" />
                      {game.achievements.gamerscore.toLocaleString()}
                      <span className="text-zinc-600">
                        / {game.achievements.totalGamerscore.toLocaleString()}
                      </span>
                    </p>
                    {game.playedStatus && game.playedStatus !== 'PLAYED' && (
                      <span className="self-start rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                        {t(game.playedStatus === 'PLAYING' ? 'xbox.statusPlaying' : 'xbox.statusBacklog')}
                      </span>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCompleted(game)}
                        title={game.completed ? t('game.markedTitle') : t('game.markTitle')}
                        aria-label={game.completed ? t('game.unmarkAria') : t('game.markAria')}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          game.completed
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
                        title={game.reviewed ? t('xbox.reviewWritten') : t('xbox.writeReview')}
                        aria-label={t(game.reviewed ? 'xbox.viewReviewOf' : 'xbox.writeReviewOf', {
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
              title={t('xbox.noMatchedTitle')}
              description={t('xbox.noMatchedDesc')}
            />
          )}
        </>
      )}
    </div>
  );
}
