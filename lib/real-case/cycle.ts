import type { Queryable } from '@/lib/explainers/db';
import { enteredPool, evaluateStory, type StoryEvaluation } from '@/lib/real-case/evaluate';
import { RecordingRealCaseJevRunner } from '@/lib/real-case/jev/runner';
import {
  addStory,
  cycleSpend,
  expireOldStories,
  finishCycle,
  finishScout,
  listKnownEvents,
  listLabelTopics,
  nyDate,
  recordRealCaseCost,
  setStoryStatus,
  startCycle,
  startScout,
  trimStoryPool,
} from '@/lib/real-case/repository';
import { ScoutError, STORY_SCOUT_VERSION, type LabelTopic, type StoryScout } from '@/lib/real-case/scout';
import type { MessageUsageLike } from '@/lib/anthropic-pricing';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import { loadRealCaseSettings, type RealCaseSettings } from '@/lib/real-case/settings';
import type { PageFetcher } from '@/lib/real-case/source-check';
import type { Mode, ScoutOutcome } from '@/lib/real-case/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

/**
 * The story cycle (RC-03, RC-27). Each search looks at AI news inside the window; its stories are
 * checked, scored and ranked in this route's own pool, and stories whose event has aged out of the
 * window leave it. Explainer topics are read only, as labels. Nothing here writes to an Explainer table
 * (RC-01).
 */

export type StoryCycleDeps = {
  db: Queryable;
  scout: StoryScout;
  jevTransport: JevTransport;
  fetcher?: PageFetcher;
  now?: Date;
};

export type SearchResult = {
  outcome: Exclude<ScoutOutcome, 'running'>;
  evaluations: { storyId: string; title: string; evaluation: StoryEvaluation }[];
  /** Stories the scout returned that were set aside for a structural fault. */
  dropped: { title: string; why: string }[];
  usd: number;
  error?: string;
  /** The scout's own words about what it found (or why nothing met the bar). */
  note?: string;
};

type ScoutSpend = { usd: number; webSearches: number; usages: MessageUsageLike[] };

export type StoryCycleResult =
  | { status: 'skipped'; reason: 'auto_scout_off' | 'already_ran_today' | 'no_searches' }
  | { status: 'ok'; cycleId: string; searches: SearchResult[]; capped: boolean; usd: number; expired: string[] }
  | { status: 'failed'; cycleId: string; error: string };

/** The label topics as the scout sees them: T1, T2, ... in the order listed. */
export function labelTopics(topics: readonly { id: string; title: string }[]): LabelTopic[] {
  return topics.map((t, i) => ({ key: `T${i + 1}`, id: t.id, title: t.title }));
}

/**
 * One news search, and its stories through the evaluation. A failed scout turn is recorded (outcome
 * `failed`, its spend kept) and never throws, so one search can't stop the cycle.
 */
