import { useEffect, useRef } from 'react';

// How long a zoom-step change (deblur-equivalent step, or the final reveal)
// takes to animate, in ms — matches BlurredCover's TRANSITION_MS.
const TRANSITION_MS = 550;

// 7 steps (same count as BLUR_STEPS_PX), from a tight crop on a detail down
// to the full frame. The crop is centered on FOCUS_X/FOCUS_Y (fractions of
// the base, already-aspect-cropped frame — see drawAt) rather than the image
// center, so the early steps read as "a fragment of a screenshot" rather
// than just a zoomed-in center.
const ZOOM_SCALES = [2.6, 2.2, 1.9, 1.6, 1.35, 1.15, 1];
const FOCUS_X = 0.62;
const FOCUS_Y = 0.4;
// Matches the aspect-video (16:9) box this is always displayed in — screenshots
// are landscape, unlike cover-guess's portrait box art.
const ASPECT = 16 / 9;

// Screenshot-guess's "no blur" equivalent of BlurredCover: renders via
// <canvas> for the same two reasons (see BlurredCover) — no flash of the
// previous round's frame while the new image decodes, and no way to
// right-click/drag the element to reach the full, un-zoomed screenshot
// before it's supposed to be revealed. Zoom step changes for the SAME
// screenshot animate smoothly via rAF; a new screenshot snaps instantly.
export default function ZoomedScreenshot({
  src,
  stepIndex,
  className,
}: {
  src: string;
  stepIndex: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const prevSrcRef = useRef<string | null>(null);
  const displayScaleRef = useRef(ZOOM_SCALES[stepIndex] ?? 1);
  const rafRef = useRef<number | null>(null);

  function drawAt(scale: number) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The canvas element is displayed at ASPECT (via its container/className)
    // — sizing the canvas itself to that same aspect makes CSS object-cover a
    // no-op, so this crop is the ONLY crop that happens. Basing it on the raw
    // natural image instead (ignoring ASPECT) would let object-cover crop a
    // SECOND time on top of an already-zoomed frame, compounding into a much
    // tighter zoom than `scale` actually calls for.
    const srcAspect = img.naturalWidth / img.naturalHeight;
    const baseW = srcAspect > ASPECT ? img.naturalHeight * ASPECT : img.naturalWidth;
    const baseH = srcAspect > ASPECT ? img.naturalHeight : img.naturalWidth / ASPECT;
    const baseX = (img.naturalWidth - baseW) / 2;
    const baseY = (img.naturalHeight - baseH) / 2;

    if (canvas.width !== baseW) canvas.width = baseW;
    if (canvas.height !== baseH) canvas.height = baseH;

    // Zoom into that base (already-cropped-to-ASPECT) frame by `scale`.
    const cropW = baseW / scale;
    const cropH = baseH / scale;
    const cropX = baseX + Math.min(Math.max(baseW * FOCUS_X - cropW / 2, 0), baseW - cropW);
    const cropY = baseY + Math.min(Math.max(baseH * FOCUS_Y - cropH / 2, 0), baseH - cropH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
  }

  function cancelAnimation() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function animateTo(target: number) {
    cancelAnimation();
    const from = displayScaleRef.current;
    if (from === target) {
      drawAt(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TRANSITION_MS);
      const eased = 1 - (1 - t) * (1 - t);
      const current = from + (target - from) * eased;
      displayScaleRef.current = current;
      drawAt(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    const target = ZOOM_SCALES[stepIndex] ?? 1;
    const isNewShot = prevSrcRef.current !== src;
    prevSrcRef.current = src;

    if (!isNewShot) {
      animateTo(target);
      return;
    }

    cancelAnimation();
    displayScaleRef.current = target;
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    imgRef.current = null;

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      drawAt(target);
    };
    img.src = src;
    return () => {
      img.onload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, stepIndex]);

  useEffect(() => cancelAnimation, []);

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
