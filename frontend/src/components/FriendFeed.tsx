import { ReactNode, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import i18n from '../i18n';
import { useFeedSocket } from '../feed/useFeedSocket';
import { apiFetch } from '../lib/api';
import { FAMILY_NAME_KEY, tierClasses } from '../lib/achievements';
import type { FeedItem, FeedPage } from '../lib/types';
import AchievementIcon from './AchievementIcon';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import PsnBadge from './PsnBadge';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import Stars from './Stars';
import SteamBadge from './SteamBadge';

const PAGE = 12;
const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;

// Xbox logo (Simple Icons, CC0) — green badge, aligned with Steam/PSN.
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';

// Platform display name (proper noun, identical across all languages).
const PLATFORM_LABEL: Record<string, string> = {
  steam: 'Steam',
  xbox: 'Xbox',
  psn: 'PlayStation',
};

// Bold reused in the <Trans> sentences (actor name / highlighted target).
const strongClass = 'font-semibold text-zinc-900 dark:text-zinc-100';

// Short relative time ("3h ago", "yesterday", else a date), localized.
function relativeTime(iso: string): string {
  const t = i18n.t.bind(i18n);
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('feed.timeNow');
  if (min < 60) return t('feed.timeMinutes', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('feed.timeHours', { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t('feed.timeYesterday');
  if (d < 7) return t('feed.timeDays', { count: d });
  return new Date(iso).toLocaleDateString(i18n.language);
}

type Filter = 'all' | 'reviews' | 'played' | 'completed' | 'likes' | 'achievements';

const TAB_KEYS: { key: Filter; labelKey: string }[] = [
  { key: 'all', labelKey: 'feed.tabAll' },
  { key: 'reviews', labelKey: 'feed.tabReviews' },
  { key: 'played', labelKey: 'feed.tabPlayed' },
  { key: 'completed', labelKey: 'feed.tabCompleted' },
  { key: 'likes', labelKey: 'feed.tabLikes' },
  { key: 'achievements', labelKey: 'feed.tabAchievements' },
];

// Does a real-time-pushed item match the current tab?
function inFilter(kind: FeedItem['kind'], filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'reviews') return kind === 'review';
  if (filter === 'played') return kind === 'played';
  if (filter === 'completed') return kind === 'completed';
  if (filter === 'achievements') return kind === 'achievement';
  return kind === 'review-like' || kind === 'comment-like';
}

export default function FriendFeed() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  // Detect the tab change during render (not a setState in the effect) to set loading true without an extra intermediate render (react-hooks/set-state-in-effect).
  const [appliedFilter, setAppliedFilter] = useState<Filter>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  if (filter !== appliedFilter) {
    setAppliedFilter(filter);
    setLoading(true);
  }

  const query = (cur?: string) =>
    `/feed?limit=${PAGE}` +
    (filter !== 'all' ? `&type=${filter}` : '') +
    (cur ? `&cursor=${encodeURIComponent(cur)}` : '');

  // Reload on each tab change (starts fresh).
  useEffect(() => {
    let cancelled = false;
    apiFetch<FeedPage>(query())
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Real-time: a friend's new item is inserted at the top (if the tab allows it, no duplicate).
  useFeedSocket((item) => {
    if (!inFilter(item.kind, filter)) return;
    setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [item, ...prev]));
  }, true);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<FeedPage>(query(cursor));
      // Dedup in case a real-time push already inserted an item.
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      /* network: keep the state */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* overflow-x-auto + shrink-0 : same fix as the profile tabs — 5 filters at full
          padding don't always fit on narrow phones, so the row scrolls instead of the
          last button(s) running off the edge of the card. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TAB_KEYS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === tab.key
                ? 'bg-accent text-zinc-950'
                : 'border border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-900" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FeedIcon />}
          title={filter === 'all' ? t('feed.emptyTitle') : t('feed.emptyTitleTab')}
          description={t('feed.emptyDescription')}
        >
          <Link
            to="/friends"
            className="mt-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110"
          >
            {t('feed.findFriends')}
          </Link>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative flex flex-col gap-4">
            <span
              className="pointer-events-none absolute bottom-3 left-[15px] top-3 w-0.5 bg-zinc-200 dark:bg-zinc-800"
              aria-hidden="true"
            />
            {items.map((item) => (
              <TimelineRow key={item.id} item={item}>
                {renderItem(item)}
              </TimelineRow>
            ))}
          </div>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto mt-2 rounded-lg border border-zinc-400 px-6 py-2 text-sm hover:opacity-70 disabled:opacity-50 dark:border-zinc-700"
            >
              {loadingMore ? t('feed.loading') : t('feed.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Render an event by its type (no key: set by TimelineRow).
function renderItem(item: FeedItem): ReactNode {
  switch (item.kind) {
    case 'review':
      return <ReviewItem item={item} />;
    case 'played':
      return <PlayedItem item={item} />;
    case 'completed':
      return <CompletedItem item={item} />;
    case 'review-like':
      return <ReviewLikeItem item={item} />;
    case 'comment-like':
      return <CommentLikeItem item={item} />;
    case 'rank':
      return <RankItem item={item} />;
    case 'achievement':
      return <AchievementItem item={item} />;
  }
}

// Timeline node per event type: a bordered circle (color = action direction) on the line, with a small outline icon at the center.
const NODE: Record<FeedItem['kind'], { ring: string; icon: ReactNode }> = {
  review: { ring: 'border-accent text-accent', icon: <NodePencil /> },
  played: { ring: 'border-zinc-300 text-zinc-400 dark:border-zinc-700', icon: <NodePlay /> },
  // `completed` is resolved by nodeFor (manual vs platform); value here = fallback.
  completed: { ring: 'border-accent text-accent', icon: <NodeCheck /> },
  'review-like': { ring: 'border-accent text-accent', icon: <NodeHeart /> },
  'comment-like': { ring: 'border-accent text-accent', icon: <NodeHeart /> },
  rank: { ring: 'border-accent text-accent', icon: <NodeBars /> },
  achievement: { ring: 'border-accent text-accent', icon: <NodeTrophy /> },
};

// Actual node of an item: the manual "done" (amber check) and the real platform 100% (green trophy) share the `completed` type but differ here.
function nodeFor(item: FeedItem): { ring: string; icon: ReactNode } {
  if (item.kind === 'completed') {
    return item.platform === 'manual'
      ? { ring: 'border-accent text-accent', icon: <NodeCheck /> }
      : { ring: 'border-green-500/60 text-green-600 dark:text-green-500', icon: <NodeTrophy /> };
  }
  return NODE[item.kind];
}

// Wraps an event card with a node on the vertical line (opaque background to "cut" the line behind the circle).
function TimelineRow({ item, children }: { item: FeedItem; children: ReactNode }) {
  const n = nodeFor(item);
  return (
    <div className="relative pl-11">
      <span
        className={`absolute left-0 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 bg-zinc-50 dark:bg-zinc-950 ${n.ring}`}
        aria-hidden="true"
      >
        {n.icon}
      </span>
      {children}
    </div>
  );
}

const nodeSvg = 'h-3.5 w-3.5 fill-none stroke-current';
function NodePencil() {
  return (
    <svg viewBox="0 0 24 24" className={nodeSvg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function NodePlay() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}
function NodeCheck() {
  return (
    <svg viewBox="0 0 24 24" className={nodeSvg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-11" />
    </svg>
  );
}
function NodeHeart() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}
function NodeBars() {
  return (
    <svg viewBox="0 0 24 24" className={nodeSvg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16M7 20v-6M12 20V6M17 20v-9" />
    </svg>
  );
}
function NodeTrophy() {
  return (
    <svg viewBox="0 0 24 24" className={nodeSvg} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
    </svg>
  );
}

function ReviewItem({ item }: { item: Extract<FeedItem, { kind: 'review' }> }) {
  const r = item.review;
  const target = r.game
    ? { name: r.game.title, cover: r.game.coverUrl, href: `${gameHref(r.game.id)}#review-${r.id}`, isCompany: false }
    : {
        name: r.company?.name ?? '?',
        cover: r.company?.logoUrl ?? null,
        href: r.company ? `${companyHref(r.company.id)}#review-${r.id}` : '/',
        isCompany: true,
      };

  return (
    <Link to={target.href} className="card flex gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600">
      {target.cover && (
        <img
          src={target.cover}
          alt=""
          className={
            target.isCompany
              ? 'h-20 w-14 shrink-0 rounded bg-white object-contain p-0.5'
              : 'h-20 w-14 shrink-0 rounded object-cover'
          }
        />
      )}
      <div className="min-w-0 flex-1">
        <ActorLine actor={r.user} at={item.at} action="rated" strong={target.name} />
        <div className="mt-1 flex items-center gap-2">
          <Stars rating={r.rating} showValue={false} />
          <span className="truncate text-sm font-semibold">« {r.title} »</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{r.text}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <ThumbsUpIcon className="h-3.5 w-3.5" /> {r._count.likes}
          </span>
          <span className="inline-flex items-center gap-1">
            <ThumbsDownIcon className="h-3.5 w-3.5" /> {r._count.dislikes}
          </span>
          <span className="inline-flex items-center gap-1">
            <CommentIcon className="h-3.5 w-3.5" /> {r._count.comments}
          </span>
        </div>
      </div>
    </Link>
  );
}

function PlayedItem({ item }: { item: Extract<FeedItem, { kind: 'played' }> }) {
  return (
    <Link
      to={gameHref(item.game.id)}
      className="card flex items-center gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      {item.game.coverUrl && (
        <img src={item.game.coverUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <ActorLine actor={item.actor} at={item.at} action="played" strong={item.game.title} />
      </div>
      <span className="shrink-0 text-zinc-400" title={i18n.t('feed.gameCompleted')}>
        <CheckIcon />
      </span>
    </Link>
  );
}

function ReviewLikeItem({ item }: { item: Extract<FeedItem, { kind: 'review-like' }> }) {
  const r = item.review;
  const t = target(r.game, r.company, r.id);
  return (
    <Link to={t.href} className="card flex gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600">
      {t.cover && (
        <img
          src={t.cover}
          alt=""
          className={
            t.isCompany
              ? 'h-16 w-11 shrink-0 rounded bg-white object-contain p-0.5'
              : 'h-16 w-11 shrink-0 rounded object-cover'
          }
        />
      )}
      <div className="min-w-0 flex-1">
        <LikeLine actor={item.actor} author={r.user} at={item.at} what="review" />
        <div className="mt-1 truncate text-sm font-semibold">« {r.title} »</div>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {i18n.t('feed.on', { target: t.name })}
        </div>
      </div>
    </Link>
  );
}

function CommentLikeItem({ item }: { item: Extract<FeedItem, { kind: 'comment-like' }> }) {
  const c = item.comment;
  const t = target(c.review.game, c.review.company, c.review.id);
  return (
    <Link to={t.href} className="card flex gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600">
      {t.cover && (
        <img
          src={t.cover}
          alt=""
          className={
            t.isCompany
              ? 'h-16 w-11 shrink-0 rounded bg-white object-contain p-0.5'
              : 'h-16 w-11 shrink-0 rounded object-cover'
          }
        />
      )}
      <div className="min-w-0 flex-1">
        <LikeLine actor={item.actor} author={c.user} at={item.at} what="comment" />
        <p className="mt-1 line-clamp-2 text-sm italic text-zinc-600 dark:text-zinc-400">
          « {c.text} »
        </p>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {i18n.t('feed.on', { target: t.name })}
        </div>
      </div>
    </Link>
  );
}

// Label "X liked Y's review/comment" (Y = author). Word order and phrasing come from the translation key (feed.likedReview/Comment).
function LikeLine({
  actor,
  author,
  at,
  what,
}: {
  actor: { username: string; avatarUrl: string | null };
  author: { username: string; avatarUrl: string | null } | null;
  at: string;
  what: 'review' | 'comment';
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <Avatar username={actor.username} avatarUrl={actor.avatarUrl} size={20} />
      <span className="min-w-0 truncate">
        <Trans
          i18nKey={what === 'review' ? 'feed.likedReview' : 'feed.likedComment'}
          values={{ actor: actor.username, author: author?.username ?? t('feed.deletedShort') }}
          components={{ a: <span className={strongClass} />, s: <span className={strongClass} /> }}
        />
      </span>
      <HeartIcon />
      <span className="ml-auto shrink-0 text-xs text-zinc-400">{relativeTime(at)}</span>
    </div>
  );
}

// Target (game OR studio) → label, cover, and deep link to the review.
function target(
  game: { id: number; title: string; coverUrl: string | null } | null,
  company: { id: number; name: string; logoUrl: string | null } | null,
  reviewId: number,
) {
  if (game) {
    return { name: game.title, cover: game.coverUrl, href: `${gameHref(game.id)}#review-${reviewId}`, isCompany: false };
  }
  return {
    name: company?.name ?? '?',
    cover: company?.logoUrl ?? null,
    href: company ? `${companyHref(company.id)}#review-${reviewId}` : '/',
    isCompany: true,
  };
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-accent stroke-accent" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

// Label "X rated / played / completed <target>". The action and word order come from the key (feed.rated / feed.played / feed.completed).
const ACTION_KEY: Record<'rated' | 'played' | 'completed' | 'done', string> = {
  rated: 'feed.rated',
  played: 'feed.played',
  completed: 'feed.completed',
  done: 'feed.done',
};

function ActorLine({
  actor,
  at,
  action,
  strong,
}: {
  actor: { username: string; avatarUrl: string | null } | null;
  at: string;
  action: 'rated' | 'played' | 'completed' | 'done';
  strong: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      {actor ? (
        <>
          <Avatar username={actor.username} avatarUrl={actor.avatarUrl} size={20} />
          <span className="min-w-0 truncate">
            <Trans
              i18nKey={ACTION_KEY[action]}
              values={{ user: actor.username, game: strong }}
              components={{ a: <span className={strongClass} />, s: <span className={strongClass} /> }}
            />
          </span>
        </>
      ) : (
        <em>{t('feed.deletedUser')}</em>
      )}
      <span className="ml-auto shrink-0 text-xs text-zinc-400">{relativeTime(at)}</span>
    </div>
  );
}

// Small badge of the platform where the game was completed (reuses Steam/PSN/Xbox for consistency with the other screens).
function PlatformMark({ platform }: { platform: string }) {
  if (platform === 'steam') return <SteamBadge />;
  if (platform === 'psn') return <PsnBadge />;
  if (platform === 'xbox') {
    return (
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[#107C10] text-white ring-1 ring-zinc-700"
        title="Xbox"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d={XBOX_PATH} />
        </svg>
      </span>
    );
  }
  return null;
}

// Two distinct cases under the same `completed` type:
//   • manual (platform 'manual') = game marked "done" by hand → "finished", a plain check (NOT "100%", which only applies to platforms).
//   • platform (steam/xbox/psn) = real 100% → "completed 100%" + trophy.
function CompletedItem({ item }: { item: Extract<FeedItem, { kind: 'completed' }> }) {
  const manual = item.platform === 'manual';
  return (
    <Link
      to={gameHref(item.game.id)}
      className="card flex items-center gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      {item.game.coverUrl && (
        <img src={item.game.coverUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <ActorLine
          actor={item.actor}
          at={item.at}
          action={manual ? 'done' : 'completed'}
          strong={item.game.title}
        />
        {!manual && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <PlatformMark platform={item.platform} />
            <span>{PLATFORM_LABEL[item.platform] ?? item.platform}</span>
          </div>
        )}
      </div>
      {manual ? (
        <span className="shrink-0 text-zinc-400" title={i18n.t('feed.gameCompleted')}>
          <CheckIcon />
        </span>
      ) : (
        <span className="shrink-0 text-amber-500" title={i18n.t('feed.completedBadge')}>
          <TrophyIcon />
        </span>
      )}
    </Link>
  );
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
    </svg>
  );
}

// Metric labels already translated (13 languages) reused from the Leaderboard page.
const RANK_METRIC_LABEL: Record<string, string> = {
  completions: 'leaderboard.metricCompletions',
  played: 'leaderboard.metricPlayed',
  reviews: 'leaderboard.metricReviews',
};
const RANK_MEDAL_COLOR: Record<number, string> = {
  1: 'text-amber-400',
  2: 'text-zinc-400',
  3: 'text-amber-700',
};

// "X enters the top N" of a leaderboard (global or among your friends). Links to the Leaderboard page; the medal takes the reached rank's tint.
function RankItem({ item }: { item: Extract<FeedItem, { kind: 'rank' }> }) {
  const { t } = useTranslation();
  const category = t(RANK_METRIC_LABEL[item.metric] ?? '');
  return (
    <Link
      to="/leaderboard"
      className="card flex items-center gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      <span className={`shrink-0 ${RANK_MEDAL_COLOR[item.rank] ?? 'text-zinc-400'}`}>
        <MedalIcon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Avatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} size={20} />
          <span className="min-w-0 truncate">
            <Trans
              i18nKey="feed.rankLine"
              values={{ user: item.actor.username, rank: item.rank, category }}
              components={{ a: <span className={strongClass} />, s: <span className={strongClass} /> }}
            />
          </span>
          <span className="ml-auto shrink-0 text-xs text-zinc-400">{relativeTime(item.at)}</span>
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(item.scope === 'global' ? 'feed.rankScopeGlobal' : 'feed.rankScopeFriends')}
        </div>
      </div>
    </Link>
  );
}

// "X unlocked an achievement" → links to the actor's profile (Achievements section). The achievement emoji (tier-tinted pill) is the icon.
function AchievementItem({ item }: { item: Extract<FeedItem, { kind: 'achievement' }> }) {
  const { t } = useTranslation();
  const name = t(FAMILY_NAME_KEY[item.family]);
  const label = `${name} · ${item.threshold}`;
  return (
    <Link
      to={`/u/${item.actor.username}`}
      className="card flex items-center gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${tierClasses(
          item.tier,
        )}`}
      >
        <AchievementIcon family={item.family} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Avatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} size={20} />
          <span className="min-w-0 truncate">
            <Trans
              i18nKey="feed.achievementLine"
              values={{ user: item.actor.username, name: label }}
              components={{ a: <span className={strongClass} />, s: <span className={strongClass} /> }}
            />
          </span>
          <span className="ml-auto shrink-0 text-xs text-zinc-400">{relativeTime(item.at)}</span>
        </div>
      </div>
    </Link>
  );
}

// Outline medal (same path as the Leaderboard page) — tint via currentColor.
function MedalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" />
      <path d="M11 12 5.12 2.2M13 12l5.88-9.8M8 7h8" />
      <circle cx="12" cy="17" r="5" />
      <path d="M12 18v-2h-.5" />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
