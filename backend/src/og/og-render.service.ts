import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

// satori's own node type: a plain tree, no JSX/React dependency needed in the backend.
export type SatoriNode = {
  type: string;
  props: { style?: Record<string, unknown>; children?: SatoriNode | SatoriNode[] | string; [key: string]: unknown };
};

const WEIGHTS = [400, 600, 700, 800] as const;

// Static Sora weights vendored from @fontsource/sora (same family as the SPA's
// self-hosted variable font — satori needs a concrete static weight per style,
// not the variable file). See assets/fonts/README for how to refresh them.
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

// Sora is Latin-only (no Cyrillic, no CJK) — text in ru/zh/ja/ko renders as
// tofu without a fallback. Each card sets a CSS font-family STACK
// ("Sora, NotoJP") per language (see og-cards.ts's background()); satori
// walks the stack per-glyph, falling through to whichever entry actually
// covers that codepoint. Single consolidated Noto Sans <script> files
// (fetched from the Google Fonts CSS2 API with a plain UA, which returns one
// un-subsetted file instead of the browser's unicode-range-split chunks),
// weight 700 only, reused across every requested weight — full weight
// fidelity doesn't matter for a rarely-hit glyph fallback the way legibility
// does. See assets/fonts/README for how to refresh them.
const FALLBACK_FONTS: { name: string; file: string }[] = [
  { name: 'NotoCyrillic', file: 'noto-sans-cyrillic-700.woff' },
  { name: 'NotoSC', file: 'noto-sans-sc-700.woff' },
  { name: 'NotoJP', file: 'noto-sans-jp-700.woff' },
  { name: 'NotoKR', file: 'noto-sans-kr-700.woff' },
];

@Injectable()
export class OgRenderService {
  private readonly logger = new Logger(OgRenderService.name);
  private readonly fonts = [
    ...WEIGHTS.map((weight) => ({
      name: 'Sora',
      weight,
      style: 'normal' as const,
      data: readFileSync(join(FONT_DIR, `sora-${weight}.woff`)),
    })),
    ...FALLBACK_FONTS.flatMap(({ name, file }) => {
      const data = readFileSync(join(FONT_DIR, file));
      return WEIGHTS.map((weight) => ({ name, weight, style: 'normal' as const, data }));
    }),
  ];

  // Short-lived in-memory cache: bots (esp. Discord) re-fetch the same image
  // repeatedly to refresh their own cache. The VPS is small (2 vCores) —
  // avoid re-running satori+resvg for identical content within the window.
  private readonly cache = new Map<string, { buf: Buffer; at: number }>();
  private readonly CACHE_TTL_MS = 10 * 60_000;

  async png(cacheKey: string, tree: SatoriNode, width: number, height: number): Promise<Buffer> {
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < this.CACHE_TTL_MS) return hit.buf;

    const svg = await satori(tree as never, { width, height, fonts: this.fonts });
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
    const buf = Buffer.from(resvg.render().asPng());

    this.cache.set(cacheKey, { buf, at: Date.now() });
    // Best-effort bound: drop the oldest half once the cache grows large.
    if (this.cache.size > 500) {
      const keys = [...this.cache.keys()].slice(0, 250);
      for (const k of keys) this.cache.delete(k);
    }
    return buf;
  }
}
