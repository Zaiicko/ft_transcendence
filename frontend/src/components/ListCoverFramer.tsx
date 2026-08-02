import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError } from '../lib/api';
import type { GameListSummary } from '../lib/types';
import { framedImgStyle, parseFrame } from './Avatar';

// Preview at the cover thumbnail ratio (3:2) for WYSIWYG framing.
const PREVIEW_W = 240;
const PREVIEW_H = 160;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

// Max offset (%) keeping the image covering at this zoom (cf. AvatarFramer).
const panLimit = (scale: number) => (scale - 1) * 50;
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

// Cover framing (like the avatar): upload the original, store scale/x/y in coverUrl via #af=.
export default function ListCoverFramer({
  listId,
  coverUrl,
  onChange,
  onClose,
}: {
  listId: number;
  coverUrl: string | null;
  onChange: (coverUrl: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const init = coverUrl ? parseFrame(coverUrl) : { src: '', scale: 1, x: 0, y: 0 };
  const [scale, setScale] = useState(init.scale);
  const [x, setX] = useState(init.x);
  const [y, setY] = useState(init.y);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(init.src);
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
    const dx = ((e.clientX - drag.current.px) / PREVIEW_W) * 100;
    const dy = ((e.clientY - drag.current.py) / PREVIEW_H) * 100;
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
        fd.append('cover', file);
        await apiFetch(`/lists/${listId}/cover`, { method: 'POST', body: fd });
      }
      const updated = await apiFetch<GameListSummary>(`/lists/${listId}/cover-frame`, {
        method: 'PATCH',
        body: JSON.stringify({
          scale: Math.round(scale * 100) / 100,
          x: Math.round(x),
          y: Math.round(y),
        }),
      });
      onChange(updated.coverUrl);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lists.error'));
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/lists/${listId}/cover`, { method: 'DELETE' });
      onChange(null);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('lists.error'));
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col items-center gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      {previewUrl ? (
        <div
          style={{ width: PREVIEW_W, height: PREVIEW_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative cursor-move touch-none select-none overflow-hidden rounded-lg ring-1 ring-black/20 dark:ring-white/30"
        >
          <img src={previewUrl} alt="" draggable={false} style={framedImgStyle(scale, x, y)} />
        </div>
      ) : (
        <div
          style={{ width: PREVIEW_W, height: PREVIEW_H }}
          className="flex items-center justify-center rounded-lg border border-dashed border-zinc-400/60 p-4 text-center text-xs text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
        >
          {t('settings.chooseImage')}
        </div>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} onChange={pickFile} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
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

      <div className="flex flex-wrap justify-center gap-2">
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
        {coverUrl && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="rounded-full border border-red-500/50 px-4 py-1.5 text-sm text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {t('lists.removeCover')}
          </button>
        )}
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
