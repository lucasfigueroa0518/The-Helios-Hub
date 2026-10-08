/**
 * The Stories worker (plan §4, M8). In isolation it runs on Lucas's Mac
 * (S-30, S-35): `npm run stories:worker` polls every 15 seconds; `--once`
 * runs one pass. Mirrors scripts/reels_worker.ts (SIGTERM finishes the pass).
 *
 *   npm run stories:worker
 *   npm run stories:run                        one pass
 *   npm run stories:run -- --request free_vs_paid    ask for today's set (a Generate click from the terminal)
 *
 * STORIES_DB=local keeps the `stories` tables in PGlite at .stories-local/
 * (until the schema is applied to Supabase, S-61). reels.* and social.* are
 * always read from the shared database.
 *
 * Building a set makes live Claude, Jev and web calls: only for a set Lucas
 * requested (Generate, --request) or a series he switched to auto (rule 0.1).
 */
import './stories_env';
import { liveJevTransport } from '@/lib/reels/jev/client';
import { liveStoriesDb, type StoriesDb } from '@/lib/stories/db';
import { DEFAULT_LOCAL_DIR, openLocalStoriesDb } from '@/lib/stories/local-db';
import { createLivePhotoFinder } from '@/lib/stories/photos';
import { createLiveStoryInsightsClient } from '@/lib/stories/publish/insights';
import { createLiveStoriesMetaClient } from '@/lib/stories/publish/meta';
import { openRenderer, type Renderer } from '@/lib/stories/render/render';
import { createReviewCall } from '@/lib/stories/render/review';
import type { Series } from '@/lib/stories/render/types';
import { nyDate, requestSet } from '@/lib/stories/repository';
import { loadSettings } from '@/lib/stories/settings';
import { createStoriesStorage } from '@/lib/stories/storage';
import { tick } from '@/lib/stories/worker';
import { liveWriterCreate } from '@/lib/stories/writer';
import { newAnthropic } from '@/lib/anthropic-client';

const POLL_MS = 15_000;
const once = process.argv.includes('--once');
const requestArg = process.argv.indexOf('--request');

async function main() {
  const db: StoriesDb = process.env.STORIES_DB === 'local' ? (await openLocalStoriesDb(DEFAULT_LOCAL_DIR)).db : liveStoriesDb;
  const sourceDb = liveStoriesDb;
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

  if (requestArg > 0) {
    const series = process.argv[requestArg + 1] as Series;
    const settings = await loadSettings(db);
    if (!settings.series[series]) throw new Error(`unknown series: ${series}`);
    const { set, created } = await requestSet(db, { series, nyDate: nyDate(), trigger: 'click', style: settings.series[series].style, requestedBy: 'terminal' });
    log(`${created ? 'requested' : 'already have'} ${series} ${set.ny_date} (${set.status})`);
  }

  let renderer: Renderer | null = null;
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));

  const deps = {
    db,
    sourceDb,
    builder: async () => {
      renderer ??= await openRenderer();
      const settings = await loadSettings(db);
      const client = newAnthropic();
      return {
        db,
        sourceDb,
        jevTransport: liveJevTransport,
        write: liveWriterCreate(),
        photos: createLivePhotoFinder({ create: (p) => client.messages.create(p) }),
        renderer,
        review: createReviewCall({ create: (p) => client.messages.create(p), model: settings.models.review }),
        storage: createStoriesStorage(),
      };
    },
    meta: () => createLiveStoriesMetaClient(),
    insights: () => createLiveStoryInsightsClient(),
    storage: () => createStoriesStorage(),
    log,
  };

  try {
    do {
      try {
        const r = await tick(deps);
        if (r.built || r.scheduled || r.published || r.insights) log(`pass: ${JSON.stringify(r)}`);
      } catch (err) {
        log(`pass failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      }
      if (once || stopping) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    } while (!stopping);
  } finally {
    await (renderer as Renderer | null)?.close();
  }
}

void main().then(() => process.exit(0));
