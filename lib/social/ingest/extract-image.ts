import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Extract the hero image from an article URL.
 *
 * Priority (highest → lowest):
 *   1. og:image (Open Graph standard — nearly every publisher sets this)
 *   2. twitter:image (Twitter Cards — fallback for a few outlets)
 *   3. first <img> in <article> or <main> (last-ditch, often noisy)
 *
 * Returns the absolute URL. `downloadTo` optionally mirrors the image into
 * a local path (public/social/) so we're not hotlinking to publisher CDNs
 * in production — that's caching, not scraping-for-content.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';

const FETCH_TIMEOUT_MS = 8000;

export type ExtractedImage = {
  articleUrl: string;
  imageUrl: string;
  source: 'og:image' | 'twitter:image' | 'article-img';
  /** Present when downloadTo was passed and the download succeeded. */
  localPath?: string;
};

export async function extractArticleImage(
  articleUrl: string,
  options?: { downloadTo?: string },
): Promise<ExtractedImage | null> {
  const html = await fetchHtml(articleUrl);
  if (!html) return null;

  const found =
    findMetaContent(html, 'og:image') ||
    findMetaContent(html, 'og:image:secure_url') ||
    findMetaContent(html, 'twitter:image') ||
    findMetaContent(html, 'twitter:image:src') ||
    findFirstArticleImg(html);
  if (!found) return null;

  const { url: imageUrl, source } = found;
  const absoluteUrl = new URL(imageUrl, articleUrl).toString();

  let localPath: string | undefined;
  if (options?.downloadTo) {
    localPath = await downloadImage(absoluteUrl, options.downloadTo);
  }

  return { articleUrl, imageUrl: absoluteUrl, source, localPath };
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Regex-based meta-tag scan. HTML parsers (cheerio) would be more correct but
 * add a 5 MB dep; the Open Graph tag has enough structure that regex catches
 * every real-world case I've seen. Handles both attribute orderings:
 *   <meta property="og:image" content="...">
 *   <meta content="..." property="og:image">
 */
function findMetaContent(
  html: string,
  key: string,
): { url: string; source: ExtractedImage['source'] } | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) {
      const source = key.startsWith('og:')
        ? 'og:image' as const
        : 'twitter:image' as const;
      return { url: decodeHtmlEntities(match[1]), source };
    }
  }
  return null;
}

function findFirstArticleImg(html: string): { url: string; source: ExtractedImage['source'] } | null {
  const scope =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
    html;
  const match = scope.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!match?.[1]) return null;
  return { url: decodeHtmlEntities(match[1]), source: 'article-img' };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function downloadImage(url: string, destAbsolute: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: new URL(url).origin,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(destAbsolute), { recursive: true });
    await fs.writeFile(destAbsolute, buffer);
    return destAbsolute;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
