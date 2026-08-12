import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import EmptyState, { GamepadIcon } from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { apiFetch, ApiError } from '../lib/api';
import type { PublicProfile } from '../lib/types';

// Same brand logos as Library.tsx (Simple Icons, CC0) — kept in sync by hand,
// small and stable enough not to warrant a shared module.
const STEAM_PATH =
  'M11.98 0C5.6 0 .37 4.94 0 11.24l6.44 2.66a3.4 3.4 0 0 1 1.92-.59l2.86-4.15v-.06a4.54 4.54 0 1 1 4.54 4.54h-.11l-4.08 2.92c0 .05 0 .1 0 .14a3.41 3.41 0 0 1-6.75.62L.05 15.9A12 12 0 1 0 11.98 0zm-4.4 18.2l-1.47-.6a2.56 2.56 0 0 0 4.7-1.98 2.56 2.56 0 0 0-3.36-1.36l1.52.63a1.88 1.88 0 1 1-1.44 3.47zm8.98-9.35a3.03 3.03 0 1 0-6.06 0 3.03 3.03 0 0 0 6.06 0zm-5.3 0a2.27 2.27 0 1 1 4.54 0 2.27 2.27 0 0 1-4.54 0z';
const PSN_PATH =
  'M8.985 2.596v17.548l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.181.76.814.76 1.505v5.876c2.441 1.193 4.362-.002 4.362-3.153 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.393-1.502zm4.656 16.242l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.185 1.499v-2.385l.241-.083s1.203-.428 2.9-.617c1.687-.188 3.751.027 5.373.631 1.836.628 2.041 1.556 1.575 2.192-.472.629-1.622 1.075-1.622 1.075l-8.483 3.066v-2.418zm-9.734.271c-1.886-.531-2.199-1.634-1.336-2.267.799-.588 2.157-1.031 2.157-1.031l5.622-1.998v2.395l-4.047 1.451c-.715.257-.826.625-.246.817.586.192 1.637.14 2.357-.123l1.937-.702v2.142c-.123.021-.259.043-.383.063-1.905.312-3.934.181-6.062-.404z';
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';

type PlatformKey = 'steam' | 'psn' | 'xbox';

function BrandTile({ color, path }: { color: string; path: string }) {
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
      style={{ backgroundColor: color }}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    </span>
  );
}

interface TrophyCounts {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
}

// Same grades/colors as PsnLibrary.tsx — kept in sync by hand.
const GRADES: { key: keyof TrophyCounts; color: string }[] = [
  { key: 'platinum', color: '#8bb9e8' },
  { key: 'gold', color: '#e6b53c' },
  { key: 'silver', color: '#b9c2cc' },
  { key: 'bronze', color: '#cd7f45' },
];

function TrophyIcon({ color, className = '' }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
    </svg>
  );
}

function TrophyTally({ counts }: { counts: TrophyCounts }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {GRADES.map(({ key, color }) => (
        <span key={key} className="inline-flex items-center gap-0.5 text-[11px] tabular-nums">
          <TrophyIcon color={color} className="h-3 w-3" />
          {counts[key]}
        </span>
      ))}
    </span>
  );
}

// One catalog game as shown in the read-only grid, normalised from whichever
// platform shape it came from (trophy grades / Gamerscore / Steam
// achievements all reduce to a single progress line here — PSN additionally
// keeps its trophy breakdown for the tally under the progress line).
interface Item {
  id: number;
  title: string;
  coverUrl: string | null;
  progress: string;
  trophies?: TrophyCounts;
}

interface PsnMatch {
  id: number;
  title: string;
  coverUrl: string | null;
  trophies: { earned: TrophyCounts; progress: number };
}
interface XboxMatch {
  id: number;
  title: string;
  coverUrl: string | null;
  achievements: { progress: number };
}
interface SteamMatch {
  id: number;
  title: string;
  coverUrl: string | null;
  achievements: { unlocked: number; total: number } | null;
}

interface PlatformResponse {
  linked: boolean;
  synced: boolean;
  hidden: boolean;
  matched: (PsnMatch | XboxMatch | SteamMatch)[];
}

