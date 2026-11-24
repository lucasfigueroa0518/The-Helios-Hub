import type { ExplainersDb } from '@/lib/explainers/db';
import { matchAssigned, nextSyllabusTopics, refillCount } from '@/lib/explainers/ideas/curriculum';
import { evaluateTopic, topicRef, trimPool, type Evaluation } from '@/lib/explainers/ideas/evaluate';
import { getTopic } from '@/lib/explainers/repository';
import { IDEAS_PER_CALL, ideaUsd, type IdeaModel, type IdeaResponse } from '@/lib/explainers/ideas/generator';
import { cycleRetryGate } from '@/lib/explainers/ideas/retry';
import { readExplainersGate, type ExplainersGate } from '@/lib/explainers/ideas/gate';
import { RecordingExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { cappedJevTransport, isRefillCapped, RefillBudget } from '@/lib/reels/refill-budget';
import { beginRefill, settleRefill, type TotalQuery } from '@/lib/content-type/refill-total';
import { dbQuery } from '@/lib/db';
import {
  addTopics,
  listPool,
  listTopicTerms,
  listUnscoredSyllabusIdeas,
  nyDate,
  productionSpendForDay,
  recordCost,
  requestRender,
  saveLessonFrame,
  type NewTopic,
  type RenderRequest,
} from '@/lib/explainers/repository';
import { spineOf } from '@/lib/explainers/publish/items';
import { fillCandidates, postsPerDay, requireApproval, scheduleJob, type ScheduleOutcome } from '@/lib/explainers/publish/schedule';
import { loadSettings, loadThemeBrief } from '@/lib/explainers/settings';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { quotaFromSlots } from '@/lib/social-hub/slots';
import { consoleFillLog, dailyFillOrQuota, reportFill, type DailyFill, type FillLog } from '@/lib/social-hub/fill';
import { fillDates, leadDaysFor } from '@/lib/social-hub/lead';
import { markPromoteUsed, readMoves, recordPromoteSkip, type MovesQuery } from '@/lib/social-hub/moves-store';
import { finishNightPlacements } from '@/lib/social-hub/queue-store';
import { tonightMoves, type IdeaAdjustment } from '@/lib/social-hub/views/moves';

export type IdeaCycleDeps = {
  db: ExplainersDb;
  ideaModel: IdeaModel;
  jevTransport: JevTransport;
  now?: Date;
  /** Where the daily fill's `fill_reduced` line goes (default: a JSON line on stdout). */
  log?: FillLog;
  /**
   * The main database, where the hub records Promote / Demote
   * (social_hub.idea_adjustments; Spec correction 1: the explainers handle may
   * be a database of its own). Absent or failing: no moves, as before.
   */
  moves?: MovesQuery;
  /**
   * A person's "Run the idea cycle now" (lib/explainers/ideas/cycle-request.ts): makes even while the type is
   * paused. It bypasses only that gate; the one-cycle-per-day index and the spend caps stay. Its refill is the
   * person's own click, so the refill cap does not apply to it.
   */
  force?: boolean;
  /** The state gate (D16); read from explainers.settings when absent. */
  gate?: ExplainersGate;
  /** Where `state_mismatch` / `refill_capped` go (default: a JSON line on stdout). */
  event?: (event: string, fields: Record<string, unknown>) => void;
  /** The nightly refill total's ledger (D19); the main database when absent. */
  totalQuery?: TotalQuery;
};

/** Why tonight's promoted topic wasn't made: it is no longer a pool topic or a placeable render. */
export const EXPLAINER_GONE = 'It isn’t in the explainers pool any more (rendered, posted or cut).';

/** A surviving render the night placed instead of rendering its topic again (daily fill, D54). */
export type Allocation = {
  topicId: string;
  jobId: string;
  /** Its slot in Approval or Live (holdsSlots); null while Paused (scheduleApproved places it once it holds slots again). */
  scheduled: ScheduleOutcome | null;
};

/** `auto_render_off` is no longer returned (a paused night refills: IdeaCycleRefill); kept for older readers. */
export type IdeaCycleSkip = 'auto_render_off' | 'daily_spend_cap' | 'already_ran_today' | 'retry_wait' | 'retry_exhausted' | 'render_already_requested';

/** One date's cycle (Bald-Eagle D4: the night fills each date it makes ahead with a cycle of its own). */
export type IdeaCycleDateResult =
  | { status: 'skipped'; reason: IdeaCycleSkip }
  | { status: 'skipped'; reason: 'quota_filled'; fill: DailyFill }
  | {
      status: 'ok';
      cycleId: string;
      evaluations: Evaluation[];
      promotedTopicId: string | null;
      render: RenderRequest | null;
      /** The day's fill: quota, what people placed, what the night could make. */
      fill: DailyFill;
      /** Topics promoted and sent to render, best first. */
      renders: string[];
      allocated: Allocation[];
      /** Tonight's refill stopped at its cap (D14). */
      refillCapped?: boolean;
    }
  | { status: 'failed'; cycleId: string; error: string };

/**
 * The night refilled the pool but made nothing (D16, D3): the type is paused, or no date it fills had room (quota
 * filled, the daily spend cap, or every date already filled). The refill is recorded as an `idea_cycles` row with
 * status `skipped` (the one-cycle-a-day index covers only running/ok rows, so it never blocks a date's make).
 */
export type IdeaCycleRefill = {
  status: 'refilled';
  cycleId: string;
  reason: 'paused' | 'nothing_to_make';
  evaluations: Evaluation[];
  /** The refill stopped at its cap. */
  refillCapped: boolean;
};

/**
 * The run's outcome over the dates it fills. A failed date wins (the worker retries it), then a date waiting for its
 * retry, then the dates that ran (summed; `cycleId`/`fill`: the last of them; `dates`: what happened on each date),
 * else the skip of the last date that had a reason other than "already filled".
 */
export type IdeaCycleResult = (IdeaCycleDateResult | IdeaCycleRefill) & { dates?: Array<{ nyDate: string } & IdeaCycleDateResult> };

function survivedDedupe(e: Evaluation): boolean {
  return e.outcome !== 'rejected_history_duplicate' && e.outcome !== 'lost_head_to_head';
}

function enteredPool(e: Evaluation): boolean {
  return e.outcome === 'entered_pool' || e.outcome === 'won_head_to_head';
}

/** The day's quota: the calendar's explainers slots within the daily cap in template mode, else `posts_per_day`. */
export async function explainersQuota(db: ExplainersDb, day: string): Promise<number> {
  // A failed slot read throws: it must not silently book by the old rules (ruling P2).
  return (await quotaFromSlots((text, params) => db.query(text, params) as never, 'explainers', day)) ?? (await postsPerDay(db));
}


const movesQuery = (db: ExplainersDb): MovesQuery => (text, params) => db.query(text, params as never) as never;
const topicOfIdea = (ideaId: string) => ideaId.replace(/^explainers:topic:/, '');
const ideaOfTopic = (topicId: string) => `explainers:topic:${topicId}`;

/** What a person did to the pool, read once per run. A failed read is no moves: the night runs as it did before them. */
async function readPoolMoves(q: MovesQuery): Promise<IdeaAdjustment[]> {
  return readMoves(q, 'explainers');
}

/** Topics a person pinned or dragged: the pool trim never cuts them. */
const heldTopicIds = (moves: readonly IdeaAdjustment[]): Set<string> =>
  new Set(moves.filter((m) => m.kind === 'pin' || m.kind === 'promote' || m.kind === 'place').map((m) => topicOfIdea(m.ideaId)));

/**
 * Syllabus ideas a person archived, as history: the machine does not bring them back. An idea from before the
 * curriculum (no syllabus_rank) is left out, so old history never blocks a syllabus topic (2026-11-22).
 */
async function archivedTopics(db: ExplainersDb, moves: readonly IdeaAdjustment[]) {
  const found = await Promise.all(moves.filter((m) => m.kind === 'archive').map((m) => getTopic(db, topicOfIdea(m.ideaId)).catch(() => null)));
  return found.filter((t): t is NonNullable<typeof t> => t != null && t.syllabus_rank != null);
}

/**
 * E-16 daily lifecycle, split into refill and make (settings standard D16, D3). The refill has the curriculum assign
 * the next three syllabus topics (curriculum.ts), writes an idea for each in one call, dedupes and scores each (E-15,
 * A-3) and trims the pool to pool_size: it runs once a night in every state, even when the quota is full, held to
 * `pool_refill_cap_usd` (D14; cost_events of its idea cycle). The make step then promotes the best and queues its
 * render, only while the type makes posts (Approval or Live); a render is placed on the calendar only while it is
 * Live. In production the day's spend so far must be under the cap (A-4).
 *
 * Lead time (Bald-Eagle D4, D8; lib/social-hub/lead.ts): the night fills the dates it makes ahead,
 * `fillDates(runDay, 2)` (the run day through day+2), each with a cycle of its own keyed by that date
 * (`idea_cycles.ny_date` = the date filled; the unique index then means each date is filled once, and
 * the run happens once a night: the cutover night finds day+1 and day+2 unfilled and fills them, plus
 * the run day unless the old same-day cycle already filled it (same key); every later night finds the
 * run day and day+1 filled by the two nights before and fills only day+2). The night's refill runs in the first
 * date it fills; when it fills none (paused, quota filled, spend cap), the refill runs on its own (IdeaCycleRefill).
 * A person's "Run the idea cycle now" (`force`) fills today, the day clicked, as before. Freshness (the ideas'
 * coverage window, the history the prompt carries) is measured from the run time.
 *
 * Daily fill (D54): a date's quota, less every explainer already booked on it
 * (lead time: the night's own too; a forced run: what people placed, as before).
 * Nothing left: that date makes nothing (the refill still runs). Otherwise the top
 * `quota − placed` candidates, ranked together (pool topics and topics whose approved
 * render hasn't posted, `fillCandidates`), are taken: a surviving render is placed
 * on that date (scheduleJob, while Live) instead of rendered again; a
 * pool topic is promoted and rendered for that date (`target_date`), at most
 * `daily_render_cap` of them, under that date's spend caps.
 */
export async function runIdeaCycle(deps: IdeaCycleDeps): Promise<IdeaCycleResult> {
  const { db } = deps;
  const event = deps.event ?? consoleEvent;
  // Where the hub records Promote / Pin / Drag / Archive: the main database when the worker passes it (the explainers handle may
  // be a database of its own), else this one. A read that fails is no moves, so the night runs as before.
  const movesQ: MovesQuery = deps.moves ?? movesQuery(db);
  const movesReadAt = new Date();
  const settings = await loadSettings(db);
  const gate = deps.gate ?? (await readExplainersGate(db, deps.force));
  if (gate.mismatch) event('state_mismatch', { vertical: 'explainers', state: gate.state });

  const runDay = nyDate(deps.now);
  const lead = deps.force ? 0 : leadDaysFor('explainers');
  // One refill a night: a worker restart the same night does not refill again (a person's forced run always may).
  const refilled = !deps.force && (await refilledOn(db, runDay));
  const st: RunState = { movesQ, settings, gate, event, placedJobs: new Set(), pinsChecked: false, capped: false, refilled, refillCapped: false };
  const dates: Array<{ nyDate: string } & IdeaCycleDateResult> = [];
  if (gate.makes) {
    for (const day of fillDates(runDay, lead)) {
      const out = await runCycleFor(deps, st, day, lead);
      dates.push({ nyDate: day, ...out });
      // A failed date stops the run: the worker retries it (and reaches the later date then).
      if (out.status === 'failed') break;
    }
  } else {
    event('make_skipped', { vertical: 'explainers', state: gate.state, reason: 'paused' });
  }

  const ok = dates.filter((d): d is { nyDate: string } & Extract<IdeaCycleDateResult, { status: 'ok' }> => d.status === 'ok');
  // The run made its picks: hand placements are used up and the ideas compete by score again (a failed run never
  // reaches its picks, so a hand move is not undone by a night that did nothing for it). A night that was capped left
  // ideas it chose unmade: their placements stay for the next night.
  if (ok.length && !st.capped) await finishNightPlacements(movesQ, 'explainers', undefined, movesReadAt);

  const strip = ({ nyDate: _d, ...rest }: { nyDate: string } & IdeaCycleDateResult): IdeaCycleDateResult => rest as IdeaCycleDateResult;
  const failed = dates.find((d) => d.status === 'failed');
  if (failed) return strip(failed);
  const waiting = dates.find((d) => d.status === 'skipped' && d.reason === 'retry_wait');
  if (waiting) return strip(waiting);

  // Refill (D3): no date refilled tonight (paused, or nothing to make), so the refill runs on its own. Not for a
  // person's forced run: it keeps its old rules (the one-cycle-a-day index and the spend caps stop it, refill included).
  // Nor when a date stopped on a spend cap or its own retry rules: the refill would bypass them (a failed refill retries
  // with its date, under retry.ts).
  const held = dates.some((d) => d.status === 'skipped' && ['daily_spend_cap', 'retry_exhausted', 'render_already_requested'].includes(d.reason));
  if (!st.refilled && !deps.force && !held) {
    const refill = await runRefillOnly(deps, st, runDay);
    if (refill.status === 'failed') return refill;
    return { ...refill, reason: gate.makes ? 'nothing_to_make' : 'paused', ...(dates.length ? { dates } : {}) };
  }

  if (ok.length) {
    const last = ok[ok.length - 1]!;
    return {
      status: 'ok',
      cycleId: last.cycleId,
      evaluations: ok.flatMap((d) => d.evaluations),
      promotedTopicId: ok.find((d) => d.promotedTopicId)?.promotedTopicId ?? null,
      render: ok.find((d) => d.render)?.render ?? null,
      fill: last.fill,
      renders: ok.flatMap((d) => d.renders),
      allocated: ok.flatMap((d) => d.allocated),
      ...(st.refillCapped ? { refillCapped: true } : {}),
      dates,
    };
  }
  const told = dates.filter((d) => !(d.status === 'skipped' && d.reason === 'already_ran_today'));
  const pick = told[told.length - 1] ?? dates[dates.length - 1];
  return pick ? strip(pick) : { status: 'skipped', reason: 'already_ran_today' };
}

const consoleEvent = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'explainers-cycle', message: event, ...fields }));

