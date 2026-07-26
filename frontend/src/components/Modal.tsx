import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Sélecteur des éléments naturellement focusables (pour le focus initial + le
// piège à focus). :not([disabled]) / tabindex="-1" exclus.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modale générique : voile assombri + carte centrée scrollable. Se ferme au
// clic sur le voile, sur la croix, ou avec Échap. Accessibilité (WCAG 2.4.3) :
// focus déplacé dans la modale à l'ouverture, piégé au Tab, restauré sur
// l'élément déclencheur à la fermeture. Le contenu ne défile pas la page dessous.
export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    // Élément qui avait le focus avant l'ouverture (pour le rendre à la fermeture)
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus initial : 1er élément focusable, sinon la carte elle-même (tabIndex -1)
    const initial = dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
    initial?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      // Piège à focus : Tab boucle à l'intérieur de la modale (offsetParent null
      // = élément masqué → écarté).
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 pt-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-900/10 bg-white shadow-2xl focus:outline-none dark:border-zinc-100/10 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-900/10 px-5 py-4 dark:border-zinc-100/10">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-zinc-100/10 dark:hover:text-zinc-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
