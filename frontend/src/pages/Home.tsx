import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { imageSize } from '../lib/theme';
import { GameSummary, ReviewHighlight } from '../lib/types';

gsap.registerPlugin(ScrollTrigger);

const HIGHLIGHTS_STEP = 6;
const POPULAR_STEP = 6;
// 6 jeux au départ + 2 clics sur ⌄ maximum
const POPULAR_MAX = POPULAR_STEP * 3;

// La fiche jeu React n'existe pas encore : les avis vivent sur la page de
// test (deep links #game-<id> / #company-<id>) en attendant
const gameHref = (id: number) => `/test-api.html#game-${id}`;
const companyHref = (id: number) => `/test-api.html#company-${id}`;

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
  const [popular, setPopular] = useState<GameSummary[]>([]);
  const [featured, setFeatured] = useState<GameSummary | null>(null);
  const [highlights, setHighlights] = useState<ReviewHighlight[]>([]);
  const [shown, setShown] = useState(HIGHLIGHTS_STEP);
  const [shownPopular, setShownPopular] = useState(POPULAR_STEP);
  const rootRef = useRef<HTMLDivElement>(null);
  const revealTriggers = useRef<ScrollTrigger[]>([]);

  const visiblePopular = popular.slice(0, shownPopular);
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

  // Tout le reste (jaquettes + cartes de critiques) ne s'anime que quand
  // l'élément entre dans le viewport. Les boutons ⌄ / « voir plus » ajoutent
  // des éléments après coup : à chaque rendu on ne câble que ceux pas encore
  // marqués data-revealed, sans toucher aux animations déjà jouées.
  useLayoutEffect(() => {
    if (visiblePopular.length === 0 && visibleHighlights.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fresh = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[data-anim="cover"], [data-anim="card"]') ??
        [],
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
  }, [visiblePopular, visibleHighlights]);

  // Démontage : tuer les triggers encore en attente et rendre visibles les
  // éléments masqués, pour repartir propre si le composant est remonté
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      revealTriggers.current.forEach((t) => t.kill());
      revealTriggers.current = [];
      root?.querySelectorAll<HTMLElement>('[data-revealed]').forEach((el) => {
        delete el.dataset.revealed;
        gsap.set(el, { clearProps: 'opacity,transform' });
      });
    };
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col gap-10">
      {featured ? (
        <Hero game={featured} />
      ) : (
        // Réserve l'emplacement de la bannière pendant la recherche du
        // screenshot 1080p : sans ça, les sections du dessous se câblent en
        // haut de page (→ animations déclenchées à tort au chargement) puis
        // sont poussées vers le bas quand la bannière s'insère (double saut)
        <div className="relative left-1/2 -mt-8 h-[42vh] w-screen -translate-x-1/2 animate-pulse bg-zinc-200 md:h-[52vh] dark:bg-zinc-900" />
      )}
      {popular.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Populaires en ce moment
          </h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            {visiblePopular.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
          {shownPopular < popular.length && (
            <button
              type="button"
              onClick={() => setShownPopular(shownPopular + POPULAR_STEP)}
              aria-label="Voir plus de jeux populaires"
              title="Voir plus de jeux populaires"
              className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400 hover:opacity-70 dark:border-zinc-700"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </section>
      )}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Critiques populaires
        </h2>
        {highlights.length === 0 ? (
          <p className="text-zinc-500">Aucune critique récente — soyez la première !</p>
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
                Voir plus de critiques
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Hero({ game }: { game: GameSummary }) {
  // Bannière "70mm" : pleine largeur d'écran (elle s'échappe du conteneur
  // centré via le w-screen + translate) et ~70% de la hauteur du viewport
  const banner = screenshot1080(game);
  return (
    <a
      href={gameHref(game.id)}
      data-anim="hero"
      className="relative left-1/2 -mt-8 block w-screen -translate-x-1/2 overflow-hidden"
    >
      {banner ? (
        <img
          data-anim="hero-bg"
          src={banner}
          alt=""
          className="h-[42vh] w-full scale-110 object-cover md:h-[52vh]"
        />
      ) : (
        <div
          data-anim="hero-bg"
          className="absolute inset-0 scale-125 bg-cover bg-center opacity-50 blur-2xl"
          style={game.coverUrl ? { backgroundImage: `url(${game.coverUrl})` } : undefined}
        />
      )}
      <div
        className={
          banner
            ? 'absolute inset-x-0 bottom-0 flex items-end gap-4 bg-gradient-to-t from-zinc-950/90 to-transparent p-6 md:p-10'
            : 'relative flex flex-col items-center gap-4 py-10'
        }
      >
        {game.coverUrl && (
          <img
            src={game.coverUrl}
            alt={game.title}
            className={banner ? 'h-40 rounded-lg shadow-2xl md:h-52' : 'h-80 rounded-xl shadow-2xl'}
          />
        )}
        <div className="flex items-center gap-3 rounded-full bg-zinc-950/70 px-5 py-2 text-zinc-100 backdrop-blur">
          <span className="font-semibold">{game.title}</span>
          {game.score !== undefined && <ScoreBadge score={game.score} />}
        </div>
      </div>
    </a>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  return (
    <a href={gameHref(game.id)} data-anim="cover" className="group">
      {game.coverUrl ? (
        <img
          src={game.coverUrl}
          alt={game.title}
          className="aspect-[3/4] w-full rounded-lg object-cover transition group-hover:scale-105 group-hover:shadow-xl"
        />
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-zinc-200 p-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {game.title}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="truncate text-xs text-zinc-600 dark:text-zinc-400" title={game.title}>
          {game.title}
        </span>
        {game.score !== undefined && <ScoreBadge score={game.score} small />}
      </div>
    </a>
  );
}

function ScoreBadge({ score, small = false }: { score: number; small?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded font-bold text-amber-600 dark:text-amber-300 ${
        small ? 'text-xs' : 'bg-zinc-950/40 px-2 py-0.5 text-sm text-amber-300'
      }`}
    >
      ★ {score.toFixed(1)}
    </span>
  );
}

function ReviewCard({ review }: { review: ReviewHighlight }) {
  const target = review.game
    ? { name: review.game.title, cover: review.game.coverUrl, href: gameHref(review.game.id) }
    : {
        name: review.company?.name ?? '?',
        cover: review.company?.logoUrl ?? null,
        href: review.company ? companyHref(review.company.id) : '/',
      };

  return (
    <a
      href={target.href}
      data-anim="card"
      className="flex flex-col gap-2 rounded-xl border border-zinc-300 bg-white/70 p-4 transition hover:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      <div className="flex items-center gap-3">
        {target.cover && <img src={target.cover} alt="" className="h-14 w-10 rounded object-cover" />}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{target.name}</div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm font-bold text-amber-600 dark:bg-zinc-800 dark:text-amber-300">
              {review.rating}
            </span>
            {review.user ? (
              <span className="flex items-center gap-1.5">
                {review.user.avatarUrl ? (
                  <img src={review.user.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : (
                  <span className="inline-block h-4 w-4 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                )}
                {review.user.username}
              </span>
            ) : (
              <em>[utilisateur supprimé]</em>
            )}
          </div>
        </div>
      </div>
      <div className="text-sm font-semibold">« {review.title} »</div>
      <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{review.text}</p>
      <div className="mt-auto flex items-center gap-3 pt-1 text-xs text-zinc-500">
        <span>👍 {review._count.likes}</span>
        <span>👎 {review._count.dislikes}</span>
        <span>💬 {review._count.comments}</span>
        <span className="ml-auto">{new Date(review.createdAt).toLocaleDateString('fr')}</span>
      </div>
    </a>
  );
}
