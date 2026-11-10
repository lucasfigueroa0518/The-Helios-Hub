import { derivedAdapters, primaryAdapters } from '@/lib/reels/adapters';
import { MONTHLY_WATCH_USD } from '@/lib/reels/config';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { createLiveJevRunner } from '@/lib/reels/jev/client';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { groupRun } from '@/lib/reels/pipeline/grouping';
import { fetchDerivedForIntake, ingestAdapter, type IngestDeps } from '@/lib/reels/pipeline/ingest';
import {
  intakeRunDeps,
  intakeScoreSource,
  intakeTimelyFrom,
  isTonightsMain,
  listReelsStories,
  registerIntakeIdeas,
  tonightSources,
  type IntakeRunDeps,
} from '@/lib/reels/pipeline/intake';
import { planCandidates, scoreRun, type CandidatePlan } from '@/lib/reels/pipeline/scoring';
import {
  claimRequestedRun,
  clearIntakeTonight,
  extendLogRetention,
  finishRun,
  monthToDateUsd,
  recordSkippedRun,
  releaseStaleRuns,
  runCostUsd,
  runRetention,
  setIntakeTonight,
  startRun,
  type RunRow,
} from '@/lib/reels/repository';
import { errorText } from '@/lib/reels/pipeline/guard';
import { loadSourceActivity, quietSources, quietSourcesNote } from '@/lib/reels/pipeline/source-health';
import type { Adapter, AdapterItem, RunStats, RunStatus, RunTrigger, SourceResult } from '@/lib/reels/types';

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
  /** Central intake (Phase 2): the 'reels' switch, the intake reads and the deposit run. Live by default. */
  intake?: Partial<IntakeRunDeps>;
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
 * The reels people placed for today count toward the night's three (daily
 * fill, D54); a carryover idea's finished, unposted video is reused (D55).
 *
 * The spend watch is checked before any adapter runs (FND-05 / D-023). A run
 * already under way is never aborted partway for budget: a half-ingested night
 * is worse than a slightly expensive one.
 *
 * Central intake (Phase 2): when `intake.settings.consumers.reels` is 'intake'
 * and the intake is fresh, the night reads the intake instead of fetching
 * (executeIntakeNight). 'legacy' and 'stale-fallback' run today's path.
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
  const night: Night = { run, deps, jev, ingestDeps, primary, derived, runStartedAt, now };

  const intake = intakeRunDeps(deps?.intake);
  const mode = await intake.readMode(intake.query, 'reels', now).catch(() => 'legacy' as const);
  if (mode === 'intake') {
    const outcome = await executeIntakeNight(night, intake);
    if ('notTonight' in outcome) {
      // The switch is on and yesterday's main run keeps the intake "fresh", but tonight's main run failed or is still
      // running: nearly nothing would be timely, so this night is a stale night (nothing fetched for it yet).
      log('intake_stale_fallback', { reason: 'no successful main run tonight', lastMainStart: outcome.notTonight });
      return executeLegacyNight(night, {
        note: `Tonight's main intake run has not succeeded (newest successful main run: ${outcome.notTonight ?? 'none'}); this night ran the legacy path.`,
        keepIntakeIdeas: true,
      });
    }
    if ('fallback' in outcome) {
      log('intake_fallback', { reason: outcome.fallback });
      return executeLegacyNight(
        { ...night, derived: outcome.replay },
        { note: `Intake read failed (${outcome.fallback}); this night ran the legacy path.`, keepIntakeIdeas: true },
      );
    }
    return outcome;
  }
  if (mode === 'stale-fallback') {
    log('intake_stale_fallback');
    return executeLegacyNight(night, {
      note: 'The intake is stale; this night ran the legacy path.',
      keepIntakeIdeas: true,
    });
  }
  return executeLegacyNight(night);
}

type Night = {
  run: RunRow;
  deps?: Partial<RunDeps>;
  jev: JevRunner;
  ingestDeps: IngestDeps;
  primary: Adapter[];
  derived: Adapter[];
  runStartedAt: Date;
  now: Date;
};

