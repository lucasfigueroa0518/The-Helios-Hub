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
import { planCandidates, scoreRun, type CandidatePlan, type IntakeScoreSource } from '@/lib/reels/pipeline/scoring';
import { nyDateKey } from '@/lib/reels/scoring/decide';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import type { DailyFill } from '@/lib/social-hub/fill';
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
import { readReelsNightGate, type ReelsNightGate } from '@/lib/reels/pipeline/night-gate';
import { CappedJevRunner, RefillBudget, isRefillCapped, withoutCapped } from '@/lib/reels/refill-budget';
import { beginRefill, settleRefill, type RefillGrant, type TotalQuery } from '@/lib/content-type/refill-total';
import { dbQuery } from '@/lib/db';
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
  /** The state gate (D16); read from reels.settings when absent. */
  gate?: ReelsNightGate;
  /** What the run has spent so far (the refill cap's ledger); runCostUsd(run.id) when absent. */
  runSpend?: () => Promise<number>;
  /** The nightly refill total's ledger (D19); the main database when absent. */
  totalQuery?: TotalQuery;
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
 * The reels already placed for a day count toward the night's three (daily
 * fill, D54); a carryover idea's finished, unposted video is reused (D55).
 *
 * Lead time (Bald-Eagle D4, D8): the scheduled night makes Text on Screen 2
 * days ahead. Ingest and grouping run once; then one slate per date in
 * fillDates(runDay, 2) that still has room, each keyed by its posting date,
 * filled and booked on that date (the cutover night: day+1 then day+2; after
 * that: day+2 only). A person's Run now (trigger 'manual') makes the day it
 * was clicked, as before. See nightTargets.
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

  // Refill split (D16, D3): the refill (ingest, grouping, scoring) runs in every state on its own cap; the make step
  // (copy, render, booking) follows the state. Every refill Jev call goes through the capped runner.
  const gate = deps?.gate ?? (await readReelsNightGate(run.trigger));
  if (gate.mismatch) log('state_mismatch', { vertical: 'reels', runId: run.id, state: gate.state });
  const makeJev: JevRunner = deps?.jev ?? createLiveJevRunner();
  // The nightly total of all refills (D19): a scheduled refill's cap is cut to what is left of it; nothing left caps
  // the refill at $0 (the make step still runs from the pool as it is). A person's Run now (no cap) is not held to it.
  const totalQuery: TotalQuery = deps?.totalQuery ?? ((t, p) => dbQuery(t, p as unknown[]) as Promise<{ rows: any[] }>);
  const grant: RefillGrant | null =
    gate.refillCapUsd == null ? null : await beginRefill(totalQuery, 'reels', gate.refillCapUsd, { ref: `run:${run.id}`, log });
  const refillCap = gate.refillCapUsd == null ? null : (grant?.capUsd ?? 0);
  const budget = new RefillBudget(refillCap, deps?.runSpend ?? (() => runCostUsd(run.id)), (fields) =>
    log('refill_capped', { vertical: 'reels', runId: run.id, ...fields }),
  );
  try {
    return await executeNight(run, deps, gate, makeJev, budget);
  } finally {
    await settleRefill(totalQuery, grant, await budget.spentUsd().catch(() => grant?.capUsd ?? 0), log);
  }
}

async function executeNight(run: RunRow, deps: Partial<RunDeps> | undefined, gate: ReelsNightGate, makeJev: JevRunner, budget: RefillBudget): Promise<RunOutcome> {
  const jev: JevRunner = new CappedJevRunner(makeJev, budget);
  const ingestDeps: IngestDeps = { jev, fetchPage: deps?.fetchPage };
  const primary = deps?.adapters?.primary ?? primaryAdapters();
  const derived = deps?.adapters?.derived ?? derivedAdapters();

  const runStartedAt = new Date(run.started_at ?? run.requested_at);
  const now = new Date();
  const night: Night = { run, deps, jev, makeJev, gate, budget, ingestDeps, primary, derived, runStartedAt, now, scored: new Map() };

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
  /** The refill's Jev runner: refuses once the refill cap is reached. */
  jev: JevRunner;
  /** The make step's Jev runner (copy): not held to the refill cap. */
  makeJev: JevRunner;
  gate: ReelsNightGate;
  budget: RefillBudget;
  ingestDeps: IngestDeps;
  primary: Adapter[];
  derived: Adapter[];
  runStartedAt: Date;
  now: Date;
  /** Legacy scores already paid for tonight: a second slate (the cutover night, D8) reuses them, no second Jev call. */
  scored: Map<string, InterpretedScore>;
  /** Intake mode: where every slate's stored scores come from (the second slate of the cutover night too). */
  intakeSource?: IntakeScoreSource;
};

