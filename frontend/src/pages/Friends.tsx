import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Avatar from '../components/Avatar';
import EmptyState, { UsersIcon } from '../components/EmptyState';
import DiscordBadge from '../components/DiscordBadge';
import FortyTwoBadge from '../components/FortyTwoBadge';
import Skeleton from '../components/Skeleton';
import SteamBadge from '../components/SteamBadge';
import { useFriendSocket } from '../friends/useFriendSocket';
import { usePresenceSocket } from '../friends/usePresenceSocket';
import { apiFetch, ApiError } from '../lib/api';
import type { PublicUser } from '../lib/types';

interface FriendRow extends PublicUser {
  isOnline: boolean;
}

interface FriendRequestRow {
  id: number;
  createdAt: string;
  user: PublicUser;
}

// Suggested by the backend: your Steam friends on Saveboxd, or fellow
// 42 students when you signed in with 42
type Suggestion = PublicUser & { via: 'steam' | '42' };

export default function Friends() {
  const { t } = useTranslation();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRow[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [targetUsername, setTargetUsername] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // load() is deliberately split into a pure fetch + stable state-applying
  // callbacks: its body contains no setState, so it stays safe to call from
  // the effect below (react-hooks/set-state-in-effect) — every state update
  // happens in an async promise callback.
  const fetchAll = useCallback(
    () =>
      Promise.all([
        apiFetch<FriendRow[]>('/friends'),
        apiFetch<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }>('/friends/requests'),
        apiFetch<Suggestion[]>('/friends/suggestions'),
      ]),
    [],
  );

  const applyData = useCallback(
    ([friendsList, requests, suggested]: Awaited<ReturnType<typeof fetchAll>>) => {
      setFriends(friendsList);
      setIncoming(requests.incoming);
      setOutgoing(requests.outgoing);
      setSuggestions(suggested);
      setError(null);
    },
    // `fetchAll` is only used as a type above, not as a value
    [],
  );

  const applyError = useCallback(
    (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t('friends.loadError'));
    },
    [t],
  );

  const stopLoading = useCallback(() => setLoading(false), []);

  const load = useCallback(
    () => fetchAll().then(applyData).catch(applyError).finally(stopLoading),
    [fetchAll, applyData, applyError, stopLoading],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Temps réel : demande reçue/acceptée/refusée/retirée → amis + demandes se
  // mettent à jour sans refresh (l'autre côté aussi).
  useFriendSocket(load, true);

  usePresenceSocket(
    {
      onOnline: (userId) =>
        setFriends((prev) => prev.map((f) => (f.id === userId ? { ...f, isOnline: true } : f))),
      onOffline: (userId) =>
        setFriends((prev) => prev.map((f) => (f.id === userId ? { ...f, isOnline: false } : f))),
    },
    !loading,
  );

  async function sendRequest(username: string) {
    await apiFetch(`/friends/requests/${encodeURIComponent(username)}`, { method: 'POST' });
    await load();
  }

  async function handleSendRequest(e: FormEvent) {
    e.preventDefault();
    setSendError(null);
    const username = targetUsername.trim();
    if (!username) {
      setSendError(t('friends.enterUsernameError'));
      return;
    }
    setSending(true);
    try {
      await sendRequest(username);
      setTargetUsername('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('friends.sendError'));
    } finally {
      setSending(false);
    }
  }

  async function respond(requestId: number, action: 'accept' | 'decline') {
    if (action === 'accept') {
      await apiFetch(`/friends/requests/${requestId}/accept`, { method: 'POST' });
    } else {
      await apiFetch(`/friends/requests/${requestId}`, { method: 'DELETE' });
    }
    await load();
  }

  async function unfriend(userId: number) {
    await apiFetch(`/friends/${userId}`, { method: 'DELETE' });
    await load();
  }

  if (loading)
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="mb-6 h-8 w-32" />
        <Skeleton className="mb-6 h-9 w-full rounded-full" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('friends.title')}</h1>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form onSubmit={handleSendRequest} className="mb-2 flex gap-2">
        <input
          type="text"
          placeholder={t('friends.addPlaceholder')}
          value={targetUsername}
          onChange={(e) => setTargetUsername(e.target.value)}
          className="field flex-1 px-4 py-1.5"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-accent px-5 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {t('friends.add')}
        </button>
      </form>
      {sendError && <p className="mb-6 text-sm text-red-400">{sendError}</p>}

      {incoming.length > 0 && (
        <section className="mb-8 mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('friends.pendingRequests')}</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((r) => (
              <li key={r.id} className="card flex items-center gap-3 px-3 py-2">
                <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={28} />
                <span className="flex items-center gap-2">
                  {r.user.username}
                  {r.user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {r.user.provider === 'DISCORD' && <DiscordBadge />}
                  {r.user.steamId && <SteamBadge />}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'accept')}
                    title={t('friends.accept')}
                    aria-label={`${t('friends.accept')} ${r.user.username}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-zinc-950 transition hover:brightness-110"
                  >
                    {/* Coche "v" filaire */}
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 fill-none stroke-current"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12l5 5 9-11" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'decline')}
                    title={t('friends.decline')}
                    aria-label={`${t('friends.decline')} ${r.user.username}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-red-400 hover:text-red-400 dark:border-zinc-600 dark:text-zinc-400"
                  >
                    {/* Croix filaire */}
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5 fill-none stroke-current"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('friends.sentRequests')}</h2>
          <ul className="flex flex-col gap-2">
            {outgoing.map((r) => (
              <li key={r.id} className="card flex items-center gap-3 px-3 py-2">
                <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={28} />
                <span className="flex items-center gap-2">
                  {r.user.username}
                  {r.user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {r.user.provider === 'DISCORD' && <DiscordBadge />}
                  {r.user.steamId && <SteamBadge />}
                </span>
                <span className="ml-auto text-sm text-zinc-500">{t('friends.pending')}</span>
                <button
                  type="button"
                  onClick={() => respond(r.id, 'decline')}
                  title={t('friends.cancelRequest')}
                  aria-label={`${t('friends.cancelRequest')} ${r.user.username}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-red-400 hover:text-red-400 dark:border-zinc-600 dark:text-zinc-400"
                >
                  {/* Croix filaire (trait 2) : annuler */}
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5 fill-none stroke-current"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('friends.suggestedFriends')}</h2>
        {suggestions.length > 0 && (
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.id} className="card flex items-center gap-3 px-3 py-2">
                <Avatar username={s.username} avatarUrl={s.avatarUrl} size={28} />
                <span className="flex items-center gap-2">
                  {s.username}
                  {s.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {s.provider === 'DISCORD' && <DiscordBadge />}
                  {s.steamId && <SteamBadge />}
                </span>
                <button
                  type="button"
                  onClick={() => sendRequest(s.username)}
                  className="ml-auto rounded-full bg-accent px-3 py-1 text-sm font-medium text-zinc-950 transition hover:brightness-110"
                >
                  {t('friends.add')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('friends.yourFriends')}</h2>
        {friends.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={t('friends.noFriendsTitle')}
            description={t('friends.noFriendsDescription')}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((f) => (
              <li key={f.id} className="card flex items-center gap-3 px-3 py-2">
                {/* Avatar + pastille de présence posée sur son coin bas-droit */}
                <span className="relative shrink-0">
                  <Avatar username={f.username} avatarUrl={f.avatarUrl} size={32} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-50 dark:border-zinc-900 ${
                      f.isOnline ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'
                    }`}
                    title={f.isOnline ? t('friends.online') : t('friends.offline')}
                  />
                </span>
                <span className="flex items-center gap-2">
                  {f.username}
                  {f.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {f.provider === 'DISCORD' && <DiscordBadge />}
                  {f.steamId && <SteamBadge />}
                </span>
                <button
                  type="button"
                  onClick={() => unfriend(f.id)}
                  title={t('friends.removeFriend')}
                  aria-label={`${t('friends.removeFriend')} ${f.username}`}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-red-400 hover:text-red-400 dark:border-zinc-600 dark:text-zinc-400"
                >
                  {/* Poubelle filaire */}
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-none stroke-current"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
