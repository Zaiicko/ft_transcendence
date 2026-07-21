import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { emitCommentReaction } from '../games/commentBus';
import { ReviewTargetKind, useReviewSocket } from '../games/useReviewSocket';
import { ApiError, apiFetch } from '../lib/api';
import Avatar from './Avatar';
import EmptyState, { PencilIcon } from './EmptyState';
import { CommentIcon, ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import ReviewComments from './ReviewComments';
import Stars from './Stars';

export type ReviewStats = { _avg: { rating: number | null }; _count: number };

// Contrat du module reviews (docs/reviews-api.md §1) — user null = compte
// supprimé (contenu anonymisé, à tolérer partout)
interface ReviewT {
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
  { key: 'popular', label: 'Populaires' },
  { key: 'recent', label: 'Récentes' },
  { key: 'discussed', label: 'Discutées' },
];

// Avis chargés par lot, avec un bouton « Charger plus »
const PAGE_SIZE = 10;

// Section d'avis complète (liste + formulaire + likes + commentaires threadés +
// temps réel), partagée par la fiche jeu et la fiche studio. Le back est
// symétrique : `:target` = `games/:id` ou `companies/:id` (docs/reviews-api.md).
export default function ReviewsSection({
  target,
  onStats,
  onReviewCreated,
}: {
  target: { kind: ReviewTargetKind; id: number };
  onStats?: (s: ReviewStats) => void;
  onReviewCreated?: () => void;
}) {
  const { kind, id } = target;
  const base = `/${kind === 'game' ? 'games' : 'companies'}/${id}`;
  const noun = kind === 'game' ? 'ce jeu' : 'ce studio';

  const { user } = useAuth();
  const { hash } = useLocation();

  const [reviews, setReviews] = useState<ReviewT[]>([]);
  const [sort, setSort] = useState<Sort>('popular');
  // Pagination : page courante, fin atteinte (dernier lot < PAGE_SIZE), et
  // état du bouton pendant le chargement du lot suivant.
  const [page, setPage] = useState(1);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Threads ouverts (id des avis dépliés) + version par avis, bumpée par le
  // temps réel (comment:changed) pour refetch un thread ouvert.
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [commentVersions, setCommentVersions] = useState<Record<number, number>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const reviewRef = useRef<HTMLElement>(null);

  const toggleThread = (rid: number) =>
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  const bumpVersion = (rid: number) =>
    setCommentVersions((v) => ({ ...v, [rid]: (v[rid] ?? 0) + 1 }));

  // Charge le lot suivant et l'ajoute à la suite. On dédoublonne : un avis déjà
  // présent (ex. celui épinglé via #review-<id>) n'est pas ajouté deux fois.
  async function loadMore() {
    setLoadingMore(true);
    const next = page + 1;
    try {
      const rows = await apiFetch<ReviewT[]>(
        `${base}/reviews?sort=${sort}&page=${next}&limit=${PAGE_SIZE}`,
      );
      setReviews((cur) => {
        const seen = new Set(cur.map((r) => r.id));
        return [...cur, ...rows.filter((r) => !seen.has(r.id))];
      });
      setPage(next);
      setReachedEnd(rows.length < PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  function refreshStats() {
    apiFetch<ReviewStats>(`${base}/reviews/stats`)
      .then((s) => onStats?.(s))
      .catch(() => {});
  }

  // Note : refreshStats dépend de `base` (stable pour une cible). On resynchro
  // les stats au montage / changement de cible.
  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Chargement / rechargement de la première page (au montage, changement de
  // tri, ou arrivée via un lien profond).
  useEffect(() => {
    let cancelled = false;
    const pinId = hash.startsWith('#review-') ? Number(hash.slice('#review-'.length)) : NaN;
    apiFetch<ReviewT[]>(`${base}/reviews?sort=${sort}&page=1&limit=${PAGE_SIZE}`)
      .then((list) => {
        if (cancelled) return;
        setReviews(list);
        setPage(1);
        setReachedEnd(list.length < PAGE_SIZE);
        // Avis ciblé (#review-<id>) absent du lot chargé : on le récupère seul
        // et on l'épingle en tête, pour toujours atterrir dessus même sur un jeu
        // très commenté. On vérifie qu'il appartient bien à cette cible.
        if (!Number.isNaN(pinId) && !list.some((r) => r.id === pinId)) {
          apiFetch<ReviewT & { game?: { id: number }; company?: { id: number } }>(
            `/reviews/${pinId}`,
          )
            .then((r) => {
              if (cancelled) return;
              const belongs = kind === 'game' ? r.game?.id === id : r.company?.id === id;
              if (belongs) {
                setReviews((cur) => (cur.some((x) => x.id === r.id) ? cur : [r, ...cur]));
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, sort, hash, kind, id]);

  // Arrivée via un lien #review (bloc critiques) ou #review-<id> (un avis
  // précis, ex. depuis le profil). On défile une seule fois par hash, en
  // retentant quand la liste finit de charger (l'ancre n'existe qu'ensuite).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hash.startsWith('#review')) return;
    if (scrolledFor.current === hash) return;
    const el = document.getElementById(hash.slice(1));
    const target = el ?? (hash === '#review' ? reviewRef.current : null);
    if (!target) return; // pas encore monté : on retentera au prochain rendu
    scrolledFor.current = hash;
    target.scrollIntoView({ behavior: 'smooth', block: el && hash !== '#review' ? 'center' : 'start' });
  }, [hash, reviews]);

  // 👍/👎 exclusifs et idempotents côté serveur (204 sans payload). Patch
  // optimiste AVANT l'await : sinon l'event socket `review:reaction` (compteur
  // absolu) arrive pendant l'await et le patch se cumule dessus → double
  // comptage. L'event réconcilie ensuite les compteurs à la valeur serveur.
  async function react(review: ReviewT, r: 'like' | 'dislike') {
    if (!user) return;
    const removing = review.myReaction === r;
    setReviews((list) =>
      list.map((x) => {
        if (x.id !== review.id) return x;
        const counts = { ...x._count };
        if (removing) {
          counts[`${r}s`] -= 1;
          return { ...x, _count: counts, myReaction: null };
        }
        counts[`${r}s`] += 1;
        if (x.myReaction) counts[`${x.myReaction}s`] -= 1;
        return { ...x, _count: counts, myReaction: r };
      }),
    );
    try {
      await apiFetch(`/reviews/${review.id}/${r}`, { method: removing ? 'DELETE' : 'POST' });
    } catch {
      replaceReview(review.id); // échec → resynchronise sur le serveur
    }
  }

  async function removeOwn(review: ReviewT) {
    await apiFetch(`/reviews/${review.id}`, { method: 'DELETE' });
    setReviews((list) => list.filter((x) => x.id !== review.id));
    refreshStats();
  }

  // Re-fetch ciblé d'une review (édition/commentaire d'un autre onglet) —
  // jamais la liste entière, sinon les threads ouverts se referment.
  function replaceReview(reviewId: number) {
    apiFetch<ReviewT>(`/reviews/${reviewId}`)
      .then((fresh) =>
        setReviews((list) => list.map((x) => (x.id === reviewId ? { ...x, ...fresh } : x))),
      )
      .catch(() => {});
  }

  // Temps réel : les 6 évènements de la room (docs/reviews-api.md §3). Les
  // payloads de réaction portent les compteurs absolus → on les pose tels quels
  // (idempotent avec le patch optimiste local, pas de double comptage).
  useReviewSocket(kind, id, {
    onReviewCreated: (raw) => {
      const created = raw as ReviewT;
      setReviews((list) => (list.some((x) => x.id === created.id) ? list : [created, ...list]));
      refreshStats();
    },
    onReviewUpdated: replaceReview,
    onReviewDeleted: (reviewId) => {
      setReviews((list) => list.filter((x) => x.id !== reviewId));
      refreshStats();
    },
    onReviewReaction: ({ reviewId, likes, dislikes }) =>
      setReviews((list) =>
        list.map((x) =>
          x.id === reviewId ? { ...x, _count: { ...x._count, likes, dislikes } } : x,
        ),
      ),
    onCommentChanged: (reviewId) => {
      replaceReview(reviewId); // met à jour le compteur 💬
      bumpVersion(reviewId); // rafraîchit le thread s'il est ouvert
    },
    onCommentReaction: ({ commentId, likes, dislikes }) =>
      emitCommentReaction({ commentId, likes, dislikes }),
  });

  const alreadyReviewed = user != null && reviews.some((r) => r.user?.id === user.id);

  return (
    <section ref={reviewRef} id="review" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Critiques{reviews.length > 0 ? ` (${reviews.length})` : ''}
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
          base={base}
          noun={noun}
          onCreated={() => {
            setSort('recent');
            apiFetch<ReviewT[]>(`${base}/reviews?sort=recent&page=1&limit=${PAGE_SIZE}`)
              .then((list) => {
                setReviews(list);
                setPage(1);
                setReachedEnd(list.length < PAGE_SIZE);
              })
              .catch(() => {});
            refreshStats();
            onReviewCreated?.();
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
              ? `Sois le premier à partager ton avis sur ${noun}.`
              : `Connecte-toi pour être le premier à noter ${noun}.`
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.map((r) => (
            <article
              key={r.id}
              id={`review-${r.id}`}
              className="card scroll-mt-24 p-4 transition target:ring-2 target:ring-accent"
            >
              <div className="flex items-center gap-3">
                {r.user ? (
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
                    setReviews((list) => list.map((x) => (x.id === r.id ? { ...x, ...u } : x)));
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
          {!reachedEnd && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto mt-2 block rounded-lg border border-zinc-400 px-6 py-2 text-sm transition hover:opacity-70 disabled:opacity-50 dark:border-zinc-700"
            >
              {loadingMore ? 'Chargement…' : 'Charger plus'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewForm({
  base,
  noun,
  onCreated,
}: {
  base: string;
  noun: string;
  onCreated: () => void;
}) {
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
      await apiFetch(`${base}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), rating, text: text.trim() }),
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `Tu as déjà critiqué ${noun}.`
          : err instanceof ApiError
            ? err.message
            : 'Erreur inattendue.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mb-6 flex flex-col gap-3 p-4">
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
  review: ReviewT;
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
