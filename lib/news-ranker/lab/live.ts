/**
 * Live wiring for the lab UI and CLI: one local store per process, live Jev
 * and Sonnet built only when a run is actually started.
 */
import { createJevAsk } from '@/lib/social/jev/client';
import { liveWriterCreate } from '@/lib/stories/writer';

import { DEFAULT_LAB_DIR, openLabDb, type LabDb } from './db';
import type { RunDeps } from './runner';

const g = globalThis as typeof globalThis & { __newsRankerLabDb?: Promise<LabDb> };

export function labDb(dataDir = process.env.NEWS_RANKER_LAB_DIR || DEFAULT_LAB_DIR): Promise<LabDb> {
  g.__newsRankerLabDb ??= openLabDb(dataDir).then((r) => r.db);
  return g.__newsRankerLabDb;
}

/** Live calls. Never used by tests. */
export function liveDeps(): RunDeps {
  return { jev: createJevAsk(), create: liveWriterCreate() };
}
