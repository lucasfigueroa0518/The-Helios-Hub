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
  type TimelyIdea,
} from '@/lib/reels/scoring/store';

/** One candidate the intake knows: its stored reels-score (null when unscored) and the registry row's last_joined. */
export type StoredIntakeScore = { score: InterpretedScore | null; lastJoinedMs: number };

/** Intake mode's scoring inputs (lib/reels/pipeline/intake.ts builds the live one). */
export type IntakeScoreSource = {
  /** Each id → its surviving story id (resolveStoryId); legacy and unknown ids map to themselves or are absent. */
  resolve(ids: readonly string[]): Promise<Map<string, string>>;
  /** The ids that are intake stories, with their stored score. Ids absent from the map are legacy ideas. */
  storedScores(ids: readonly string[]): Promise<Map<string, StoredIntakeScore>>;
  /**
   * Switch-night twins: each (legacy idea, intake story) pair whose members share a URL (reels.idea_sources_v,
   * legacy-origin members of the first set against intake-origin members of the second).
   */
  twins(legacyIds: readonly string[], intakeIds: readonly string[]): Promise<Array<{ legacy: string; intake: string }>>;
  /** The ids that already have copy, a video job or a schedule row (the work a twin must not repeat). */
  made(ids: readonly string[]): Promise<Set<string>>;
};

/**
 * Tonight's candidate set, read before any scoring (so an intake read error can still send the night to the legacy
 * path). `intake` is false on a legacy night, whose plan is the same reads in the same order as before.
 */
export type CandidatePlan = {
  intake: boolean;
  today: string;
  origins: Map<string, 'timely' | 'carryover'>;
  stored: Map<string, StoredIntakeScore>;
  /** Switch-night twins left out (legacy uuid or intake story id). */
  twinsDropped: string[];
};

/**
 * Which twin of each (legacy, intake) pair stays off tonight's slate: the intake story gives way when the legacy
 * idea already has copy, a video or a schedule row and the story has none; otherwise the legacy idea gives way.
 * A legacy idea that is not a candidate (held: selected, on the clock or published) is never offered, so only its
 * intake twin can be dropped. Returns the ids to drop.
 */
export function switchTwinDrops(
  pairs: ReadonlyArray<{ legacy: string; intake: string }>,
  candidates: ReadonlySet<string>,
  made: ReadonlySet<string>,
): Set<string> {
  const drop = new Set<string>();
  for (const { legacy, intake } of pairs) {
    const keepLegacy = made.has(legacy) && !made.has(intake);
    if (keepLegacy) {
      if (candidates.has(intake)) drop.add(intake);
    } else if (candidates.has(legacy)) {
      drop.add(legacy);
    }
  }
  return drop;
}

/**
 * The candidate reads of scoreRun: tonight's timely ideas, a same-day rerun's earlier slate and the carryover window.
 * Intake mode adds the merge resolution, the stored scores and the switch-night twin check; its read errors throw
 * here, before anything is scored.
 */
export async function planCandidates(runStartedAt: Date, intake?: IntakeScoreSource): Promise<CandidatePlan> {
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
  let sameDay: readonly string[] = sameDayIds;
  let carryoverIds: readonly string[] = misses.map((idea) => idea.id);
  if (intake) {
    // A merged-away story is never offered again: its surviving story stands in for it.
    const resolved = await intake.resolve([...sameDay, ...carryoverIds]);
    const survivor = (id: string) => resolved.get(id) ?? id;
    sameDay = [...new Set(sameDay.map(survivor))];
    carryoverIds = [...new Set(carryoverIds.map(survivor))];
  }
  const origins = candidateOrigins({
    timelyIds: timely.map((idea) => idea.id),
    sameDayIds: sameDay,
    carryoverIds,
  });

  if (!intake) return { intake: false, today, origins, stored: new Map(), twinsDropped: [] };

  // Intake stories carry their stored score (no Jev call); every other id is a legacy idea, scored the legacy way.
  const candidateIds = [...origins.keys()];
  const stored = await intake.storedScores(candidateIds);
  // Switch nights: a legacy idea (candidate, or held from the last two slates) and the intake story with the same
  // URLs are one story. Only one of them may be offered, so it cannot be made twice.
  const intakeIds = candidateIds.filter((id) => stored.has(id));
  const legacyIds = [...new Set([...candidateIds.filter((id) => !stored.has(id)), ...selectedYesterday, ...selectedTwoDaysAgo])];
  const pairs = intakeIds.length && legacyIds.length ? await intake.twins(legacyIds, intakeIds) : [];
  const made = pairs.length ? await intake.made([...new Set(pairs.flatMap((p) => [p.legacy, p.intake]))]) : new Set<string>();
  const drop = switchTwinDrops(pairs, new Set(candidateIds), made);
  for (const id of drop) {
    origins.delete(id);
    stored.delete(id);
  }
  return { intake: true, today, origins, stored, twinsDropped: [...drop] };
}

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
  /** The post idea the Jev log rows point at. A candidate that is not a stored idea passes null. */
  postIdeaId: string | null = idea.id,
): Promise<InterpretedScore> {
  const pass1 = await jev.ask({
    component: 'scoring-pass1',
    state: buildPass1State(idea.members),
    sets: [SCORING_PASS_1],
    questions: SCORING_PASS_1.questions,
    runId,
    postIdeaId: postIdeaId ?? undefined,
  });
  let result = interpretPass1(pass1.answers);
  if (result.chosenBucket && result.chosenFramework) {
    const pass2 = await jev.ask({
      component: 'scoring-pass2',
      state: buildPass2State(idea.members, result.chosenFramework, result.chosenBucket),
      sets: [SCORING_PASS_2],
      questions: SCORING_PASS_2.questions,
      runId,
      postIdeaId: postIdeaId ?? undefined,
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
  /**
   * Central intake (Phase 2): where an intake story's stored `reels-score` comes from. Absent on a legacy night,
   * which then scores every candidate with scoreOneIdea exactly as before.
   */
  intake?: IntakeScoreSource,
  /** Candidates already read (planCandidates); read here when absent. */
  plan?: CandidatePlan,
): Promise<ScoringSummary> {
  const { today, origins, stored, intake: intakeNight } = plan ?? (await planCandidates(runStartedAt, intake));
  const candidateIds = [...origins.keys()];
  const material = await loadIdeaMaterial(candidateIds.filter((id) => !stored.has(id)));
  const interpreted = new Map<string, InterpretedScore>();
  const failures: string[] = [];

  for (const idea of material) {
    const headline = idea.members[0]?.headline ?? idea.id;
    const failure = await guardItem(headline, async () => {
      interpreted.set(idea.id, await scoreOneIdea(runId, jev, idea));
    });
    if (failure) failures.push(failure);
  }

  const scoredMaterial: TimelyIdea[] = material
    .filter((idea) => interpreted.has(idea.id))
    .map((idea) => ({ id: idea.id, lastJoinedMs: idea.lastJoinedMs }));
  if (intakeNight) {
    for (const [id, entry] of stored) {
      if (!entry.score) continue; // The intake has the story but did not score it: not on tonight's slate.
      interpreted.set(id, entry.score);
      scoredMaterial.push({ id, lastJoinedMs: entry.lastJoinedMs });
    }
    // The legacy read returns ideas in id order; keep one order for the mixed set too.
    scoredMaterial.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
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
