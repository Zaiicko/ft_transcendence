import { FormEvent, useCallback, useEffect, useState } from 'react';
import FortyTwoBadge from '../components/FortyTwoBadge';
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

export default function Friends() {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRow[]>([]);
  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
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
        apiFetch<PublicUser[]>('/friends/suggestions'),
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

  if (loading) return <p className="text-zinc-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Friends</h1>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form onSubmit={handleSendRequest} className="mb-2 flex gap-2">
        <input
          type="text"
          placeholder="Username to add"
          value={targetUsername}
          onChange={(e) => setTargetUsername(e.target.value)}
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-zinc-100 px-4 py-2 font-medium text-zinc-950 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {sendError && <p className="mb-6 text-sm text-red-400">{sendError}</p>}

      {incoming.length > 0 && (
        <section className="mb-8 mt-6">
          <h2 className="mb-3 font-medium text-zinc-300">Pending requests</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2">
                <span className="flex items-center gap-2">
                  {r.user.username}
                  {r.user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'accept')}
                    className="rounded bg-zinc-100 px-2 py-1 text-sm text-zinc-950"
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
          <h2 className="mb-3 font-medium text-zinc-300">Sent requests</h2>
          <ul className="flex flex-col gap-2">
            {outgoing.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2">
                <span className="flex items-center gap-2">
                  {r.user.username}
                  {r.user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                </span>
                <span className="text-sm text-zinc-500">Pending</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 font-medium text-zinc-300">People from 42</h2>
          <p className="mb-3 text-sm text-zinc-500">Other students who signed in with their 42 account.</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2">
                <span className="flex items-center gap-2">
                  {s.username}
                  <FortyTwoBadge />
                </span>
                <button
                  type="button"
                  onClick={() => sendRequest(s.username)}
                  className="rounded bg-zinc-100 px-2 py-1 text-sm text-zinc-950"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-medium text-zinc-300">Your friends</h2>
        {friends.length === 0 ? (
          <p className="text-sm text-zinc-500">No friends yet — add one by username above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${f.isOnline ? 'bg-green-500' : 'bg-zinc-600'}`}
                    title={f.isOnline ? 'Online' : 'Offline'}
                  />
                  {f.username}
                  {f.provider === 'FORTYTWO' && <FortyTwoBadge />}
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
