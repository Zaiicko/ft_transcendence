import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { useRequireAuth } from '../auth/useRequireAuth';
import { apiFetch } from '../lib/api';

// Compteur "l'ont terminé" + si le viewer l'a marqué « fait » (completedByMe).
type PlayedInfo = {
  count: number;
  completedCount: number;
  mine: { status: string; playedAt: string | null } | null;
  completedByMe: boolean;
};

// Saisie de date en 3 champs indépendants (chaînes, éventuellement vides pour une
// date partielle : « juste l'année », « année + mois »…).
type DateInput = { year: string; month: string; day: string };

// Date du jour au format YYYY-MM-DD (heure locale).
function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// YYYY-MM-DD → ISO (midi local, pour ne pas décaler le jour selon le fuseau).
function toIso(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

// Découpe/recompose une date locale YYYY-MM-DD sans passer par le fuseau UTC.
function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Dernier jour d'un mois (m1 = 1..12), gère les années bissextiles.
function lastDayOfMonth(y: number, m1: number): number {
  return new Date(y, m1, 0).getDate();
}

// Résout une saisie potentiellement PARTIELLE en une date envoyable.
//  • année seule       → n'importe quand dans l'année
//  • année + mois      → n'importe quand dans le mois
//  • date complète     → ce jour précis
// On valide par chevauchement de l'intervalle [lo, hi] avec [sortie, aujourd'hui],
// et on cale la date stockée sur la sortie du jeu si la saisie (imprécise) tombe
// avant — car IGDB stocke souvent un jour « placeholder » (1ᵉʳ janvier) quand seule
// l'année est connue, donc bloquer au jour près serait faux.
function resolveCompletion(
  df: DateInput,
  minStr: string | undefined,
  maxStr: string,
): { valid: boolean; send?: string; exact?: string } {
  if (!/^\d{4}$/.test(df.year)) return { valid: false };
  const y = Number(df.year);
  const release = minStr ?? '0000-01-01';

  let lo: string;
  let hi: string;
  let exact: string | undefined;

  if (df.month === '') {
    if (df.day !== '') return { valid: false }; // un jour sans mois n'a pas de sens
    lo = `${df.year}-01-01`;
    hi = `${df.year}-12-31`;
  } else {
    const m = Number(df.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) return { valid: false };
    const mm = String(m).padStart(2, '0');
    if (df.day === '') {
      lo = `${df.year}-${mm}-01`;
      hi = `${df.year}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
    } else {
      const d = Number(df.day);
      const dt = new Date(y, m - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d)
        return { valid: false }; // date inexistante (ex. 31/02)
      lo = ymd(y, m - 1, d);
      hi = lo;
      exact = lo;
    }
  }

  if (hi < release) return { valid: false }; // entièrement avant la sortie
  if (lo > maxStr) return { valid: false }; // entièrement dans le futur
  const send = lo < release ? release : lo; // cale sur la sortie si besoin
  if (send > maxStr) return { valid: false };
  return { valid: true, send, exact };
}

// Bouton unique « je l'ai fait » (coche cerclée) : marque le jeu comme terminé
// (complétion manuelle → calendrier « Terminé » + feed). Marquer ouvre un
// sélecteur de date (calendrier + saisie en cases) qu'on peut dater dans le passé.
export default function PlayedButton({
  gameId,
  releaseDate = null,
  onDark = false,
  showCount = false,
  refreshKey = 0,
}: {
  gameId: number;
  // Date de sortie du jeu (ISO) : borne min du sélecteur — on ne peut pas avoir
  // fini un jeu avant sa sortie. Absente (null) → pas de borne basse.
  releaseDate?: string | null;
  onDark?: boolean;
  showCount?: boolean;
  // Incrémenté par le parent (ex : après avoir posté un avis) pour forcer un
  // rechargement de l'état.
  refreshKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const [played, setPlayed] = useState<PlayedInfo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Source de vérité : les 3 champs de date (vides à l'ouverture).
  const [df, setDf] = useState<DateInput>({ year: '', month: '', day: '' });
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Position fixe du popover (le bandeau de la fiche jeu masque le débordement).
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  const minStr = releaseDate ? releaseDate.slice(0, 10) : undefined;
  const maxStr = todayStr();
  const resolved = resolveCompletion(df, minStr, maxStr);
  // On ne signale l'erreur (bordure rouge) qu'une fois l'année complète — pas
  // pendant qu'on tape encore les chiffres.
  const showInvalid = df.year.length === 4 && !resolved.valid;
  // Mois affiché par le calendrier : suit ce que l'user tape (année/mois).
  const anchor = /^\d{4}$/.test(df.year)
    ? `${df.year}-${
        df.month && Number(df.month) >= 1 && Number(df.month) <= 12
          ? df.month.padStart(2, '0')
          : '01'
      }-01`
    : '';

  // Rechargé quand la session change : `mine` dépend du cookie du viewer
  useEffect(() => {
    let cancelled = false;
    apiFetch<PlayedInfo>(`/games/${gameId}/played`)
      .then((p) => {
        if (!cancelled) setPlayed(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, user?.id, refreshKey]);

  const done = played?.completedByMe ?? false;

  // Ancre le popover sous le bouton (position fixe → échappe à l'overflow).
  useLayoutEffect(() => {
    if (!pickerOpen) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      setCoords({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 288 - 8)),
        top: r.bottom + 8,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [pickerOpen]);

  async function toggle() {
    // Invité → redirection login ; déjà terminé → on retire directement ;
    // sinon on ouvre le sélecteur de date (cases vides).
    if (!requireAuth() || !played) return;
    if (done) {
      await apiFetch(`/games/${gameId}/completed`, { method: 'DELETE' });
      const fresh = await apiFetch<PlayedInfo>(`/games/${gameId}/played`).catch(() => null);
      if (fresh) setPlayed(fresh);
    } else {
      setDf({ year: '', month: '', day: '' });
      setPickerOpen((o) => !o);
    }
  }

  // Valide la date choisie et marque le jeu terminé à cette date.
  async function confirmDate() {
    if (!played || saving || !resolved.valid || !resolved.send) return;
    setSaving(true);
    try {
      await apiFetch(`/games/${gameId}/completed`, {
        method: 'PUT',
        body: JSON.stringify({ date: toIso(resolved.send) }),
      });
      const fresh = await apiFetch<PlayedInfo>(`/games/${gameId}/played`).catch(() => null);
      if (fresh) setPlayed(fresh);
      setPickerOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const showPhrase = showCount && played != null && played.completedCount > 0;

  const knob = (active: boolean, activeCls: string) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
      active
        ? activeCls
        : onDark
          ? 'border-zinc-100/25 bg-zinc-950/30 text-zinc-200 backdrop-blur hover:border-accent hover:text-accent'
          : 'border-zinc-400/60 text-zinc-500 hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400'
    }`;

  return (
    <div ref={wrapRef} className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        title={done ? t('game.markedTitle') : t('game.markTitle')}
        aria-label={done ? t('game.unmarkAria') : t('game.markAria')}
        aria-pressed={done}
        className={knob(done, 'border-accent bg-accent text-zinc-950')}
      >
        {/* Coche cerclée filaire (trait 1.6, style TiMN) : "fait" */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 fill-none stroke-current"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
        </svg>
      </button>

      {showPhrase && (
        <span
          className={`ml-1 text-xs leading-tight ${
            onDark ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {t(played.completedCount === 1 ? 'game.completedCountOne' : 'game.completedCountMany', {
            count: played.completedCount,
          })}
        </span>
      )}

      {pickerOpen && coords && (
        <>
          {/* Fond cliquable pour fermer sans valider */}
          <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} aria-hidden="true" />
          <div
            className="fixed z-40 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: coords.left, top: coords.top }}
          >
            <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {t('game.completeDateTitle')}
            </p>

            <Calendar
              selected={resolved.exact ?? ''}
              view={anchor}
              min={minStr}
              max={maxStr}
              lang={i18n.language}
              onSelect={(s) => {
                const { y, m, d } = parseYmd(s);
                setDf({ year: String(y), month: String(m + 1), day: String(d) });
              }}
            />

            {/* Saisie manuelle par cases — ordre selon la langue (JJ/MM/AAAA en
                FR, MM/JJ/AAAA en US, AAAA/MM/JJ en JA/ZH/KO…). Cases vides = date
                partielle acceptée (ex. juste l'année pour un vieux jeu). */}
            <div className="mt-3">
              <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t('game.dateTypeLabel')}
              </span>
              <DateFields value={df} lang={i18n.language} invalid={showInvalid} onChange={setDf} />
            </div>

            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{t('game.markDateHint')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmDate}
                disabled={saving || !resolved.valid}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-zinc-950 hover:opacity-90 disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Premier jour de la semaine selon la locale (0=dimanche … 6=samedi), via
// l'API Intl quand dispo (FR/UE=lundi, US=dimanche), lundi par défaut sinon.
function weekStartFor(lang: string): number {
  try {
    const loc = new Intl.Locale(lang) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const fd = (loc.weekInfo ?? loc.getWeekInfo?.())?.firstDay; // 1=lundi … 7=dimanche
    if (fd) return fd % 7; // 7→0 (dimanche), 1→1 (lundi) …
  } catch {
    /* Intl.Locale.weekInfo non supporté → défaut lundi */
  }
  return 1;
}

// Calendrier mensuel maison (remplace l'<input type="date"> natif, incohérent
// d'un navigateur à l'autre). Grille 6×7, navigation par mois, jour sélectionné
// en ambre, « aujourd'hui » cerclé, jours hors [sortie, aujourd'hui] désactivés.
// `view` ancre le mois affiché (suit la saisie), `selected` surligne un jour.
function Calendar({
  selected,
  view,
  min,
  max,
  lang,
  onSelect,
}: {
  selected: string; // YYYY-MM-DD surligné ('' = aucun)
  view: string; // YYYY-MM-DD ancrant le mois affiché ('' = aujourd'hui)
  min?: string; // YYYY-MM-DD min cliquable (sortie du jeu)
  max: string; // YYYY-MM-DD max cliquable (aujourd'hui)
  lang: string;
  onSelect: (d: string) => void;
}) {
  const { t } = useTranslation();
  const anchorOf = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? parseYmd(s) : null);
  const init = anchorOf(view) ?? anchorOf(max) ?? { y: new Date().getFullYear(), m: new Date().getMonth(), d: 1 };
  const [vs, setVs] = useState({ y: init.y, m: init.m });
  // Suit l'ancre externe (l'user tape une année/un mois) sans casser la
  // navigation aux flèches (view inchangé → l'effet ne se redéclenche pas).
  useEffect(() => {
    const a = anchorOf(view);
    if (a) setVs({ y: a.y, m: a.m });
  }, [view]);

  const weekStart = weekStartFor(lang);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((weekStart + i) % 7)).toLocaleDateString(lang, { weekday: 'narrow' }),
  );
  const monthLabel = new Date(vs.y, vs.m, 1).toLocaleDateString(lang, {
    month: 'long',
    year: 'numeric',
  });

  const firstWeekday = new Date(vs.y, vs.m, 1).getDay();
  const lead = (firstWeekday - weekStart + 7) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => {
    const dt = new Date(vs.y, vs.m, 1 - lead + i);
    return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
  });

  const today = todayStr();
  const maxP = parseYmd(max);
  const atMaxMonth = vs.y > maxP.y || (vs.y === maxP.y && vs.m >= maxP.m);
  const minP = min ? parseYmd(min) : null;
  const atMinMonth = !!minP && (vs.y < minP.y || (vs.y === minP.y && vs.m <= minP.m));
  const shift = (delta: number) => {
    const dt = new Date(vs.y, vs.m + delta, 1);
    setVs({ y: dt.getFullYear(), m: dt.getMonth() });
  };

  const navBtn =
    'flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition hover:bg-accent/10 hover:text-accent disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={atMinMonth} className={navBtn} aria-label={t('common.previous', { defaultValue: 'Previous' })}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="text-sm font-semibold capitalize text-zinc-800 dark:text-zinc-100">{monthLabel}</span>
        <button type="button" onClick={() => shift(1)} disabled={atMaxMonth} className={navBtn} aria-label={t('common.next', { defaultValue: 'Next' })}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {weekdays.map((w, i) => (
          <div key={i} className="pb-1 text-center text-[10px] font-semibold uppercase text-zinc-400">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          const s = ymd(c.y, c.m, c.d);
          const inMonth = c.m === vs.m;
          const disabled = s > max || (min !== undefined && s < min);
          const isSelected = selected !== '' && s === selected;
          const isToday = s === today;
          return (
            <div key={i} className="flex justify-center">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(s)}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums transition ${
                  isSelected
                    ? 'bg-accent font-semibold text-zinc-950'
                    : disabled
                      ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-700'
                      : isToday
                        ? 'font-semibold text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent/10'
                        : inMonth
                          ? 'text-zinc-700 hover:bg-accent/10 dark:text-zinc-200'
                          : 'text-zinc-400/70 hover:bg-accent/10'
                }`}
              >
                {c.d}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DatePart = { type: 'year' | 'month' | 'day' } | { type: 'literal'; value: string };

// Ordre + séparateurs de date de la locale, via Intl : séquence de « parts »
// (champs + littéraux) telle que le pays l'écrit — JJ/MM/AAAA en FR, MM/JJ/AAAA
// en US, AAAA/MM/JJ en JA… On rend une case par champ, un séparateur par littéral.
function localeDateParts(lang: string): DatePart[] {
  try {
    const parts = new Intl.DateTimeFormat(lang, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(2000, 10, 22));
    const seq: DatePart[] = parts.map((p) =>
      p.type === 'year' || p.type === 'month' || p.type === 'day'
        ? { type: p.type }
        : { type: 'literal', value: p.value },
    );
    if (['year', 'month', 'day'].every((tp) => seq.some((s) => s.type === tp))) return seq;
  } catch {
    /* Intl indisponible → repli ISO */
  }
  return [
    { type: 'year' },
    { type: 'literal', value: '-' },
    { type: 'month' },
    { type: 'literal', value: '-' },
    { type: 'day' },
  ];
}

// Nb de jours d'un mois pour le clamp de saisie. Année inconnue → 2000
// (bissextile) pour rester permissif sur le 29/02 ; la vraie validation (date
// réelle) est faite plus haut par resolveCompletion.
function daysInMonthOf(year: string, month: string): number {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return 31;
  const y = Number(year) || 2000;
  return new Date(y, m, 0).getDate();
}

// Saisie de date en cases séparées, ordonnées selon la langue. Composant contrôlé
// (pas d'état interne) : n'accepte que des chiffres, borne les valeurs (mois ≤ 12,
// jour ≤ nb de jours du mois → taper 60 en jour donne 31/30/28…), auto-avance à la
// case suivante une fois pleine, et Backspace sur une case vide revient à la
// précédente.
function DateFields({
  value,
  lang,
  invalid,
  onChange,
}: {
  value: DateInput;
  lang: string;
  invalid: boolean;
  onChange: (d: DateInput) => void;
}) {
  const { t } = useTranslation();
  const seq = localeDateParts(lang);
  const fieldOrder = seq
    .filter((s) => s.type !== 'literal')
    .map((s) => s.type as 'year' | 'month' | 'day');
  const refs = useRef<Partial<Record<'year' | 'month' | 'day', HTMLInputElement | null>>>({});

  const placeholders = {
    year: t('game.datePartYear'),
    month: t('game.datePartMonth'),
    day: t('game.datePartDay'),
  };

  const focusNext = (type: 'year' | 'month' | 'day') => {
    const nxt = fieldOrder[fieldOrder.indexOf(type) + 1];
    if (nxt) refs.current[nxt]?.focus();
  };

  const change = (type: 'year' | 'month' | 'day', raw: string) => {
    const maxLen = type === 'year' ? 4 : 2;
    let digits = raw.replace(/\D/g, '').slice(0, maxLen);
    const next: DateInput = { ...value, [type]: digits };

    // Bornes : mois ≤ 12, jour ≤ nb de jours du mois courant.
    if (digits !== '') {
      const n = Number(digits);
      if (type === 'month' && n > 12) digits = '12';
      if (type === 'day') {
        const maxD = daysInMonthOf(next.year, next.month);
        if (n > maxD) digits = String(maxD);
      }
      next[type] = digits;
    }
    // Changer le mois peut invalider un jour déjà saisi (ex. 31 → février).
    if (type === 'month' && next.day !== '') {
      const maxD = daysInMonthOf(next.year, next.month);
      if (Number(next.day) > maxD) next.day = String(maxD);
    }
    onChange(next);

    // Auto-avance : case pleine, OU chiffre qui ne peut plus rien accueillir
    // (mois > 1, jour > 3 → forcément à un chiffre).
    const full =
      digits.length === maxLen ||
      (type === 'month' && digits.length === 1 && Number(digits) > 1) ||
      (type === 'day' && digits.length === 1 && Number(digits) > 3);
    if (full) focusNext(type);
  };

  const keyDown = (type: 'year' | 'month' | 'day', e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && value[type] === '') {
      const prev = fieldOrder[fieldOrder.indexOf(type) - 1];
      if (prev) {
        e.preventDefault();
        refs.current[prev]?.focus();
      }
    }
  };

  return (
    <div className="flex items-center gap-1">
      {seq.map((s, i) =>
        s.type === 'literal' ? (
          <span key={i} className="select-none px-0.5 text-sm text-zinc-400">
            {s.value.trim()}
          </span>
        ) : (
          <input
            key={i}
            ref={(el) => {
              refs.current[s.type as 'year' | 'month' | 'day'] = el;
            }}
            inputMode="numeric"
            aria-label={s.type}
            placeholder={placeholders[s.type as 'year' | 'month' | 'day']}
            value={value[s.type as 'year' | 'month' | 'day']}
            onChange={(e) => change(s.type as 'year' | 'month' | 'day', e.target.value)}
            onKeyDown={(e) => keyDown(s.type as 'year' | 'month' | 'day', e)}
            onFocus={(e) => e.target.select()}
            className={`rounded-md border bg-white py-2 text-center text-sm tabular-nums text-zinc-900 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100 ${
              s.type === 'year' ? 'w-14' : 'w-9'
            } ${
              invalid
                ? 'border-red-400 focus:border-red-400'
                : 'border-zinc-300 focus:border-accent dark:border-zinc-600'
            }`}
          />
        ),
      )}
    </div>
  );
}
