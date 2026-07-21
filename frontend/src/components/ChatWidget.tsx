import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useChatSocket } from '../chat/useChatSocket';
import { useFriendSocket } from '../friends/useFriendSocket';
import { apiFetch } from '../lib/api';
import type { ChatConversation, ChatMessage } from '../lib/types';
import Avatar from './Avatar';
import Stars from './Stars';

// Bulle de chat flottante (bas-droite). Fermée : un rond avec pastille de
// non-lus. Ouverte : un panneau avec la liste des conversations, ou le fil d'un
// ami. Temps réel via useChatSocket ; n'est monté que pour un utilisateur connecté.
export default function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const me = user?.id ?? 0;
  // Latest-ref : le handler socket connaît le fil ouvert sans se réabonner
  const activeRef = useRef<number | null>(null);
  useEffect(() => {
    activeRef.current = open ? activeId : null;
  }, [open, activeId]);

  const otherIdOf = useCallback(
    (m: ChatMessage) => (m.senderId === me ? m.recipientId : m.senderId),
    [me],
  );

  const loadConversations = useCallback(() => {
    apiFetch<ChatConversation[]>('/chat/conversations')
      .then(setConversations)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const totalUnread = useMemo(
    () => conversations.reduce((s, c) => s + c.unread, 0),
    [conversations],
  );

  const activeFriend = conversations.find((c) => c.friend.id === activeId)?.friend ?? null;

  // Ouvre un fil : charge l'historique (le GET marque lu côté serveur) et
  // remet le compteur local à zéro.
  const openThread = useCallback((friendId: number) => {
    setActiveId(friendId);
    setMessages([]);
    apiFetch<ChatMessage[]>(`/chat/with/${friendId}`)
      .then(setMessages)
      .catch(() => {});
    setConversations((cur) =>
      cur.map((c) => (c.friend.id === friendId ? { ...c, unread: 0 } : c)),
    );
  }, []);

  // ---- temps réel ----
  const onMessage = useCallback(
    (msg: ManagedMessage) => {
      const other = otherIdOf(msg);
      const viewing = activeRef.current === other;

      if (viewing) {
        setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg]));
        // Message entrant sur le fil ouvert → marquer lu tout de suite
        if (msg.senderId === other) {
          apiFetch(`/chat/with/${other}/read`, { method: 'POST' }).catch(() => {});
        }
      }

      setConversations((cur) => {
        const idx = cur.findIndex((c) => c.friend.id === other);
        if (idx === -1) {
          loadConversations(); // nouvel interlocuteur : on recharge la liste
          return cur;
        }
        const incomingUnread = msg.senderId === other && !viewing;
        const updated: ChatConversation = {
          ...cur[idx],
          lastMessage: msg,
          unread: cur[idx].unread + (incomingUnread ? 1 : 0),
        };
        // Remonte la conversation en tête
        return [updated, ...cur.slice(0, idx), ...cur.slice(idx + 1)];
      });
    },
    [otherIdOf, loadConversations],
  );

  const onRead = useCallback(
    (by: number) => {
      // `by` a lu mes messages → accusé de lecture sur le fil ouvert
      if (activeRef.current !== by) return;
      setMessages((cur) =>
        cur.map((m) =>
          m.senderId === me && m.recipientId === by && !m.readAt
            ? { ...m, readAt: new Date().toISOString() }
            : m,
        ),
      );
    },
    [me],
  );

  useChatSocket({ onMessage, onRead }, !!user);
  // Amitié acceptée/supprimée → recharge la liste des conversations
  useFriendSocket(loadConversations, !!user);

  // Rechargement à l'ouverture du panneau (fraîcheur : nouveaux amis, non-lus)
  useEffect(() => {
    if (open) loadConversations();
  }, [open, loadConversations]);

  async function send() {
    const body = text.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      // Le message revient via la socket (echo à l'expéditeur) → pas d'ajout ici
      await apiFetch('/chat', {
        method: 'POST',
        body: JSON.stringify({ toUserId: activeId, content: body }),
      });
      setText('');
    } catch {
      /* on garde le texte pour réessayer */
    } finally {
      setSending(false);
    }
  }

  if (!user) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end">
      {open && (
        <div className="mb-3 flex h-[70vh] max-h-[560px] w-[92vw] max-w-sm flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          {activeId === null ? (
            <ConversationList
              conversations={conversations}
              onClose={() => setOpen(false)}
              onOpen={openThread}
            />
          ) : (
            <Thread
              me={me}
              friend={activeFriend}
              messages={messages}
              text={text}
              sending={sending}
              onText={setText}
              onSend={send}
              onBack={() => setActiveId(null)}
            />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fermer la messagerie' : 'Ouvrir la messagerie'}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-accent text-zinc-950 shadow-xl transition hover:brightness-110"
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && totalUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}

// ChatMessage tel que reçu du socket / REST (alias local plus court)
type ManagedMessage = ChatMessage;

function ConversationList({
  conversations,
  onClose,
  onOpen,
}: {
  conversations: ChatConversation[];
  onClose: () => void;
  onOpen: (friendId: number) => void;
}) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <h2 className="font-semibold">Messages</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
            Ajoute des amis pour discuter avec eux ici.
          </p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.friend.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.friend.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="relative shrink-0">
                    <Avatar username={c.friend.username} avatarUrl={c.friend.avatarUrl} size={40} />
                    {c.friend.isOnline && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.friend.username}</span>
                      {c.lastMessage && (
                        <span className="shrink-0 text-xs text-zinc-400">
                          {shortTime(c.lastMessage.createdAt)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {previewOf(c.lastMessage)}
                      </span>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-zinc-950">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Thread({
  me,
  friend,
  messages,
  text,
  sending,
  onText,
  onSend,
  onBack,
}: {
  me: number;
  friend: ChatConversation['friend'] | null;
  messages: ChatMessage[];
  text: string;
  sending: boolean;
  onText: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <>
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="rounded-full p-1 text-zinc-500 transition hover:text-accent"
        >
          <BackIcon />
        </button>
        {friend && (
          <Link
            to={`/u/${friend.username}`}
            className="flex min-w-0 items-center gap-2 hover:opacity-80"
          >
            <span className="relative shrink-0">
              <Avatar username={friend.username} avatarUrl={friend.avatarUrl} size={28} />
              {friend.isOnline && (
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />
              )}
            </span>
            <span className="truncate font-medium">{friend.username}</span>
          </Link>
        )}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-zinc-50 p-3 dark:bg-zinc-950/40">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} mine={m.senderId === me} />
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="flex items-center gap-2 border-t border-zinc-200 p-2 dark:border-zinc-700"
      >
        <input
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="Écrire un message…"
          maxLength={2000}
          className="field flex-1 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Envoyer"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          <SendIcon />
        </button>
      </form>
    </>
  );
}

function MessageBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const bubble = mine
    ? 'bg-accent text-zinc-950'
    : 'bg-white text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${bubble}`}>
        <ShareCard message={message} />
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        <div className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? 'text-zinc-800/60' : 'text-zinc-400'}`}>
          {shortTime(message.createdAt)}
          {mine && message.readAt && <span>· Lu</span>}
        </div>
      </div>
    </div>
  );
}

// Carte de partage à l'intérieur d'une bulle (jeu / avis / profil)
function ShareCard({ message }: { message: ChatMessage }) {
  if (message.type === 'GAME' && message.game) {
    const g = message.game;
    return (
      <Link
        to={`/game/${g.id}`}
        className="mb-1 flex items-center gap-2 rounded-lg bg-black/10 p-2 transition hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
      >
        {g.coverUrl ? (
          <img src={g.coverUrl} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
        ) : (
          <span className="h-14 w-10 shrink-0 rounded bg-zinc-300 dark:bg-zinc-700" />
        )}
        <span className="min-w-0">
          <span className="block text-[10px] uppercase tracking-wide opacity-70">Jeu</span>
          <span className="line-clamp-2 font-medium">{g.title}</span>
        </span>
      </Link>
    );
  }
  if (message.type === 'REVIEW' && message.review) {
    const r = message.review;
    const cover = r.game?.coverUrl ?? r.company?.logoUrl ?? null;
    const name = r.game?.title ?? r.company?.name ?? '';
    const href = r.game ? `/game/${r.game.id}#review-${r.id}` : r.company ? `/company/${r.company.id}#review-${r.id}` : '#';
    return (
      <Link
        to={href}
        className="mb-1 flex items-center gap-2 rounded-lg bg-black/10 p-2 transition hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            className={`h-14 w-10 shrink-0 rounded ${r.company ? 'bg-white object-contain p-0.5' : 'object-cover'}`}
          />
        ) : (
          <span className="h-14 w-10 shrink-0 rounded bg-zinc-300 dark:bg-zinc-700" />
        )}
        <span className="min-w-0">
          <span className="block text-[10px] uppercase tracking-wide opacity-70">Avis · {name}</span>
          <span className="line-clamp-1 font-medium">{r.title}</span>
          <Stars rating={r.rating} showValue={false} />
        </span>
      </Link>
    );
  }
  if (message.type === 'PROFILE' && message.sharedUser) {
    const u = message.sharedUser;
    return (
      <Link
        to={`/u/${u.username}`}
        className="mb-1 flex items-center gap-2 rounded-lg bg-black/10 p-2 transition hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
      >
        <Avatar username={u.username} avatarUrl={u.avatarUrl} size={36} />
        <span className="min-w-0">
          <span className="block text-[10px] uppercase tracking-wide opacity-70">Profil</span>
          <span className="truncate font-medium">{u.username}</span>
        </span>
      </Link>
    );
  }
  return null;
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
}

function previewOf(m: ChatMessage | null): string {
  if (!m) return 'Aucun message';
  if (m.type === 'GAME') return `🎮 ${m.game?.title ?? 'Jeu partagé'}`;
  if (m.type === 'REVIEW') return `📝 ${m.review?.title ?? 'Avis partagé'}`;
  if (m.type === 'PROFILE') return `👤 ${m.sharedUser?.username ?? 'Profil partagé'}`;
  return m.content ?? '';
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
