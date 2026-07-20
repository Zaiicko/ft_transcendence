import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';

type Stats = { _avg: { rating: number | null }; _count: number };

// Fiche jeu minimale : cible des liens de la home. La vraie page (reviews,
// threads, temps réel — cf. docs/reviews-api.md §5) est un chantier d'équipe.
export default function Game() {
  const { id } = useParams();
  const gameId = Number(id);
  // Résultats tagués par id : au changement de jeu, l'ancien contenu est
  // ignoré sans setState synchrone dans l'effet (règle set-state-in-effect).
  // game === null → 404 ; entrée absente/id différent → chargement.
  const [loaded, setLoaded] = useState<{ id: number; game: GameSummary | null } | null>(null);
  const [statsLoaded, setStatsLoaded] = useState<{ id: number; stats: Stats } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<GameSummary>(`/games/${gameId}`)
      .then((g) => {
        if (!cancelled) setLoaded({ id: gameId, game: g });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: gameId, game: null });
      });
    apiFetch<Stats>(`/games/${gameId}/reviews/stats`)
      .then((s) => {
        if (!cancelled) setStatsLoaded({ id: gameId, stats: s });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const game = loaded?.id === gameId ? loaded.game : undefined;
  const stats = statsLoaded?.id === gameId ? statsLoaded.stats : null;

  if (game === null) return <p className="py-24 text-center text-zinc-400">Jeu introuvable.</p>;
  if (!game) return <p className="py-24 text-center text-zinc-500">Chargement…</p>;

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      {game.coverUrl && (
        <img src={game.coverUrl} alt={game.title} className="h-72 self-start rounded-xl shadow-xl" />
      )}
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{game.title}</h1>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
          {game.releaseDate && <span>{new Date(game.releaseDate).getFullYear()}</span>}
          {game.genres?.map((g) => (
            <span key={g.id} className="rounded bg-zinc-800 px-2 py-0.5">
              {g.name}
            </span>
          ))}
        </div>
        <div className="flex gap-4 text-sm">
          {game.igdbRating != null && (
            <span className="text-zinc-400">IGDB : {(game.igdbRating / 10).toFixed(1)}/10</span>
          )}
          {stats && stats._count > 0 && stats._avg.rating != null && (
            <span className="font-semibold text-amber-300">
              ⭐ Joueurs : {stats._avg.rating.toFixed(1)}/10 ({stats._count} avis)
            </span>
          )}
        </div>
        {game.summary && <p className="max-w-2xl text-sm text-zinc-300">{game.summary}</p>}
        <p className="mt-4 text-xs text-zinc-500">
          Fiche complète (reviews, commentaires, temps réel) en construction — l’API est prête.
        </p>
      </div>
    </div>
  );
}
