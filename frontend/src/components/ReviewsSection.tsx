import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SectionHead from './SectionHead';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useRequireAuth } from '../auth/useRequireAuth';
import { emitCommentReaction } from '../games/commentBus';
import { ReviewTargetKind, useReviewSocket } from '../games/useReviewSocket';
import { ApiError, apiFetch } from '../lib/api';
import Avatar from './Avatar';
import EmptyState, { PencilIcon } from './EmptyState';
import LeaderboardRankBadge from './LeaderboardRankBadge';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import ReviewComments from './ReviewComments';
import ShareButton from './ShareButton';
import Stars from './Stars';

export type ReviewStats = {
  _avg: { rating: number | null };
  _count: number;
  // Rating distribution 0–10 (index = rating) — feeds the game page histogram.
  distribution?: number[];
};

// reviews module contract (docs/reviews-api.md §1) — user null = deleted account (anonymized content, tolerated everywhere).
interface ReviewT {
  id: number;
  rating: number;
  title: string;
  text: string;
  createdAt: string;
  user: { id: number; username: string; avatarUrl: string | null } | null;
  _count: { likes: number; dislikes: number; comments: number };
  myReaction: 'like' | 'dislike' | null;
}

type Sort = 'recent' | 'popular' | 'discussed';
const SORTS: { key: Sort; labelKey: string }[] = [
  { key: 'popular', labelKey: 'reviews.sortPopular' },
  { key: 'recent', labelKey: 'reviews.sortRecent' },
  { key: 'discussed', labelKey: 'reviews.sortDiscussed' },
];

// Reviews loaded in batches, with a "Load more" button.
const PAGE_SIZE = 10;

