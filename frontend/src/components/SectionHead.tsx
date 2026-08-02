// Branded section header: amber uppercase eyebrow above a display-font title.
export default function SectionHead({
  eyebrow,
  title,
  className = 'mb-4',
  // Eyebrow dot color — amber by default, green for "live" modules.
  dotClass = 'text-accent',
}: {
  eyebrow?: string;
  title: string;
  className?: string;
  dotClass?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && (
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          <span className={dotClass}>●</span> {eyebrow}
        </div>
      )}
      <h2 className="font-display mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
    </div>
  );
}
