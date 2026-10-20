/**
 * The meme lab's live wiring: local PGlite, Last Few Days stories from
 * Supabase (read only), and the in-process runner a Generate click wakes.
 */
import { newAnthropic } from '@/lib/anthropic-client';
import { liveHubQuery } from '@/lib/social-hub/db';
import { createJevAsk } from '@/lib/social/jev/client';

import type { StorySource } from './api';
import { catalogHashes, DEFAULT_LOCAL_DIR, openLocalMemesDb, syncCatalog, type MemesDb } from './db';
import { listedFromDb, loadLabStory, loadLabStories, refreshAndList } from './lfd-source';
import { openMemeRenderer } from './render';
import { processNextRequest, type RunDeps } from './run';

type LabGlobals = { db?: Promise<MemesDb>; running?: Promise<void> | null };
const g = globalThis as unknown as { __memesLab?: LabGlobals };
const lab = (g.__memesLab ??= {});

export function labDb(): Promise<MemesDb> {
  lab.db ??= openLocalMemesDb(DEFAULT_LOCAL_DIR).then(async ({ db }) => {
    await db.query(`UPDATE memes.requests SET status = 'failed', finished_at = now(), stage = NULL, error = 'the server restarted mid-run' WHERE status = 'running'`);
    return db;
  });
  // Re-upsert the file catalog on every open so a card edit is in the lab
  // without waiting for the next Next restart (the process still caches PGlite).
  return lab.db.then(async (db) => {
    await syncCatalog(db, await catalogHashes());
    return db;
  });
}

/** Last Few Days posts and candidates. Briefs live in the lab DB. */
export const liveStorySource: StorySource = {
  async list() {
    const db = await labDb();
    try {
      return await refreshAndList(db, liveHubQuery);
    } catch (err) {
      console.error('[memes] LFD list failed, using local cache:', err);
      return listedFromDb(db);
    }
  },
  async load(id) {
    return loadLabStory(await labDb(), id);
  },
  async loadMany(ids) {
    return loadLabStories(await labDb(), ids);
  },
};

export function kickRunner(): void {
  if (lab.running) return;
  lab.running = (async () => {
    const db = await labDb();
    const client = newAnthropic();
    const renderer = await openMemeRenderer();
    const deps: RunDeps = {
      db,
      create: (p) => client.messages.create(p),
      jev: createJevAsk(),
      renderer,
      loadStory: (id) => loadLabStory(db, id),
      loadStories: (ids) => loadLabStories(db, ids),
      loadPool: async () => {
        const all = await listedFromDb(db);
        const withBrief = all.filter((s) => s.hasBrief);
        const stories = await loadLabStories(db, withBrief.map((s) => s.id));
        return stories;
      },
    };
    try {
      while (await processNextRequest(deps)) {
        /* next */
      }
    } finally {
      await renderer.close().catch(() => {});
    }
  })()
    .catch((err) => console.error('[memes] runner stopped:', err))
    .finally(() => {
      lab.running = null;
    });
}
