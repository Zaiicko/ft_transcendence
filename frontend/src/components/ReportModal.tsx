import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../lib/api';
import Modal from './Modal';

const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'SPOILER', 'OTHER'] as const;
export type ReportReason = (typeof REASONS)[number];

// Report a review or a comment (POST /reports) — reviewed later by an admin
// on /admin/reports. Shared by ReviewsSection and ReviewComments.
export default function ReportModal({
  targetType,
  targetId,
  onClose,
  onReported,
}: {
  targetType: 'REVIEW' | 'COMMENT';
  targetId: number;
  onClose: () => void;
  onReported: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason>('SPAM');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await apiFetch('/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          [targetType === 'REVIEW' ? 'reviewId' : 'commentId']: targetId,
          reason,
          details: details.trim() || undefined,
        }),
      });
      onReported();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t('report.alreadyReported'));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t('report.ownContent'));
      } else {
        setError(t('report.unexpectedError'));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={t('report.title')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('report.intro')}</p>
        <div className="flex flex-col gap-1.5">
          {REASONS.map((r) => (
            <label
              key={r}
              className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:text-accent dark:border-zinc-700"
            >
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-current"
              />
              {t(`report.reasons.${r}`)}
            </label>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t('report.detailsPlaceholder')}
          maxLength={1000}
          rows={3}
          className="field w-full resize-none !rounded-xl px-4 py-2"
        />
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
            disabled={sending}
            className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {t('report.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