/** Whether a refill already ran on this New York night: its own row (`skipped`) or a date cycle that generated ideas. */
async function refilledOn(db: ExplainersDb, runDay: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM explainers.idea_cycles
      WHERE (started_at AT TIME ZONE 'America/New_York')::date = $1::date
        AND (status = 'skipped' OR (status IN ('running', 'ok') AND ideas_generated > 0))
      LIMIT 1`,
    [runDay],
  );
  return rows.length > 0;
}

type RunState = {
  movesQ: MovesQuery;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  gate: ExplainersGate;
  event: (event: string, fields: Record<string, unknown>) => void;
  /** Surviving renders this run already placed (on an earlier date): never placed twice in one run. */
  placedJobs: Set<string>;
  pinsChecked: boolean;
  /** A render could not start (a render or spend cap): the night's hand placements stay for the next night. */
  capped: boolean;
  /** Tonight's refill already ran (in an earlier date's cycle, or before this run). */
  refilled: boolean;
  /** Tonight's refill stopped at its cap. */
  refillCapped: boolean;
};

type RefillOutcome = { added: Array<{ id: string }>; evaluations: Evaluation[] };

/**
 * The refill (D16): generate, dedupe and score into explainers.topics, then trim the pool. Held to the gate's refill
 * cap, counted from this cycle's cost_events: no new idea call or topic evaluation starts once the cap is reached, and
 * the topics left unscored wait as `proposed`. Logs `refill_capped` once.
 */
async function refillPool(deps: IdeaCycleDeps, st: RunState, cycleId: string, moves: readonly IdeaAdjustment[]): Promise<RefillOutcome> {
  const { db } = deps;
  // The nightly total of all refills (D19): the cap is cut to what is left of it; nothing left caps this refill at $0.
  // A person's forced cycle (no cap) is not held to it.
  const totalQuery: TotalQuery = deps.totalQuery ?? ((t, p) => dbQuery(t, p as unknown[]) as Promise<{ rows: any[] }>);
  const totalLog = (message: string, fields: Record<string, unknown> = {}) => st.event(message, { vertical: 'explainers', ideaCycleId: cycleId, ...fields });
  const grant = st.gate.refillCapUsd == null ? null : await beginRefill(totalQuery, 'explainers', st.gate.refillCapUsd, { ref: `idea_cycle:${cycleId}`, log: totalLog, now: deps.now });
  const budget = new RefillBudget(st.gate.refillCapUsd == null ? null : (grant?.capUsd ?? 0), () => cycleSpendUsd(db, cycleId), (fields) => {
    st.refillCapped = true;
    st.event('refill_capped', { vertical: 'explainers', ideaCycleId: cycleId, ...fields });
  });
  try {
    return await refillPoolWithin(deps, st, cycleId, moves, budget);
  } finally {
    await settleRefill(totalQuery, grant, await budget.spentUsd().catch(() => grant?.capUsd ?? 0), totalLog);
  }
}

async function refillPoolWithin(deps: IdeaCycleDeps, st: RunState, cycleId: string, moves: readonly IdeaAdjustment[], budget: RefillBudget): Promise<RefillOutcome> {
  const { db } = deps;
  const { settings } = st;
  const archived = await archivedTopics(db, moves);
  if (await budget.reached()) return { added: [], evaluations: [] };
  const themeBrief = await loadThemeBrief(db, settings.theme_brief_version);
  const pool = await listPool(db);
  // Syllabus ideas an earlier refill wrote but its cap left unscored: scored first tonight, and they count as waiting.
  const leftovers = await listUnscoredSyllabusIdeas(db);
  // Top-up (Lucas, 2026-11-24): write what the pool is short of POOL_TARGET (10), IDEAS_PER_CALL per call, so a short
  // pool is full again by morning and no idea is written only to be cut.
  const want = refillCount(pool.length + leftovers.length);
  // Curriculum (2026-11-21): the syllabus assigns tonight's topics, the first untaken in teaching order; a term
  // that failed MAX_FAILED_TRIES times is passed over. The prompt carries them, the archived topics and the pool.
  const next = nextSyllabusTopics(await listTopicTerms(db), want);
  if (next.skipped.length) {
    console.info(`[explainers] syllabus: passed over after repeated failed tries: ${next.skipped.map((t) => t.term).join(', ')}`);
  }
  let ideas: IdeaResponse['ideas'] = [];
  for (let at = 0; at < next.topics.length; at += IDEAS_PER_CALL) {
    // Each call is held to the refill cap: once it is reached, the rest of the shortfall waits for the next night.
    if (at > 0 && (await budget.reached())) break;
    const topics = next.topics.slice(at, at + IDEAS_PER_CALL);
    const response = await deps.ideaModel.propose({
      model: settings.idea_model,
      themeBrief,
      topics,
      pool: pool.map(topicRef),
      archived: archived.map(topicRef),
    });
    const usage = response.usage;
    await recordCost(db, {
      ideaCycleId: cycleId,
      mode: settings.mode,
      vendor: 'anthropic',
      component: 'idea_generator',
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
      cacheWriteTokens: Number(usage.cache_creation_input_tokens ?? 0),
      usd: ideaUsd(response),
    });
    // Held to the assignment in code: an idea that names no assigned topic is dropped; its topic stays untaken.
    const { kept, dropped } = matchAssigned(response.ideas, topics);
    if (dropped.length) {
      console.info(`[explainers] idea generator: dropped ${dropped.length} idea(s) off the assigned terms (${dropped.map((d) => JSON.stringify(d.term)).join(', ')})`);
    }
    ideas = [...ideas, ...kept];
  }
  if (next.topics.length === 0 && want === 0) {
    console.info(`[explainers] pool: ${pool.length + leftovers.length} ideas waiting, the target or more; no new ideas tonight`);
  } else if (next.topics.length === 0) {
    console.info('[explainers] syllabus: every topic is taken; no ideas tonight');
  }

  const added = await addTopics(
    db,
    ideas.map((idea) => ({
      title: idea.topic_title,
      scope: idea.topic_scope,
      term: idea.term,
      origin: 'generated' as const,
      bucket: idea.bucket,
      lessonPayload: idea.payload,
      lessonAltitude: idea.altitude,
      lessonMap: idea.map_position,
    })),
  );
  await db.query('UPDATE explainers.topics SET idea_cycle_id = $1 WHERE id = ANY($2::uuid[])', [
    cycleId,
    added.map((t) => t.id),
  ]);

  // Every Jev call of the scoring and dedupe goes through the cap (cappedJevTransport refuses once it is reached).
  const jev = new RecordingExplainersJevRunner(cappedJevTransport(deps.jevTransport, budget), db, {
    mode: settings.mode,
    ideaCycleId: cycleId,
  });
  const evaluations: Evaluation[] = [];
  for (const topic of [...leftovers, ...added]) {
    if (await budget.reached()) break;
    try {
      evaluations.push(
        await evaluateTopic({ db, jev, settings, themeBrief, now: deps.now, ideaModel: deps.ideaModel, ideaCycleId: cycleId, extraHistory: archived }, topic.id),
      );
    } catch (error) {
      // The cap stopped this topic partway: it waits, unscored, for the next refill. Anything else fails the cycle.
      if (!isRefillCapped(error)) throw error;
      break;
    }
  }
  await trimPool(db, settings.pool_size, heldTopicIds(moves));
  return { added, evaluations };
}

/** What one idea cycle has spent (its cost_events): the refill cap's ledger. */
async function cycleSpendUsd(db: ExplainersDb, cycleId: string): Promise<number> {
  const { rows } = await db.query<{ usd: unknown }>(
    `SELECT COALESCE(SUM(usd), 0) AS usd FROM explainers.cost_events WHERE idea_cycle_id = $1`,
    [cycleId],
  );
  return Number(rows[0]?.usd ?? 0);
}

/** The counts and cost split every cycle row records; `status` is ok for a date's cycle, skipped for a refill on its own. */
async function finishCycleRow(db: ExplainersDb, cycleId: string, status: 'ok' | 'skipped', refill: RefillOutcome, best: string | null): Promise<void> {
  await db.query(
    `UPDATE explainers.idea_cycles c
        SET status = $6, finished_at = now(),
            ideas_generated = $2, ideas_surviving_dedupe = $3, ideas_entering_pool = $4,
            promoted_topic_id = $5,
            generator_cost_usd = COALESCE(s.generator, 0),
            scoring_cost_usd = COALESCE(s.scoring, 0),
            duplicate_check_cost_usd = COALESCE(s.duplicate, 0)
       FROM (SELECT SUM(usd) FILTER (WHERE component = 'idea_generator') AS generator,
                    SUM(usd) FILTER (WHERE component = 'idea_scoring') AS scoring,
                    SUM(usd) FILTER (WHERE component IN ('duplicate_gate', 'duplicate_pairs')) AS duplicate
               FROM explainers.cost_events WHERE idea_cycle_id = $1) s
      WHERE c.id = $1`,
    [
      cycleId,
      refill.added.length,
      refill.evaluations.filter(survivedDedupe).length,
      refill.evaluations.filter(enteredPool).length,
      best,
      status,
    ],
  );
}

/**
 * The refill on its own (D3): a night that made nothing still refills. Its row is inserted `skipped` (the date-fill
 * index covers running/ok rows only) and keyed by the run day; a failure marks it `failed`, so the worker retries.
 */
async function runRefillOnly(
  deps: IdeaCycleDeps,
  st: RunState,
  runDay: string,
): Promise<Omit<IdeaCycleRefill, 'reason'> | { status: 'failed'; cycleId: string; error: string }> {
  const { db } = deps;
  st.refilled = true;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.idea_cycles (status, mode, ny_date, started_at) VALUES ('skipped', $1, $2::date, $3) RETURNING id`,
    [st.settings.mode, runDay, (deps.now ?? new Date()).toISOString()],
  );
  const cycleId = rows[0]!.id;
  try {
    const refill = await refillPool(deps, st, cycleId, await readPoolMoves(st.movesQ));
    await finishCycleRow(db, cycleId, 'skipped', refill, null);
    return { status: 'refilled', cycleId, evaluations: refill.evaluations, refillCapped: st.refillCapped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(
      `UPDATE explainers.idea_cycles SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
      [cycleId, message],
    );
    return { status: 'failed', cycleId, error: message };
  }
}

/**
 * Top the pool up to POOL_TARGET now, outside the nightly cycle (Lucas, 2026-11-24: "fill the pool with 10 ideas
 * already"): the refill only, held to the refill cap, with no make step, so nothing is promoted or rendered. It is a
 * cycle row of its own (status 'skipped', like a paused night's refill) for the spend ledger.
 */
export async function refillIdeaPoolNow(deps: IdeaCycleDeps): Promise<Omit<IdeaCycleRefill, 'reason'> | { status: 'failed'; cycleId: string; error: string }> {
  const { db } = deps;
  const settings = await loadSettings(db);
  const gate = deps.gate ?? (await readExplainersGate(db, false));
  const st: RunState = { movesQ: deps.moves ?? movesQuery(db), settings, gate, event: deps.event ?? consoleEvent, placedJobs: new Set(), pinsChecked: false, capped: false, refilled: false, refillCapped: false };
  return runRefillOnly(deps, st, nyDate(deps.now));
}

/** One date's cycle: fill `day` once (lead > 0: a date made ahead; 0: today, a person's forced run). */
async function runCycleFor(deps: IdeaCycleDeps, st: RunState, day: string, lead: number): Promise<IdeaCycleDateResult> {
  const { db } = deps;
  const { movesQ, settings } = st;
  const fillLog = deps.log ?? consoleFillLog;
  // A date an earlier night already filled (or is filling) is passed over quietly: lead time revisits the run day and
  // day+1 every night, and a fill line for them would be noise. The insert below stays the real guard.
  if ((await db.query(`SELECT 1 FROM explainers.idea_cycles WHERE ny_date = $1::date AND status IN ('running', 'ok') LIMIT 1`, [day])).rows.length) {
    return { status: 'skipped', reason: 'already_ran_today' };
  }
  // A failed read of the placements never stops the night: it fills the whole quota, as before the rule.
  const fill = await dailyFillOrQuota(
    spineOf(db),
    'explainers',
    day,
    await explainersQuota(db, day),
    (error) => fillLog('fill_failed', { vertical: 'explainers', nyDate: day, error: error instanceof Error ? error.message : String(error) }),
    lead > 0 ? { lead } : {},
  );
  reportFill(fill, fillLog, { dailyRenderCap: settings.daily_render_cap });
  if (fill.making < 1) return { status: 'skipped', reason: 'quota_filled', fill };

  if (
    settings.mode === 'production' &&
    (await productionSpendForDay(db, day)) >= settings.daily_spend_cap_usd
  ) {
    return { status: 'skipped', reason: 'daily_spend_cap' };
  }

  // A failed night may run once more (bounded, delayed; see retry.ts). Failed rows stay as history.
  const gate = await cycleRetryGate(db, day, deps.now);
  if (!gate.run) return { status: 'skipped', reason: gate.reason };

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.idea_cycles (status, mode, ny_date, started_at)
     VALUES ('running', $1, $2::date, $3)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [settings.mode, day, (deps.now ?? new Date()).toISOString()],
  );
  const cycleId = rows[0]?.id;
  if (!cycleId) return { status: 'skipped', reason: 'already_ran_today' };

  try {
    const moves = await readPoolMoves(movesQ);
    // Tonight's refill runs in the first date this run fills (D16); a later date only makes.
    let refill: RefillOutcome = { added: [], evaluations: [] };
    if (!st.refilled) {
      st.refilled = true;
      refill = await refillPool(deps, st, cycleId, moves);
    }
    const evaluations = refill.evaluations;

    // Daily fill (D54): the top `quota − placed` candidates, fresh topics and surviving renders ranked together.
    // A surviving render is placed, not rendered again; at most `daily_render_cap` pool topics are rendered
    // (SH-49: two a day), and requestRender still enforces both caps.
    const approvalNeeded = await requireApproval(db);
    const candidates = (await fillCandidates(db, approvalNeeded, moves)).filter((c) => !(c.jobId && st.placedJobs.has(c.jobId)));
    // A pin that can no longer be made (not a pool topic or a placeable render any more) steps aside with why on the move; the
    // rest of the queue goes on. Never blocks the night. Checked once a run.
    if (!st.pinsChecked) {
      st.pinsChecked = true;
      const makeable = new Set(candidates.map((c) => ideaOfTopic(c.topicId)));
      for (const pin of tonightMoves(moves, 'explainers').pins) {
        if (!makeable.has(pin.ideaId)) await recordPromoteSkip(movesQ, 'explainers', pin.ideaId, EXPLAINER_GONE);
      }
    }
    const chosen = candidates.slice(0, fill.making);
    const handMoved = new Set(moves.filter((m) => m.kind === 'pin' || m.kind === 'promote' || m.kind === 'place').map((m) => m.ideaId));
    const renderCap = Math.max(1, settings.daily_render_cap);
    // Placed on the calendar in Approval and Live (holdsSlots, contract §4.3; the gate reads Generate and Live
    // together). Only Live posts them. fillCandidates never offers a render sent back to Made (D18).
    const books = st.gate.books;
    const renders: string[] = [];
    const allocated: Allocation[] = [];
    let best: string | null = null;
    let render: RenderRequest | null = null;
    let capped = false;
    for (const candidate of chosen) {
      if (candidate.jobId) {
        // A surviving render is placed on the date this cycle fills (lead time); a forced run books as before.
        const now = deps.now ?? new Date();
        const scheduled = books ? await (lead > 0 ? scheduleJob(db, candidate.jobId, 'auto', now, day, undefined, day) : scheduleJob(db, candidate.jobId, 'auto', now)) : null;
        st.placedJobs.add(candidate.jobId);
        allocated.push({ topicId: candidate.topicId, jobId: candidate.jobId, scheduled });
        if (handMoved.has(ideaOfTopic(candidate.topicId))) await markPromoteUsed(movesQ, 'explainers', ideaOfTopic(candidate.topicId));
        continue;
      }
      if (capped || renders.length >= renderCap) continue;
      await db.query(
        `UPDATE explainers.topics SET status = 'promoted', updated_at = now() WHERE id = $1`,
        [candidate.topicId],
      );
      best ??= candidate.topicId;
      renders.push(candidate.topicId);
      const requested = await requestRender(db, { topicId: candidate.topicId, trigger: 'auto', settings, now: deps.now, ...(lead > 0 ? { targetDate: day } : {}) });
      render ??= requested;
      if (!requested.ok) capped = true;
      if (handMoved.has(ideaOfTopic(candidate.topicId))) {
        if (requested.ok) await markPromoteUsed(movesQ, 'explainers', ideaOfTopic(candidate.topicId));
        // A render that doesn't start caps the night, so no other topic is tried. That is transient: no skip is
        // recorded, so the pin stays active for next night.
        else console.info(`[explainers] ${candidate.topicId} not rendered tonight (${requested.reason.replace(/_/g, ' ')}); kept for next night`);
      }
    }
    // Hand placements are used up once the run is over (runIdeaCycle); a capped date keeps them for the next night.
    if (capped) st.capped = true;

    await finishCycleRow(db, cycleId, 'ok', refill, best);
    return { status: 'ok', cycleId, evaluations, promotedTopicId: best, render, fill, renders, allocated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(
      `UPDATE explainers.idea_cycles SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
      [cycleId, message],
    );
    return { status: 'failed', cycleId, error: message };
  }
}

