import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import Avatar from './Avatar';

// Ce qu'on partage : exactement une variante, mappée sur POST /chat
export type ShareTarget =
  | { type: 'GAME'; gameId: number }
  | { type: 'REVIEW'; reviewId: number }
  | { type: 'PROFILE'; sharedUserId: number };

type Friend = { id: number; username: string; avatarUrl: string | null };

// Bouton "enveloppe" : ouvre un mini-sélecteur d'amis et envoie le partage
// (jeu / avis / profil) dans le chat. `triggerClassName` adapte le style au
// contexte (rond sur les en-têtes, discret dans une barre d'actions).
export default function ShareButton({
  target,
  triggerClassName,
  dropUp = false,
  title,
}: {
  target: ShareTarget;
  triggerClassName: string;
  dropUp?: boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  const label = title ?? t('share.defaultTitle');
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sentTo, setSentTo] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<Friend[]>('/friends')
      .then((list) => {
        if (!cancelled) setFriends(list);
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!user) return null;

  async function shareTo(friendId: number) {
    setBusyId(friendId);
    try {
      await apiFetch('/chat', {
        method: 'POST',
        body: JSON.stringify({ toUserId: friendId, ...target }),
      });
      setSentTo((cur) => new Set(cur).add(friendId));
    } catch {
      /* silencieux : on peut réessayer */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        className={triggerClassName}
      >
        <ShareIcon />
      </button>

      {open && (
        <div
          className={`absolute right-0 z-30 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
            dropUp ? 'bottom-full mb-2' : 'mt-2'
          }`}
        >
          <p className="border-b border-zinc-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            {t('share.shareTo')}
          </p>
          <div className="max-h-64 overflow-y-auto">
            {friends === null ? (
              <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{t('share.loading')}</p>
            ) : friends.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('share.noFriends')}
              </p>
            ) : (
              <ul className="py-1">
                {friends.map((f) => {
                  const sent = sentTo.has(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => shareTo(f.id)}
                        disabled={busyId === f.id || sent}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-zinc-100 disabled:opacity-70 dark:hover:bg-zinc-800"
                      >
                        <Avatar username={f.username} avatarUrl={f.avatarUrl} size={28} />
                        <span className="min-w-0 flex-1 truncate">{f.username}</span>
                        {sent ? (
                          <span className="shrink-0 text-xs font-medium text-emerald-500">
                            {t('share.sent')}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-accent">{t('share.send')}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Icône "partage" iOS/web : flèche vers le haut sortant d'une boîte
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 fill-none stroke-current"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7" />
    </svg>
  );
}
