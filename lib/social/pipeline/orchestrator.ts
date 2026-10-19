/**
 * Helios Social rebuild — day orchestrator (spec §3, §2.4, §5B).
 *
 *   Jev scoring → Reporter → Writer → Editor → captioner → Fact-checker →
 *   mechanical → design
 *
 * Each stage runs once. A stage that fails sets the story aside (logged
 * with stage + reason) and the next-ranked story takes the slot, until the
 * day's posts are done, the stories run out, or the cost cap is hit.
 *
 * Glitch retries (§7.1) live inside each stage (one retry on a failed
 * code check); fresh drafts (§4.2b) and fresh captions loop here. A fresh
 * caption (the Fact-checker cut the caption or the builder's read to
 * nothing) reruns only captioner → Fact-checker, MAX_FRESH_CAPTIONS times
 * per draft; after that it counts as a fresh draft.
 *
 * A story that already has a finished post (SH-60, P2-M4) is not run again:
 * when `stored` finds one, the story keeps its rank and counts toward the
 * day's posts with no stage run and no spend; its stored post is shipped.
 *
 * A story whose content is already on the calendar (`onCalendar`: a slot
 * waiting or posting, e.g. one a person placed) is passed over: it neither
 * runs nor counts toward the target, because the daily fill (D54) already
 * counted a person's placement for the day, and a slot on another day isn't
 * today's post.
 */
import type { CostMeter } from './cost-meter';
import type { SetAsideEntry, SetAsideLog } from './set-aside-log';
import type { PipelineStages } from './stages';
import type { IngestArticle } from '@/lib/social/ingest/select/types';

import type { Draft, PostObject, ScoredCandidate, StageName, StageResult } from './types';

export const DEFAULT_TARGET_POSTS = 2;

/** Spec §4.2b: at most 2 fresh drafts per story, then the next story. */
export const MAX_FRESH_DRAFTS = 2;

/** Social-captions redesign (2026-10-19): one caption-only rerun per draft, then the fresh-draft path. */
export const MAX_FRESH_CAPTIONS = 1;

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
  /** The finished post already stored for a story, if any (SH-60). Omitted: every story runs. */
  stored?: (storyId: string) => Promise<string | null>;
  /** True when the story's content already holds a slot (daily fill, D54). Omitted: no story is passed over. */
  onCalendar?: (storyId: string) => Promise<boolean>;
};

/** One shipped story, in rank order: a post made today, or a stored post reused. */
export type ShipEntry = { storyId: string; reusedPostId: string | null };

export type RunDayResult = {
  posts: PostObject[];
  setAsides: SetAsideEntry[];
  stopReason: StopReason;
  costUsd: number;
  costByStage: Partial<Record<StageName, number>>;
  /** Every fresh draft and why it was needed (spec §4.2b: logged). */
  freshDrafts: FreshDraftEntry[];
  /** Every caption-only rerun and why; `attempt` counts within one draft. */
  freshCaptions: FreshDraftEntry[];
  /** What the day ships, best-ranked story first. */
  shipped: ShipEntry[];
  /** Stories passed over because their content is already on the calendar (D54), in rank order. */
  onCalendar: string[];
};

class SetAside extends Error {
  constructor(readonly entry: SetAsideEntry) {
    super(`${entry.stage}: ${entry.reasonCode}`);
  }
}

class CostCapReached extends Error {}

/** The Fact-checker asked for a fresh draft; not logged as a set-aside. */
class FreshDraftNeeded extends Error {}

/** The Fact-checker asked for a fresh caption only; not logged as a set-aside. */
class FreshCaptionNeeded extends Error {}

