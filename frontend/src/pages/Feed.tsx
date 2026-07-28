import { useTranslation } from 'react-i18next';
import FriendFeed from '../components/FriendFeed';

// Page dédiée : l'activité récente des amis (avis + jeux faits), en temps réel
export default function Feed() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl">
      {/* En-tête immersif brandé + pastille « temps réel » */}
      <header className="relative mb-6 rounded-3xl border border-zinc-900/10 bg-white p-6 shadow-sm dark:border-zinc-100/10 dark:bg-zinc-900 sm:p-7">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -left-10 -top-20 h-64 w-64 rounded-full bg-accent/25 blur-3xl" />
        </div>
        <div className="relative flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              <span className="text-accent">●</span> {t('feed.eyebrow')}
            </div>
            <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
              {t('feed.title')}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{t('feed.subtitle')}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-bold text-green-600 dark:text-green-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            {t('feed.live')}
          </span>
        </div>
      </header>
      <FriendFeed />
    </div>
  );
}
