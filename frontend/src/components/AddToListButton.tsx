import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRequireAuth } from '../auth/useRequireAuth';
import { apiFetch, ApiError } from '../lib/api';
import type { GameListSummary } from '../lib/types';

const MAX_LISTS = 6;
// Doit rester aligné avec MAX_GAMES_PER_LIST du backend (lists.service)
const MAX_GAMES = 30;

// Bouton "signet" sur la fiche jeu : ouvre un menu des listes du viewer. On coche
// / décoche les listes voulues (sans appel réseau), puis "Valider" applique tous
// les changements d'un coup et referme le menu. Création rapide d'une liste en bas.
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
  // Changements en attente : listId → présence voulue. Appliqués seulement au
  // clic "Valider". Vide = rien de modifié.
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Position calculée (en `fixed`) du menu quand il est posé sur la bannière
  // (onDark) : celle-ci a `overflow-hidden`, donc un menu en `absolute` qui
  // s'ouvre vers le haut se fait rogner dès qu'il y a beaucoup de listes. En
  // `fixed`, ancré au bouton, il échappe au rognage et sa hauteur est bornée à
  // l'espace réellement disponible au-dessus (il défile plutôt que d'être coupé).
  const [coords, setCoords] = useState<{ left: number; bottom: number; maxHeight: number } | null>(
    null,
  );

  // Fermeture au clic extérieur / touche Échap (abandonne les changements)
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

  // (Re)charge les listes + l'appartenance de ce jeu à l'ouverture, et repart
  // d'un état "aucun changement en attente".
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<GameListSummary[]>(`/lists/mine?gameId=${gameId}`)
      .then((l) => {
        if (cancelled) return;
        setLists(l);
        setPending({});
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, gameId]);

  // Calcule/recalcule la position du menu quand il est sur la bannière. Recalé
  // au resize et au scroll (capture) pour rester collé au bouton.
  useLayoutEffect(() => {
    if (!open || !onDark) return;
    function compute() {
      const b = btnRef.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const GAP = 8;
      const width = 256; // w-64
      setCoords({
        // aligné à gauche du bouton, borné pour ne pas déborder de l'écran
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        // posé au-dessus du bouton
        bottom: window.innerHeight - r.top + GAP,
        // jamais plus haut que l'espace libre au-dessus → défilement
        maxHeight: Math.max(120, r.top - GAP - 8),
      });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, onDark]);

  const checked = (list: GameListSummary) => (list.id in pending ? pending[list.id] : !!list.contains);
  const togglePending = (list: GameListSummary) =>
    setPending((p) => ({ ...p, [list.id]: !checked(list) }));

  // On masque une liste PLEINE (30 jeux) qui ne contient pas ce jeu : on ne peut
  // pas l'y ajouter. Une liste pleine qui le contient déjà reste visible (pour
  // pouvoir l'en retirer).
  const visibleLists = (lists ?? []).filter((l) => l.contains || l.gameCount < MAX_GAMES);

  // Applique tous les changements (seulement ceux qui diffèrent de l'état
  // serveur), puis referme.
  async function validate() {
    if (!lists) return;
    setSaving(true);
    try {
      for (const list of lists) {
        const desired = checked(list);
        if (desired === !!list.contains) continue;
        if (desired) {
          await apiFetch(`/lists/${list.id}/items`, {
            method: 'POST',
            body: JSON.stringify({ gameId }),
          });
        } else {
          await apiFetch(`/lists/${list.id}/items/${gameId}`, { method: 'DELETE' });
        }
      }
      setOpen(false);
      setPending({});
    } catch {
      /* silencieux : l'état reste tel quel */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
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

      {open && (!onDark || coords) && (
        // Sur la bannière (onDark), le conteneur parent a `overflow-hidden` : on
        // sort le menu du flux avec un positionnement `fixed` (ancré au bouton)
        // pour qu'il ne soit pas rogné, avec une hauteur bornée qui le fait
        // défiler. Hors bannière, simple menu déroulant en dessous.
        <div
          style={
            onDark && coords
              ? { position: 'fixed', left: coords.left, bottom: coords.bottom, maxHeight: coords.maxHeight, zIndex: 30 }
              : undefined
          }
          className={`flex w-64 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
            onDark ? '' : 'absolute left-0 z-20 mt-2'
          }`}
        >
          <div className={onDark ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-64 overflow-y-auto'}>
            {lists === null ? (
              <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{t('lists.loading')}</p>
            ) : visibleLists.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('lists.menuEmpty')}
              </p>
            ) : (
              <ul className="py-1">
                {visibleLists.map((list) => (
                  <li key={list.id}>
                    <button
                      type="button"
                      onClick={() => togglePending(list)}
                      aria-pressed={checked(list)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          checked(list)
                            ? 'border-accent bg-accent text-zinc-950'
                            : 'border-zinc-400 dark:border-zinc-600'
                        }`}
                      >
                        {checked(list) && (
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

          {/* Création rapide — masquée une fois la limite de listes atteinte */}
          {lists && lists.length < MAX_LISTS && (
            <QuickCreate
              gameId={gameId}
              onCreated={(created) => setLists((cur) => [created, ...(cur ?? [])])}
            />
          )}

          {/* Barre "Valider" : applique les cases cochées puis ferme */}
          {visibleLists.length > 0 && (
            <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-700">
              <button
                type="button"
                onClick={validate}
                disabled={saving}
                className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? t('common.saving') : t('lists.validate')}
              </button>
            </div>
          )}
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
      className="flex shrink-0 flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-700"
    >
      <div className="flex items-stretch gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder={t('lists.quickPlaceholder')}
          className="field min-w-0 flex-1 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          aria-label={t('lists.createAria')}
          className="flex w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-lg font-semibold leading-none text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          +
        </button>
      </div>
      {error && <p className="px-1 text-xs text-red-400">{error}</p>}
    </form>
  );
}
