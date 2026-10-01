import { ARTICLE_FEED_CAP, COMPLETE_TEXT_MIN_CHARS } from '@/lib/reels/config';
import { parseFeed } from '@/lib/reels/net/feed';
import { decodeEntities, htmlToText } from '@/lib/reels/net/html';
import { canonicalizeUrl, fetchText } from '@/lib/reels/net/http';
import { publishedSince } from '@/lib/reels/net/published';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

const FEED_URL = 'https://tldr.tech/api/rss/tech';

export type TldrStory = {
  headline: string;
  url: string;
  blurb: string;
};

/**
 * One `<article>` in a TLDR issue: a destination link, a headline, and the
 * blurb TLDR wrote. The issue page is a roundup, which the ingest screen drops
 * as junk. The blurb is the free text; several destinations are paywalled.
 */
export function parseTldrStories(html: string): TldrStory[] {
  const articles = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) ?? [];
  const stories: TldrStory[] = [];

  for (const article of articles) {
    const link = article.match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/i,
    );
    const blurbHtml = article.match(
      /<div\b[^>]*newsletter-html[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (!link) continue;

    const headline = cleanHeadline(link[2]);
    if (!headline || /\(sponsor\)/i.test(headline)) continue;

    const blurb = htmlToText(blurbHtml?.[1] ?? '');
    if (blurb.length < COMPLETE_TEXT_MIN_CHARS) continue;

    stories.push({ headline: stripReadTime(headline), url: link[1], blurb });
  }

  return stories;
}

function cleanHeadline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripReadTime(headline: string): string {
  return headline.replace(/\s*\(\d+\s+minute read\)\s*$/i, '').trim();
}

/**
 * A6. The feed row is only a title and a midnight date. Each issue page is
 * split into its stories, newest issue first, and the nightly cap still applies.
 */
export const tldr: Adapter = {
  id: 'tldr',
  name: 'TLDR',
  type: 'A6',
  bucket: 'A',
  kind: 'dated',
  cap: ARTICLE_FEED_CAP,

  async fetchItems({ since, signal }) {
    const xml = await fetchText(FEED_URL, {
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      signal,
    });

    const issues = parseFeed(xml)
      .filter((entry) => !entry.publishedAt || publishedSince(entry.publishedAt, since))
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

    const items: AdapterItem[] = [];
    for (const issue of issues) {
      const html = await fetchText(issue.link, { signal });
      for (const story of parseTldrStories(html)) {
        items.push({
          canonicalUrl: canonicalizeUrl(story.url),
          headline: story.headline,
          body: story.blurb,
          author: issue.author,
          byline: issue.author ? `${issue.author}, TLDR` : 'TLDR',
          publishTime: issue.publishedAt,
          textIsComplete: true,
          citationUrls: [canonicalizeUrl(issue.link)],
          rawPayload: { feed: FEED_URL, issue: issue.link },
        });
      }
    }

    return items;
  },
};
