import type { ScoreKey } from '@/lib/explainers/types';

/**
 * E-15 combination rules, applied in code (never by the model). Weights are
 * points out of 100; the formula is the kickoff packet's verbatim.
 */
export const SCORE_POINTS: Record<ScoreKey, number> = {
  audience_fit: 20,
  teachability_45s: 20,
  analogy_potential: 12.5,
  visual_potential: 12.5,
  accuracy_under_simplification: 20,
  hook_strength: 15,
};

/** Jev expected scores, 0 to 4; may fall between levels. */
export type TopicScores = Record<ScoreKey, number>;

/**
 * E-15 minimums (`*_min` values). A raw Jev score below its minimum rejects
 * the topic. Raw scores are used as returned, never rounded (Lucas, A-8).
 */
export const SCORE_MIN: Partial<Record<ScoreKey, number>> = {
  audience_fit: 1,
  teachability_45s: 2,
  analogy_potential: 1,
  visual_potential: 1,
  accuracy_under_simplification: 2,
};

/** E-15 formula on the raw expected scores. */
export function weightedScore(scores: TopicScores): number {
  let total = 0;
  for (const key of Object.keys(SCORE_POINTS) as ScoreKey[]) {
    total += (scores[key] / 4) * SCORE_POINTS[key];
  }
  return Math.round(total * 1000) / 1000;
}

/** The gates a topic fails, in E-15 order. Empty means it survives. */
export function failedGates(scores: TopicScores): ScoreKey[] {
  return (Object.keys(SCORE_MIN) as ScoreKey[]).filter((key) => scores[key] < SCORE_MIN[key]!);
}
