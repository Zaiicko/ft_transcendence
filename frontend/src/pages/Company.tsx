import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import ReviewsSection, { ReviewStats } from '../components/ReviewsSection';
import Skeleton from '../components/Skeleton';
import { StarIcon } from '../components/Stars';
import { apiFetch } from '../lib/api';
import { CompanyDetail } from '../lib/types';
import { useOgLangSync } from '../lib/useOgLangSync';

const GAMES_STEP = 18;

export default function Company() {
  const { t } = useTranslation();
  const { id } = useParams();
  const companyId = Number(id);
  useOgLangSync();

  // Result tagged by id: stale content ignored on studio change; company === null → 404.
  const [loaded, setLoaded] = useState<{ id: number; company: CompanyDetail | null } | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CompanyDetail>(`/companies/${companyId}`)
      .then((c) => {
        if (!cancelled) setLoaded({ id: companyId, company: c });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: companyId, company: null });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Some studios have hundreds of games — show a first batch, button reveals more.
  const [shownGames, setShownGames] = useState(GAMES_STEP);

  const company = loaded?.id === companyId ? loaded.company : undefined;

  if (company === null)
    return <p className="py-24 text-center text-zinc-400">{t('company.notFound')}</p>;
  if (!company)
    return (
      <div className="flex flex-col gap-10">
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-10">
      <div className="card flex flex-col items-start gap-6 p-6 sm:flex-row sm:items-center">
        {company.logoUrl ? (
          <img
            src={company.logoUrl}
            alt=""
            className="h-24 w-24 shrink-0 rounded-xl bg-white object-contain p-3 shadow"
          />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-zinc-200 text-3xl font-bold text-zinc-500 dark:bg-zinc-800">
            {company.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('company.label')}
          </span>
          <h1 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
            {company.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
            {stats && stats._count > 0 && stats._avg.rating != null && (
              <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                <StarIcon className="h-3.5 w-3.5" />
                {stats._avg.rating.toFixed(1)}/10
                <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                  ({t(stats._count === 1 ? 'profile.reviewOne' : 'profile.reviewMany', {
                    count: stats._count,
                  })})
                </span>
              </span>
            )}
            <span className="text-zinc-500 dark:text-zinc-400">
              {t(company._count.games === 1 ? 'lists.gameOne' : 'lists.gameMany', {
                count: company._count.games,
              })}
            </span>
          </div>
        </div>
      </div>

      {company.games.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t('company.games')}
          </h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {company.games.slice(0, shownGames).map((g) => (
              <Link key={g.id} to={`/game/${g.id}`} className="group">
                {g.coverUrl ? (
                  <img
                    src={g.coverUrl}
                    alt={g.title}
                    className="aspect-[3/4] w-full rounded-lg object-cover transition group-hover:scale-105 group-hover:shadow-xl"
                  />
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-zinc-200 p-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {g.title}
                  </div>
                )}
                <span
                  className="mt-1 block truncate text-xs text-zinc-600 dark:text-zinc-400"
                  title={g.title}
                >
                  {g.title}
                </span>
              </Link>
            ))}
          </div>
          {shownGames < company.games.length && (
            <button
              type="button"
              onClick={() => setShownGames((n) => n + GAMES_STEP * 2)}
              className="mx-auto mt-4 block rounded-lg border border-zinc-400 px-6 py-2 text-sm hover:opacity-70 dark:border-zinc-700"
            >
              {t('company.seeMore', { count: company.games.length - shownGames })}
            </button>
          )}
        </section>
      )}

      <ReviewsSection target={{ kind: 'company', id: companyId }} onStats={setStats} />
    </div>
  );
}
