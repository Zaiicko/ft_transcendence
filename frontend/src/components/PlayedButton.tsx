import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { useRequireAuth } from '../auth/useRequireAuth';
import { apiFetch } from '../lib/api';

// "Completed it" counter + whether the viewer marked it "done" (completedByMe).
type PlayedInfo = {
  count: number;
  completedCount: number;
  mine: { status: string; playedAt: string | null } | null;
  completedByMe: boolean;
};

// Date input as 3 independent fields (strings, possibly empty for a partial date: "year only", "year + month"…).
type DateInput = { year: string; month: string; day: string };

// Today's date as YYYY-MM-DD (local time).
function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// YYYY-MM-DD → ISO (local noon, so the day doesn't shift by timezone).
function toIso(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

// Split/rebuild a local YYYY-MM-DD date without going through UTC.
function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Last day of a month (m1 = 1..12), handles leap years.
function lastDayOfMonth(y: number, m1: number): number {
  return new Date(y, m1, 0).getDate();
}

// Resolve a possibly PARTIAL input into a sendable date.
//  • year only    → anytime in the year
//  • year + month → anytime in the month
//  • full date    → that exact day
// Validated by overlap of [lo, hi] with [release, today]; the stored date is clamped
// to the game's release when an imprecise input falls before it — IGDB often stores a
// placeholder day (Jan 1st) when only the year is known, so day-precise blocking would be wrong.
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
    if (df.day !== '') return { valid: false }; // a day without a month makes no sense
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
        return { valid: false }; // non-existent date (e.g. 31/02)
      lo = ymd(y, m - 1, d);
      hi = lo;
      exact = lo;
    }
  }

  if (hi < release) return { valid: false }; // entirely before release
  if (lo > maxStr) return { valid: false }; // entirely in the future
  const send = lo < release ? release : lo; // clamp to release if needed
  if (send > maxStr) return { valid: false };
  return { valid: true, send, exact };
}

// Single "I did it" button (circled check): marks the game completed (manual completion → "Completed" calendar + feed); opens a date picker (calendar + boxed input) that can be backdated.
export default function PlayedButton({
  gameId,
  releaseDate = null,
  onDark = false,
  showCount = false,
  refreshKey = 0,
}: {
  gameId: number;
  // Game release date (ISO): the picker's min bound — you can't finish a game before release. Absent (null) → no lower bound.
  releaseDate?: string | null;
  onDark?: boolean;
  showCount?: boolean;
  // Bumped by the parent (e.g. after posting a review) to force a state reload.
  refreshKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const [played, setPlayed] = useState<PlayedInfo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Source of truth: the 3 date fields (empty on open).
  const [df, setDf] = useState<DateInput>({ year: '', month: '', day: '' });
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const minStr = releaseDate ? releaseDate.slice(0, 10) : undefined;
  const maxStr = todayStr();
  const resolved = resolveCompletion(df, minStr, maxStr);
  // Only flag the error (red border) once the year is complete — not while still typing.
  const showInvalid = df.year.length === 4 && !resolved.valid;
  // Month shown by the calendar: follows what the user types (year/month).
  const anchor = /^\d{4}$/.test(df.year)
    ? `${df.year}-${
        df.month && Number(df.month) >= 1 && Number(df.month) <= 12
          ? df.month.padStart(2, '0')
          : '01'
      }-01`
    : '';

  // Reloaded when the session changes: `mine` depends on the viewer's cookie.
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

  // Anchor the popover under the button. Rendered in a PORTAL (document.body) to escape "transformed" ancestors (scroll-animated hub cards) that would otherwise redefine the position:fixed reference. Repositioned DIRECTLY on the node (no setState) so it follows scroll without a re-render lag.
  useLayoutEffect(() => {
    if (!pickerOpen) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!r || !pop) return;
      const w = pop.offsetWidth || 288;
      pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
      pop.style.top = `${r.bottom + 8}px`;
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
    // Guest → redirect to login; already done → remove directly; otherwise open the date picker (empty fields).
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

  // Validate the chosen date and mark the game completed on it.
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

      {pickerOpen && createPortal(
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} aria-hidden="true" />
          <div
            ref={popRef}
            className="fixed left-0 top-0 z-40 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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
        </>,
        document.body,
      )}
    </div>
  );
}

