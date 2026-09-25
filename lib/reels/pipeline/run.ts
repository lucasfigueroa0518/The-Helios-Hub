import { derivedAdapters, primaryAdapters } from '@/lib/reels/adapters';
import { MONTHLY_WATCH_USD } from '@/lib/reels/config';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { writeSlateCopy } from '@/lib/reels/pipeline/copy';
import { createLiveJevRunner } from '@/lib/reels/jev/client';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { groupRun } from '@/lib/reels/pipeline/grouping';
import { ingestAdapter, type IngestDeps } from '@/lib/reels/pipeline/ingest';
import { scoreRun } from '@/lib/reels/pipeline/scoring';
import {
  claimRequestedRun,
  extendLogRetention,
  finishRun,
  monthToDateUsd,
  recordSkippedRun,
  releaseStaleRuns,
  runCostUsd,
  runRetention,
  startRun,
  type RunRow,
} from '@/lib/reels/repository';
import type { Adapter, RunStats, RunStatus, RunTrigger, SourceResult } from '@/lib/reels/types';

export type RunOutcome = {
  runId: string | null;
  status: RunStatus;
  note?: string;
  sourceResults: SourceResult[];
  stats: Partial<RunStats>;
};

export type RunDeps = IngestDeps & {
  adapters?: { primary: Adapter[]; derived: Adapter[] };
  signal?: AbortSignal;
  copyClient?: CopyClient;
};

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), component: 'reels-run', message, ...fields }),
  );
}

/** Queue a run and execute it here. Used by the scheduler and `npm run reels:run`. */
export async function runReelsNight(
  trigger: RunTrigger,
  deps?: Partial<RunDeps>,
): Promise<RunOutcome> {
  await releaseStaleRuns();
  const run = await startRun(trigger);
  if (!run) {
    return {
      runId: null,
      status: 'skipped',
      note: 'A run is already in progress.',
      sourceResults: [],
      stats: {},
    };
  }
  return executeRun(run, deps);
}

/** Take whatever the page queued, if anything, and run it. */
export async function claimAndRun(deps?: Partial<RunDeps>): Promise<RunOutcome | null> {
  await releaseStaleRuns();
  const run = await claimRequestedRun();
  if (!run) return null;
  return executeRun(run, deps);
}

/**
 * One night: ingest, group, score, write copy for the selected three, clean up.
 *
 * The spend watch is checked before any adapter runs (FND-05 / D-023). A run
 * already under way is never aborted partway for budget: a half-ingested night
 * is worse than a slightly expensive one.
 */
export async function executeRun(run: RunRow, deps?: Partial<RunDeps>): Promise<RunOutcome> {
  const spent = await monthToDateUsd();
  if (spent >= MONTHLY_WATCH_USD) {
    const note = `Skipped: month-to-date spend is $${spent.toFixed(2)}, at or over the $${MONTHLY_WATCH_USD} watch. Raise the watch deliberately before running again.`;
    await recordSkippedRun(run.trigger, note, run.id);
    log('run_skipped_budget', { spent });
    return { runId: run.id, status: 'skipped', note, sourceResults: [], stats: {} };
  }

  const jev: JevRunner = deps?.jev ?? createLiveJevRunner();
  const ingestDeps: IngestDeps = { jev, fetchPage: deps?.fetchPage };
  const primary = deps?.adapters?.primary ?? primaryAdapters();
  const derived = deps?.adapters?.derived ?? derivedAdapters();

  const runStartedAt = new Date(run.started_at ?? run.requested_at);
  const now = new Date();
  const sourceResults: SourceResult[] = [];

  try {
    for (const adapter of [...primary, ...derived]) {
      const result = await ingestAdapter(adapter, ingestDeps, {
        runId: run.id,
        runStartedAt,
        now,
        signal: deps?.signal,
      });
      // The B6 gate is not a failure: the prompt simply is not approved yet.
      if (result.status === 'failed' && isNotApproved(result.error)) {
        result.status = 'skipped';
        result.error = 'Prompt P-01 is not approved yet.';
      }
      sourceResults.push(result);
      log('adapter_done', { adapter: adapter.id, ...result });
    }

    const grouping = await groupRun(run.id, runStartedAt, { jev });

    let scoringNote: string | undefined;
    let copyNote: string | undefined;
    let scored = 0;
    let selected = 0;
    let copyWritten = 0;
    try {
      const scoring = await scoreRun(run.id, runStartedAt, jev);
      scored = scoring.scored;
      selected = scoring.selected;
      log('run_scored', scoring);

      try {
        const copy = await writeSlateCopy(run.id, scoring.slateId, {
          client: deps?.copyClient,
          signal: deps?.signal,
        });
        copyWritten = copy.written;
        if (copy.failed > 0) {
          copyNote = `Copy failed for ${copy.failed} idea(s): ${copy.failures.join('; ')}`;
        }
        log('run_copy', copy);
      } catch (error) {
        copyNote = `Copy failed: ${error instanceof Error ? error.message : String(error)}`;
        log('copy_failed', { error: copyNote });
      }
    } catch (error) {
      scoringNote = `Scoring failed: ${error instanceof Error ? error.message : String(error)}`;
      log('scoring_failed', { error: scoringNote });
    }

    const retention = await runRetention();
    await extendLogRetention();
    log('run_phase_done', { ...grouping, ...retention });

    const stats: Partial<RunStats> = {
      ingested: sum(sourceResults, (result) => result.ingested),
      dropped: sum(sourceResults, (result) => result.dropped),
      refreshed: sum(sourceResults, (result) => result.refreshed),
      postIdeasCreated: grouping.created,
      postIdeasJoined: grouping.joined,
      merges: grouping.merges,
      links: grouping.links,
      ideaMerges: grouping.ideaMerges,
      scored,
      selected,
      copyWritten,
      jevCalls: jev.callCount,
      usd: await runCostUsd(run.id),
    };

    const failed = sourceResults.filter((result) => result.status === 'failed');
    const status: RunStatus =
      failed.length === 0 && !scoringNote && !copyNote ? 'ok' : 'partial';
    const note = [failed.length === 0
      ? undefined
      : `${failed.length} source(s) failed: ${failed.map((result) => result.name).join(', ')}.`,
      scoringNote,
      copyNote,
    ].filter(Boolean).join(' ') || undefined;

    await finishRun(run.id, status, sourceResults, stats, note);
    return { runId: run.id, status, note, sourceResults, stats };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await finishRun(run.id, 'failed', sourceResults, {}, note);
    log('run_failed', { error: note });
    return { runId: run.id, status: 'failed', note, sourceResults, stats: {} };
  }
}

function isNotApproved(error: string | undefined): boolean {
  return typeof error === 'string' && error.includes('REELS_B6_PROMPT_APPROVED');
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
