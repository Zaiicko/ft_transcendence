import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Tour guidé « à quoi sert chaque bouton » : un projecteur (spotlight) découpe
// un trou sombre autour du VRAI bouton de la nav (ciblé par son [data-tour]) et
// une bulle explicative se place à côté. Suivant / Précédent / Passer + un
// compteur d'étapes. Les étapes dont la cible est absente ou masquée (ex. liens
// de nav cachés sur mobile) sont automatiquement ignorées.

// Ordre des étapes = ordre de lecture de la barre. `key` == valeur data-tour.
const STEP_KEYS = [
  'home',
  'chat',
  'search',
  'catalog',
  'feed',
  'leaderboard',
  'friends',
  'library',
  'notifications',
  'profile',
  'menu',
] as const;

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8; // marge du trou autour de l'élément
const GAP = 12; // écart bulle ↔ élément

function targetOf(key: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Élément présent mais masqué (display:none → width/height 0) : on l'ignore.
  return r.width > 0 && r.height > 0 ? el : null;
}

export default function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  // Étapes réellement présentes à l'écran, figées à l'ouverture du tour.
  const [steps, setSteps] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number; place: 'top' | 'bottom' } | null>(null);

  // À l'ouverture : on liste les étapes dont la cible est visible et on repart
  // de la première.
  useEffect(() => {
    if (!open) return;
    setSteps(STEP_KEYS.filter((k) => targetOf(k)));
    setI(0);
  }, [open]);

  const key = steps[i];

  // Mesure la cible de l'étape courante (et recalcule au resize/scroll).
  const measure = useCallback(() => {
    if (!key) return;
    const el = targetOf(key);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [key]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  // Positionne la bulle sous la cible si la place suffit, sinon au-dessus, en la
  // gardant dans le viewport. Recalculé après le rendu (hauteur de bulle connue).
  useLayoutEffect(() => {
    if (!rect || !tipRef.current) {
      setTip(null);
      return;
    }
    const tipEl = tipRef.current;
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = rect.top + rect.height + GAP + th <= vh;
    const place: 'top' | 'bottom' = below ? 'bottom' : 'top';
    const top = below ? rect.top + rect.height + GAP : rect.top - GAP - th;
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, vw - tw - 12));
    setTip({ top: Math.max(12, top), left, place });
  }, [rect, i, steps, t]);

  const finish = useCallback(() => {
    setRect(null);
    setTip(null);
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (i >= steps.length - 1) finish();
    else setI((n) => n + 1);
  }, [i, steps.length, finish]);

  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Échap ferme le tour (cohérent avec le reste de l'app).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish, next, back]);

  if (!open || steps.length === 0 || !key) return null;

  const hole: Rect | null = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  return (
    <div className="fixed inset-0 z-[80]" aria-live="polite" role="dialog" aria-modal="true">
      {/* Capte les clics pour bloquer l'UI en dessous (on avance via les boutons) */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Projecteur : un trou clair sur la cible, tout le reste assombri via une
          énorme ombre portée. Sans le trou (cible perdue) : voile plein écran. */}
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all duration-200"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: '0 0 0 9999px rgba(9, 9, 11, 0.72)',
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-zinc-950/72" />
      )}

      {/* Bulle explicative */}
      <div
        ref={tipRef}
        className="absolute w-[min(20rem,calc(100vw-24px))] rounded-2xl border border-zinc-900/10 bg-white p-4 shadow-2xl dark:border-zinc-100/10 dark:bg-zinc-900"
        style={{
          top: tip?.top ?? -9999,
          left: tip?.left ?? -9999,
          visibility: tip ? 'visible' : 'hidden',
        }}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
          <span>✦</span> {t('tutorial.eyebrow')}
        </div>
        <h3 className="font-display text-base font-bold tracking-tight">
          {t(`tutorial.steps.${key}.title`)}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {t(`tutorial.steps.${key}.body`)}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {/* Points de progression (le point actif est allongé) */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {steps.map((s, idx) => (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  idx === i ? 'w-4 bg-accent' : 'w-1.5 bg-zinc-300 dark:bg-zinc-600'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={finish}
              className="text-xs font-medium text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              {t('tutorial.skip')}
            </button>

            <div className="flex items-center gap-2">
              {i > 0 && (
                <button
                  type="button"
                  onClick={back}
                  aria-label={t('tutorial.back')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
                    <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={next}
                className="shrink-0 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-zinc-950 transition hover:brightness-110"
              >
                {i >= steps.length - 1 ? t('tutorial.done') : t('tutorial.next')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
