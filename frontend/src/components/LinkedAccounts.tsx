import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import DiscordBadge from './DiscordBadge';
import PsnConnectModal from './PsnConnectModal';
import SteamBadge from './SteamBadge';

// Logos officiels des services (Simple Icons, CC0), sur fond de la couleur de
// la marque — même style de badge que Steam/Discord.
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';
const SWITCH_PATH =
  'M14.176 24h3.674c3.376 0 6.15-2.774 6.15-6.15V6.15C24 2.775 21.226 0 17.85 0H14.1c-.074 0-.15.074-.15.15v23.7c-.001.076.075.15.226.15zm4.574-13.199c1.351 0 2.399 1.125 2.399 2.398 0 1.352-1.125 2.4-2.399 2.4-1.35 0-2.4-1.049-2.4-2.4-.075-1.349 1.05-2.398 2.4-2.398zM11.4 0H6.15C2.775 0 0 2.775 0 6.15v11.7C0 21.226 2.775 24 6.15 24h5.25c.074 0 .15-.074.15-.149V.15c.001-.076-.075-.15-.15-.15zM9.676 22.051H6.15c-2.326 0-4.201-1.875-4.201-4.201V6.15c0-2.326 1.875-4.201 4.201-4.201H9.6l.076 20.102zM3.75 7.199c0 1.275.975 2.25 2.25 2.25s2.25-.975 2.25-2.25c0-1.273-.975-2.25-2.25-2.25s-2.25.977-2.25 2.25z';
const PLAYSTATION_PATH =
  'M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.5V14.98l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.03 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.205 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z';

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

// Une entrée du bloc « Comptes liés ». Ajouter un vrai service plus tard = une
// ligne de plus ici (icône + linked + linkHref + unlinkPath).
interface Service {
  key: string;
  label: string;
  mark: ReactNode;
  available: boolean;
  linked: boolean;
  linkHref?: string; // navigation navigateur qui démarre le rattachement OAuth
  onLink?: () => void; // rattachement via modale (ex. PlayStation : coller un jeton)
  unlinkPath?: string; // endpoint DELETE
  extra?: ReactNode; // action en plus quand lié (ex. « voir la bibliothèque »)
}

const pill =
  'rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-zinc-600';

export default function LinkedAccounts() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [psnModalOpen, setPsnModalOpen] = useState(false);

  if (!user) return null;

  const steamNotice = searchParams.get('steam'); // ?steam=linked|taken (callback Steam)
  const linkNotice = searchParams.get('link'); // ?link=discord_linked|discord_taken

  const services: Service[] = [
    {
      key: 'steam',
      label: 'Steam',
      mark: <SteamBadge />,
      available: true,
      linked: !!user.steamId,
      linkHref: '/api/auth/steam',
      unlinkPath: '/auth/steam/link',
      extra: user.steamId ? (
        <Link to="/library?platform=steam" className={pill}>
          {t('settings.steam.viewLibrary')}
        </Link>
      ) : undefined,
    },
    {
      key: 'discord',
      label: 'Discord',
      mark: <DiscordBadge />,
      available: true,
      linked: !!user.discordId,
      linkHref: '/api/auth/discord/link',
      unlinkPath: '/auth/discord/link',
    },
    {
      key: 'xbox',
      label: 'Xbox',
      mark: <BrandMark color="#107C10" path={XBOX_PATH} />,
      available: false,
      linked: false,
    },
    {
      key: 'switch',
      label: 'Nintendo',
      mark: <BrandMark color="#E60012" path={SWITCH_PATH} />,
      available: false,
      linked: false,
    },
    {
      key: 'playstation',
      label: 'PlayStation',
      mark: <BrandMark color="#003791" path={PLAYSTATION_PATH} />,
      available: true,
      linked: user.psnLinked,
      onLink: () => setPsnModalOpen(true),
      unlinkPath: '/psn/link',
      extra: user.psnLinked ? (
        <>
          {user.psnOnlineId && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{user.psnOnlineId}</span>
          )}
          <Link to="/library?platform=psn" className={pill}>
            {t('settings.psn.viewLibrary')}
          </Link>
        </>
      ) : undefined,
    },
  ];

  async function unlink(key: string, path: string) {
    setError(null);
    setBusy(key);
    try {
      await apiFetch(path, { method: 'DELETE' });
      await refreshUser();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('settings.connections.unlinkError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card mb-10 p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {/* Maillons filaires (trait 1.6, style TiMN) : comptes liés */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 fill-none stroke-current"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
          <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        </svg>
        {t('settings.connections.title')}
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        {t('settings.connections.description')}
      </p>

      {steamNotice === 'linked' && (
        <p className="mb-3 text-sm text-green-600 dark:text-green-400">
          {t('settings.steam.linkedSuccess')}
        </p>
      )}
      {steamNotice === 'taken' && (
        <p className="mb-3 text-sm text-red-500 dark:text-red-400">
          {t('settings.steam.alreadyLinkedError')}
        </p>
      )}
      {linkNotice === 'discord_linked' && (
        <p className="mb-3 text-sm text-green-600 dark:text-green-400">
          {t('settings.connections.discordLinked')}
        </p>
      )}
      {linkNotice === 'discord_taken' && (
        <p className="mb-3 text-sm text-red-500 dark:text-red-400">
          {t('settings.connections.discordTaken')}
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-500 dark:text-red-400">{error}</p>}

      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {services.map((s) => (
          <li
            key={s.key}
            className={`flex flex-wrap items-center justify-between gap-3 py-3 ${
              s.available ? '' : 'opacity-60'
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              {s.mark}
              <span className="text-sm font-medium">{s.label}</span>
              {s.available && s.linked && (
                <span className="text-xs text-green-600 dark:text-green-400">
                  ✓ {t('settings.connections.connected')}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              {!s.available && (
                <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {t('settings.connections.comingSoon')}
                </span>
              )}
              {s.available && s.linked && s.extra}
              {s.available && s.linked && s.unlinkPath && (
                <button
                  type="button"
                  onClick={() => unlink(s.key, s.unlinkPath!)}
                  disabled={busy === s.key}
                  className={pill}
                >
                  {busy === s.key
                    ? t('settings.connections.unlinking')
                    : t('settings.connections.unlink')}
                </button>
              )}
              {s.available && !s.linked && s.linkHref && (
                <a href={s.linkHref} className={pill}>
                  {t('settings.connections.link')}
                </a>
              )}
              {s.available && !s.linked && s.onLink && (
                <button type="button" onClick={s.onLink} className={pill}>
                  {t('settings.connections.link')}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {psnModalOpen && <PsnConnectModal onClose={() => setPsnModalOpen(false)} />}
    </div>
  );
}
