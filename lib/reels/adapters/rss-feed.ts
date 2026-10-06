import { ARTICLE_FEED_CAP, FULL_TEXT_MIN_CHARS } from '@/lib/reels/config';
import { parseFeed } from '@/lib/reels/net/feed';
import { htmlToText } from '@/lib/reels/net/html';
import { canonicalizeUrl, fetchText } from '@/lib/reels/net/http';
import { publishedSince } from '@/lib/reels/net/published';
import { looksLikeTeaser } from '@/lib/reels/net/teaser';
import type { Adapter, AdapterItem, Bucket, SourceType } from '@/lib/reels/types';

export type RssAdapterConfig = {
  id: string;
  name: string;
  type: SourceType;
  bucket: Bucket;
  feedUrl: string;
  cap?: number;
  /** D-264. See AdapterDefinition.quietAfterDays. */
  quietAfterDays?: number;
  /**
   * The description is the piece, and the link is not an article to follow.
   * Console.dev reviews are a few hundred characters and point at the product.
   * Shorter than the complete-text floor still drops, without a second fetch.
   */
  inlineBody?: boolean;
};

/**
 * Dated feeds for B1, A5, A6, and B3. New material is whatever published since
 * the last successful run, with a 24-hour lookback on night one (ING-02 /
 * D-032), capped per source and ordered newest first (ING-04 / D-035).
 *
 * A feed that ships the whole article in content:encoded needs no second
 * request. Otherwise the item is a pointer and the pipeline follows it
 * (REC-03 / D-041).
 */
export function rssAdapter(config: RssAdapterConfig): Adapter {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    bucket: config.bucket,
    kind: 'dated',
    cap: config.cap ?? ARTICLE_FEED_CAP,
    quietAfterDays: config.quietAfterDays,

    async fetchItems({ since, signal }) {
      const xml = await fetchText(config.feedUrl, {
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
        signal,
      });

      return parseFeed(xml)
        .filter((entry) => !entry.publishedAt || publishedSince(entry.publishedAt, since))
        .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
        .map((entry): AdapterItem => {
          const inlineText = entry.contentHtml ? htmlToText(entry.contentHtml) : '';
          // D-245: a teaser in content:encoded is a pointer, not the article.
          const hasFullText = inlineText.length >= FULL_TEXT_MIN_CHARS && !looksLikeTeaser(inlineText);
          if (config.inlineBody) {
            return {
              canonicalUrl: canonicalizeUrl(entry.link),
              headline: entry.title,
              body: entry.summary,
              author: entry.author,
              byline: entry.author ? `${entry.author}, ${config.name}` : config.name,
              publishTime: entry.publishedAt,
              textIsComplete: true,
              rawPayload: { feed: config.feedUrl, title: entry.title },
            };
          }
          return {
            canonicalUrl: canonicalizeUrl(entry.link),
            headline: entry.title,
            body: hasFullText || looksLikeTeaser(inlineText) ? inlineText : entry.summary,
            author: entry.author,
            byline: entry.author ? `${entry.author}, ${config.name}` : config.name,
            publishTime: entry.publishedAt,
            textIsComplete: hasFullText,
            destinationUrl: hasFullText ? undefined : entry.link,
            rawPayload: { feed: config.feedUrl, title: entry.title },
          };
        });
    },
  };
}
