// 0–10 rating as 5 SVG stars with real partial fill (half-stars), not a text "½".

const STAR_PATH = 'M12 2l2.9 6.26 6.6.54-5 4.32 1.5 6.4L12 16.9 5.9 20.1l1.5-6.4-5-4.32 6.6-.54z';

function Row({ className }: { className: string }) {
  return (
    <span className={`flex ${className}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

export default function Stars({
  rating,
  showValue = true,
  className = '',
}: {
  rating: number;
  showValue?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (rating / 10) * 100));
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={`${rating}/10`}>
      <span className="relative inline-flex">
        <Row className="text-zinc-300 dark:text-zinc-700" />
        <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
          <Row className="text-amber-500" />
        </span>
      </span>
      {showValue && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{rating}/10</span>
      )}
    </span>
  );
}

// Single filled star + value (compact badges: catalog score, average).
export function StarIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 fill-current`} aria-hidden="true">
      <path d={STAR_PATH} />
    </svg>
  );
}
