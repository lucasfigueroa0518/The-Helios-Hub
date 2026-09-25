import { decodeEntities, htmlToText } from '@/lib/reels/net/html';

/**
 * RSS 2.0 and Atom reader. Feeds are small and well-formed enough that a
 * targeted reader beats adding an XML dependency to the app bundle.
 */

export type FeedItem = {
  title: string;
  link: string;
  publishedAt: Date | null;
  author: string | null;
  summary: string;
  /** Some feeds ship the whole article in content:encoded. */
  contentHtml: string | null;
};

function tagContent(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(pattern);
  if (!match) return null;
  return unwrapCdata(match[1]);
}

function unwrapCdata(value: string): string {
  const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdata ? cdata[1] : value;
}

function attribute(xml: string, tag: string, name: string): string | null {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${name}=["']([^"']+)["'][^>]*>`, 'i');
  return xml.match(pattern)?.[1] ?? null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function blocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return Array.from(xml.matchAll(pattern), (match) => match[1]);
}

export function parseFeed(xml: string): FeedItem[] {
  const rssItems = blocks(xml, 'item');
  const atomEntries = rssItems.length > 0 ? [] : blocks(xml, 'entry');

  const items = rssItems.map((block) => {
    const contentHtml = tagContent(block, 'content:encoded');
    const description = tagContent(block, 'description') ?? '';
    return {
      title: cleanTitle(tagContent(block, 'title') ?? ''),
      link: (tagContent(block, 'link') ?? attribute(block, 'link', 'href') ?? '').trim(),
      publishedAt: parseDate(tagContent(block, 'pubDate') ?? tagContent(block, 'dc:date')),
      author: cleanTitle(
        tagContent(block, 'dc:creator') ?? tagContent(block, 'author') ?? '',
      ) || null,
      summary: htmlToText(description),
      contentHtml,
    } satisfies FeedItem;
  });

  const entries = atomEntries.map((block) => {
    const contentHtml = tagContent(block, 'content');
    const summary = tagContent(block, 'summary') ?? '';
    // Atom puts the URL on a link element's href, and self/alternate both appear.
    const links = Array.from(block.matchAll(/<link\b[^>]*>/gi), (match) => match[0]);
    const alternate = links.find((link) => /rel=["']alternate["']/i.test(link)) ?? links[0] ?? '';
    const href = alternate.match(/href=["']([^"']+)["']/i)?.[1] ?? '';
    return {
      title: cleanTitle(tagContent(block, 'title') ?? ''),
      link: href.trim(),
      publishedAt: parseDate(tagContent(block, 'published') ?? tagContent(block, 'updated')),
      author: cleanTitle(tagContent(block, 'name') ?? '') || null,
      summary: htmlToText(summary),
      contentHtml,
    } satisfies FeedItem;
  });

  return [...items, ...entries].filter((item) => item.title && item.link);
}

function cleanTitle(value: string): string {
  return decodeEntities(unwrapCdata(value).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
