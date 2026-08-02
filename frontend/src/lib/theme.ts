// Color module: day/night mode + "ambilight" match, reusing the screenshot's top/bottom edge color as the page background.

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'theme';

export function storedMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyMode(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  localStorage.setItem(STORAGE_KEY, mode);
}

export interface EdgeColors {
  top: string;
  bottom: string;
  // Top-edge luminance drives the header text color (dark-on-dark would vanish).
  topIsDark: boolean;
}

export function applyEdgeColors(colors: EdgeColors | null): void {
  const root = document.documentElement;
  if (colors) {
    root.style.setProperty('--top-color', colors.top);
    root.style.setProperty('--bot-color', colors.bottom);
  } else {
    root.style.removeProperty('--top-color');
    root.style.removeProperty('--bot-color');
  }
  root.classList.toggle('header-on-dark', colors?.topIsDark === true);
  root.classList.toggle('header-on-light', colors?.topIsDark === false);
}

// Re-served same-origin by nginx (/igdb/) since IGDB sends no CORS; reduced to 32×32, rows 0 and 31 averaged in RGB.
export async function extractEdgeColors(imageUrl: string): Promise<EdgeColors | null> {
  const url = imageUrl.replace('https://images.igdb.com', '/igdb');
  const img = await loadImage(url).catch(() => null);
  if (!img) return null;

  const SIZE = 32;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  const averageRow = (y: number): [number, number, number] => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return [Math.round(r / SIZE), Math.round(g / SIZE), Math.round(b / SIZE)];
  };

  // Brown = dull dark orange (ugly as a background) → step inward row by row until a clearer color.
  const isBrown = ([r, g, b]: [number, number, number]): boolean => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return h >= 15 && h <= 50 && s >= 0.12 && l >= 0.08 && l <= 0.5;
  };

  const pickEdge = (start: number, step: 1 | -1): [number, number, number] => {
    for (let k = 0; k < SIZE / 2; k++) {
      const row = averageRow(start + k * step);
      if (!isBrown(row)) return row;
    }
    return averageRow(start);
  };

  const top = pickEdge(0, 1);
  const bottom = pickEdge(SIZE - 1, -1);
  // Perceptual luminance (Rec. 709) — the eye sees green much brighter.
  const luminance = 0.2126 * top[0] + 0.7152 * top[1] + 0.0722 * top[2];
  return {
    top: `rgb(${top[0]} ${top[1]} ${top[2]})`,
    bottom: `rgb(${bottom[0]} ${bottom[1]} ${bottom[2]})`,
    topIsDark: luminance < 140,
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

// Real image dimensions: IGDB's t_1080p never upscales a smaller source, so natural size after load is authoritative.
export async function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  const img = await loadImage(url).catch(() => null);
  return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
