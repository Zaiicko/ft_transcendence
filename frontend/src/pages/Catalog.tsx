import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Select from '../components/Select';
import { CoverGridSkeleton } from '../components/Skeleton';
import { StarIcon } from '../components/Stars';
import { apiFetch } from '../lib/api';
import { GameFacets, GameSummary } from '../lib/types';

const PAGE_SIZE = 24;

// Tris exposés à l'utilisateur → valeurs de l'enum GameSort côté back. Les deux
// premiers répondent à la demande « mieux notés / plus faits PAR LES USERS ».
const SORTS = [
  { value: 'rating', label: 'Mieux notés' },
  { value: 'most_played', label: 'Plus joués' },
  { value: 'recent', label: 'Récents' },
  { value: 'popular', label: 'Populaires' },
] as const;

type SortValue = (typeof SORTS)[number]['value'];

interface Page {
  data: GameSummary[];
  total: number;
  page: number;
  limit: number;
}

export default function Catalog() {
  // Filtres (les noms viennent des facettes → toujours ≥ 2 caractères, OK pour
  // la validation back). q est débouncée pour ne pas spammer la recherche.
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<SortValue>('rating');
  const [genre, setGenre] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);

  const [facets, setFacets] = useState<GameFacets | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Le back valide q avec MinLength(2) : on ne l'envoie qu'à partir de 2 lettres
  const query = debouncedQ.trim().length >= 2 ? debouncedQ.trim() : '';

  // Débounce de la recherche
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

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
  // Ajustement d'état AU RENDU (pattern React officiel) plutôt qu'un effet :
  // évite un rendu en cascade et la règle react-hooks/set-state-in-effect.
  const [prevParams, setPrevParams] = useState(params);
  if (params !== prevParams) {
    setPrevParams(params);
    setPage(1);
    setLoading(true);
  }

  // Une requête par (filtres, page). page 1 = remplace la grille (nouveau tri /
  // filtre), page > 1 = empile (« Charger plus »). Un compteur de requête évite
  // qu'une réponse lente d'un filtre précédent n'écrase une plus récente. Les
  // flags de chargement sont posés hors de l'effet (au rendu / au clic).
  const reqId = useRef(0);
  useEffect(() => {
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

  const hasMore = games.length < total;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">Catalogue</h1>
        {!loading && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString('fr')} jeu{total > 1 ? 'x' : ''}
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
            placeholder="Rechercher un jeu…"
            className="field w-full pl-9"
            aria-label="Rechercher un jeu"
          />
        </div>
        <Select
          label="Tri"
          value={sort}
          onChange={(v) => setSort(v as SortValue)}
          options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Select
          label="Plateforme"
          value={platform ?? ''}
          onChange={(v) => setPlatform(v || null)}
          options={[
            { value: '', label: 'Toutes plateformes' },
            ...(facets?.platforms.map((p) => ({ value: p.name, label: p.name })) ?? []),
          ]}
        />
        <Select
          label="Studio"
          value={company ?? ''}
          onChange={(v) => setCompany(v || null)}
          options={[
            { value: '', label: 'Tous studios' },
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
              {g.name}
            </Chip>
          ))}
        </div>
      )}

      {/* Grille */}
      {loading ? (
        <CoverGridSkeleton count={12} />
      ) : games.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Aucun jeu ne correspond à ces filtres.
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
              {loadingMore ? 'Chargement…' : 'Charger plus'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  return (
    <a href={`/game/${game.id}`} className="group">
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
    </a>
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
