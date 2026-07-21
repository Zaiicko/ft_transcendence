import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';

// Types personnalisables + libellés FR (doivent matcher NotificationsService.CUSTOMIZABLE)
const TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'FRIEND_REQUEST', label: "Demandes d'ami", hint: "Quand quelqu'un t'envoie une demande" },
  { key: 'FRIEND_ACCEPT', label: 'Demandes acceptées', hint: 'Quand ta demande est acceptée' },
  { key: 'REVIEW_LIKE', label: 'J’aime sur mes avis', hint: 'Quand un avis à toi est aimé' },
  { key: 'REVIEW_COMMENT', label: 'Commentaires sur mes avis', hint: 'Quand on commente un avis à toi' },
  { key: 'COMMENT_REPLY', label: 'Réponses à mes commentaires', hint: 'Quand on répond à ton commentaire' },
  { key: 'FRIEND_JOINED', label: 'Un contact rejoint', hint: 'Quand un contact Steam/42 s’inscrit' },
];

// Cloche filaire (trait 1.6, style TiMN) — partagée par la section et le titre
export function BellIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} fill-none stroke-current`}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// Liste réutilisable des interrupteurs (opt-out par type). Utilisée à la fois
// dans la page Settings et dans la fenêtre du menu rouage.
export function NotificationPrefsList() {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    apiFetch<Record<string, boolean>>('/notifications/preferences')
      .then(setPrefs)
      .catch(() => {});
  }, []);

  function toggle(key: string) {
    setPrefs((cur) => {
      if (!cur) return cur;
      const next = { ...cur, [key]: !cur[key] };
      // Optimiste : on envoie le changement, on revient en arrière si erreur
      apiFetch('/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: next[key] }),
      }).catch(() => setPrefs((c) => (c ? { ...c, [key]: !next[key] } : c)));
      return next;
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {TYPES.map((t) => {
        const on = prefs?.[t.key] ?? true;
        return (
          <li key={t.key} className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t.hint}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={t.label}
              disabled={!prefs}
              onClick={() => toggle(t.key)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                on ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  on ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Section "Notifications" des réglages (page Settings)
export default function NotificationSettings() {
  const { t } = useTranslation();
  return (
    <div className="card mb-10 p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        <BellIcon />
        {t('notifications.title')}
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t('notifications.prefsDescription')}</p>
      <NotificationPrefsList />
    </div>
  );
}
