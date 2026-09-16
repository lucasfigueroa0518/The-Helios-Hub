import Parser from 'rss-parser';

import { HELIOS_SOCIAL_FRESHNESS_HOURS, type FeedConfig } from '@/lib/social/feeds';

export type FetchedArticle = {
  feedSlug: string;
  feedKind: 'native' | 'google-news';
  /** Outlet display name — from RSS <source> or feed title, else FeedConfig.name. */
  source: string;
  /** Canonical article URL. For Google News feeds this stays wrapped in the
   * google.com redirect; a future URL-resolution pass will unwrap it. */
  sourceUrl: string;
  headline: string;
  /** Article author name(s), joined by ", " if multiple. Null when unknown. */
  byline: string | null;
  /** Plain-text article body (HTML stripped). May be lede-only if the outlet
   * truncates RSS content. */
  body: string;
  publishedAt: Date;
};

const HTML_TAG = /<[^>]+>/g;
const WHITESPACE = /\s+/g;

// rss-parser custom fields for author extraction across feed variants.
type ExtendedItem = {
  creator?: string;
  'dc:creator'?: string;
  author?: string | { name?: string };
  'content:encoded'?: string;
  content?: string;
  contentSnippet?: string;
  source?: string | { title?: string; _?: string };
};

const parser: Parser<Record<string, unknown>, ExtendedItem> = new Parser({
  timeout: 15_000,
  headers: {
    'User-Agent': 'HeliosSocial/1.0 (+https://hub.heliosgroup.tech; ingest bot)',
  },
  customFields: {
    item: [
      ['dc:creator', 'dc:creator'],
      ['content:encoded', 'content:encoded'],
      ['source', 'source'],
    ],
  },
});

function stripHtml(html: string | undefined): string {
  if (!html) return '';
  return html.replace(HTML_TAG, ' ').replace(WHITESPACE, ' ').trim();
}

function parsePublishedAt(item: { isoDate?: string; pubDate?: string }): Date | null {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isFresh(publishedAt: Date): boolean {
  const cutoff = Date.now() - HELIOS_SOCIAL_FRESHNESS_HOURS * 60 * 60 * 1000;
  return publishedAt.getTime() >= cutoff;
}

function extractByline(item: ExtendedItem): string | null {
  const candidates: (string | null | undefined)[] = [
    item.creator,
    item['dc:creator'],
    typeof item.author === 'string' ? item.author : item.author?.name,
  ];
  for (const c of candidates) {
    if (c && c.trim()) return c.trim();
  }
  return null;
}

/**
 * For Google News RSS, each item carries a <source> field with the real outlet
 * name (e.g. "Bloomberg", "The Verge"). Use it when present so cards display
 * the actual publisher, not "Google News".
 */
function extractOutletName(
  item: ExtendedItem,
  feedTitleFallback: string,
  configFallback: string,
): string {
  const src = item.source;
  if (typeof src === 'string' && src.trim()) return src.trim();
  if (src && typeof src === 'object') {
    if (src.title?.trim()) return src.title.trim();
    if (src._?.trim()) return src._.trim();
  }
  return feedTitleFallback || configFallback;
}

/**
 * Hard timeout wrapper — rss-parser's own `timeout` option doesn't fully enforce
 * read-timeout for feeds that hold connections open without sending data
 * (observed: certain Google News queries + a few outlet feeds hang indefinitely).
 * Promise.race guarantees we never wait longer than `ms` on any single feed.
 */
function withHardTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err); },
    );
  });
}

const FEED_HARD_TIMEOUT_MS = 20_000;

async function fetchOne(feed: FeedConfig): Promise<FetchedArticle[]> {
  const t0 = Date.now();
  console.error(`[helios-social] fetch → ${feed.slug}`);
  try {
    const parsed = await withHardTimeout(
      parser.parseURL(feed.url),
      FEED_HARD_TIMEOUT_MS,
      feed.slug,
    );
    const feedTitle = parsed.title?.trim() || feed.name;
    const results: FetchedArticle[] = [];

    for (const rawItem of parsed.items ?? []) {
      const item = rawItem as ExtendedItem & { link?: string; title?: string; isoDate?: string; pubDate?: string };
      if (!item.link || !item.title) continue;

      const publishedAt = parsePublishedAt(item);
      if (!publishedAt || !isFresh(publishedAt)) continue;

      const body =
        stripHtml(item['content:encoded'])
        || stripHtml(item.content)
        || stripHtml(item.contentSnippet)
        || '';
      if (!body) continue;

      results.push({
        feedSlug: feed.slug,
        feedKind: feed.kind,
        source: extractOutletName(item, feedTitle, feed.name),
        sourceUrl: item.link,
        headline: item.title.trim(),
        byline: extractByline(item),
        body,
        publishedAt,
      });
    }

    const totalItems = parsed.items?.length ?? 0;
    console.error(
      `[helios-social] fetch ✓ ${feed.slug}: ${results.length} fresh / ${totalItems} total (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    return results;
  } catch (err) {
    console.error(
      `[helios-social] fetch ✗ ${feed.slug}: ${err instanceof Error ? err.message : String(err)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    return [];
  }
}

/**
 * Fetches every configured feed in parallel and returns a flat list of fresh
 * articles (≤ HELIOS_SOCIAL_FRESHNESS_HOURS old). Per-feed errors are logged
 * to stderr but do not abort the run.
 */
export async function fetchAllFeeds(feeds: FeedConfig[]): Promise<FetchedArticle[]> {
  const results = await Promise.all(feeds.map(fetchOne));
  return results.flat();
}
