/**
 * Give Jev enough text to judge substance (code only, no AI).
 *
 * Each group is scored with the member that has the most text. When the
 * best RSS body is thin, members' full pages are fetched in preference
 * order (native first, longest RSS body) until one clears THIN_BODY_CHARS
 * or the members run out. A fetch that "succeeds" with a paywall lede just
 * doesn't clear the bar, so the next member is tried.
 *
 * Why (live run 2026-10-04): 38 of 47 substance failures were scored on
 * thin text; the Trump/Clayton group scored 0.17 on a 227-char Bloomberg
 * lede while TechCrunch's full article sat in the same group.
 */
import { mapPool } from '@/lib/async-pool';
import { extractArticleBody } from '@/lib/social/ingest/extract-article-body';

import type { IngestArticle, StoryGroup } from './types';

export const THIN_BODY_CHARS = 1500;

/** Returns the page's plain text, or null when it can't be read. */
export type FetchBody = (url: string) => Promise<string | null>;

/** Live fetcher: Readability over the publisher page (Google News links resolved inside). */
export const fetchBodyLive: FetchBody = async (url) => (await extractArticleBody(url))?.text ?? null;

export async function enrichGroup(group: StoryGroup, fetchBody: FetchBody): Promise<StoryGroup> {
  let best: IngestArticle = group.articles.reduce((a, b) => (b.body.length > a.body.length ? b : a));
  let text = best.body;
  for (const article of group.articles) {
    if (text.length >= THIN_BODY_CHARS) break;
    let page: string | null = null;
    try {
      page = await fetchBody(article.sourceUrl);
    } catch {
      page = null;
    }
    if (page && page.length > text.length) {
      best = article;
      text = page;
    }
  }
  return { ...group, representative: best, body: text };
}

export async function enrichThinBodies(groups: StoryGroup[], fetchBody: FetchBody): Promise<StoryGroup[]> {
  return mapPool(groups, 6, (group) => enrichGroup(group, fetchBody));
}