export async function runDay(input: RunDayInput): Promise<RunDayResult> {
  const { stages, meter, log, now } = input;
  const target = input.targetPosts ?? DEFAULT_TARGET_POSTS;
  const posts: PostObject[] = [];
  const setAsides: SetAsideEntry[] = [];
  const freshDrafts: FreshDraftEntry[] = [];
  const freshCaptions: FreshDraftEntry[] = [];
  const shipped: ShipEntry[] = [];
  const onCalendar: string[] = [];

  const finish = (stopReason: StopReason): RunDayResult => ({
    posts,
    setAsides,
    stopReason,
    costUsd: meter.spent(),
    costByStage: meter.byStage(),
    freshDrafts,
    freshCaptions,
    shipped,
    onCalendar,
  });

  const logCap = async (storyId: string, stage: StageName) => {
    setAsides.push(
      await log.record(
        {
          storyId,
          stage,
          reasonCode: 'cost-cap',
          detail: meter.capReached() && meter.ceilingUsd > meter.capUsd
            ? `ceiling $${meter.ceilingUsd.toFixed(2)} (cap $${meter.capUsd.toFixed(2)} + wiggle) reached mid-story ($${meter.spent().toFixed(4)} spent)`
            : `daily cap $${meter.capUsd.toFixed(2)} reached ($${meter.spent().toFixed(4)} spent)`,
        },
        now,
      ),
    );
  };

  /** Run one stage: check the cap, charge its cost, unwrap or throw.
   *  Scoring and a story's Reporter start new work: they stop at the target. A story's
   *  later stages finish what it started: they stop only at the ceiling (cost-meter.ts). */
  async function step<T>(
    storyId: string,
    stage: StageName,
    trail: StageName[] | null,
    run: () => Promise<StageResult<T>>,
  ): Promise<{ value: T; costUsd: number }> {
    const startsNew = stage === 'jev-scoring' || stage === 'reporter';
    if (startsNew ? meter.targetReached() : meter.capReached()) throw new CostCapReached(stage);
    const res = await run();
    meter.charge(stage, res.costUsd);
    trail?.push(stage);
    if (!res.ok) {
      if (res.reasonCode === 'needs-fresh-draft') throw new FreshDraftNeeded(res.detail);
      if (res.reasonCode === 'needs-fresh-caption') throw new FreshCaptionNeeded(res.detail);
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
    if (shipped.length >= target) return finish('target-reached');
    if (input.onCalendar && (await input.onCalendar(story.id))) {
      onCalendar.push(story.id);
      continue;
    }
    const reused = input.stored ? await input.stored(story.id) : null;
    if (reused) {
      shipped.push({ storyId: story.id, reusedPostId: reused });
      continue;
    }
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
      // Captioner → Fact-checker on the edited draft; a fresh caption reruns just these two,
      // up to MAX_FRESH_CAPTIONS times, then asks for a fresh draft.
      const captionAndCheck = async (edited: Draft): Promise<Draft> => {
        for (let attempt = 0; ; attempt++) {
          const captioned = await run('captioner', () => stages.caption(edited, brief));
          try {
            return await run('fact-checker', () => stages.factCheck(captioned, brief));
          } catch (err) {
            if (!(err instanceof FreshCaptionNeeded)) throw err;
            if (attempt >= MAX_FRESH_CAPTIONS) throw new FreshDraftNeeded(`fresh caption limit (${MAX_FRESH_CAPTIONS}) used; last: ${err.message}`);
            freshCaptions.push({ storyId: story.id, attempt: attempt + 1, detail: err.message, at: now.toISOString() });
          }
        }
      };
      // Writer → Editor → captioner → Fact-checker, once; up to MAX_FRESH_DRAFTS fresh drafts
      // from the same brief, with no notes fed back (spec §4.2b).
      let checked!: Draft;
      for (let attempt = 0; ; attempt++) {
        try {
          const written = await run('writer', () => stages.write(brief));
          const edited = await run('editor', () => stages.edit(written, brief));
          checked = await captionAndCheck(edited);
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
      shipped.push({ storyId: story.id, reusedPostId: null });
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

  return finish(shipped.length >= target ? 'target-reached' : 'out-of-stories');
}
