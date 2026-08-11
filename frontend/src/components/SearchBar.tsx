import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';
import Avatar from './Avatar';

const gameHref = (id: number) => `/game/${id}`;
const companyHref = (id: number) => `/company/${id}`;
const playerHref = (username: string) => `/u/${username}`;
type CompanyHit = { id: number; name: string; logoUrl: string | null };
type PlayerHit = { id: number; username: string; avatarUrl: string | null };
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export default function SearchBar({
  autoFocus = false,
  onNavigate,
}: {
  autoFocus?: boolean;
  // Called right after a search result/submit navigates away — lets a mobile overlay wrapper close itself.
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[]>([]);
  const [companies, setCompanies] = useState<CompanyHit[]>([]);
  const [players, setPlayers] = useState<PlayerHit[]>([]);
  const [open, setOpen] = useState(false);
  // searched: a local search completed for the current input (distinguishes "not searched" from "0 results").
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const trimmed = query.trim();

  // Live search: 300ms debounce; clearing the timer on each keystroke cancels the previous request.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (trimmed.length < MIN_CHARS) {
        setResults([]);
        setCompanies([]);
        setPlayers([]);
        setSearched(false);
        return;
      }
      try {
        // Games + studios + players in parallel; a failing studio/player search must not break the whole (catch → empty).
        const [gameRes, companyRes, playerRes] = await Promise.all([
          apiFetch<{ data: GameSummary[] }>(`/games/search?q=${encodeURIComponent(trimmed)}`),
          apiFetch<{ data: CompanyHit[] }>(
            `/companies/search?q=${encodeURIComponent(trimmed)}`,
          ).catch(() => ({ data: [] as CompanyHit[] })),
          apiFetch<{ data: PlayerHit[] }>(
            `/users/search?q=${encodeURIComponent(trimmed)}`,
          ).catch(() => ({ data: [] as PlayerHit[] })),
        ]);
        if (cancelled) return;
        setResults(gameRes.data.slice(0, 8));
        setCompanies(companyRes.data.slice(0, 5));
        setPlayers(playerRes.data.slice(0, 5));
        setSearched(true);
        setOpen(true);
      } catch {
        /* network: keep the previous state */
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  // On-demand IGDB import when the local catalog doesn't know the game (explicit action).
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
      /* IGDB unavailable: keep the "no results" message */
    } finally {
      setImporting(false);
    }
  }

  function submitSearch() {
    if (trimmed.length < MIN_CHARS) return;
    setOpen(false);
    setResults([]);
    setCompanies([]);
    setPlayers([]);
    navigate(`/games?q=${encodeURIComponent(trimmed)}`);
    setQuery('');
    onNavigate?.();
  }

  function goTo(id: number) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setCompanies([]);
    setPlayers([]);
    navigate(gameHref(id));
    onNavigate?.();
  }

  function goToCompany(id: number) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setCompanies([]);
    setPlayers([]);
    navigate(companyHref(id));
    onNavigate?.();
  }

  function goToPlayer(username: string) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setCompanies([]);
    setPlayers([]);
    navigate(playerHref(username));
    onNavigate?.();
  }

  async function randomGame() {
    // IDs aren't contiguous (machine imports) → pull a random page of size 1 instead of a random id.
    const { total } = await apiFetch<{ total: number }>('/games?limit=1');
    if (!total) return;
    const page = 1 + Math.floor(Math.random() * total);
    const { data } = await apiFetch<{ data: GameSummary[] }>(`/games?page=${page}&limit=1`);
    if (data[0]) navigate(gameHref(data[0].id));
    onNavigate?.();
  }

  const disc = useRef<SVGSVGElement>(null);

  // Vinyl effect: one full spin per click in a random direction (GSAP accumulates with +=/-=).
  function spinAndPick(img: SVGSVGElement | null) {
    if (img) {
      const dir = Math.random() < 0.5 ? '+=360' : '-=360';
      gsap.to(img, { rotation: dir, duration: 0.7, ease: 'power2.out' });
    }
    void randomGame();
  }

  const field =
    'rounded-full border border-zinc-400/40 bg-zinc-900/5 dark:border-zinc-100/10 dark:bg-zinc-100/5';

  const showMenu = open && trimmed.length >= MIN_CHARS;
  const noResults =
    searched && results.length === 0 && companies.length === 0 && players.length === 0;

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="flex gap-2">
        <input
          ref={inputRef}
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
              <text x="12" y="7">?</text>
              <text x="7.6" y="14.7">?</text>
              <text x="16.4" y="14.7">?</text>
            </g>
          </svg>
        </button>
      </div>

      {showMenu && (results.length > 0 || searched || importing) && (
        <div className="animate-dropdown absolute z-20 mt-2 max-h-[60vh] w-full overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
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

          {players.length > 0 && (
            <ul
              className={
                results.length > 0 || companies.length > 0
                  ? 'border-t border-zinc-200 dark:border-zinc-800'
                  : ''
              }
            >
              <li className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                {t('catalog.players')}
              </li>
              {players.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => goToPlayer(p.username)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Avatar username={p.username} avatarUrl={p.avatarUrl} size={28} />
                    <span className="truncate text-sm">{p.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

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
