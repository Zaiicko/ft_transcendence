import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import Modal from './Modal';

// Modale de rattachement Xbox, modèle "juste le gamertag" (comme PSN) :
// l'utilisateur tape son gamertag public, le backend le résout en XUID via sa
// clé service OpenXBL. Aucun jeton à coller. Le profil Xbox doit être public
// pour être trouvé. Au succès on affiche le gamertag puis on rafraîchit.
export default function XboxConnectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [gamertag, setGamertag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  async function connect() {
    const gt = gamertag.trim();
    if (!gt || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ gamertag: string }>('/xbox/link', {
        method: 'POST',
        body: JSON.stringify({ gamertag: gt }),
      });
      setLinked(res.gamertag || gt);
      await refreshUser();
      setTimeout(onClose, 1400);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t('settings.xbox.alreadyLinked'));
      } else if (e instanceof ApiError && e.status === 404) {
        setError(t('settings.xbox.notFound'));
      } else if (e instanceof ApiError && e.status === 400) {
        setError(t('settings.xbox.invalidId'));
      } else if (e instanceof ApiError && e.status === 503) {
        setError(t('settings.xbox.notConfigured'));
      } else {
        setError(t('settings.xbox.genericError'));
      }
      setBusy(false);
    }
  }

  return (
    <Modal title={t('settings.xbox.title')} onClose={onClose}>
      {linked ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-500">
            <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current stroke-2">
              <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="font-medium">{t('settings.xbox.connectedAs', { gamertag: linked })}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('settings.xbox.intro')}</p>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('settings.xbox.idLabel')}</label>
            <input
              type="text"
              value={gamertag}
              onChange={(e) => setGamertag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-accent dark:border-zinc-700"
            />
          </div>

          {/* Rappel : le profil doit être public pour être importé */}
          <p className="flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            <svg
              viewBox="0 0 24 24"
              className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-current"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01M11 12h1v4h1" />
            </svg>
            {t('settings.xbox.publicHint')}
          </p>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:opacity-70 dark:border-zinc-600"
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              onClick={connect}
              disabled={busy || !gamertag.trim()}
              className="rounded-full bg-accent px-5 py-1.5 text-sm font-medium text-zinc-950 transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t('settings.xbox.connecting') : t('settings.xbox.connect')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
