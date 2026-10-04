import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

import { isGoogleNewsUrl, resolveGoogleNewsUrl } from '@/lib/social/ingest/resolve-google-news';

/**
 * Fetches an article URL, runs Firefox's Readability algorithm against the
 * HTML, and returns cleaned article text.
 *
 * Purpose: RSS feeds vary wildly in how much body they include. The Verge and
 * TechCrunch put the full article in `content:encoded`; NYT, Axios, and Google
 * News summaries include only a headline blurb. Editorial's fact-sheet stage
 * needs the actual article to work — this module fills the gap.
 *
 * Google News RSS wrapper URLs (news.google.com/rss/articles/CBM...) are
 * resolved to the real publisher URL first via resolve-google-news.ts
 * before Readability runs.
 *
 * Failure modes handled by returning null:
 *   - Google News URL fails to resolve (Google changed encoding)
 *   - Network fetch fails (timeout, 4xx, 5xx)
 *   - HTML parses but Readability can't find a main article element
 *   - Extracted text is shorter than `minTextLength` (usually a paywall wall)
 *
 * On success, returns the cleaned plain text and the resolution/extraction
 * path taken so callers can log or debug.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';

const FETCH_TIMEOUT_MS = 15_000;

export type ExtractedBody = {
  /** The URL passed in (may be a Google News wrapper). */
  articleUrl: string;
  /** The URL Readability actually parsed (Google News → resolved publisher URL). */
  resolvedUrl: string;
  text: string;
  /** Character count of the returned text. Convenience for callers deciding whether to keep it. */
  length: number;
  method: 'readability';
  /** True when the input was a Google News wrapper and we resolved it. */
  googleNewsResolved: boolean;
  /** Title Readability found, if any — the publisher's canonical title, not the RSS one. */
  title: string | null;
  /** Byline Readability found, if any. */
  byline: string | null;
  /** Excerpt / dek if Readability found one. Handy for previews. */
  excerpt: string | null;
};

export type ExtractArticleBodyOptions = {
  /** Minimum acceptable length in characters. Below this, return null. */
  minTextLength?: number;
  /** Override the fetch timeout for slow hosts. */
  timeoutMs?: number;
};

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    clearTimeout(timer);
  }
}

/**
 * Normalize whitespace: collapse runs of spaces/tabs, keep paragraph breaks.
 * Readability's `textContent` output is close to what we want but often has
 * cruft like leading/trailing whitespace on every line.
 */
function normalizeText(raw: string): string {
  return raw
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

export async function extractArticleBody(
  articleUrl: string,
  options: ExtractArticleBodyOptions = {},
): Promise<ExtractedBody | null> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const minTextLength = options.minTextLength ?? 500;

  // Resolve Google News wrapper URLs to the underlying publisher URL first.
  // Native URLs pass through unchanged.
  let resolvedUrl = articleUrl;
  let googleNewsResolved = false;
  if (isGoogleNewsUrl(articleUrl)) {
    const resolved = await resolveGoogleNewsUrl(articleUrl);
    if (!resolved) return null;
    resolvedUrl = resolved.resolvedUrl;
    googleNewsResolved = resolvedUrl !== articleUrl;
  }

  const html = await fetchHtml(resolvedUrl, timeoutMs);
  if (!html) return null;

  let text = '';
  let title: string | null = null;
  let byline: string | null = null;
  let excerpt: string | null = null;

  try {
    // Give Readability the resolved URL as documentUrl so it can resolve
    // relative asset paths in the parsed article — otherwise Readability
    // sometimes emits base-tag warnings.
    const dom = new JSDOM(html, { url: resolvedUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article) return null;

    text = normalizeText(article.textContent ?? '');
    title = article.title ?? null;
    byline = article.byline ?? null;
    excerpt = article.excerpt ?? null;
  } catch {
    return null;
  }

  if (text.length < minTextLength) return null;

  return {
    articleUrl,
    resolvedUrl,
    text,
    length: text.length,
    method: 'readability',
    googleNewsResolved,
    title,
    byline,
    excerpt,
  };
}
