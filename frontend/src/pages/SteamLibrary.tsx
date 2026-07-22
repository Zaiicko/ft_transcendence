import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import EmptyState, { GamepadIcon, UsersIcon } from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import i18n from '../i18n';
import { apiFetch, ApiError } from '../lib/api';
import type { PublicUser } from '../lib/types';

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
}

interface LibraryResponse {
  private: boolean;
  totalOwned: number;
  matched: SteamLibraryGame[];
  unmatchedCount: number;
}

interface SuggestionsResponse {
  private: boolean;
  suggestions: PublicUser[];
}

function formatPlaytime(minutes: number): string {
  const t = i18n.t.bind(i18n);
  if (minutes === 0) return t('steam.neverPlayed');
  if (minutes < 60) return t('steam.playMinutes', { count: minutes });
  return t('steam.playHours', { count: Math.round(minutes / 60) });
}

export default function SteamLibrary() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const steamLinked = Boolean(user?.steamId);

  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsResponse | null>(null);
  // Nothing to load when no Steam account is linked
  const [loading, setLoading] = useState(steamLinked);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<number>>(new Set());
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    if (!steamLinked) return;
    // setState only happens in the promise callbacks (async), never in the
    // effect's synchronous body — see react-hooks/set-state-in-effect
    Promise.all([
      apiFetch<LibraryResponse>('/steam/library'),
      apiFetch<SuggestionsResponse>('/steam/friends/suggestions'),
    ])
      .then(([lib, sug]) => {
        setLibrary(lib);
        setSuggestions(sug);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : t('steam.loadError'));
      })
      .finally(() => setLoading(false));
  }, [steamLinked]);

  // Coche "fait" directement depuis la bibliothèque : l'API renvoie déjà
  // playedStatus par jeu, on patche l'état local au lieu de re-fetcher
  // (la liste peut compter des centaines de jeux)
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

  async function handleAddFriend(userId: number) {
    setRequestError(null);
    try {
      await apiFetch(`/friends/requests/${userId}`, { method: 'POST' });
      setRequested((prev) => new Set(prev).add(userId));
    } catch (err) {
      setRequestError(err instanceof ApiError ? err.message : t('steam.friendRequestError'));
    }
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
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('steam.title')}</h1>

      {/* Amis d'abord : la biblio de jeux peut être immense, les amis se
          retrouveraient sinon enterrés tout en bas */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {t('steam.friendsHeading')}
        </h2>
        {suggestions?.private && <p className="text-zinc-400">{t('steam.friendsPrivate')}</p>}
        {suggestions && !suggestions.private && suggestions.suggestions.length === 0 && (
          <EmptyState
            icon={<UsersIcon />}
            title={t('steam.noFriendsTitle')}
            description={t('steam.noFriendsDesc')}
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
                    <span className="text-sm text-zinc-400">{t('steam.requestSent')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddFriend(s.id)}
                      className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent"
                    >
                      {t('steam.addFriend')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {t('steam.yourGames')}
      </h2>
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
            <ul className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
                    {/* PLAYED est porté par le knob ambre ; seuls les autres
                        statuts (playing/backlog) gardent leur étiquette */}
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
                        {/* Coche cerclée filaire (trait 1.6) : "fait" */}
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
