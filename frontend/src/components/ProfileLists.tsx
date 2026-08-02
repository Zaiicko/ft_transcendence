import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import SectionHead from './SectionHead';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import type { GameListDetail, GameListSummary, GameSummary } from '../lib/types';
import { framedImgStyle, parseFrame } from './Avatar';
import ListCoverFramer from './ListCoverFramer';
import Stars, { StarIcon } from './Stars';

gsap.registerPlugin(Flip);

// Must stay in sync with MAX_GAMES_PER_LIST on the backend (lists.service).
const MAX_GAMES_PER_LIST = 30;

// Profile "Lists" section. For the owner (isSelf): full management (create, rename, public/private, delete, remove games) over all their lists. For a visitor: public lists only, read-only.
export default function ProfileLists({
  isSelf,
  publicLists,
}: {
  isSelf: boolean;
  publicLists: GameListSummary[];
}) {
  const { t } = useTranslation();
  const [lists, setLists] = useState<GameListSummary[]>(publicLists);
  const [creating, setCreating] = useState(false);

  // The owner reloads the full list (public + private); a visitor keeps the public lists passed by the profile.
  const reload = useCallback(() => {
    if (!isSelf) return;
    apiFetch<GameListSummary[]>('/lists/mine')
      .then(setLists)
      .catch(() => {});
  }, [isSelf]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!isSelf && lists.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <SectionHead className="mb-0" eyebrow={t('profile.eyeLists')} title={t('lists.heading')} />
        {isSelf && !creating && lists.length < 6 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-400/60 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
          >
            <span aria-hidden className="text-sm leading-none">
              +
            </span>
            {t('lists.newList')}
          </button>
        )}
      </div>

      {isSelf && creating && (
        <CreateListForm
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {lists.length === 0 && !creating ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {isSelf ? t('lists.emptyOwn') : t('lists.emptyPublic')}
        </p>
      ) : (
        <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
          {lists.map((list) => (
            <ListCard key={list.id} list={list} isSelf={isSelf} onChanged={reload} />
          ))}
        </div>
      )}
    </section>
  );
}

function CreateListForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/lists', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), isPublic }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lists.error'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder={t('lists.namePlaceholder')}
        className="field px-3 py-2 text-sm"
      />
      <VisibilityToggle isPublic={isPublic} onChange={setIsPublic} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? t('lists.creating') : t('lists.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {t('lists.cancel')}
        </button>
      </div>
    </form>
  );
}

