/**
 * When a group's representative RSS body is thin, fetch the page's full
 * text (code only, no AI) so Jev can judge substance. Injectable for tests.
 */
import { mapPool } from '@/lib/async-pool';
import { extractArticleBody } from '@/lib/social/ingest/extract-article-body';

import type { StoryGroup } from './types';

export const THIN_BODY_CHARS = 1500;

/** Returns the page's plain text, or null when it can't be read. */
export type FetchBody = (url: string) => Promise<string | null>;

/** Live fetcher: Readability over the publisher page (Google News links resolved inside). */
export const fetchBodyLive: FetchBody = async (url) => (await extractArticleBody(url))?.text ?? null;

export async function enrichThinBodies(groups: StoryGroup[], fetchBody: FetchBody): Promise<StoryGroup[]> {
  return mapPool(groups, 6, async (group) => {
    if (group.body.length >= THIN_BODY_CHARS) return group;
    let text: string | null = null;
    try {
      text = await fetchBody(group.representative.sourceUrl);
    } catch {
      text = null;
    }
    return text && text.length > group.body.length ? { ...group, body: text } : group;
  });
}
