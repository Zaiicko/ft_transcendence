import { ReactNode } from 'react';

// État vide soigné : icône filaire dans un cercle + titre + phrase, dans un
// bloc discret en pointillés. Remplace les phrases nues (« No reviews yet »).
export default function EmptyState({
  icon,
  title,
  description,
  children,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700 ${className}`}
    >
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
        {icon}
      </span>
      <p className="font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {description && (
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      )}
      {children}
    </div>
  );
}

// Icônes filaires prêtes (trait 1.6, style TiMN) pour les états vides
const wire = {
  viewBox: '0 0 24 24',
  className: 'h-5 w-5 fill-none stroke-current',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const PencilIcon = () => (
  <svg {...wire}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const UsersIcon = () => (
  <svg {...wire}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const CalendarIcon = () => (
  <svg {...wire}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

export const GamepadIcon = () => (
  <svg {...wire}>
    <path d="M6 12h4M8 10v4" />
    <circle cx="15" cy="11" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
    <path d="M17.32 5H6.68a4 4 0 0 0-3.94 3.32l-1.2 7A3 3 0 0 0 4.5 19c1 0 1.5-.5 2-1l1-1.5h5l1 1.5c.5.5 1 1 2 1a3 3 0 0 0 2.96-3.68l-1.2-7A4 4 0 0 0 17.32 5z" />
  </svg>
);