// First day of week per locale (0=Sunday … 6=Saturday), via the Intl API when available (EU=Monday, US=Sunday), Monday by default otherwise.
function weekStartFor(lang: string): number {
  try {
    const loc = new Intl.Locale(lang) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const fd = (loc.weekInfo ?? loc.getWeekInfo?.())?.firstDay; // 1=Monday … 7=Sunday
    if (fd) return fd % 7; // 7→0 (Sunday), 1→1 (Monday) …
  } catch {
    /* Intl.Locale.weekInfo unsupported → default Monday */
  }
  return 1;
}

// In-house monthly calendar (replaces the native <input type="date">, inconsistent across browsers). 6×7 grid, month navigation, selected day in amber, "today" circled, days outside [release, today] disabled. `view` anchors the shown month (follows input), `selected` highlights a day.
function Calendar({
  selected,
  view,
  min,
  max,
  lang,
  onSelect,
}: {
  selected: string; // highlighted YYYY-MM-DD ('' = none)
  view: string; // YYYY-MM-DD anchoring the shown month ('' = today)
  min?: string; // min clickable YYYY-MM-DD (game release)
  max: string; // max clickable YYYY-MM-DD (today)
  lang: string;
  onSelect: (d: string) => void;
}) {
  const { t } = useTranslation();
  const anchorOf = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? parseYmd(s) : null);
  const init = anchorOf(view) ?? anchorOf(max) ?? { y: new Date().getFullYear(), m: new Date().getMonth(), d: 1 };
  const [vs, setVs] = useState({ y: init.y, m: init.m });
  // Follows the external anchor (user types a year/month) without breaking arrow navigation: state adjusted during render, only when `view` actually changes.
  const [prevView, setPrevView] = useState(view);
  if (view !== prevView) {
    setPrevView(view);
    const a = anchorOf(view);
    if (a) setVs({ y: a.y, m: a.m });
  }

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

// Locale date order + separators, via Intl: the sequence of "parts" (fields + literals) as the country writes it — DD/MM/YYYY in FR, MM/DD/YYYY in US, YYYY/MM/DD in JA… One box per field, one separator per literal.
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
    /* Intl unavailable → ISO fallback */
  }
  return [
    { type: 'year' },
    { type: 'literal', value: '-' },
    { type: 'month' },
    { type: 'literal', value: '-' },
    { type: 'day' },
  ];
}

// Days in a month for input clamping. Unknown year → 2000 (leap) to stay permissive on Feb 29; the real validation is done above by resolveCompletion.
function daysInMonthOf(year: string, month: string): number {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return 31;
  const y = Number(year) || 2000;
  return new Date(y, m, 0).getDate();
}

// Date input in separate boxes, ordered by language. Controlled component (no internal state): digits only, clamps values (month ≤ 12, day ≤ days in the month → typing 60 for day gives 31/30/28…), auto-advances to the next box when full, and Backspace on an empty box returns to the previous one.
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

    // Bounds: month ≤ 12, day ≤ days in the current month.
    if (digits !== '') {
      const n = Number(digits);
      if (type === 'month' && n > 12) digits = '12';
      if (type === 'day') {
        const maxD = daysInMonthOf(next.year, next.month);
        if (n > maxD) digits = String(maxD);
      }
      next[type] = digits;
    }
    // Changing the month can invalidate an already-typed day (e.g. 31 → February).
    if (type === 'month' && next.day !== '') {
      const maxD = daysInMonthOf(next.year, next.month);
      if (Number(next.day) > maxD) next.day = String(maxD);
    }
    onChange(next);

    // Auto-advance: box full, OR a digit that can't take more (month > 1, day > 3 → necessarily one digit).
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
