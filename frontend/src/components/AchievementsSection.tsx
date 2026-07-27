import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { FAMILY_DESC_KEY, FAMILY_NAME_KEY, tierClasses } from '../lib/achievements';
import { Achievement, AchievementFamily, AchievementsPayload, GameRef } from '../lib/types';
import AchievementIcon from './AchievementIcon';

// Ordre d'affichage des familles
const FAMILY_ORDER: AchievementFamily[] = [
  'completions',
  'perfect',
  'reviews',
  'popular',
  'supporter',
  'favorite',
  'harsh',
  'genres',
  'studio',
  'lists',
  'friends',
  'linked',
  'veteran',
];

interface FamilyGroup {
  family: AchievementFamily;
  tiers: Achievement[]; // triés par palier croissant
  unlocked: number;
  highestTier: number; // palier max débloqué (0 = aucun) → teinte de l'icône
}

// Section « Succès » du profil : un badge par FAMILLE (pas un par palier). Clic
// sur un badge → panneau détaillant chaque palier (débloqué + date, ou barre de
// progression) avec la description complète.
export default function AchievementsSection({ userId }: { userId: number }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [selected, setSelected] = useState<AchievementFamily | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AchievementsPayload>(`/achievements/user/${userId}`)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ items: [], ratedGames: { favorite: [], harsh: [] } }));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const items = data?.items ?? null;

  const groups = useMemo<FamilyGroup[]>(() => {
    if (!items) return [];
    const byFamily = new Map<AchievementFamily, Achievement[]>();
    for (const a of items) {
      const arr = byFamily.get(a.family) ?? [];
      arr.push(a);
      byFamily.set(a.family, arr);
    }
    return FAMILY_ORDER.filter((f) => byFamily.has(f)).map((family) => {
      const tiers = byFamily.get(family)!.sort((x, y) => x.tier - y.tier);
      const unlockedTiers = tiers.filter((tt) => tt.unlocked);
      return {
        family,
        tiers,
        unlocked: unlockedTiers.length,
        highestTier: unlockedTiers.reduce((m, tt) => Math.max(m, tt.tier), 0),
      };
    });
  }, [items]);

  if (!items || groups.length === 0) return null;

  const totalUnlocked = items.filter((a) => a.unlocked).length;
  const active = groups.find((g) => g.family === selected) ?? null;

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {t('achievements.sectionTitle')}
        </h2>
        <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
          {totalUnlocked} / {items.length}
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {groups.map((g) => {
          const isOpen = selected === g.family;
          return (
            <li key={g.family}>
              <button
                type="button"
                onClick={() => setSelected(isOpen ? null : g.family)}
                aria-expanded={isOpen}
                className={`card flex w-full items-center gap-3 p-3 text-left transition hover:border-zinc-400 dark:hover:border-zinc-600 ${
                  isOpen ? 'border-accent ring-1 ring-accent' : ''
                }`}
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${
                    g.highestTier > 0
                      ? tierClasses(g.highestTier)
                      : 'bg-zinc-200/60 text-zinc-400 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700'
                  }`}
                >
                  <AchievementIcon family={g.family} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {t(FAMILY_NAME_KEY[g.family])}
                  </span>
                  <span className="mt-0.5 block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {t('achievements.tiersUnlocked', { count: g.unlocked, total: g.tiers.length })}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Panneau détaillé de la famille sélectionnée (descriptions complètes) */}
      {active && (
        <div className="card mt-3 p-4">
          <div className="mb-3 flex items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${
                active.highestTier > 0
                  ? tierClasses(active.highestTier)
                  : 'bg-zinc-200/60 text-zinc-400 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700'
              }`}
            >
              <AchievementIcon family={active.family} className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t(FAMILY_NAME_KEY[active.family])}
            </h3>
          </div>

          <ol className="space-y-2.5">
            {active.tiers.map((a) => {
              const pct = Math.round((a.progress / a.threshold) * 100);
              return (
                <li key={a.key} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 tabular-nums ${
                      a.unlocked
                        ? tierClasses(a.tier)
                        : 'bg-zinc-200/60 text-zinc-400 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700'
                    }`}
                  >
                    {a.tier}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-700 dark:text-zinc-200">
                      {t(FAMILY_DESC_KEY[a.family], { count: a.threshold })}
                    </p>
                    {a.unlocked ? (
                      <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        ✓{' '}
                        {a.unlockedAt
                          ? t('achievements.unlockedOn', {
                              date: new Date(a.unlockedAt).toLocaleDateString(i18n.language),
                            })
                          : t('achievements.done')}
                      </p>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                          {a.progress} / {a.threshold}
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Jeux illustrant la famille : notés 10 (coup de cœur) / 0 (sévère) */}
          {(active.family === 'favorite' || active.family === 'harsh') &&
            data &&
            data.ratedGames[active.family].length > 0 && (
              <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {t('achievements.concernedGames')}
                </p>
                <ul className="flex flex-wrap gap-3">
                  {data.ratedGames[active.family].map((g: GameRef) => (
                    <li key={g.id}>
                      <Link to={`/game/${g.id}`} className="flex items-center gap-2 hover:opacity-80">
                        {g.coverUrl ? (
                          <img src={g.coverUrl} alt="" className="h-10 w-8 rounded object-cover" />
                        ) : (
                          <span className="block h-10 w-8 rounded bg-zinc-200 dark:bg-zinc-800" />
                        )}
                        <span className="max-w-[10rem] truncate text-sm">{g.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      )}
    </section>
  );
}
