/**
 * Feed health (spec §5B rule 2): each feed's article count per run. A feed
 * returning 0 is flagged, so the shortlist never shrinks silently.
 *
 * The pulled fetcher returns [] both for a failed feed and an empty one,
 * so the two can't be told apart without editing it; both are flagged.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { FeedConfig } from '@/lib/social/feeds';
import { fetchAllFeeds } from '@/lib/social/ingest/fetch-feeds';
import { dayKey } from '@/lib/social/pipeline/set-aside-log';

import { inWindow } from './window';
import type { IngestArticle } from './types';

export type FeedHealthEntry = {
  day: string;
  slug: string;
  name: string;
  /** Articles the fetcher returned (it keeps the last 48h). */
  fetched: number;
  /** Of those, inside today's window. */
  inWindow: number;
  flagged: boolean;
};

export function buildFeedHealth(
  feeds: FeedConfig[],
  articles: IngestArticle[],
  now: Date,
  hours: number,
): FeedHealthEntry[] {
  const day = dayKey(now);
  return feeds.map((feed) => {
    const mine = articles.filter((a) => a.feedSlug === feed.slug);
    return {
      day,
      slug: feed.slug,
      name: feed.name,
      fetched: mine.length,
      inWindow: mine.filter((a) => inWindow(a, now, hours)).length,
      flagged: mine.length === 0,
    };
  });
}

/** Fetch every feed (live, free, no AI). Each article carries its feedSlug, so counts are per feed. */
export async function fetchFeeds(feeds: FeedConfig[]): Promise<IngestArticle[]> {
  return fetchAllFeeds(feeds);
}

export type FeedHealthLog = { append(entries: FeedHealthEntry[]): Promise<void> };

export function createFileFeedHealthLog(opts: { path?: string } = {}): FeedHealthLog {
  const filePath = opts.path ?? path.join(process.cwd(), 'Claude outputs', 'social-feed-health.jsonl');
  return {
    async append(entries) {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.appendFile(filePath, entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
    },
  };
}

export function createInMemoryFeedHealthLog(): FeedHealthLog & { entries: FeedHealthEntry[] } {
  const entries: FeedHealthEntry[] = [];
  return {
    entries,
    async append(batch) {
      entries.push(...batch);
    },
  };
}
