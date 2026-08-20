import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { FlagIcon } from '../components/ReactionIcons';
import SectionHead from '../components/SectionHead';
import { apiFetch } from '../lib/api';

type Category = 'reports' | 'feedback';
const CATEGORIES: Category[] = ['reports', 'feedback'];

export default function AdminPanel() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<Category>('reports');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <SectionHead eyebrow={t('admin.panel.eyebrow')} title={t('admin.panel.heading')} />
      <div className="mb-6 mt-4 flex gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
              category === c
                ? 'border-accent bg-accent text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {t(`admin.panel.categories.${c}`)}
          </button>
        ))}
      </div>

      {category === 'reports' ? <ReportsPanel /> : <FeedbackPanel />}
    </div>
  );
}

// ---------- Reports ----------

type ReportStatus = 'PENDING' | 'RESOLVED' | 'DISMISSED';
type Author = { id: number; username: string; avatarUrl: string | null };
type TargetAuthor = Author & { bannedAt: string | null };

interface ReportT {
  id: number;
  targetType: 'REVIEW' | 'COMMENT';
  reason: string;
  details: string | null;
  createdAt: string;
  reporter: Author;
  targetAuthor: TargetAuthor | null;
  review: {
    id: number;
    title: string;
    text: string;
    rating: number;
    gameId: number | null;
    companyId: number | null;
    user: Author | null;
  } | null;
  comment: {
    id: number;
    text: string;
    reviewId: number;
    user: Author | null;
    review: { gameId: number | null; companyId: number | null };
  } | null;
}

const REPORT_TABS: ReportStatus[] = ['PENDING', 'RESOLVED', 'DISMISSED'];

function targetLink(r: ReportT): string | null {
  if (r.review) {
    const base = r.review.gameId ? `/game/${r.review.gameId}` : `/company/${r.review.companyId}`;
    return `${base}?review=${r.review.id}`;
  }
  if (r.comment) {
    const { gameId, companyId } = r.comment.review;
    const base = gameId ? `/game/${gameId}` : `/company/${companyId}`;
    return `${base}?review=${r.comment.reviewId}`;
  }
  return null;
}

