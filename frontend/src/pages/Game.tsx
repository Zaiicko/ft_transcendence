import type { TFunction } from 'i18next';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import AddToListButton from '../components/AddToListButton';
import PlayedButton from '../components/PlayedButton';
import ShareButton from '../components/ShareButton';
import ReviewsSection, { ReviewStats } from '../components/ReviewsSection';
import SectionHead from '../components/SectionHead';
import Select from '../components/Select';
import Skeleton from '../components/Skeleton';
import { apiFetch } from '../lib/api';
import { apiLang } from '../i18n';
import { translateGenre } from '../lib/genres';
import { scrambleText } from '../lib/textScramble';
import { GameDlc, GameSummary } from '../lib/types';

const screenshot1080 = (g: GameSummary) =>
  g.screenshots?.[0]?.replace(/t_[a-z0-9_]+/, 't_1080p') ?? null;

// Bayesian weight: external ratings (IGDB+Steam) together count as this many virtual player votes — a handful of reviews can't crash (or inflate) the score, but a real crowd of users eventually takes over. Same value/spirit as the catalog score (backend).
const RATING_EXTERNAL_WEIGHT = 10;

type RatingSource = { value: number; count: number | null }; // value on 0–10
type BlendedRating = {
  score: number; // 0–10, weighted average shown in the ring
  players?: RatingSource;
  igdb?: RatingSource;
  steam?: RatingSource;
};

// A game's overall rating = weighted average of the available sources, never a single source crushing the others. Externals (IGDB, Steam) form an "external rating" (their average) weighing RATING_EXTERNAL_WEIGHT votes; player reviews weigh 1 each and take over when numerous.
function blendRating(game: GameSummary, stats: ReviewStats | null): BlendedRating | null {
  const players =
    stats && stats._count > 0 && stats._avg.rating != null
      ? { value: stats._avg.rating, count: stats._count }
      : undefined;
  const igdb =
    game.igdbRating != null
      ? { value: game.igdbRating / 10, count: game.igdbRatingCount ?? null }
      : undefined;
  const steam =
    game.steamScore != null
      ? { value: game.steamScore / 10, count: game.steamRatingCount ?? null }
      : undefined;

  const ext = [igdb, steam].filter((s): s is RatingSource => !!s).map((s) => s.value);
  const external = ext.length ? ext.reduce((a, b) => a + b, 0) / ext.length : undefined;

  let score: number | null;
  if (external === undefined) score = players ? players.value : null;
  else if (!players) score = external;
  else
    score =
      (players.count * players.value + RATING_EXTERNAL_WEIGHT * external) /
      (players.count + RATING_EXTERNAL_WEIGHT);

  if (score === null) return null;
  return { score, players, igdb, steam };
}

