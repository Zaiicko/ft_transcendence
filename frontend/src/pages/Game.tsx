import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import PlayedButton from '../components/PlayedButton';
import EmptyState, { PencilIcon } from '../components/EmptyState';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from '../components/ReactionIcons';
import ReviewComments from '../components/ReviewComments';
import Skeleton from '../components/Skeleton';
import Stars, { StarIcon } from '../components/Stars';
import { emitCommentReaction } from '../games/commentBus';
import { useGameSocket } from '../games/useGameSocket';
import { ApiError, apiFetch } from '../lib/api';
import { GameSummary } from '../lib/types';

type Stats = { _avg: { rating: number | null }; _count: number };

// Contrat du module reviews (docs/reviews-api.md §1) — user null = compte
// supprimé (contenu anonymisé, à tolérer partout)
interface GameReview {
  id: number;
  rating: number;
  title: string;
  text: string;
  createdAt: string;
  user: { id: number; username: string; avatarUrl: string | null } | null;
  _count: { likes: number; dislikes: number; comments: number };
  myReaction: 'like' | 'dislike' | null;
}

type Sort = 'recent' | 'popular' | 'discussed';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Récentes' },
  { key: 'popular', label: 'Populaires' },
  { key: 'discussed', label: 'Discutées' },
];

const screenshot1080 = (g: GameSummary) =>
  g.screenshots?.[0]?.replace(/t_[a-z0-9_]+/, 't_1080p') ?? null;

