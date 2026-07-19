import { FormEvent, useState } from 'react';
import { apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';

// La fiche jeu React n'existe pas encore : les avis vivent sur la page de
// test (deep link #game-<id>) en attendant
const gameHref = (id: number) => `/test-api.html#game-${id}`;

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

  const field =
    'rounded-lg border border-zinc-400/60 bg-white/60 dark:border-zinc-600 dark:bg-zinc-900/60';

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex gap-2">
        <form onSubmit={search} className="min-w-0 flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un jeu…"
            className={`${field} w-full px-3 py-1.5 text-sm placeholder-zinc-500 backdrop-blur focus:border-zinc-500 focus:outline-none`}
          />
        </form>
        <button
          type="button"
          onClick={randomGame}
          title="Jeu au hasard"
          className={`${field} px-3 py-1.5 text-sm backdrop-blur hover:opacity-70`}
        >
          🎲
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
