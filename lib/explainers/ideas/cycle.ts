import type { ExplainersDb } from '@/lib/explainers/db';
import { evaluateTopic, topicRef, trimPool, type Evaluation } from '@/lib/explainers/ideas/evaluate';
import { getTopic } from '@/lib/explainers/repository';
import { ideaUsd, type IdeaModel } from '@/lib/explainers/ideas/generator';
import { cycleRetryGate } from '@/lib/explainers/ideas/retry';
import { RecordingExplainersJevRunner } from '@/lib/explainers/jev/runner';
import {
  addTopics,
  listPool,
  listRecentlyRendered,
  nyDate,
  productionSpendForDay,
  recordCost,
  requestRender,
  type NewTopic,
  type RenderRequest,
} from '@/lib/explainers/repository';
import { spineOf } from '@/lib/explainers/publish/items';
import { fillCandidates, postsPerDay, publishingLive, requireApproval, scheduleJob, type ScheduleOutcome } from '@/lib/explainers/publish/schedule';
import { loadSettings, loadThemeBrief } from '@/lib/explainers/settings';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { quotaFromSlots } from '@/lib/social-hub/slots';
import { consoleFillLog, dailyFillOrQuota, reportFill, type DailyFill, type FillLog } from '@/lib/social-hub/fill';
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
};

/** Why tonight's promoted topic wasn't made: it is no longer a pool topic or a placeable render. */
export const EXPLAINER_GONE = 'It isn’t in the explainers pool any more (rendered, posted or cut).';

/** A surviving render the night placed instead of rendering its topic again (daily fill, D54). */
export type Allocation = {
  topicId: string;
  jobId: string;
  /** Its slot, when publishing is live; null while it is off (scheduleApproved places it once it is on). */
  scheduled: ScheduleOutcome | null;
};

export type IdeaCycleResult =
  | { status: 'skipped'; reason: 'auto_render_off' | 'daily_spend_cap' | 'already_ran_today' | 'retry_wait' | 'retry_exhausted' | 'render_already_requested' }
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
    }
  | { status: 'failed'; cycleId: string; error: string };

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

/** Topics a person archived, as history: the machine does not bring them back. */
async function archivedTopics(db: ExplainersDb, moves: readonly IdeaAdjustment[]) {
  const found = await Promise.all(moves.filter((m) => m.kind === 'archive').map((m) => getTopic(db, topicOfIdea(m.ideaId)).catch(() => null)));
  return found.filter((t): t is NonNullable<typeof t> => t != null);
}

/**
 * E-16 daily lifecycle. Runs only while auto_render is on (A-5, A-7): generate
 * three ideas in one call, dedupe and score each (E-15, A-3), trim the pool to
 * pool_size, then promote the best and queue its render. In production the
 * day's spend so far, including earlier idea runs, must be under the cap (A-4).
 *
 * Daily fill (D54): the night fills the day's `posts_per_day`, less the
 * explainers people placed for that New York day. Nothing left: the cycle is
 * skipped (no idea call, no spend). Otherwise the top `quota − placed`
 * candidates, ranked together (pool topics and topics whose approved render
 * hasn't posted, `fillCandidates`), are taken: a surviving render is placed
 * (scheduleJob, while publishing is live) instead of rendered again; a pool
 * topic is promoted and rendered, at most `daily_render_cap` of them, under
 * the spend caps as before.
 */
