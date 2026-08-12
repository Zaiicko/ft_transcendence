import { ReactNode, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import i18n from '../i18n';
import { useFeedSocket } from '../feed/useFeedSocket';
import { apiFetch } from '../lib/api';
import { FAMILY_NAME_KEY, tierClasses } from '../lib/achievements';
import type { FeedItem, FeedPage } from '../lib/types';
import AchievementIcon from './AchievementIcon';

// Compact "friend activity" home column: feed items condensed to one line, real-time.

const HOME_FEED_LIMIT = 6;
const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;
const strong = 'font-semibold text-zinc-900 dark:text-zinc-100';

// Short localized relative time (from FriendFeed).
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

const RANK_METRIC_LABEL: Record<string, string> = {
  completions: 'leaderboard.metricCompletions',
  played: 'leaderboard.metricPlayed',
  reviews: 'leaderboard.metricReviews',
};

// A verified platform 100% (real achievement/trophy data) vs 'manual' or
// '<platform>_estimated' (playtime guess) — same allow-list as FriendFeed.tsx
// and the backend's VERIFIED_COMPLETION_PLATFORMS, kept in sync by hand.
function isVerifiedPlatform(platform: string): boolean {
  return platform === 'steam' || platform === 'xbox' || platform === 'psn';
}

// A review's target (game or studio) → label + deep link.
function reviewTarget(
  game: { id: number; title: string } | null,
  company: { id: number; name: string } | null,
  reviewId: number,
) {
  if (game) return { name: game.title, href: `${gameHref(game.id)}#review-${reviewId}` };
  return { name: company?.name ?? '?', href: company ? `${companyHref(company.id)}#review-${reviewId}` : '/' };
}

export default function HomeActivity() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<FeedPage>(`/feed?limit=${HOME_FEED_LIMIT}`)
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useFeedSocket((item) => {
    setItems((prev) =>
      prev.some((i) => i.id === item.id) ? prev : [item, ...prev].slice(0, HOME_FEED_LIMIT),
    );
  }, true);

  return (
    <div className="card overflow-hidden !rounded-2xl p-0">
      {loading ? (
        <div className="flex flex-col">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse border-b border-zinc-900/5 bg-zinc-900/[0.02] dark:border-zinc-100/5 dark:bg-zinc-100/[0.02]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('home.activityEmpty')}{' '}
          <Link to="/friends" className="font-medium text-accent hover:underline">
            {t('feed.findFriends')}
          </Link>
        </div>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <Row item={item} />
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <Link
          to="/feed"
          className="block border-t border-zinc-900/10 px-4 py-2.5 text-center text-xs font-medium text-zinc-500 transition hover:text-accent dark:border-zinc-100/10 dark:text-zinc-400"
        >
          {t('home.activitySeeAll')}
        </Link>
      )}
    </div>
  );
}

// Compact row: pill (icon or avatar) + <Trans> sentence + time.
function Row({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  const rowClass =
    'flex items-start gap-3 border-b border-zinc-900/[0.06] px-4 py-3 transition last:border-0 hover:bg-zinc-900/[0.03] dark:border-zinc-100/[0.06] dark:hover:bg-zinc-100/[0.03]';

  const line = (node: ReactNode, at: string) => (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] text-zinc-600 dark:text-zinc-400">{node}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400">{relativeTime(at)}</div>
    </div>
  );

  switch (item.kind) {
    case 'review': {
      const r = item.review;
      const tg = reviewTarget(r.game, r.company, r.id);
      return (
        <Link to={tg.href} className={rowClass}>
          <Dot tone="amber" />
          {line(
            <Trans
              i18nKey="feed.rated"
              values={{ user: r.user?.username ?? t('feed.deletedShort'), game: tg.name }}
              components={{ a: <span className={strong} />, s: <span className={strong} /> }}
            />,
            item.at,
          )}
        </Link>
      );
    }
    case 'completed':
      return (
        <Link to={gameHref(item.game.id)} className={rowClass}>
          <Dot tone="emerald" />
          {line(
            <Trans
              i18nKey={isVerifiedPlatform(item.platform) ? 'feed.completed' : 'feed.done'}
              values={{ user: item.actor.username, game: item.game.title }}
              components={{ a: <span className={strong} />, s: <span className={strong} /> }}
            />,
            item.at,
          )}
        </Link>
      );
    case 'review-like': {
      const tg = reviewTarget(item.review.game, item.review.company, item.review.id);
      return (
        <Link to={tg.href} className={rowClass}>
          <Dot tone="amber" />
          {line(
            <Trans
              i18nKey="feed.likedReview"
              values={{ actor: item.actor.username, author: item.review.user?.username ?? t('feed.deletedShort') }}
              components={{ a: <span className={strong} />, s: <span className={strong} /> }}
            />,
            item.at,
          )}
        </Link>
      );
    }
    case 'comment-like': {
      const c = item.comment;
      const tg = reviewTarget(c.review.game, c.review.company, c.review.id);
      return (
        <Link to={tg.href} className={rowClass}>
          <Dot tone="amber" />
          {line(
            <Trans
              i18nKey="feed.likedComment"
              values={{ actor: item.actor.username, author: c.user?.username ?? t('feed.deletedShort') }}
              components={{ a: <span className={strong} />, s: <span className={strong} /> }}
            />,
            item.at,
          )}
        </Link>
      );
    }
    case 'rank': {
      const category = t(RANK_METRIC_LABEL[item.metric] ?? '');
      return (
        <Link to="/leaderboard" className={rowClass}>
          <Dot tone="amber" />
          {line(
            <Trans
              i18nKey="feed.rankLine"
              values={{ user: item.actor.username, rank: item.rank, category }}
              components={{ a: <span className={strong} />, s: <span className={strong} /> }}
            />,
            item.at,
          )}
        </Link>
      );
    }
    case 'achievement': {
      const label = `${t(FAMILY_NAME_KEY[item.family])} · ${item.threshold}`;
      return (
        <Link to={`/u/${item.actor.username}`} className={rowClass}>
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ${tierClasses(item.tier)}`}
          >
            <AchievementIcon family={item.family} className="h-4 w-4" />
          </span>
          {line(
            <Trans
              i18nKey="feed.achievementLine"
              values={{ user: item.actor.username, name: label }}
              components={{ a: <span className={strong} />, s: <span className={strong} /> }}
            />,
            item.at,
          )}
        </Link>
      );
    }
  }
}

// Colored avatar-substitute pill by event type (amber = review/like, emerald = played/100%).
function Dot({ tone }: { tone: 'amber' | 'emerald' }) {
  const cls =
    tone === 'emerald'
      ? 'bg-emerald-500/15 text-emerald-500'
      : 'bg-accent/15 text-accent';
  return (
    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cls}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
