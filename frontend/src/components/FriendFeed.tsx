import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import i18n from '../i18n';
import { useFeedSocket } from '../feed/useFeedSocket';
import { apiFetch } from '../lib/api';
import type { FeedItem, FeedPage } from '../lib/types';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import PsnBadge from './PsnBadge';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import Stars from './Stars';
import SteamBadge from './SteamBadge';

const PAGE = 12;
const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;

// Logo Xbox (Simple Icons, CC0) — badge vert, aligné sur Steam/PSN
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';

// Nom d'affichage de la plateforme (nom propre, identique dans toutes les langues)
const PLATFORM_LABEL: Record<string, string> = {
  steam: 'Steam',
  xbox: 'Xbox',
  psn: 'PlayStation',
};

// Gras réutilisé dans les phrases <Trans> (nom d'acteur / cible mis en avant)
const strongClass = 'font-semibold text-zinc-900 dark:text-zinc-100';

// Date relative courte (« il y a 3 h », « hier », sinon date), localisée
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

type Filter = 'all' | 'reviews' | 'played' | 'completed' | 'likes';

const TAB_KEYS: { key: Filter; labelKey: string }[] = [
  { key: 'all', labelKey: 'feed.tabAll' },
  { key: 'reviews', labelKey: 'feed.tabReviews' },
  { key: 'played', labelKey: 'feed.tabPlayed' },
  { key: 'completed', labelKey: 'feed.tabCompleted' },
  { key: 'likes', labelKey: 'feed.tabLikes' },
];

// Un item pushé en temps réel correspond-il à l'onglet courant ?
function inFilter(kind: FeedItem['kind'], filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'reviews') return kind === 'review';
  if (filter === 'played') return kind === 'played';
  if (filter === 'completed') return kind === 'completed';
  return kind === 'review-like' || kind === 'comment-like';
}

export default function FriendFeed() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  // Repère le changement d'onglet pendant le rendu (plutôt qu'un setState
  // synchrone dans l'effet ci-dessous) pour passer loading à true sans
  // rendu intermédiaire superflu — voir react-hooks/set-state-in-effect
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

  // Recharge à chaque changement d'onglet (repart de zéro)
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

  // Temps réel : un nouvel item d'un ami s'insère en tête (si l'onglet le
  // laisse passer, et sans doublon)
  useFeedSocket((item) => {
    if (!inFilter(item.kind, filter)) return;
    setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [item, ...prev]));
  }, true);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<FeedPage>(query(cursor));
      // Dédup au cas où un push temps réel aurait déjà inséré un item
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      /* réseau : on garde l'état */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Onglets de filtre */}
      <div className="flex gap-2">
        {TAB_KEYS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
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
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            switch (item.kind) {
              case 'review':
                return <ReviewItem key={item.id} item={item} />;
              case 'played':
                return <PlayedItem key={item.id} item={item} />;
              case 'completed':
                return <CompletedItem key={item.id} item={item} />;
              case 'review-like':
                return <ReviewLikeItem key={item.id} item={item} />;
              case 'comment-like':
                return <CommentLikeItem key={item.id} item={item} />;
            }
          })}
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

// Libellé « X a aimé l'avis/le commentaire de Y » (Y = auteur). L'ordre des mots
// et la tournure sont portés par la clé de traduction (feed.likedReview/Comment).
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

// Cible (jeu OU studio) → libellé, jaquette et lien deep vers l'avis
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

// Libellé « X a noté / a joué à / a complété <cible> ». L'action et l'ordre des
// mots sont portés par la clé (feed.rated / feed.played / feed.completed).
const ACTION_KEY: Record<'rated' | 'played' | 'completed', string> = {
  rated: 'feed.rated',
  played: 'feed.played',
  completed: 'feed.completed',
};

function ActorLine({
  actor,
  at,
  action,
  strong,
}: {
  actor: { username: string; avatarUrl: string | null } | null;
  at: string;
  action: 'rated' | 'played' | 'completed';
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

// Petit badge de la plateforme où le jeu a été complété (réutilise Steam/PSN,
// Xbox en ligne pour rester cohérent avec les autres écrans).
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

// « X a complété <jeu> à 100 % » — trophée + badge de la plateforme
function CompletedItem({ item }: { item: Extract<FeedItem, { kind: 'completed' }> }) {
  return (
    <Link
      to={gameHref(item.game.id)}
      className="card flex items-center gap-3 p-4 transition hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      {item.game.coverUrl && (
        <img src={item.game.coverUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <ActorLine actor={item.actor} at={item.at} action="completed" strong={item.game.title} />
        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <PlatformMark platform={item.platform} />
          <span>{PLATFORM_LABEL[item.platform] ?? item.platform}</span>
        </div>
      </div>
      <span className="shrink-0 text-amber-500" title={i18n.t('feed.completedBadge')}>
        <TrophyIcon />
      </span>
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