// Reusable public/private toggle (create + edit).
function VisibilityToggle({
  isPublic,
  onChange,
}: {
  isPublic: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const options = [
    { value: false, label: t('lists.private'), hint: t('lists.privateHint') },
    { value: true, label: t('lists.public'), hint: t('lists.publicHint') },
  ] as const;
  return (
    <div className="flex gap-2 text-xs">
      {options.map(({ value, label, hint }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(value)}
          title={hint}
          className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${
            isPublic === value
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400'
          }`}
        >
          <span className="block font-medium">{label}</span>
          <span className="block text-[11px] opacity-80">{hint}</span>
        </button>
      ))}
    </div>
  );
}

function ListCard({
  list,
  isSelf,
  onChanged,
}: {
  list: GameListSummary;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  // Local coverUrl: updated immediately after framing (before the refetch).
  const [coverUrl, setCoverUrl] = useState(list.coverUrl);
  // …but RESYNC when the parent returns fresh data (after reload): otherwise a removed/changed cover only shows on a manual reload.
  useEffect(() => setCoverUrl(list.coverUrl), [list.coverUrl]);
  const [coverOpen, setCoverOpen] = useState(false);
  const cover = coverUrl ? parseFrame(coverUrl) : null;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-stretch gap-3 p-3">
        <button
          type="button"
          onClick={() => (editing ? setCoverOpen((v) => !v) : setExpanded((v) => !v))}
          className="relative h-16 w-24 shrink-0"
          aria-label={editing ? (coverUrl ? t('lists.changeCover') : t('lists.addCover')) : t('lists.viewGames')}
        >
          {cover ? (
            <span className="relative block h-16 w-24 overflow-hidden rounded shadow ring-1 ring-black/10">
              <img src={cover.src} alt="" style={framedImgStyle(cover.scale, cover.x, cover.y)} />
              {editing && (
                <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[9px] font-medium leading-tight text-white">
                  ✎ {t('lists.changeCover')}
                </span>
              )}
            </span>
          ) : editing ? (
            // No cover in edit mode: a dedicated, clearly clickable slot.
            <span className="flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded border border-dashed border-zinc-400/70 bg-zinc-200/50 text-center text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800/50">
              <span aria-hidden="true">✎</span>
              {t('lists.addCover')}
            </span>
          ) : list.covers.length > 0 ? (
            list.covers.slice(0, 4).map((c, i) => (
              <img
                key={i}
                src={c}
                alt=""
                className="absolute top-1/2 h-16 w-11 -translate-y-1/2 rounded object-cover shadow ring-1 ring-black/10"
                style={{ left: `${i * 14}px`, zIndex: i }}
              />
            ))
          ) : (
            <span className="flex h-16 w-full items-center justify-center rounded bg-zinc-200 text-[10px] text-zinc-500 dark:bg-zinc-800">
              {t('lists.empty')}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate font-semibold">{list.name}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t(list.gameCount === 1 ? 'lists.gameOne' : 'lists.gameMany', { count: list.gameCount })}
            {isSelf && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  list.isPublic
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {list.isPublic ? t('lists.public') : t('lists.private')}
              </span>
            )}
          </span>
        </button>

        {isSelf && (
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setCoverOpen(false);
            }}
            aria-label={t('lists.editList')}
            className="shrink-0 self-start rounded-full p-1.5 text-zinc-400 transition hover:text-accent"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 fill-none stroke-current"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        )}
      </div>

      {/* Edit: name/visibility + games, all "pending" until Save (Cancel discards everything, including game removals). Otherwise, expanded = read view with ratings/reviews. */}
      {isSelf && editing && coverOpen && (
        <div className="px-3 pb-1">
          <ListCoverFramer
            listId={list.id}
            coverUrl={coverUrl}
            onChange={(url) => {
              setCoverUrl(url);
              onChanged();
            }}
            onClose={() => setCoverOpen(false)}
          />
        </div>
      )}

      {isSelf && editing ? (
        <EditList
          list={list}
          onDone={() => {
            setEditing(false);
            setCoverOpen(false);
            onChanged();
          }}
        />
      ) : (
        expanded && <ListGames listId={list.id} isSelf={isSelf} onChanged={onChanged} />
      )}
    </div>
  );
}

// Search + add games to a list (edit mode). Immediate add (POST item) then refresh. Respects the server limit (30 games → 409).
function AddGamesToList({
  listId,
  existingIds,
  onAdded,
}: {
  listId: number;
  existingIds: Set<number>;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
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

  async function add(gameId: number) {
    setBusyId(gameId);
    setError(null);
    try {
      await apiFetch(`/lists/${listId}/items`, {
        method: 'POST',
        body: JSON.stringify({ gameId }),
      });
      setQuery('');
      setResults([]);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lists.error'));
    } finally {
      setBusyId(null);
    }
  }

  const full = existingIds.size >= MAX_GAMES_PER_LIST;

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={full}
        placeholder={
          full
            ? t('lists.limitReached', { max: MAX_GAMES_PER_LIST })
            : t('lists.addGamePlaceholder')
        }
        className="field w-full px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-500"
      />
      {!full && results.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          {results.map((g) => {
            const already = existingIds.has(g.id);
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => add(g.id)}
                  disabled={already || busyId === g.id}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                >
                  {g.coverUrl ? (
                    <img src={g.coverUrl} alt="" className="h-8 w-6 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="h-8 w-6 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{g.title}</span>
                  {already ? (
                    <span className="shrink-0 text-[10px] text-zinc-400">{t('lists.alreadyIn')}</span>
                  ) : (
                    <span className="shrink-0 text-lg font-semibold leading-none text-accent" aria-hidden>
                      +
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// Full list editing: name, visibility AND games — all "pending". The trash MARKS a game for removal (struck through, reversible) with no network call; "Save" applies name/visibility + marked removals; "Cancel" (onDone) discards everything.
function EditList({ list, onDone }: { list: GameListSummary; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(list.name);
  const [isPublic, setIsPublic] = useState(list.isPublic);
  const [detail, setDetail] = useState<GameListDetail | null>(null);
  const [removals, setRemovals] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compactOverride, setCompactOverride] = useState<boolean | null>(null);

  const loadDetail = useCallback(() => {
    apiFetch<GameListDetail>(`/lists/${list.id}`)
      .then(setDetail)
      .catch(() => {});
  }, [list.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const compact = compactOverride ?? (detail ? detail.games.length > 6 : false);

  const toggleRemoval = (gameId: number) =>
    setRemovals((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });

  // LIVE drag-and-drop reordering: hovering another game while dragging moves it there (others slide via Flip). Order is persisted (PATCH) only on drop; on failure, reload.
  const dragId = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const gamesWrapRef = useRef<HTMLDivElement>(null);
  const flipState = useRef<ReturnType<typeof Flip.getState> | null>(null);

  // Live reordering handled at the CONTAINER level (not per item) → works even in gaps, at edges, or when the cursor leaves the frame: insert at the nearest slot. Unified list/grid rule: insertion index = number of items (excluding the dragged one) whose center (x+y) precedes the cursor.
  function moveOver(e: ReactDragEvent<HTMLElement>) {
    e.preventDefault(); // allow drop / dragend anywhere in the container
    const from = dragId.current;
    const wrap = gamesWrapRef.current;
    if (from == null || !detail || !wrap) return;
    const items = Array.from(wrap.querySelectorAll<HTMLElement>('[data-flip]'));
    let insertIdx = 0;
    for (const el of items) {
      if (Number(el.dataset.id) === from) continue;
      const r = el.getBoundingClientRect();
      // List (full width): compare ONLY on Y (else centerX ≫ left cursor skews it). Grid: 2D center (x+y) for reading order.
      const beforeCursor = compact
        ? r.left + r.width / 2 + (r.top + r.height / 2) < e.clientX + e.clientY
        : r.top + r.height / 2 < e.clientY;
      if (beforeCursor) insertIdx += 1;
    }
    const games = detail.games;
    const fromIdx = games.findIndex((g) => g.id === from);
    if (fromIdx < 0) return;
    const next = [...games];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(insertIdx, 0, moved);
    if (next.every((g, i) => g.id === games[i].id)) return; // no change
    flipState.current = Flip.getState(items);
    setDetail({ ...detail, games: next });
  }

  function endDrag() {
    dragId.current = null;
    setDraggingId(null);
    if (!detail) return;
    apiFetch(`/lists/${list.id}/order`, {
      method: 'PATCH',
      body: JSON.stringify({ gameIds: detail.games.map((g) => g.id) }),
    }).catch(() => loadDetail());
  }

  // After each move, Flip slides each cover from its old position to the new one. No `absolute`: otherwise the container collapses during the anim → the whole block flickers.
  useLayoutEffect(() => {
    if (!flipState.current) return;
    Flip.from(flipState.current, { duration: 0.2, ease: 'power2.out' });
    flipState.current = null;
  }, [detail?.games]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/lists/${list.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), isPublic }),
      });
      for (const gameId of removals) {
        await apiFetch(`/lists/${list.id}/items/${gameId}`, { method: 'DELETE' });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lists.error'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('lists.confirmDelete', { name: list.name }))) return;
    setBusy(true);
    try {
      await apiFetch(`/lists/${list.id}`, { method: 'DELETE' });
      onDone();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        className="field px-3 py-2 text-sm"
      />
      <VisibilityToggle isPublic={isPublic} onChange={setIsPublic} />

      {detail && detail.games.length > 0 && (
        <div ref={gamesWrapRef} onDragOver={moveOver} className="flex flex-col gap-2">
          <div className="flex justify-end">
            <ViewToggle compact={compact} onChange={setCompactOverride} />
          </div>

          {compact ? (
            // Compact: multi-row cover grid; remove/undo overlaid (cover greyed if marked).
            <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              {detail.games.map((g) => {
                const marked = removals.has(g.id);
                return (
                  <div
                    key={g.id}
                    data-flip
                    data-id={g.id}
                    draggable
                    onDragStart={() => {
                      dragId.current = g.id;
                      setDraggingId(g.id);
                    }}
                    onDragEnd={endDrag}
                    className={`relative cursor-move ${draggingId === g.id ? 'opacity-40' : ''}`}
                  >
                    {g.coverUrl ? (
                      <img
                        src={g.coverUrl}
                        alt={g.title}
                        className={`h-24 w-16 rounded object-cover ring-1 ring-black/10 transition ${
                          marked ? 'opacity-40' : ''
                        }`}
                      />
                    ) : (
                      <span
                        className={`flex h-24 w-16 items-center justify-center rounded bg-zinc-200 p-1 text-center text-[9px] text-zinc-500 dark:bg-zinc-800 ${
                          marked ? 'opacity-40' : ''
                        }`}
                      >
                        {g.title}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleRemoval(g.id)}
                      aria-label={
                        marked ? t('lists.undoRemove') : t('lists.removeGame', { title: g.title })
                      }
                      title={
                        marked ? t('lists.undoRemove') : t('lists.removeGame', { title: g.title })
                      }
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/70 text-white transition hover:bg-zinc-950"
                    >
                      {marked ? (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5 fill-none stroke-current"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 7v6h6" />
                          <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5 fill-none stroke-current"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {detail.games.map((g) => {
                const marked = removals.has(g.id);
                return (
                  <li
                    key={g.id}
                    data-flip
                    data-id={g.id}
                    draggable
                    onDragStart={() => {
                      dragId.current = g.id;
                      setDraggingId(g.id);
                    }}
                    onDragEnd={endDrag}
                    className={`flex items-center gap-2 py-2 pl-1.5 pr-1.5 transition ${
                      marked || draggingId === g.id ? 'opacity-50' : ''
                    }`}
                  >
                    <span
                      className="shrink-0 cursor-move text-zinc-300 dark:text-zinc-600"
                      title={t('lists.dragToReorder')}
                      aria-hidden
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                        <circle cx="9" cy="6" r="1.4" />
                        <circle cx="15" cy="6" r="1.4" />
                        <circle cx="9" cy="12" r="1.4" />
                        <circle cx="15" cy="12" r="1.4" />
                        <circle cx="9" cy="18" r="1.4" />
                        <circle cx="15" cy="18" r="1.4" />
                      </svg>
                    </span>
                    {g.coverUrl ? (
                      <img src={g.coverUrl} alt="" className="h-10 w-7 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="h-10 w-7 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
                    )}
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${marked ? 'line-through' : ''}`}
                    >
                      {g.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleRemoval(g.id)}
                      aria-label={
                        marked ? t('lists.undoRemove') : t('lists.removeGame', { title: g.title })
                      }
                      title={
                        marked ? t('lists.undoRemove') : t('lists.removeGame', { title: g.title })
                      }
                      className={`shrink-0 rounded-full transition ${
                        marked
                          ? 'px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10'
                          : 'flex h-8 w-8 items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {marked ? (
                        t('lists.cancel')
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4 fill-none stroke-current"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={save}
          disabled={busy || !name.trim()}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {t('lists.save')}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-sm text-red-400 transition hover:text-red-300 disabled:opacity-50"
        >
          {t('lists.delete')}
        </button>
      </div>
    </div>
  );
}

// Games of a list in READ mode (collapsible on click): cover + title + rating/review excerpt. For the owner (isSelf), an add-games field is available here directly (no need to go through "edit"). Removals live in EditList.
function ListGames({
  listId,
  isSelf,
  onChanged,
}: {
  listId: number;
  isSelf: boolean;
  // Notifies the PARENT (ProfileLists) that a game was added → it refetches so the thumbnail cover (game covers) updates live.
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<GameListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = auto (compact beyond 6); otherwise a manual choice via the switch.
  const [compactOverride, setCompactOverride] = useState<boolean | null>(null);

  const load = useCallback(() => {
    apiFetch<GameListDetail>(`/lists/${listId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('lists.error')));
  }, [listId, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <p className="border-t border-zinc-200 p-3 text-xs text-red-400 dark:border-zinc-800">
        {error}
      </p>
    );
  if (!detail)
    return (
      <p className="border-t border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
        {t('lists.loading')}
      </p>
    );
  // Compact = multi-row cover grid (with rating badge); detailed = rows with the review excerpt. Default: compact beyond 6, else detailed.
  const compact = compactOverride ?? detail.games.length > 6;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      {isSelf && (
        <div className="p-3 pb-0">
          <AddGamesToList
            listId={listId}
            existingIds={new Set(detail.games.map((g) => g.id))}
            onAdded={() => {
              load(); // refresh the expanded view
              onChanged?.(); // + the thumbnail cover in the parent
            }}
          />
        </div>
      )}

      {detail.games.length === 0 ? (
        <p className="p-3 text-xs text-zinc-500 dark:text-zinc-400">{t('lists.listEmpty')}</p>
      ) : (
        <>
          <div className="flex justify-end px-3 pt-2">
            <ViewToggle compact={compact} onChange={setCompactOverride} />
          </div>

          {compact ? (
        <div className="flex flex-wrap gap-2 p-3 pt-2">
          {detail.games.map((g) => (
            <Link key={g.id} to={`/game/${g.id}`} title={g.title} className="relative block">
              {g.coverUrl ? (
                <img
                  src={g.coverUrl}
                  alt={g.title}
                  className="h-24 w-16 rounded object-cover ring-1 ring-black/10 transition hover:opacity-80"
                />
              ) : (
                <span className="flex h-24 w-16 items-center justify-center rounded bg-zinc-200 p-1 text-center text-[9px] text-zinc-500 dark:bg-zinc-800">
                  {g.title}
                </span>
              )}
              {g.review && (
                <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-zinc-950/80 px-1 py-0.5 text-[10px] font-semibold text-amber-400">
                  <StarIcon className="h-2.5 w-2.5" />
                  {g.review.rating}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {detail.games.map((g) => (
            <li key={g.id} className="flex gap-3 p-3">
              <Link to={`/game/${g.id}`} className="shrink-0">
                {g.coverUrl ? (
                  <img
                    src={g.coverUrl}
                    alt={g.title}
                    className="h-16 w-11 rounded object-cover ring-1 ring-black/10 transition hover:opacity-80"
                  />
                ) : (
                  <span className="flex h-16 w-11 items-center justify-center rounded bg-zinc-200 p-1 text-center text-[9px] text-zinc-500 dark:bg-zinc-800">
                    {g.title}
                  </span>
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <Link
                  to={`/game/${g.id}`}
                  className="block truncate text-sm font-medium hover:text-accent"
                >
                  {g.title}
                </Link>

                {g.review ? (
                  <Link to={`/game/${g.id}#review-${g.review.id}`} className="mt-1 block">
                    <Stars rating={g.review.rating} className="text-amber-500" />
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-zinc-600 dark:text-zinc-300">
                        « {g.review.title} »
                      </span>{' '}
                      {g.review.text}
                    </p>
                  </Link>
                ) : (
                  <p className="mt-1 text-xs italic text-zinc-400 dark:text-zinc-500">
                    {t('lists.noReview')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
        </>
      )}
    </div>
  );
}

// Toggle compact view (cover grid) / detailed (rows with reviews).
function ViewToggle({ compact, onChange }: { compact: boolean; onChange: (c: boolean) => void }) {
  const { t } = useTranslation();
  const cls = (active: boolean) =>
    `rounded p-1 transition ${active ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-accent'}`;
  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-label={t('lists.viewDetailed')}
        title={t('lists.viewDetailed')}
        aria-pressed={!compact}
        className={cls(!compact)}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 fill-none stroke-current"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-label={t('lists.viewCompact')}
        title={t('lists.viewCompact')}
        aria-pressed={compact}
        className={cls(compact)}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 fill-none stroke-current"
          strokeWidth="1.7"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
    </div>
  );
}
