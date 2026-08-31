import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import EmptyState, { GamepadIcon } from './EmptyState';
import { apiFetch } from '../lib/api';
import type { ProfilePlayedGame } from '../lib/types';

// Full list of completed games shown in the profile modal, each linking to its game page.
export default function ProfilePlayedGames({ username }: { username: string }) {
  const { t, i18n } = useTranslation();
  const [games, setGames] = useState<ProfilePlayedGame[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ProfilePlayedGame[]>(`/users/profile/${encodeURIComponent(username)}/played`)
      .then((rows) => {
        if (!cancelled) setGames(rows);
      })
      .catch(() => {
        if (!cancelled) setGames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (games === null) return <p className="py-6 text-center text-sm text-zinc-500">{t('reviews.loading')}</p>;

  if (games.length === 0) {
    return (
      <EmptyState
        icon={<GamepadIcon />}
        title={t('profile.noPlayedGames')}
        description={t('profile.noPlayedGamesDesc')}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {games.map(({ game, playedAt }) => (
        <li key={game.id}>
          <Link
            to={`/game/${game.id}`}
            className="card flex items-center gap-3 p-2 transition hover:border-accent/60"
          >
            {game.coverUrl ? (
              <img src={game.coverUrl} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
            ) : (
              <span className="block h-14 w-10 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{game.title}</span>
            {playedAt && (
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(playedAt).toLocaleDateString(i18n.language)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
