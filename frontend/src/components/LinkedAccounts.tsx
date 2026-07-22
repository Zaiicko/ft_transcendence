import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import DiscordBadge from './DiscordBadge';
import SteamBadge from './SteamBadge';

// Carré de marque générique (services « Bientôt ») — manette filaire sur la
// couleur du service.
function GamepadMark({ color }: { color: string }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-white ring-1 ring-zinc-700"
      style={{ backgroundColor: color }}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        <path d="M6 7h12a4 4 0 0 1 4 4v2a4 4 0 0 1-7.2 2.4l-.3-.4H9.5l-.3.4A4 4 0 0 1 2 13v-2a4 4 0 0 1 4-4Zm1 3v1H6v1h1v1h1v-1h1v-1H8v-1H7Zm8.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
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
        <Link to="/steam" className={pill}>
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
    { key: 'xbox', label: 'Xbox', mark: <GamepadMark color="#107C10" />, available: false, linked: false },
    {
      key: 'switch',
      label: 'Nintendo Switch',
      mark: <GamepadMark color="#E60012" />,
      available: false,
      linked: false,
    },
    {
      key: 'playstation',
      label: 'PlayStation',
      mark: <GamepadMark color="#003791" />,
      available: false,
      linked: false,
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
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
