import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import type { AppNotification } from '../lib/types';
import { useNotificationSocket } from '../notifications/useNotificationSocket';
import Avatar from './Avatar';

// Cloche de notifications (navbar) : pastille de non-lus + panneau déroulant.
// Temps réel via `notification:new`. Rendue uniquement pour un user connecté.
export default function NotificationBell() {
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

  // Liste chargée à l'ouverture
  useEffect(() => {
    if (!open) return;
    apiFetch<AppNotification[]>('/notifications?page=1&limit=20')
      .then(setItems)
      .catch(() => {});
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

  function markAllRead() {
    setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnread(0);
    apiFetch('/notifications/read-all', { method: 'PATCH' }).catch(() => {});
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition hover:text-accent dark:text-zinc-400"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-accent transition hover:brightness-110"
              >
                Tout marquer lu
              </button>
            )}
          </header>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Aucune notification.
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
                      <Avatar
                        username={n.payload.actorUsername ?? '?'}
                        avatarUrl={n.payload.actorAvatarUrl ?? null}
                        size={32}
                      />
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

// Libellé de la notification (acteur en gras)
function messageFor(n: AppNotification): ReactNode {
  const who = <strong className="font-semibold">{n.payload.actorUsername ?? 'Quelqu’un'}</strong>;
  const title = n.payload.reviewTitle;
  switch (n.type) {
    case 'REVIEW_LIKE':
      return <>{who} a aimé ton avis {title && <>« {title} »</>}</>;
    case 'REVIEW_COMMENT':
      return <>{who} a commenté ton avis {title && <>« {title} »</>}</>;
    case 'COMMENT_REPLY':
      return <>{who} a répondu à ton commentaire</>;
    case 'FRIEND_REQUEST':
      return <>{who} t’a envoyé une demande d’ami</>;
    case 'FRIEND_ACCEPT':
      return <>{who} a accepté ta demande d’ami</>;
    case 'NEW_MESSAGE':
      return <>{who} t’a envoyé un message</>;
    case 'FRIEND_JOINED':
      return (
        <>
          {who} ({n.payload.via === '42' ? '42' : 'Steam'}) a rejoint Saveboxd
        </>
      );
    default:
      return <>{who}</>;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr');
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
