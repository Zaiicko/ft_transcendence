// Displays a Kuula 360° panorama via their official embed iframe — the image
// itself is never downloaded or hosted by us, only this `kuulaId` (a public
// post ID) is stored on our side. Query params strip Kuula's own chrome:
// `info=0` in particular hides their caption panel, which usually names the
// game and would otherwise spoil the answer. No `sandbox` attribute — there's
// nothing of ours to protect here (unlike ZoomedScreenshot/BlurredCover,
// which guard our own not-yet-revealed image), and sandboxing risks breaking
// Kuula's WebGL viewer.
export default function PanoramaEmbed({ kuulaId, title }: { kuulaId: string; title: string }) {
  const src = `https://kuula.co/share/${encodeURIComponent(kuulaId)}?logo=-1&info=0&fs=0&vr=0&gyro=0&autorotate=0&thumbs=-1`;
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
      <iframe
        key={kuulaId}
        src={src}
        title={title}
        loading="lazy"
        allow="accelerometer; gyroscope; magnetometer"
        className="h-full w-full border-0"
      />
    </div>
  );
}
