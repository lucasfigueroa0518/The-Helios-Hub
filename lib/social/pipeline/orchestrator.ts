/**
 * Helios Social rebuild — day orchestrator (spec §3, §2.4, §5B).
 *
 *   Jev scoring → Reporter → Writer → Editor → [Hook pass, when on] → Fact-checker → mechanical → design
 *
 * Each stage runs once. A stage that fails sets the story aside (logged
 * with stage + reason) and the next-ranked story takes the slot, until the
 * day's posts are done, the stories run out, or the cost cap is hit.
 *
 * Glitch retries (§7.1) live inside each stage (one retry on a failed
 * code check); fresh drafts (§4.2b) loop here.
 */
import type { CostMeter } from './cost-meter';
import type { SetAsideEntry, SetAsideLog } from './set-aside-log';
import type { PipelineStages } from './stages';
import type { IngestArticle } from '@/lib/social/ingest/select/types';

import type { Draft, PostObject, ScoredCandidate, StageName, StageResult } from './types';

export const DEFAULT_TARGET_POSTS = 2;

/** Spec §4.2b: at most 2 fresh drafts per story, then the next story. */
export const MAX_FRESH_DRAFTS = 2;

export type FreshDraftEntry = { storyId: string; attempt: number; detail: string; at: string };

/** storyId used for log entries that concern the whole day, not one story. */
export const DAY_SCOPE_ID = '*';

export type StopReason = 'target-reached' | 'out-of-stories' | 'cost-cap' | 'scoring-failed';

export type RunDayInput = {
  /** The day's fetched feed articles; selection groups and ranks them. */
  articles: IngestArticle[];
  stages: PipelineStages;
  meter: CostMeter;
  log: SetAsideLog;
  now: Date;
  targetPosts?: number;
};

export type RunDayResult = {
  posts: PostObject[];
  setAsides: SetAsideEntry[];
  stopReason: StopReason;
  costUsd: number;
  costByStage: Partial<Record<StageName, number>>;
  /** Every fresh draft and why it was needed (spec §4.2b: logged). */
  freshDrafts: FreshDraftEntry[];
};

class SetAside extends Error {
  constructor(readonly entry: SetAsideEntry) {
    super(`${entry.stage}: ${entry.reasonCode}`);
  }
}

class CostCapReached extends Error {}

/** The Fact-checker asked for a fresh draft; not logged as a set-aside. */
class FreshDraftNeeded extends Error {}

export async function runDay(input: RunDayInput): Promise<RunDayResult> {
  const { stages, meter, log, now } = input;
  const target = input.targetPosts ?? DEFAULT_TARGET_POSTS;
  const posts: PostObject[] = [];
  const setAsides: SetAsideEntry[] = [];
  const freshDrafts: FreshDraftEntry[] = [];

  const finish = (stopReason: StopReason): RunDayResult => ({
    posts,
    setAsides,
    stopReason,
    costUsd: meter.spent(),
    costByStage: meter.byStage(),
    freshDrafts,
  });

  const logCap = async (storyId: string, stage: StageName) => {
    setAsides.push(
      await log.record(
        {
          storyId,
          stage,
          reasonCode: 'cost-cap',
          detail: `daily cap $${meter.capUsd.toFixed(2)} reached ($${meter.spent().toFixed(4)} spent)`,
        },
        now,
      ),
    );
  };

  /** Run one stage: check the cap, charge its cost, unwrap or throw. */
  async function step<T>(
    storyId: string,
    stage: StageName,
    trail: StageName[] | null,
    run: () => Promise<StageResult<T>>,
  ): Promise<{ value: T; costUsd: number }> {
    if (meter.capReached()) throw new CostCapReached(stage);
    const res = await run();
    meter.charge(stage, res.costUsd);
    trail?.push(stage);
    if (!res.ok) {
      if (res.reasonCode === 'needs-fresh-draft') throw new FreshDraftNeeded(res.detail);
      const entry = await log.record(
        { storyId, stage, reasonCode: res.reasonCode, detail: res.detail },
        now,
      );
      throw new SetAside(entry);
    }
    return { value: res.value, costUsd: res.costUsd };
  }

  // ── Jev scoring ──────────────────────────────────────────────────────
  let ranked: ScoredCandidate[];
  try {
    ranked = (await step(DAY_SCOPE_ID, 'jev-scoring', null, () => stages.score(input.articles, now))).value;
  } catch (err) {
    if (err instanceof SetAside) {
      setAsides.push(err.entry);
      return finish('scoring-failed');
    }
    if (err instanceof CostCapReached) {
      await logCap(DAY_SCOPE_ID, 'jev-scoring');
      return finish('cost-cap');
    }
    throw err;
  }
  ranked = [...ranked].sort((a, b) => b.score - a.score);

  // ── One story at a time, in rank order ──────────────────────────────
  for (const story of ranked) {
    if (posts.length >= target) return finish('target-reached');
    const trail: StageName[] = ['jev-scoring'];
    let storyCost = 0;
    let current: StageName = 'reporter';
    const run = async <T>(stage: StageName, fn: () => Promise<StageResult<T>>): Promise<T> => {
      current = stage;
      const r = await step(story.id, stage, trail, fn);
      storyCost += r.costUsd;
      return r.value;
    };
    try {
      const brief = await run('reporter', () => stages.report(story));
      // Writer → Editor → Fact-checker, once; up to MAX_FRESH_DRAFTS fresh drafts
      // from the same brief, with no notes fed back (spec §4.2b).
      let checked!: Draft;
      for (let attempt = 0; ; attempt++) {
        try {
          const written = await run('writer', () => stages.write(brief));
          const edited = await run('editor', () => stages.edit(written, brief));
          // Hook pass only when the run switched it on (prototype, Tommy 2026-10-06).
          const hooked = stages.hook ? await run('hook', () => stages.hook!(edited, brief)) : edited;
          checked = await run('fact-checker', () => stages.factCheck(hooked, brief));
          break;
        } catch (err) {
          if (!(err instanceof FreshDraftNeeded)) throw err;
          if (attempt >= MAX_FRESH_DRAFTS) {
            const entry = await log.record(
              { storyId: story.id, stage: 'fact-checker', reasonCode: 'unfixable-draft', detail: `${MAX_FRESH_DRAFTS} fresh drafts used; last: ${err.message}` },
              now,
            );
            throw new SetAside(entry);
          }
          freshDrafts.push({ storyId: story.id, attempt: attempt + 1, detail: err.message, at: now.toISOString() });
        }
      }
      const fixed = await run('mechanical', () => stages.mechanical(checked, brief));
      const designed = await run('design', () => stages.design(fixed, brief, story));
      posts.push({ ...designed, stages: trail, costUsd: storyCost });
    } catch (err) {
      if (err instanceof SetAside) {
        setAsides.push(err.entry);
        continue;
      }
      if (err instanceof CostCapReached) {
        await logCap(story.id, current);
        return finish('cost-cap');
      }
      throw err;
    }
  }

  return finish(posts.length >= target ? 'target-reached' : 'out-of-stories');
}
