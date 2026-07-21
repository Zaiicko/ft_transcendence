import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFeedSocket } from '../feed/useFeedSocket';
import { apiFetch } from '../lib/api';
import type { FeedItem, FeedPage } from '../lib/types';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import Stars from './Stars';

const PAGE = 12;
const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;

// Date relative courte (« il y a 3 h », « hier », sinon date)
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr');
}

export default function FriendFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<FeedPage>(`/feed?limit=${PAGE}`)
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
  }, []);

  // Temps réel : un nouvel item d'un ami s'insère en tête (dédup par id)
  useFeedSocket((item) => {
    setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [item, ...prev]));
  }, true);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<FeedPage>(`/feed?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`);
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

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-900" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FeedIcon />}
        title="Rien de neuf chez tes amis"
        description="Ajoute des amis et suis leurs dernières critiques et jeux terminés ici."
      >
        <Link
          to="/friends"
          className="mt-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110"
        >
          Trouver des amis
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        switch (item.kind) {
          case 'review':
            return <ReviewItem key={item.id} item={item} />;
          case 'played':
            return <PlayedItem key={item.id} item={item} />;
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
          {loadingMore ? 'Chargement…' : 'Charger plus'}
        </button>
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
        <ActorLine actor={r.user} at={item.at} verb="a noté" strong={target.name} />
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
        <ActorLine actor={item.actor} at={item.at} verb="a joué à" strong={item.game.title} />
      </div>
      <span className="shrink-0 text-zinc-400" title="Jeu terminé">
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
        <LikeLine actor={item.actor} author={r.user} at={item.at} what="l'avis" />
        <div className="mt-1 truncate text-sm font-semibold">« {r.title} »</div>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">sur {t.name}</div>
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
        <LikeLine actor={item.actor} author={c.user} at={item.at} what="le commentaire" />
        <p className="mt-1 line-clamp-2 text-sm italic text-zinc-600 dark:text-zinc-400">
          « {c.text} »
        </p>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">sur {t.name}</div>
      </div>
    </Link>
  );
}

// Libellé « X a aimé <what> de Y » (Y = auteur de l'avis/commentaire)
function LikeLine({
  actor,
  author,
  at,
  what,
}: {
  actor: { username: string; avatarUrl: string | null };
  author: { username: string; avatarUrl: string | null } | null;
  at: string;
  what: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <Avatar username={actor.username} avatarUrl={actor.avatarUrl} size={20} />
      <span className="min-w-0 truncate">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{actor.username}</span> a
        aimé {what} de{' '}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {author?.username ?? '[supprimé]'}
        </span>
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

function ActorLine({
  actor,
  at,
  verb,
  strong,
}: {
  actor: { username: string; avatarUrl: string | null } | null;
  at: string;
  verb: string;
  strong: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      {actor ? (
        <>
          <Avatar username={actor.username} avatarUrl={actor.avatarUrl} size={20} />
          <span className="min-w-0 truncate">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{actor.username}</span>{' '}
            {verb} <span className="font-semibold text-zinc-900 dark:text-zinc-100">{strong}</span>
          </span>
        </>
      ) : (
        <em>[utilisateur supprimé]</em>
      )}
      <span className="ml-auto shrink-0 text-xs text-zinc-400">{relativeTime(at)}</span>
    </div>
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
