import type { Queryable } from '@/lib/explainers/db';
import { enteredPool, evaluateStory, type StoryEvaluation } from '@/lib/real-case/evaluate';
import { RecordingRealCaseJevRunner } from '@/lib/real-case/jev/runner';
import {
  addStory,
  cycleSpend,
  finishCycle,
  finishScout,
  getSeedTopic,
  pickSeedTopics,
  recordRealCaseCost,
  setStoryStatus,
  startCycle,
  startScout,
  trimStoryPool,
} from '@/lib/real-case/repository';
import { ScoutError, STORY_SCOUT_VERSION, type StoryScout } from '@/lib/real-case/scout';
import type { MessageUsageLike } from '@/lib/anthropic-pricing';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import { loadRealCaseSettings, type RealCaseSettings } from '@/lib/real-case/settings';
import type { PageFetcher } from '@/lib/real-case/source-check';
import type { Mode, ScoutOutcome, SeedTopic } from '@/lib/real-case/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

/**
 * The story cycle (RC-02, RC-03, RC-11). Explainer topics inspire the search (read only); stories are
 * scouted, checked, scored and ranked in this route's own pool; topics whose stories are weak are
 * ignored here for the cooldown. Nothing here writes to an Explainer table (RC-01).
 */

export type StoryCycleDeps = {
  db: Queryable;
  scout: StoryScout;
  jevTransport: JevTransport;
  fetcher?: PageFetcher;
  now?: Date;
};

export type TopicScoutResult = {
  topicId: string;
  title: string;
  outcome: Exclude<ScoutOutcome, 'running'>;
  evaluations: { storyId: string; title: string; evaluation: StoryEvaluation }[];
  /** Stories the scout returned that were set aside for a structural fault. */
  dropped: { title: string; why: string }[];
  usd: number;
  error?: string;
};

type ScoutSpend = { usd: number; webSearches: number; usages: MessageUsageLike[] };

export type StoryCycleResult =
  | { status: 'skipped'; reason: 'auto_scout_off' | 'already_ran_today' | 'no_topics' }
  | { status: 'ok'; cycleId: string; topics: TopicScoutResult[]; capped: boolean; usd: number }
  | { status: 'failed'; cycleId: string; error: string };

/**
 * Search one topic and take its stories through the evaluation. A failed scout turn is recorded
 * (outcome `failed`, its spend kept) and never throws, so one topic can't stop the cycle.
 */