function ReportsPanel() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<ReportStatus>('PENDING');
  const [reports, setReports] = useState<ReportT[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [banTarget, setBanTarget] = useState<TargetAuthor | null>(null);
  // Local override of bannedAt per user id — the fetched list can go stale
  // the moment a ban/unban succeeds, and the same author can appear on
  // several report cards at once.
  const [banOverrides, setBanOverrides] = useState<Record<number, boolean>>({});

  // Tab switch restarts the skeleton, same pattern as Catalog's filter change:
  // set during render, not inside the effect below.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<ReportT[]>(`/reports?status=${status}`)
      .then((list) => !cancelled && setReports(list))
      .catch(() => !cancelled && setReports([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function resolve(id: number, action: 'delete' | 'dismiss') {
    setBusyId(id);
    try {
      await apiFetch(`/reports/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      setReports((list) => list.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function unban(userId: number) {
    setBusyId(userId);
    try {
      await apiFetch(`/users/${userId}/ban`, { method: 'DELETE' });
      setBanOverrides((o) => ({ ...o, [userId]: false }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex gap-2">
        {REPORT_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              status === s
                ? 'border-accent bg-accent font-medium text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {t(`admin.reports.status.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : reports.length === 0 ? (
        <EmptyState icon={<FlagIcon className="h-5 w-5" />} title={t('admin.reports.empty')} />
      ) : (
        <div className="flex flex-col gap-4">
          {reports.map((r) => {
            const contentGone = !r.review && !r.comment;
            const author = r.review?.user ?? r.comment?.user ?? null;
            const text = r.review?.text ?? r.comment?.text ?? '';
            const link = targetLink(r);
            return (
              <article key={r.id} className="card p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <FlagIcon className="h-3.5 w-3.5 text-red-400" />
                  <span className="font-semibold text-red-400">{t(`report.reasons.${r.reason}`)}</span>
                  <span>·</span>
                  <span>{t(`admin.reports.targetType.${r.targetType}`)}</span>
                  <span>·</span>
                  <span>{new Date(r.createdAt).toLocaleString(i18n.language)}</span>
                  {link && (
                    <>
                      <span>·</span>
                      <Link to={link} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                        {t('admin.reports.viewInContext')}
                      </Link>
                    </>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{t('admin.reports.reportedBy')}</span>
                  <Avatar username={r.reporter.username} avatarUrl={r.reporter.avatarUrl} size={18} />
                  <span className="font-medium">{r.reporter.username}</span>
                </div>

                {r.details && (
                  <p className="mt-2 rounded-lg bg-zinc-900/5 p-2 text-sm italic text-zinc-600 dark:bg-zinc-100/5 dark:text-zinc-300">
                    {r.details}
                  </p>
                )}

                <div className="mt-3 border-t border-zinc-900/10 pt-3 dark:border-zinc-100/10">
                  {contentGone ? (
                    <p className="text-sm italic text-zinc-500">{t('admin.reports.contentDeleted')}</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {author ? (
                          <>
                            <Avatar username={author.username} avatarUrl={author.avatarUrl} size={24} />
                            <span className="text-sm font-semibold">{author.username}</span>
                          </>
                        ) : (
                          <span className="text-sm italic text-zinc-500">{t('reviews.deletedUser')}</span>
                        )}
                        {r.review && (
                          <span className="ml-auto text-sm font-bold text-accent">{r.review.rating}/10</span>
                        )}
                      </div>
                      {r.review && <div className="mt-1 text-sm font-bold">« {r.review.title} »</div>}
                      <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">{text}</p>
                    </>
                  )}
                </div>

                {(r.targetAuthor || status === 'PENDING') && (
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-900/10 pt-3 dark:border-zinc-100/10">
                    <div>
                      {r.targetAuthor &&
                        (banOverrides[r.targetAuthor.id] ?? r.targetAuthor.bannedAt !== null ? (
                          <button
                            type="button"
                            disabled={busyId === r.targetAuthor.id}
                            onClick={() => r.targetAuthor && unban(r.targetAuthor.id)}
                            className="text-xs font-semibold text-zinc-500 underline-offset-2 transition hover:text-accent hover:underline disabled:opacity-50"
                          >
                            {t('admin.reports.unbanAuthor', { username: r.targetAuthor.username })}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => r.targetAuthor && setBanTarget(r.targetAuthor)}
                            className="text-xs font-semibold text-red-400 underline-offset-2 transition hover:underline"
                          >
                            {t('admin.reports.banAuthor', { username: r.targetAuthor.username })}
                          </button>
                        ))}
                    </div>

                    {status === 'PENDING' && (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => resolve(r.id, 'dismiss')}
                          className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-xs font-semibold transition hover:opacity-70 disabled:opacity-50 dark:border-zinc-600"
                        >
                          {t('admin.reports.dismiss')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => resolve(r.id, 'delete')}
                          className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                        >
                          {t('admin.reports.deleteContent')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {banTarget && (
        <BanUserModal
          username={banTarget.username}
          onClose={() => setBanTarget(null)}
          onBanned={() => {
            setBanOverrides((o) => ({ ...o, [banTarget.id]: true }));
            setBanTarget(null);
          }}
          userId={banTarget.id}
        />
      )}
    </>
  );
}

function BanUserModal({
  userId,
  username,
  onClose,
  onBanned,
}: {
  userId: number;
  username: string;
  onClose: () => void;
  onBanned: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await apiFetch(`/users/${userId}/ban`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      onBanned();
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={t('admin.reports.banModalTitle', { username })} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('admin.reports.banModalIntro')}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('admin.reports.banReasonPlaceholder')}
          maxLength={500}
          rows={3}
          className="field w-full resize-none !rounded-xl px-4 py-2"
        />
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
            {t('admin.reports.confirmBan')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Feedback ----------

type FeedbackStatus = 'OPEN' | 'RESOLVED';

interface FeedbackT {
  id: number;
  message: string;
  email: string | null;
  url: string | null;
  createdAt: string;
  user: Author | null;
}

const FEEDBACK_TABS: FeedbackStatus[] = ['OPEN', 'RESOLVED'];

function FeedbackPanel() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<FeedbackStatus>('OPEN');
  const [items, setItems] = useState<FeedbackT[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [replyTarget, setReplyTarget] = useState<FeedbackT | null>(null);

  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<FeedbackT[]>(`/feedback?status=${status}`)
      .then((list) => !cancelled && setItems(list))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function resolve(id: number) {
    setBusyId(id);
    try {
      await apiFetch(`/feedback/${id}/resolve`, { method: 'PATCH' });
      setItems((list) => list.filter((f) => f.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex gap-2">
        {FEEDBACK_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              status === s
                ? 'border-accent bg-accent font-medium text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {t(`admin.feedback.status.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<FlagIcon className="h-5 w-5" />} title={t('admin.feedback.empty')} />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((f) => (
            <article key={f.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                {f.user ? (
                  <>
                    <Avatar username={f.user.username} avatarUrl={f.user.avatarUrl} size={18} />
                    <span className="font-medium">{f.user.username}</span>
                  </>
                ) : (
                  <span>{f.email ?? t('admin.feedback.anonymous')}</span>
                )}
                <span>·</span>
                <span>{new Date(f.createdAt).toLocaleString(i18n.language)}</span>
                {f.url && (
                  <>
                    <span>·</span>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-xs truncate text-accent hover:underline"
                    >
                      {f.url}
                    </a>
                  </>
                )}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-200">{f.message}</p>

              {status === 'OPEN' && (
                <div className="mt-4 flex items-center justify-between gap-2">
                  {f.user ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('admin.feedback.replyHint')}
                    </span>
                  ) : (
                    <span className="text-xs italic text-zinc-500 dark:text-zinc-400">
                      {t('admin.feedback.noAccount')}
                    </span>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === f.id}
                      onClick={() => resolve(f.id)}
                      className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-xs font-semibold transition hover:opacity-70 disabled:opacity-50 dark:border-zinc-600"
                    >
                      {t('admin.feedback.markResolved')}
                    </button>
                    {f.user && (
                      <button
                        type="button"
                        disabled={busyId === f.id}
                        onClick={() => setReplyTarget(f)}
                        className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
                      >
                        {t('admin.feedback.reply')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {replyTarget && (
        <ReplyFeedbackModal
          feedbackId={replyTarget.id}
          username={replyTarget.user!.username}
          onClose={() => setReplyTarget(null)}
          onReplied={() => {
            setItems((list) => list.filter((f) => f.id !== replyTarget.id));
            setReplyTarget(null);
          }}
        />
      )}
    </>
  );
}

function ReplyFeedbackModal({
  feedbackId,
  username,
  onClose,
  onReplied,
}: {
  feedbackId: number;
  username: string;
  onClose: () => void;
  onReplied: () => void;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = message.trim();
    if (!body) return;
    setSending(true);
    try {
      await apiFetch(`/feedback/${feedbackId}/reply`, {
        method: 'PATCH',
        body: JSON.stringify({ message: body }),
      });
      onReplied();
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={t('admin.feedback.replyModalTitle', { username })} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('admin.feedback.replyModalIntro')}</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('admin.feedback.replyPlaceholder')}
          maxLength={2000}
          rows={4}
          autoFocus
          className="field w-full resize-none !rounded-xl px-4 py-2"
        />
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
            disabled={sending || !message.trim()}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {t('admin.feedback.sendReply')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
