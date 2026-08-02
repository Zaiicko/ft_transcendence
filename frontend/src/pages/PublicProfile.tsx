import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useFriendSocket } from '../friends/useFriendSocket';
import i18n from '../i18n';
import Avatar from '../components/Avatar';
import ShareButton from '../components/ShareButton';
import EmptyState, { CalendarIcon } from '../components/EmptyState';
import DiscordBadge from '../components/DiscordBadge';
import FortyTwoBadge from '../components/FortyTwoBadge';
import AchievementsSection from '../components/AchievementsSection';
import LeaderboardRankBadge from '../components/LeaderboardRankBadge';
import PsnBadge from '../components/PsnBadge';
import XboxBadge from '../components/XboxBadge';
import ProfileLists from '../components/ProfileLists';
import ProfilePlayedGames from '../components/ProfilePlayedGames';
import ProfileReviews from '../components/ProfileReviews';
import SectionHead from '../components/SectionHead';
import Skeleton from '../components/Skeleton';
import Stars, { StarIcon } from '../components/Stars';
import SteamBadge from '../components/SteamBadge';
import { apiFetch, ApiError } from '../lib/api';
import type { FriendState, ProfileReview, PublicProfile as Profile } from '../lib/types';

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
}

// Onglets de la section profil : Aperçu (résumé de chaque module) puis le détail
type ProfileTab = 'overview' | 'reviews' | 'games' | 'lists';

// Jaquette « coup de cœur » : même format que l'accueil/maquette — pastille de
// note (celle donnée par l'utilisateur) en haut à droite, lift au survol.
function TopGameCover({ game, rating }: { game: Profile['topGames'][number]['game']; rating: number }) {
  return (
    <Link to={`/game/${game.id}`} className="group block">
      <div className="relative overflow-hidden rounded-xl border border-zinc-900/10 shadow-lg shadow-black/10 transition duration-300 group-hover:-translate-y-1.5 group-hover:shadow-2xl dark:border-zinc-100/10">
        {game.coverUrl ? (
          <img src={game.coverUrl} alt={game.title} className="aspect-[3/4] w-full object-cover" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center bg-zinc-200 p-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {game.title}
          </div>
        )}
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-amber-300 to-accent px-2 py-0.5 text-xs font-bold tabular-nums text-zinc-950 shadow">
          <StarIcon className="h-3 w-3" />
          {rating}
        </span>
      </div>
      <p className="mt-1.5 truncate text-sm font-medium">{game.title}</p>
    </Link>
  );
}

// Bio du profil : simple texte pour un visiteur ; éditable en place (textarea +
// enregistrer) pour le propriétaire, via PATCH /users/me.
function BioBlock({
  bio,
  isSelf,
  onSaved,
}: {
  bio: string | null;
  isSelf: boolean;
  onSaved: (bio: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bio ?? '');
  const [busy, setBusy] = useState(false);

  if (!isSelf) {
    return bio ? <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">{bio}</p> : null;
  }

  if (editing) {
    const save = async () => {
      setBusy(true);
      try {
        const next = value.trim();
        await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ bio: next }) });
        onSaved(next);
        setEditing(false);
      } catch {
        /* réseau : on garde l'édition ouverte */
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="mt-2 max-w-2xl">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={280}
          rows={3}
          autoFocus
          placeholder={t('profile.bioPlaceholder')}
          className="field w-full resize-none !rounded-xl px-3 py-2"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue(bio ?? '');
            }}
            className="text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t('common.cancel')}
          </button>
          <span className="ml-auto text-xs text-zinc-400">{value.length}/280</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group mt-2 flex max-w-2xl items-start gap-1.5 text-left text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
    >
      <span className={bio ? '' : 'italic text-zinc-400 dark:text-zinc-500'}>
        {bio || t('profile.bioAdd')}
      </span>
      <svg
        viewBox="0 0 24 24"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-none stroke-current opacity-0 transition group-hover:opacity-100"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}

