import { ReactNode, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import i18n from '../i18n';
import { apiFetch } from '../lib/api';
import { FAMILY_NAME_KEY, parseAchievementKey } from '../lib/achievements';
import type { AppNotification } from '../lib/types';
import AchievementIcon from './AchievementIcon';
import { useNotificationSocket } from '../notifications/useNotificationSocket';
import Avatar from './Avatar';

// Cloche de notifications (navbar) : pastille de non-lus + panneau déroulant.
// Temps réel via `notification:new`. Rendue uniquement pour un user connecté.
export default function NotificationBell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Compteur de non-lus au montage (persiste même panneau fermé)
  useEffect(() => {
    if (!user) return;
    apiFetch<{ count: number }>('/notifications/unread-count')
      .then((r) => setUnread(r.count))
      .catch(() => {});
  }, [user]);

  // Liste chargée à l'ouverture — et ouvrir le panneau = tout marquer comme VU
  // (le badge disparaît, pas besoin de bouton « tout lire »).
  useEffect(() => {
    if (!open) return;
    apiFetch<AppNotification[]>('/notifications?page=1&limit=20')
      .then((list) =>
        setItems(list.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }))),
      )
      .catch(() => {});
    setUnread(0);
    apiFetch('/notifications/read-all', { method: 'PATCH' }).catch(() => {});
  }, [open]);

  // Fermeture au clic extérieur / Échap
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useNotificationSocket((n) => {
    setItems((cur) => (cur.some((x) => x.id === n.id) ? cur : [n, ...cur]));
    setUnread((u) => u + 1);
  }, !!user);

  if (!user) return null;

  function markRead(id: number) {
    setItems((cur) =>
      cur.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
    apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }

  // Bouton « clear » : vide toutes les notifications.
  function clearAll() {
    setItems([]);
    setUnread(0);
    apiFetch('/notifications', { method: 'DELETE' }).catch(() => {});
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notifications.title')}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition hover:text-accent dark:text-zinc-400"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-zinc-50 dark:ring-zinc-950"
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
            <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 transition hover:text-red-500 dark:text-zinc-400"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                </svg>
                {t('notifications.clear')}
              </button>
            )}
          </header>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {t('notifications.empty')}
              </p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={linkFor(n)}
                      onClick={() => {
                        if (!n.readAt) markRead(n.id);
                        setOpen(false);
                      }}
                      className={`flex gap-3 px-4 py-3 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        n.readAt ? '' : 'bg-accent/5'
                      }`}
                    >
                      {n.type === 'ACHIEVEMENT' ? (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                          <AchievementIcon
                            family={parseAchievementKey(n.payload.achievementKey ?? '').family}
                            className="h-4 w-4"
                          />
                        </span>
                      ) : (
                        <Avatar
                          username={n.payload.actorUsername ?? '?'}
                          avatarUrl={n.payload.actorAvatarUrl ?? null}
                          size={32}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">{messageFor(n)}</span>
                        <span className="mt-0.5 block text-xs text-zinc-400">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                      {!n.readAt && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Cible du clic selon le type
function linkFor(n: AppNotification): string {
  const p = n.payload;
  switch (n.type) {
    case 'REVIEW_LIKE':
    case 'REVIEW_COMMENT':
    case 'COMMENT_REPLY':
      if (p.reviewId && p.gameId) return `/game/${p.gameId}#review-${p.reviewId}`;
      if (p.reviewId && p.companyId) return `/company/${p.companyId}#review-${p.reviewId}`;
      return '#';
    case 'FRIEND_REQUEST':
      return '/friends';
    case 'FRIEND_ACCEPT':
    case 'NEW_MESSAGE':
    case 'FRIEND_JOINED':
      return p.actorUsername ? `/u/${p.actorUsername}` : '#';
    default:
      return '#';
  }
}

// Libellé de la notification (acteur en gras). L'ordre des mots et la tournure
// sont portés par les clés de traduction ; <Trans> insère le nom en gras.
function messageFor(n: AppNotification): ReactNode {
  const who = n.payload.actorUsername ?? i18n.t('notifications.someone');
  const title = n.payload.reviewTitle;
  const components = { b: <strong className="font-semibold" /> };
  switch (n.type) {
    case 'REVIEW_LIKE':
      return (
        <Trans
          i18nKey={title ? 'notifications.reviewLikeTitled' : 'notifications.reviewLike'}
          values={{ who, title }}
          components={components}
        />
      );
    case 'REVIEW_COMMENT':
      return (
        <Trans
          i18nKey={title ? 'notifications.reviewCommentTitled' : 'notifications.reviewComment'}
          values={{ who, title }}
          components={components}
        />
      );
    case 'COMMENT_REPLY':
      return <Trans i18nKey="notifications.commentReply" values={{ who }} components={components} />;
    case 'FRIEND_REQUEST':
      return <Trans i18nKey="notifications.friendRequest" values={{ who }} components={components} />;
    case 'FRIEND_ACCEPT':
      return <Trans i18nKey="notifications.friendAccept" values={{ who }} components={components} />;
    case 'NEW_MESSAGE':
      return <Trans i18nKey="notifications.newMessage" values={{ who }} components={components} />;
    case 'FRIEND_JOINED':
      return (
        <Trans
          i18nKey="notifications.friendJoined"
          values={{ who, via: n.payload.via === '42' ? '42' : 'Steam' }}
          components={components}
        />
      );
    case 'ACHIEVEMENT': {
      const { family, threshold } = parseAchievementKey(n.payload.achievementKey ?? '');
      const name = FAMILY_NAME_KEY[family] ? `${i18n.t(FAMILY_NAME_KEY[family])} (${threshold})` : '';
      return <Trans i18nKey="notifications.achievement" values={{ name }} components={components} />;
    }
    default:
      return <strong className="font-semibold">{who}</strong>;
  }
}

function relativeTime(iso: string): string {
  const t = i18n.t.bind(i18n);
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('feed.timeNow');
  if (min < 60) return t('feed.timeMinutes', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('feed.timeHours', { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('feed.timeDays', { count: d });
  return new Date(iso).toLocaleDateString(i18n.language);
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