export async function runNewsSearch(
  deps: StoryCycleDeps,
  ctx: { settings: RealCaseSettings; mode: Mode; cycleId: string },
): Promise<SearchResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const scoutId = await startScout(db, null, ctx.cycleId);
  const base = { evaluations: [] as SearchResult['evaluations'], dropped: [] as SearchResult['dropped'] };
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

  const request = {
    model: ctx.settings.scout_model,
    today: nyDate(now),
    windowDays: ctx.settings.news_window_days,
    storiesPerSearch: ctx.settings.stories_per_search,
    known: await listKnownEvents(db, ctx.settings.news_window_days, now),
    topics: labelTopics(await listLabelTopics(db)),
  };
  let scouted;
  try {
    scouted = await deps.scout.scout(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ScoutError) await cost('story_scout', error.spend);
    await finishScout(db, scoutId, { outcome: 'failed', storiesFound: 0, error: message });
    return { ...base, outcome: 'failed', usd: error instanceof ScoutError ? error.spend.usd : 0, error: message };
  }
  await cost('story_scout', scouted);

  const jev = new RecordingRealCaseJevRunner(deps.jevTransport, db, { mode: ctx.mode, cycleId: ctx.cycleId });
  const evaluations: SearchResult['evaluations'] = [];
  for (const s of scouted.stories) {
    const row = await addStory(db, { ...s, scoutId, cycleId: ctx.cycleId });
    await db.query(`UPDATE real_case.stories SET jev_notes = jev_notes || $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ scout_version: STORY_SCOUT_VERSION })]);
    try {
      evaluations.push({ storyId: row.id, title: row.title, evaluation: await evaluateStory({ db, jev, fetcher: deps.fetcher, lookbackDays: ctx.settings.dedupe_lookback_days, windowDays: ctx.settings.news_window_days, now: deps.now }, row.id) });
    } catch (error) {
      // A story whose evaluation broke (a Jev outage, say) stays out of the pool; the rest go on.
      await setStoryStatus(db, row.id, 'rejected', { reason: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const scores = evaluations.map((e) => ('score' in e.evaluation ? e.evaluation.score : null)).filter((n): n is number => n !== null);
  const outcome: SearchResult['outcome'] = scouted.stories.length === 0 ? 'none' : evaluations.some((e) => enteredPool(e.evaluation)) ? 'found' : 'weak';
  await finishScout(db, scoutId, { outcome, storiesFound: scouted.stories.length, bestScore: scores.length ? Math.max(...scores) : null });
  return { ...base, outcome, evaluations, dropped: scouted.dropped, usd: scouted.usd, note: scouted.note };
}

/**
 * The nightly cycle (RC-11, RC-27): off unless `auto_scout`, once per New York day,
 * `searches_per_night` news searches, and no new search once the cycle's spend reaches
 * `nightly_cap_usd` (a search already started finishes, so the cap can be passed by up to one search's
 * cost; a cap of 0 searches none).
 */
export async function runStoryCycle(deps: StoryCycleDeps): Promise<StoryCycleResult> {
  const { db } = deps;
  await ensureRealCaseSchema(db);
  const settings = await loadRealCaseSettings(db);
  if (!settings.auto_scout) return { status: 'skipped', reason: 'auto_scout_off' };
  if (settings.searches_per_night < 1) return { status: 'skipped', reason: 'no_searches' };
  const cycleId = await startCycle(db, { mode: settings.mode, trigger: 'auto', now: deps.now });
  if (!cycleId) return { status: 'skipped', reason: 'already_ran_today' };
  return runSearches(deps, settings, cycleId, settings.searches_per_night, settings.nightly_cap_usd);
}

/** Lucas's Find stories click (RC-10): his click authorizes that one search, auto or not. */
export async function findNewsStories(deps: StoryCycleDeps): Promise<StoryCycleResult> {
  const { db } = deps;
  await ensureRealCaseSchema(db);
  const settings = await loadRealCaseSettings(db);
  const cycleId = (await startCycle(db, { mode: settings.mode, trigger: 'click', now: deps.now }))!;
  return runSearches(deps, settings, cycleId, 1, Infinity);
}

async function runSearches(deps: StoryCycleDeps, settings: RealCaseSettings, cycleId: string, count: number, capUsd: number): Promise<StoryCycleResult> {
  const { db } = deps;
  try {
    const ctx = { settings, mode: settings.mode, cycleId };
    const expired = await expireOldStories(db, settings.news_window_days, deps.now);
    const searches: SearchResult[] = [];
    let capped = false;
    for (let i = 0; i < count; i += 1) {
      if ((await cycleSpend(db, cycleId)) >= capUsd) {
        capped = true;
        break;
      }
      searches.push(await runNewsSearch(deps, ctx));
    }
    await trimStoryPool(db, settings.pool_size, null, { windowDays: settings.news_window_days, now: deps.now });
    await finishCycle(db, cycleId, { status: 'ok' });
    return { status: 'ok', cycleId, searches, capped, usd: await cycleSpend(db, cycleId), expired };
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
    out.push({ storyId: id, evaluation: await evaluateStory({ db, jev, fetcher: deps.fetcher, lookbackDays: settings.dedupe_lookback_days, windowDays: settings.news_window_days, now: deps.now }, id) });
  }
  await trimStoryPool(db, settings.pool_size, null, { windowDays: settings.news_window_days, now: deps.now });
  return out;
}
