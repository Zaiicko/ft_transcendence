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
    return (
      <img
        src={avatarUrl}
        alt=""
        style={dims}
        className={`shrink-0 rounded-full object-cover ${RING} ${className}`}
      />
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
