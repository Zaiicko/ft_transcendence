import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Modale générique : voile assombri + carte centrée scrollable. Se ferme au
// clic sur le voile, sur la croix, ou avec Échap. Le contenu ne défile pas la
// page dessous (overflow interne à la carte).
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

  // Échap ferme, et on verrouille le scroll de la page tant que la modale est
  // ouverte (restauré au démontage).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 pt-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-900/10 bg-white shadow-2xl dark:border-zinc-100/10 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-900/10 px-5 py-4 dark:border-zinc-100/10">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
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
