import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import Select from '../components/Select';
import { CoverGridSkeleton } from '../components/Skeleton';
import { StarIcon } from '../components/Stars';
import { apiFetch } from '../lib/api';
import { translateGenre } from '../lib/genres';
import { GameFacets, GameSummary } from '../lib/types';

const PAGE_SIZE = 24;

// Tris exposés à l'utilisateur → valeurs de l'enum GameSort côté back. Les deux
// premiers répondent à la demande « mieux notés / plus faits PAR LES USERS ».
const SORTS = [
  { value: 'rating', labelKey: 'catalog.sortRating' },
  { value: 'most_played', labelKey: 'catalog.sortMostPlayed' },
  { value: 'recent', labelKey: 'catalog.sortRecent' },
  { value: 'popular', labelKey: 'catalog.sortPopular' },
] as const;

type SortValue = (typeof SORTS)[number]['value'];

interface Page {
  data: GameSummary[];
  total: number;
  page: number;
  limit: number;
}

// Snapshot du catalogue mémorisé le temps de la session SPA (perdu au vrai
// reload navigateur). Permet de revenir EXACTEMENT où on était après avoir
// ouvert une fiche jeu : filtres, jeux empilés par « charger plus », scroll.
// La clé de validité est q : elle est reflétée dans l'URL (?q=), donc au retour
// navigateur l'URL et le cache concordent → réhydratation.
interface CatalogSnapshot {
  q: string;
  sort: SortValue;
  genre: string | null;
  platform: string | null;
  company: string | null;
  games: GameSummary[];
  total: number;
  page: number;
  scrollY: number;
}
let catalogCache: CatalogSnapshot | null = null;

