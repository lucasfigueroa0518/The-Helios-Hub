/**
 * Raw-text page reader for the Reporter (spec §4.2c, §5.1).
 *
 * Returns the article's RAW text (Readability's extracted text, never a
 * summary or paraphrase) plus every photo in the article with its caption
 * and credit line copied exactly as the page shows them. Whether a credit
 * is allowed is decided later by code (M6); this module only reports.
 *
 * Code only, no AI. The parsing half (`parseArticleHtml`) is pure so it is
 * tested offline against saved HTML.
 */
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

import { isGoogleNewsUrl, resolveGoogleNewsUrl } from '@/lib/social/ingest/resolve-google-news';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';
const FETCH_TIMEOUT_MS = 15_000;
/** Max characters of text handed to the model per page. */
export const MAX_TEXT_CHARS = 50_000;
/** Below this the page is a stub or a paywall wall, not an article. */
export const MIN_TEXT_CHARS = 200;

export type ArticlePhoto = {
  /** Absolute image URL (largest srcset candidate when present). */
  src: string;
  /** Caption text as shown, credit removed when it's a separate element. Null when none. */
  caption: string | null;
  /** Credit line exactly as shown. Null when the page gives none (→ not usable, spec §5.1). */
  credit: string | null;
  alt: string | null;
  /** 'figure' = in the article body; 'og:image' = the page's share image (no caption/credit). */
  from: 'figure' | 'og:image';
};

export type PageReadOk = {
  ok: true;
  url: string;
  resolvedUrl: string;
  title: string | null;
  byline: string | null;
  publishedTime: string | null;
  text: string;
  truncated: boolean;
  photos: ArticlePhoto[];
};

export type PageRead = PageReadOk | { ok: false; url: string; error: string };

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Paragraph breaks kept, whitespace inside lines collapsed (same normalisation as ingest). */
function normalizeText(raw: string): string {
  return raw
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

function largestFromSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = size ? parseFloat(size) : 0;
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url ?? null;
}

