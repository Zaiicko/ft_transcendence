import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRequireAuth } from '../auth/useRequireAuth';
import { apiFetch, ApiError } from '../lib/api';
import type { GameListSummary } from '../lib/types';

// Bouton "signet" sur la fiche jeu : ouvre un menu des listes du viewer avec
// une coche par liste contenant déjà ce jeu. Cliquer bascule l'appartenance
// (POST/DELETE item, idempotent). Création rapide d'une liste en bas du menu.
export default function AddToListButton({
  gameId,
  onDark = false,
}: {
  gameId: number;
  onDark?: boolean;
}) {
  const { t } = useTranslation();
  const requireAuth = useRequireAuth();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<GameListSummary[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur / touche Échap
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // (Re)charge les listes + l'appartenance de ce jeu à l'ouverture
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<GameListSummary[]>(`/lists/mine?gameId=${gameId}`)
      .then((l) => {
        if (!cancelled) setLists(l);
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, gameId]);

  async function toggle(list: GameListSummary) {
    setBusyId(list.id);
    const adding = !list.contains;
    try {
      if (adding) {
        await apiFetch(`/lists/${list.id}/items`, {
          method: 'POST',
          body: JSON.stringify({ gameId }),
        });
      } else {
        await apiFetch(`/lists/${list.id}/items/${gameId}`, { method: 'DELETE' });
      }
      setLists(
        (cur) =>
          cur?.map((l) =>
            l.id === list.id
              ? { ...l, contains: adding, gameCount: l.gameCount + (adding ? 1 : -1) }
              : l,
          ) ?? null,
      );
    } catch {
      /* silencieux : l'état reste tel quel */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => requireAuth() && setOpen((v) => !v)}
        title={t('lists.addToList')}
        aria-label={t('lists.addToList')}
        aria-expanded={open}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
          onDark
            ? 'border-zinc-100/25 bg-zinc-950/30 text-zinc-200 backdrop-blur hover:border-accent hover:text-accent'
            : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
        }`}
      >
        {/* Signet filaire (trait 1.6, style TiMN) */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 fill-none stroke-current"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && (
        // Sur la bannière (onDark), l'en-tête est dans un conteneur
        // overflow-hidden : on ouvre vers le haut pour ne pas être rogné.
        <div
          className={`absolute left-0 z-20 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
            onDark ? 'bottom-full mb-2' : 'mt-2'
          }`}
        >
          <div className="max-h-64 overflow-y-auto">
            {lists === null ? (
              <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{t('lists.loading')}</p>
            ) : lists.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('lists.menuEmpty')}
              </p>
            ) : (
              <ul className="py-1">
                {lists.map((list) => (
                  <li key={list.id}>
                    <button
                      type="button"
                      onClick={() => toggle(list)}
                      disabled={busyId === list.id}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          list.contains
                            ? 'border-accent bg-accent text-zinc-950'
                            : 'border-zinc-400 dark:border-zinc-600'
                        }`}
                      >
                        {list.contains && (
                          <svg
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5 fill-none stroke-current"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="m5 12 5 5 9-11" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{list.name}</span>
                      {!list.isPublic && (
                        <span className="shrink-0 text-[10px] text-zinc-400">{t('lists.privateShort')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <QuickCreate
            gameId={gameId}
            onCreated={(created) => setLists((cur) => [created, ...(cur ?? [])])}
          />
        </div>
      )}
    </div>
  );
}

// Crée une liste et y ajoute directement le jeu courant
function QuickCreate({
  gameId,
  onCreated,
}: {
  gameId: number;
  onCreated: (list: GameListSummary) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<GameListSummary>('/lists', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), isPublic: false }),
      });
      await apiFetch(`/lists/${created.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ gameId }),
      });
      onCreated({ ...created, contains: true, gameCount: 1 });
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lists.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-700"
    >
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder={t('lists.quickPlaceholder')}
          className="field flex-1 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          aria-label={t('lists.createAria')}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          +
        </button>
      </div>
      {error && <p className="px-1 text-xs text-red-400">{error}</p>}
    </form>
  );
}