export default function Catalog() {
  const { t, i18n } = useTranslation();
  // useSearchParams : lecture/écriture des query params de l'URL (comme un
  // useState synchronisé avec la barre d'adresse).
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';

  // Réhydratation : seulement si le cache existe ET porte le même q que l'URL
  // (sinon = nouvelle recherche volontaire depuis le header → départ à neuf).
  const restore = catalogCache && catalogCache.q === urlQ ? catalogCache : null;
  const restoreScroll = useRef(restore ? restore.scrollY : null);

  const [q, setQ] = useState(restore ? restore.q : urlQ);
  const [debouncedQ, setDebouncedQ] = useState(restore ? restore.q : urlQ);
  const [sort, setSort] = useState<SortValue>(restore ? restore.sort : 'rating');
  const [genre, setGenre] = useState<string | null>(restore ? restore.genre : null);
  const [platform, setPlatform] = useState<string | null>(restore ? restore.platform : null);
  const [company, setCompany] = useState<string | null>(restore ? restore.company : null);

  const [facets, setFacets] = useState<GameFacets | null>(null);
  const [games, setGames] = useState<GameSummary[]>(restore ? restore.games : []);
  const [total, setTotal] = useState(restore ? restore.total : 0);
  const [page, setPage] = useState(restore ? restore.page : 1);
  const [loading, setLoading] = useState(restore ? false : true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Le back valide q avec MinLength(2) : on ne l'envoie qu'à partir de 2 lettres
  const query = debouncedQ.trim().length >= 2 ? debouncedQ.trim() : '';

  // Recherche externe (header/retour navigateur) → état local. Ajustement AU
  // RENDU plutôt qu'un effet (évite un rendu en cascade + set-state-in-effect).
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setQ(urlQ);
    setDebouncedQ(urlQ);
  }

  // Débounce de la saisie locale
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  // Reflet de la recherche dans l'URL (replace = pas de spam d'historique) pour
  // aligner l'URL et le cache (clé = q).
  useEffect(() => {
    if (debouncedQ === (searchParams.get('q') ?? '')) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedQ) next.set('q', debouncedQ);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [debouncedQ, searchParams, setSearchParams]);

  // Restauration du scroll après réhydratation : les jeux sont déjà rendus
  // (état initial depuis le cache) donc la hauteur est correcte. useLayoutEffect
  // = avant la peinture, pour éviter tout saut visible.
  useLayoutEffect(() => {
    if (restoreScroll.current != null) window.scrollTo(0, restoreScroll.current);
  }, []);

  // Facettes chargées une fois
  useEffect(() => {
    apiFetch<GameFacets>('/games/facets')
      .then(setFacets)
      .catch(() => setFacets({ genres: [], platforms: [], companies: [] }));
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set('sort', sort);
    p.set('limit', String(PAGE_SIZE));
    if (query) p.set('q', query);
    if (genre) p.set('genre', genre);
    if (platform) p.set('platform', platform);
    if (company) p.set('company', company);
    return p.toString();
  }, [sort, query, genre, platform, company]);

  // Tout changement de filtre repart de la page 1 et réaffiche le squelette.
  const [prevParams, setPrevParams] = useState(params);
  if (params !== prevParams) {
    setPrevParams(params);
    setPage(1);
    setLoading(true);
  }

  // Une requête par couple (filtres, page). page 1 = remplace la grille, page >
  // 1 = empile (« Charger plus »). lastKey = dernier couple déjà chargé : évite
  // (1) de re-fetch les jeux empilés restaurés au remontage, (2) le double appel
  // du double-montage StrictMode qui, en page > 1, empilerait des doublons.
  const lastKey = useRef(restore ? `${params}::${page}` : '');
  const reqId = useRef(0);
  useEffect(() => {
    const key = `${params}::${page}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const id = ++reqId.current;
    apiFetch<Page>(`/games?${params}&page=${page}`)
      .then((res) => {
        if (id !== reqId.current) return;
        setTotal(res.total);
        setGames((prev) => (page === 1 ? res.data : [...prev, ...res.data]));
      })
      .catch(() => {
        if (id !== reqId.current) return;
        if (page === 1) setGames([]);
      })
      .finally(() => {
        if (id !== reqId.current) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }, [params, page]);

  // Sauvegarde continue du snapshot (relu au remontage). scrollY est mis à jour
  // en direct par le listener ci-dessous ; ici on rafraîchit les données.
  useEffect(() => {
    catalogCache = {
      q: debouncedQ,
      sort,
      genre,
      platform,
      company,
      games,
      total,
      page,
      scrollY: catalogCache ? catalogCache.scrollY : 0,
    };
  }, [debouncedQ, sort, genre, platform, company, games, total, page]);

  // Position de scroll mémorisée en direct (le scroll ne re-rend pas le composant)
  useEffect(() => {
    const onScroll = () => {
      if (catalogCache) catalogCache.scrollY = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const hasMore = games.length < total;

  // Filtres actifs (pastilles retirables) — libellé + action de retrait.
  const activePills: { key: string; label: string; clear: () => void }[] = [];
  if (genre) activePills.push({ key: 'genre', label: translateGenre(genre, t), clear: () => setGenre(null) });
  if (platform) activePills.push({ key: 'platform', label: platform, clear: () => setPlatform(null) });
  if (company) activePills.push({ key: 'company', label: company, clear: () => setCompany(null) });

  return (
    <div className="flex flex-col gap-6">
      {/* ---- En-tête immersif : eyebrow brandé + titre + recherche + tri + filtres ---- */}
      <header className="relative rounded-3xl border border-zinc-900/10 bg-white p-6 shadow-sm dark:border-zinc-100/10 dark:bg-zinc-900 sm:p-8">
        {/* Halo clippé à la carte via un conteneur dédié : la carte elle-même n'a
            pas d'overflow-hidden, sinon les menus déroulants (plateforme/studio)
            seraient rognés par ses bords. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -left-12 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                <span className="text-accent">●</span> {t('catalog.eyebrow')}
              </div>
              <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
                {t('catalog.title')}
              </h1>
              <p className="mt-2 max-w-lg text-sm text-zinc-500 dark:text-zinc-400">
                {t('catalog.subtitle')}
              </p>
            </div>
            {!loading && (
              <div className="shrink-0 text-right">
                <div className="font-display text-3xl font-extrabold tabular-nums leading-none text-accent">
                  {total.toLocaleString(i18n.language)}
                </div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {t('catalog.unit')}
                </div>
              </div>
            )}
          </div>

          {/* Barre d'outils : recherche + tri (segmenté) + plateforme + studio */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-52 flex-1">
              <SearchIcon />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('catalog.searchPlaceholder')}
                className="field w-full pl-9"
                aria-label={t('catalog.searchAria')}
              />
            </div>
            <SortTabs value={sort} onChange={setSort} />
            <Select
              label={t('catalog.platformLabel')}
              value={platform ?? ''}
              onChange={(v) => setPlatform(v || null)}
              options={[
                { value: '', label: t('catalog.allPlatforms') },
                ...(facets?.platforms.map((p) => ({ value: p.name, label: p.name })) ?? []),
              ]}
            />
            <Select
              label={t('catalog.studioLabel')}
              value={company ?? ''}
              onChange={(v) => setCompany(v || null)}
              options={[
                { value: '', label: t('catalog.allStudios') },
                ...(facets?.companies.map((c) => ({ value: c.name, label: c.name })) ?? []),
              ]}
            />
          </div>

          {/* Puces de genres */}
          {facets && facets.genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {facets.genres.map((g) => (
                <Chip
                  key={g.id}
                  active={genre === g.name}
                  onClick={() => setGenre((cur) => (cur === g.name ? null : g.name))}
                >
                  {translateGenre(g.name, t)}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Filtres actifs : pastilles retirables + tout effacer */}
      {activePills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            {t('catalog.activeFilters')}
          </span>
          {activePills.map((p) => (
            <span
              key={p.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200"
            >
              {p.label}
              <button
                type="button"
                onClick={p.clear}
                aria-label={t('catalog.removeFilter', { name: p.label })}
                className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 transition hover:bg-accent/25 hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              setGenre(null);
              setPlatform(null);
              setCompany(null);
            }}
            className="text-xs text-zinc-500 underline underline-offset-2 transition hover:text-accent dark:text-zinc-400"
          >
            {t('catalog.clearAll')}
          </button>
        </div>
      )}

      {/* Grille */}
      {loading ? (
        <CoverGridSkeleton
          count={16}
          cols="sm:grid-cols-5 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-[repeat(16,minmax(0,1fr))]"
        />
      ) : games.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('catalog.noResults')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-[repeat(16,minmax(0,1fr))]">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
          {(hasMore || games.length > PAGE_SIZE) && (
            <div className="mt-2 flex items-center justify-center gap-3">
              {/* Flèche haut : replie au premier palier (sans re-fetch) */}
              {games.length > PAGE_SIZE && (
                <button
                  type="button"
                  onClick={() => {
                    // Fige la clé de la page courante pour que l'effet ne
                    // recharge pas au retour à la page 1.
                    lastKey.current = `${params}::1`;
                    setGames((g) => g.slice(0, PAGE_SIZE));
                    setPage(1);
                  }}
                  aria-label={t('catalog.showLess')}
                  title={t('catalog.showLess')}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400 hover:opacity-70 dark:border-zinc-700"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
                    <path d="m6 15 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {/* Flèche bas : charge la page suivante */}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => {
                    setLoadingMore(true);
                    setPage((p) => p + 1);
                  }}
                  disabled={loadingMore}
                  aria-label={t('catalog.loadMore')}
                  title={t('catalog.loadMore')}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400 hover:opacity-70 disabled:opacity-50 dark:border-zinc-700"
                >
                  <svg viewBox="0 0 24 24" className={`h-5 w-5 fill-none stroke-current stroke-2 ${loadingMore ? 'animate-pulse' : ''}`}>
                    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Tri en segmenté (pastilles) — remplace le select, plus lisible et brandé.
function SortTabs({ value, onChange }: { value: SortValue; onChange: (v: SortValue) => void }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-zinc-300 bg-zinc-100/70 p-1 dark:border-zinc-700 dark:bg-zinc-800/60">
      {SORTS.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            value === s.value
              ? 'bg-accent text-zinc-950 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          {t(s.labelKey)}
        </button>
      ))}
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  const { t } = useTranslation();
  const genre = game.genres?.[0];
  const platform = game.platforms?.[0];
  return (
    <Link to={`/game/${game.id}`} className="group">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-zinc-200 shadow-sm transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl dark:bg-zinc-800">
        {game.coverUrl ? (
          <img src={game.coverUrl} alt={game.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-600 dark:text-zinc-400">
            {game.title}
          </div>
        )}
        {/* Badge score posé sur la jaquette */}
        {game.score !== undefined && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-zinc-950/70 px-2 py-0.5 text-xs font-bold text-white backdrop-blur">
            <StarIcon className="h-3 w-3 text-accent" />
            {game.score.toFixed(1)}
          </span>
        )}
        {/* Overlay au survol : genre/plateforme + appel à l'action */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-zinc-950/90 via-zinc-950/25 to-transparent p-3 opacity-0 transition duration-200 group-hover:opacity-100">
          {(genre || platform) && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 text-[10px] text-zinc-100">
              {genre && <span className="rounded bg-white/15 px-1.5 py-0.5">{translateGenre(genre.name, t)}</span>}
              {platform && <span className="rounded bg-white/15 px-1.5 py-0.5">{platform.name}</span>}
            </div>
          )}
          <span className="flex items-center gap-1 text-xs font-semibold text-white">
            {t('catalog.viewGame')}
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
      <div className="mt-1.5">
        <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400" title={game.title}>
          {game.title}
        </span>
      </div>
    </Link>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-accent px-3 py-1 text-xs font-medium text-zinc-950'
          : 'rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent hover:text-accent dark:border-zinc-700 dark:text-zinc-400'
      }
    >
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-zinc-400"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
