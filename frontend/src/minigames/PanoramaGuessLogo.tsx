// Decorative "logo" for the panorama-guess card on the mini-games hub.
// Unlike CoverGuessLogo/ScreenshotGuessLogo (which preview a real round),
// this stays a static icon: embedding a live Kuula iframe just for a hub
// thumbnail would fire an external request — and load their WebGL viewer —
// every time the hub renders, for no real benefit over a simple glyph.
export default function PanoramaGuessLogo({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800 ${className ?? ''}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-2/3 w-2/3 text-accent" aria-hidden="true">
        <ellipse cx="12" cy="12" rx="10" ry="4.2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M6 6.5C7.8 9 9.8 10.4 12 10.4s4.2-1.4 6-3.9M6 17.5c1.8-2.5 3.8-3.9 6-3.9s4.2 1.4 6 3.9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M12 2v20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      </svg>
    </div>
  );
}
