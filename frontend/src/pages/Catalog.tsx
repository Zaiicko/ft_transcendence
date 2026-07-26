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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('catalog.title')}</h1>
        {!loading && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {t(total === 1 ? 'lists.gameOne' : 'lists.gameMany', {
              count: total.toLocaleString(i18n.language),
            })}
          </span>
        )}
      </div>

      {/* Barre d'outils : recherche + tri + plateforme + studio */}
      <div className="flex flex-wrap items-center gap-3">
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
        <Select
          label={t('catalog.sortLabel')}
          value={sort}
          onChange={(v) => setSort(v as SortValue)}
          options={SORTS.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
        />
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
        <div className="flex flex-wrap gap-2">
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

      {/* Grille */}
      {loading ? (
        <CoverGridSkeleton count={12} />
      ) : games.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('catalog.noResults')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={() => {
                setLoadingMore(true);
                setPage((p) => p + 1);
              }}
              disabled={loadingMore}
              className="mx-auto mt-2 rounded-lg border border-zinc-400 px-6 py-2 text-sm hover:opacity-70 disabled:opacity-50 dark:border-zinc-700"
            >
              {loadingMore ? t('catalog.loading') : t('catalog.loadMore')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  return (
    <Link to={`/game/${game.id}`} className="group">
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
        {game.score !== undefined && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-amber-500">
            <StarIcon className="h-3 w-3" />
            {game.score.toFixed(1)}
          </span>
        )}
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
