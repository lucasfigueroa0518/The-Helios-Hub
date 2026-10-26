/**
 * The engine's live dependencies (Jev, render check, Storage) and the live calendar snapshot,
 * wired one way for both the worker (scripts/social_worker.ts) and the human one-shot
 * (scripts/ai_events_once.ts). Jev is the reels transport; rankWeek wraps it with the run's cap
 * and networking's cost log (lib/networking/pick/jev.ts). No Claude client is built: this type
 * makes no Claude calls. Network modules load only when these are called; tests never call them
 * (CLAUDE.md Rule 1).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import type { SnapshotPublisher } from './publish';
import type { AiEventsEngineDeps } from './run';

export async function liveAiEventsDeps(query: HubQuery, o: { capUsd: number; now?: Date }): Promise<AiEventsEngineDeps> {
  // A NaN or Infinity cap would switch off the Jev cap: refuse it before anything is built.
  if (!Number.isFinite(o.capUsd) || o.capUsd <= 0) throw new Error(`AI Events run cap must be a positive number (got ${String(o.capUsd)})`);
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const bucket = mediaBucket(SLIDE_BUCKET);
  return {
    query,
    ask: liveJevTransport,
    fitCheck: checkRenderFit,
    upload: (p, b) => bucket.upload(p, b, 'image/jpeg'),
    now: o.now ?? new Date(),
  };
}

/** The public calendar snapshot over `query` (public-feeds/networking/events.v1.json, plus the deploy hook when due). */
export function liveAiEventsSnapshot(query: HubQuery): SnapshotPublisher {
  return async (reason) => {
    const { publishSnapshot } = await import('@/lib/networking/public-snapshot');
    return publishSnapshot({ q: query, reason });
  };
}
