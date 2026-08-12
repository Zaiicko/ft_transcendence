import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import EmptyState, { GamepadIcon } from '../components/EmptyState';
import { apiFetch } from '../lib/api';
import PsnLibrary from './PsnLibrary';
import SteamLibrary from './SteamLibrary';
import XboxLibrary from './XboxLibrary';

// Brand logos (Simple Icons, CC0) — colored brand tiles in the selector.
const STEAM_PATH =
  'M11.98 0C5.6 0 .37 4.94 0 11.24l6.44 2.66a3.4 3.4 0 0 1 1.92-.59l2.86-4.15v-.06a4.54 4.54 0 1 1 4.54 4.54h-.11l-4.08 2.92c0 .05 0 .1 0 .14a3.41 3.41 0 0 1-6.75.62L.05 15.9A12 12 0 1 0 11.98 0zm-4.4 18.2l-1.47-.6a2.56 2.56 0 0 0 4.7-1.98 2.56 2.56 0 0 0-3.36-1.36l1.52.63a1.88 1.88 0 1 1-1.44 3.47zm8.98-9.35a3.03 3.03 0 1 0-6.06 0 3.03 3.03 0 0 0 6.06 0zm-5.3 0a2.27 2.27 0 1 1 4.54 0 2.27 2.27 0 0 1-4.54 0z';
const PSN_PATH =
  'M8.985 2.596v17.548l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.181.76.814.76 1.505v5.876c2.441 1.193 4.362-.002 4.362-3.153 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.393-1.502zm4.656 16.242l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.185 1.499v-2.385l.241-.083s1.203-.428 2.9-.617c1.687-.188 3.751.027 5.373.631 1.836.628 2.041 1.556 1.575 2.192-.472.629-1.622 1.075-1.622 1.075l-8.483 3.066v-2.418zm-9.734.271c-1.886-.531-2.199-1.634-1.336-2.267.799-.588 2.157-1.031 2.157-1.031l5.622-1.998v2.395l-4.047 1.451c-.715.257-.826.625-.246.817.586.192 1.637.14 2.357-.123l1.937-.702v2.142c-.123.021-.259.043-.383.063-1.905.312-3.934.181-6.062-.404z';
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';

interface Platform {
  key: string;
  label: string;
  color: string;
  path: string;
  linked: boolean;
  panel: React.ReactNode;
}

// Colored brand tile (white logo on the platform's color).
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

// Unified "My libraries" page: one tab per platform, only linked ones selectable.
export default function Library() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  if (!user) return null;

  async function toggleVisibility() {
    if (!user || visibilityBusy) return;
    setVisibilityBusy(true);
    try {
      await apiFetch('/users/me/library-visibility', {
        method: 'PATCH',
        body: JSON.stringify({ public: !user.libraryPublic }),
      });
      await refreshUser();
    } finally {
      setVisibilityBusy(false);
    }
  }

  const platforms: Platform[] = [
    {
      key: 'steam',
      label: 'Steam',
      color: '#1b2838',
      path: STEAM_PATH,
      linked: Boolean(user.steamId),
      panel: <SteamLibrary embedded />,
    },
    {
      key: 'psn',
      label: 'PlayStation',
      color: '#0070d1',
      path: PSN_PATH,
      linked: user.psnLinked,
      panel: <PsnLibrary embedded />,
    },
    {
      key: 'xbox',
      label: 'Xbox',
      color: '#107c10',
      path: XBOX_PATH,
      linked: user.xboxLinked,
      panel: <XboxLibrary embedded />,
    },
  ];

  const linkedKeys = platforms.filter((p) => p.linked).map((p) => p.key);
  const requested = params.get('platform');
  const active = requested && linkedKeys.includes(requested) ? requested : (linkedKeys[0] ?? null);
  const activePanel = platforms.find((p) => p.key === active)?.panel ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="relative rounded-3xl border border-zinc-900/10 bg-white p-6 shadow-sm dark:border-zinc-100/10 dark:bg-zinc-900 sm:p-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -left-12 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
        </div>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              <span className="text-accent">●</span> {t('library.eyebrow')}
            </div>
            <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
              {t('library.title')}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
              {t('library.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-900/10 bg-white/60 px-4 py-3 dark:border-zinc-100/10 dark:bg-zinc-900/60">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('library.visibilityTitle')}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {user.libraryPublic ? t('library.visibilityOnDesc') : t('library.visibilityOffDesc')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={user.libraryPublic}
              aria-label={t('library.visibilityTitle')}
              disabled={visibilityBusy}
              onClick={toggleVisibility}
              className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                user.libraryPublic ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  user.libraryPublic ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {platforms.map((p) => {
          const isActive = p.key === active;
          const inner = (
            <>
              <BrandTile color={p.color} path={p.path} />
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold leading-tight">{p.label}</div>
                <div
                  className={`mt-0.5 text-xs ${
                    p.linked ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                >
                  {p.linked ? t('library.linked') : t('library.notLinked')}
                </div>
              </div>
              {isActive ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-zinc-950">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5 9-11" />
                  </svg>
                </span>
              ) : !p.linked ? (
                <span className="shrink-0 rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent">
                  {t('library.link')}
                </span>
              ) : null}
            </>
          );
          const base = 'flex items-center gap-3 rounded-2xl border p-4 text-left transition';
          const cls = isActive
            ? `${base} border-accent bg-accent/[0.07]`
            : p.linked
              ? `${base} border-zinc-900/10 hover:border-accent/50 dark:border-zinc-100/10`
              : `${base} border-dashed border-zinc-300 hover:border-accent dark:border-zinc-700`;
          // Not linked → send to the settings linking window.
          if (!p.linked) {
            return (
              <Link key={p.key} to={`/settings?connect=${p.key}`} className={cls}>
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setParams({ platform: p.key }, { replace: true })}
              className={cls}
            >
              {inner}
            </button>
          );
        })}
      </div>

      {activePanel ?? (
        <EmptyState
          icon={<GamepadIcon />}
          title={t('library.noneLinkedTitle')}
          description={t('library.noneLinkedDesc')}
        >
          <Link
            to="/settings"
            className="mt-2 rounded-lg border border-zinc-400 px-6 py-2 text-sm transition hover:opacity-70 dark:border-zinc-700"
          >
            {t('library.goSettings')}
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
