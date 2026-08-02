// Animated loading placeholder (pulse), used instead of raw "Loading…".
export default function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

// Grid of placeholder covers (home, Steam library, catalog).
export function CoverGridSkeleton({ count = 6, cols = 'sm:grid-cols-6' }: { count?: number; cols?: string }) {
  return (
    <div className={`grid grid-cols-3 gap-4 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-[3/4] w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}