// Carte de critique compacte (éditoriale, note sur /10) pour l'aperçu du profil.
function ReviewPreviewCard({ review }: { review: ProfileReview }) {
  const target = review.game
    ? { name: review.game.title, cover: review.game.coverUrl, href: `/game/${review.game.id}#review-${review.id}`, isCompany: false }
    : {
        name: review.company?.name ?? '?',
        cover: review.company?.logoUrl ?? null,
        href: review.company ? `/company/${review.company.id}#review-${review.id}` : '/',
        isCompany: true,
      };
  return (
    <Link to={target.href} className="card flex flex-col gap-3 p-5 transition hover:-translate-y-1 hover:border-zinc-400 dark:hover:border-zinc-600">
      <div className="flex items-center gap-3">
        {target.cover && (
          <img
            src={target.cover}
            alt=""
            className={target.isCompany ? 'h-16 w-11 shrink-0 rounded-lg bg-white object-contain p-0.5' : 'h-16 w-11 shrink-0 rounded-lg object-cover'}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{target.name}</div>
          <div className="mt-1"><Stars rating={review.rating} showValue={false} /></div>
        </div>
        <div className="font-display shrink-0 text-3xl font-extrabold tabular-nums leading-none text-accent">
          {review.rating}
          <span className="text-base font-bold text-zinc-400">/10</span>
        </div>
      </div>
      <div className="text-sm font-semibold">« {review.title} »</div>
      <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{review.text}</p>
    </Link>
  );
}

// ---- Yearly completion calendar (GitHub-style heatmap) ----

const DAY_MS = 86_400_000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type CalGame = Profile['completions'][number]['game'];

function formatDay(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Deux types plats sur un même calendrier : « fait » à la main (ambre/accent) et
// 100 % plateforme (emerald). Pas de dégradé — le nombre de jeux est donné en
// clair dans le panneau du jour. Le vert (100 %) prime si un jour a les deux.
const EMPTY_CELL = 'bg-zinc-200 dark:bg-zinc-800';
const DONE_COLOR = 'bg-accent';
const PERFECT_COLOR = 'bg-emerald-500';

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

// Sélecteur d'années à fenêtre glissante : au-delà de 5 années (ou de ce que la
// largeur permet), on n'en montre qu'un sous-ensemble encadré de flèches ‹ › pour
// défiler (sinon la liste déborde du cadre, ex. 2000 → 2026). Clic sur une année
// visible = sélection. `years` est trié par ordre chronologique ascendant.
function YearPager({
  years,
  year,
  onPick,
}: {
  years: string[];
  year: string;
  onPick: (yr: string) => void;
}) {
  const { t } = useTranslation();
  // Le pager occupe toute la largeur restante (jusqu'aux stats à gauche) et
  // affiche autant d'années qu'il y rentre — mesuré via ResizeObserver. Les
  // flèches n'apparaissent que si toutes les années ne tiennent pas.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(years.length);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const YEAR_W = 46; // largeur approx d'une puce année (px-2 text-xs + gap)
    const ARROWS_W = 58; // réserve pour les deux flèches quand ça défile
    const measure = () => {
      const w = el.clientWidth;
      // Combien d'années tiennent sans flèches ; si ça ne suffit pas pour tout
      // afficher, on réserve la place des flèches et on recompte.
      const fitAll = Math.floor((w + 4) / YEAR_W);
      const fit =
        fitAll >= years.length ? years.length : Math.floor((w - ARROWS_W + 4) / YEAR_W);
      setCapacity(Math.max(1, fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [years.length]);

  // Au plus 5 années visibles à la fois (au-delà → flèches ‹ ›), tout en restant
  // borné par la largeur réelle (measure) pour ne jamais déborder sur mobile.
  const WINDOW = Math.min(Math.max(1, capacity), years.length, 5);
  const paged = years.length > WINDOW;
  const maxStart = Math.max(0, years.length - WINDOW);
  // Fenêtre initiale centrée sur l'année sélectionnée (bornée aux extrémités).
  const selIdx = Math.max(0, years.indexOf(year));
  const [start, setStart] = useState(() =>
    Math.min(Math.max(0, selIdx - Math.floor(WINDOW / 2)), maxStart),
  );
  const clampedStart = Math.min(start, maxStart);
  const visible = paged ? years.slice(clampedStart, clampedStart + WINDOW) : years;

  // Anime le défilement : à chaque changement de fenêtre (clic ‹ / ›), les puces
  // d'années glissent + apparaissent dans le sens du défilement (vers les récents
  // = depuis la droite, vers les anciens = depuis la gauche), en léger décalé.
  // Respecte prefers-reduced-motion et ne joue pas au montage initial.
  const prevStartRef = useRef(clampedStart);
  const pagingRef = useRef(false); // vrai uniquement après un clic ‹ / ›
  useLayoutEffect(() => {
    const wasPaging = pagingRef.current;
    pagingRef.current = false;
    const dir =
      clampedStart > prevStartRef.current ? 1 : clampedStart < prevStartRef.current ? -1 : 0;
    prevStartRef.current = clampedStart;
    if (!wasPaging || dir === 0 || !wrapRef.current) return; // resize / montage → pas d'anim
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const chips = wrapRef.current.querySelectorAll('[data-year-chip]');
    const ctx = gsap.context(() => {
      // Glissement simple : clic gauche (dir<0) → les puces entrent depuis la
      // gauche (vont vers la droite) ; clic droite (dir>0) → l'inverse.
      gsap.from(chips, { x: dir * 20, duration: 0.28, ease: 'power2.out' });
    }, wrapRef.current);
    return () => ctx.revert();
  }, [clampedStart]);

  const arrow =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800';

  return (
    <div ref={wrapRef} className="flex min-w-0 flex-1 items-center justify-end gap-1">
      {paged && (
        <button
          type="button"
          onClick={() => {
            pagingRef.current = true;
            setStart((s) => Math.max(0, s - 1));
          }}
          disabled={clampedStart === 0}
          aria-label={t('profile.calOlderYears')}
          className={arrow}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {visible.map((yr) => (
        <button
          key={yr}
          type="button"
          data-year-chip
          onClick={() => onPick(yr)}
          className={`rounded px-2 py-0.5 text-xs tabular-nums ${
            yr === year
              ? 'bg-zinc-200 dark:bg-zinc-700'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          {yr}
        </button>
      ))}
      {paged && (
        <button
          type="button"
          onClick={() => {
            pagingRef.current = true;
            setStart((s) => Math.min(maxStart, s + 1));
          }}
          disabled={clampedStart >= maxStart}
          aria-label={t('profile.calNewerYears')}
          className={arrow}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function CompletionCalendar({
  done,
  perfect,
}: {
  done: Profile['completions'];
  perfect: Profile['perfectGames'];
}) {
  const { t } = useTranslation();
  const [yearSel, setYearSel] = useState<string | null>(null);
  // Day whose games are shown in the panel: pinned by click, else hovered
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // dateKey -> { faits (ambre), 100 % (vert) } ce jour-là (2 séries, 1 calendrier)
  const byDay = useMemo(() => {
    const map = new Map<string, { done: CalGame[]; perfect: CalGame[] }>();
    const add = (arr: Profile['completions'], kind: 'done' | 'perfect') => {
      for (const e of arr) {
        const key = e.playedAt.slice(0, 10);
        const entry = map.get(key) ?? { done: [], perfect: [] };
        entry[kind].push(e.game);
        map.set(key, entry);
      }
    };
    add(done, 'done');
    add(perfect, 'perfect');
    return map;
  }, [done, perfect]);

  const years = useMemo(() => {
    const set = new Set([...done, ...perfect].map((e) => e.playedAt.slice(0, 4)));
    // Ordre chronologique ascendant : la plus ancienne à gauche, la plus récente
    // à droite (ex. 2000 … 2026).
    return [...set].sort();
  }, [done, perfect]);

  // Année affichée : la sélection si elle existe encore, sinon la plus récente
  // (dernière du tableau ascendant).
  const year =
    yearSel && years.includes(yearSel)
      ? yearSel
      : (years[years.length - 1] ?? String(new Date().getFullYear()));

  // Colonnes = semaines de 7 jours (dimanche en haut). Padding avant le 1er jan
  // + après le 31 déc pour des colonnes pleines. Mémoïsé sur l'année affichée.
  const { weeks, monthCols, doneTotal, perfectTotal } = useMemo(() => {
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
    const inYear = (e: Profile['completions'][number]) => e.playedAt.slice(0, 4) === year;
    return {
      weeks: cols,
      monthCols: labels,
      doneTotal: done.filter(inYear).length,
      perfectTotal: perfect.filter(inYear).length,
    };
  }, [year, done, perfect]);

  if (done.length === 0 && perfect.length === 0) {
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
  // Liste combinée du jour actif : 100 % d'abord (pastille verte), puis faits non
  // déjà 100 % ce jour-là (évite les doublons).
  const activeItems = activeDay
    ? (() => {
        const perfectIds = new Set(activeDay.perfect.map((g) => g.id));
        return [
          ...activeDay.perfect.map((g) => ({ g, perfect: true })),
          ...activeDay.done.filter((g) => !perfectIds.has(g.id)).map((g) => ({ g, perfect: false })),
        ];
      })()
    : undefined;

  return (
    <div>
      {/* En-tête : totaux faits / 100 % (gauche) ; sélecteur d'année qui occupe
          toute la largeur restante jusqu'aux stats (droite). */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="shrink-0 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{doneTotal}</span>{' '}
          {t('profile.calDoneLabel')} <span className="text-zinc-400 dark:text-zinc-600">·</span>{' '}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{perfectTotal}</span>{' '}
          {t('profile.calPerfectLabel')}
        </p>
        {years.length > 1 && (
          <YearPager
            years={years}
            year={year}
            onPick={(yr) => {
              setYearSel(yr);
              setPinnedKey(null);
            }}
          />
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
                    const doneN = day?.done.length ?? 0;
                    const perfN = day?.perfect.length ?? 0;
                    // 100 % (vert) prime ; sinon fait (ambre) ; sinon inerte.
                    const cls = perfN ? PERFECT_COLOR : doneN ? DONE_COLOR : EMPTY_CELL;
                    if (!day) return <span key={di} className={`w-full rounded-sm ${cls}`} />;
                    const parts: string[] = [];
                    if (doneN) parts.push(`${doneN} ${t('profile.calDoneLabel')}`);
                    if (perfN) parts.push(`${perfN} ${t('profile.calPerfectLabel')}`);
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

      {/* Légende : les deux types */}
      <div className="mt-1 flex items-center justify-end gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span className="flex items-center gap-1">
          <span className={`h-3 w-3 rounded-sm ${DONE_COLOR}`} /> {t('profile.calDoneLegend')}
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-3 w-3 rounded-sm ${PERFECT_COLOR}`} /> {t('profile.calPerfectLegend')}
        </span>
      </div>

      {/* Jeux du jour survolé/cliqué (pastille verte = 100 %, ambre = fait) */}
      {activeItems && activeKey ? (
        <div className="card mt-3 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-zinc-500 dark:text-zinc-400">{formatDay(activeKey)}</span>
            {(activeDay?.done.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                <span className={`h-2 w-2 rounded-full ${DONE_COLOR}`} />
                {activeDay!.done.length} {t('profile.calDoneLabel')}
              </span>
            )}
            {(activeDay?.perfect.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                <span className={`h-2 w-2 rounded-full ${PERFECT_COLOR}`} />
                {activeDay!.perfect.length} {t('profile.calPerfectLabel')}
              </span>
            )}
          </div>
          <ul className="flex flex-wrap gap-3">
            {activeItems.map(({ g, perfect: isPerfect }) => (
              <li key={`${isPerfect ? 'p' : 'd'}-${g.id}`}>
                <Link to={`/game/${g.id}`} className="flex items-center gap-2 hover:opacity-80">
                  <span className="relative">
                    {g.coverUrl ? (
                      <img src={g.coverUrl} alt="" className="h-10 w-8 rounded object-cover" />
                    ) : (
                      <span className="block h-10 w-8 rounded bg-zinc-200 dark:bg-zinc-800" />
                    )}
                    <span
                      className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${
                        isPerfect ? 'bg-emerald-500' : 'bg-accent'
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
  // Onglet actif reflété dans l'URL (?tab=…) : au reload (Cmd+R) ou au partage du
  // lien, on retombe sur le même onglet plutôt que sur « Aperçu ».
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const isTab = (v: string | null): v is ProfileTab =>
    v === 'overview' || v === 'reviews' || v === 'games' || v === 'lists';
  const [tab, setTab] = useState<ProfileTab>(isTab(urlTab) ? urlTab : 'overview');
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (tab === 'overview') p.delete('tab');
        else p.set('tab', tab);
        return p;
      },
      { replace: true },
    );
  }, [tab, setSearchParams]);

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

  const isSelf = profile.friendState === 'self';

  // Stats intégrées à l'en-tête (mêmes libellés que la bande de l'accueil).
  const stats: { label: string; value: string | number; tone?: 'accent' | 'emerald'; goto?: ProfileTab }[] = [
    { label: t('home.statDone'), value: profile.completions.length, tone: 'accent', goto: 'games' },
    { label: t('home.statPerfect'), value: profile.perfectGames.length, tone: 'emerald', goto: 'games' },
    { label: t('home.statReviews'), value: profile.reviewCount, goto: 'reviews' },
    { label: t('home.statRank'), value: profile.rank ? `#${profile.rank.rank}` : '—', tone: 'accent' },
  ];

  const tabs: { key: ProfileTab; label: string; n?: number }[] = [
    { key: 'overview', label: t('profile.tabOverview') },
    { key: 'reviews', label: t('profile.tabReviews'), n: profile.reviewCount },
    { key: 'games', label: t('profile.tabGames'), n: profile.completions.length + profile.perfectGames.length },
    { key: 'lists', label: t('profile.tabLists'), n: profile.listCount },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      {/* ---- En-tête immersif ---- */}
      {/* Pas d'overflow-hidden ici : l'avatar remonte dans la bannière (-mt-14)
          et serait rogné. C'est la bannière qui porte l'arrondi + le clip. */}
      <div className="rounded-3xl border border-zinc-900/10 bg-zinc-50 shadow-xl shadow-black/5 dark:border-zinc-100/10 dark:bg-zinc-900">
        {/* Bannière : dégradé chaud explicite (crème→ambre en clair, ambre→prune
            en sombre) + halo, fondue vers le corps. Couleurs en dur pour rester
            clairement colorée (l'ambre translucide sur zinc-900 rendait un band
            quasi noir). */}
        <div className="relative h-20 overflow-hidden rounded-t-3xl sm:h-24">
          <div className="absolute inset-0 bg-gradient-to-br from-[#f7ecd9] via-[#f1dfc4] to-[#ece2ef] dark:from-[#2c1708] dark:via-[#3d2010] dark:to-[#1c1531]" />
          <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-accent/40 blur-3xl" />
          {/* Fondu vers la couleur du corps (bas de la bannière) */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-50 via-transparent to-transparent dark:from-zinc-900" />
        </div>

        <div className="px-5 pb-5 sm:px-7 sm:pb-6">
          {/* Avatar posé sur la bannière. `relative z-10` est ESSENTIEL : la
              bannière est en position:relative (halos absolus) donc elle se peint
              APRÈS l'avatar statique et le recouvrait (haut coupé). z-10 remet
              l'avatar au-dessus. */}
          <div className="relative z-10 -mt-11 w-fit rounded-full ring-4 ring-zinc-50 dark:ring-zinc-900">
            <Avatar username={profile.username} avatarUrl={profile.avatarUrl} size={88} />
          </div>

          {/* Nom + actions, sous l'avatar */}
          <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="font-display flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight">
                {profile.username}
                {profile.provider === 'FORTYTWO' && <FortyTwoBadge />}
                {profile.provider === 'DISCORD' && <DiscordBadge />}
                {profile.steamId && <SteamBadge />}
                {profile.psnLinked && <PsnBadge />}
                {profile.xboxLinked && <XboxBadge />}
                <LeaderboardRankBadge userId={profile.id} />
              </h1>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t('profile.memberSince', { date: memberSince(profile.createdAt) })}
              </p>
              <BioBlock
                bio={profile.bio}
                isSelf={isSelf}
                onSaved={(bio) => setProfile({ ...profile, bio })}
              />
            </div>
            {/* Actions */}
            <div className="flex shrink-0 items-center gap-2">
              {user && (
                <ShareButton
                  target={{ type: 'PROFILE', sharedUserId: profile.id }}
                  title={t('profile.shareProfile')}
                  triggerClassName="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
                />
              )}
              {isSelf ? (
                <Link
                  to="/settings"
                  title={t('profile.editProfile')}
                  aria-label={t('profile.editProfile')}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
                >
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

          {/* Stats intégrées */}
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-900/10 bg-zinc-900/10 sm:grid-cols-4 dark:border-zinc-100/10 dark:bg-zinc-100/10">
            {stats.map((s, i) => {
              const valueColor =
                s.tone === 'accent' ? 'text-accent' : s.tone === 'emerald' ? 'text-emerald-500' : '';
              const clickable = s.goto !== undefined;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!clickable}
                  onClick={() => s.goto && setTab(s.goto)}
                  className={`bg-zinc-50 px-3 py-2.5 text-center transition dark:bg-zinc-900 ${
                    clickable ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'cursor-default'
                  }`}
                >
                  <div className={`font-display text-xl font-extrabold tabular-nums tracking-tight ${valueColor}`}>
                    {s.value}
                  </div>
                  <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                    {s.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- Onglets ---- */}
      <div className="mt-6 flex gap-1 border-b border-zinc-900/10 dark:border-zinc-100/10">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`relative px-4 py-2.5 text-sm font-semibold transition ${
              tab === tb.key
                ? 'text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {tb.label}
            {tb.n !== undefined && (
              <span className="ml-1.5 text-xs text-zinc-400 dark:text-zinc-500">{tb.n}</span>
            )}
            {tab === tb.key && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* ---- Contenu de l'onglet ---- */}
      <div className="mt-6">
        {/* APERÇU : un résumé de chaque module (coups de cœur, activité,
            dernières critiques, succès) avec un renvoi vers l'onglet détaillé. */}
        {tab === 'overview' && (
          <div className="flex flex-col gap-10">
            <section>
              <SectionHead eyebrow={t('profile.eyeActivity')} title={t('profile.completionCalendar')} />
              <div className="card p-4 sm:p-5">
                <CompletionCalendar done={profile.completions} perfect={profile.perfectGames} />
              </div>
            </section>

            {profile.topGames.length > 0 && (
              <section>
                <SectionHead eyebrow={t('profile.eyeTopRated')} title={t('profile.topRated')} />
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                  {profile.topGames.map(({ game, rating }) => (
                    <TopGameCover key={game.id} game={game} rating={rating} />
                  ))}
                </div>
              </section>
            )}

            {profile.recentReviews.length > 0 && (
              <section>
                <div className="mb-4 flex items-end justify-between gap-3">
                  <SectionHead
                    className="mb-0"
                    eyebrow={t('profile.eyeReviews')}
                    title={t('profile.recentReviewsTitle')}
                  />
                  {profile.reviewCount > 2 && (
                    <button
                      type="button"
                      onClick={() => setTab('reviews')}
                      className="text-sm text-zinc-500 transition hover:text-accent dark:text-zinc-400"
                    >
                      {t('profile.seeAllReviews')} →
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {profile.recentReviews.slice(0, 2).map((r) => (
                    <ReviewPreviewCard key={r.id} review={r} />
                  ))}
                </div>
              </section>
            )}

            {/* Résumé des succès (une pastille par famille, dépliable) */}
            <AchievementsSection userId={profile.id} />
          </div>
        )}

        {tab === 'reviews' && (
          <ProfileReviews username={profile.username} seed={profile.recentReviews} />
        )}

        {tab === 'games' && (
          <div className="flex flex-col gap-10">
            <section>
              <SectionHead eyebrow={t('profile.eyeActivity')} title={t('profile.completionCalendar')} />
              <div className="card p-4 sm:p-5">
                <CompletionCalendar done={profile.completions} perfect={profile.perfectGames} />
              </div>
            </section>
            <ProfilePlayedGames username={profile.username} />
          </div>
        )}

        {tab === 'lists' && (
          <ProfileLists isSelf={isSelf} publicLists={profile.publicLists} />
        )}
      </div>
    </div>
  );
}
