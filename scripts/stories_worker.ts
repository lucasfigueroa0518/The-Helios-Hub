/**
 * The Stories worker (plan §4, M8). Runs as the `helios-stories` systemd unit
 * on helios-social-worker (docs/social-overnight.md); locally `npm run
 * stories:worker` polls every 15 seconds and `--once` runs one pass. Mirrors
 * scripts/reels_worker.ts (SIGTERM finishes the pass).
 *
 *   npm run stories:worker
 *   npm run stories:run                        one pass
 *   npm run stories:run -- --request real_or_ai  ask for today's set (a Generate click from the terminal)
 *
 * STORIES_DB=local keeps the `stories` tables in PGlite at .stories-local/
 * (until the schema is applied to Supabase, S-61). reels.* and social.* are
 * always read from the shared database.
 *
 * Building a set makes live Claude, Jev and web calls: only for a set Lucas
 * requested (Generate, --request) or a series whose type makes posts (auto on:
 * Approval or Live, D16; rule 0.1). The refill (the 3:00 pool refresh, AI
 * Trivia's daily writer, Real or AI?'s daily candidates) runs in every state,
 * each held to its type's refill cap (stories.settings.types[<type>].refill_cap_usd).
 *
 * Photo bank (DECISIONS_LOG D49): nothing here offers photos to it any more. The old Stories finder that did is gone
 * (no series called it), so the worker no longer builds or drains a bank.
 */
import './stories_env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createIntakeJev } from '@/lib/intake/jev';
import { INTAKE_TOPUP_CAP_USD } from '@/lib/intake/types';
import { liveJevTransport } from '@/lib/reels/jev/client';
import { createJevAsk } from '@/lib/social/jev/client';
import type { NewsChainDeps } from '@/lib/stories/build/common';
import { liveStoriesDb, type StoriesDb } from '@/lib/stories/db';
import { DEFAULT_LOCAL_DIR, openLocalStoriesDb } from '@/lib/stories/local-db';
import { createLiveStoryInsightsClient } from '@/lib/stories/publish/insights';
import { createLiveStoriesMetaClient } from '@/lib/stories/publish/meta';
import { openRenderer, type Renderer } from '@/lib/stories/render/render';
import { createReviewCall } from '@/lib/stories/render/review';
import type { Series } from '@/lib/stories/render/types';
import { nyDate, releaseBuildsAtStartup, requestSet } from '@/lib/stories/repository';
import { loadSettings } from '@/lib/stories/settings';
import { createStoriesStorage } from '@/lib/stories/storage';
import { tick } from '@/lib/stories/worker';
import { liveWriterCreate } from '@/lib/stories/writer';

import { newAnthropic } from '@/lib/anthropic-client';
import { liveOpponentClient } from '@/lib/stories/trivia/opponent';

const POLL_MS = 15_000;

/** The news chain's live clients for one Morning Download build. */
async function newsChain(client: ReturnType<typeof newAnthropic>): Promise<NewsChainDeps> {
  const { TypeSafeClient } = await import('@typesafe-ai/sdk');
  const { fetchImageLive, readPageImages, serperImages } = await import('@/lib/news-photos');
  const { findPhotoUpscaler } = await import('@/lib/news-photos/band');
  const key = process.env.SERPER_API_KEY;
  return {
    create: (p) => client.messages.create(p as never) as never,
    jevAsk: createJevAsk(),
    photo: {
      jev: new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } }),
      readPage: readPageImages(),
      serper: key ? serperImages(key) : null,
      fetchImage: fetchImageLive(),
    },
    upscaler: findPhotoUpscaler(),
    tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'md-band-')),
    storage: createStoriesStorage(),
  };
}
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

  // Daemon only (not --once, which may run beside the VM's service): a build still `building` at boot died with the
  // previous process. Release it now instead of after the 12 h backstop (CI-33).
  if (!once) {
    const released = await releaseBuildsAtStartup(db).catch((err) => (log(`startup release failed: ${err instanceof Error ? err.message : String(err)}`), []));
    if (released.length) log(`startup released ${released.length} build(s): ${released.join(', ')}`);
  }

  let renderer: Renderer | null = null;
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));

  const deps = {
    db,
    sourceDb,
    builder: async (series?: Series) => {
      renderer ??= await openRenderer();
      const settings = await loadSettings(db);
      const client = newAnthropic();
      // No series uses the old Stories photo finder any more (Morning Download has the news chain's finder, AI Trivia
      // and Real or AI? draw no finder photo), so it and the shared-finder builders that wrapped it are not built.
      return {
        db,
        sourceDb,
        jevTransport: liveJevTransport,
        write: liveWriterCreate(),
        // AI Trivia's opponent (AT-74/75): GPT-5 nano (OPENAI_API_KEY), Llama 3.1 8B on fal (FAL_API_KEY) if it is retired.
        opponent: liveOpponentClient(),
        renderer,
        review: createReviewCall({ create: (p) => client.messages.create(p), model: settings.models.review }),
        storage: createStoriesStorage(),
        // Morning Download's news chain (WIRING-CONTRACT Owner D): Jev shortlist, Opus rerank, the news photo finder
        // (Serper only when its key is set), the band upscaler when installed, the W12 writer.
        ...(series === 'morning_download' ? { news: await newsChain(client) } : {}),
        // Morning Download video (MD-LFD D16–D19): on where yt-dlp, ffmpeg and the Serper and Jev keys are present.
        video: async (setId: string) => {
          const { liveStoryVideo, videoAvailable } = await import('@/lib/stories/video');
          const can = videoAvailable();
          if (!can.ok) { log(`video: off (${can.why})`); return null; }
          return liveStoryVideo({ setId, storage: createStoriesStorage(), anthropic: client as never, log: (line) => log(line) });
        },
      };
    },
    meta: () => createLiveStoriesMetaClient(),
    insights: () => createLiveStoryInsightsClient(),
    storage: () => createStoriesStorage(),
    // A series on the central intake: the pool refresh's posted check asks Jev in the intake's own cost bucket, held to
    // Morning Download's refill cap (D14) or the top-up cap, whichever is lower.
    intake: { jev: (capUsd?: number) => createIntakeJev(liveJevTransport, sourceDb, null, Math.min(INTAKE_TOPUP_CAP_USD, capUsd ?? INTAKE_TOPUP_CAP_USD)) },
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
