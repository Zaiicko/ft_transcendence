import type { SatoriNode } from './og-render.service';

// Plain-object tree builder for satori (no JSX/React dep in the backend).
function el(
  type: string,
  props: Record<string, unknown> = {},
  children?: SatoriNode | SatoriNode[] | string,
): SatoriNode {
  return { type, props: { ...props, ...(children !== undefined ? { children } : {}) } };
}

// Same tokens as the Saveboxd SPA (index.css) and the Wrapped/OG mockup.
export const INK = '#f4f1ea';
export const INK_DIM = 'rgba(244,241,234,0.62)';
export const INK_FAINT = 'rgba(244,241,234,0.45)';
export const ACCENT = '#e0a355';
export const ACCENT_2 = '#c9703f';
export const BG = '#0c0c0e';

const W = 1200;
const H = 630;
const PAD = 64;

// Deterministic pseudo hash -> hue, mirrors frontend/src/components/Avatar.tsx
// hueFor() exactly so a fallback avatar here matches what the app itself shows.
function hueFor(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// Strip the "#af=scale,x,y" pan/zoom fragment some avatar URLs carry — OG
// cards render the un-cropped image, close enough for a link preview.
function baseAvatarSrc(url: string): string {
  return url.split('#af=')[0];
}

function wordmark(): SatoriNode {
  return el(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: 10 } },
    [
      el('div', {
        style: {
          width: 22,
          height: 22,
          borderRadius: 7,
          background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_2})`,
        },
      }),
      el(
        'div',
        { style: { fontFamily: 'Sora', fontWeight: 700, fontSize: 22, color: INK } },
        'saveboxd.com',
      ),
    ],
  );
}

function avatarNode(username: string, avatarUrl: string | null, size: number): SatoriNode {
  if (avatarUrl) {
    return el('img', {
      src: baseAvatarSrc(avatarUrl),
      width: size,
      height: size,
      style: { borderRadius: size, objectFit: 'cover' },
    });
  }
  return el(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size,
        background: `hsl(${hueFor(username)}, 52%, 45%)`,
        color: '#fff',
        fontFamily: 'Sora',
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
      },
    },
    username.charAt(0).toUpperCase(),
  );
}

// Drawn as filled/empty pips rather than a "★" glyph: Sora has no star
// character, satori would render tofu boxes for it.
function ratingPips(rating10: number, size = 20): SatoriNode {
  const filled = Math.max(0, Math.min(5, Math.round((rating10 / 10) * 5)));
  return el(
    'div',
    { style: { display: 'flex', gap: Math.round(size * 0.3) } },
    Array.from({ length: 5 }, (_, i) =>
      el('div', {
        style: {
          display: 'flex',
          width: size,
          height: size,
          borderRadius: size * 0.28,
          background: i < filled ? ACCENT : 'rgba(244,241,234,0.16)',
          transform: 'rotate(45deg)',
        },
      }),
    ),
  );
}

function coverNode(coverUrl: string | null, w: number, h: number): SatoriNode {
  if (coverUrl) {
    return el('img', {
      src: coverUrl,
      width: w,
      height: h,
      style: { borderRadius: 16, objectFit: 'cover', boxShadow: '0 20px 40px rgba(0,0,0,0.45)' },
    });
  }
  return el('div', {
    style: {
      display: 'flex',
      width: w,
      height: h,
      borderRadius: 16,
      background: `linear-gradient(155deg, #241a12, ${BG})`,
      border: '1px solid rgba(244,241,234,0.12)',
    },
  });
}

function background(): Record<string, unknown> {
  return {
    display: 'flex',
    width: W,
    height: H,
    padding: PAD,
    background: `radial-gradient(120% 90% at 100% 0%, rgba(224,163,85,0.16), transparent 55%), ${BG}`,
    fontFamily: 'Sora',
  };
}

// ---------- Game card ----------
export function gameCard(input: {
  title: string;
  coverUrl: string | null;
  avg: number | null;
  count: number;
  genres: string[];
}): SatoriNode {
  const { title, coverUrl, avg, count, genres } = input;
  return el('div', { style: { ...background(), alignItems: 'stretch', gap: 56 } }, [
    coverNode(coverUrl, 300, 420),
    el(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' } },
      [
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, [
          el(
            'div',
            {
              style: {
                display: 'flex',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: ACCENT,
              },
            },
            'Fiche jeu',
          ),
          el(
            'div',
            {
              style: {
                display: 'flex',
                fontSize: 56,
                fontWeight: 800,
                color: INK,
                lineHeight: 1.12,
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              },
            },
            title,
          ),
          avg !== null
            ? el('div', { style: { display: 'flex', alignItems: 'center', gap: 18, marginTop: 6 } }, [
                ratingPips(avg, 22),
                el(
                  'div',
                  { style: { display: 'flex', fontSize: 22, color: INK_DIM } },
                  `${(avg / 2).toFixed(1)}/5 · ${count} avis`,
                ),
              ])
            : el('div', { style: { display: 'flex', fontSize: 22, color: INK_FAINT } }, 'Pas encore noté'),
          genres.length > 0
            ? el(
                'div',
                { style: { display: 'flex', gap: 10, marginTop: 8 } },
                genres.slice(0, 3).map((g) =>
                  el(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        padding: '7px 16px',
                        borderRadius: 999,
                        fontSize: 18,
                        color: INK_DIM,
                        background: 'rgba(244,241,234,0.08)',
                        border: '1px solid rgba(244,241,234,0.12)',
                      },
                    },
                    g,
                  ),
                ),
              )
            : el('div', { style: { display: 'flex' } }),
        ]),
        wordmark(),
      ],
    ),
  ]);
}

