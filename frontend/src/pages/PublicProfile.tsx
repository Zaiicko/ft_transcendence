import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import EmptyState, { CalendarIcon, PencilIcon } from '../components/EmptyState';
import FortyTwoBadge from '../components/FortyTwoBadge';
import Skeleton from '../components/Skeleton';
import Stars from '../components/Stars';
import SteamBadge from '../components/SteamBadge';
import { apiFetch, ApiError } from '../lib/api';
import type { FriendState, PublicProfile as Profile } from '../lib/types';

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// ---- Yearly completion calendar (GitHub-style heatmap) ----

const DAY_MS = 86_400_000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type CalGame = Profile['calendar'][number]['game'];

function formatDay(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function CompletionCalendar({ entries }: { entries: Profile['calendar'] }) {
  // dateKey -> games completed that day (full refs so we can link + show covers)
  const byDay = useMemo(() => {
    const map = new Map<string, CalGame[]>();
    for (const e of entries) {
      const key = e.playedAt.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(e.game);
      map.set(key, list);
    }
    return map;
  }, [entries]);

  const years = useMemo(() => {
    const set = new Set(entries.map((e) => e.playedAt.slice(0, 4)));
    return [...set].sort().reverse();
  }, [entries]);

  const [year, setYear] = useState(() => years[0] ?? String(new Date().getFullYear()));
  // Day whose games are shown in the panel: pinned by click, else hovered
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="No completion dates yet"
        description="Games marked as done will fill this yearly calendar."
      />
    );
  }

  const y = Number(year);
  const start = new Date(Date.UTC(y, 0, 1));
  const end = new Date(Date.UTC(y, 11, 31));
  // Pad so the first column starts on the right weekday (0 = Sunday)
  const cells: (Date | null)[] = [];
  for (let i = 0; i < start.getUTCDay(); i++) cells.push(null);
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) cells.push(new Date(t));

  // A pinned day (clicked) wins: hovering other days no longer changes the panel
  const activeKey = pinnedKey ?? hoveredKey;
  const activeGames = activeKey ? byDay.get(activeKey) : undefined;

  return (
    <div>
      {years.length > 1 && (
        <div className="mb-3 flex gap-2">
          {years.map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => {
                setYear(yr);
                setPinnedKey(null);
              }}
              className={`rounded px-2 py-0.5 text-xs ${
                yr === year
                  ? 'bg-zinc-200 dark:bg-zinc-700'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto pb-2" onMouseLeave={() => setHoveredKey(null)}>
        {/* grid-rows-7 isn't a default Tailwind utility — set the 7-day rows inline */}
        <div
          className="grid gap-1"
          style={{
            gridAutoFlow: 'column',
            gridTemplateRows: 'repeat(7, 0.75rem)',
            width: 'max-content',
          }}
        >
          {cells.map((d, i) => {
            if (!d) return <span key={i} className="h-3 w-3" />;
            const key = dateKey(d);
            const games = byDay.get(key);
            const n = games?.length ?? 0;
            // Une seule couleur (l'accent), l'opacité monte avec le nombre de
            // jeux faits ce jour-là : plus tu as joué, moins la case est
            // transparente (0 = case grise inerte).
            const shade =
              n === 0
                ? 'bg-zinc-200 dark:bg-zinc-800'
                : n === 1
                  ? 'bg-accent/30'
                  : n === 2
                    ? 'bg-accent/60'
                    : 'bg-accent';
            // Empty days are inert; days with completions are hover/click targets
            if (!games) return <span key={i} className={`h-3 w-3 rounded-sm ${shade}`} />;
            return (
              <button
                key={i}
                type="button"
                title={formatDay(key)}
                onMouseEnter={() => setHoveredKey(key)}
                onClick={() => setPinnedKey((k) => (k === key ? null : key))}
                className={`h-3 w-3 rounded-sm ${shade} ${
                  key === pinnedKey ? 'ring-2 ring-accent ring-offset-1 dark:ring-offset-zinc-900' : ''
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Games completed on the hovered/clicked day */}
      {activeGames && activeKey ? (
        <div className="card mt-3 p-3">
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">{formatDay(activeKey)}</p>
          <ul className="flex flex-wrap gap-3">
            {activeGames.map((g) => (
              <li key={g.id}>
                <Link to={`/game/${g.id}`} className="flex items-center gap-2 hover:opacity-80">
                  {g.coverUrl ? (
                    <img src={g.coverUrl} alt="" className="h-10 w-8 rounded object-cover" />
                  ) : (
                    <span className="h-10 w-8 rounded bg-zinc-200 dark:bg-zinc-800" />
                  )}
                  <span className="text-sm">{g.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Hover or tap a colored day to see the games completed then.
        </p>
      )}
    </div>
  );
}

// ---- Friend action button ----

function FriendAction({
  state,
  username,
  onSent,
}: {
  state: FriendState;
  username: string;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state === 'friends') return <span className="text-sm text-emerald-500">✓ Friends</span>;
  if (state === 'outgoing') return <span className="text-sm text-zinc-500">Request pending</span>;
  if (state === 'incoming')
    return (
      <Link to="/friends" className="text-sm text-zinc-300 underline">
        Respond to their request
      </Link>
    );
  // state === 'none'
  async function add() {
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/friends/requests/${encodeURIComponent(username)}`, { method: 'POST' });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send request');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Add friend'}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}

export default function PublicProfile() {
  const { username = '' } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No synchronous setState in the body (react-hooks/set-state-in-effect):
  // every update happens in a promise callback.
  const load = useCallback(
    () =>
      apiFetch<Profile>(`/users/profile/${encodeURIComponent(username)}`)
        .then((p) => {
          setProfile(p);
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load profile'))
        .finally(() => setLoading(false)),
    [username],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="mb-3 h-4 w-40" />
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  if (error || !profile) return <p className="text-red-400">{error ?? 'Profile not found'}</p>;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar username={profile.username} avatarUrl={profile.avatarUrl} size={96} />
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {profile.username}
            {profile.provider === 'FORTYTWO' && <FortyTwoBadge />}
            {profile.steamId && <SteamBadge />}
          </h1>
          {profile.bio && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{profile.bio}</p>}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Member since {memberSince(profile.createdAt)} · {profile.reviewCount} review
            {profile.reviewCount === 1 ? '' : 's'} · {profile.playedCount} game
            {profile.playedCount === 1 ? '' : 's'} played
          </p>
        </div>
        <div className="sm:self-start">
          {profile.friendState === 'self' ? (
            <Link
              to="/settings"
              title="Edit profile"
              aria-label="Edit profile"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
            >
              {/* Rouage filaire (trait 1.6, style TiMN) */}
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
          ) : user ? (
            <FriendAction
              state={profile.friendState}
              username={profile.username}
              onSent={() => setProfile({ ...profile, friendState: 'outgoing' })}
            />
          ) : null}
        </div>
      </div>

      {/* Top 5 games */}
      {profile.topGames.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Top rated games</h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {profile.topGames.map(({ game, rating }) => (
              <Link key={game.id} to={`/game/${game.id}`} className="group">
                {game.coverUrl ? (
                  <img
                    src={game.coverUrl}
                    alt={game.title}
                    className="aspect-[3/4] w-full rounded-lg object-cover shadow transition group-hover:opacity-80"
                  />
                ) : (
                  <div className="aspect-[3/4] w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                )}
                <p className="mt-1 truncate text-sm font-medium">{game.title}</p>
                <Stars rating={rating} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Completion calendar */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Completion calendar</h2>
        <CompletionCalendar entries={profile.calendar} />
      </section>

      {/* Recent reviews */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Recent reviews</h2>
        {profile.recentReviews.length === 0 ? (
          <EmptyState icon={<PencilIcon />} title="No reviews yet" description="This player hasn't reviewed any game yet." />
        ) : (
          <ul className="flex flex-col gap-3">
            {profile.recentReviews.map((r) => {
              const name = r.game?.title ?? r.company?.name ?? 'Unknown';
              const cover = r.game?.coverUrl ?? r.company?.logoUrl ?? null;
              return (
                <li key={r.id} className="card flex gap-3 p-3">
                  {/* Petite jaquette du jeu (ou logo du studio) noté */}
                  {r.game ? (
                    <Link to={`/game/${r.game.id}`} className="shrink-0">
                      {cover ? (
                        <img
                          src={cover}
                          alt=""
                          className="h-16 w-11 rounded object-cover transition hover:opacity-80"
                        />
                      ) : (
                        <span className="block h-16 w-11 rounded bg-zinc-200 dark:bg-zinc-800" />
                      )}
                    </Link>
                  ) : cover ? (
                    <img src={cover} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="block h-16 w-11 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      {r.game ? (
                        <Link to={`/game/${r.game.id}`} className="font-medium hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium">{name}</span>
                      )}
                      <Stars rating={r.rating} />
                    </div>
                    {r.title && <p className="mt-1 text-sm font-medium">{r.title}</p>}
                    <p className="mt-1 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {r.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