export async function scoutTopic(
  deps: StoryCycleDeps,
  ctx: { settings: RealCaseSettings; mode: Mode; cycleId: string },
  topic: SeedTopic,
): Promise<TopicScoutResult> {
  const { db } = deps;
  const scoutId = await startScout(db, topic, ctx.cycleId);
  const base = { topicId: topic.id, title: topic.title, evaluations: [] as TopicScoutResult['evaluations'], dropped: [] as TopicScoutResult['dropped'] };
  const cost = async (component: string, spend: ScoutSpend) => {
    const sum = (key: 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens') =>
      spend.usages.reduce((n, u) => n + Number(u.usage[key] ?? 0), 0);
    await recordRealCaseCost(db, {
      cycleId: ctx.cycleId,
      mode: ctx.mode,
      vendor: 'anthropic',
      component,
      inputTokens: sum('input_tokens'),
      outputTokens: sum('output_tokens'),
      cacheReadTokens: sum('cache_read_input_tokens'),
      cacheWriteTokens: sum('cache_creation_input_tokens'),
      webSearches: spend.webSearches,
      usd: spend.usd,
    });
  };

  let scouted;
  try {
    scouted = await deps.scout.scout({ model: ctx.settings.scout_model, topic, storiesPerTopic: ctx.settings.stories_per_topic });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ScoutError) await cost('story_scout', error.spend);
    await finishScout(db, scoutId, { outcome: 'failed', storiesFound: 0, error: message });
    return { ...base, outcome: 'failed', usd: error instanceof ScoutError ? error.spend.usd : 0, error: message };
  }
  await cost('story_scout', scouted);

  const jev = new RecordingRealCaseJevRunner(deps.jevTransport, db, { mode: ctx.mode, cycleId: ctx.cycleId });
  const evaluations: TopicScoutResult['evaluations'] = [];
  for (const s of scouted.stories) {
    const row = await addStory(db, { topicId: topic.id, scoutId, cycleId: ctx.cycleId, ...s });
    await db.query(`UPDATE real_case.stories SET jev_notes = jev_notes || $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ scout_version: STORY_SCOUT_VERSION })]);
    try {
      evaluations.push({ storyId: row.id, title: row.title, evaluation: await evaluateStory({ db, jev, fetcher: deps.fetcher, lookbackDays: ctx.settings.dedupe_lookback_days, now: deps.now }, row.id) });
    } catch (error) {
      // A story whose evaluation broke (a Jev outage, say) stays out of the pool; the rest go on.
      await setStoryStatus(db, row.id, 'rejected', { reason: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const scores = evaluations.map((e) => ('score' in e.evaluation ? e.evaluation.score : null)).filter((n): n is number => n !== null);
  const outcome: TopicScoutResult['outcome'] = scouted.stories.length === 0 ? 'none' : evaluations.some((e) => enteredPool(e.evaluation)) ? 'found' : 'weak';
  await finishScout(db, scoutId, { outcome, storiesFound: scouted.stories.length, bestScore: scores.length ? Math.max(...scores) : null });
  return { ...base, outcome, evaluations, dropped: scouted.dropped, usd: scouted.usd };
}

/**
 * The nightly cycle (RC-11): off unless `auto_scout`, once per New York day, `topics_per_night`
 * topics, and no new topic once the cycle's spend reaches `nightly_cap_usd` (a topic already
 * started finishes, so the cap can be passed by up to one topic's cost; a cap of 0 searches none).
 */
export async function runStoryCycle(deps: StoryCycleDeps): Promise<StoryCycleResult> {
  const { db } = deps;
  await ensureRealCaseSchema(db);
  const settings = await loadRealCaseSettings(db);
  if (!settings.auto_scout) return { status: 'skipped', reason: 'auto_scout_off' };
  const seeds = await pickSeedTopics(db, { limit: settings.topics_per_night, cooldownDays: settings.scout_cooldown_days, now: deps.now });
  if (seeds.length === 0) return { status: 'skipped', reason: 'no_topics' };
  const cycleId = await startCycle(db, { mode: settings.mode, trigger: 'auto', now: deps.now });
  if (!cycleId) return { status: 'skipped', reason: 'already_ran_today' };
  return runTopics(deps, settings, cycleId, seeds, settings.nightly_cap_usd);
}

/** Lucas's Find stories click on one topic (RC-10): his click authorizes that one search, auto or not. */
export async function findStoriesForTopic(deps: StoryCycleDeps, topicId: string): Promise<StoryCycleResult> {
  const { db } = deps;
  await ensureRealCaseSchema(db);
  const settings = await loadRealCaseSettings(db);
  const topic = await getSeedTopic(db, topicId);
  if (!topic || topic.status === 'archived') return { status: 'skipped', reason: 'no_topics' };
  const cycleId = (await startCycle(db, { mode: settings.mode, trigger: 'click', now: deps.now }))!;
  return runTopics(deps, settings, cycleId, [topic], Infinity);
}

async function runTopics(deps: StoryCycleDeps, settings: RealCaseSettings, cycleId: string, seeds: SeedTopic[], capUsd: number): Promise<StoryCycleResult> {
  const { db } = deps;
  try {
    const ctx = { settings, mode: settings.mode, cycleId };
    const topics: TopicScoutResult[] = [];
    let capped = false;
    for (const seed of seeds) {
      if ((await cycleSpend(db, cycleId)) >= capUsd) {
        capped = true;
        break;
      }
      topics.push(await scoutTopic(deps, ctx, seed));
    }
    await trimStoryPool(db, settings.pool_size);
    await finishCycle(db, cycleId, { status: 'ok' });
    return { status: 'ok', cycleId, topics, capped, usd: await cycleSpend(db, cycleId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishCycle(db, cycleId, { status: 'failed', error: message });
    return { status: 'failed', cycleId, error: message };
  }
}

/**
 * Re-run the evaluation of stories already found (the source check, the gates, the scores, the
 * duplicate checks), with no new search: for a story the source check failed for a reason on our side
 * (a page too large, a rate limit), fixed since. Jev's calls are the only spend.
 */
export async function recheckStories(deps: Omit<StoryCycleDeps, 'scout'>, storyIds: readonly string[]): Promise<{ storyId: string; evaluation: StoryEvaluation }[]> {
  const { db } = deps;
  await ensureRealCaseSchema(db);
  const settings = await loadRealCaseSettings(db);
  const jev = new RecordingRealCaseJevRunner(deps.jevTransport, db, { mode: settings.mode });
  const out: { storyId: string; evaluation: StoryEvaluation }[] = [];
  for (const id of storyIds) {
    await db.query(`UPDATE real_case.stories SET status = 'proposed', reject_reason = NULL, duplicate_of = NULL, updated_at = now() WHERE id = $1`, [id]);
    out.push({ storyId: id, evaluation: await evaluateStory({ db, jev, fetcher: deps.fetcher, lookbackDays: settings.dedupe_lookback_days, now: deps.now }, id) });
  }
  await trimStoryPool(db, settings.pool_size);
  return out;
}
