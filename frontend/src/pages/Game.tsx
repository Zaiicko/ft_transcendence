import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PlayedButton from '../components/PlayedButton';
import ReviewsSection, { ReviewStats } from '../components/ReviewsSection';
import Skeleton from '../components/Skeleton';
import { StarIcon } from '../components/Stars';
import { apiFetch } from '../lib/api';
import { GameDlc, GameSummary } from '../lib/types';

const screenshot1080 = (g: GameSummary) =>
  g.screenshots?.[0]?.replace(/t_[a-z0-9_]+/, 't_1080p') ?? null;

export default function Game() {
  const { id } = useParams();
  const gameId = Number(id);

  // Résultats tagués par id : au changement de jeu, l'ancien contenu est
  // ignoré sans setState synchrone dans l'effet (règle set-state-in-effect).
  // game === null → 404 ; entrée absente/id différent → chargement.
  const [loaded, setLoaded] = useState<{ id: number; game: GameSummary | null } | null>(null);
  // Stats des critiques (moyenne + nombre) affichées dans l'en-tête ; alimentées
  // par ReviewsSection via onStats à chaque création/suppression/temps réel.
  const [stats, setStats] = useState<ReviewStats | null>(null);
  // Bumpé quand on poste un avis : le back marque alors le jeu "fait"
  // automatiquement, ce compteur force PlayedButton à recharger son état.
  const [playedRefresh, setPlayedRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<GameSummary>(`/games/${gameId}`)
      .then((g) => {
        if (!cancelled) setLoaded({ id: gameId, game: g });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: gameId, game: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const game = loaded?.id === gameId ? loaded.game : undefined;

  if (game === null) return <p className="py-24 text-center text-zinc-400">Jeu introuvable.</p>;
  if (!game)
    return (
      <div className="flex flex-col gap-10">
        <Skeleton className="h-[38vh] w-full rounded-xl md:h-[46vh]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );

  const banner = screenshot1080(game);
  const year = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null;

  // onDark : posé sur le dégradé du screenshot (texte clair) ou sur une
  // simple carte (texte selon le mode jour/nuit)
  const header = (onDark: boolean) => (
    <>
      <h1
        className={`text-balance text-3xl font-bold tracking-tight md:text-4xl ${
          onDark ? 'text-zinc-100' : ''
        }`}
      >
        {game.title}
      </h1>
      <div
        className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${
          onDark ? 'text-zinc-200' : 'text-zinc-600 dark:text-zinc-300'
        }`}
      >
        {year && (
          <span className="rounded-full border border-zinc-500/30 bg-zinc-950/40 px-2.5 py-0.5 backdrop-blur">
            {year}
          </span>
        )}
        {game.genres?.slice(0, 4).map((g) => (
          <span
            key={g.id}
            className="rounded-full border border-zinc-500/30 bg-zinc-950/40 px-2.5 py-0.5 backdrop-blur"
          >
            {g.name}
          </span>
        ))}
        {/* Studios : bulles cliquables → fiche du studio */}
        {game.companies?.map((c) => (
          <Link
            key={c.id}
            to={`/company/${c.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 text-accent backdrop-blur transition hover:bg-accent/20"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3 fill-none stroke-current"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 21h18" />
              <path d="M5 21V7l8-4v18" />
              <path d="M19 21V11l-6-4" />
            </svg>
            {c.name}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {stats && stats._count > 0 && stats._avg.rating != null && (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
            <StarIcon className="h-3.5 w-3.5" />
            {stats._avg.rating.toFixed(1)}/10
            <span
              className={`ml-1 font-normal ${onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'}`}
            >
              ({stats._count} avis joueur{stats._count > 1 ? 's' : ''})
            </span>
          </span>
        )}
        {game.igdbRating != null && (
          <span className={onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'}>
            IGDB {(game.igdbRating / 10).toFixed(1)}/10
          </span>
        )}
      </div>
      <div className="mt-4">
        <PlayedButton gameId={gameId} onDark={onDark} showCount refreshKey={playedRefresh} />
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-10">
      {/* En-tête : carte "cinéma" TiMN — screenshot en ambiance, la jaquette
          officielle fait foi (certains screenshots IGDB sont trompeurs) */}
      {banner ? (
        <div className="relative overflow-hidden rounded-xl border border-zinc-900/10 dark:border-zinc-100/10">
          <img src={banner} alt="" className="h-[38vh] w-full object-cover md:h-[46vh]" />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 bg-gradient-to-t from-zinc-950/90 via-zinc-950/35 to-transparent p-6 md:p-8">
            {game.coverUrl && (
              <img
                src={game.coverUrl}
                alt=""
                className="h-36 w-auto shrink-0 rounded-lg border border-zinc-100/15 shadow-2xl md:h-48"
              />
            )}
            <div className="min-w-0 pb-1">{header(true)}</div>
          </div>
        </div>
      ) : (
        <div className="card flex flex-col gap-6 p-6 sm:flex-row">
          {game.coverUrl && (
            <img
              src={game.coverUrl}
              alt=""
              className="h-72 self-start rounded-lg shadow-xl"
            />
          )}
          <div className="min-w-0">{header(false)}</div>
        </div>
      )}

      {/* Ce jeu est lui-même un DLC/extension : lien retour vers le jeu de base */}
      {game.parent && (
        <Link
          to={`/game/${game.parent.id}`}
          className="inline-flex items-center gap-2 self-start text-sm text-zinc-500 transition hover:text-accent dark:text-zinc-400"
        >
          <span aria-hidden>←</span>
          Contenu de <span className="font-medium">{game.parent.title}</span>
        </Link>
      )}

      {game.summary && (
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {game.summary}
        </p>
      )}

      {/* Extensions & DLC rattachés : choix dans un menu, puis note / "fait" */}
      {game.dlcs && game.dlcs.length > 0 && <DlcSelector dlcs={game.dlcs} />}

      <ReviewsSection
        target={{ kind: 'game', id: gameId }}
        onStats={setStats}
        onReviewCreated={() => setPlayedRefresh((n) => n + 1)}
      />
    </div>
  );
}

// Libellé FR du type de contenu additionnel
function dlcTypeLabel(type: string): string {
  if (type === 'EXPANSION') return 'Extension';
  if (type === 'STANDALONE') return 'Standalone';
  return 'DLC';
}

const dlcYear = (d: GameDlc) => d.releaseDate?.slice(0, 4);

// Petit lien "Noter" → ouvre la fiche du DLC sur le formulaire de critique
function RateLink({ id }: { id: number }) {
  return (
    <Link
      to={`/game/${id}#review`}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-400/60 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 fill-none stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
      Noter
    </Link>
  );
}

// Variante A : un menu déroulant pour choisir un DLC, puis un panneau avec le
// toggle "fait" (sur place) et le bouton "Noter" pour le DLC sélectionné.
function DlcSelector({ dlcs }: { dlcs: GameDlc[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = dlcs.find((d) => d.id === selectedId) ?? null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Extensions & DLC ({dlcs.length})
      </h2>
      <select
        value={selectedId ?? ''}
        onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
        aria-label="Choisir un DLC"
        className="field w-full max-w-md cursor-pointer px-4 py-2"
      >
        <option value="">Choisir un DLC…</option>
        {dlcs.map((d) => (
          <option key={d.id} value={d.id}>
            {dlcTypeLabel(d.gameType)} · {d.title}
            {dlcYear(d) ? ` (${dlcYear(d)})` : ''}
          </option>
        ))}
      </select>

      {selected && (
        <div className="card mt-3 flex items-center gap-4 p-4">
          {selected.coverUrl ? (
            <img
              src={selected.coverUrl}
              alt=""
              className="h-24 w-auto shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-center text-[10px] text-zinc-500 dark:bg-zinc-800">
              {dlcTypeLabel(selected.gameType)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Link
              to={`/game/${selected.id}`}
              className="line-clamp-2 font-semibold transition hover:text-accent"
            >
              {selected.title}
            </Link>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {dlcTypeLabel(selected.gameType)}
              {dlcYear(selected) ? ` · ${dlcYear(selected)}` : ''}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <PlayedButton gameId={selected.id} />
              <RateLink id={selected.id} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

