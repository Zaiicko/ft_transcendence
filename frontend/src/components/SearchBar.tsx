import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';

const gameHref = (id: number) => `/game/${id}`;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export default function SearchBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[]>([]);
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
        setSearched(false);
        return;
      }
      try {
        const { data } = await apiFetch<{ data: GameSummary[] }>(
          `/games/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (cancelled) return;
        setResults(data.slice(0, 8));
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

  function goTo(id: number) {
    setOpen(false);
    setQuery('');
    setResults([]);
    navigate(gameHref(id));
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

  const disc = useRef<HTMLImageElement>(null);

  // Effet vinyle : un tour sur lui-même à chaque clic, dans un sens aléatoire
  // (GSAP cumule la rotation avec '+=' / '-=' pour repartir de l'angle courant).
  function spinAndPick(img: HTMLImageElement | null) {
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
  const noResults = searched && results.length === 0;

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
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
          <img ref={disc} src="/disc.png" alt="" className="h-5 w-5 shrink-0" />
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
