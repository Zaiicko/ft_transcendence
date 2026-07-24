import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import EmptyState, { GamepadIcon } from '../components/EmptyState';
import PsnBadge from '../components/PsnBadge';
import SteamBadge from '../components/SteamBadge';
import PsnLibrary from './PsnLibrary';
import SteamLibrary from './SteamLibrary';

// Logos Xbox / Switch (Simple Icons, CC0) pour les onglets « bientôt »
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';
const SWITCH_PATH =
  'M14.176 24h3.674c3.376 0 6.15-2.774 6.15-6.15V6.15C24 2.775 21.226 0 17.85 0H14.1c-.074 0-.15.074-.15.15v23.7c-.001.076.075.15.226.15zm4.574-13.199c1.351 0 2.399 1.125 2.399 2.398 0 1.352-1.125 2.4-2.399 2.4-1.35 0-2.4-1.049-2.4-2.4-.075-1.349 1.05-2.398 2.4-2.398zM11.4 0H6.15C2.775 0 0 2.775 0 6.15v11.7C0 21.226 2.775 24 6.15 24h5.25c.074 0 .15-.074.15-.149V.15c.001-.076-.075-.15-.15-.15zM9.676 22.051H6.15c-2.326 0-4.201-1.875-4.201-4.201V6.15c0-2.326 1.875-4.201 4.201-4.201H9.6l.076 20.102zM3.75 7.199c0 1.275.975 2.25 2.25 2.25s2.25-.975 2.25-2.25c0-1.273-.975-2.25-2.25-2.25s-2.25.977-2.25 2.25z';

function BrandMark({ color, path }: { color: string; path: string }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-white ring-1 ring-zinc-700"
      style={{ backgroundColor: color }}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    </span>
  );
}

interface Platform {
  key: string;
  label: string;
  mark: ReactNode;
  linked: boolean;
  comingSoon: boolean;
  panel?: ReactNode;
}

// Page globale « Mes bibliothèques » : un onglet par plateforme. Seules celles
// dont le compte est lié sont sélectionnables ; Xbox/Switch restent « bientôt ».
export default function Library() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  if (!user) return null;

  const platforms: Platform[] = [
    {
      key: 'steam',
      label: 'Steam',
      mark: <SteamBadge />,
      linked: Boolean(user.steamId),
      comingSoon: false,
      panel: <SteamLibrary embedded />,
    },
    {
      key: 'psn',
      label: 'PlayStation',
      mark: <PsnBadge />,
      linked: user.psnLinked,
      comingSoon: false,
      panel: <PsnLibrary embedded />,
    },
    {
      key: 'xbox',
      label: 'Xbox',
      mark: <BrandMark color="#107C10" path={XBOX_PATH} />,
      linked: false,
      comingSoon: true,
    },
    {
      key: 'switch',
      label: 'Nintendo',
      mark: <BrandMark color="#E60012" path={SWITCH_PATH} />,
      linked: false,
      comingSoon: true,
    },
  ];

  const linkedKeys = platforms.filter((p) => p.linked).map((p) => p.key);
  const requested = params.get('platform');
  const active = requested && linkedKeys.includes(requested) ? requested : (linkedKeys[0] ?? null);
  const activePanel = platforms.find((p) => p.key === active)?.panel ?? null;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('library.title')}</h1>

      {/* Sélecteur de plateformes */}
      <div className="mb-8 flex flex-wrap gap-2">
        {platforms.map((p) => {
          const isActive = p.key === active;
          return (
            <button
              key={p.key}
              type="button"
              disabled={!p.linked}
              onClick={() => setParams({ platform: p.key }, { replace: true })}
              className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition ${
                isActive
                  ? 'border-accent bg-accent font-medium text-zinc-950'
                  : p.linked
                    ? 'border-zinc-400/60 hover:border-accent hover:text-accent dark:border-zinc-600'
                    : 'cursor-not-allowed border-zinc-300/60 text-zinc-400 opacity-60 dark:border-zinc-700 dark:text-zinc-500'
              }`}
            >
              {p.mark}
              <span>{p.label}</span>
              {p.comingSoon && (
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {t('settings.connections.comingSoon')}
                </span>
              )}
              {!p.linked && !p.comingSoon && (
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {t('library.notLinked')}
                </span>
              )}
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