/** One posting date the night makes a slate for (Bald-Eagle D4). `fill`/`openWindows` absent: read when it is made. */
type Target = { nyDate: string; lead: number; fill?: DailyFill; openWindows?: number };

/**
 * The dates tonight makes slates for (Bald-Eagle D4, D8). The scheduled night: each date fillDates(runDay, lead)
 * lists (lib/social-hub/lead.ts) whose quota still leaves room. A date is full when its bookings plus the reels
 * already made or being made for it (its newest slate's selected reels with a video or a walk in progress, even
 * unbooked: publishing off or a failed booking; reelsLeadFill) cover the quota, or no window is left on it. So a
 * steady-state night skips day+1 (and the run day, when fillDates lists it) and makes day+2; the cutover night
 * finds the earlier dates empty and makes them too. The last date is always scored, so tonight's ideas reach a
 * slate and carry even when every date is full (as a full day did before). Run now: its own day only, unchanged.
 * A date whose fill can't be read is kept: its own fill read then fails where it always did (copyNote).
 */
export async function nightTargets(trigger: RunTrigger, runDay: string, now = new Date()): Promise<Target[]> {
  const { reelsRunDates, reelsLeadFill, reelsTonight } = await import('@/lib/reels/pipeline/fill');
  const { windowsStillOpen } = await import('@/lib/reels/publish/schedule');
  const { dates, lead } = reelsRunDates(runDay, trigger);
  if (lead === 0) return dates.map((nyDate) => ({ nyDate, lead }));
  const out: Target[] = [];
  for (const [index, nyDate] of dates.entries()) {
    const last = index === dates.length - 1;
    try {
      const fill = await reelsLeadFill(now, nyDate, lead);
      const openWindows = await windowsStillOpen(now, nyDate);
      if (reelsTonight(openWindows, fill) < 1 && !last) {
        log('target_filled', { nyDate, quota: fill.quota, placedOrMade: fill.userPlaced, openWindows });
        continue;
      }
      out.push({ nyDate, lead, fill, openWindows });
    } catch (error) {
      log('target_fill_unread', { nyDate, error: errorText(error) });
      out.push({ nyDate, lead });
    }
  }
  return out;
}

