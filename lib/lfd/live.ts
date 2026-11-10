// lib/lfd/live.ts
/**
 * The engine's live dependencies (Claude, Jev, photos, feeds, render check,
 * Storage), wired one way for both the worker (scripts/social_worker.ts) and
 * the human CLI (scripts/lfd_run.ts). Spend is capped at `capUsd` (spec §9):
 * the run budget refuses a Claude call that would cross it, and Jev is capped
 * by the same figure. Network modules load only when this is called; tests
 * never call it (CLAUDE.md Rule 1).
 *
 * The photo bank (DECISIONS_LOG D49), as carousels and Stories have it: a
 * finder source while media_library's finder_source switch is on, and the
 * photos the run picks plus identity-verified candidates offered (runKind
 * 'story', runRef `lfd:<run id>`) while capture is on. It fails open: no
 * database, a bank that can't be reached or built, or the switches off, and
 * the finder works exactly as without it.
 *
 * The shared photo finder (central intake Phase 3): the `photo_finders` switch is read once per run, here. 'shared'
 * adds `sharedPhotos` (every slide tries it first); 'legacy', a read error, or deps that can't be built leave it
 * out, and the run is today's.
 */
import type { createPhotoBank, PhotoBank } from '@/lib/media-library/bank';
import type { HubQuery } from '@/lib/social-hub/db';
import type { createLivePhotoFinder, PhotoFinder } from '@/lib/stories/photos';

import type { LfdRunDeps } from './run';

type FinderOpts = Pick<NonNullable<Parameters<typeof createLivePhotoFinder>[0]>, 'jev' | 'create'> & { runRef: string };

/** The run's photo finder with the photo bank on both sides; built without the bank if the bank can't be built. `make` is for tests. */
export async function lfdPhotoFinder(
  query: HubQuery,
  o: FinderOpts & { log?: (line: string) => void },
  make?: { createPhotoBank: typeof createPhotoBank; createLivePhotoFinder: typeof createLivePhotoFinder },
): Promise<{ photos: PhotoFinder; bank: PhotoBank | undefined }> {
  const newBank = make?.createPhotoBank ?? (await import('@/lib/media-library/bank')).createPhotoBank;
  const newFinder = make?.createLivePhotoFinder ?? (await import('@/lib/stories/photos')).createLivePhotoFinder;
  const log = o.log ?? ((line: string) => console.log(`photo bank: ${line}`));
  let bank: PhotoBank | undefined;
  try {
    bank = newBank({ query: (text, params) => query(text, params), log });
  } catch (err) {
    log(`not built: ${err instanceof Error ? err.message : String(err)}`);
  }
  // CI-32: the finder checks each pick's picture against the used-photo ledger (read once per run).
  const { ledgerFrom } = await import('@/lib/photos/used-guard');
  return { photos: newFinder({ jev: o.jev, create: o.create, runRef: o.runRef, used: ledgerFrom((text, params) => query(text, params)), ...(bank ? { bank } : {}) }), bank };
}

/** The run's shared-finder wiring when the 'lfd' switch reads 'shared' (read once); undefined otherwise. Never throws. `make` is for tests. */
export async function lfdSharedPhotos(
  query: HubQuery,
  make?: import('@/lib/stories/photos-shared').SharedMake,
  log: (line: string) => void = (line) => console.log(`lfd: ${line}`),
): Promise<LfdRunDeps['sharedPhotos']> {
  try {
    const { sharedPhotoSetup } = await import('@/lib/stories/photos-shared');
    const setup = await sharedPhotoSetup({ query: (text, params) => query(text, params) }, 'lfd', make, log);
    return setup ?? undefined;
  } catch (err) {
    log(`shared photo finder not wired (${err instanceof Error ? err.message : String(err)}); today's finder`);
    return undefined;
  }
}

