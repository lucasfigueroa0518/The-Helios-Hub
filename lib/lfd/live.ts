// lib/lfd/live.ts
/**
 * The engine's live dependencies (Claude, Jev, photos, feeds, render check,
 * Storage), wired one way for both the worker (scripts/social_worker.ts) and
 * the human CLI (scripts/lfd_run.ts). Spend is capped at `capUsd` (spec §9):
 * the run budget refuses a Claude call that would cross it, and Jev is capped
 * by the same figure. Network modules load only when this is called; tests
 * never call it (CLAUDE.md Rule 1).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import type { LfdRunDeps } from './run';

export async function liveLfdDeps(
  query: HubQuery,
  o: { capUsd: number; trigger: 'scheduled' | 'manual'; runId?: string; now?: Date },
): Promise<{ deps: LfdRunDeps; spentUsd: () => number }> {
  // A NaN or Infinity cap would silently switch off both the run budget and the Jev cap: refuse it before anything is built.
  if (!Number.isFinite(o.capUsd) || o.capUsd <= 0) throw new Error(`Last Few Days run cap must be a positive number (got ${String(o.capUsd)})`);
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { createLivePhotoFinder } = await import('@/lib/stories/photos');
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
  return {
    deps: {
      query,
      jev,
      create,
      photos: createLivePhotoFinder({ jev, create, runRef: `lfd:${o.runId ?? now.toISOString()}` }),
      fetchFeeds: () => fetchAllFeeds(HELIOS_SOCIAL_FEEDS),
      fetchBody: fetchBodyLive,
      readPage: (url) => readPage(url),
      fitCheck: checkRenderFit,
      upload: (p, b) => bucket.upload(p, b, 'image/jpeg'),
      now,
      trigger: o.trigger,
      capUsd: o.capUsd,
      spend: () => ({ claudeUsd: budget.claudeUsd(), jevUsd: tally.costUsd }),
      closings: closingsLog(query, 'lfd'),
      ...(o.runId ? { runId: o.runId } : {}),
    },
    spentUsd: () => budget.spent(),
  };
}