// ---------- Company card ----------
export function companyCard(input: { name: string; logoUrl: string | null; gameCount: number; reviewCount: number }): SatoriNode {
  const { name, logoUrl, gameCount, reviewCount } = input;
  return el('div', { style: { ...background(), alignItems: 'center', gap: 56 } }, [
    logoUrl
      ? el('img', {
          src: logoUrl,
          width: 220,
          height: 220,
          style: { borderRadius: 24, objectFit: 'contain', background: '#fff', padding: 20 },
        })
      : el('div', {
          style: {
            display: 'flex',
            width: 220,
            height: 220,
            borderRadius: 24,
            background: `linear-gradient(155deg, #241a12, ${BG})`,
            border: '1px solid rgba(244,241,234,0.12)',
          },
        }),
    el(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', height: 420 } },
      [
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } }, [
          el(
            'div',
            {
              style: {
                display: 'flex',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: ACCENT,
              },
            },
            'Studio',
          ),
          el('div', { style: { display: 'flex', fontSize: 52, fontWeight: 800, color: INK, lineHeight: 1.15 } }, name),
          el(
            'div',
            { style: { display: 'flex', fontSize: 22, color: INK_DIM } },
            `${gameCount} jeux · ${reviewCount} avis`,
          ),
        ]),
        wordmark(),
      ],
    ),
  ]);
}

// ---------- Review card ----------
export function reviewCard(input: {
  gameTitle: string | null;
  companyName: string | null;
  coverUrl: string | null;
  username: string;
  avatarUrl: string | null;
  rating: number;
  text: string | null;
  title: string | null;
}): SatoriNode {
  const { gameTitle, companyName, coverUrl, username, avatarUrl, rating, text, title } = input;
  const target = gameTitle ?? companyName ?? '';
  const excerpt = (title ?? text ?? '').slice(0, 220);
  return el('div', { style: { ...background(), flexDirection: 'column', justifyContent: 'space-between' } }, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: 22 } }, [
      coverNode(coverUrl, 90, 126),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
        el(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: ACCENT,
            },
          },
          'Critique',
        ),
        el('div', { style: { display: 'flex', fontSize: 30, fontWeight: 700, color: INK } }, target),
      ]),
    ]),
    el(
      'div',
      {
        style: {
          display: 'flex',
          fontSize: 40,
          fontWeight: 600,
          color: INK,
          lineHeight: 1.35,
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        },
      },
      `“${excerpt}${excerpt.length >= 220 ? '…' : ''}”`,
    ),
    el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } }, [
        avatarNode(username, avatarUrl, 52),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
          el('div', { style: { display: 'flex', fontSize: 22, fontWeight: 700, color: INK } }, username),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
            ratingPips(rating, 14),
            el('div', { style: { display: 'flex', fontSize: 16, color: INK_DIM } }, `${(rating / 2).toFixed(1)}/5`),
          ]),
        ]),
      ]),
      wordmark(),
    ]),
  ]);
}

// ---------- Profile card ----------
export function profileCard(input: {
  username: string;
  avatarUrl: string | null;
  reviewCount: number;
  playedCount: number;
  rank: number | null;
  topCovers: string[];
}): SatoriNode {
  const { username, avatarUrl, reviewCount, playedCount, rank, topCovers } = input;
  return el('div', { style: { ...background(), flexDirection: 'column', justifyContent: 'space-between' } }, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: 32 } }, [
      avatarNode(username, avatarUrl, 140),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, [
        el(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: ACCENT,
            },
          },
          'Profil Saveboxd',
        ),
        el('div', { style: { display: 'flex', fontSize: 54, fontWeight: 800, color: INK } }, username),
        el('div', { style: { display: 'flex', gap: 28 } }, [
          statChip(`${playedCount}`, 'jeux faits'),
          statChip(`${reviewCount}`, 'critiques'),
          rank !== null ? statChip(`#${rank}`, 'classement') : el('div', { style: { display: 'flex' } }),
        ]),
      ]),
    ]),
    el('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } }, [
      el(
        'div',
        { style: { display: 'flex', gap: 10 } },
        topCovers.slice(0, 6).map((src) =>
          el('img', {
            src,
            width: 84,
            height: 118,
            style: { borderRadius: 10, objectFit: 'cover', border: '1px solid rgba(244,241,234,0.15)' },
          }),
        ),
      ),
      wordmark(),
    ]),
  ]);
}

function statChip(n: string, label: string): SatoriNode {
  return el('div', { style: { display: 'flex', flexDirection: 'column' } }, [
    el('div', { style: { display: 'flex', fontFamily: 'Sora', fontSize: 26, fontWeight: 700, color: INK } }, n),
    el(
      'div',
      { style: { display: 'flex', fontSize: 14, color: INK_FAINT, textTransform: 'uppercase', letterSpacing: 1 } },
      label,
    ),
  ]);
}

// ---------- Generic fallback (resource missing, or render error) ----------
export function fallbackCard(): SatoriNode {
  return el(
    'div',
    { style: { ...background(), alignItems: 'center', justifyContent: 'center' } },
    el('div', { style: { display: 'flex', transform: 'scale(1.6)' } }, wordmark()),
  );
}
