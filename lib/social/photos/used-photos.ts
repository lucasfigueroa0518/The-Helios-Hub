/**
 * Used-photo log. The no-repeat rule is now CI-32's (lib/photos/used.ts): a
 * photo published by any post can't be used again for USED_PHOTO_DAYS (20)
 * days. The Postgres log reads that one ledger (published rows only); this
 * file's in-memory and file logs keep their own entries for tests and local runs.
 *
 * Every entry is tagged so reuse stays correct: its source, the verified
 * subject (Wikidata QID and SUBJECTS name) for subject photos, and its
 * credit. This log is the 7-day rule; it is not the photo bank. The photo bank
 * (photo spec §2; DECISIONS_LOG D49, lib/media-library/) keeps the vetted
 * images of every finder run, carousels and Stories, and imports these
 * entries past its watermark (photos published before capture was on). No
 * hand-seeding.
 *
 * A local JSON file until M9 moves it to the database. A photo counts as
 * used when its post reaches the review queue (today: the local preview);
 * the daily runner records it. The photo chain treats every URL used in
 * the last 7 days like one already used in this post.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { USED_PHOTO_DAYS, type UsedLedger } from '@/lib/photos/used';

/** The no-repeat window: CI-32's one rule for every content type. */
export const NO_REPEAT_DAYS = USED_PHOTO_DAYS;

export type UsedPhoto = {
  url: string;
  usedAt: string;
  storyId: string;
  slide: number;
  /** Bank tags (photo spec §2): reuse only for the same verified person or company; scenes by their request. */
  source?: string;
  qid?: string | null;
  subject?: string | null;
  credit?: string;
  scene?: string;
};

export type UsedPhotoLog = {
  /** URLs used within NO_REPEAT_DAYS before `now`. */
  recent(now: Date): Promise<Set<string>>;
  /** The used-photo ledger (URLs and hashes) as of `now`, for the hash check. Absent: URLs only. */
  ledger?(now: Date): Promise<UsedLedger>;
  /** When each URL was last used (for least-recently-used choices). */
  lastUsed(): Promise<Map<string, string>>;
  record(entries: UsedPhoto[]): Promise<void>;
};

const within = (e: UsedPhoto, now: Date) => {
  const t = new Date(e.usedAt).getTime();
  return Number.isFinite(t) && t <= now.getTime() && now.getTime() - t < NO_REPEAT_DAYS * 86_400_000;
};

function fromEntries(read: () => Promise<UsedPhoto[]>, write: (all: UsedPhoto[]) => Promise<void>): UsedPhotoLog {
  return {
    async recent(now) {
      return new Set((await read()).filter((e) => within(e, now)).map((e) => e.url));
    },
    async lastUsed() {
      const m = new Map<string, string>();
      for (const e of await read()) if (!m.has(e.url) || m.get(e.url)! < e.usedAt) m.set(e.url, e.usedAt);
      return m;
    },
    async record(entries) {
      await write([...(await read()), ...entries]);
    },
  };
}

export function createInMemoryUsedPhotoLog(initial: UsedPhoto[] = []): UsedPhotoLog {
  let all = [...initial];
  return fromEntries(async () => all, async (next) => { all = next; });
}

export function createFileUsedPhotoLog(file = path.join(process.cwd(), 'Claude outputs', 'social-used-photos.json')): UsedPhotoLog {
  return fromEntries(
    async () => {
      try {
        return JSON.parse(await fsp.readFile(file, 'utf8')) as UsedPhoto[];
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
    async (all) => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(all, null, 2));
      await fsp.rename(tmp, file);
    },
  );
}