export type IntakeResult = { topicId: string; title: string; scope: string; evaluation: Evaluation }[];

export type HandTopic = Omit<NewTopic, 'scope'>;

/**
 * Lucas's hand-added topics (A-7, A-9). One model call writes a scope for
 * every title, then each topic is scored and deduped, each one that makes the
 * pool gets its analogy picked (EX3-30), then the pool is trimmed. Runs on his
 * click, so these calls are his.
 */
export async function addAndEvaluateTopics(
  deps: { db: ExplainersDb; jevTransport: JevTransport; ideaModel: IdeaModel; now?: Date; /** The main database, where pins and drags live (the explainers handle may be its own). */ moves?: MovesQuery },
  topics: HandTopic[],
): Promise<IntakeResult> {
  const { db } = deps;
  if (topics.length === 0) return [];
  const settings = await loadSettings(db);
  const themeBrief = await loadThemeBrief(db, settings.theme_brief_version);

  const titles = topics.map((t) => t.title.trim());
  const written = await deps.ideaModel.writeScopes({ model: settings.idea_model, themeBrief, titles });
  await recordCost(db, {
    mode: settings.mode,
    vendor: 'anthropic',
    component: 'scope_writer',
    inputTokens: Number(written.usage.input_tokens ?? 0),
    outputTokens: Number(written.usage.output_tokens ?? 0),
    cacheReadTokens: Number(written.usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(written.usage.cache_creation_input_tokens ?? 0),
    usd: ideaUsd(written),
  });

  const added = await addTopics(
    db,
    topics.map((topic, i) => {
      // scope-writer-v6 frames each title in the same call (ideas coverage, 2026-11-03).
      const frame = written.frames?.[i];
      return {
        ...topic,
        title: titles[i],
        scope: written.scopes[i],
        term: written.terms[i],
        bucket: frame?.bucket ?? null,
        lessonPayload: frame?.payload ?? null,
        lessonAltitude: frame?.altitude ?? null,
        lessonMap: frame?.map_position ?? null,
      };
    }),
  );
  const jev = new RecordingExplainersJevRunner(deps.jevTransport, db, { mode: settings.mode });
  const results: IntakeResult = [];
  for (const topic of added) {
    const evaluation = await evaluateTopic({ db, jev, settings, themeBrief, now: deps.now, ideaModel: deps.ideaModel }, topic.id);
    results.push({ topicId: topic.id, title: topic.title, scope: topic.scope!, evaluation });
  }
  await trimPool(db, settings.pool_size, heldTopicIds(await readPoolMoves(deps.moves ?? movesQuery(db))));
  return results;
}

/**
 * One-time backfill (ideas coverage, 2026-11-03; Lucas runs it after approval, it is never scheduled): pool topics
 * with no bucket or lesson frame get both from one scope-writer call, all titles together. Only the bucket and frame
 * are written; each topic keeps its title, scope and term. Not a sweep: it touches the pool only, once.
 */
export async function frameMissingPoolTopics(deps: { db: ExplainersDb; ideaModel: IdeaModel }): Promise<{ framed: string[] }> {
  const { db } = deps;
  const missing = (await listPool(db)).filter((t) => !t.bucket || !t.lesson_payload || !t.lesson_altitude || !t.lesson_map);
  if (missing.length === 0) return { framed: [] };
  const settings = await loadSettings(db);
  const themeBrief = await loadThemeBrief(db, settings.theme_brief_version);
  const written = await deps.ideaModel.writeScopes({ model: settings.idea_model, themeBrief, titles: missing.map((t) => t.title.trim()) });
  await recordCost(db, {
    mode: settings.mode,
    vendor: 'anthropic',
    component: 'scope_writer',
    inputTokens: Number(written.usage.input_tokens ?? 0),
    outputTokens: Number(written.usage.output_tokens ?? 0),
    cacheReadTokens: Number(written.usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(written.usage.cache_creation_input_tokens ?? 0),
    usd: ideaUsd(written),
  });
  for (const [i, topic] of missing.entries()) {
    const frame = written.frames[i];
    await saveLessonFrame(db, topic.id, { bucket: frame.bucket, payload: frame.payload, altitude: frame.altitude, map: frame.map_position });
  }
  return { framed: missing.map((t) => t.id) };
}