export async function liveLfdDeps(
  query: HubQuery,
  o: { capUsd: number; trigger: 'scheduled' | 'manual'; runId?: string; now?: Date },
): Promise<{ deps: LfdRunDeps; spentUsd: () => number; drainBank: (ms: number) => Promise<void> }> {
  // A NaN or Infinity cap would silently switch off both the run budget and the Jev cap: refuse it before anything is built.
  if (!Number.isFinite(o.capUsd) || o.capUsd <= 0) throw new Error(`Last Few Days run cap must be a positive number (got ${String(o.capUsd)})`);
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { fetchAllFeeds } = await import('@/lib/social/ingest/fetch-feeds');
  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { closingsLog } = await import('@/lib/social/captions/closings-store');

  const now = o.now ?? new Date();
  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, o.capUsd);
  const budget = createRunBudget({ capUsd: o.capUsd, otherSpendUsd: () => tally.costUsd });
  const create = budget.guard(liveMessagesCreate(newAnthropic()));
  const bucket = mediaBucket(SLIDE_BUCKET);
  const { photos, bank } = await lfdPhotoFinder(query, { jev, create, runRef: `lfd:${o.runId ?? now.toISOString()}` });
  const { readLfdSettings } = await import('./settings');
  const settings = await readLfdSettings(query).catch(() => null);
  let memes: import('./run').LfdRunDeps['memes'];
  if (settings?.memes !== false) {
    const { clearsStoryGate, makeStoryMeme } = await import('@/lib/memes/lfd-engine');
    const { openMemeRenderer } = await import('@/lib/memes/render');
    const memeCap = settings?.memesCapUsd ?? 1;
    const memeTally = createJevTally();
    const memeJev = capped(tallied(createJevAsk(), memeTally), memeTally, memeCap);
    const memeCreate = liveMessagesCreate(newAnthropic());
    let memeClaude = 0;
    memes = {
      capUsd: memeCap,
      clears: (story, opts) => clearsStoryGate(memeJev, story, opts),
      make: async (story) => {
        if (memeClaude >= memeCap) return null;
        const out = await makeStoryMeme({ create: memeCreate, jev: memeJev, openRenderer: openMemeRenderer, query, now: () => now }, story);
        if (out) memeClaude += out.costUsd;
        return out;
      },
    };
  }
  // Central intake (Phase 1): the consumer switch decides per run; the intake Jev (its own cost bucket, top-up cap)
  // serves the carousel lane's posted check and seed scoring. Built lazily; a failure here means today's lanes.
  let intake: LfdRunDeps['intake'];
  try {
    const { liveIntakeJev } = await import('@/lib/intake/jev');
    const { INTAKE_TOPUP_CAP_USD } = await import('@/lib/intake/types');
    intake = { jev: await liveIntakeJev({ query: (text, params) => query(text, params) }, null, INTAKE_TOPUP_CAP_USD) };
  } catch (err) {
    console.log(`lfd: intake not wired (${err instanceof Error ? err.message : String(err)}); today's lanes`);
  }
  const sharedPhotos = await lfdSharedPhotos(query);
  // Builder slides' photos (Phase 1 photo slice): AI Drama's harvest engine, capped at $0.15 a post inside the run.
  const { streamingCreate } = await import('@/lib/reel-ai-drama/reporting/llm');
  const { loadPrompt } = await import('@/lib/reel-ai-drama/prompts');
  const { liveHarvestPhotoBank } = await import('@/lib/reel-ai-drama/harvest/photo-bank-live');
  const harvest: import('./photos').BuilderHarvest = {
    deps: {
      http: fetch,
      create: streamingCreate(newAnthropic()),
      loadPrompt: (name) => loadPrompt(name),
      serperKey: process.env.SERPER_API_KEY ?? null,
      photoBank: liveHarvestPhotoBank(process.env).bank,
      cutouts: [],
    },
  };
  return {
    deps: {
      query,
      jev,
      create,
      photos,
      harvest,
      // CI-32: a lead image is downloaded and hashed to check it against the used-photo ledger's pictures.
      usedPhotos: { http: fetch },
      ...(sharedPhotos ? { sharedPhotos } : {}),
      ...(intake ? { intake } : {}),
      fetchFeeds: () => fetchAllFeeds(HELIOS_SOCIAL_FEEDS),
      fetchBody: fetchBodyLive,
      readPage: (url) => readPage(url),
      fitCheck: checkRenderFit,
      upload: (p, b, t) => bucket.upload(p, b, t ?? 'image/jpeg'),
      now,
      trigger: o.trigger,
      capUsd: o.capUsd,
      spend: () => ({ claudeUsd: budget.claudeUsd(), jevUsd: tally.costUsd }),
      closings: closingsLog(query, 'lfd'),
      ...(o.runId ? { runId: o.runId } : {}),
      ...(memes ? { memes } : {}),
    },
    spentUsd: () => budget.spent(),
    // Waits (at most `ms`) for the bank's queued writes and ingest; a one-shot CLI run calls it before exiting.
    drainBank: async (ms) => {
      await bank?.drain(ms).catch(() => undefined);
    },
  };
}