// `embedded`: rendered inside the unified page (hides the h1); each panel
// fetches its own read-only endpoint (cache only, no side effects — see
// psn/xbox/steam controllers' `publicLibrary`) only once its tab is active.
function PlatformPanel({ username, platform }: { username: string; platform: PlatformKey }) {
  const { t } = useTranslation();
  const [data, setData] = useState<PlatformResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    apiFetch<PlatformResponse>(`/${platform}/library/${encodeURIComponent(username)}`)
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setError(err instanceof ApiError ? err.message : t('playerLibrary.loadError')));
    return () => {
      cancelled = true;
    };
  }, [username, platform, t]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  if (!data)
    return (
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
        {Array.from({ length: 12 }).map((_, i) => (
          <li key={i} className="card overflow-hidden">
            <Skeleton className="aspect-[3/4] w-full rounded-none" />
          </li>
        ))}
      </ul>
    );

  if (data.hidden) {
    return (
      <EmptyState
        icon={<GamepadIcon />}
        title={t('playerLibrary.hiddenTitle')}
        description={t('playerLibrary.hiddenDesc')}
      />
    );
  }

  if (!data.synced) {
    return (
      <EmptyState
        icon={<GamepadIcon />}
        title={t('playerLibrary.notSyncedTitle')}
        description={t('playerLibrary.notSyncedDesc')}
      />
    );
  }

  const items: Item[] = data.matched.map((m) => {
    if (platform === 'psn') {
      const p = m as PsnMatch;
      return {
        id: p.id,
        title: p.title,
        coverUrl: p.coverUrl,
        progress: t('playerLibrary.progress', { count: p.trophies.progress }),
        trophies: p.trophies.earned,
      };
    }
    if (platform === 'xbox') {
      const x = m as XboxMatch;
      return { id: x.id, title: x.title, coverUrl: x.coverUrl, progress: t('playerLibrary.progress', { count: x.achievements.progress }) };
    }
    const s = m as SteamMatch;
    const pct = s.achievements && s.achievements.total > 0 ? Math.round((100 * s.achievements.unlocked) / s.achievements.total) : null;
    return {
      id: s.id,
      title: s.title,
      coverUrl: s.coverUrl,
      progress: pct === null ? t('playerLibrary.owned') : t('playerLibrary.progress', { count: pct }),
    };
  });

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<GamepadIcon />}
        title={t('playerLibrary.noneMatchedTitle')}
        description={t('playerLibrary.noneMatchedDesc')}
      />
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
      {items.map((g) => (
        <li key={g.id} className="card flex flex-col overflow-hidden">
          <Link to={`/game/${g.id}`} className="group flex flex-1 flex-col">
            {g.coverUrl ? (
              <img
                src={g.coverUrl}
                alt=""
                className="aspect-[3/4] w-full object-cover transition group-hover:opacity-80"
              />
            ) : (
              <div className="aspect-[3/4] w-full bg-zinc-800" />
            )}
            <p className="p-2 pb-0.5 text-sm font-medium leading-tight">{g.title}</p>
            <p className={`px-2 pt-0.5 text-xs tabular-nums text-zinc-400 ${g.trophies ? '' : 'pb-2'}`}>
              {g.progress}
            </p>
            {g.trophies && (
              <div className="px-2 pb-2 pt-1">
                <TrophyTally counts={g.trophies} />
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Read-only view of another player's linked libraries, reached from the
// "View library" button on their public profile (PublicProfile.tsx). Mirrors
// Library.tsx's tab layout, but every panel is a stripped-down grid (no
// mark-played/write-review actions — those act on the VIEWER, not the
// profile owner, so they don't belong on someone else's library at all).
export default function PlayerLibrary() {
  const { t } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    apiFetch<PublicProfile>(`/users/profile/${encodeURIComponent(username)}`)
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (notFound) return <EmptyState icon={<GamepadIcon />} title={t('playerLibrary.notFound')} />;
  if (!profile) {
    return (
      <div>
        <Skeleton className="mb-3 h-8 w-52" />
        <Skeleton className="mb-6 h-4 w-72" />
      </div>
    );
  }

  const platforms: { key: PlatformKey; label: string; color: string; path: string; linked: boolean }[] = [
    { key: 'steam', label: 'Steam', color: '#1b2838', path: STEAM_PATH, linked: Boolean(profile.steamId) },
    { key: 'psn', label: 'PlayStation', color: '#0070d1', path: PSN_PATH, linked: profile.psnLinked },
    { key: 'xbox', label: 'Xbox', color: '#107c10', path: XBOX_PATH, linked: profile.xboxLinked },
  ];
  const linkedPlatforms = platforms.filter((p) => p.linked);
  const requested = params.get('platform') as PlatformKey | null;
  const active = requested && linkedPlatforms.some((p) => p.key === requested) ? requested : (linkedPlatforms[0]?.key ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Avatar username={profile.username} avatarUrl={profile.avatarUrl} size={44} />
        <div className="min-w-0">
          <h1 className="font-display truncate text-xl font-bold tracking-tight">
            {t('playerLibrary.title', { username: profile.username })}
          </h1>
          <Link to={`/u/${profile.username}`} className="text-sm text-zinc-500 hover:text-accent dark:text-zinc-400">
            {t('playerLibrary.backToProfile')}
          </Link>
        </div>
      </div>

      {linkedPlatforms.length === 0 ? (
        <EmptyState icon={<GamepadIcon />} title={t('playerLibrary.noneLinkedTitle')} />
      ) : (
        <>
          {linkedPlatforms.length > 1 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {linkedPlatforms.map((p) => {
                const isActive = p.key === active;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setParams({ platform: p.key }, { replace: true })}
                    className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                      isActive
                        ? 'border-accent bg-accent/[0.07]'
                        : 'border-zinc-900/10 hover:border-accent/50 dark:border-zinc-100/10'
                    }`}
                  >
                    <BrandTile color={p.color} path={p.path} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display font-bold leading-tight">{p.label}</div>
                    </div>
                    {isActive && (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-zinc-950">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5 fill-none stroke-current"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 12l5 5 9-11" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {active && <PlatformPanel key={active} username={profile.username} platform={active} />}
        </>
      )}
    </div>
  );
}
