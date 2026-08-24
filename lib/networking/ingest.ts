import { fetchAllSources } from '@/lib/networking/adapters/registry';
import { importEventFromUrl } from '@/lib/networking/adapters/url-import';
import { classifyCandidate } from '@/lib/networking/keep-drop';
import { deduplicate, type DedupedEvent } from '@/lib/networking/dedupe';
import {
  expirePastEvents,
  finishIngestRun,
  latestIngestRun,
  startIngestRun,
  upsertKeptEvents,
  upsertRejects,
} from '@/lib/networking/repository';
import type {
  CandidateEvent,
  ClassifyResult,
  IngestSourceResult,
  RejectedEvent,
} from '@/lib/networking/types';

export function isoWeekKey(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

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

export async function runWeeklyIngest(now = new Date()): Promise<{
  weekKey: string;
  keptCount: number;
  rejectedCount: number;
  sourceResults: IngestSourceResult[];
}> {
  const weekKey = isoWeekKey(now);
  const runId = await startIngestRun(weekKey);
  const sourceResults: IngestSourceResult[] = [];
  try {
    const batches = await fetchAllSources();
    const allRejects: RejectedEvent[] = [];
    const allKept: ReturnType<typeof classifyMany>['keptEvents'] = [];

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
    await expirePastEvents(now);
    await finishIngestRun(runId, {
      status: 'done',
      sourceResults,
      keptCount,
      rejectedCount,
    });
    return { weekKey, keptCount, rejectedCount, sourceResults };
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