export default function Game() {
  const { id } = useParams();
  const gameId = Number(id);
  const { user } = useAuth();
  const { hash } = useLocation();

  // Résultats tagués par id : au changement de jeu, l'ancien contenu est
  // ignoré sans setState synchrone dans l'effet (règle set-state-in-effect).
  // game === null → 404 ; entrée absente/id différent → chargement.
  const [loaded, setLoaded] = useState<{ id: number; game: GameSummary | null } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [sort, setSort] = useState<Sort>('recent');
  // Threads ouverts (id des avis dépliés) + version par avis, bumpée par le
  // temps réel (comment:changed) pour refetch un thread ouvert.
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [commentVersions, setCommentVersions] = useState<Record<number, number>>({});
  const [editingId, setEditingId] = useState<number | null>(null); // avis en cours d'édition
  const reviewRef = useRef<HTMLElement>(null);

  const toggleThread = (id: number) =>
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bumpVersion = (id: number) =>
    setCommentVersions((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }));

  useEffect(() => {
    let cancelled = false;
    apiFetch<GameSummary>(`/games/${gameId}`)
      .then((g) => {
        if (!cancelled) setLoaded({ id: gameId, game: g });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: gameId, game: null });
      });
    refreshStats();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<GameReview[]>(`/games/${gameId}/reviews?sort=${sort}&limit=50`)
      .then((list) => {
        if (!cancelled) setReviews(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, sort]);

  // Arrivée via "Écrire une critique" (lien #review) : on défile jusqu'au
  // bloc critiques une fois le jeu chargé (la section n'existe pas avant)
  useEffect(() => {
    if (hash === '#review' && loaded?.game) {
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [hash, loaded]);

  function refreshStats() {
    apiFetch<Stats>(`/games/${gameId}/reviews/stats`)
      .then(setStats)
      .catch(() => {});
  }

  // 👍/👎 exclusifs et idempotents côté serveur (204 sans payload). Patch
  // optimiste AVANT l'await : sinon l'event socket `review:reaction` (compteur
  // absolu) arrive pendant l'await et le patch se cumule dessus → double
  // comptage. L'event réconcilie ensuite les compteurs à la valeur serveur.
  async function react(review: GameReview, kind: 'like' | 'dislike') {
    if (!user) return;
    const removing = review.myReaction === kind;
    setReviews((list) =>
      list.map((r) => {
        if (r.id !== review.id) return r;
        const counts = { ...r._count };
        if (removing) {
          counts[`${kind}s`] -= 1;
          return { ...r, _count: counts, myReaction: null };
        }
        counts[`${kind}s`] += 1;
        if (r.myReaction) counts[`${r.myReaction}s`] -= 1;
        return { ...r, _count: counts, myReaction: kind };
      }),
    );
    try {
      await apiFetch(`/reviews/${review.id}/${kind}`, { method: removing ? 'DELETE' : 'POST' });
    } catch {
      replaceReview(review.id); // échec → on resynchronise sur le serveur
    }
  }

  async function removeOwn(review: GameReview) {
    await apiFetch(`/reviews/${review.id}`, { method: 'DELETE' });
    setReviews((list) => list.filter((r) => r.id !== review.id));
    refreshStats();
  }

  // Re-fetch ciblé d'une review (édition/commentaire d'un autre onglet) —
  // jamais la liste entière, sinon les threads ouverts se referment (piège #4).
  function replaceReview(reviewId: number) {
    apiFetch<GameReview>(`/reviews/${reviewId}`)
      .then((fresh) =>
        setReviews((list) => list.map((r) => (r.id === reviewId ? { ...r, ...fresh } : r))),
      )
      .catch(() => {});
  }

  // Temps réel : les 6 évènements de la room du jeu (docs/reviews-api.md §3).
  // Les payloads de réaction portent les compteurs absolus → on les pose tels
  // quels (idempotent avec le patch optimiste local, pas de double comptage).
  useGameSocket(gameId, {
    onReviewCreated: (raw) => {
      const created = raw as GameReview;
      setReviews((list) => (list.some((r) => r.id === created.id) ? list : [created, ...list]));
      refreshStats();
    },
    onReviewUpdated: replaceReview,
    onReviewDeleted: (reviewId) => {
      setReviews((list) => list.filter((r) => r.id !== reviewId));
      refreshStats();
    },
    onReviewReaction: ({ reviewId, likes, dislikes }) =>
      setReviews((list) =>
        list.map((r) =>
          r.id === reviewId ? { ...r, _count: { ...r._count, likes, dislikes } } : r,
        ),
      ),
    onCommentChanged: (reviewId) => {
      replaceReview(reviewId); // met à jour le compteur 💬
      bumpVersion(reviewId); // rafraîchit le thread s'il est ouvert
    },
    onCommentReaction: ({ commentId, likes, dislikes }) =>
      emitCommentReaction({ commentId, likes, dislikes }),
  });

  const game = loaded?.id === gameId ? loaded.game : undefined;
  const alreadyReviewed = user != null && reviews.some((r) => r.user?.id === user.id);

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
        <PlayedButton gameId={gameId} onDark={onDark} showCount />
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

      {game.summary && (
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {game.summary}
        </p>
      )}

      <section ref={reviewRef} id="review" className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Critiques{stats && stats._count > 0 ? ` (${stats._count})` : ''}
          </h2>
          <div className="flex gap-2">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  sort === s.key
                    ? 'border-accent bg-accent font-medium text-zinc-950'
                    : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {user && !alreadyReviewed && (
          <ReviewForm
            gameId={gameId}
            onCreated={() => {
              setSort('recent');
              apiFetch<GameReview[]>(`/games/${gameId}/reviews?sort=recent&limit=50`)
                .then(setReviews)
                .catch(() => {});
              refreshStats();
            }}
          />
        )}
        {!user && (
          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            Connecte-toi pour écrire une critique.
          </p>
        )}

        {reviews.length === 0 ? (
          <EmptyState
            icon={<PencilIcon />}
            title="Pas encore de critique"
            description={
              user
                ? 'Sois le premier à partager ton avis sur ce jeu.'
                : 'Connecte-toi pour être le premier à noter ce jeu.'
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {reviews.map((r) => (
              <article
                key={r.id}
                className="card p-4"
              >
                <div className="flex items-center gap-3">
                  {r.user ? (
                    // Auteur cliquable → son profil public (sauf compte supprimé)
                    <Link
                      to={`/u/${r.user.username}`}
                      className="flex min-w-0 items-center gap-3 hover:opacity-80"
                    >
                      <Avatar username={r.user.username} avatarUrl={r.user.avatarUrl} size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.user.username}</div>
                        <div className="text-xs text-zinc-500">
                          {new Date(r.createdAt).toLocaleDateString('fr')}
                        </div>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar username="?" size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-sm">
                          <em>[utilisateur supprimé]</em>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {new Date(r.createdAt).toLocaleDateString('fr')}
                        </div>
                      </div>
                    </div>
                  )}
                  {editingId !== r.id && <Stars rating={r.rating} className="ml-auto" />}
                </div>
                {editingId === r.id ? (
                  <EditReviewForm
                    review={r}
                    onCancel={() => setEditingId(null)}
                    onSaved={(u) => {
                      setEditingId(null);
                      setReviews((list) =>
                        list.map((x) => (x.id === r.id ? { ...x, ...u } : x)),
                      );
                      refreshStats();
                    }}
                  />
                ) : (
                  <>
                <div className="mt-3 text-sm font-semibold">« {r.title} »</div>
                <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">
                  {r.text}
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    disabled={!user}
                    onClick={() => react(r, 'like')}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition disabled:cursor-default disabled:opacity-60 ${
                      r.myReaction === 'like'
                        ? 'border-accent text-accent'
                        : 'border-zinc-400/60 text-zinc-500 enabled:hover:border-accent enabled:hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <ThumbsUpIcon className="h-3.5 w-3.5" /> {r._count.likes}
                  </button>
                  <button
                    type="button"
                    disabled={!user}
                    onClick={() => react(r, 'dislike')}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition disabled:cursor-default disabled:opacity-60 ${
                      r.myReaction === 'dislike'
                        ? 'border-accent text-accent'
                        : 'border-zinc-400/60 text-zinc-500 enabled:hover:border-accent enabled:hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <ThumbsDownIcon className="h-3.5 w-3.5" /> {r._count.dislikes}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleThread(r.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
                      openThreads.has(r.id)
                        ? 'border-accent text-accent'
                        : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <CommentIcon className="h-3.5 w-3.5" /> {r._count.comments}
                  </button>
                  {user && r.user?.id === user.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingId(r.id)}
                        className="ml-auto text-zinc-500 transition hover:text-accent"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOwn(r)}
                        className="text-zinc-500 transition hover:text-red-400"
                      >
                        Supprimer
                      </button>
                    </>
                  )}
                </div>
                  </>
                )}
                {openThreads.has(r.id) && (
                  <ReviewComments
                    reviewId={r.id}
                    currentUserId={user?.id ?? null}
                    version={commentVersions[r.id] ?? 0}
                    onChanged={() => replaceReview(r.id)}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewForm({ gameId, onCreated }: { gameId: number; onCreated: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating == null) {
      setError('Choisis une note.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await apiFetch(`/games/${gameId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), rating, text: text.trim() }),
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Tu as déjà critiqué ce jeu.'
          : err instanceof ApiError
            ? err.message
            : 'Erreur inattendue.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 flex flex-col gap-3 card p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-zinc-500 dark:text-zinc-400">Note :</span>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} sur 10`}
            className={`h-8 w-8 rounded-full border text-xs transition ${
              rating != null && n <= rating
                ? 'border-accent bg-accent font-bold text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre de ta critique"
        maxLength={120}
        required
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ton avis (sans spoiler…)"
        maxLength={5000}
        required
        rows={4}
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={sending}
        className="self-end rounded-full bg-accent px-5 py-2 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
      >
        Publier la critique
      </button>
    </form>
  );
}

// Édition d'un avis existant (PATCH /reviews/:id) — même contrôles que le
// formulaire de création, pré-remplis. onSaved patche l'avis dans la liste ;
// l'event socket review:updated réconcilie ensuite les autres onglets.
function EditReviewForm({
  review,
  onCancel,
  onSaved,
}: {
  review: GameReview;
  onCancel: () => void;
  onSaved: (u: { rating: number; title: string; text: string }) => void;
}) {
  const [rating, setRating] = useState<number>(review.rating);
  const [title, setTitle] = useState(review.title);
  const [text, setText] = useState(review.text);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const body = text.trim();
    if (!t || !body) {
      setError('Titre et texte obligatoires.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await apiFetch(`/reviews/${review.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: t, rating, text: body }),
      });
      onSaved({ rating, title: t, text: body });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-zinc-500 dark:text-zinc-400">Note :</span>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} sur 10`}
            className={`h-8 w-8 rounded-full border text-xs transition ${
              n <= rating
                ? 'border-accent bg-accent font-bold text-zinc-950'
                : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre de ta critique"
        maxLength={120}
        required
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ton avis (sans spoiler…)"
        maxLength={5000}
        required
        rows={4}
        className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-2 self-end text-sm">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-zinc-500 transition hover:text-accent"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
    </form>
  );
}