function imageSrc(img: Element, base: string): string | null {
  const raw =
    largestFromSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset')) ??
    img.getAttribute('src') ??
    img.getAttribute('data-src') ??
    img.getAttribute('data-lazy-src');
  if (!raw || raw.startsWith('data:')) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

const CREDIT_SELECTOR = '[class*="credit" i], [class*="copyright" i], [class*="attribution" i], [itemprop="copyrightHolder"]';

/** A labelled credit: "Photo: X", "Image by X", "Credit: X", "Courtesy of X", "(Photo: X)". */
const LABELLED_CREDIT = /\(?\b(?:(?:photo(?:graph)?|image|picture)s?\s+credits?|(?:photo(?:graph)?|image|picture|credit)s?)(?:\s+by\s+|\s*[:|]\s*)|\(?\bcourtesy(?:\s+of)?\s+/gi;

/** "Kent Nishimura/AFP via Getty Images", "J. Scott Applewhite/AP" at the very end. */
const AGENCY_CREDIT = /(?:(?:[A-Z]\.|[A-Z][\w'-]+)\s+)*[A-Z][\w'-]+\s*\/\s*[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*)*(?:\s+via\s+[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*)*)?\s*$/;

/**
 * Credit written inside the caption text. Takes the LAST labelled marker
 * (so "an image of the robot … Photo: Google" yields "Photo: Google"), else
 * a trailing "Name/Agency" credit. Returns the credit exactly as written.
 */
function inlineCredit(text: string): { caption: string; credit: string } | null {
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(LABELLED_CREDIT)) last = m as RegExpExecArray;
  if (last && last.index !== undefined) {
    // index 0: the whole caption is a credit ("Image Credits: …").
    return {
      caption: clean(text.slice(0, last.index)),
      credit: clean(text.slice(last.index)).replace(/^\(/, '').replace(/\)$/, ''),
    };
  }
  const agency = text.match(AGENCY_CREDIT);
  if (agency && agency.index !== undefined && agency.index > 0) {
    return { caption: clean(text.slice(0, agency.index)), credit: clean(agency[0]) };
  }
  return null;
}

function splitCaption(figcaption: Element): { caption: string | null; credit: string | null } {
  const creditEls = [...figcaption.querySelectorAll(CREDIT_SELECTOR)];
  if (creditEls.length > 0) {
    const credit = clean(creditEls.map((e) => e.textContent).join(' '));
    const copy = figcaption.cloneNode(true) as Element;
    for (const e of copy.querySelectorAll(CREDIT_SELECTOR)) e.remove();
    return { caption: clean(copy.textContent) || null, credit: credit || null };
  }
  const text = clean(figcaption.textContent);
  const split = inlineCredit(text);
  if (split) return { caption: split.caption || null, credit: split.credit || null };
  return { caption: text || null, credit: null };
}

/** Logos, icons and avatars are never article photos (spec §5.1 rules out logos). */
const NOT_A_PHOTO = /\.svg(\?|$)|logo|lockup|wordmark|icon|avatar|sprite/i;

/** Same image at a different size (?w=…) counts once. */
function photoKey(src: string): string {
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`;
  } catch {
    return src;
  }
}

/** Page chrome whose figures aren't article photos. */
const CHROME = 'nav, footer, aside, [role="navigation"], [role="complementary"], [class*="related" i], [class*="newsletter" i]';

/**
 * Article photos: every <figure> with an image, from the original DOM
 * (Readability drops caption structure), plus og:image. Searches the whole
 * body, because hero photos often sit outside <article>/<main> (TechCrunch,
 * 2026-10-04), and skips figures inside page chrome.
 */
function extractPhotos(doc: Document, base: string): ArticlePhoto[] {
  const photos: ArticlePhoto[] = [];
  const seen = new Set<string>();
  for (const fig of doc.body?.querySelectorAll('figure') ?? []) {
    if (fig.closest(CHROME)) continue;
    const img = fig.querySelector('img');
    if (!img) continue;
    const src = imageSrc(img, base);
    if (!src || seen.has(photoKey(src))) continue;
    if (NOT_A_PHOTO.test(src) || NOT_A_PHOTO.test(img.getAttribute('alt') ?? '')) continue;
    seen.add(photoKey(src));
    const figcaption = fig.querySelector('figcaption');
    let { caption, credit } = figcaption ? splitCaption(figcaption) : { caption: null, credit: null };
    if (!credit) {
      // Some sites put the credit beside the caption, inside the figure.
      const sibling = fig.querySelector(CREDIT_SELECTOR);
      if (sibling && !figcaption?.contains(sibling)) credit = clean(sibling.textContent) || null;
    }
    photos.push({ src, caption, credit, alt: clean(img.getAttribute('alt')) || null, from: 'figure' });
  }
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (og) {
    try {
      const src = new URL(og, base).toString();
      if (!seen.has(photoKey(src))) photos.push({ src, caption: null, credit: null, alt: null, from: 'og:image' });
    } catch {
      /* ignore malformed og:image */
    }
  }
  return photos;
}

/** Pure: HTML → raw text + photos. Null when there's no article (or under MIN_TEXT_CHARS of text). */
export function parseArticleHtml(
  html: string,
  url: string,
  resolvedUrl: string = url,
): PageReadOk | null {
  const dom = new JSDOM(html, { url: resolvedUrl });
  const doc = dom.window.document;
  // Photos first: Readability mutates the document it parses.
  const photos = extractPhotos(doc, resolvedUrl);
  const publishedTime =
    doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null;
  const article = new Readability(doc).parse();
  if (!article) return null;
  const full = normalizeText(article.textContent ?? '');
  if (full.length < MIN_TEXT_CHARS) return null;
  return {
    ok: true,
    url,
    resolvedUrl,
    title: article.title ?? null,
    byline: article.byline ?? null,
    publishedTime,
    text: full.slice(0, MAX_TEXT_CHARS),
    truncated: full.length > MAX_TEXT_CHARS,
    photos,
  };
}

export type FetchHtml = (url: string) => Promise<string | null>;

export const fetchHtmlLive: FetchHtml = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch one page (Google News links resolved first) and parse it. */
export async function readPage(url: string, fetchHtml: FetchHtml = fetchHtmlLive): Promise<PageRead> {
  let resolvedUrl = url;
  if (isGoogleNewsUrl(url)) {
    const resolved = await resolveGoogleNewsUrl(url);
    if (!resolved) return { ok: false, url, error: 'could not resolve Google News link' };
    resolvedUrl = resolved.resolvedUrl;
  }
  const html = await fetchHtml(resolvedUrl);
  if (!html) return { ok: false, url, error: 'fetch failed' };
  try {
    const parsed = parseArticleHtml(html, url, resolvedUrl);
    return parsed ?? { ok: false, url, error: 'no article text found' };
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}
