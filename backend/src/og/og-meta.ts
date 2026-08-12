// Escapes text dropped into an HTML attribute or text node — every value
// here comes from user content (title, bio, review text), never trust it raw.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function metaHtml(input: {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  type?: 'website' | 'article' | 'profile';
}): string {
  const { title, description, imageUrl, canonicalUrl, type = 'website' } = input;
  // No client JS here on purpose: this document is only ever served to
  // crawlers (nginx routes real browsers straight to the SPA). The meta
  // refresh is a courtesy fallback if a human lands here directly.
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonicalUrl)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Saveboxd">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<meta http-equiv="refresh" content="0;url=${esc(canonicalUrl)}">
</head>
<body><a href="${esc(canonicalUrl)}">${esc(title)}</a></body>
</html>`;
}

