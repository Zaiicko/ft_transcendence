import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import SectionHead from './SectionHead';

// Customizable types (must match NotificationsService.CUSTOMIZABLE); labels/hints from i18n.
const TYPES: { key: string; labelKey: string; hintKey: string }[] = [
  { key: 'FRIEND_REQUEST', labelKey: 'notifications.prefFriendRequest', hintKey: 'notifications.prefFriendRequestHint' },
  { key: 'FRIEND_ACCEPT', labelKey: 'notifications.prefFriendAccept', hintKey: 'notifications.prefFriendAcceptHint' },
  { key: 'REVIEW_LIKE', labelKey: 'notifications.prefReviewLike', hintKey: 'notifications.prefReviewLikeHint' },
  { key: 'REVIEW_COMMENT', labelKey: 'notifications.prefReviewComment', hintKey: 'notifications.prefReviewCommentHint' },
  { key: 'COMMENT_REPLY', labelKey: 'notifications.prefCommentReply', hintKey: 'notifications.prefCommentReplyHint' },
  { key: 'FRIEND_JOINED', labelKey: 'notifications.prefFriendJoined', hintKey: 'notifications.prefFriendJoinedHint' },
  { key: 'ACHIEVEMENT', labelKey: 'notifications.prefAchievement', hintKey: 'notifications.prefAchievementHint' },
];

// Outline bell icon (1.6 stroke), shared by the section and title.
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

// Reusable per-type toggle list (opt-out), used in Settings and the gear menu.
export function NotificationPrefsList() {
  const { t } = useTranslation();
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
      // Optimistic: send the change, roll back on error.
      apiFetch('/notifications/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: next[key] }),
      }).catch(() => setPrefs((c) => (c ? { ...c, [key]: !next[key] } : c)));
      return next;
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {TYPES.map((type) => {
        const on = prefs?.[type.key] ?? true;
        return (
          <li key={type.key} className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(type.labelKey)}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t(type.hintKey)}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={t(type.labelKey)}
              disabled={!prefs}
              onClick={() => toggle(type.key)}
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

// Notifications section of the Settings page.
export default function NotificationSettings() {
  const { t } = useTranslation();
  return (
    <div className="card p-5">
      <SectionHead className="mb-2" title={t('notifications.title')} />
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t('notifications.prefsDescription')}</p>
      <NotificationPrefsList />
    </div>
  );
}