/** Today's night, unchanged. `fallback` is set only when the intake switch is on but this night cannot use it. */
async function executeLegacyNight(
  night: Night,
  fallback?: { note: string; keepIntakeIdeas: boolean },
): Promise<RunOutcome> {
  const { run, deps, jev, ingestDeps, primary, derived, runStartedAt, now } = night;
  const sourceResults: SourceResult[] = [];

  try {
    for (const adapter of [...primary, ...derived]) {
      // The refill cap ends the refill cleanly: the sources left wait for the next night (their watermark is unchanged).
      if (await night.budget.reached()) {
        sourceResults.push(cappedSource(adapter));
        continue;
      }
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
      capOutcome(result);
      sourceResults.push(result);
      log('adapter_done', { adapter: adapter.id, ...result });
    }

    const grouping = await groupRun(run.id, runStartedAt, { jev });
    const groupingNote = failureNote('Grouping failed for', withoutCapped(grouping.failures));

    const slate = await makeTargets(night, await nightTargets(run.trigger, nyDateKey(runStartedAt), now));

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
    const itemErrors = withoutCapped(sourceResults.flatMap((result) => result.itemErrors ?? []));
    const itemNote = failureNote('Ingest failed for', itemErrors);
    // D-264. A watched source with nothing kept for days is called out.
    const watched = primary.filter((adapter) => adapter.quietAfterDays != null);
    const quietNote = await loadSourceActivity(watched.map((adapter) => adapter.id))
      .then((activity) => quietSourcesNote(quietSources(watched, activity, now)))
      .catch((error) => `Source health check failed: ${errorText(error)}`);
    const status: RunStatus =
      failed.length === 0 && !slate.scoringNote && !slate.copyNote && !groupingNote && !itemNote && !quietNote ? 'ok' : 'partial';
    const note = [fallback?.note, refillCapNote(night), failed.length === 0
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

/**
 * Every target's slate in date order (the cutover night: day+1, then day+2, so the second slate sees the first's
 * picks and never repeats them; scoring.ts planCandidates). The first target can take a plan read beforehand
 * (intake mode's read-before-spend); later ones read their own. Counts add up; notes carry their date when the night
 * made more than one slate.
 */
async function makeTargets(night: Night, targets: readonly Target[], firstPlan?: CandidatePlan): Promise<SlateOutcome> {
  const total: SlateOutcome = { scored: 0, selected: 0, copyWritten: 0 };
  const notes: Record<'scoringNote' | 'copyNote' | 'fillNote', string[]> = { scoringNote: [], copyNote: [], fillNote: [] };
  for (const [index, target] of targets.entries()) {
    const one = await scoreAndMake(night, target, index === 0 ? firstPlan : undefined);
    total.scored += one.scored;
    total.selected += one.selected;
    total.copyWritten += one.copyWritten;
    for (const key of ['scoringNote', 'copyNote', 'fillNote'] as const) {
      const note = one[key];
      if (note) notes[key].push(targets.length > 1 ? `${target.nyDate}: ${note}` : note);
    }
  }
  for (const key of ['scoringNote', 'copyNote', 'fillNote'] as const) {
    if (notes[key].length) total[key] = notes[key].join(' ');
  }
  return total;
}

/** Score one target's slate, then fill, copy and schedule it on its date (everything after the slate is the same on both paths). */
async function scoreAndMake(night: Night, target: Target, plan?: CandidatePlan): Promise<SlateOutcome> {
  const { run, deps, jev, makeJev, gate, budget, runStartedAt } = night;
  const out: SlateOutcome = { scored: 0, selected: 0, copyWritten: 0 };
  const sameDay = target.lead === 0;
  try {
    const scoring = await scoreRun(run.id, runStartedAt, jev, night.intakeSource, plan, target.nyDate, night.scored);
    out.scored = scoring.scored;
    out.selected = scoring.selected;
    out.scoringNote = failureNote('Scoring failed for', withoutCapped(scoring.failures));
    log('run_scored', { ...scoring, nyDate: target.nyDate });

    if (scoring.slateId) {
      const slateId = scoring.slateId;
      // Nothing made: no idea stays "selected" on a slate it was not made for (it would read as committed to that day).
      const unselect = () => import('@/lib/reels/locks').then(({ selectFilledIdeas }) => selectFilledIdeas(slateId, [])).catch(() => undefined);
      try {
        const { generatePassingReels } = await import('@/lib/reels/pipeline/slots');
        const { scheduleSelectedSlate, windowsStillOpen } = await import('@/lib/reels/publish/schedule');
        const { reelsLeadFill, reelsTonight } = await import('@/lib/reels/pipeline/fill');
        const { quotaFilledNote, reportFill } = await import('@/lib/social-hub/fill');
        // Daily fill (D54): what is already placed for the date counts toward the night's quota (every booking when made ahead).
        const at = new Date();
        const fill = target.fill ?? (await reelsLeadFill(at, target.nyDate, target.lead));
        const openWindows = target.openWindows ?? (await windowsStillOpen(at, target.nyDate));
        const count = reelsTonight(openWindows, fill);
        reportFill(fill, log, { runId: run.id, openWindows, count });
        const carry = sameDay ? 'the ideas carry to tomorrow' : 'the ideas carry to the next slate';
        if (!gate.makes) {
          // Paused (D16): the pool refilled and was scored; nothing is written, rendered or booked.
          await unselect();
          out.fillNote = `Text on Screen is paused, so no reel was written or rendered; ${carry}.`;
          log('make_skipped', { vertical: 'reels', runId: run.id, nyDate: target.nyDate, state: gate.state });
        } else if (count < 1 && fill.making < 1) {
          await unselect();
          // Not a failure: the day is already filled. The ideas carry as on a day with no window left.
          out.fillNote = `${quotaFilledNote(fill, 'reel')} No reel was written or rendered; ${carry}.`;
        } else if (count < 1) {
          await unselect();
          out.copyNote = sameDay
            ? 'No posting window is still open today, so no reel was rendered. The ideas carry to tomorrow.'
            : `No posting window is open on ${target.nyDate}, so no reel was rendered. The ideas carry to the next slate.`;
        } else {
          // The make step's spend shares the run's ledger; it is not counted against the refill cap.
          const copy = await budget.outside(() =>
            generatePassingReels({
              runId: run.id,
              slateId,
              count,
              client: deps?.copyClient,
              signal: deps?.signal,
              jev: makeJev,
              dailyFill: true,
            }),
          );
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
          log('run_copy', { ...copy, nyDate: target.nyDate });
          // Booked only while Text on Screen is Live (D16).
          const scheduled = !gate.books
            ? { scheduled: 0 }
            : await scheduleSelectedSlate(slateId).catch((error) => {
                log('schedule_failed', { error: errorText(error), nyDate: target.nyDate });
                return { scheduled: 0 };
              });
          if (scheduled.scheduled > 0) log('run_scheduled', { ...scheduled, nyDate: target.nyDate });
        }
      } catch (error) {
        out.copyNote = `Copy failed: ${errorText(error)}`;
        log('copy_failed', { error: out.copyNote, nyDate: target.nyDate });
      }
    }
  } catch (error) {
    out.scoringNote = `Scoring failed: ${error instanceof Error ? error.message : String(error)}`;
    log('scoring_failed', { error: out.scoringNote, nyDate: target.nyDate });
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
        if (await night.budget.reached()) {
          sourceResults.push(cappedSource(adapter));
          fetched.set(adapter.id, { items: [] });
          continue;
        }
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
        capOutcome(result);
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
    // The dates tonight fills (Bald-Eagle D4). Not an intake read: its own errors are handled per date.
    const targets = await nightTargets(run.trigger, nyDateKey(runStartedAt), now);
    const source = intakeScoreSource(intake);
    try {
      const stories = await listReelsStories(intake, now);
      registered = await registerIntakeIdeas(q, stories, timelyFrom);
      log('intake_registered', { ...registered, timelyFrom: timelyFrom.toISOString() });
      plan = await planCandidates(runStartedAt, source, targets[0]?.nyDate);
    } catch (error) {
      return { fallback: errorText(error), replay: replay() };
    }
    if (plan.twinsDropped.length) log('intake_switch_twins_dropped', { ids: plan.twinsDropped });

    const slate = await makeTargets({ ...night, intakeSource: source }, targets, plan);

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
      refillCapNote(night),
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

/** A source the refill cap kept from running tonight: skipped, not failed. */
function cappedSource(adapter: Adapter): SourceResult {
  return { adapterId: adapter.id, name: adapter.name, status: 'skipped', fetched: 0, ingested: 0, dropped: 0, refreshed: 0, error: 'Refill cap reached; this source waits for the next night.' } as SourceResult;
}

/** A source the cap stopped partway is skipped, not failed; its items the cap stopped are not item errors. */
function capOutcome(result: SourceResult): void {
  if (result.status === 'failed' && isRefillCapped(result.error)) {
    result.status = 'skipped';
    result.error = 'Refill cap reached; this source waits for the next night.';
  }
  if (result.itemErrors) result.itemErrors = withoutCapped(result.itemErrors);
}

function refillCapNote(night: Night): string | undefined {
  return night.budget.capped ? `The refill reached its $${(night.budget.capUsd ?? 0).toFixed(2)} cap; the rest waits for the next night.` : undefined;
}

function isNotApproved(error: string | undefined): boolean {
  return typeof error === 'string' && error.includes('REELS_B6_PROMPT_APPROVED');
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
