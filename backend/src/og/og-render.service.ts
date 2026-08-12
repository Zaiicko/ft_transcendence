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

@Injectable()
export class OgRenderService {
  private readonly logger = new Logger(OgRenderService.name);
  private readonly fonts = WEIGHTS.map((weight) => ({
    name: 'Sora',
    weight,
    style: 'normal' as const,
    data: readFileSync(join(FONT_DIR, `sora-${weight}.woff`)),
  }));

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
