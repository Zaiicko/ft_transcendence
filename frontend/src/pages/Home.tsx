import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { TFunction } from 'i18next';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import EmptyState, { PencilIcon } from '../components/EmptyState';
import HomeActivity from '../components/HomeActivity';
import PlayedButton from '../components/PlayedButton';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from '../components/ReactionIcons';
import { CoverGridSkeleton } from '../components/Skeleton';
import Stars, { StarIcon } from '../components/Stars';
import { apiFetch } from '../lib/api';
import { translateGenre } from '../lib/genres';
import { imageSize } from '../lib/theme';
import { GameSummary, HomeStats, ReviewHighlight } from '../lib/types';

gsap.registerPlugin(ScrollTrigger);

const HIGHLIGHTS_STEP = 6;
const POPULAR_STEP = 8;
// 8 jeux au départ + clics sur ⌄
const POPULAR_MAX = 24;
// Recommandations : mêmes 6 au départ, le bouton ⌄ dévoile la suite (le backend
// en renvoie jusqu'à 12)
const RECO_STEP = 6;

const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;

const screenshot1080 = (g: GameSummary) =>
  g.screenshots?.[0]?.replace(/t_[a-z0-9_]+/, 't_1080p') ?? null;

// n éléments distincts au hasard (Fisher-Yates partiel sur une copie)
function pickRandom<T>(pool: T[], n: number): T[] {
  const copy = [...pool];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [popular, setPopular] = useState<GameSummary[]>([]);
  const [featured, setFeatured] = useState<GameSummary | null>(null);
  const [highlights, setHighlights] = useState<ReviewHighlight[]>([]);
  const [recommended, setRecommended] = useState<GameSummary[]>([]);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [shown, setShown] = useState(HIGHLIGHTS_STEP);
  const [shownPopular, setShownPopular] = useState(POPULAR_STEP);
  const [shownReco, setShownReco] = useState(RECO_STEP);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const revealTriggers = useRef<ScrollTrigger[]>([]);

  const visiblePopular = popular.slice(0, shownPopular);
  const visibleRecommended = recommended.slice(0, shownReco);
  const visibleHighlights = highlights.slice(0, shown);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ data: GameSummary[] }>('/games?sort=popular&limit=50'),
      apiFetch<ReviewHighlight[]>('/reviews/highlights?limit=30').catch(() => []),
    ]).then(async ([games, feed]) => {
      if (cancelled) return;
      // Rangée du milieu : POPULAR_MAX jeux au hasard dans le top 50, on n'en
      // montre que POPULAR_STEP au départ (le bouton ⌄ dévoile la suite) —
      // la home est différente à chaque visite
      setPopular(pickRandom(games.data, POPULAR_MAX));
      setHighlights(feed);
      setLoading(false);
      // Vedette : on sonde des candidats mélangés jusqu'à un screenshot en
      // VRAI 1920×1080 (taille naturelle — le 720p d'un CoD4 pixelise déjà
      // en bannière plein écran). 25 essais max, sinon tant pis.
      const withShots = games.data.filter((g) => g.screenshots?.length);
      const candidates = pickRandom(withShots.length > 0 ? withShots : games.data, 25);
      let chosen = candidates[0] ?? null;
      for (const g of candidates) {
        const url = screenshot1080(g);
        if (!url) continue;
        const size = await imageSize(url);
        if (cancelled) return;
        if (size && size.width >= 1920 && size.height >= 1080) {
          chosen = g;
          break;
        }
      }
      setFeatured(chosen);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Personnalisé : recommandations + bande de stats « ton année en jeux ».
  // Rien à charger pour un visiteur anonyme. Les sections sont de toute façon
  // gated par `user` au rendu.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiFetch<{ data: GameSummary[] }>('/games/recommendations')
      .then((r) => {
        if (!cancelled) setRecommended(r.data);
      })
      .catch(() => {});
    apiFetch<HomeStats>('/users/me/home-stats')
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  // La bannière est visible dès l'arrivée : elle s'anime au chargement, et sa
  // parallaxe (l'image défile plus lentement que la page) est pilotée par le
  // scroll. gsap.context scope les sélecteurs au composant et revert() nettoie
  // au démontage (même rôle qu'un destructeur RAII). useLayoutEffect : comme
  // useEffect mais AVANT que le navigateur peigne — l'état initial (opacité 0)
  // est posé sans qu'aucune frame "visible" ne s'affiche d'abord (anti-flash).
  useLayoutEffect(() => {
    if (!featured) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-anim="hero"]', { opacity: 0, y: 24, duration: 0.6, ease: 'power2.out' });
      gsap.to('[data-anim="hero-bg"]', {
        yPercent: 18,
        ease: 'none',
        scrollTrigger: { trigger: '[data-anim="hero"]', start: 'top top', end: 'bottom top', scrub: true },
      });
    }, rootRef);
    return () => ctx.revert();
  }, [featured]);

  // Tout le reste (jaquettes + cartes de critiques + tuiles de stats) ne s'anime
  // que quand l'élément entre dans le viewport. Les boutons ⌄ / « voir plus »
  // ajoutent des éléments après coup : à chaque rendu on ne câble que ceux pas
  // encore marqués data-revealed, sans toucher aux animations déjà jouées.
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fresh = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        '[data-anim="cover"], [data-anim="card"], [data-anim="stat"]',
      ) ?? [],
    ).filter((el) => !el.dataset.revealed);
    if (fresh.length === 0) return;
    fresh.forEach((el) => {
      el.dataset.revealed = '1';
    });
    gsap.set(fresh, { opacity: 0, y: 24 });
    revealTriggers.current.push(
      ...ScrollTrigger.batch(fresh, {
        start: 'top 92%',
        once: true,
        onEnter: (els) =>
          gsap.to(els, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' }),
      }),
    );
    // Les nouveaux éléments décalent ceux d'en dessous : on refait mesurer
    // toutes les positions de déclenchement
    ScrollTrigger.refresh();
  }, [visiblePopular, visibleRecommended, visibleHighlights, stats]);

  // Démontage : tuer les triggers encore en attente et rendre visibles les
  // éléments masqués, pour repartir propre si le composant est remonté
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      revealTriggers.current.forEach((trigger) => trigger.kill());
      revealTriggers.current = [];
      root?.querySelectorAll<HTMLElement>('[data-revealed]').forEach((el) => {
        delete el.dataset.revealed;
        gsap.set(el, { clearProps: 'opacity,transform' });
      });
    };
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col gap-12">
      {featured ? (
        <Hero game={featured} />
      ) : (
        // Réserve l'emplacement de la carte hero pendant la recherche du
        // screenshot 1080p : sans ça, les sections du dessous se câblent en
        // haut de page (→ animations déclenchées à tort au chargement) puis
        // sont poussées vers le bas quand la carte s'insère (double saut)
        <div className="h-[46vh] animate-pulse rounded-3xl bg-zinc-200 md:h-[56vh] dark:bg-zinc-900" />
      )}

      {user && stats && <StatsBand stats={stats} />}

      {user && recommended.length > 0 && (
        <section>
          <SectionHead eyebrow={t('home.recoEyebrow')} title={t('home.recommendedForYou')} />
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            {visibleRecommended.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
          <GridExpander
            shown={shownReco}
            step={RECO_STEP}
            total={recommended.length}
            onChange={setShownReco}
            moreLabel={t('home.showMoreRecommended')}
            lessLabel={t('home.showLessRecommended')}
          />
        </section>
      )}

      {/* Populaires (gauche) + Activité des amis (droite, connectés seulement) */}
      <section>
        <div className={user ? 'grid gap-8 lg:grid-cols-[1fr_360px]' : ''}>
          <div>
            <SectionHead eyebrow={t('home.popularEyebrow')} title={t('home.popularNow')} />
            {popular.length > 0 ? (
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
                {visiblePopular.map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
              </div>
            ) : (
              <CoverGridSkeleton count={8} />
            )}
            <GridExpander
              shown={shownPopular}
              step={POPULAR_STEP}
              total={popular.length}
              onChange={setShownPopular}
              moreLabel={t('home.showMorePopular')}
              lessLabel={t('home.showLessPopular')}
            />
          </div>
          {user && (
            <aside>
              <SectionHead eyebrow={t('home.activityEyebrow')} title={t('home.activityTitle')} />
              <HomeActivity />
            </aside>
          )}
        </div>
      </section>

      <section>
        <SectionHead eyebrow={t('home.reviewsEyebrow')} title={t('home.popularReviews')} />
        {highlights.length === 0 ? (
          loading ? null : (
            <EmptyState
              icon={<PencilIcon />}
              title={t('home.noReviewsTitle')}
              description={t('home.noReviewsDescription')}
            />
          )
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleHighlights.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
            {shown < highlights.length && (
              <button
                type="button"
                onClick={() => setShown(shown + HIGHLIGHTS_STEP)}
                className="mx-auto mt-6 block rounded-lg border border-zinc-400 px-6 py-2 text-sm hover:opacity-70 dark:border-zinc-700"
              >
                {t('home.showMoreReviews')}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// En-tête de section : petit "eyebrow" ambre au-dessus d'un titre display, pour
// donner de la hiérarchie (au lieu du même minuscule label gris partout).
function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        <span className="text-accent">●</span> {eyebrow}
      </div>
      <h2 className="font-display mt-1.5 text-2xl font-bold tracking-tight">{title}</h2>
    </div>
  );
}

// "2023 · RPG · Aventure" — l'année de sortie et jusqu'à trois genres (traduits)
function heroMeta(game: GameSummary, t: TFunction): string {
  const year = game.releaseDate?.slice(0, 4);
  const genres = game.genres
    ?.slice(0, 3)
    .map((g) => translateGenre(g.name, t))
    .join(' · ');
  return [year, genres].filter(Boolean).join(' · ');
}

function Hero({ game }: { game: GameSummary }) {
  // Hero "cinéma" : grande carte arrondie, halo ambre, dégradé profond et
  // jaquette officielle posée dessus. Toute la carte renvoie à la fiche.
  const { t } = useTranslation();
  const { user } = useAuth();
  const banner = screenshot1080(game);
  return (
    <div data-anim="hero" className="relative">
      <a
        href={gameHref(game.id)}
        aria-label={t('home.viewGame', { title: game.title })}
        className="group relative block overflow-hidden rounded-3xl border border-zinc-900/10 shadow-2xl shadow-black/30 dark:border-zinc-100/10"
      >
        {banner ? (
          <img
            data-anim="hero-bg"
            src={banner}
            alt=""
            className="h-[46vh] w-full scale-110 object-cover md:h-[56vh]"
          />
        ) : (
          <div
            data-anim="hero-bg"
            className="h-[46vh] scale-125 bg-cover bg-center opacity-60 blur-2xl md:h-[56vh]"
            style={game.coverUrl ? { backgroundImage: `url(${game.coverUrl})` } : undefined}
          />
        )}
        {/* Halo ambre signature en haut à droite */}
        <div className="pointer-events-none absolute -right-24 -top-40 h-[32rem] w-[32rem] rounded-full bg-accent/25 blur-3xl" />
        {/* Badge "à la une" */}
        <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-zinc-100/20 bg-zinc-950/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-100 backdrop-blur">
          <span className="text-accent">✦</span> {t('home.featuredBadge')}
        </span>
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 bg-gradient-to-t from-zinc-950/95 via-zinc-950/45 to-transparent p-6 md:p-10">
          {game.coverUrl && (
            <img
              src={game.coverUrl}
              alt=""
              className="hidden h-40 w-auto shrink-0 rounded-xl border border-zinc-100/15 shadow-2xl sm:block md:h-56"
            />
          )}
          <div className="min-w-0 pb-1">
            <h1 className="font-display max-w-2xl text-balance text-3xl font-extrabold leading-[0.98] tracking-tight text-zinc-50 md:text-5xl">
              {game.title}
            </h1>
            <div className="mt-3 flex items-center gap-3 text-sm text-zinc-300">
              {game.score !== undefined && <ScoreBadge score={game.score} />}
              {heroMeta(game, t) && <span>{heroMeta(game, t)}</span>}
            </div>
          </div>
        </div>
      </a>
      {/* Actions (connectés) posées par-dessus le lien de la carte */}
      {user && (
        <div className="absolute bottom-6 right-6 flex items-center gap-3 md:bottom-10 md:right-10">
          <PlayedButton gameId={game.id} onDark />
          <a
            href={`${gameHref(game.id)}#review`}
            className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-accent/30 transition hover:brightness-110"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 fill-none stroke-current"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            {t('home.writeReview')}
          </a>
        </div>
      )}
    </div>
  );
}

// Bande "ton année en jeux" : jeux faits, 100 %, critiques (+ moyenne), rang
// mondial, succès (avec anneau de progression). Densité + couleur signature.
function StatsBand({ stats }: { stats: HomeStats }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const year = new Date().getFullYear();
  const achPct = stats.achievements.total
    ? stats.achievements.unlocked / stats.achievements.total
    : 0;
  return (
    <section>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            <span className="text-accent">●</span> {t('home.statsEyebrow')}
          </div>
          <h2 className="font-display mt-1.5 text-2xl font-bold tracking-tight">
            {t('home.statsHeading', { year })}
          </h2>
        </div>
        {user && (
          <a
            href={`/u/${user.username}`}
            className="hidden text-sm text-zinc-500 transition hover:text-accent sm:inline dark:text-zinc-400"
          >
            {t('home.seeProfile')} →
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label={t('home.statDone')}
          value={stats.done}
          caption={t('home.statDoneCaption')}
          tone="accent"
        />
        <StatTile
          label={t('home.statPerfect')}
          value={stats.perfect}
          caption={t('home.statPerfectCaption')}
          tone="emerald"
        />
        <StatTile
          label={t('home.statReviews')}
          value={stats.reviews}
          caption={
            stats.avgRating != null
              ? t('home.statAvg', { value: (stats.avgRating / 2).toFixed(1) })
              : t('home.statNoReviews')
          }
        />
        <StatTile
          label={t('home.statRank')}
          value={stats.rank ? `#${stats.rank.rank}` : '—'}
          caption={stats.rank ? t('home.statRankCaption') : t('home.statUnranked')}
          tone="accent"
        />
        <StatTile
          label={t('home.statAchievements')}
          value={`${stats.achievements.unlocked}`}
          suffix={`/${stats.achievements.total}`}
          ring={achPct}
        />
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  caption,
  suffix,
  tone,
  ring,
}: {
  label: string;
  value: number | string;
  caption?: string;
  suffix?: string;
  tone?: 'accent' | 'emerald';
  ring?: number;
}) {
  const valueColor =
    tone === 'accent' ? 'text-accent' : tone === 'emerald' ? 'text-emerald-500' : '';
  return (
    <div
      data-anim="stat"
      className="card relative overflow-hidden !rounded-2xl p-4"
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`font-display mt-1.5 text-3xl font-extrabold tabular-nums tracking-tight ${valueColor}`}>
        {value}
        {suffix && <span className="text-base font-bold text-zinc-400">{suffix}</span>}
      </div>
      {caption && <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{caption}</div>}
      {ring !== undefined && <ProgressRing pct={ring} />}
    </div>
  );
}

// Petit anneau de progression (succès débloqués / total).
function ProgressRing({ pct }: { pct: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg className="absolute right-3 top-3" width="32" height="32" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-zinc-900/10 dark:text-zinc-100/10" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(Math.max(pct, 0), 1))}
        transform="rotate(-90 18 18)"
        className="text-accent"
      />
    </svg>
  );
}

// Contrôles ⌄ / ⌃ sous une grille de jaquettes : déroule ou replie par pas de
// `step`. La flèche bas apparaît tant qu'il reste à montrer, la flèche haut dès
// qu'on a dépassé le palier initial.
function GridExpander({
  shown,
  step,
  total,
  onChange,
  moreLabel,
  lessLabel,
}: {
  shown: number;
  step: number;
  total: number;
  onChange: (next: number) => void;
  moreLabel: string;
  lessLabel: string;
}) {
  const canMore = shown < total;
  const canLess = shown > step;
  if (!canMore && !canLess) return null;
  const btn =
    'flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400 hover:opacity-70 dark:border-zinc-700';
  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      {canLess && (
        <button
          type="button"
          onClick={() => onChange(Math.max(step, shown - step))}
          aria-label={lessLabel}
          title={lessLabel}
          className={btn}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
            <path d="m6 15 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {canMore && (
        <button
          type="button"
          onClick={() => onChange(Math.min(total, shown + step))}
          aria-label={moreLabel}
          title={moreLabel}
          className={btn}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  const { t } = useTranslation();
  const genres = game.genres?.slice(0, 2).map((g) => translateGenre(g.name, t)) ?? [];
  return (
    <a href={gameHref(game.id)} data-anim="cover" className="group relative block">
      <div className="relative overflow-hidden rounded-xl border border-zinc-900/10 shadow-lg shadow-black/10 transition duration-300 group-hover:-translate-y-1.5 group-hover:shadow-2xl dark:border-zinc-100/10">
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.title}
            className="aspect-[3/4] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center bg-zinc-200 p-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {game.title}
          </div>
        )}
        {game.score !== undefined && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-amber-300 to-accent px-2 py-0.5 text-xs font-bold tabular-nums text-zinc-950 shadow">
            <StarIcon className="h-3 w-3" />
            {game.score.toFixed(1)}
          </span>
        )}
        {/* Voile + genres révélés au survol */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/10 to-transparent opacity-0 transition group-hover:opacity-100" />
        {genres.length > 0 && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex translate-y-2 flex-wrap gap-1.5 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
            {genres.map((g) => (
              <span
                key={g}
                className="rounded-full border border-zinc-100/30 bg-zinc-950/40 px-2 py-0.5 text-[10px] font-semibold text-zinc-100 backdrop-blur"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 truncate text-xs text-zinc-600 dark:text-zinc-400" title={game.title}>
        {game.title}
      </div>
    </a>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-br from-amber-300 to-accent px-2.5 py-1 text-sm font-bold tabular-nums text-zinc-950">
      <StarIcon className="h-3.5 w-3.5" />
      {score.toFixed(1)}
    </span>
  );
}

function ReviewCard({ review }: { review: ReviewHighlight }) {
  const { t } = useTranslation();
  // Le lien pointe sur l'avis précis (#review-<id>) : la fiche jeu/studio défile
  // dessus et l'encadre, comme depuis un profil.
  const target = review.game
    ? {
        name: review.game.title,
        cover: review.game.coverUrl,
        href: `${gameHref(review.game.id)}#review-${review.id}`,
        isCompany: false,
      }
    : {
        name: review.company?.name ?? '?',
        cover: review.company?.logoUrl ?? null,
        href: review.company ? `${companyHref(review.company.id)}#review-${review.id}` : '/',
        isCompany: true,
      };

  return (
    <a
      href={target.href}
      data-anim="card"
      className="card flex flex-col gap-3 p-5 transition hover:-translate-y-1 hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      <div className="flex items-center gap-3">
        {target.cover && (
          <img
            src={target.cover}
            alt=""
            className={
              target.isCompany
                ? 'h-16 w-11 shrink-0 rounded-lg bg-white object-contain p-0.5'
                : 'h-16 w-11 shrink-0 rounded-lg object-cover'
            }
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{target.name}</div>
          <div className="mt-1">
            <Stars rating={review.rating} showValue={false} />
          </div>
        </div>
        {/* Note en gros chiffre ambre — l'accent du bloc (sur 10) */}
        <div className="font-display shrink-0 text-3xl font-extrabold tabular-nums leading-none text-accent">
          {review.rating}
          <span className="text-base font-bold text-zinc-400">/10</span>
        </div>
      </div>
      <div className="text-sm font-semibold">« {review.title} »</div>
      <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{review.text}</p>
      <div className="mt-auto flex items-center gap-3 border-t border-zinc-900/5 pt-3 text-xs text-zinc-500 dark:border-zinc-100/5">
        {review.user ? (
          <span className="flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300">
            <Avatar username={review.user.username} avatarUrl={review.user.avatarUrl} size={18} />
            {review.user.username}
          </span>
        ) : (
          <em>{t('home.deletedUser')}</em>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <ThumbsUpIcon className="h-3.5 w-3.5" /> {review._count.likes}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsDownIcon className="h-3.5 w-3.5" /> {review._count.dislikes}
        </span>
        <span className="inline-flex items-center gap-1">
          <CommentIcon className="h-3.5 w-3.5" /> {review._count.comments}
        </span>
      </div>
    </a>
  );
}
