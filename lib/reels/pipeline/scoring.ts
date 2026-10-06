import { SCORING_PASS_1 } from '@/lib/reels/jev/questions/scoring-pass1';
import { SCORING_PASS_2 } from '@/lib/reels/jev/questions/scoring-pass2';
import type { JevRunner } from '@/lib/reels/jev/runner';
import {
  candidateOrigins,
  carryoverMisses,
  heldFromCarryover,
  earlierNyDateKey,
  nyDateKey,
  previousNyDateKey,
  rankForSlate,
  selectTopThree,
  type RankedIdea,
} from '@/lib/reels/scoring/decide';
import { applyPass2, interpretPass1, type InterpretedScore } from '@/lib/reels/scoring/interpret';
import { buildPass1State, buildPass2State } from '@/lib/reels/scoring/state';
import { rerankSlate } from '@/lib/reels/locks';
import { errorText, guardItem } from '@/lib/reels/pipeline/guard';
import {
  insertSlate,
  listTimelyIdeas,
  loadIdeaMaterial,
  loadSlateRanked,
  slateIdeaIds,
  type IdeaMaterial,
  type ScoreInsert,
} from '@/lib/reels/scoring/store';

export type ScoringSummary = {
  slateId: string | null;
  scored: number;
  selected: number;
  carryovers: number;
  /** One idea threw. The rest of the slate is still scored. */
  failures: string[];
};

export type RescoreSummary = Omit<ScoringSummary, 'slateId'> & {
  /** A rescore that returns has a new slate. An empty score set throws instead. */
  slateId: string;
  /** New top 3, best first. */
  selectedIds: string[];
  failed: number;
};

/** How many ideas score at once on a rescore. The nightly run stays one at a time. */
const RESCORE_CONCURRENCY = 4;

/** Pass 1, then pass 2 when a framework and a bucket both survive. */
export async function scoreOneIdea(
  runId: string,
  jev: JevRunner,
  idea: IdeaMaterial,
): Promise<InterpretedScore> {
  const pass1 = await jev.ask({
    component: 'scoring-pass1',
    state: buildPass1State(idea.members),
    sets: [SCORING_PASS_1],
    questions: SCORING_PASS_1.questions,
    runId,
    postIdeaId: idea.id,
  });
  let result = interpretPass1(pass1.answers);
  if (result.chosenBucket && result.chosenFramework) {
    const pass2 = await jev.ask({
      component: 'scoring-pass2',
      state: buildPass2State(idea.members, result.chosenFramework, result.chosenBucket),
      sets: [SCORING_PASS_2],
      questions: SCORING_PASS_2.questions,
      runId,
      postIdeaId: idea.id,
    });
    result = applyPass2(result, pass2.answers);
  }
  return result;
}

/**
 * Score tonight's timely ideas and the carryover window, then keep the top 3
 * (D-080, D-227). The window is yesterday's 20 best misses. A miss from two
 * days ago joins when its stored net lands in the first 10. A same-day rerun
 * re-scores today's earlier slate instead of carrying from it. Question sets
 * P-08 and P-09 are approved.
 */
