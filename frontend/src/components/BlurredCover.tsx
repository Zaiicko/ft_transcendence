import { useEffect, useRef } from 'react';

// Renders a game cover blurred, via <canvas> rather than an <img> with a CSS
// filter. Two reasons:
// 1. No unblurred flash: an <img> whose src changes keeps its old painted
//    frame (and any CSS filter transition) until the new image decodes,
//    which briefly showed the NEW round's cover with the PREVIOUS round's
//    (often fully-revealed) blur value. Canvas has no persisted frame to
//    transition from — the pixels are blank until we draw them, already
//    blurred, in one paint.
// 2. No easy cheat: an <img> can be dragged into a reverse-image-search tab
//    (Google Lens et al.) or right-clicked ("Search image with…", "Open
//    image in new tab", "Copy image") to bypass the CSS blur entirely, since
//    the browser always has the real, unblurred resource behind it. A canvas
//    has no underlying resource URL — right-click gives no image-specific
//    options, and it can't be dragged out as an image. The source image is
//    still loaded cross-origin without CORS, which taints the canvas; we
//    only ever draw with it, never read pixels back, so tainting costs us
//    nothing while blocking any script-side extraction too.
export default function BlurredCover({
  src,
  blurPx,
  className,
}: {
  src: string;
  blurPx: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  function draw() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== img.naturalWidth) canvas.width = img.naturalWidth;
    if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight;
    ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    // Blank the canvas immediately — otherwise the previous round's frame
    // (possibly fully revealed) stays visible while the new image loads.
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    imgRef.current = null;

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.src = src;
    return () => {
      img.onload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurPx]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
    />
  );
}
