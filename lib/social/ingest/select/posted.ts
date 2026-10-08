/**
 * Recently posted stories, for Jev's "already posted?" question (spec §5A #2).
 * Local JSON file until M7/M8 write real posts; no DB.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const POSTED_LOOKBACK_DAYS = 14;

export type PostedRecord = { headline: string; postedAt: string };

export type PostedStories = {
  recentHeadlines(now: Date): Promise<string[]>;
};

function recent(records: PostedRecord[], now: Date): string[] {
  const cutoff = now.getTime() - POSTED_LOOKBACK_DAYS * 86_400_000;
  return records
    .filter((r) => {
      const t = new Date(r.postedAt).getTime();
      return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
    })
    .map((r) => r.headline);
}

export function createInMemoryPosted(records: PostedRecord[] = []): PostedStories {
  return { recentHeadlines: async (now) => recent(records, now) };
}

export function createFilePosted(opts: { path?: string } = {}): PostedStories {
  const filePath = opts.path ?? path.join(process.cwd(), 'Claude outputs', 'social-posted.json');
  return {
    async recentHeadlines(now) {
      let text: string;
      try {
        text = await fsp.readFile(filePath, 'utf8');
      } catch {
        return [];
      }
      return recent(JSON.parse(text) as PostedRecord[], now);
    },
  };
}
