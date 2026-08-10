import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { TFunction } from 'i18next';
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import AchievementIcon from '../components/AchievementIcon';
import Avatar from '../components/Avatar';
import EmptyState, { PencilIcon } from '../components/EmptyState';
import HomeActivity from '../components/HomeActivity';
import PlayedButton from '../components/PlayedButton';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from '../components/ReactionIcons';
import { CoverGridSkeleton } from '../components/Skeleton';
import Stars, { StarIcon } from '../components/Stars';
import { FAMILY_NAME_KEY } from '../lib/achievements';
import { apiFetch } from '../lib/api';
import { translateGenre } from '../lib/genres';
import { imageSize } from '../lib/theme';
import {
  AchievementFamily,
  GameSummary,
  HomeLanding,
  HomeStats,
  LandingTopPlayer,
  ReviewHighlight,
} from '../lib/types';

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
  const [landing, setLanding] = useState<HomeLanding | null>(null);
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
      apiFetch<{ data: GameSummary[] }>('/games?sort=most_played&limit=50&excludeCompleted=true'),
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

  // Données publiques de la home (chiffres du site + n°1 par catégorie), via un
  // seul appel public /home/landing. Chargées pour TOUS : elles alimentent les
  // modules d'accroche anonymes ET le podium « top joueurs » du hub connecté.
  useEffect(() => {
    let cancelled = false;
    apiFetch<HomeLanding>('/home/landing')
      .then((d) => {
        if (!cancelled) setLanding(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

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
      {/* Visiteur anonyme : bloc d'accueil brandé (proposition de valeur + CTA)
          au-dessus du contenu, qui devient alors un aperçu vivant du site. */}
      {!user && <Landing />}

      {/* Chiffres réels du site (preuve que ça vit) */}
      {!user && landing && <LandingStats data={landing} />}

      {!user ? (
        // Anonyme : aperçu « Tendance » en pleine largeur. La liste des features
        // (jugée redondante avec les piliers du module d'accroche + trop lourde)
        // est remplacée par un ticker défilant dans <Landing />.
        <div>
          <SectionHead
            eyebrow={t('home.landing.previewEyebrow')}
            title={t('home.landing.previewTitle')}
          />
          {featured ? (
            <Hero game={featured} />
          ) : (
            <div className="h-[46vh] max-h-[66vw] animate-pulse rounded-3xl bg-zinc-200 md:h-[56vh] dark:bg-zinc-900" />
          )}
        </div>
      ) : (
        <div>
          {featured ? (
            <Hero game={featured} />
          ) : (
            // Réserve l'emplacement de la carte hero pendant la recherche du
            // screenshot 1080p : sans ça, les sections du dessous se câblent en
            // haut de page (→ animations déclenchées à tort au chargement) puis
            // sont poussées vers le bas quand la carte s'insère (double saut)
            <div className="h-[46vh] max-h-[66vw] animate-pulse rounded-3xl bg-zinc-200 md:h-[56vh] dark:bg-zinc-900" />
          )}
        </div>
      )}

      {user && stats && <StatsBand stats={stats} />}

      {/* Hub connecté : le n°1 de chaque catégorie de classement (comme sur la
          home anonyme). */}
      {user && landing && <TopPlayers rows={landing.topPlayers} />}

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
              user ? (
                // Connecté : 4 colonnes dans la colonne rétrécie par l'activité
                // des amis, avec le bouton « voir plus » qui déroule la suite.
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 3xl:grid-cols-6 4xl:grid-cols-8">
                  {visiblePopular.map((g) => (
                    <GameCard key={g.id} game={g} />
                  ))}
                </div>
              ) : (
                // Anonyme : une seule ligne, adaptée à l'écran (3 jaquettes sur
                // mobile, 6 sur desktop). Les jaquettes au-delà de la 3ᵉ sont
                // masquées tant qu'on est en 3 colonnes → jamais de 2ᵉ rangée.
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 3xl:grid-cols-8">
                  {popular.slice(0, 8).map((g, i) => (
                    <div
                      key={g.id}
                      className={i >= 6 ? 'hidden 3xl:block' : i >= 3 ? 'hidden sm:block' : undefined}
                    >
                      <GameCard game={g} />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <CoverGridSkeleton count={user ? 8 : 6} />
            )}
            {user && (
              <GridExpander
                shown={shownPopular}
                step={POPULAR_STEP}
                total={popular.length}
                onChange={setShownPopular}
                moreLabel={t('home.showMorePopular')}
                lessLabel={t('home.showLessPopular')}
              />
            )}
          </div>
          {user && (
            <aside>
              <SectionHead
                eyebrow={t('home.activityEyebrow')}
                title={t('home.activityTitle')}
                dotClass="text-emerald-500"
              />
              <HomeActivity />
            </aside>
          )}
        </div>
      </section>

      {/* Modules d'accroche visiteur : podium global, vitrine des succès,
          plateformes supportées. */}
      {!user && landing && <TopPlayers rows={landing.topPlayers} />}
      {!user && <AchievementsShowcase />}
      {!user && <Platforms />}

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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleHighlights.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
            <GridExpander
              shown={shown}
              step={HIGHLIGHTS_STEP}
              total={highlights.length}
              onChange={setShown}
              moreLabel={t('home.showMoreReviews')}
              lessLabel={t('home.showLessReviews')}
            />
          </>
        )}
      </section>
    </div>
  );
}

// Accueil du visiteur anonyme : proposition de valeur brandée + CTA (créer un
// compte / se connecter) + trois cartes de fonctionnalités. Objectif : donner
// tout de suite envie de tester le site, avant l'aperçu du catalogue.
function Landing() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden rounded-3xl border border-zinc-900/10 bg-zinc-900/[0.02] px-5 py-8 text-center sm:px-8 sm:py-10 dark:border-zinc-100/10 dark:bg-zinc-100/[0.02]">
      {/* Halos ambiants ambre signature */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 -top-24 h-72 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-accent/20 blur-[90px]" />
        <div className="absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-accent/10 blur-[90px]" />
      </div>

      {/* Marque Saveboxd (même signe que l'écran de connexion) */}
      <div className="mb-4 inline-flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-accent text-zinc-950 shadow-lg shadow-accent/40">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M4 7l2-3h12l2 3M9 12h6" />
          </svg>
        </span>
        <span className="font-display text-lg font-bold tracking-tight">
          <span className="text-accent">Save</span>boxd
        </span>
      </div>

      <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        <span className="text-accent">✦</span> {t('home.landing.eyebrow')}
      </div>

      <h1 className="font-display mx-auto max-w-xl text-balance text-2xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
        {t('home.landing.title')}
      </h1>

      <p className="mx-auto mt-3 max-w-lg text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        {t('home.landing.subtitle')}
      </p>

      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="/signup"
          className="w-full rounded-full bg-accent px-6 py-2.5 text-center text-sm font-semibold text-zinc-950 shadow-lg shadow-accent/30 transition hover:brightness-110 sm:w-auto"
        >
          {t('home.landing.ctaPrimary')}
        </a>
        <a
          href="/login"
          className="w-full rounded-full border border-zinc-400/60 px-6 py-2.5 text-center text-sm font-semibold text-zinc-700 transition hover:border-accent hover:text-accent sm:w-auto dark:border-zinc-600 dark:text-zinc-200"
        >
          {t('home.landing.ctaSecondary')}
        </a>
      </div>

      {/* Ticker : fait défiler toutes les fonctionnalités, une à une */}
      <RotatingFeatures />

      {/* Trois piliers du produit */}
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        <LandingFeature
          title={t('home.landing.feature1Title')}
          desc={t('home.landing.feature1Desc')}
          icon={
            <>
              <path d="M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7" />
              <path d="M12 3v12M12 15l-3-3M12 15l3-3" />
            </>
          }
        />
        <LandingFeature
          title={t('home.landing.feature2Title')}
          desc={t('home.landing.feature2Desc')}
          icon={<path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.7l1-5.8L3.5 9.8l5.9-.9L12 3z" />}
        />
        <LandingFeature
          title={t('home.landing.feature3Title')}
          desc={t('home.landing.feature3Desc')}
          icon={
            <>
              <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
              <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
            </>
          }
        />
      </div>
    </section>
  );
}

function LandingFeature({ title, desc, icon }: { title: string; desc: string; icon: ReactNode }) {
  return (
    <div className="card !rounded-2xl p-4 text-left">
      <span className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
      </span>
      <div className="font-display text-sm font-bold tracking-tight">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{desc}</p>
    </div>
  );
}

// Ticker d'accroche : fait défiler une à une TOUTES les fonctionnalités du site.
// Remplace l'ancienne liste cochée (jugée redondante avec les 3 piliers et trop
// lourde) → on garde l'idée « voilà tout ce que ça fait » en une seule ligne
// légère. Fondu+slide à chaque changement ; figé si l'utilisateur a demandé moins
// d'animations (le cycle ne démarre pas). La liste complète reste dans le DOM
// (sr-only) pour les lecteurs d'écran et le référencement.
function RotatingFeatures() {
  const { t } = useTranslation();
  // On n'affiche que les fonctionnalités PAS déjà mises en avant dans les 3
  // piliers juste en dessous : on saute feat2 (note/critique/réactions), feat4
  // (sync), feat6 (succès) et feat7 (classement) → il reste catalogue, listes,
  // amis/chat, suivi de progression et recommandations perso (feat9).
  const feats = useMemo(() => [1, 3, 5, 8, 9].map((n) => t(`home.landing.feat${n}`)), [t]);
  const [i, setI] = useState(0);
  const iRef = useRef(0);
  // Crossfade qui se CHEVAUCHE : à chaque tick, la nouvelle phrase entre (depuis
  // le bas) pendant que l'ancienne — gardée dans `leaving` et posée en overlay
  // absolu — sort (vers le haut) EN MÊME TEMPS. Aucun instant vide → transition
  // continue et douce. La phrase courante reste en flux → hauteur auto (gère le
  // retour à la ligne sur mobile, contrairement à un roll à hauteur fixe).
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      setLeaving(feats[iRef.current]);
      iRef.current = (iRef.current + 1) % feats.length;
      setI(iRef.current);
    }, 3200);
    return () => window.clearInterval(id);
  }, [feats]);

  const line = 'flex items-center justify-center gap-2 font-medium text-zinc-700 dark:text-zinc-200';
  return (
    <div className="relative mt-6 flex justify-center text-sm" aria-hidden="true">
      {/* Phrase courante (en flux → donne la hauteur), rejouée à chaque changement */}
      <span key={i} className={`feat-enter ${line}`}>
        <span className="text-accent">✦</span>
        {feats[i]}
      </span>
      {/* Phrase sortante, en overlay au-dessus, qui se fond simultanément */}
      {leaving !== null && (
        <span
          key={`leave-${i}`}
          onAnimationEnd={() => setLeaving(null)}
          className={`feat-leave absolute inset-0 ${line}`}
        >
          <span className="text-accent">✦</span>
          {leaving}
        </span>
      )}
      <span className="sr-only">{feats.join(' · ')}</span>
    </div>
  );
}