export default function Game() {
  const { id } = useParams();
  const gameId = Number(id);
  const { t, i18n } = useTranslation();

  // Results tagged by id: on a game change, the old content is ignored without a setState in the effect (set-state-in-effect rule). game === null → 404; missing entry/different id → loading.
  const [loaded, setLoaded] = useState<{ id: number; game: GameSummary | null } | null>(null);
  // Review stats (average + count) shown in the header; fed by ReviewsSection via onStats on each create/delete/real-time event.
  const [stats, setStats] = useState<ReviewStats | null>(null);
  // Bumped when posting a review: the backend then auto-marks the game "done"; this counter forces PlayedButton to reload its state.
  const [playedRefresh, setPlayedRefresh] = useState(0);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  // Remember the last summary per game to fade ONLY on replacement by the translation (not on initial display or game change).
  const summarySeen = useRef<{ id: number; summary: string | null } | null>(null);

  // Translated summary of the current game (id + text), kept separate from the base game so a language change doesn't go back through English.
  const [translated, setTranslated] = useState<{ id: number; text: string } | null>(null);

  // Sticky action bar: the game title appears only once the hero scrolls off screen (observed below).
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroOut, setHeroOut] = useState(false);

  // Base game (English summary) — reloaded only on a GAME change: header, cover, reviews show immediately.
  useEffect(() => {
    let cancelled = false;
    apiFetch<GameSummary>(`/games/${gameId}`)
      .then((g) => {
        if (!cancelled) setLoaded({ id: gameId, game: g });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: gameId, game: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Summary translation — on a game OR language change. Fetched in the background (slow DeepL call on first display) then substituted. In English (apiLang() === '') → no request, back to the base summary.
  useEffect(() => {
    let cancelled = false;
    const lang = apiLang();
    if (!lang) return; // English: displaySummary falls back to the base (see below)
    apiFetch<GameSummary>(`/games/${gameId}?lang=${lang}`)
      .then((g) => {
        if (!cancelled) setTranslated({ id: gameId, text: g.summary ?? '' });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, i18n.language]);

  const game = loaded?.id === gameId ? loaded.game : undefined;

  // The sticky bar title appears when the hero leaves the top of the screen.
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroOut(!e.isIntersecting), {
      rootMargin: '-140px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [game?.id]);
  // Displayed summary: in English (apiLang() === '') → the base; otherwise the current game's translation (kept until the new language arrives → no English flicker between languages).
  const displaySummary =
    translated?.id === gameId && apiLang() !== '' ? translated.text : (game?.summary ?? null);

  // "Decode" (scramble) effect when the DISPLAYED summary changes (translation arrived, or language change): decodes to the new text from the current one — never back to English between languages. Not on a game's first display or game change (remembered by id). useLayoutEffect: starts before paint (no flash of the final text).
  useLayoutEffect(() => {
    const cur = displaySummary;
    const seen = summarySeen.current;
    summarySeen.current = { id: gameId, summary: cur };
    const el = summaryRef.current;
    if (el && seen && seen.id === gameId && seen.summary && cur && seen.summary !== cur) {
      return scrambleText(el, cur);
    }
  }, [displaySummary, gameId]);

  if (game === null) return <p className="py-24 text-center text-zinc-400">{t('game.notFound')}</p>;
  if (!game)
    return (
      <div className="flex flex-col gap-10">
        <Skeleton className="h-[38vh] w-full rounded-xl md:h-[46vh]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );

  const banner = screenshot1080(game);
  const year = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null;
  // Rating shown in the ring: weighted average of all sources (players + IGDB + Steam), live-reactive to new reviews via `stats`.
  const rating = blendRating(game, stats);
  // Distribution available (at least one review) → sticky sidebar to the right of the reviews.
  const hasDist = !!(stats && stats._count > 0 && stats.distribution);

  // Identity (title + meta) — `onDark` over the screenshot gradient (light text).
  const identity = (onDark: boolean) => (
    <>
      <h1
        className={`font-display text-balance text-3xl font-extrabold tracking-tight md:text-4xl ${
          onDark ? 'text-zinc-50' : ''
        }`}
      >
        {game.title}
      </h1>
      <div
        className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${
          onDark ? 'text-zinc-200' : 'text-zinc-600 dark:text-zinc-300'
        }`}
      >
        {year && <span className="rounded-full border border-zinc-500/30 bg-zinc-950/40 px-2.5 py-1 backdrop-blur">{year}</span>}
        {game.genres?.slice(0, 4).map((g) => (
          <span key={g.id} className="rounded-full border border-zinc-500/30 bg-zinc-950/40 px-2.5 py-1 backdrop-blur">
            {translateGenre(g.name, t)}
          </span>
        ))}
        {game.companies?.map((c) => (
          <Link
            key={c.id}
            to={`/company/${c.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2.5 py-1 text-accent backdrop-blur transition hover:bg-accent/20"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
            </svg>
            {c.name}
          </Link>
        ))}
      </div>
      {game.platforms && game.platforms.length > 0 && (
        <div className={`mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold ${onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {game.platforms.slice(0, 6).map((p) => (
            <span key={p.id} className={`rounded-md px-2 py-0.5 ${onDark ? 'bg-zinc-100/10' : 'bg-zinc-900/[0.06] dark:bg-zinc-100/10'}`}>
              {p.name}
            </span>
          ))}
        </div>
      )}
    </>
  );

  // Action bar (reused in the hero and the sticky bar).
  const actions = (
    <>
      <PlayedButton gameId={gameId} releaseDate={game.releaseDate} showCount refreshKey={playedRefresh} />
      <a
        href="#review"
        className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-zinc-950 shadow-sm shadow-accent/30 transition hover:brightness-110"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
        {t('game.rate')}
      </a>
      <AddToListButton gameId={gameId} />
      <ShareButton
        target={{ type: 'GAME', gameId }}
        title={t('game.shareGame')}
        triggerClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
      />
    </>
  );

  return (
    <div className="flex flex-col gap-8">
      <div ref={heroRef}>
        {banner ? (
          <div className="relative overflow-hidden rounded-2xl border border-zinc-900/10 shadow-xl dark:border-zinc-100/10">
            {/* Image fills whatever height the content box below ends up needing (min-height as a
                floor, not a cap) — a fixed height on the image itself clipped the title off games
                with enough genre/studio/platform tags to wrap past that height on narrow screens. */}
            <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
            {/* Stronger, taller fade than a plain 2-stop gradient: mobile wraps genres/platforms into
                more rows, so that text needs the dark base to reach further up the image, not just
                the very bottom sliver — a busy/bright screenshot behind it made tags unreadable. */}
            <div className="relative flex min-h-[300px] items-end gap-5 bg-gradient-to-t from-zinc-950/95 from-15% via-zinc-950/80 via-50% to-transparent p-6 md:min-h-[48vh] md:p-9">
              {game.coverUrl && (
                <img src={game.coverUrl} alt="" className="hidden h-40 w-auto shrink-0 rounded-xl border border-zinc-100/15 shadow-2xl sm:block md:h-52" />
              )}
              <div className="min-w-0 flex-1 pb-1">{identity(true)}</div>
              {rating && <ScoreRing rating={rating} onDark />}
            </div>
          </div>
        ) : (
          <div className="card flex flex-col gap-6 p-6 sm:flex-row">
            {game.coverUrl && <img src={game.coverUrl} alt="" className="h-72 self-start rounded-xl shadow-xl" />}
            <div className="min-w-0 flex-1">{identity(false)}</div>
            {rating && <ScoreRing rating={rating} />}
          </div>
        )}
      </div>

      {/* ---- Sticky action bar (under the nav) ----
          Frameless: never a background or border — just the buttons (and the game name fading in once the hero scrolls off). No backdrop-blur either (it would make this bar the containing block for the position:fixed popups → Done / Add to list offset). */}
      <div className="sticky top-16 z-30">
        <div className="flex items-center gap-3 py-3">
          <span
            className={`font-display min-w-0 truncate text-base font-bold transition-opacity duration-200 ${heroOut ? 'opacity-100' : 'opacity-0'}`}
          >
            {game.title}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2.5">{actions}</div>
        </div>
      </div>

      {game.parent && (
        <Link
          to={`/game/${game.parent.id}`}
          className="inline-flex items-center gap-2 self-start text-sm text-zinc-500 transition hover:text-accent dark:text-zinc-400"
        >
          <span aria-hidden>←</span>
          Contenu de <span className="font-medium">{game.parent.title}</span>
        </Link>
      )}

      {displaySummary && (
        <section>
          <SectionHead eyebrow={t('game.eyeAbout')} title={t('game.aboutTitle')} />
          <div className="card max-w-3xl !rounded-2xl p-5">
            <p ref={summaryRef} className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              {displaySummary}
            </p>
          </div>
        </section>
      )}

      {game.dlcs && game.dlcs.length > 0 && <DlcSelector dlcs={game.dlcs} />}

      {/* Reviews (main) + rating distribution in a sticky sidebar on the right. Without reviews: no grid, full-width reviews. On mobile the distribution goes above the reviews. */}
      <div className={hasDist ? 'grid gap-8 lg:grid-cols-[1fr_300px] lg:items-start' : undefined}>
        {hasDist && (
          <aside className="lg:order-2 lg:sticky lg:top-32">
            <RatingDistribution
              avg={stats?._avg.rating ?? 0}
              count={stats?._count ?? 0}
              distribution={stats?.distribution ?? []}
            />
          </aside>
        )}
        <div className="min-w-0 lg:order-1">
          <ReviewsSection
            target={{ kind: 'game', id: gameId }}
            onStats={setStats}
            onReviewCreated={() => setPlayedRefresh((n) => n + 1)}
          />
        </div>
      </div>
    </div>
  );
}

// Rating ring (0–10) showing the weighted average. On hover (or keyboard focus), a tooltip details each source: Saveboxd players, IGDB, Steam, with their rating and vote/review count. The amber accent fills the ring proportionally.
function ScoreRing({ rating, onDark = false }: { rating: BlendedRating; onDark?: boolean }) {
  const { t } = useTranslation();
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.min(Math.max(rating.score / 10, 0), 1);

  const rows: { label: string; value: string; count: string | null }[] = [];
  if (rating.players)
    rows.push({
      label: t('game.rating.players'),
      value: `${rating.players.value.toFixed(1)}/10`,
      count: t(rating.players.count === 1 ? 'game.reviewCountOne' : 'game.reviewCountMany', {
        count: rating.players.count,
      }),
    });
  if (rating.igdb)
    rows.push({
      label: 'IGDB',
      value: `${rating.igdb.value.toFixed(1)}/10`,
      count:
        rating.igdb.count != null
          ? t(rating.igdb.count === 1 ? 'game.rating.votesOne' : 'game.rating.votesMany', {
              count: rating.igdb.count,
            })
          : null,
    });
  if (rating.steam)
    rows.push({
      label: 'Steam',
      value: `${Math.round(rating.steam.value * 10)}%`,
      count:
        rating.steam.count != null
          ? t(rating.steam.count === 1 ? 'game.rating.votesOne' : 'game.rating.votesMany', {
              count: rating.steam.count,
            })
          : null,
    });

  return (
    <div className="group relative hidden h-24 w-24 shrink-0 cursor-help sm:block" tabIndex={0}>
      <svg viewBox="0 0 64 64" className="h-24 w-24 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" className={onDark ? 'stroke-zinc-100/20' : 'stroke-zinc-900/10 dark:stroke-zinc-100/15'} />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-accent" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className={`absolute inset-0 flex flex-col items-center justify-center ${onDark ? 'text-zinc-50' : ''}`}>
        <span className="font-display text-2xl font-extrabold tabular-nums leading-none text-accent">{rating.score.toFixed(1)}</span>
        <span className={`text-[10px] font-semibold ${onDark ? 'text-zinc-300' : 'text-zinc-400'}`}>/10</span>
      </div>

      {/* Tooltip: source breakdown (hover + focus). Opaque background → readable on both the dark hero and the light card. */}
      <div className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 w-60 rounded-xl bg-zinc-900 p-3 text-left opacity-0 shadow-xl ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-white/10 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {t('game.rating.globalTitle')}
          </span>
          <span className="font-display text-lg font-extrabold tabular-nums text-accent">
            {rating.score.toFixed(1)}
            <span className="ml-0.5 text-[10px] font-semibold text-zinc-500">/10</span>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-300">{row.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-zinc-100">{row.value}</span>
                {row.count && <span className="ml-1.5 text-[10px] text-zinc-500">{row.count}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Vertical rating-distribution card (0–10) for the sidebar: big average, review count, then the 10→0 histogram.
function RatingDistribution({ avg, count, distribution }: { avg: number; count: number; distribution: number[] }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...distribution);
  return (
    <section>
      <SectionHead eyebrow={t('game.eyeDistribution')} title={t('game.distributionTitle')} />
      <div className="card p-5">
        <div className="mb-4 border-b border-zinc-900/10 pb-4 text-center dark:border-zinc-100/10">
          <div className="font-display text-5xl font-extrabold tabular-nums leading-none text-accent">
            {avg.toFixed(1)}
            <span className="text-xl text-zinc-400">/10</span>
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {t(count === 1 ? 'game.reviewCountOne' : 'game.reviewCountMany', { count })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {distribution
            .map((n, rating) => ({ n, rating }))
            .reverse()
            .map(({ n, rating }) => (
              <div key={rating} className="flex items-center gap-2 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                <span className="w-4 shrink-0 text-right font-semibold text-zinc-600 dark:text-zinc-300">{rating}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-900/[0.06] dark:bg-zinc-100/10">
                  <span className="block h-full rounded-full bg-gradient-to-r from-amber-300 to-accent" style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="w-5 shrink-0 text-right">{n}</span>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

// Translated label of the additional-content type.
function dlcTypeLabel(type: string, t: TFunction): string {
  if (type === 'EXPANSION') return t('game.dlcExpansion');
  if (type === 'STANDALONE') return t('game.dlcStandalone');
  return t('game.dlcGeneric');
}

const dlcYear = (d: GameDlc) => d.releaseDate?.slice(0, 4);

// Small "Rate" link → opens the DLC page on the review form.
function RateLink({ id }: { id: number }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/game/${id}#review`}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-400/60 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 fill-none stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
      {t('game.rate')}
    </Link>
  );
}

// Variant A: a dropdown to pick a DLC, then a panel with the "done" toggle (in place) and the "Rate" button for the selected DLC.
function DlcSelector({ dlcs }: { dlcs: GameDlc[] }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = dlcs.find((d) => d.id === selectedId) ?? null;

  return (
    <section>
      <SectionHead eyebrow={t('game.eyeDlc')} title={t('game.dlcHeading', { count: dlcs.length })} />
      <Select
        label={t('game.chooseDlcLabel')}
        value={selectedId?.toString() ?? ''}
        onChange={(v) => setSelectedId(v ? Number(v) : null)}
        className="w-full max-w-md"
        options={[
          { value: '', label: t('game.chooseDlcPlaceholder') },
          ...dlcs.map((d) => ({
            value: String(d.id),
            label: `${dlcTypeLabel(d.gameType, t)} · ${d.title}${dlcYear(d) ? ` (${dlcYear(d)})` : ''}`,
          })),
        ]}
      />

      {selected && (
        <div className="card mt-3 flex items-center gap-4 p-4">
          {selected.coverUrl ? (
            <img
              src={selected.coverUrl}
              alt=""
              className="h-24 w-auto shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-center text-[10px] text-zinc-500 dark:bg-zinc-800">
              {dlcTypeLabel(selected.gameType, t)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Link
              to={`/game/${selected.id}`}
              className="line-clamp-2 font-semibold transition hover:text-accent"
            >
              {selected.title}
            </Link>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {dlcTypeLabel(selected.gameType, t)}
              {dlcYear(selected) ? ` · ${dlcYear(selected)}` : ''}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <PlayedButton gameId={selected.id} releaseDate={selected.releaseDate} />
              <RateLink id={selected.id} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

