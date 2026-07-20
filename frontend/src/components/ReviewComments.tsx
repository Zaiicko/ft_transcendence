import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import { ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import { onCommentReaction } from '../games/commentBus';
import { apiFetch } from '../lib/api';

// Thread de commentaires d'un avis (docs/reviews-api.md §2). Récursif jusqu'à
// 3 niveaux, tombales Reddit (deleted → « [supprimé] », thread conservé),
// like/dislike optimistes, réponses chargées à la demande.
export interface CommentT {
  id: number;
  text: string;
  parentId: number | null;
  user: { id: number; username: string; avatarUrl: string | null } | null;
  _count: { likes: number; dislikes: number; replies: number };
  myReaction: 'like' | 'dislike' | null;
  deleted: boolean;
}

const MAX_DEPTH = 3;

// Petite flèche « répondre », même trait que les autres icônes filaires
function ReplyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 fill-none stroke-current ${className}`}
    >
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export default function ReviewComments({
  reviewId,
  currentUserId,
  version,
  onChanged,
}: {
  reviewId: number;
  currentUserId: number | null;
  version: number; // bumpé par le temps réel (comment:changed) → refetch racine
  onChanged: () => void; // remonte le compteur 💬 de l'avis après ma mutation
}) {
  const [roots, setRoots] = useState<CommentT[]>([]);
  const [sort, setSort] = useState<'top' | 'recent'>('top');
  const [loading, setLoading] = useState(true);

  function load() {
    apiFetch<CommentT[]>(`/reviews/${reviewId}/comments?sort=${sort}&limit=50`)
      .then(setRoots)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<CommentT[]>(`/reviews/${reviewId}/comments?sort=${sort}&limit=50`)
      .then((list) => !cancelled && setRoots(list))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reviewId, sort, version]);

  return (
    <div className="mt-4 border-t border-zinc-900/10 pt-4 dark:border-zinc-100/10">
      {currentUserId != null && (
        <Composer
          reviewId={reviewId}
          onDone={() => {
            load();
            onChanged();
          }}
        />
      )}

      <div className="mb-2 flex items-center gap-2 text-xs">
        {(['top', 'recent'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={`transition ${
              sort === s ? 'font-semibold text-accent' : 'text-zinc-500 hover:text-accent'
            }`}
          >
            {s === 'top' ? 'Meilleurs' : 'Récents'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500">Chargement…</p>
      ) : roots.length === 0 ? (
        <p className="text-xs text-zinc-500">Aucun commentaire — lance la discussion.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {roots.map((c) => (
            <CommentNode
              key={c.id}
              comment={c}
              reviewId={reviewId}
              depth={1}
              currentUserId={currentUserId}
              reload={load}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentNode({
  comment,
  reviewId,
  depth,
  currentUserId,
  reload,
  onChanged,
}: {
  comment: CommentT;
  reviewId: number;
  depth: number;
  currentUserId: number | null;
  reload: () => void; // refetch du niveau parent (après édition/suppression)
  onChanged: () => void;
}) {
  const [c, setC] = useState(comment);
  const [seen, setSeen] = useState(comment);
  const [replies, setReplies] = useState<CommentT[] | null>(null); // null = pas encore chargées
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  // Resync sans effet : quand le parent refetch, il passe un nouvel objet
  // `comment` → on réaligne l'état local (pattern « ajuster pendant le rendu »).
  if (comment !== seen) {
    setSeen(comment);
    setC(comment);
  }

  // Temps réel des réactions de commentaire : le bus porte les compteurs
  // absolus (docs §3), on pose la valeur serveur telle quelle pour cet id.
  useEffect(
    () =>
      onCommentReaction(({ commentId, likes, dislikes }) => {
        if (commentId === comment.id)
          setC((prev) => ({ ...prev, _count: { ...prev._count, likes, dislikes } }));
      }),
    [comment.id],
  );

  function loadReplies() {
    apiFetch<CommentT[]>(`/comments/${c.id}/replies?limit=50`)
      .then(setReplies)
      .catch(() => {});
  }

  // Optimiste AVANT l'await (même piège que les avis : l'event `comment:reaction`
  // absolu arrive pendant l'await et se cumulerait avec le patch local).
  async function react(kind: 'like' | 'dislike') {
    if (currentUserId == null || c.deleted) return;
    const removing = c.myReaction === kind;
    setC((prev) => {
      const counts = { ...prev._count };
      if (removing) {
        counts[`${kind}s`] -= 1;
        return { ...prev, _count: counts, myReaction: null };
      }
      counts[`${kind}s`] += 1;
      if (prev.myReaction) counts[`${prev.myReaction}s`] -= 1;
      return { ...prev, _count: counts, myReaction: kind };
    });
    await apiFetch(`/comments/${c.id}/${kind}`, { method: removing ? 'DELETE' : 'POST' }).catch(
      () => reload(),
    );
  }

  async function saveEdit() {
    const body = editText.trim();
    if (!body || body === c.text) {
      setEditing(false);
      return;
    }
    setC((prev) => ({ ...prev, text: body })); // optimiste
    setEditing(false);
    await apiFetch(`/comments/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: body }),
    }).catch(() => reload());
  }

  async function remove() {
    await apiFetch(`/comments/${c.id}`, { method: 'DELETE' });
    reload(); // avec réponses → tombale ; sans → disparaît (le parent refetch)
    onChanged();
  }

  const mine = currentUserId != null && c.user?.id === currentUserId;
  const canReply = currentUserId != null && !c.deleted && depth < MAX_DEPTH;

  return (
    <li>
      <div className="flex items-start gap-2.5">
        {c.deleted || !c.user ? (
          <Avatar username="?" size={26} />
        ) : (
          <Avatar username={c.user.username} avatarUrl={c.user.avatarUrl} size={26} />
        )}
        <div className="min-w-0 flex-1">
          {c.deleted ? (
            <p className="text-sm italic text-zinc-500">[commentaire supprimé]</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {c.user ? (
                  <Link
                    to={`/u/${c.user.username}`}
                    className="text-xs font-semibold hover:text-accent"
                  >
                    {c.user.username}
                  </Link>
                ) : (
                  <span className="text-xs italic text-zinc-500">[utilisateur supprimé]</span>
                )}
              </div>
              {editing ? (
                <div className="mt-1 flex flex-col gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    maxLength={5000}
                    rows={2}
                    className="field w-full resize-none px-4 py-2"
                  />
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={saveEdit}
                      className="rounded-full bg-accent px-3 py-1 font-medium text-zinc-950 transition hover:brightness-110"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="text-zinc-500 transition hover:text-accent"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-200">
                  {c.text}
                </p>
              )}
              <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                <button
                  type="button"
                  disabled={currentUserId == null}
                  onClick={() => react('like')}
                  className={`inline-flex items-center gap-1 transition disabled:cursor-default ${
                    c.myReaction === 'like' ? 'text-accent' : 'enabled:hover:text-accent'
                  }`}
                >
                  <ThumbsUpIcon className="h-3.5 w-3.5" /> {c._count.likes}
                </button>
                <button
                  type="button"
                  disabled={currentUserId == null}
                  onClick={() => react('dislike')}
                  className={`inline-flex items-center gap-1 transition disabled:cursor-default ${
                    c.myReaction === 'dislike' ? 'text-accent' : 'enabled:hover:text-accent'
                  }`}
                >
                  <ThumbsDownIcon className="h-3.5 w-3.5" /> {c._count.dislikes}
                </button>
                {canReply && (
                  <button
                    type="button"
                    onClick={() => setReplying((v) => !v)}
                    className="inline-flex items-center gap-1 transition hover:text-accent"
                  >
                    <ReplyIcon /> Répondre
                  </button>
                )}
                {mine && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(c.text);
                      setEditing(true);
                    }}
                    className="transition hover:text-accent"
                  >
                    Modifier
                  </button>
                )}
                {mine && (
                  <button
                    type="button"
                    onClick={remove}
                    className="transition hover:text-red-400"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </>
          )}

          {replying && (
            <div className="mt-2">
              <Composer
                reviewId={reviewId}
                parentId={c.id}
                onDone={() => {
                  setReplying(false);
                  loadReplies();
                  onChanged();
                }}
              />
            </div>
          )}

          {/* Réponses : chargées à la demande, puis rendues récursivement */}
          {replies === null
            ? c._count.replies > 0 && (
                <button
                  type="button"
                  onClick={loadReplies}
                  className="mt-2 text-xs font-medium text-accent hover:underline"
                >
                  Voir {c._count.replies} réponse{c._count.replies > 1 ? 's' : ''}
                </button>
              )
            : replies.length > 0 && (
                <ul className="mt-3 flex flex-col gap-3 border-l border-zinc-900/10 pl-3 dark:border-zinc-100/10">
                  {replies.map((child) => (
                    <CommentNode
                      key={child.id}
                      comment={child}
                      reviewId={reviewId}
                      depth={depth + 1}
                      currentUserId={currentUserId}
                      reload={loadReplies}
                      onChanged={onChanged}
                    />
                  ))}
                </ul>
              )}
        </div>
      </div>
    </li>
  );
}

// Champ de saisie partagé : nouveau commentaire racine (parentId absent) ou
// réponse (parentId fourni). Racine comme réponse ciblent le même endpoint
// POST /reviews/:reviewId/comments — la profondeur est validée côté serveur.
function Composer({
  reviewId,
  parentId,
  onDone,
}: {
  reviewId: number;
  parentId?: number;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await apiFetch(`/reviews/${reviewId}/comments`, {
        method: 'POST',
        body: JSON.stringify(parentId ? { text: body, parentId } : { text: body }),
      });
      setText('');
      onDone();
    } catch {
      /* l'appelant re-fetch de toute façon */
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-2">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={parentId ? 'Répondre…' : 'Ajouter un commentaire…'}
        maxLength={5000}
        rows={parentId ? 2 : 2}
        className="field w-full resize-none px-4 py-2"
      />
      <button
        type="submit"
        disabled={sending || !text.trim()}
        className="self-end rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
      >
        {parentId ? 'Répondre' : 'Commenter'}
      </button>
    </form>
  );
}
