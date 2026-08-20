import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import { FlagIcon } from '../components/ReactionIcons';
import SectionHead from '../components/SectionHead';
import { apiFetch } from '../lib/api';

type ReportStatus = 'PENDING' | 'RESOLVED' | 'DISMISSED';
type Author = { id: number; username: string; avatarUrl: string | null };

interface ReportT {
  id: number;
  targetType: 'REVIEW' | 'COMMENT';
  reason: string;
  details: string | null;
  createdAt: string;
  reporter: Author;
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

const TABS: ReportStatus[] = ['PENDING', 'RESOLVED', 'DISMISSED'];

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

export default function AdminReports() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<ReportStatus>('PENDING');
  const [reports, setReports] = useState<ReportT[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <SectionHead eyebrow={t('admin.reports.eyebrow')} title={t('admin.reports.heading')} />
      <div className="mb-6 mt-4 flex gap-2">
        {TABS.map((s) => (
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

                {status === 'PENDING' && (
                  <div className="mt-4 flex justify-end gap-2">
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
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
