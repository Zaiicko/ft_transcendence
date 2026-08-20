import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import Modal from './Modal';

interface FeedbackMessageT {
  id: number;
  fromAdmin: boolean;
  text: string;
  createdAt: string;
}

interface TicketT {
  id: number;
  message: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  messages: FeedbackMessageT[];
}

type Tab = 'new' | 'mine';

// Reachable from the footer bubble for anyone, logged in or not (a bug
// report shouldn't require an account). Logged-in users get a second tab
// listing their own tickets — each with its own thread, so several can be
// followed independently instead of one shared inbox.
export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('new');

  return (
    <Modal title={t('feedback.title')} onClose={onClose}>
      {user && (
        <div className="mb-4 flex gap-2">
          {(['new', 'mine'] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                tab === tb
                  ? 'border-accent bg-accent text-zinc-950'
                  : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
              }`}
            >
              {t(`feedback.tabs.${tb}`)}
            </button>
          ))}
        </div>
      )}
      {tab === 'new' ? <NewFeedbackForm onClose={onClose} /> : <MyTickets />}
    </Modal>
  );
}

function NewFeedbackForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await apiFetch('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          message: message.trim(),
          email: !user && email.trim() ? email.trim() : undefined,
          url: window.location.href,
        }),
      });
      setSent(true);
    } catch {
      setError(t('feedback.unexpectedError'));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('feedback.thanks')}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('feedback.intro')}</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('feedback.messagePlaceholder')}
        maxLength={2000}
        minLength={5}
        required
        rows={4}
        className="field w-full resize-none !rounded-xl px-4 py-2"
      />
      {!user && (
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('feedback.emailPlaceholder')}
          className="field w-full px-4 py-2"
        />
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2 text-sm text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={sending || message.trim().length < 5}
          className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {t('feedback.submit')}
        </button>
      </div>
    </form>
  );
}

function MyTickets() {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<TicketT[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<TicketT[]>('/feedback/mine')
      .then((list) => !cancelled && setTickets(list))
      .catch(() => !cancelled && setTickets([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function patchTicket(id: number, patch: Partial<TicketT>) {
    setTickets((list) => list && list.map((tk) => (tk.id === id ? { ...tk, ...patch } : tk)));
  }

  function removeTicket(id: number) {
    setTickets((list) => list && list.filter((tk) => tk.id !== id));
    setOpenId((cur) => (cur === id ? null : cur));
  }

  if (tickets === null) return <p className="text-sm text-zinc-500">{t('common.loading')}</p>;
  if (tickets.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('feedback.noTickets')}</p>;
  }

  return (
    <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
      {tickets.map((tk) => (
        <TicketRow
          key={tk.id}
          ticket={tk}
          expanded={openId === tk.id}
          onToggle={() => setOpenId((cur) => (cur === tk.id ? null : tk.id))}
          onUpdate={(patch) => patchTicket(tk.id, patch)}
          onClosed={() => removeTicket(tk.id)}
        />
      ))}
    </div>
  );
}

function TicketRow({
  ticket,
  expanded,
  onToggle,
  onUpdate,
  onClosed,
}: {
  ticket: TicketT;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<TicketT>) => void;
  onClosed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    try {
      await apiFetch(`/feedback/${ticket.id}/messages`, {
        method: 'PATCH',
        body: JSON.stringify({ message: text }),
      });
      onUpdate({
        status: 'OPEN',
        messages: [
          ...ticket.messages,
          { id: -Date.now(), fromAdmin: false, text, createdAt: new Date().toISOString() },
        ],
      });
      setReply('');
    } finally {
      setSending(false);
    }
  }

  async function confirmAndClose() {
    setClosing(true);
    try {
      await apiFetch(`/feedback/${ticket.id}`, { method: 'DELETE' });
      onClosed();
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            ticket.status === 'OPEN'
              ? 'bg-accent/20 text-accent'
              : 'bg-zinc-400/20 text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {t(`admin.feedback.status.${ticket.status}`)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
          {ticket.message}
        </span>
        <span className="shrink-0 text-xs text-zinc-400">
          {new Date(ticket.createdAt).toLocaleDateString(i18n.language)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-900/10 px-4 py-3 dark:border-zinc-100/10">
          <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-200">
            {ticket.message}
          </p>
          {ticket.messages.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {ticket.messages.map((m) => (
                <div key={m.id} className={`flex ${m.fromAdmin ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.fromAdmin
                        ? 'bg-zinc-900/5 text-zinc-700 dark:bg-zinc-100/10 dark:text-zinc-200'
                        : 'bg-accent text-zinc-950'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={sendReply} className="mt-3 flex flex-col gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t('feedback.replyPlaceholder')}
              maxLength={2000}
              rows={2}
              className="field w-full resize-none !rounded-xl px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              {confirmClose ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400">{t('feedback.closeConfirm')}</span>
                  <button
                    type="button"
                    onClick={() => setConfirmClose(false)}
                    className="text-zinc-500 underline-offset-2 hover:underline"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={closing}
                    onClick={confirmAndClose}
                    className="rounded-full bg-red-500 px-3 py-1 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    {t('feedback.closeConfirmButton')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClose(true)}
                  className="text-xs font-semibold text-red-400 underline-offset-2 hover:underline"
                >
                  {t('feedback.closeTicket')}
                </button>
              )}
              <button
                type="submit"
                disabled={sending || !reply.trim()}
                className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {t('feedback.sendReply')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
