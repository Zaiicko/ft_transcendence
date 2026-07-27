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

export default function Game() {
  const { id } = useParams();
  const gameId = Number(id);
  const { t, i18n } = useTranslation();

  // Résultats tagués par id : au changement de jeu, l'ancien contenu est
  // ignoré sans setState synchrone dans l'effet (règle set-state-in-effect).
  // game === null → 404 ; entrée absente/id différent → chargement.
  const [loaded, setLoaded] = useState<{ id: number; game: GameSummary | null } | null>(null);
  // Stats des critiques (moyenne + nombre) affichées dans l'en-tête ; alimentées
  // par ReviewsSection via onStats à chaque création/suppression/temps réel.
  const [stats, setStats] = useState<ReviewStats | null>(null);
  // Bumpé quand on poste un avis : le back marque alors le jeu "fait"
  // automatiquement, ce compteur force PlayedButton à recharger son état.
  const [playedRefresh, setPlayedRefresh] = useState(0);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  // Mémorise le dernier résumé par jeu pour ne faire le fondu QUE sur le
  // remplacement par la traduction (pas à l'affichage initial ni au changement
  // de jeu).
  const summarySeen = useRef<{ id: number; summary: string | null } | null>(null);

  // Résumé traduit du jeu courant (id + texte), séparé du jeu de base pour
  // qu'un changement de langue ne repasse PAS par l'anglais.
  const [translated, setTranslated] = useState<{ id: number; text: string } | null>(null);

  // Barre d'actions collante : le titre du jeu n'y apparaît qu'une fois le hero
  // sorti de l'écran (observé ci-dessous).
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroOut, setHeroOut] = useState(false);

  // Jeu de base (résumé anglais) — rechargé seulement au changement de JEU :
  // l'en-tête, la jaquette, les avis s'affichent tout de suite.
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

  // Traduction du résumé — au changement de jeu OU de langue. Récupérée en
  // arrière-plan (appel DeepL lent au 1er affichage) puis substituée. En anglais
  // (apiLang() === '') → pas de requête, on repasse au résumé de base.
  useEffect(() => {
    let cancelled = false;
    const lang = apiLang();
    if (!lang) return; // anglais : displaySummary retombe sur la base (voir plus bas)
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

  // Le titre de la barre collante apparaît quand le hero quitte le haut de l'écran.
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroOut(!e.isIntersecting), {
      rootMargin: '-140px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [game?.id]);
  // Résumé affiché : en anglais (apiLang() === '') → la base ; sinon la traduction
  // du jeu courant (on garde l'ancienne le temps que la nouvelle langue arrive →
  // pas de clignotement anglais entre deux langues).
  const displaySummary =
    translated?.id === gameId && apiLang() !== '' ? translated.text : (game?.summary ?? null);

  // Effet "décodage" (scramble) quand le résumé AFFICHÉ change (traduction
  // arrivée, ou changement de langue) : décode vers le nouveau texte depuis
  // l'actuel — jamais de retour à l'anglais entre deux langues. Pas au 1er
  // affichage d'un jeu ni au changement de jeu (mémorisé par id). useLayoutEffect
  // : démarre avant le paint (pas de flash du texte final).
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
  // Note affichée dans l'anneau : moyenne joueurs si dispo, sinon note IGDB /10.
  const scoreVal =
    stats && stats._count > 0 && stats._avg.rating != null
      ? stats._avg.rating
      : game.igdbRating != null
        ? game.igdbRating / 10
        : null;
  // Distribution dispo (au moins un avis) → sidebar sticky à droite des critiques.
  const hasDist = !!(stats && stats._count > 0 && stats.distribution);

  // Identité (titre + méta) — `onDark` sur le dégradé du screenshot (texte clair).
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
      {/* Plateformes */}
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

  // Barre d'actions (réutilisée dans le hero et la barre collante).
  const actions = (
    <>
      <PlayedButton gameId={gameId} showCount refreshKey={playedRefresh} />
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
      {/* ---- HERO cinématique : screenshot + halo ambre + jaquette + anneau de note ---- */}
      <div ref={heroRef}>
        {banner ? (
          <div className="relative overflow-hidden rounded-2xl border border-zinc-900/10 shadow-xl dark:border-zinc-100/10">
            <img src={banner} alt="" className="h-[40vh] w-full object-cover md:h-[48vh]" />
            <div className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 bg-gradient-to-t from-zinc-950/95 via-zinc-950/45 to-transparent p-6 md:p-9">
              {game.coverUrl && (
                <img src={game.coverUrl} alt="" className="hidden h-40 w-auto shrink-0 rounded-xl border border-zinc-100/15 shadow-2xl sm:block md:h-52" />
              )}
              <div className="min-w-0 flex-1 pb-1">{identity(true)}</div>
              {scoreVal != null && <ScoreRing score={scoreVal} onDark />}
            </div>
          </div>
        ) : (
          <div className="card flex flex-col gap-6 p-6 sm:flex-row">
            {game.coverUrl && <img src={game.coverUrl} alt="" className="h-72 self-start rounded-xl shadow-xl" />}
            <div className="min-w-0 flex-1">{identity(false)}</div>
            {scoreVal != null && <ScoreRing score={scoreVal} />}
          </div>
        )}
      </div>

      {/* ---- Barre d'actions collante (sous la nav) ----
          Sans cadre : jamais de fond ni de bordure — seulement les boutons (et le
          nom du jeu qui apparaît en fondu une fois le hero sorti). Pas de
          backdrop-blur non plus (il ferait de cette barre le bloc conteneur des
          popups en position:fixed → Fait / Ajouter à une liste décalés). */}
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

      {/* Ce jeu est lui-même un DLC/extension : lien retour vers le jeu de base */}
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
          <p ref={summaryRef} className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {displaySummary}
          </p>
        </section>
      )}

      {/* Extensions & DLC rattachés */}
      {game.dlcs && game.dlcs.length > 0 && <DlcSelector dlcs={game.dlcs} />}

      {/* Critiques (principal) + répartition des notes en sidebar sticky à
          droite (comme la maquette). Sans avis : pas de grille, avis pleine
          largeur. Sur mobile la distribution passe au-dessus des avis. */}
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
        {/* ReviewsSection porte déjà id="review" + scroll-mt (ancre « Critiquer ») */}
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

// Anneau de note (0–10) — moyenne joueurs (ou IGDB en repli). L'accent ambre
// remplit proportionnellement.
function ScoreRing({ score, onDark = false }: { score: number; onDark?: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score / 10, 0), 1);
  return (
    <div className="relative hidden h-24 w-24 shrink-0 sm:block">
      <svg viewBox="0 0 64 64" className="h-24 w-24 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" className={onDark ? 'stroke-zinc-100/20' : 'stroke-zinc-900/10 dark:stroke-zinc-100/15'} />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-accent" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className={`absolute inset-0 flex flex-col items-center justify-center ${onDark ? 'text-zinc-50' : ''}`}>
        <span className="font-display text-2xl font-extrabold tabular-nums leading-none text-accent">{score.toFixed(1)}</span>
        <span className={`text-[10px] font-semibold ${onDark ? 'text-zinc-300' : 'text-zinc-400'}`}>/10</span>
      </div>
    </div>
  );
}

// Carte verticale de répartition des notes (0–10) pour la sidebar : moyenne en
// gros, nombre d'avis, puis l'histogramme 10→0.
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

// Libellé traduit du type de contenu additionnel
function dlcTypeLabel(type: string, t: TFunction): string {
  if (type === 'EXPANSION') return t('game.dlcExpansion');
  if (type === 'STANDALONE') return t('game.dlcStandalone');
  return t('game.dlcGeneric');
}

const dlcYear = (d: GameDlc) => d.releaseDate?.slice(0, 4);

// Petit lien "Noter" → ouvre la fiche du DLC sur le formulaire de critique
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

// Variante A : un menu déroulant pour choisir un DLC, puis un panneau avec le
// toggle "fait" (sur place) et le bouton "Noter" pour le DLC sélectionné.
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
              <PlayedButton gameId={selected.id} />
              <RateLink id={selected.id} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