// Full reviews section (list + form + likes + threaded comments + real-time), shared by the game and studio pages. The backend is symmetric: `:target` = `games/:id` or `companies/:id` (docs/reviews-api.md).
export default function ReviewsSection({
  target,
  onStats,
  onReviewCreated,
}: {
  target: { kind: ReviewTargetKind; id: number };
  onStats?: (s: ReviewStats) => void;
  onReviewCreated?: () => void;
}) {
  const { kind, id } = target;
  const base = `/${kind === 'game' ? 'games' : 'companies'}/${id}`;

  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const { hash } = useLocation();

  const [reviews, setReviews] = useState<ReviewT[]>([]);
  const [sort, setSort] = useState<Sort>('popular');
  // Pagination: current page, end reached (last batch < PAGE_SIZE), and the button state while the next batch loads.
  const [page, setPage] = useState(1);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Open threads (ids of expanded reviews) + per-review version, bumped by real-time (comment:changed) to refetch an open thread.
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [commentVersions, setCommentVersions] = useState<Record<number, number>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  // The review form is collapsed by default, opened by a button.
  const [showForm, setShowForm] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);

  // Auto-translate reviews to the current language (batch on load). Local cache per (id, language). By default we SHOW the translation; `showOriginal` = reviews where "See original" was clicked. The button appears only if the translation differs from the original (else the review is already in your language).
  const [translations, setTranslations] = useState<Record<string, { title: string; text: string }>>(
    {},
  );
  const [showOriginal, setShowOriginal] = useState<Set<number>>(new Set());
  const targetLang = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const trKey = (id: number) => `${id}:${targetLang}`;

  const translationOf = (r: ReviewT) => translations[trKey(r.id)];
  const isTranslatable = (r: ReviewT) => {
    const tr = translationOf(r);
    return !!tr && (tr.title !== r.title || tr.text !== r.text);
  };
  const displayed = (r: ReviewT) => {
    const tr = translationOf(r);
    return tr && !showOriginal.has(r.id) ? tr : { title: r.title, text: r.text };
  };

  // Batch-translate the shown reviews lacking a translation for the current language (single call). Re-run on new reviews or a language change. Keyed by (id, language) → no state reset between languages.
  useEffect(() => {
    const missing = reviews.filter((r) => !(trKey(r.id) in translations)).map((r) => r.id);
    if (missing.length === 0) return;
    let cancelled = false;
    apiFetch<Record<number, { title: string; text: string }>>('/reviews/translations', {
      method: 'POST',
      body: JSON.stringify({ ids: missing, lang: targetLang }),
    })
      .then((map) => {
        if (cancelled) return;
        setTranslations((prev) => {
          const next = { ...prev };
          for (const [id, tr] of Object.entries(map)) next[`${id}:${targetLang}`] = tr;
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, targetLang]);

  const toggleOriginal = (id: number) =>
    setShowOriginal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleThread = (rid: number) =>
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  const bumpVersion = (rid: number) =>
    setCommentVersions((v) => ({ ...v, [rid]: (v[rid] ?? 0) + 1 }));

  // Load the next batch and append it. We dedup: an already-present review (e.g. the one pinned via #review-<id>) isn't added twice.
  async function loadMore() {
    setLoadingMore(true);
    const next = page + 1;
    try {
      const rows = await apiFetch<ReviewT[]>(
        `${base}/reviews?sort=${sort}&page=${next}&limit=${PAGE_SIZE}`,
      );
      setReviews((cur) => {
        const seen = new Set(cur.map((r) => r.id));
        return [...cur, ...rows.filter((r) => !seen.has(r.id))];
      });
      setPage(next);
      setReachedEnd(rows.length < PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  function refreshStats() {
    apiFetch<ReviewStats>(`${base}/reviews/stats`)
      .then((s) => onStats?.(s))
      .catch(() => {});
  }

  // Note: refreshStats depends on `base` (stable for a target). We resync the stats on mount / target change.
  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Load / reload the first page (on mount, sort change, or arrival via a deep link).
  useEffect(() => {
    let cancelled = false;
    const pinId = hash.startsWith('#review-') ? Number(hash.slice('#review-'.length)) : NaN;
    apiFetch<ReviewT[]>(`${base}/reviews?sort=${sort}&page=1&limit=${PAGE_SIZE}`)
      .then((list) => {
        if (cancelled) return;
        setReviews(list);
        setPage(1);
        setReachedEnd(list.length < PAGE_SIZE);
        // Targeted review (#review-<id>) missing from the loaded batch: fetch it alone and pin it on top, to always land on it even on a heavily-commented game. We check it belongs to this target.
        if (!Number.isNaN(pinId) && !list.some((r) => r.id === pinId)) {
          apiFetch<ReviewT & { game?: { id: number }; company?: { id: number } }>(
            `/reviews/${pinId}`,
          )
            .then((r) => {
              if (cancelled) return;
              const belongs = kind === 'game' ? r.game?.id === id : r.company?.id === id;
              if (belongs) {
                setReviews((cur) => (cur.some((x) => x.id === r.id) ? cur : [r, ...cur]));
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, sort, hash, kind, id]);

  // Arrival via a #review link (reviews block) or #review-<id> (a specific review, e.g. from the profile). We scroll once per hash, retrying when the list finishes loading (the anchor only exists then).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hash.startsWith('#review')) return;
    if (scrolledFor.current === hash) return;
    const el = document.getElementById(hash.slice(1));
    const target = el ?? (hash === '#review' ? reviewRef.current : null);
    if (!target) return; // not mounted yet: retry on the next render
    scrolledFor.current = hash;
    target.scrollIntoView({ behavior: 'smooth', block: el && hash !== '#review' ? 'center' : 'start' });
  }, [hash, reviews]);

  // 👍/👎 exclusive and idempotent server-side (204, no payload). Optimistic patch BEFORE the await: otherwise the `review:reaction` socket event (absolute counter) arrives during the await and the patch stacks on it → double counting. The event then reconciles the counters to the server value.
  async function react(review: ReviewT, r: 'like' | 'dislike') {
    // Guest → redirect to login (returns here after sign-in); otherwise act.
    if (!requireAuth()) return;
    const removing = review.myReaction === r;
    setReviews((list) =>
      list.map((x) => {
        if (x.id !== review.id) return x;
        const counts = { ...x._count };
        if (removing) {
          counts[`${r}s`] -= 1;
          return { ...x, _count: counts, myReaction: null };
        }
        counts[`${r}s`] += 1;
        if (x.myReaction) counts[`${x.myReaction}s`] -= 1;
        return { ...x, _count: counts, myReaction: r };
      }),
    );
    try {
      await apiFetch(`/reviews/${review.id}/${r}`, { method: removing ? 'DELETE' : 'POST' });
    } catch {
      replaceReview(review.id); // failure → resync from the server
    }
  }

  async function removeOwn(review: ReviewT) {
    await apiFetch(`/reviews/${review.id}`, { method: 'DELETE' });
    setReviews((list) => list.filter((x) => x.id !== review.id));
    refreshStats();
  }

  // Targeted refetch of a review (edit/comment from another tab) — never the whole list, else open threads close.
  function replaceReview(reviewId: number) {
    apiFetch<ReviewT>(`/reviews/${reviewId}`)
      .then((fresh) =>
        setReviews((list) => list.map((x) => (x.id === reviewId ? { ...x, ...fresh } : x))),
      )
      .catch(() => {});
  }

  // Real-time: the room's 6 events (docs/reviews-api.md §3). Reaction payloads carry absolute counters → applied as-is (idempotent with the local optimistic patch, no double counting).
  useReviewSocket(kind, id, {
    onReviewCreated: (raw) => {
      const created = raw as ReviewT;
      setReviews((list) => (list.some((x) => x.id === created.id) ? list : [created, ...list]));
      refreshStats();
    },
    onReviewUpdated: replaceReview,
    onReviewDeleted: (reviewId) => {
      setReviews((list) => list.filter((x) => x.id !== reviewId));
      refreshStats();
    },
    onReviewReaction: ({ reviewId, likes, dislikes }) =>
      setReviews((list) =>
        list.map((x) =>
          x.id === reviewId ? { ...x, _count: { ...x._count, likes, dislikes } } : x,
        ),
      ),
    onCommentChanged: (reviewId) => {
      replaceReview(reviewId); // update the 💬 counter
      bumpVersion(reviewId); // refresh the thread if it's open
    },
    onCommentReaction: ({ commentId, likes, dislikes }) =>
      emitCommentReaction({ commentId, likes, dislikes }),
  });

  const alreadyReviewed = user != null && reviews.some((r) => r.user?.id === user.id);

  // "Review" (hero / action bar) leads to #review → we directly expand the form for a user without a review yet. Adjusted during RENDER (not an effect: avoids setState-in-effect), triggered once via a flag — the user can then close it without it reopening.
  const autoOpenedForm = useRef(false);
  if (!autoOpenedForm.current && hash === '#review' && user && !alreadyReviewed) {
    autoOpenedForm.current = true;
    setShowForm(true);
  }

  return (
    <section ref={reviewRef} id="review" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <SectionHead
          className="mb-0"
          eyebrow={t('reviews.eyebrow')}
          title={`${t('reviews.heading')}${reviews.length > 0 ? ` (${reviews.length})` : ''}`}
        />
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
      </div>

      {user && !alreadyReviewed && (
        showForm ? (
          <ReviewForm
            base={base}
            kind={kind}
            onCancel={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              setSort('recent');
              apiFetch<ReviewT[]>(`${base}/reviews?sort=recent&page=1&limit=${PAGE_SIZE}`)
                .then((list) => {
                  setReviews(list);
                  setPage(1);
                  setReachedEnd(list.length < PAGE_SIZE);
                })
                .catch(() => {});
              refreshStats();
              onReviewCreated?.();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-zinc-950 shadow-sm shadow-accent/30 transition hover:brightness-110"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            {t('home.writeReview')}
          </button>
        )
      )}
      {!user && (
        <button
          type="button"
          onClick={requireAuth}
          className="mb-6 text-sm text-zinc-500 underline-offset-2 hover:text-accent hover:underline dark:text-zinc-400"
        >
          {t('reviews.loginToReview')}
        </button>
      )}

      {reviews.length === 0 ? (
        <EmptyState
          icon={<PencilIcon />}
          title={t('reviews.emptyTitle')}
          description={t(
            user
              ? kind === 'game'
                ? 'reviews.emptyDescGame'
                : 'reviews.emptyDescCompany'
              : kind === 'game'
                ? 'reviews.emptyDescGameGuest'
                : 'reviews.emptyDescCompanyGuest',
          )}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((r) => (
            <article
              key={r.id}
              id={`review-${r.id}`}
              className="card scroll-mt-24 p-5 transition target:ring-2 target:ring-accent"
            >
              {/* flex-wrap: avatar+username+badge and the stars/score group are separate
                  flex items sharing one row — without wrap, the score group (fixed-size,
                  no shrink) simply refuses to give up room, so the username (the only
                  shrinkable item) gets crushed down to a couple of characters on narrow
                  cards instead of the layout giving the score its own line. */}
              <div className="flex flex-wrap items-center gap-3">
                {r.user ? (
                  <>
                    <Link
                      to={`/u/${r.user.username}`}
                      className="flex min-w-0 items-center gap-3 hover:opacity-80"
                    >
                      <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.user.username}</div>
                      </div>
                    </Link>
                    <LeaderboardRankBadge userId={r.user.id} />
                  </>
                ) : (
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar username="?" size={32} />
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        <em>{t('reviews.deletedUser')}</em>
                      </div>
                    </div>
                  </div>
                )}
                {editingId !== r.id && (
                  <div className="ml-auto flex items-center gap-3">
                    <Stars rating={r.rating} showValue={false} />
                    <span className="font-display text-2xl font-extrabold leading-none tabular-nums text-accent">
                      {r.rating}
                      <span className="text-sm font-bold text-zinc-400">/10</span>
                    </span>
                  </div>
                )}
              </div>
              {editingId === r.id ? (
                <EditReviewForm
                  review={r}
                  onCancel={() => setEditingId(null)}
                  onSaved={(u) => {
                    setEditingId(null);
                    setReviews((list) => list.map((x) => (x.id === r.id ? { ...x, ...u } : x)));
                    refreshStats();
                  }}
                />
              ) : (
                <>
                  <div className="mt-3 font-display text-base font-bold">« {displayed(r).title} »</div>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {displayed(r).text}
                  </p>
                  {isTranslatable(r) && (
                    <button
                      type="button"
                      onClick={() => toggleOriginal(r.id)}
                      className="mt-1 text-xs text-zinc-500 underline-offset-2 hover:text-accent hover:underline dark:text-zinc-400"
                    >
                      {showOriginal.has(r.id)
                        ? t('reviews.showTranslation')
                        : t('reviews.showOriginal')}
                    </button>
                  )}
                  {/* flex-wrap: like/dislike/comment/share + the ml-auto edit/delete/date
                      group don't fit on one line on narrow cards — without wrap they just
                      ran past the card's right edge instead of dropping to a second line. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => react(r, 'like')}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
                        r.myReaction === 'like'
                          ? 'border-accent text-accent'
                          : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <ThumbsUpIcon className="h-3.5 w-3.5" /> {r._count.likes}
                    </button>
                    <button
                      type="button"
                      onClick={() => react(r, 'dislike')}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
                        r.myReaction === 'dislike'
                          ? 'border-accent text-accent'
                          : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <ThumbsDownIcon className="h-3.5 w-3.5" /> {r._count.dislikes}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleThread(r.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
                        openThreads.has(r.id)
                          ? 'border-accent text-accent'
                          : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <CommentIcon className="h-3.5 w-3.5" /> {r._count.comments}
                    </button>
                    <ShareButton
                      target={{ type: 'REVIEW', reviewId: r.id }}
                      title={t('reviews.shareReview')}
                      triggerClassName="inline-flex items-center justify-center rounded-full border border-zinc-400/60 px-2.5 py-1 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
                    />
                    <div className="ml-auto flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
                      {user && r.user?.id === user.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingId(r.id)}
                            className="transition hover:text-accent"
                          >
                            {t('reviews.edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOwn(r)}
                            className="transition hover:text-red-400"
                          >
                            {t('reviews.delete')}
                          </button>
                        </>
                      )}
                      <span>{new Date(r.createdAt).toLocaleDateString(i18n.language)}</span>
                    </div>
                  </div>
                </>
              )}
              {openThreads.has(r.id) && (
                <ReviewComments
                  reviewId={r.id}
                  currentUserId={user?.id ?? null}
                  version={commentVersions[r.id] ?? 0}
                  onChanged={() => replaceReview(r.id)}
                />
              )}
            </article>
          ))}
          {!reachedEnd && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto mt-2 block rounded-lg border border-zinc-400 px-6 py-2 text-sm transition hover:opacity-70 disabled:opacity-50 dark:border-zinc-700"
            >
              {loadingMore ? t('reviews.loading') : t('reviews.loadMore')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewForm({
  base,
  kind,
  onCreated,
  onCancel,
}: {
  base: string;
  kind: ReviewTargetKind;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating == null) {
      setError(t('reviews.chooseRating'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await apiFetch(`${base}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), rating, text: text.trim() }),
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t(kind === 'game' ? 'reviews.alreadyReviewedGame' : 'reviews.alreadyReviewedCompany')
          : err instanceof ApiError
            ? err.message
            : t('reviews.unexpectedError'),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mb-6 flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-zinc-500 dark:text-zinc-400">{t('reviews.ratingLabel')}</span>
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={t('reviews.ratingAria', { n })}
            className={`h-8 w-8 rounded-full border text-xs transition ${
              rating != null && n <= rating
                ? 'border-accent bg-accent font-bold text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('reviews.titlePlaceholder')}
        maxLength={120}
        required
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('reviews.textPlaceholder')}
        maxLength={5000}
        required
        rows={4}
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {t('reviews.publish')}
        </button>
      </div>
    </form>
  );
}

// Editing an existing review (PATCH /reviews/:id) — same controls as the create form, pre-filled. onSaved patches the review in the list; the review:updated socket event then reconciles the other tabs.
function EditReviewForm({
  review,
  onCancel,
  onSaved,
}: {
  review: ReviewT;
  onCancel: () => void;
  onSaved: (u: { rating: number; title: string; text: string }) => void;
}) {
  const { t: translate } = useTranslation();
  const [rating, setRating] = useState<number>(review.rating);
  const [title, setTitle] = useState(review.title);
  const [text, setText] = useState(review.text);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const body = text.trim();
    if (!t || !body) {
      setError(translate('reviews.titleTextRequired'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await apiFetch(`/reviews/${review.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: t, rating, text: body }),
      });
      onSaved({ rating, title: t, text: body });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : translate('reviews.unexpectedError'));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-zinc-500 dark:text-zinc-400">
          {translate('reviews.ratingLabel')}
        </span>
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={translate('reviews.ratingAria', { n })}
            className={`h-8 w-8 rounded-full border text-xs transition ${
              n <= rating
                ? 'border-accent bg-accent font-bold text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={translate('reviews.titlePlaceholder')}
        maxLength={120}
        required
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={translate('reviews.textPlaceholder')}
        maxLength={5000}
        required
        rows={4}
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-2 self-end text-sm">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-zinc-500 transition hover:text-accent"
        >
          {translate('reviews.cancel')}
        </button>
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {translate('reviews.save')}
        </button>
      </div>
    </form>
  );
}
