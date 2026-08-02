import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import { framedImgStyle } from './Avatar';

const PREVIEW = 200;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

// Max offset (%) keeping the image covering at this zoom (0 at scale 1, 50% at scale 2).
const panLimit = (scale: number) => (scale - 1) * 50;
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

function currentFrame(url: string): { scale: number; x: number; y: number } {
  const frag = url.split('#af=')[1];
  if (!frag) return { scale: 1, x: 0, y: 0 };
  const [scale, x, y] = frag.split(',').map(Number);
  return { scale: scale || 1, x: x || 0, y: y || 0 };
}

// "Change photo" flow: pick a file, zoom (slider) and pan (drag), then save (upload + framing PATCH), WYSIWYG.
export default function AvatarFramer({
  avatarUrl,
  onClose,
}: {
  avatarUrl: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const init = avatarUrl ? currentFrame(avatarUrl) : { scale: 1, x: 0, y: 0 };
  const [scale, setScale] = useState(init.scale);
  const [x, setX] = useState(init.x);
  const [y, setY] = useState(init.y);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(() =>
    avatarUrl ? avatarUrl.split('#af=')[0] : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setScale(1);
    setX(0);
    setY(0);
  }

  function reclampTo(nextScale: number) {
    const lim = panLimit(nextScale);
    setX((v) => clamp(v, lim));
    setY((v) => clamp(v, lim));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x, y };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const lim = panLimit(scale);
    const dx = ((e.clientX - drag.current.px) / PREVIEW) * 100;
    const dy = ((e.clientY - drag.current.py) / PREVIEW) * 100;
    setX(clamp(drag.current.x + dx, lim));
    setY(clamp(drag.current.y + dy, lim));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function save() {
    if (!previewUrl) return;
    setSaving(true);
    setError(null);
    try {
      if (file) {
        const fd = new FormData();
        fd.append('avatar', file);
        await apiFetch('/users/me/avatar', { method: 'POST', body: fd });
      }
      await apiFetch('/users/me/avatar-frame', {
        method: 'PATCH',
        body: JSON.stringify({
          scale: Math.round(scale * 100) / 100,
          x: Math.round(x),
          y: Math.round(y),
        }),
      });
      await refreshUser();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.avatarError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      {previewUrl ? (
        <div
          style={{ width: PREVIEW, height: PREVIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative cursor-move touch-none select-none overflow-hidden rounded-full ring-1 ring-black/20 dark:ring-white/30"
        >
          <img
            src={previewUrl}
            alt=""
            draggable={false}
            className="select-none"
            style={framedImgStyle(scale, x, y)}
          />
        </div>
      ) : (
        <div
          style={{ width: PREVIEW, height: PREVIEW }}
          className="flex items-center justify-center rounded-full border border-dashed border-zinc-400/60 p-4 text-center text-xs text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
        >
          {t('settings.chooseImage')}
        </div>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} onChange={pickFile} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-sm text-zinc-300 underline"
      >
        {t('settings.chooseImage')}
      </button>

      {previewUrl && (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('settings.avatarFrameHint')}</p>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={scale}
            onChange={(e) => {
              const s = Number(e.target.value);
              setScale(s);
              reclampTo(s);
            }}
            aria-label={t('settings.avatarZoom')}
            className="w-56 accent-accent"
          />
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setX(0);
            setY(0);
          }}
          className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600"
        >
          {t('settings.avatarReset')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !previewUrl}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