// #1 — Bande de chiffres réels du site (catalogue, critiques, joueurs). Preuve
// sociale immédiate pour le visiteur : le site a déjà du contenu et une commu.
function LandingStats({ data }: { data: HomeLanding }) {
  const { t } = useTranslation();
  const fmt = (n: number) => n.toLocaleString();
  const items = [
    { value: data.games, label: t('home.landing.statsGamesLabel') },
    { value: data.reviews, label: t('home.landing.statsReviewsLabel') },
    { value: data.players, label: t('home.landing.statsPlayersLabel') },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {items.map((it) => (
        <div key={it.label} className="card !rounded-2xl p-4 text-center sm:p-5">
          <div className="font-display text-3xl font-extrabold tabular-nums tracking-tight text-accent sm:text-4xl">
            {fmt(it.value)}
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// #2 — Le n°1 de CHAQUE catégorie de classement (complétions / jeux faits /
// avis), all-time global. Chaque carte renvoie au profil public. Masqué s'il n'y
// a encore personne de classé dans aucune catégorie.
const METRIC_LABEL: Record<LandingTopPlayer['metric'], string> = {
  completions: 'leaderboard.metricCompletions',
  played: 'leaderboard.metricPlayed',
  reviews: 'leaderboard.metricReviews',
};
function TopPlayers({ rows }: { rows: LandingTopPlayer[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionHead eyebrow={t('home.landing.topEyebrow')} title={t('home.landing.topTitle')} />
      <div className="grid gap-4 sm:grid-cols-3">
        {rows.map((r) => (
          <a
            key={r.metric}
            href={`/u/${r.user.username}`}
            className="card flex flex-col gap-3 !rounded-2xl p-4 transition hover:border-accent/60"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
                {t(METRIC_LABEL[r.metric])}
              </span>
              <span className="font-display text-xl font-extrabold tabular-nums text-accent">
                {r.score}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={40} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.user.username}</div>
                <div className="text-xs font-bold text-zinc-400 dark:text-zinc-500">#1</div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

// #6 — Vitrine des succès « maison » : huit familles de badges avec leurs icônes
// thématiques (mêmes SVG que le profil), pour montrer la gamification.
function AchievementsShowcase() {
  const { t } = useTranslation();
  const families: AchievementFamily[] = [
    'completions',
    'perfect',
    'reviews',
    'lists',
    'friends',
    'genres',
    'popular',
    'veteran',
  ];
  return (
    <section>
      <SectionHead eyebrow={t('home.landing.achEyebrow')} title={t('home.landing.achTitle')} />
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        {t('home.landing.achSubtitle')}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {families.map((f) => (
          <div key={f} className="card flex items-center gap-3 !rounded-2xl p-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <AchievementIcon family={f} className="h-5 w-5" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold">{t(FAMILY_NAME_KEY[f])}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// #5 — Plateformes supportées : Steam / PlayStation / Xbox. Renforce la promesse
// de synchronisation (jeux + trophées) avec des repères connus.
function Platforms() {
  const { t } = useTranslation();
  const names = ['Steam', 'PlayStation', 'Xbox'];
  return (
    <section className="card relative overflow-hidden !rounded-3xl p-6 text-center sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        <span className="text-accent">●</span> {t('home.landing.platformsEyebrow')}
      </div>
      <h2 className="font-display mt-1.5 text-2xl font-bold tracking-tight">
        {t('home.landing.platformsTitle')}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
        {t('home.landing.platformsSubtitle')}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {names.map((name) => (
          <div
            key={name}
            className="flex items-center gap-2.5 rounded-full border border-zinc-900/10 bg-zinc-900/[0.03] px-5 py-2.5 dark:border-zinc-100/10 dark:bg-zinc-100/[0.05]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-accent" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="6" width="20" height="12" rx="6" />
              <path d="M7 12h3M8.5 10.5v3" />
              <circle cx="15.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
              <circle cx="17.5" cy="13" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            <span className="font-display text-sm font-bold">{name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// En-tête de section : petit "eyebrow" ambre au-dessus d'un titre display, pour
// donner de la hiérarchie (au lieu du même minuscule label gris partout).
function SectionHead({
  eyebrow,
  title,
  dotClass = 'text-accent',
}: {
  eyebrow: string;
  title: string;
  dotClass?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        <span className={dotClass}>●</span> {eyebrow}
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

function Hero({ game, compact = false }: { game: GameSummary; compact?: boolean }) {
  // Hero "cinéma" : grande carte arrondie, halo ambre, dégradé profond et
  // jaquette officielle posée dessus. Toute la carte renvoie à la fiche.
  // `compact` (colonne moitié d'écran de l'accueil anonyme) : la carte remplit
  // la hauteur de sa colonne au lieu d'imposer 46/56vh, et le titre est réduit.
  const { t } = useTranslation();
  const { user } = useAuth();
  const banner = screenshot1080(game);
  return (
    <div data-anim="hero" className={`relative ${compact ? 'h-full' : ''}`}>
      <a
        href={gameHref(game.id)}
        aria-label={t('home.viewGame', { title: game.title })}
        className={`group relative block overflow-hidden rounded-3xl border border-zinc-900/10 shadow-2xl shadow-black/30 dark:border-zinc-100/10 ${compact ? 'h-full' : ''}`}
      >
        {banner ? (
          <img
            data-anim="hero-bg"
            src={banner}
            alt=""
            className={
              compact
                ? 'h-full min-h-[36vh] w-full scale-110 object-cover'
                : 'h-[46vh] max-h-[66vw] w-full scale-110 object-cover md:h-[56vh]'
            }
          />
        ) : (
          <div
            data-anim="hero-bg"
            className={
              compact
                ? 'h-full min-h-[36vh] scale-125 bg-cover bg-center opacity-60 blur-2xl'
                : 'h-[46vh] max-h-[66vw] scale-125 bg-cover bg-center opacity-60 blur-2xl md:h-[56vh]'
            }
            style={game.coverUrl ? { backgroundImage: `url(${game.coverUrl})` } : undefined}
          />
        )}
        {/* Halo ambre signature en haut à droite */}
        <div className="pointer-events-none absolute -right-24 -top-40 h-[32rem] w-[32rem] rounded-full bg-accent/25 blur-3xl" />
        {/* Badge "à la une" */}
        <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-zinc-100/20 bg-zinc-950/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-100 backdrop-blur">
          <span className="text-accent">✦</span> {t('home.featuredBadge')}
        </span>
        <div className={`absolute inset-x-0 bottom-0 flex items-end gap-5 bg-gradient-to-t from-zinc-950/95 via-zinc-950/45 to-transparent ${compact ? 'p-5 md:p-6' : 'p-6 md:p-10'}`}>
          {game.coverUrl && (
            <img
              src={game.coverUrl}
              alt=""
              className={`hidden w-auto shrink-0 rounded-xl border border-zinc-100/15 shadow-2xl sm:block ${compact ? 'h-28 md:h-32' : 'h-40 md:h-56'}`}
            />
          )}
          <div className="min-w-0 pb-1">
            <h1 className={`font-display max-w-2xl text-balance font-extrabold leading-[0.98] tracking-tight text-zinc-50 ${compact ? 'text-2xl md:text-3xl' : 'text-3xl md:text-5xl'}`}>
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
          <PlayedButton gameId={game.id} releaseDate={game.releaseDate} onDark />
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
      {/* Raison de la reco (« parce que tu as aimé X ») — présent uniquement sur
          les cartes de la rangée « Recommandés ». */}
      {game.reason && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-zinc-400 dark:text-zinc-500">
          <span className="text-accent">✦</span>{' '}
          {game.reason.kind === 'game'
            ? t(
                game.reason.game.kind === 'played'
                  ? 'home.recoBecausePlayed'
                  : 'home.recoBecauseGame',
                { title: game.reason.game.title },
              )
            : game.reason.kind === 'studio'
              ? t('home.recoBecauseStudio', { studio: game.reason.studio.name })
              : t('home.recoBecauseGenre', {
                  genre: translateGenre(game.reason.genre.name, t),
                })}
        </div>
      )}
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
      className="card flex min-w-0 flex-col gap-2.5 p-4 transition hover:-translate-y-1 hover:border-zinc-400 dark:hover:border-zinc-600"
    >
      <div className="flex items-center gap-2.5">
        {target.cover && (
          <img
            src={target.cover}
            alt=""
            className={
              target.isCompany
                ? 'h-14 w-10 shrink-0 rounded-lg bg-white object-contain p-0.5'
                : 'h-14 w-10 shrink-0 rounded-lg object-cover'
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
        <div className="font-display shrink-0 text-2xl font-extrabold tabular-nums leading-none text-accent">
          {review.rating}
          <span className="text-sm font-bold text-zinc-400">/10</span>
        </div>
      </div>
      <div className="text-sm font-semibold">« {review.title} »</div>
      <p className="line-clamp-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{review.text}</p>
      <div className="mt-auto flex items-center gap-3 border-t border-zinc-900/5 pt-2.5 text-xs text-zinc-500 dark:border-zinc-100/5">
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
