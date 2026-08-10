import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SectionHead from './SectionHead';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { ProfileReview } from '../lib/types';
import EmptyState, { PencilIcon } from './EmptyState';
import Stars from './Stars';

const LIMIT = 10;

type Sort = 'recent' | 'popular' | 'discussed';
const SORTS: { key: Sort; labelKey: string }[] = [
  { key: 'popular', labelKey: 'reviews.sortPopular' },
  { key: 'recent', labelKey: 'reviews.sortRecent' },
  { key: 'discussed', labelKey: 'reviews.sortDiscussed' },
];

// Profile "Recent reviews" section: capped at 10, sortable like the game page, with "Load more".
export default function ProfileReviews({
  username,
  seed,
  embedded = false,
}: {
  username: string;
  seed: ProfileReview[];
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort>('popular');
  const [reviews, setReviews] = useState<ProfileReview[]>(seed);
  const [page, setPage] = useState(1);
  const [end, setEnd] = useState(seed.length < LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ProfileReview[]>(
      `/reviews/user/${encodeURIComponent(username)}?sort=${sort}&page=1&limit=${LIMIT}`,
    )
      .then((rows) => {
        if (cancelled) return;
        setReviews(rows);
        setPage(1);
        setEnd(rows.length < LIMIT);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username, sort]);

  async function loadMore() {
    setLoadingMore(true);
    const next = page + 1;
    try {
      const rows = await apiFetch<ProfileReview[]>(
        `/reviews/user/${encodeURIComponent(username)}?sort=${sort}&page=${next}&limit=${LIMIT}`,
      );
      setReviews((cur) => [...cur, ...rows]);
      setPage(next);
      setEnd(rows.length < LIMIT);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {!embedded && (
          <SectionHead className="mb-0" eyebrow={t('profile.eyeReviews')} title={t('profile.recentReviews')} />
        )}
        {reviews.length > 0 && (
          <div className="flex gap-2">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  sort === s.key
                    ? 'border-accent bg-accent font-medium text-zinc-950'
                    : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                }`}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {reviews.length === 0 ? (
        <EmptyState
          icon={<PencilIcon />}
          title={t('profile.noReviewsTitle')}
          description={t('profile.noReviewsDesc')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {reviews.map((r) => (
              <ReviewCard key={r.id} r={r} />
            ))}
          </ul>
          {!end && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto mt-4 block rounded-lg border border-zinc-400 px-6 py-2 text-sm transition hover:opacity-70 disabled:opacity-50 dark:border-zinc-700"
            >
              {loadingMore ? t('reviews.loading') : t('reviews.loadMore')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ReviewCard({ r }: { r: ProfileReview }) {
  const { t } = useTranslation();
  const name = r.game?.title ?? r.company?.name ?? t('common.unknown');
  const cover = r.game?.coverUrl ?? r.company?.logoUrl ?? null;
  const isCompany = !r.game && !!r.company;
  const href = r.game
    ? `/game/${r.game.id}#review-${r.id}`
    : r.company
      ? `/company/${r.company.id}#review-${r.id}`
      : null;

  const inner = (
    <>
      {cover ? (
        <img
          src={cover}
          alt=""
          className={
            isCompany
              ? 'h-16 w-11 shrink-0 rounded bg-white object-contain p-0.5'
              : 'h-16 w-11 shrink-0 rounded object-cover'
          }
        />
      ) : (
        <span className="block h-16 w-11 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
      )}
      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <div className="mt-1">
          <Stars rating={r.rating} />
        </div>
        {r.title && <p className="mt-1 text-sm font-medium">{r.title}</p>}
        <p className="mt-1 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{r.text}</p>
        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <ThumbIcon /> {r._count.likes}
          </span>
          <span className="inline-flex items-center gap-1">
            <ThumbIcon down /> {r._count.dislikes}
          </span>
          <span className="inline-flex items-center gap-1">
            <CommentIcon /> {r._count.comments}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <li>
      {href ? (
        <Link to={href} className="card flex gap-3 p-3 transition hover:border-accent/60">
          {inner}
        </Link>
      ) : (
        <div className="card flex gap-3 p-3">{inner}</div>
      )}
    </li>
  );
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 fill-none stroke-current ${down ? 'rotate-180' : ''}`}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10v11" />
      <path d="M7 10l4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18 21H7" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}
