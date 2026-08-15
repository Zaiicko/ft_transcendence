import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import type { GameSummary } from '../lib/types';

// Autocomplete guess box for the cover-guess mini-game: a "guess" is always a
// concrete catalog id (never free text), picked from the same local search
// used elsewhere (see ProfileLists.tsx's AddGamesToList for the sibling
// pattern this mirrors).
export default function CoverGuessInput({
  disabled,
  onGuess,
}: {
  disabled: boolean;
  onGuess: (gameId: number) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[]>([]);
  const trimmed = query.trim();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (trimmed.length < 2) {
        setResults([]);
        return;
      }
      apiFetch<{ data: GameSummary[] }>(`/games/search?q=${encodeURIComponent(trimmed)}`)
        .then(({ data }) => {
          if (!cancelled) setResults(data.slice(0, 6));
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  function pick(game: GameSummary) {
    setQuery('');
    setResults([]);
    onGuess(game.id);
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        placeholder={t('minigames.coverGuess.play.guessPlaceholder')}
        className="field w-full px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-500"
      />
      {!disabled && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {results.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => pick(g)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {g.coverUrl ? (
                  <img src={g.coverUrl} alt="" className="h-8 w-6 shrink-0 rounded object-cover" />
                ) : (
                  <span className="h-8 w-6 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                )}
                <span className="min-w-0 flex-1 truncate">{g.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
