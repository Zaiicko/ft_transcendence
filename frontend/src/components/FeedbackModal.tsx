import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import Modal from './Modal';

// Reachable from the footer for anyone, logged in or not (a bug report
// shouldn't require an account) — POSTs to /feedback, which just emails an
// admin (no ticket queue/admin page: this is meant to stay lightweight).
export default function FeedbackModal({ onClose }: { onClose: () => void }) {
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

  return (
    <Modal title={t('feedback.title')} onClose={onClose}>
      {sent ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('feedback.thanks')}</p>
      ) : (
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
      )}
    </Modal>
  );
}
