/**
 * Minimal readability pass. Code strips chrome; Jev makes the keep/drop
 * judgment afterwards (CLN-01 / D-047). Deliberately dependency-free.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '\u00b7',
  eacute: '\u00e9',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Chrome that never carries the story. */
const STRIPPED_BLOCKS =
  /<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template|figure)\b[^>]*>[\s\S]*?<\/\1>/gi;

const BLOCK_BREAK = /<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi;

export function htmlToText(html: string): string {
  const withoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(STRIPPED_BLOCKS, ' ');

  const withBreaks = withoutChrome
    .replace(BLOCK_BREAK, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ');

  return normalizeText(decodeEntities(withBreaks.replace(/<[^>]+>/g, ' ')));
}

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Prefer the article container when the page marks one. */
export function extractMainHtml(html: string): string {
  const containers = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:id|class)="[^"]*(?:article-content|post-content|entry-content|articleBody)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];
  let best = '';
  for (const pattern of containers) {
    const match = html.match(pattern);
    if (match && match[1].length > best.length) best = match[1];
  }
  return best || html;
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return null;
}

export type PageContent = {
  title: string | null;
  text: string;
  author: string | null;
  publishedAt: Date | null;
  imageUrls: string[];
  paywalled: boolean;
};

/**
 * Markers that mean the visible text is a teaser. We never bypass these; the
 * item is skipped instead (D-036).
 */
const PAYWALL_MARKERS =
  /(subscribe to (?:continue|read)|this article is for subscribers|already a subscriber|metered paywall|to continue reading, (?:please )?(?:sign|log) in|create a free account to (?:keep )?read)/i;

export function parsePage(html: string): PageContent {
  const title = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);

  const author = metaContent(html, [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i,
  ]);

  const publishedRaw = metaContent(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:pubdate|publish-date|date)["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ]);
  const published = publishedRaw ? new Date(publishedRaw) : null;

  const imageUrls: string[] = [];
  const ogImage = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]);
  if (ogImage) imageUrls.push(ogImage);

  const text = htmlToText(extractMainHtml(html));

  return {
    title,
    text,
    author,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    imageUrls,
    paywalled: PAYWALL_MARKERS.test(text.slice(0, 4000)),
  };
}

/** Markdown from a README, stripped to prose for the record body. */
export function markdownToText(markdown: string): string {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1');
  const withoutBadges = withoutCode.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  const withoutLinks = withoutBadges.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return normalizeText(
    withoutLinks
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[>*-]\s+/gm, '- ')
      .replace(/[*_~]{1,3}/g, ''),
  );
}
