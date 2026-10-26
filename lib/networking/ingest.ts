import { fetchAllSources } from '@/lib/networking/adapters/registry';
import { importEventFromUrl } from '@/lib/networking/adapters/url-import';
import { classifyCandidate } from '@/lib/networking/keep-drop';
import { deduplicate, type DedupedEvent } from '@/lib/networking/dedupe';
import { isoWeekKey } from '@/lib/networking/schedule';
import {
  expirePastEvents,
  finishIngestRun,
  latestIngestRun,
  startIngestRun,
  upsertAnchors,
  upsertKeptEvents,
  upsertRejects,
} from '@/lib/networking/repository';
import type {
  CandidateEvent,
  ClassifyResult,
  EventAnchor,
  IngestSourceResult,
  RejectedEvent,
} from '@/lib/networking/types';

export { isoWeekKey };

function classifyMany(candidates: CandidateEvent[], now?: Date) {
  const kept: ClassifyResult[] = [];
  const rejects: RejectedEvent[] = [];
  for (const candidate of candidates) {
    const result = classifyCandidate(candidate, { now });
    if (result.keep) kept.push(result);
    else rejects.push(result.reject);
  }
  return {
    keptEvents: kept.filter((r): r is Extract<ClassifyResult, { keep: true }> => r.keep).map((r) => r.event),
    rejects,
  };
}

export type WeeklyIngestResult = {
  runId: string;
  weekKey: string;
  keptCount: number;
  rejectedCount: number;
  anchorCount: number;
  anchorError?: string;
  sourceResults: IngestSourceResult[];
};

export async function runWeeklyIngest(now = new Date()): Promise<WeeklyIngestResult> {
  const weekKey = isoWeekKey(now);
  const runId = await startIngestRun(weekKey);
  const sourceResults: IngestSourceResult[] = [];
  try {
    const batches = await fetchAllSources();
    const allRejects: RejectedEvent[] = [];
    const allKept: ReturnType<typeof classifyMany>['keptEvents'] = [];
    const anchors: EventAnchor[] = batches.flatMap((batch) => batch.anchors ?? []);

    for (const batch of batches) {
      const classified = classifyMany(batch.events, now);
      allKept.push(...classified.keptEvents);
      allRejects.push(...classified.rejects);
      sourceResults.push({
        source: batch.source,
        fetched: batch.events.length,
        kept: classified.keptEvents.length,
        rejected: classified.rejects.length,
        error: batch.error,
      });
    }

    const unique: DedupedEvent[] = deduplicate(allKept);
    const keptCount = await upsertKeptEvents(unique);
    const rejectedCount = await upsertRejects(runId, allRejects);
    // Anchors only feed the ranking's satellite term; a failure there never fails the ingest.
    let anchorCount = 0;
    let anchorError: string | undefined;
    try {
      anchorCount = await upsertAnchors(anchors);
    } catch (error) {
      anchorError = error instanceof Error ? error.message : String(error);
    }
    await expirePastEvents(now);
    await finishIngestRun(runId, {
      status: 'done',
      sourceResults,
      keptCount,
      rejectedCount,
    });
    return { runId, weekKey, keptCount, rejectedCount, anchorCount, anchorError, sourceResults };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishIngestRun(runId, {
      status: 'failed',
      sourceResults,
      keptCount: 0,
      rejectedCount: 0,
      error: message,
    });
    throw error;
  }
}

export async function importUrl(url: string, options: { force?: boolean } = {}) {
  const candidate = await importEventFromUrl(url);
  candidate.trusted = true;
  const result = classifyCandidate(candidate, { force: options.force ?? true });
  if (!result.keep) {
    return { ok: false as const, reasons: result.reject.reasonCodes, candidate };
  }
  const unique = deduplicate([result.event]);
  await upsertKeptEvents(unique);
  return { ok: true as const, event: unique[0] };
}

export { latestIngestRun };
