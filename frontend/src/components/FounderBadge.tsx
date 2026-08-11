import { useTranslation } from 'react-i18next';

// Among the first accounts ever created. Postgres id is monotonic and never
// reused (deleted test accounts just leave gaps), so this stays a stable,
// permanent cutoff. Accounts past it will never show the badge — that's the
// point of a "founding member" mark.
const FOUNDER_CUTOFF_ID = 200;

// Same square-badge silhouette as PsnBadge/XboxBadge/DiscordBadge (ring
// border) — but a Founder isn't an external platform, so it wears the site's
// own signature accent gold as an outline on black instead of a borrowed
// brand colour. Shown next to the username on the profile header and next to
// review authors, same spots as LeaderboardRankBadge.
export default function FounderBadge({ userId }: { userId: number }) {
  const { t } = useTranslation();
  if (userId > FOUNDER_CUTOFF_ID) return null;
  return (
    <span
      title={t('founderBadge.tooltip', { count: FOUNDER_CUTOFF_ID })}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-accent ring-2 ring-accent"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-none stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 21V12" />
        <path d="M12 12C12 8 9 6 5 6c0 4 3 7 7 6" />
        <path d="M12 12c0-4 3-6 7-6 0 4-3 7-7 6" />
      </svg>
    </span>
  );
}