/** Today's night, unchanged. `fallback` is set only when the intake switch is on but this night cannot use it. */
async function executeLegacyNight(
  night: Night,
  fallback?: { note: string; keepIntakeIdeas: boolean },
): Promise<RunOutcome> {
  const { run, deps, jev, ingestDeps, primary, derived, runStartedAt, now } = night;
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

    const slate = await scoreAndMake(night);

    const retention = fallback?.keepIntakeIdeas
      ? await runRetention(undefined, { keepIntakeIdeas: true })
      : await runRetention();
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
      scored: slate.scored,
      selected: slate.selected,
      copyWritten: slate.copyWritten,
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
      failed.length === 0 && !slate.scoringNote && !slate.copyNote && !groupingNote && !itemNote && !quietNote ? 'ok' : 'partial';
    const note = [fallback?.note, failed.length === 0
      ? undefined
      : `${failed.length} source(s) failed: ${failed.map((result) => result.name).join(', ')}.`,
      itemNote,
      quietNote,
      groupingNote,
      slate.scoringNote,
      slate.copyNote,
      slate.fillNote,
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

type SlateOutcome = {
  scored: number;
  selected: number;
  copyWritten: number;
  scoringNote?: string;
  copyNote?: string;
  /** Daily fill (D54): why the night made nothing, when people already placed the day's reels. Not a failure. */
  fillNote?: string;
};

/** Score the slate, then fill, copy and schedule (everything after the slate is the same on both paths). */
async function scoreAndMake(night: Night, plan?: CandidatePlan): Promise<SlateOutcome> {
  const { run, deps, jev, runStartedAt } = night;
  const out: SlateOutcome = { scored: 0, selected: 0, copyWritten: 0 };
  try {
    const scoring = await scoreRun(run.id, runStartedAt, jev, undefined, plan);
    out.scored = scoring.scored;
    out.selected = scoring.selected;
    out.scoringNote = failureNote('Scoring failed for', scoring.failures);
    log('run_scored', scoring);

    if (scoring.slateId) {
      try {
        const { generatePassingReels } = await import('@/lib/reels/pipeline/slots');
        const { scheduleSelectedSlate, windowsStillOpen } = await import('@/lib/reels/publish/schedule');
        const { reelsFill, reelsTonight } = await import('@/lib/reels/pipeline/fill');
        const { quotaFilledNote, reportFill } = await import('@/lib/social-hub/fill');
        // Daily fill (D54): reels people placed for today count toward the night's quota.
        const fill = await reelsFill();
        const openWindows = await windowsStillOpen();
        const count = reelsTonight(openWindows, fill);
        reportFill(fill, log, { runId: run.id, openWindows, count });
        if (count < 1 && fill.making < 1) {
          // Not a failure: people filled the day. The ideas carry to tomorrow as on a day with no window left.
          out.fillNote = `${quotaFilledNote(fill, 'reel')} No reel was written or rendered; the ideas carry to tomorrow.`;
        } else if (count < 1) {
          out.copyNote = 'No posting window is still open today, so no reel was rendered. The ideas carry to tomorrow.';
        } else {
          const copy = await generatePassingReels({
            runId: run.id,
            slateId: scoring.slateId,
            count,
            client: deps?.copyClient,
            signal: deps?.signal,
            jev,
            dailyFill: true,
          });
          out.copyWritten = copy.filled.filter((slot) => !slot.locked && !slot.reused).length;
          out.selected = copy.filled.length;
          const notes = [
            copy.status === 'partial' && copy.failures.length === 0
              ? `Filled ${copy.filled.length} of ${count} reels.`
              : undefined,
            copy.failures.length > 0
              ? `Copy failed for ${copy.failures.length} idea(s): ${copy.failures.join('; ')}`
              : undefined,
          ].filter((note): note is string => note != null);
          if (notes.length > 0) out.copyNote = notes.join(' ');
          log('run_copy', copy);
          const scheduled = await scheduleSelectedSlate(scoring.slateId).catch((error) => {
            log('schedule_failed', { error: errorText(error) });
            return { scheduled: 0 };
          });
          if (scheduled.scheduled > 0) log('run_scheduled', scheduled);
        }
      } catch (error) {
        out.copyNote = `Copy failed: ${errorText(error)}`;
        log('copy_failed', { error: out.copyNote });
      }
    }
  } catch (error) {
    out.scoringNote = `Scoring failed: ${error instanceof Error ? error.message : String(error)}`;
    log('scoring_failed', { error: out.scoringNote });
  }
  return out;
}

/** A derived adapter whose finds were already fetched (and deposited) tonight: the legacy fallback ingests them without a second fetch. */
function replayAdapter(adapter: Adapter, fetched: { items: AdapterItem[] | null; error?: string }): Adapter {
  return {
    ...adapter,
    async fetchItems() {
      if (fetched.items === null) throw new Error(fetched.error ?? 'fetch failed earlier tonight');
      return fetched.items;
    },
  };
}

/**
 * Intake mode (PHASE2-CONTRACT.md, Owner B): (1) the budget gate already ran; (2) derived adapters deposit into the
 * intake, no primary fetch and no `reels.sources` rows; (3) one deposit run groups and scores those finds; (4) the
 * order's stories are registered as ideas (id = story id) with tonight's timely flags; (5) the slate takes stored
 * scores (a legacy carryover is scored the legacy way); (6) fill, copy, schedule, retention and finish as today.
 * A failed intake read before any write returns `fallback`, with the derived finds kept for the legacy path.
 */
async function executeIntakeNight(
  night: Night,
  intake: IntakeRunDeps,
): Promise<RunOutcome | { fallback: string; replay: Adapter[] } | { notTonight: string | null }> {
  const { run, deps, jev, ingestDeps, derived, runStartedAt, now } = night;
  const q = intake.query;
  const sourceResults: SourceResult[] = [];
  const fetched = new Map<string, { items: AdapterItem[] | null; error?: string }>();
  const replay = () => derived.map((adapter) => replayAdapter(adapter, fetched.get(adapter.id) ?? { items: [] }));

  // Read first, before any spend: a broken intake read sends the night to the legacy path untouched.
  let timelyFrom: Date;
  try {
    const mainStart = await intake.lastMainStart(q);
    if (!isTonightsMain(runStartedAt, mainStart)) return { notTonight: mainStart?.toISOString() ?? null };
    timelyFrom = intakeTimelyFrom(runStartedAt, mainStart);
    setIntakeTonight(run.id, tonightSources(await listReelsStories(intake, now), timelyFrom));
  } catch (error) {
    return { fallback: errorText(error), replay: derived };
  }

  try {
    try {
      for (const adapter of derived) {
        const { result, items } = await fetchDerivedForIntake(adapter, ingestDeps, {
          runId: run.id,
          runStartedAt,
          now,
          signal: deps?.signal,
        });
        fetched.set(adapter.id, { items, error: result.error });
        if (result.status === 'failed' && isNotApproved(result.error)) {
          result.status = 'skipped';
          result.error = 'Prompt P-01 is not approved yet.';
        }
        sourceResults.push(result);
        log('adapter_done', { adapter: adapter.id, intake: true, ...result });
      }
    } finally {
      clearIntakeTonight(run.id);
    }

    // Never fails the night: the deposit run is the intake's, and a miss only leaves tonight's finds for its next run.
    const deposit = await intake.runIntakeDeposit(q).catch((error) => ({ error: errorText(error) }));
    log('intake_deposit_done', { deposit });

    // Every intake read the slate needs happens here, before scoring: an error takes the legacy path (the derived
    // finds replayed, so B6 is not paid twice) instead of a night with no slate.
    let registered: Awaited<ReturnType<typeof registerIntakeIdeas>>;
    let plan: CandidatePlan;
    try {
      const stories = await listReelsStories(intake, now);
      registered = await registerIntakeIdeas(q, stories, timelyFrom);
      log('intake_registered', { ...registered, timelyFrom: timelyFrom.toISOString() });
      plan = await planCandidates(runStartedAt, intakeScoreSource(intake));
    } catch (error) {
      return { fallback: errorText(error), replay: replay() };
    }
    if (plan.twinsDropped.length) log('intake_switch_twins_dropped', { ids: plan.twinsDropped });

    const slate = await scoreAndMake(night, plan);

    const retention = await runRetention(undefined, { keepIntakeIdeas: true });
    await extendLogRetention();
    log('run_phase_done', { intake: true, ...registered, ...retention });

    const stats: Partial<RunStats> = {
      ingested: sum(sourceResults, (result) => result.ingested),
      dropped: sum(sourceResults, (result) => result.dropped),
      refreshed: 0,
      postIdeasCreated: registered.created,
      postIdeasJoined: 0,
      merges: 0,
      links: 0,
      ideaMerges: 0,
      scored: slate.scored,
      selected: slate.selected,
      copyWritten: slate.copyWritten,
      jevCalls: jev.callCount,
      usd: await runCostUsd(run.id),
    };

    const failed = sourceResults.filter((result) => result.status === 'failed');
    // Source health for the primary adapters is the intake's now (Reels no longer fetches them).
    const status: RunStatus = failed.length === 0 && !slate.scoringNote && !slate.copyNote ? 'ok' : 'partial';
    const note = [
      failed.length === 0
        ? undefined
        : `${failed.length} source(s) failed: ${failed.map((result) => result.name).join(', ')}.`,
      slate.scoringNote,
      slate.copyNote,
      slate.fillNote,
    ].filter(Boolean).join(' ') || undefined;

    await finishRun(run.id, status, sourceResults, stats, note);
    return { runId: run.id, status, note, sourceResults, stats };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await finishRun(run.id, 'failed', sourceResults, {}, note);
    log('run_failed', { error: note, intake: true });
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
