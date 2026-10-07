import type { ExplainersDb } from '@/lib/explainers/db';
import { evaluateTopic, topicRef, trimPool, type Evaluation } from '@/lib/explainers/ideas/evaluate';
import { ideaUsd, type IdeaModel } from '@/lib/explainers/ideas/generator';
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
import { loadSettings, loadThemeBrief } from '@/lib/explainers/settings';
import type { JevTransport } from '@/lib/reels/jev/runner';

export type IdeaCycleDeps = {
  db: ExplainersDb;
  ideaModel: IdeaModel;
  jevTransport: JevTransport;
  now?: Date;
};

export type IdeaCycleResult =
  | { status: 'skipped'; reason: 'auto_render_off' | 'daily_spend_cap' | 'already_ran_today' }
  | {
      status: 'ok';
      cycleId: string;
      evaluations: Evaluation[];
      promotedTopicId: string | null;
      render: RenderRequest | null;
    }
  | { status: 'failed'; cycleId: string; error: string };

function survivedDedupe(e: Evaluation): boolean {
  return e.outcome !== 'rejected_history_duplicate' && e.outcome !== 'lost_head_to_head';
}

function enteredPool(e: Evaluation): boolean {
  return e.outcome === 'entered_pool' || e.outcome === 'won_head_to_head';
}

/**
 * E-16 daily lifecycle. Runs only while auto_render is on (A-5, A-7): generate
 * three ideas in one call, dedupe and score each (E-15, A-3), trim the pool to
 * pool_size, then promote the best and queue its render. In production the
 * day's spend so far, including earlier idea runs, must be under the cap (A-4).
 */
export async function runIdeaCycle(deps: IdeaCycleDeps): Promise<IdeaCycleResult> {
  const { db } = deps;
  const settings = await loadSettings(db);
  if (!settings.auto_render) return { status: 'skipped', reason: 'auto_render_off' };

  const day = nyDate(deps.now);
  if (
    settings.mode === 'production' &&
    (await productionSpendForDay(db, day)) >= settings.daily_spend_cap_usd
  ) {
    return { status: 'skipped', reason: 'daily_spend_cap' };
  }

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
    const themeBrief = await loadThemeBrief(db, settings.theme_brief_version);
    const pool = await listPool(db);
    const rendered = await listRecentlyRendered(db, settings.dedupe_lookback_days, deps.now);

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
      evaluations.push(await evaluateTopic({ db, jev, settings, themeBrief, now: deps.now }, topic.id));
    }
    await trimPool(db, settings.pool_size);

    const [best] = await listPool(db);
    let render: RenderRequest | null = null;
    if (best) {
      await db.query(
        `UPDATE explainers.topics SET status = 'promoted', updated_at = now() WHERE id = $1`,
        [best.id],
      );
      render = await requestRender(db, { topicId: best.id, trigger: 'auto', settings, now: deps.now });
    }

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
        best?.id ?? null,
      ],
    );
    return { status: 'ok', cycleId, evaluations, promotedTopicId: best?.id ?? null, render };
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
 * every title, then each topic is scored and deduped, then the pool is
 * trimmed. Runs on his click, so these calls are his.
 */
export async function addAndEvaluateTopics(
  deps: { db: ExplainersDb; jevTransport: JevTransport; ideaModel: IdeaModel; now?: Date },
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
    topics.map((topic, i) => ({ ...topic, title: titles[i], scope: written.scopes[i] })),
  );
  const jev = new RecordingExplainersJevRunner(deps.jevTransport, db, { mode: settings.mode });
  const results: IntakeResult = [];
  for (const topic of added) {
    const evaluation = await evaluateTopic({ db, jev, settings, themeBrief, now: deps.now }, topic.id);
    results.push({ topicId: topic.id, title: topic.title, scope: topic.scope!, evaluation });
  }
  await trimPool(db, settings.pool_size);
  return results;
}
