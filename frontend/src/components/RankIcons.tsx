// Gold/silver/bronze podium tint (avatar ring + score) — shared by the site
// leaderboard and anywhere else a top-3 ranking is shown, so they read as
// the same visual language.
export const PLACE = {
  1: { ring: 'ring-amber-400', text: 'text-amber-400', bar: 'from-amber-300 to-amber-500' },
  2: { ring: 'ring-zinc-400', text: 'text-zinc-400', bar: 'from-zinc-300 to-zinc-400' },
  3: { ring: 'ring-amber-700', text: 'text-amber-600', bar: 'from-amber-600 to-amber-800' },
} as const;

export function CrownIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`fill-current ${className}`} aria-hidden="true">
      <path d="M3 18h18l-1.2-8.5-4.3 3.2L12 6l-3.5 6.7L4.2 9.5 3 18z" />
    </svg>
  );
}

// Outline medal — color from `currentColor`, driven by the rank's text-* class.
export function MedalIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`fill-none stroke-current ${className}`}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" />
      <path d="M11 12 5.12 2.2M13 12l5.88-9.8M8 7h8" />
      <circle cx="12" cy="17" r="5" />
      <path d="M12 18v-2h-.5" />
    </svg>
  );
}
