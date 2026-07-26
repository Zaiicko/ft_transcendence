import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useFriendSocket } from '../friends/useFriendSocket';
import i18n from '../i18n';
import Avatar from '../components/Avatar';
import ShareButton from '../components/ShareButton';
import EmptyState, { CalendarIcon } from '../components/EmptyState';
import DiscordBadge from '../components/DiscordBadge';
import FortyTwoBadge from '../components/FortyTwoBadge';
import LeaderboardRankBadge from '../components/LeaderboardRankBadge';
import Modal from '../components/Modal';
import PsnBadge from '../components/PsnBadge';
import XboxBadge from '../components/XboxBadge';
import ProfileLists from '../components/ProfileLists';
import ProfilePlayedGames from '../components/ProfilePlayedGames';
import ProfileReviews from '../components/ProfileReviews';
import Skeleton from '../components/Skeleton';
import Stars from '../components/Stars';
import SteamBadge from '../components/SteamBadge';
import { apiFetch, ApiError } from '../lib/api';
import type { FriendState, PublicProfile as Profile } from '../lib/types';

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
}

// ---- Yearly completion calendar (GitHub-style heatmap) ----

const DAY_MS = 86_400_000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type CalGame = Profile['calendar'][number]['game'];

function formatDay(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Deux couleurs plates sur un même calendrier : « joué » (accent) et « terminé
// 100 % » (emerald). Pas de dégradé d'intensité — le nombre de jeux est donné en
// clair dans le panneau du jour. Le vert prime si un jour a les deux.
const EMPTY_CELL = 'bg-zinc-200 dark:bg-zinc-800';
const PLAYED_COLOR = 'bg-accent';
const DONE_COLOR = 'bg-emerald-500';

// Libellé court d'un mois / jour de semaine dans la langue active (Intl → pas de
// clés i18n à maintenir). Date de référence en UTC pour éviter tout décalage.
const monthShort = (m: number) =>
  new Date(Date.UTC(2021, m, 1)).toLocaleDateString(i18n.language, { month: 'short', timeZone: 'UTC' });
// 2023-01-01 est un dimanche → +dow donne le bon jour (0 = dimanche, comme getUTCDay)
const weekdayShort = (dow: number) =>
  new Date(Date.UTC(2023, 0, 1 + dow)).toLocaleDateString(i18n.language, {
    weekday: 'short',
    timeZone: 'UTC',
  });

function CompletionCalendar({
  played,
  completed,
}: {
  played: Profile['calendar'];
  completed: Profile['calendar'];
}) {
  const { t } = useTranslation();
  const [yearSel, setYearSel] = useState<string | null>(null);
  // Day whose games are shown in the panel: pinned by click, else hovered
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // dateKey -> { joués, terminés } ce jour-là (les deux séries sur UN calendrier)
  const byDay = useMemo(() => {
    const map = new Map<string, { played: CalGame[]; done: CalGame[] }>();
    const add = (arr: Profile['calendar'], kind: 'played' | 'done') => {
      for (const e of arr) {
        const key = e.playedAt.slice(0, 10);
        const entry = map.get(key) ?? { played: [], done: [] };
        entry[kind].push(e.game);
        map.set(key, entry);
      }
    };
    add(played, 'played');
    add(completed, 'done');
    return map;
  }, [played, completed]);

  const years = useMemo(() => {
    const set = new Set([...played, ...completed].map((e) => e.playedAt.slice(0, 4)));
    return [...set].sort().reverse();
  }, [played, completed]);

  // Année affichée : la sélection si elle existe encore, sinon la plus récente.
  const year = yearSel && years.includes(yearSel) ? yearSel : (years[0] ?? String(new Date().getFullYear()));

  // Colonnes = semaines de 7 jours (dimanche en haut). Padding avant le 1er jan
  // + après le 31 déc pour des colonnes pleines. Mémoïsé sur l'année affichée.
  const { weeks, monthCols, playedTotal, doneTotal } = useMemo(() => {
    const yr = Number(year);
    const startD = new Date(Date.UTC(yr, 0, 1));
    const endD = new Date(Date.UTC(yr, 11, 31));
    const flat: (Date | null)[] = [];
    for (let i = 0; i < startD.getUTCDay(); i++) flat.push(null);
    for (let ts = startD.getTime(); ts <= endD.getTime(); ts += DAY_MS) flat.push(new Date(ts));
    while (flat.length % 7 !== 0) flat.push(null);
    const cols: (Date | null)[][] = [];
    for (let i = 0; i < flat.length; i += 7) cols.push(flat.slice(i, i + 7));
    const labels: (string | null)[] = cols.map((w) => {
      const first = w.find((d) => d && d.getUTCDate() === 1);
      return first ? monthShort(first.getUTCMonth()) : null;
    });
    const inYear = (e: Profile['calendar'][number]) => e.playedAt.slice(0, 4) === year;
    return {
      weeks: cols,
      monthCols: labels,
      playedTotal: played.filter(inYear).length,
      doneTotal: completed.filter(inYear).length,
    };
  }, [year, played, completed]);

  if (played.length === 0 && completed.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title={t('profile.calNoDates')}
        description={t('profile.calNoDatesDesc')}
      />
    );
  }

  // A pinned day (clicked) wins: hovering other days no longer changes the panel
  const activeKey = pinnedKey ?? hoveredKey;
  const activeDay = activeKey ? byDay.get(activeKey) : undefined;
  // Liste combinée du jour actif : terminés d'abord (badge vert), puis joués non
  // déjà terminés ce jour-là (évite les doublons).
  const activeItems = activeDay
    ? (() => {
        const doneIds = new Set(activeDay.done.map((g) => g.id));
        return [
          ...activeDay.done.map((g) => ({ g, done: true })),
          ...activeDay.played.filter((g) => !doneIds.has(g.id)).map((g) => ({ g, done: false })),
        ];
      })()
    : undefined;

  return (
    <div>
      {/* En-tête : totaux joués / terminés (gauche) ; sélecteur d'année (droite) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{playedTotal}</span>{' '}
          {t('profile.calPlayedLabel')} <span className="text-zinc-400 dark:text-zinc-600">·</span>{' '}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{doneTotal}</span>{' '}
          {t('profile.calCompletedLabel')}
        </p>
        {years.length > 1 && (
          <div className="flex gap-1">
            {years.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => {
                  setYearSel(yr);
                  setPinnedKey(null);
                }}
                className={`rounded px-2 py-0.5 text-xs ${
                  yr === year
                    ? 'bg-zinc-200 dark:bg-zinc-700'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Responsive : les colonnes (semaines) sont en flex-1 → toute l'année
          tient dans la largeur dispo, sans scroll horizontal. Hauteur de ligne
          fixe (0.7rem) pour aligner trivialement les libellés de jour/mois. */}
      <div className="pb-1" onMouseLeave={() => setHoveredKey(null)}>
        <div className="flex gap-1 text-[10px] leading-none text-zinc-400 dark:text-zinc-500">
          {/* Colonne des jours de semaine (Lun/Mer/Ven), alignée aux lignes */}
          <div className="mt-4 grid shrink-0 gap-[2px] pr-1" style={{ gridTemplateRows: 'repeat(7, 0.7rem)' }}>
            {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
              <span key={dow} className="flex items-center justify-end">
                {dow % 2 === 1 ? weekdayShort(dow) : ''}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            {/* Labels de mois : un slot flex-1 par semaine (débordent à droite) */}
            <div className="mb-1 flex h-3 gap-[2px]">
              {monthCols.map((label, i) => (
                <span key={i} className="min-w-0 flex-1 whitespace-nowrap">
                  {label ?? ''}
                </span>
              ))}
            </div>

            {/* Grille : colonnes = semaines (flex-1), 7 lignes (dim → sam) */}
            <div className="flex gap-[2px]">
              {weeks.map((w, wi) => (
                <div
                  key={wi}
                  className="grid min-w-0 flex-1 gap-[2px]"
                  style={{ gridTemplateRows: 'repeat(7, 0.7rem)' }}
                >
                  {w.map((d, di) => {
                    if (!d) return <span key={di} className="w-full" />;
                    const key = dateKey(d);
                    const day = byDay.get(key);
                    const pN = day?.played.length ?? 0;
                    const dN = day?.done.length ?? 0;
                    // Terminé (vert) prime ; sinon joué (accent) ; sinon inerte.
                    const cls = dN ? DONE_COLOR : pN ? PLAYED_COLOR : EMPTY_CELL;
                    if (!day) return <span key={di} className={`w-full rounded-sm ${cls}`} />;
                    const parts: string[] = [];
                    if (pN) parts.push(`${pN} ${t('profile.calPlayedLabel')}`);
                    if (dN) parts.push(`${dN} ${t('profile.calCompletedLabel')}`);
                    const label = `${formatDay(key)} — ${parts.join(', ')}`;
                    return (
                      <button
                        key={di}
                        type="button"
                        title={label}
                        aria-label={label}
                        onMouseEnter={() => setHoveredKey(key)}
                        onFocus={() => setHoveredKey(key)}
                        onClick={() => setPinnedKey((k) => (k === key ? null : key))}
                        className={`w-full rounded-sm ${cls} ${
                          key === pinnedKey
                            ? 'ring-2 ring-accent ring-offset-1 dark:ring-offset-zinc-900'
                            : ''
                        }`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Légende : les deux couleurs */}
      <div className="mt-1 flex items-center justify-end gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span className="flex items-center gap-1">
          <span className={`h-3 w-3 rounded-sm ${PLAYED_COLOR}`} /> {t('profile.calViewPlayed')}
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-3 w-3 rounded-sm ${DONE_COLOR}`} /> {t('profile.calViewCompleted')}
        </span>
      </div>

      {/* Jeux du jour survolé/cliqué (pastille verte = terminé, accent = joué) */}
      {activeItems && activeKey ? (
        <div className="card mt-3 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-zinc-500 dark:text-zinc-400">{formatDay(activeKey)}</span>
            {(activeDay?.played.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                <span className={`h-2 w-2 rounded-full ${PLAYED_COLOR}`} />
                {activeDay!.played.length} {t('profile.calViewPlayed')}
              </span>
            )}
            {(activeDay?.done.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                <span className={`h-2 w-2 rounded-full ${DONE_COLOR}`} />
                {activeDay!.done.length} {t('profile.calViewCompleted')}
              </span>
            )}
          </div>
          <ul className="flex flex-wrap gap-3">
            {activeItems.map(({ g, done }) => (
              <li key={`${done ? 'd' : 'p'}-${g.id}`}>
                <Link to={`/game/${g.id}`} className="flex items-center gap-2 hover:opacity-80">
                  <span className="relative">
                    {g.coverUrl ? (
                      <img src={g.coverUrl} alt="" className="h-10 w-8 rounded object-cover" />
                    ) : (
                      <span className="block h-10 w-8 rounded bg-zinc-200 dark:bg-zinc-800" />
                    )}
                    <span
                      className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${
                        done ? 'bg-emerald-500' : 'bg-accent'
                      }`}
                    />
                  </span>
                  <span className="text-sm">{g.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">{t('profile.calHint')}</p>
      )}
    </div>
  );
}

// ---- Friend action button ----

function FriendAction({
  state,
  username,
  onSent,
}: {
  state: FriendState;
  username: string;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state === 'friends')
    return <span className="text-sm text-emerald-500">✓ {t('profile.friends')}</span>;
  if (state === 'outgoing')
    return <span className="text-sm text-zinc-500">{t('profile.requestPending')}</span>;
  if (state === 'incoming')
    return (
      <Link to="/friends" className="text-sm text-zinc-300 underline">
        {t('profile.respondRequest')}
      </Link>
    );
  // state === 'none'
  async function add() {
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/friends/requests/${encodeURIComponent(username)}`, { method: 'POST' });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('profile.couldNotSend'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? t('profile.sending') : t('profile.addFriend')}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}

export default function PublicProfile() {
  const { t } = useTranslation();
  const { username = '' } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Modale ouverte au clic sur un compteur de l'en-tête (avis / jeux faits)
  const [modal, setModal] = useState<'reviews' | 'played' | null>(null);

  // No synchronous setState in the body (react-hooks/set-state-in-effect):
  // every update happens in a promise callback.
  const load = useCallback(
    () =>
      apiFetch<Profile>(`/users/profile/${encodeURIComponent(username)}`)
        .then((p) => {
          setProfile(p);
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : t('profile.couldNotLoad')))
        .finally(() => setLoading(false)),
    [username, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Temps réel : demande envoyée/acceptée/refusée/retirée → le bouton d'amitié
  // (Add friend / Request pending / ✓ Friends) se met à jour sans refresh.
  useFriendSocket(load, !!user);

  if (loading)
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="mb-3 h-4 w-40" />
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  if (error || !profile) return <p className="text-red-400">{error ?? t('profile.notFound')}</p>;

  // Réutilisés comme label du compteur ET comme titre de la modale
  const reviewLabel = t(profile.reviewCount === 1 ? 'profile.reviewOne' : 'profile.reviewMany', {
    count: profile.reviewCount,
  });
  const playedLabel = t(profile.playedCount === 1 ? 'profile.playedGameOne' : 'profile.playedGameMany', {
    count: profile.playedCount,
  });

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar username={profile.username} avatarUrl={profile.avatarUrl} size={96} />
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {profile.username}
            {profile.provider === 'FORTYTWO' && <FortyTwoBadge />}
            {profile.provider === 'DISCORD' && <DiscordBadge />}
            {profile.steamId && <SteamBadge />}
            {profile.psnLinked && <PsnBadge />}
            {profile.xboxLinked && <XboxBadge />}
            <LeaderboardRankBadge userId={profile.id} />
          </h1>
          {profile.bio && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{profile.bio}</p>}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t('profile.memberSince', { date: memberSince(profile.createdAt) })} ·{' '}
            {profile.reviewCount > 0 ? (
              <button
                type="button"
                onClick={() => setModal('reviews')}
                className="underline decoration-dotted underline-offset-2 transition hover:text-accent"
              >
                {reviewLabel}
              </button>
            ) : (
              reviewLabel
            )}{' '}
            ·{' '}
            {profile.playedCount > 0 ? (
              <button
                type="button"
                onClick={() => setModal('played')}
                className="underline decoration-dotted underline-offset-2 transition hover:text-accent"
              >
                {playedLabel}
              </button>
            ) : (
              playedLabel
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:self-start">
          {/* Partager ce profil à un ami */}
          {user && (
            <ShareButton
              target={{ type: 'PROFILE', sharedUserId: profile.id }}
              title={t('profile.shareProfile')}
              triggerClassName="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
            />
          )}
          {profile.friendState === 'self' ? (
            <Link
              to="/settings"
              title={t('profile.editProfile')}
              aria-label={t('profile.editProfile')}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
            >
              {/* Rouage filaire (trait 1.6, style TiMN) */}
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
          ) : user ? (
            <FriendAction
              state={profile.friendState}
              username={profile.username}
              onSent={() => setProfile({ ...profile, friendState: 'outgoing' })}
            />
          ) : null}
        </div>
      </div>

      {/* Top 5 games */}
      {profile.topGames.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('profile.topRated')}</h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {profile.topGames.map(({ game, rating }) => (
              <Link key={game.id} to={`/game/${game.id}`} className="group">
                {game.coverUrl ? (
                  <img
                    src={game.coverUrl}
                    alt={game.title}
                    className="aspect-[3/4] w-full rounded-lg object-cover shadow transition group-hover:opacity-80"
                  />
                ) : (
                  <div className="aspect-[3/4] w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                )}
                <p className="mt-1 truncate text-sm font-medium">{game.title}</p>
                <Stars rating={rating} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Lists / playlists — gestion complète pour le propriétaire, publiques
          seulement pour un visiteur (le composant se masque si rien à montrer) */}
      <ProfileLists
        isSelf={profile.friendState === 'self'}
        publicLists={profile.publicLists}
      />

      {/* Completion calendar */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{t('profile.completionCalendar')}</h2>
        <CompletionCalendar played={profile.calendar} completed={profile.completions} />
      </section>

      {/* Recent reviews — limitées à 10, triables, "Charger plus" */}
      <ProfileReviews username={profile.username} seed={profile.recentReviews} />

      {modal === 'reviews' && (
        <Modal title={reviewLabel} onClose={() => setModal(null)}>
          <ProfileReviews username={profile.username} seed={profile.recentReviews} embedded />
        </Modal>
      )}
      {modal === 'played' && (
        <Modal title={playedLabel} onClose={() => setModal(null)}>
          <ProfilePlayedGames username={profile.username} />
        </Modal>
      )}
    </div>
  );
}
