import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import EmptyState, { UsersIcon } from '../components/EmptyState';
import DiscordBadge from '../components/DiscordBadge';
import FortyTwoBadge from '../components/FortyTwoBadge';
import PsnBadge from '../components/PsnBadge';
import SectionHead from '../components/SectionHead';
import Skeleton from '../components/Skeleton';
import SteamBadge from '../components/SteamBadge';
import XboxBadge from '../components/XboxBadge';
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

// Suggested by the backend: your Steam friends on Saveboxd, or fellow 42 students.
type Suggestion = PublicUser & { via: 'steam' | '42' | 'psn' };

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

  // load() has no setState in its body (safe from the effect); updates happen in async callbacks.
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

  // Real-time: friend requests/accepts/removals update friends + requests without a refresh.
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
      <div className="flex flex-col gap-8">
        <Skeleton className="h-44 w-full rounded-3xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );

  const onlineCount = friends.filter((f) => f.isOnline).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="relative rounded-3xl border border-zinc-900/10 bg-white p-6 shadow-sm dark:border-zinc-100/10 dark:bg-zinc-900 sm:p-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -left-12 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                <span className="text-accent">●</span> {t('friends.eyebrow')}
              </div>
              <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
                {t('friends.title')}
              </h1>
            </div>
            <div className="flex gap-6">
              <Stat value={friends.length} label={t('friends.statFriends')} />
              <Stat value={onlineCount} label={t('friends.statOnline')} tone="green" />
              <Stat value={incoming.length} label={t('friends.statPending')} />
            </div>
          </div>

          <form onSubmit={handleSendRequest} className="mt-6 flex gap-2 sm:gap-3">
            <input
              type="text"
              placeholder={t('friends.addPlaceholder')}
              value={targetUsername}
              onChange={(e) => setTargetUsername(e.target.value)}
              className="field flex-1 px-4 py-2.5"
            />
            <button
              type="submit"
              disabled={sending}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t('friends.add')}
            </button>
          </form>
          {sendError && <p className="mt-2 text-sm text-red-400">{sendError}</p>}
        </div>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {incoming.length > 0 && (
        <section>
          <SectionHead eyebrow={t('friends.eyeRequests')} title={t('friends.pendingRequests')} />
          <div className="grid gap-3 sm:grid-cols-2">
            {incoming.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/[0.06] p-3.5 shadow-sm"
              >
                <Link to={`/u/${r.user.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
                  <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={44} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.user.username}</span>
                      <ProviderBadges u={r.user} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {t('friends.sentYouRequest')}
                    </span>
                  </span>
                </Link>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'accept')}
                    title={t('friends.accept')}
                    aria-label={`${t('friends.accept')} ${r.user.username}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-zinc-950 transition hover:brightness-110"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5 9-11" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(r.id, 'decline')}
                    title={t('friends.decline')}
                    aria-label={`${t('friends.decline')} ${r.user.username}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-red-400 hover:text-red-400 dark:border-zinc-600 dark:text-zinc-400"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <SectionHead eyebrow={t('friends.eyeSent')} title={t('friends.sentRequests')} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {outgoing.map((r) => (
              <div key={r.id} className="card flex items-center gap-3 p-3.5">
                <Link to={`/u/${r.user.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
                  <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={40} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.user.username}</span>
                      <ProviderBadges u={r.user} />
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500">{t('friends.pending')}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => respond(r.id, 'decline')}
                  title={t('friends.cancelRequest')}
                  aria-label={`${t('friends.cancelRequest')} ${r.user.username}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-red-400 hover:text-red-400 dark:border-zinc-600 dark:text-zinc-400"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section>
          <SectionHead eyebrow={t('friends.eyeSuggested')} title={t('friends.suggestedFriends')} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-100/50 p-3.5 dark:border-zinc-700 dark:bg-zinc-800/40">
                <Link to={`/u/${s.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
                  <Avatar username={s.username} avatarUrl={s.avatarUrl} size={40} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.username}</span>
                      <ProviderBadges u={s} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {suggestionVia(s.via, t)}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => sendRequest(s.username)}
                  className="shrink-0 rounded-full border border-accent bg-transparent px-3.5 py-1.5 text-sm font-semibold text-accent transition hover:bg-accent hover:text-zinc-950"
                >
                  {t('friends.add')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHead eyebrow={t('friends.eyeFriends')} title={t('friends.yourFriends')} />
        {friends.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={t('friends.noFriendsTitle')}
            description={t('friends.noFriendsDescription')}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {friends.map((f) => (
              <div key={f.id} className="group relative">
                <Link
                  to={`/u/${f.username}`}
                  className="card flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5 hover:border-accent/50"
                >
                  <span className="relative shrink-0">
                    <Avatar username={f.username} avatarUrl={f.avatarUrl} size={44} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-zinc-900 ${
                        f.isOnline ? 'bg-green-500' : 'bg-zinc-400 dark:bg-zinc-600'
                      }`}
                      title={f.isOnline ? t('friends.online') : t('friends.offline')}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{f.username}</span>
                      <ProviderBadges u={f} />
                    </span>
                    <span className={`mt-0.5 block text-xs ${f.isOnline ? 'text-green-600 dark:text-green-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {f.isOnline ? t('friends.online') : t('friends.offline')}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => unfriend(f.id)}
                  title={t('friends.removeFriend')}
                  aria-label={`${t('friends.removeFriend')} ${f.username}`}
                  className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-zinc-400 opacity-0 transition hover:border-red-400 hover:text-red-400 group-hover:opacity-100"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Header stat tile (big value + label); tone="green" for "online".
function Stat({ value, label, tone }: { value: number; label: string; tone?: 'green' }) {
  return (
    <div className="text-center">
      <div className={`font-display text-2xl font-extrabold tabular-nums leading-none sm:text-[26px] ${tone === 'green' ? 'text-green-600 dark:text-green-500' : 'text-accent'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
    </div>
  );
}

// Linked-account badges (42 / Discord / Steam / PSN / Xbox).
function ProviderBadges({
  u,
}: {
  u: Pick<PublicUser, 'provider' | 'steamId' | 'psnLinked' | 'xboxLinked'>;
}) {
  return (
    <>
      {u.provider === 'FORTYTWO' && <FortyTwoBadge />}
      {u.provider === 'DISCORD' && <DiscordBadge />}
      {u.steamId && <SteamBadge />}
      {u.psnLinked && <PsnBadge />}
      {u.xboxLinked && <XboxBadge />}
    </>
  );
}

// Suggestion provenance label (which network found it).
function suggestionVia(via: Suggestion['via'], t: ReturnType<typeof useTranslation>['t']): string {
  if (via === 'steam') return t('friends.viaSteam');
  if (via === 'psn') return t('friends.viaPsn');
  return t('friends.via42');
}
