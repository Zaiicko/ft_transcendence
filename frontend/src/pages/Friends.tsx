import { FormEvent, useCallback, useEffect, useState } from 'react';
import Avatar from '../components/Avatar';
import EmptyState, { UsersIcon } from '../components/EmptyState';
import FortyTwoBadge from '../components/FortyTwoBadge';
import Skeleton from '../components/Skeleton';
import SteamBadge from '../components/SteamBadge';
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

  const applyError = useCallback((err: unknown) => {
    setError(err instanceof ApiError ? err.message : 'Could not load friends');
  }, []);

  const stopLoading = useCallback(() => setLoading(false), []);

  const load = useCallback(
    () => fetchAll().then(applyData).catch(applyError).finally(stopLoading),
    [fetchAll, applyData, applyError, stopLoading],
  );

  useEffect(() => {
    void load();
  }, [load]);

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
      setSendError('Enter a username');
      return;
    }
    setSending(true);
    try {
      await sendRequest(username);
      setTargetUsername('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Could not send request');
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
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Friends</h1>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form onSubmit={handleSendRequest} className="mb-2 flex gap-2">
        <input
          type="text"
          placeholder="Username to add"
          value={targetUsername}
          onChange={(e) => setTargetUsername(e.target.value)}
          className="field flex-1 px-4 py-1.5"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-accent px-5 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {sendError && <p className="mb-6 text-sm text-red-400">{sendError}</p>}

      {incoming.length > 0 && (
        <section className="mb-8 mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Pending requests</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((r) => (
              <li key={r.id} className="card flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2">
                  {r.user.username}
                  {r.user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {r.user.steamId && <SteamBadge />}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'accept')}
                    className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-zinc-950 transition hover:brightness-110"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'decline')}
                    className="rounded border border-zinc-700 px-2 py-1 text-sm"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Sent requests</h2>
          <ul className="flex flex-col gap-2">
            {outgoing.map((r) => (
              <li key={r.id} className="card flex items-center gap-3 px-3 py-2">
                <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={28} />
                <span className="flex items-center gap-2">
                  {r.user.username}
                  {r.user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {r.user.steamId && <SteamBadge />}
                </span>
                <span className="ml-auto text-sm text-zinc-500">Pending</span>
                <button
                  type="button"
                  onClick={() => respond(r.id, 'decline')}
                  title="Annuler la demande"
                  aria-label={`Annuler la demande à ${r.user.username}`}
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
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Suggested friends</h2>
        {suggestions.length > 0 && (
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.id} className="card flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2">
                  {s.username}
                  {s.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {s.steamId && <SteamBadge />}
                </span>
                <button
                  type="button"
                  onClick={() => sendRequest(s.username)}
                  className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-zinc-950 transition hover:brightness-110"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Your friends</h2>
        {friends.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No friends yet"
            description="Add someone by username above, or check the suggestions."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((f) => (
              <li key={f.id} className="card flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${f.isOnline ? 'bg-green-500' : 'bg-zinc-600'}`}
                    title={f.isOnline ? 'Online' : 'Offline'}
                  />
                  {f.username}
                  {f.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {f.steamId && <SteamBadge />}
                </span>
                <button
                  type="button"
                  onClick={() => unfriend(f.id)}
                  className="text-sm text-zinc-500 hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
