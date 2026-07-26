import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';

const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;
type CompanyHit = { id: number; name: string; logoUrl: string | null };
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export default function SearchBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[]>([]);
  const [companies, setCompanies] = useState<CompanyHit[]>([]);
  const [open, setOpen] = useState(false);
  // searched : une recherche locale a abouti pour la saisie courante — permet
  // de distinguer "pas encore cherché" de "cherché, zéro résultat"
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();

  // Recherche live : débounce 300 ms, plus besoin d'Entrée. Le nettoyage du
  // timer à chaque frappe annule la requête précédente (anti course).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (trimmed.length < MIN_CHARS) {
        setResults([]);
        setCompanies([]);
        setSearched(false);
        return;
      }
      try {
        // Jeux + studios en parallèle ; la recherche studios ne doit pas faire
        // échouer l'ensemble si elle plante (catch → liste vide).
        const [gameRes, companyRes] = await Promise.all([
          apiFetch<{ data: GameSummary[] }>(`/games/search?q=${encodeURIComponent(trimmed)}`),
          apiFetch<{ data: CompanyHit[] }>(
            `/companies/search?q=${encodeURIComponent(trimmed)}`,
          ).catch(() => ({ data: [] as CompanyHit[] })),
        ]);
        if (cancelled) return;
        setResults(gameRes.data.slice(0, 8));
        setCompanies(companyRes.data.slice(0, 5));
        setSearched(true);
        setOpen(true);
      } catch {
        /* réseau : on laisse l'état précédent */
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  // Clic en dehors → referme le menu (sans effacer la saisie)
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  // Import à la demande depuis IGDB quand le catalogue local ne connaît pas
  // le jeu (action explicite — cf. games.service, seuil ON_DEMAND_THRESHOLD)
  async function importFromIgdb() {
    if (!trimmed || importing) return;
    setImporting(true);
    try {
      const { data } = await apiFetch<{ data: GameSummary[] }>(
        `/games/search?q=${encodeURIComponent(trimmed)}&igdb=true`,
      );
      setResults(data.slice(0, 8));
      setSearched(true);
    } catch {
      /* IGDB indisponible : le message "aucun résultat" reste affiché */
    } finally {
      setImporting(false);
    }
  }

  // Entrée → page de résultats complète (le catalogue, piloté par ?q=)
  function submitSearch() {
    if (trimmed.length < MIN_CHARS) return;
    setOpen(false);
    setResults([]);
    setCompanies([]);
    navigate(`/games?q=${encodeURIComponent(trimmed)}`);
    setQuery('');
  }

  function goTo(id: number) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setCompanies([]);
    navigate(gameHref(id));
  }

  function goToCompany(id: number) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setCompanies([]);
    navigate(companyHref(id));
  }

  async function randomGame() {
    // Les ids ne sont pas contigus (imports par machine) : on tire une page
    // de taille 1 au hasard plutôt qu'un id au hasard
    const { total } = await apiFetch<{ total: number }>('/games?limit=1');
    if (!total) return;
    const page = 1 + Math.floor(Math.random() * total);
    const { data } = await apiFetch<{ data: GameSummary[] }>(`/games?page=${page}&limit=1`);
    if (data[0]) navigate(gameHref(data[0].id));
  }

  const disc = useRef<SVGSVGElement>(null);

  // Effet vinyle : un tour sur lui-même à chaque clic, dans un sens aléatoire
  // (GSAP cumule la rotation avec '+=' / '-=' pour repartir de l'angle courant).
  function spinAndPick(img: SVGSVGElement | null) {
    if (img) {
      const dir = Math.random() < 0.5 ? '+=360' : '-=360';
      gsap.to(img, { rotation: dir, duration: 0.7, ease: 'power2.out' });
    }
    void randomGame();
  }

  // Pill fantôme façon TiMN : quasi invisible au repos, bordure ambre au focus
  const field =
    'rounded-full border border-zinc-400/40 bg-zinc-900/5 dark:border-zinc-100/10 dark:bg-zinc-100/5';

  const showMenu = open && trimmed.length >= MIN_CHARS;
  const noResults = searched && results.length === 0 && companies.length === 0;

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'Enter') submitSearch();
          }}
          placeholder={t('catalog.searchNav')}
          className={`${field} w-full min-w-0 flex-1 px-4 py-1.5 text-sm placeholder-zinc-500 focus:border-accent focus:outline-none`}
        />
        <button
          type="button"
          onClick={() => spinAndPick(disc.current)}
          title={t('catalog.randomGame')}
          aria-label={t('catalog.randomGame')}
          className={`${field} flex items-center px-3 transition hover:border-accent`}
        >
          {/* Boîte mystère filaire (style TiMN, trait 1.6) : cube isométrique
              avec un « ? » sur chacune des trois faces visibles. La couleur
              suit currentColor (héritée du bouton), l'animation de rotation
              GSAP s'applique au <svg> comme avant sur l'image. */}
          <svg
            ref={disc}
            viewBox="0 0 24 24"
            className="h-6 w-6 shrink-0 fill-none stroke-current"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <path d="M3.3 7 12 12l8.7-5" />
            <path d="M12 22V12" />
            <g
              className="fill-current"
              stroke="none"
              fontSize="7"
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {/* Un « ? » centré sur chacune des trois faces (haut, gauche, droite) */}
              <text x="12" y="7">?</text>
              <text x="7.6" y="14.7">?</text>
              <text x="16.4" y="14.7">?</text>
            </g>
          </svg>
        </button>
      </div>

      {showMenu && (results.length > 0 || searched || importing) && (
        <div className="animate-dropdown absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.length > 0 && (
            <ul>
              {results.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => goTo(g.id)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {g.coverUrl ? (
                      <img src={g.coverUrl} alt="" className="h-10 w-7 rounded object-cover" />
                    ) : (
                      <span className="h-10 w-7 rounded bg-zinc-200 dark:bg-zinc-800" />
                    )}
                    <span className="truncate text-sm">{g.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Studios trouvés → lien vers leur fiche */}
          {companies.length > 0 && (
            <ul className={results.length > 0 ? 'border-t border-zinc-200 dark:border-zinc-800' : ''}>
              <li className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                {t('catalog.studios')}
              </li>
              {companies.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => goToCompany(c.id)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {c.logoUrl ? (
                      <img
                        src={c.logoUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded bg-white object-contain p-1 ring-1 ring-black/5"
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {c.name.charAt(0)}
                      </span>
                    )}
                    <span className="truncate text-sm">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Aucun jeu connu → import IGDB (comme prévu avec la game db) */}
          {noResults && !importing && (
            <div className="px-4 py-3 text-sm">
              <p className="text-zinc-500 dark:text-zinc-400">
                {t('catalog.noneInCatalog', { query: trimmed })}
              </p>
              <button
                type="button"
                onClick={importFromIgdb}
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110"
              >
                {/* Plus filaire (trait 1.6) */}
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-none stroke-current"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('catalog.importIgdb')}
              </button>
            </div>
          )}

          {importing && (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-accent" />
              {t('catalog.importing')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