export async function scoreRun(
  runId: string,
  runStartedAt: Date,
  jev: JevRunner,
): Promise<ScoringSummary> {
  const today = nyDateKey(runStartedAt);
  const yesterday = previousNyDateKey(runStartedAt);
  const twoDaysAgo = earlierNyDateKey(runStartedAt, 2);

  const [timely, sameDayIds, yesterdayRanked, olderRanked] = await Promise.all([
    listTimelyIdeas(),
    slateIdeaIds(today),
    loadSlateRanked(yesterday),
    loadSlateRanked(twoDaysAgo),
  ]);

  const selectedYesterday = heldFromCarryover(yesterdayRanked);
  const selectedTwoDaysAgo = heldFromCarryover(olderRanked);
  const misses = carryoverMisses(
    yesterdayRanked,
    selectedYesterday,
    olderRanked,
    selectedTwoDaysAgo,
  );
  const origins = candidateOrigins({
    timelyIds: timely.map((idea) => idea.id),
    sameDayIds,
    carryoverIds: misses.map((idea) => idea.id),
  });

  const material = await loadIdeaMaterial([...origins.keys()]);
  const interpreted = new Map<string, InterpretedScore>();
  const failures: string[] = [];

  for (const idea of material) {
    const headline = idea.members[0]?.headline ?? idea.id;
    const failure = await guardItem(headline, async () => {
      interpreted.set(idea.id, await scoreOneIdea(runId, jev, idea));
    });
    if (failure) failures.push(failure);
  }

  const scoredMaterial = material.filter((idea) => interpreted.has(idea.id));
  if (scoredMaterial.length === 0 && failures.length > 0) {
    return { slateId: null, scored: 0, selected: 0, carryovers: 0, failures };
  }

  const ranked: RankedIdea[] = scoredMaterial.map((idea) => {
    const result = interpreted.get(idea.id);
    return {
      id: idea.id,
      net: result?.net ?? null,
      bucketScore: result?.bucketScore ?? 0,
      psychologyScore: result?.psychologyTerm ?? 0,
      lastJoinedMs: idea.lastJoinedMs,
      confidence: result?.bucketConfidence ?? 0,
    };
  });
  const order = rankForSlate(ranked);
  const selected = new Set(selectTopThree(ranked).map((idea) => idea.id));
  const rankOf = new Map(order.map((idea, index) => [idea.id, index + 1]));

  const scores: ScoreInsert[] = scoredMaterial.map((idea) => ({
    postIdeaId: idea.id,
    origin: origins.get(idea.id) ?? 'timely',
    interpreted: interpreted.get(idea.id) as InterpretedScore,
    rank: rankOf.get(idea.id) ?? null,
    selected: selected.has(idea.id),
  }));

  const slateId = await insertSlate({
    runId,
    nyDate: today,
    pass1Version: SCORING_PASS_1.version,
    pass2Version: SCORING_PASS_2.version,
    scores,
  });
  await rerankSlate(slateId, today);

  return {
    slateId,
    scored: scores.length,
    selected: selected.size,
    carryovers: scores.filter((score) => score.origin === 'carryover').length,
    failures,
  };
}

/**
 * Score the ideas already on one slate again, and store the result as a new
 * slate for the same New York date. The earlier slate is left as it is.
 * Ideas that fail to score stay on the old slate only.
 */
export async function rescoreIdeas(
  runId: string,
  nyDate: string,
  ideas: ReadonlyArray<{ id: string; origin: 'timely' | 'carryover' }>,
  jev: JevRunner,
): Promise<RescoreSummary> {
  const material = await loadIdeaMaterial(ideas.map((idea) => idea.id));
  const originOf = new Map(ideas.map((idea) => [idea.id, idea.origin]));
  const interpreted = new Map<string, InterpretedScore>();
  const failures: string[] = [];
  let failed = 0;
  let done = 0;

  await mapPool(material, RESCORE_CONCURRENCY, async (idea) => {
    try {
      const result = await scoreOneIdea(runId, jev, idea);
      interpreted.set(idea.id, result);
      done += 1;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          component: 'reels-rescore',
          message: 'scored',
          done,
          of: material.length,
          net: result.net,
          bucket: result.chosenBucket,
          headline: idea.members[0]?.headline ?? '',
        }),
      );
    } catch (error) {
      failed += 1;
      failures.push(`${idea.members[0]?.headline ?? idea.id}: ${errorText(error)}`);
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          component: 'reels-rescore',
          message: 'idea_failed',
          postIdeaId: idea.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  const ranked: RankedIdea[] = material
    .filter((idea) => interpreted.has(idea.id))
    .map((idea) => {
      const result = interpreted.get(idea.id) as InterpretedScore;
      return {
        id: idea.id,
        net: result.net,
        bucketScore: result.bucketScore ?? 0,
        psychologyScore: result.psychologyTerm ?? 0,
        lastJoinedMs: idea.lastJoinedMs,
        confidence: result.bucketConfidence ?? 0,
      };
    });
  const order = rankForSlate(ranked);
  const top = selectTopThree(ranked);
  const selected = new Set(top.map((idea) => idea.id));
  const rankOf = new Map(order.map((idea, index) => [idea.id, index + 1]));

  const scores: ScoreInsert[] = ranked.map((idea) => ({
    postIdeaId: idea.id,
    origin: originOf.get(idea.id) ?? 'timely',
    interpreted: interpreted.get(idea.id) as InterpretedScore,
    rank: rankOf.get(idea.id) ?? null,
    selected: selected.has(idea.id),
  }));
  if (scores.length === 0) {
    throw new Error('No idea scored. The earlier slate was left as it is.');
  }

  const slateId = await insertSlate({
    runId,
    nyDate,
    pass1Version: SCORING_PASS_1.version,
    pass2Version: SCORING_PASS_2.version,
    scores,
  });
  await rerankSlate(slateId, nyDate);

  return {
    slateId,
    scored: scores.length,
    selected: selected.size,
    carryovers: scores.filter((score) => score.origin === 'carryover').length,
    selectedIds: top.map((idea) => idea.id),
    failed,
    failures,
  };
}

async function mapPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}
