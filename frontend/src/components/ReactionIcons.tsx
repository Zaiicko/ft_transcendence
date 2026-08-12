// Outline review-reaction icons (thumbs up/down, comment bubble), matching the site's line style.

type IconProps = { className?: string };
const BASE = 'shrink-0 fill-none stroke-current';
const svgProps = {
  viewBox: '0 0 24 24',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function ThumbsUpIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...svgProps} className={`${BASE} ${className}`}>
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

export function ThumbsDownIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...svgProps} className={`${BASE} ${className}`}>
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z" />
      <path d="M17 15h3a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}

export function CommentIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...svgProps} className={`${BASE} ${className}`}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </svg>
  );
}

export function LinkIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...svgProps} className={`${BASE} ${className}`}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function CheckIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...svgProps} className={`${BASE} ${className}`}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
