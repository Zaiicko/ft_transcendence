// Standalone, one-off script — run with `npm run panoramas:extract`. Fetches
// the public Kuula "Games" collection grid page ONE time (a single page
// load, exactly what any visitor's browser does — no per-post requests, no
// image ever touched) and pulls out the text metadata embedded in it
// (window.KUULA_COLLECTION, server-rendered into the HTML for SEO) to build
// a review file: kuulaId + the creator's own description, plus a best-guess
// match against our own catalog. This is NEVER auto-imported — see
// panorama_candidates.csv, which a human reviews before anything becomes
// panorama_seed.json (consumed by panorama-seed.ts).
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

const GRID_URL = 'https://kuula.co/grid/7fWCJ';
const OUT_PATH = join(__dirname, '..', 'panorama_candidates.csv');

interface KuulaPost {
  id: string;
  description?: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&nbsp;|&amp;|&#\d+;/g, ' ')
    // Drop apostrophes entirely (not replace with a space) so "Assassin's"
    // and a description typo'd as "Assassins" normalize to the same token —
    // titles/descriptions are inconsistent about typing the apostrophe.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function csvField(s: string): string {
  return `"${s.replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  console.log(`Fetching ${GRID_URL} (single page load)...`);
  const res = await fetch(GRID_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();

  const match = html.match(/window\.KUULA_COLLECTION=\{id:"[^"]+",data:"([^"]+)"\}/);
  if (!match) throw new Error('window.KUULA_COLLECTION not found in page — Kuula may have changed its markup');

  const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8')) as { posts: KuulaPost[] };
  const posts = payload.posts ?? [];
  console.log(`Found ${posts.length} posts in the collection.`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const games = await prisma.game.findMany({ select: { id: true, title: true } });
  await app.close();

  // Longest-match-wins: a description can coincidentally contain a short,
  // generic title as a substring of a longer, more specific one. Matched on
  // word boundaries (not raw substring) so e.g. a game called "Stairs"
  // doesn't false-positive on the word "downstairs".
  const catalog = games
    .map((g) => ({ ...g, normTitle: normalize(g.title) }))
    .filter((g) => g.normTitle.length >= 3)
    .sort((a, b) => b.normTitle.length - a.normTitle.length)
    .map((g) => ({ ...g, re: new RegExp(`\\b${escapeRegex(g.normTitle)}\\b`) }));

  const rows = ['kuulaId,description,proposedGame,confidence'];
  let matched = 0;
  for (const post of posts) {
    const description = post.description ?? '';
    const normDesc = normalize(description);
    const hit = catalog.find((g) => g.re.test(normDesc));
    if (hit) matched++;
    rows.push(
      [
        csvField(post.id),
        csvField(description),
        csvField(hit?.title ?? ''),
        hit ? String(Math.round((hit.normTitle.length / Math.max(normDesc.length, 1)) * 100)) : '0',
      ].join(','),
    );
  }

  writeFileSync(OUT_PATH, rows.join('\n') + '\n', 'utf-8');
  console.log(`Wrote ${posts.length} candidates to ${OUT_PATH} (${matched} with a proposed match).`);
  console.log('This is a starting point for manual review, not a source of truth — cross-check every row before it goes into panorama_seed.json.');
}

main().catch((err) => {
  console.error('Extraction failed:', err.message ?? err);
  process.exit(1);
});
