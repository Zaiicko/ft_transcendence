import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import EmptyState, { GamepadIcon } from '../components/EmptyState';
import SectionHead from '../components/SectionHead';
import Skeleton from '../components/Skeleton';
import i18n from '../i18n';
import { apiFetch, ApiError } from '../lib/api';

interface SteamLibraryGame {
  id: number;
  title: string;
  coverUrl: string | null;
  gameType: string;
  steamAppId: number | null;
  igdbRating: number | null;
  steamScore: number | null;
  releaseDate: string | null;
  playtimeMinutes: number;
  playedStatus: string | null;
  reviewed: boolean;
  achievements: { unlocked: number; total: number } | null;
}

interface AchievementSummary {
  unlocked: number;
  total: number;
  games: number;
  perfect: number;
  syncedAt?: string;
}

interface LibraryResponse {
  private: boolean;
  totalOwned: number;
  matched: SteamLibraryGame[];
  unmatchedCount: number;
  achievements?: AchievementSummary;
}

// Filled amber star: unlocked Steam achievements.
function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.9 6.26L21.5 9.2l-4.75 4.63L17.8 21 12 17.5 6.2 21l1.05-7.17L2.5 9.2l6.6-.94z" />
    </svg>
  );
}

function formatPlaytime(minutes: number): string {
  const t = i18n.t.bind(i18n);
  if (minutes === 0) return t('steam.neverPlayed');
  if (minutes < 60) return t('steam.playMinutes', { count: minutes });
  return t('steam.playHours', { count: Math.round(minutes / 60) });
}

// `embedded`: rendered inside the unified "My libraries" page (hides the h1).
export default function SteamLibrary({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const steamLinked = Boolean(user?.steamId);

  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(steamLinked);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Resync achievements (?refresh=true) — after playing new games or making the profile public.
  async function refreshAchievements() {
    setSyncing(true);
    try {
      const lib = await apiFetch<LibraryResponse>('/steam/library?refresh=true');
      setLibrary(lib);
    } catch {
      // silent: keep the current view
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!steamLinked) return;
    // setState only in the async callbacks, never in the effect body (react-hooks/set-state-in-effect).
    apiFetch<LibraryResponse>('/steam/library')
      .then((lib) => {
        setLibrary(lib);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : t('steam.loadError'));
      })
      .finally(() => setLoading(false));
    // t is only read in the catch — adding it would re-fetch on every language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamLinked]);

  // "Done" toggle straight from the library: patch local state (playedStatus is already per-game) instead of re-fetching.
  async function togglePlayed(game: SteamLibraryGame) {
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

  if (!steamLinked) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('steam.title')}</h1>
        <p className="mb-6 text-zinc-400">{t('steam.linkPrompt')}</p>
        <a
          href="/api/auth/steam"
          className="rounded border border-zinc-700 px-4 py-2 hover:bg-zinc-900"
        >
          {t('steam.linkCta')}
        </a>
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

  if (error) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('steam.title')}</h1>
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {!embedded && (
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('steam.title')}</h1>
      )}

      {library?.achievements && (
        <div className="card mb-10 flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <StarIcon className="h-3.5 w-3.5 text-amber-500" />
            {t('steam.achievementsTitle')}
          </p>
          {library.achievements.games > 0 ? (
            <>
              <p className="text-2xl font-bold tabular-nums">
                {library.achievements.unlocked}
                <span className="text-base font-normal text-zinc-400"> / {library.achievements.total}</span>
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('steam.achievementsSub', {
                  games: library.achievements.games,
                  perfect: library.achievements.perfect,
                })}
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('steam.achievementsNone')}</p>
          )}
          <button
            type="button"
            onClick={refreshAchievements}
            disabled={syncing}
            className="ml-auto rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-zinc-600"
          >
            {syncing ? t('steam.syncing') : t('steam.syncAchievements')}
          </button>
        </div>
      )}

      <SectionHead className="mb-3" title={t('steam.yourGames')} />
      {library?.private ? (
        <p className="mb-8 text-zinc-400">
          <Trans
            i18nKey="steam.gamesPrivate"
            components={{ s: <span className="text-zinc-200" /> }}
          />
        </p>
      ) : (
        <>
          <p className="mb-6 text-sm text-zinc-400">
            {t(
              library && library.unmatchedCount > 0 ? 'steam.ownedUnmatched' : 'steam.owned',
              {
                totalOwned: library?.totalOwned ?? 0,
                matched: library?.matched.length ?? 0,
                unmatched: library?.unmatchedCount ?? 0,
              },
            )}
          </p>

          {library && library.matched.length > 0 ? (
            <ul className="mb-10 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
              {library.matched.map((game) => (
                <li key={game.id} className="card flex flex-col overflow-hidden">
                  {/* Jaquette + titre cliquables → fiche du jeu (consultation) */}
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
                    <p className="mt-auto text-xs text-zinc-400">{formatPlaytime(game.playtimeMinutes)}</p>
                    {game.achievements && (
                      <p
                        className="flex items-center gap-1 text-xs text-zinc-400"
                        title={t('steam.achPerGame', {
                          unlocked: game.achievements.unlocked,
                          total: game.achievements.total,
                        })}
                      >
                        <StarIcon
                          className={`h-3 w-3 ${
                            game.achievements.unlocked === game.achievements.total
                              ? 'text-amber-500'
                              : 'text-zinc-400'
                          }`}
                        />
                        <span className="tabular-nums">
                          {game.achievements.unlocked}/{game.achievements.total}
                        </span>
                      </p>
                    )}
                    {game.playedStatus && game.playedStatus !== 'PLAYED' && (
                      <span className="self-start rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                        {t(game.playedStatus === 'PLAYING' ? 'steam.statusPlaying' : 'steam.statusBacklog')}
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
                        title={game.reviewed ? t('steam.reviewWritten') : t('steam.writeReview')}
                        aria-label={t(game.reviewed ? 'steam.viewReviewOf' : 'steam.writeReviewOf', {
                          title: game.title,
                        })}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          game.reviewed
                            ? 'border-accent bg-accent text-zinc-950'
                            : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {/* Crayon filaire (trait 1.6) : critique */}
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
              title={t('steam.noMatchedTitle')}
              description={t('steam.noMatchedDesc')}
            />
          )}
        </>
      )}

      <p className="mt-10 text-sm text-zinc-400">
        <Trans
          i18nKey="steam.manageLink"
          components={{ l: <Link to="/profile" className="underline" /> }}
        />
      </p>
    </div>
  );
}