export async function runIdeaCycle(deps: IdeaCycleDeps): Promise<IdeaCycleResult> {
  const { db } = deps;
  // Where the hub records Promote / Pin / Drag / Archive: the main database when the worker passes it (the explainers handle may be
  // a database of its own), else this one. A read that fails is no moves, so the night runs as before.
  const movesQ: MovesQuery = deps.moves ?? movesQuery(db);
  const movesReadAt = new Date();
  const settings = await loadSettings(db);
  if (!settings.auto_render) return { status: 'skipped', reason: 'auto_render_off' };

  const day = nyDate(deps.now);
  const fillLog = deps.log ?? consoleFillLog;
  // A failed read of the placements never stops the night: it fills the whole quota, as before the rule.
  const fill = await dailyFillOrQuota(spineOf(db), 'explainers', day, await explainersQuota(db, day), (error) =>
    fillLog('fill_failed', { vertical: 'explainers', nyDate: day, error: error instanceof Error ? error.message : String(error) }),
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
    `INSERT INTO explainers.idea_cycles (status, mode, ny_date)
     VALUES ('running', $1, $2::date)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [settings.mode, day],
  );
  const cycleId = rows[0]?.id;
  if (!cycleId) return { status: 'skipped', reason: 'already_ran_today' };

  try {
    const moves = await readPoolMoves(movesQ);
    const archived = await archivedTopics(db, moves);
    const themeBrief = await loadThemeBrief(db, settings.theme_brief_version);
    const pool = await listPool(db);
    const rendered = [...(await listRecentlyRendered(db, settings.dedupe_lookback_days, deps.now)), ...archived];

    const response = await deps.ideaModel.propose({
      model: settings.idea_model,
      themeBrief,
      pool: pool.map(topicRef),
      rendered: rendered.map(topicRef),
    });
    const buckets = response.usage;
    await recordCost(db, {
      ideaCycleId: cycleId,
      mode: settings.mode,
      vendor: 'anthropic',
      component: 'idea_generator',
      inputTokens: Number(buckets.input_tokens ?? 0),
      outputTokens: Number(buckets.output_tokens ?? 0),
      cacheReadTokens: Number(buckets.cache_read_input_tokens ?? 0),
      cacheWriteTokens: Number(buckets.cache_creation_input_tokens ?? 0),
      usd: ideaUsd(response),
    });

    const added = await addTopics(
      db,
      response.ideas.map((idea) => ({
        title: idea.topic_title,
        scope: idea.topic_scope,
        term: idea.term,
        origin: 'generated' as const,
      })),
    );
    await db.query('UPDATE explainers.topics SET idea_cycle_id = $1 WHERE id = ANY($2::uuid[])', [
      cycleId,
      added.map((t) => t.id),
    ]);

    const jev = new RecordingExplainersJevRunner(deps.jevTransport, db, {
      mode: settings.mode,
      ideaCycleId: cycleId,
    });
    const evaluations: Evaluation[] = [];
    for (const topic of added) {
      evaluations.push(
        await evaluateTopic({ db, jev, settings, themeBrief, now: deps.now, ideaModel: deps.ideaModel, ideaCycleId: cycleId, extraHistory: archived }, topic.id),
      );
    }
    await trimPool(db, settings.pool_size, heldTopicIds(moves));

    // Daily fill (D54): the top `quota − placed` candidates, fresh topics and surviving renders ranked together.
    // A surviving render is placed, not rendered again; at most `daily_render_cap` pool topics are rendered
    // (SH-49: two a day), and requestRender still enforces both caps.
    const approvalNeeded = await requireApproval(db);
    const candidates = await fillCandidates(db, approvalNeeded, moves);
    // A pin that can no longer be made (not a pool topic or a placeable render any more) steps aside with why on the move; the
    // rest of the queue goes on. Never blocks the night.
    const makeable = new Set(candidates.map((c) => ideaOfTopic(c.topicId)));
    for (const pin of tonightMoves(moves, 'explainers').pins) {
      if (!makeable.has(pin.ideaId)) await recordPromoteSkip(movesQ, 'explainers', pin.ideaId, EXPLAINER_GONE);
    }
    const chosen = candidates.slice(0, fill.making);
    const handMoved = new Set(moves.filter((m) => m.kind === 'pin' || m.kind === 'promote' || m.kind === 'place').map((m) => m.ideaId));
    const renderCap = Math.max(1, settings.daily_render_cap);
    const live = await publishingLive(db);
    const renders: string[] = [];
    const allocated: Allocation[] = [];
    let best: string | null = null;
    let render: RenderRequest | null = null;
    let capped = false;
    for (const candidate of chosen) {
      if (candidate.jobId) {
        const scheduled = live ? await scheduleJob(db, candidate.jobId, 'auto', deps.now ?? new Date()) : null;
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
      const requested = await requestRender(db, { topicId: candidate.topicId, trigger: 'auto', settings, now: deps.now });
      render ??= requested;
      if (!requested.ok) capped = true;
      if (handMoved.has(ideaOfTopic(candidate.topicId))) {
        if (requested.ok) await markPromoteUsed(movesQ, 'explainers', ideaOfTopic(candidate.topicId));
        // A render that doesn't start caps the night, so no other topic is tried. That is transient: no skip is
        // recorded, so the pin stays active for next night.
        else console.info(`[explainers] ${candidate.topicId} not rendered tonight (${requested.reason.replace(/_/g, ' ')}); kept for next night`);
      }
    }
    // The night ran with auto-render on and made its picks: hand placements are used up and the ideas compete by score
    // again (a failed run never reaches here, so a hand move is not undone by a night that did nothing for it).
    // A night that was capped left ideas it chose unmade: their placements stay for the next night.
    if (!capped) await finishNightPlacements(movesQ, 'explainers', undefined, movesReadAt);

    await db.query(
      `UPDATE explainers.idea_cycles c
          SET status = 'ok', finished_at = now(),
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
        added.length,
        evaluations.filter(survivedDedupe).length,
        evaluations.filter(enteredPool).length,
        best,
      ],
    );
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
    topics.map((topic, i) => ({ ...topic, title: titles[i], scope: written.scopes[i], term: written.terms[i] })),
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
