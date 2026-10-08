import { derivedAdapters, primaryAdapters } from '@/lib/reels/adapters';
import { MONTHLY_WATCH_USD, PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import type { CopyClient } from '@/lib/reels/copy/writer';
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
import { errorText } from '@/lib/reels/pipeline/guard';
import { loadSourceActivity, quietSources, quietSourcesNote } from '@/lib/reels/pipeline/source-health';
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
 * One night: ingest, group, score, write the day's two or three reels, clean up.
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
    const groupingNote = failureNote('Grouping failed for', grouping.failures);

    let scoringNote: string | undefined;
    let copyNote: string | undefined;
    let scored = 0;
    let selected = 0;
    let copyWritten = 0;
    try {
      const scoring = await scoreRun(run.id, runStartedAt, jev);
      scored = scoring.scored;
      selected = scoring.selected;
      scoringNote = failureNote('Scoring failed for', scoring.failures);
      log('run_scored', scoring);

      if (scoring.slateId) {
        try {
          const { generatePassingReels } = await import('@/lib/reels/pipeline/slots');
          const { scheduleSelectedSlate, windowsStillOpen } = await import('@/lib/reels/publish/schedule');
          const { reelsForOpenWindows } = await import('@/lib/reels/publish/slots');
          const count = reelsForOpenWindows(await windowsStillOpen(), PASSING_REELS_PER_NIGHT);
          if (count < 1) {
            copyNote = 'No posting window is still open today, so no reel was rendered. The ideas carry to tomorrow.';
          } else {
            const copy = await generatePassingReels({
              runId: run.id,
              slateId: scoring.slateId,
              count,
              client: deps?.copyClient,
              signal: deps?.signal,
              jev,
            });
            copyWritten = copy.filled.filter((slot) => !slot.locked).length;
            selected = copy.filled.length;
            const notes = [
              copy.status === 'partial' && copy.failures.length === 0
                ? `Filled ${copy.filled.length} of ${count} reels.`
                : undefined,
              copy.failures.length > 0
                ? `Copy failed for ${copy.failures.length} idea(s): ${copy.failures.join('; ')}`
                : undefined,
            ].filter((note): note is string => note != null);
            if (notes.length > 0) copyNote = notes.join(' ');
            log('run_copy', copy);
            const scheduled = await scheduleSelectedSlate(scoring.slateId).catch((error) => {
              log('schedule_failed', { error: errorText(error) });
              return { scheduled: 0 };
            });
            if (scheduled.scheduled > 0) log('run_scheduled', scheduled);
          }
        } catch (error) {
          copyNote = `Copy failed: ${errorText(error)}`;
          log('copy_failed', { error: copyNote });
        }
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
    const itemErrors = sourceResults.flatMap((result) => result.itemErrors ?? []);
    const itemNote = failureNote('Ingest failed for', itemErrors);
    // D-264. A watched source with nothing kept for days is called out.
    const watched = primary.filter((adapter) => adapter.quietAfterDays != null);
    const quietNote = await loadSourceActivity(watched.map((adapter) => adapter.id))
      .then((activity) => quietSourcesNote(quietSources(watched, activity, now)))
      .catch((error) => `Source health check failed: ${errorText(error)}`);
    const status: RunStatus =
      failed.length === 0 && !scoringNote && !copyNote && !groupingNote && !itemNote && !quietNote ? 'ok' : 'partial';
    const note = [failed.length === 0
      ? undefined
      : `${failed.length} source(s) failed: ${failed.map((result) => result.name).join(', ')}.`,
      itemNote,
      quietNote,
      groupingNote,
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

function failureNote(label: string, failures: string[]): string | undefined {
  if (failures.length === 0) return undefined;
  const shown = failures.slice(0, 5).join('; ');
  const more = failures.length > 5 ? ` (+${failures.length - 5} more)` : '';
  return `${label} ${failures.length} item(s): ${shown}${more}`;
}

function isNotApproved(error: string | undefined): boolean {
  return typeof error === 'string' && error.includes('REELS_B6_PROMPT_APPROVED');
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
