import type { CSSProperties } from 'react';

// Avatar unifié : photo si disponible, sinon l'initiale sur un fond de couleur
// stable dérivé du pseudo (chaque user garde sa couleur). Cerclé d'un trait
// ultra-fin — noir en jour, blanc en nuit — pour détacher la vignette du fond
// même quand deux avatars ont une couleur proche.

// Hash déterministe du pseudo → teinte (0-359). Couleur stable par utilisateur.
function hueFor(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

const RING = 'ring-1 ring-black/20 dark:ring-white/30';

// Cadrage encodé dans l'URL par le back : ".../file.gif#af=scale,x,y". Le src
// (fragment retiré) charge l'image ; le fragment pilote le transform CSS.
// Absent → cadrage neutre. Le navigateur ne transmet jamais le fragment au
// serveur, donc l'image se charge normalement.
function parseFrame(url: string): { src: string; scale: number; x: number; y: number } {
  const [src, frag] = url.split('#af=');
  if (!frag) return { src: url, scale: 1, x: 0, y: 0 };
  const [scale, x, y] = frag.split(',').map(Number);
  return { src, scale: scale || 1, x: x || 0, y: y || 0 };
}

// Style d'image partagé avec l'éditeur (Settings) pour un rendu WYSIWYG. Le
// zoom/centrage se fait via width/height + left/top, JAMAIS via transform : une
// image non transformée est clippée de façon parfaitement fiable par
// overflow+border-radius (le transform, lui, faisait « sauter » le clip en
// carré). (1-scale)*50 recentre l'image agrandie ; x/y la déplacent.
export function framedImgStyle(scale: number, x: number, y: number): CSSProperties {
  return {
    position: 'absolute',
    width: `${scale * 100}%`,
    height: `${scale * 100}%`,
    // Tailwind (preflight) pose img { max-width:100% } : sans ça, width:200% est
    // bridé à 100% et l'image ne couvre plus tout → bande noire au zoom.
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
    // Cadrage neutre (la quasi-totalité) → <img> simple comme avant : aucun
    // wrapper ni transform, donc zéro coût et pas de bug de clip.
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
    // Recadré : cercle qui clippe (overflow + rounded) + image positionnée SANS
    // transform → clip toujours rond, jamais carré.
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
