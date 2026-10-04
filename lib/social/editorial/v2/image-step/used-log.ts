/**
 * Used-images log — keeps a rolling record of every image URL / Q-id we
 * have shipped in a Helios Social carousel so the same image never
 * repeats within a post or across posts. Reject on collision at pick
 * time so we never render a repeat.
 *
 * Backed by a JSON file on disk (default: `Claude outputs/used-images.json`).
 * Cheap, no server calls, easy for a human to inspect. Not intended for
 * concurrent writers.
 *
 * 2026-10-01 image redesign (Tommy Part 1).
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export type UsedImageRecord = {
  /** Canonical download URL of the shipped file. Primary key. */
  url: string;
  /** Wikidata Q-id when the file came from Wikimedia; null for stock. */
  wikidataId?: string | null;
  /** Openverse source code / provider name when from stock. */
  source?: string;
  /** Human-readable creator / photographer. */
  creator?: string;
  /** Licence short-name ('CC BY 4.0', 'CC0', …). */
  license?: string;
  /** When we shipped it (ISO). */
  addedAt: string;
  /** The article / candidate we shipped it on, for humans reading the log. */
  articleId?: string;
  slug?: string;
};

export type UsedLog = {
  /** True if `url` has ever shipped OR is present in the transient (post-scoped) set. */
  hasBeenUsed(url: string): Promise<boolean>;
  /** Record a new usage in memory + on disk. */
  markUsed(rec: UsedImageRecord): Promise<void>;
  /**
   * Post-scoped set of URLs already picked earlier in the SAME post.
   * runImageStep pushes each pick into this before the next slide.
   * Cleared at the end of each pipeline run.
   */
  markUsedThisPost(url: string): void;
  isUsedThisPost(url: string): boolean;
  resetPost(): void;
};

/**
 * File-backed implementation. Reads the log lazily on first call.
 * Writes atomically (tmp file + rename) so a crash mid-write leaves
 * the previous state intact.
 */
export function createUsedLog(opts: { path?: string } = {}): UsedLog {
  const filePath = opts.path ?? path.join(process.cwd(), 'Claude outputs', 'used-images.json');
  const thisPost = new Set<string>();
  let loaded: Set<string> | null = null;

  async function ensureLoaded(): Promise<Set<string>> {
    if (loaded) return loaded;
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as UsedImageRecord[];
      loaded = new Set(parsed.map((r) => r.url));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') loaded = new Set();
      else throw err;
    }
    return loaded;
  }

  async function appendRecord(rec: UsedImageRecord): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    let existing: UsedImageRecord[] = [];
    try {
      existing = JSON.parse(await fsp.readFile(filePath, 'utf-8')) as UsedImageRecord[];
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
    }
    existing.push(rec);
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(existing, null, 2), 'utf-8');
    await fsp.rename(tmp, filePath);
  }

  return {
    async hasBeenUsed(url: string): Promise<boolean> {
      if (thisPost.has(url)) return true;
      const set = await ensureLoaded();
      return set.has(url);
    },
    async markUsed(rec: UsedImageRecord): Promise<void> {
      const set = await ensureLoaded();
      if (set.has(rec.url)) return; // idempotent
      set.add(rec.url);
      thisPost.add(rec.url);
      await appendRecord(rec);
    },
    markUsedThisPost(url: string): void {
      thisPost.add(url);
    },
    isUsedThisPost(url: string): boolean {
      return thisPost.has(url);
    },
    resetPost(): void {
      thisPost.clear();
    },
  };
}

/**
 * In-memory used-log for tests. Same interface, no disk I/O, separate
 * per-instance state so tests don't share.
 */
export function createInMemoryUsedLog(): UsedLog {
  const durable = new Set<string>();
  const thisPost = new Set<string>();
  return {
    async hasBeenUsed(url: string): Promise<boolean> {
      return durable.has(url) || thisPost.has(url);
    },
    async markUsed(rec: UsedImageRecord): Promise<void> {
      durable.add(rec.url);
      thisPost.add(rec.url);
    },
    markUsedThisPost(url: string): void {
      thisPost.add(url);
    },
    isUsedThisPost(url: string): boolean {
      return thisPost.has(url);
    },
    resetPost(): void {
      thisPost.clear();
    },
  };
}
