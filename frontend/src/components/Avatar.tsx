import type { CSSProperties } from 'react';

// Unified avatar: photo if available, else the initial on a stable pseudo-derived color, with an ultra-thin ring.

// Deterministic pseudo hash → hue (0-359), stable per user.
function hueFor(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

const RING = 'ring-1 ring-black/20 dark:ring-white/30';

// Framing encoded in the URL by the backend (".../file.gif#af=scale,x,y"): src (fragment stripped) loads the image, the fragment drives the CSS transform.
export function parseFrame(url: string): { src: string; scale: number; x: number; y: number } {
  const [src, frag] = url.split('#af=');
  if (!frag) return { src: url, scale: 1, x: 0, y: 0 };
  const [scale, x, y] = frag.split(',').map(Number);
  return { src, scale: scale || 1, x: x || 0, y: y || 0 };
}

// Image style shared with the editor (Settings) for WYSIWYG: zoom/center via width/height + left/top, never transform (which broke the round clip).
export function framedImgStyle(scale: number, x: number, y: number): CSSProperties {
  return {
    position: 'absolute',
    width: `${scale * 100}%`,
    height: `${scale * 100}%`,
    // Tailwind preflight sets img { max-width:100% }; without this override width:200% is capped, leaving a black band.
    maxWidth: 'none',
    maxHeight: 'none',
    left: `${(1 - scale) * 50 + x}%`,
    top: `${(1 - scale) * 50 + y}%`,
    objectFit: 'cover',
  };
}

export default function Avatar({
  username,
  avatarUrl,
  size = 32,
  className = '',
}: {
  username: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const dims = { width: size, height: size };

  if (avatarUrl) {
    const { src, scale, x, y } = parseFrame(avatarUrl);
    // Neutral framing (the vast majority) → plain <img> as before: no wrapper/transform, no cost.
    if (scale === 1 && x === 0 && y === 0) {
      return (
        <img
          src={src}
          alt=""
          style={dims}
          className={`shrink-0 rounded-full object-cover ${RING} ${className}`}
        />
      );
    }
    // Framed: a clipping circle (overflow + rounded) + image positioned WITHOUT transform → always round.
    return (
      <span
        style={dims}
        className={`relative inline-block shrink-0 overflow-hidden rounded-full ${RING} ${className}`}
      >
        <img src={src} alt="" style={framedImgStyle(scale, x, y)} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        ...dims,
        backgroundColor: `hsl(${hueFor(username)} 52% 45%)`,
        fontSize: Math.round(size * 0.42),
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white ${RING} ${className}`}
    >
      {username.charAt(0).toUpperCase()}
    </span>
  );
}
