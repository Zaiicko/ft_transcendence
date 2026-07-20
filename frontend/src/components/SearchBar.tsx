import { FormEvent, useState } from 'react';
import { apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';

const gameHref = (id: number) => `/game/${id}`;

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[]>([]);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const { data } = await apiFetch<{ data: GameSummary[] }>(
      `/games/search?q=${encodeURIComponent(query)}`,
    );
    setResults(data.slice(0, 8));
  }

  async function randomGame() {
    // Les ids ne sont pas contigus (imports par machine) : on tire une page
    // de taille 1 au hasard plutôt qu'un id au hasard
    const { total } = await apiFetch<{ total: number }>('/games?limit=1');
    if (!total) return;
    const page = 1 + Math.floor(Math.random() * total);
    const { data } = await apiFetch<{ data: GameSummary[] }>(`/games?page=${page}&limit=1`);
    if (data[0]) window.location.href = gameHref(data[0].id);
  }

  // Pill fantôme façon TiMN : quasi invisible au repos, bordure ambre au focus
  const field =
    'rounded-full border border-zinc-400/40 bg-zinc-900/5 dark:border-zinc-100/10 dark:bg-zinc-100/5';

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex gap-2">
        <form onSubmit={search} className="min-w-0 flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className={`${field} w-full px-4 py-1.5 text-sm placeholder-zinc-500 focus:border-accent focus:outline-none`}
          />
        </form>
        <button
          type="button"
          onClick={randomGame}
          title="Jeu au hasard"
          aria-label="Jeu au hasard"
          className={`${field} flex items-center px-3 text-zinc-500 transition hover:border-accent hover:text-accent dark:text-zinc-400`}
        >
          {/* Dé filaire (trait 1.6, style TiMN) — face à cinq points */}
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3.5" y="3.5" width="17" height="17" rx="4" className="fill-none stroke-current" />
            <circle cx="8.5" cy="8.5" r="1.1" className="fill-current" />
            <circle cx="15.5" cy="8.5" r="1.1" className="fill-current" />
            <circle cx="12" cy="12" r="1.1" className="fill-current" />
            <circle cx="8.5" cy="15.5" r="1.1" className="fill-current" />
            <circle cx="15.5" cy="15.5" r="1.1" className="fill-current" />
          </svg>
        </button>
      </div>
      {results.length > 0 && (
        <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {results.map((g) => (
            <li key={g.id}>
              <a
                href={gameHref(g.id)}
                className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {g.coverUrl && <img src={g.coverUrl} alt="" className="h-10 w-7 rounded object-cover" />}
                <span className="truncate text-sm">{g.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
