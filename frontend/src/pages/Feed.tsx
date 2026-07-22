import { useTranslation } from 'react-i18next';
import FriendFeed from '../components/FriendFeed';

// Page dédiée : l'activité récente des amis (avis + jeux faits), en temps réel
export default function Feed() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{t('feed.title')}</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t('feed.subtitle')}</p>
      <FriendFeed />
    </div>
  );
}
