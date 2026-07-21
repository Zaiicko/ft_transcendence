import FriendFeed from '../components/FriendFeed';

// Page dédiée : l'activité récente des amis (avis + jeux faits), en temps réel
export default function Feed() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Activité de tes amis</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Les dernières critiques et les jeux terminés de tes amis, en direct.
      </p>
      <FriendFeed />
    </div>
  );
}
