import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useRequireAuth } from '../auth/useRequireAuth';
import Avatar from './Avatar';
import { ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import { onCommentReaction } from '../games/commentBus';
import { apiFetch } from '../lib/api';

// Comment thread for a review (docs/reviews-api.md §2): recursive up to 3 levels, Reddit-style tombstones (deleted → "[deleted]"), optimistic like/dislike, replies loaded on demand.
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

// Small "reply" arrow, same stroke as the other outline icons.
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
  version: number; // bumped by real-time (comment:changed) → root refetch
  onChanged: () => void; // bumps the review's 💬 counter after my mutation
}) {
  const { t } = useTranslation();
  const requireAuth = useRequireAuth();
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
      {currentUserId != null ? (
        <Composer
          reviewId={reviewId}
          onDone={() => {
            load();
            onChanged();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={requireAuth}
          className="mb-3 text-xs text-zinc-500 underline-offset-2 hover:text-accent hover:underline"
        >
          {t('comments.loginToComment')}
        </button>
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
            {s === 'top' ? t('comments.sortTop') : t('comments.sortRecent')}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500">{t('comments.loading')}</p>
      ) : roots.length === 0 ? (
        <p className="text-xs text-zinc-500">{t('comments.empty')}</p>
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
  reload: () => void; // refetch the parent level (after edit/delete)
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const requireAuth = useRequireAuth();
  const [c, setC] = useState(comment);
  const [seen, setSeen] = useState(comment);
  const [replies, setReplies] = useState<CommentT[] | null>(null); // null = not loaded yet
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  // Resync without an effect: when the parent refetches it passes a new `comment` object → realign local state during render.
  if (comment !== seen) {
    setSeen(comment);
    setC(comment);
  }

  // Real-time comment reactions: the bus carries absolute counters (docs §3), applied as-is for this id.
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

  // Optimistic BEFORE the await (same trap as reviews: the absolute `comment:reaction` event arrives during the await and would double-count).
  async function react(kind: 'like' | 'dislike') {
    if (c.deleted) return;
    // Guest → redirect to login (returns here after sign-in); otherwise act.
    if (!requireAuth()) return;
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
    reload(); // with replies → tombstone; without → disappears (parent refetches)
    onChanged();
  }

  const mine = currentUserId != null && c.user?.id === currentUserId;
  // The button is visible even for a guest: the click triggers requireAuth.
  const canReply = !c.deleted && depth < MAX_DEPTH;

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
            <p className="text-sm italic text-zinc-500">{t('comments.deletedComment')}</p>
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
                  <span className="text-xs italic text-zinc-500">{t('comments.deletedUser')}</span>
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
                      {t('comments.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="text-zinc-500 transition hover:text-accent"
                    >
                      {t('comments.cancel')}
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
                  onClick={() => react('like')}
                  className={`inline-flex items-center gap-1 transition ${
                    c.myReaction === 'like' ? 'text-accent' : 'hover:text-accent'
                  }`}
                >
                  <ThumbsUpIcon className="h-3.5 w-3.5" /> {c._count.likes}
                </button>
                <button
                  type="button"
                  onClick={() => react('dislike')}
                  className={`inline-flex items-center gap-1 transition ${
                    c.myReaction === 'dislike' ? 'text-accent' : 'hover:text-accent'
                  }`}
                >
                  <ThumbsDownIcon className="h-3.5 w-3.5" /> {c._count.dislikes}
                </button>
                {canReply && (
                  <button
                    type="button"
                    onClick={() => requireAuth() && setReplying((v) => !v)}
                    className="inline-flex items-center gap-1 transition hover:text-accent"
                  >
                    <ReplyIcon /> {t('comments.reply')}
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
                    {t('comments.edit')}
                  </button>
                )}
                {mine && (
                  <button
                    type="button"
                    onClick={remove}
                    className="transition hover:text-red-400"
                  >
                    {t('comments.delete')}
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

          {replies === null
            ? c._count.replies > 0 && (
                <button
                  type="button"
                  onClick={loadReplies}
                  className="mt-2 text-xs font-medium text-accent hover:underline"
                >
                  {t('comments.viewReplies', { count: c._count.replies })}
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

// Shared input field: a new root comment (no parentId) or a reply (parentId given); both hit POST /reviews/:reviewId/comments, depth validated server-side.
function Composer({
  reviewId,
  parentId,
  onDone,
}: {
  reviewId: number;
  parentId?: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
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
      /* the caller re-fetches anyway */
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
        placeholder={parentId ? t('comments.replyPlaceholder') : t('comments.addPlaceholder')}
        maxLength={5000}
        rows={parentId ? 2 : 2}
        className="field w-full resize-none px-4 py-2"
      />
      <button
        type="submit"
        disabled={sending || !text.trim()}
        className="self-end rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
      >
        {parentId ? t('comments.reply') : t('comments.submit')}
      </button>
    </form>
  );
}
