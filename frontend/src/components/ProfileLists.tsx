import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import type { GameListDetail, GameListSummary } from '../lib/types';

// Section "Listes" du profil. Pour le propriétaire (isSelf) : gestion complète
// (création, renommage, public/privé, suppression, retrait de jeux) sur toutes
// ses listes. Pour un visiteur : seules les listes publiques, en lecture seule.
export default function ProfileLists({
  isSelf,
  publicLists,
}: {
  isSelf: boolean;
  publicLists: GameListSummary[];
}) {
  const [lists, setLists] = useState<GameListSummary[]>(publicLists);
  const [creating, setCreating] = useState(false);

  // Le propriétaire recharge la liste complète (publiques + privées) ;
  // le visiteur garde les listes publiques passées par le profil.
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
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Lists
        </h2>
        {isSelf && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-400/60 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
          >
            <span aria-hidden className="text-sm leading-none">
              +
            </span>
            Nouvelle liste
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
          {isSelf
            ? 'Aucune liste pour l’instant. Crée-en une (ex. « Best competitive », « To-do »).'
            : 'Aucune liste publique.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
      setError(err instanceof ApiError ? err.message : 'Erreur');
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
        placeholder="Nom de la liste"
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
          {busy ? 'Création…' : 'Créer'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

// Interrupteur public/privé réutilisé (création + édition)
function VisibilityToggle({
  isPublic,
  onChange,
}: {
  isPublic: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-2 text-xs">
      {([
        [false, 'Privée', 'Visible par toi seul'],
        [true, 'Publique', 'Visible sur ton profil'],
      ] as const).map(([value, label, hint]) => (
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
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-stretch gap-3 p-3">
        {/* Aperçu : jaquettes empilées en éventail */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="relative h-16 w-24 shrink-0"
          aria-label="Voir les jeux"
        >
          {list.covers.length > 0 ? (
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
              vide
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
            {list.gameCount} jeu{list.gameCount > 1 ? 'x' : ''}
            {isSelf && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  list.isPublic
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {list.isPublic ? 'Publique' : 'Privée'}
              </span>
            )}
          </span>
        </button>

        {isSelf && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-label="Modifier la liste"
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

      {isSelf && editing && (
        <EditListRow
          list={list}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}

      {expanded && <ListGames listId={list.id} isSelf={isSelf} onChanged={onChanged} />}
    </div>
  );
}

function EditListRow({ list, onDone }: { list: GameListSummary; onDone: () => void }) {
  const [name, setName] = useState(list.name);
  const [isPublic, setIsPublic] = useState(list.isPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/lists/${list.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), isPublic }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur');
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Supprimer la liste « ${list.name} » ?`)) return;
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
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim()}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            Enregistrer
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-3 py-1.5 text-sm text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Annuler
          </button>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-sm text-red-400 transition hover:text-red-300 disabled:opacity-50"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

// Jeux d'une liste, chargés à la demande (repli). Le propriétaire peut retirer.
function ListGames({
  listId,
  isSelf,
  onChanged,
}: {
  listId: number;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<GameListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<GameListDetail>(`/lists/${listId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erreur'));
  }, [listId]);

  useEffect(() => {
    load();
  }, [load]);

  async function removeGame(gameId: number) {
    const updated = await apiFetch<GameListDetail>(`/lists/${listId}/items/${gameId}`, {
      method: 'DELETE',
    });
    setDetail(updated);
    onChanged(); // rafraîchit l'aperçu (compteur + jaquettes) de la carte
  }

  if (error)
    return (
      <p className="border-t border-zinc-200 p-3 text-xs text-red-400 dark:border-zinc-800">
        {error}
      </p>
    );
  if (!detail)
    return (
      <p className="border-t border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
        Chargement…
      </p>
    );
  if (detail.games.length === 0)
    return (
      <p className="border-t border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Liste vide — ajoute des jeux depuis leur fiche.
      </p>
    );

  return (
    <div className="grid grid-cols-4 gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-5">
      {detail.games.map((g) => (
        <div key={g.id} className="group relative">
          <Link to={`/game/${g.id}`}>
            {g.coverUrl ? (
              <img
                src={g.coverUrl}
                alt={g.title}
                className="aspect-[3/4] w-full rounded object-cover transition group-hover:opacity-80"
              />
            ) : (
              <span className="flex aspect-[3/4] items-center justify-center rounded bg-zinc-200 p-1 text-center text-[10px] text-zinc-500 dark:bg-zinc-800">
                {g.title}
              </span>
            )}
          </Link>
          {isSelf && (
            <button
              type="button"
              onClick={() => removeGame(g.id)}
              aria-label={`Retirer ${g.title}`}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950/70 text-xs text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-500"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
