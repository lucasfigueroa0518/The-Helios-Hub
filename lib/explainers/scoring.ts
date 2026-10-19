import type { IdeaScoreKey, ScoreKey, TopicRow } from '@/lib/explainers/types';

/**
 * E-15 combination rules, applied in code (never by the model). Weights are
 * points out of 100. Idea scoring v3 (EX3-73): `ai_focus` is worth 10 and the
 * six E-15 weights scale by 0.9, so the total stays 100 (register, "Idea
 * scoring v3").
 */
export const SCORE_POINTS: Record<IdeaScoreKey, number> = {
  audience_fit: 18,
  teachability_45s: 18,
  analogy_potential: 11.25,
  visual_potential: 11.25,
  accuracy_under_simplification: 18,
  hook_strength: 13.5,
  ai_focus: 10,
};

/**
 * Jev expected scores, 0 to 4; may fall between levels. `ai_focus` is absent on topics scored
 * before v3: they carry no AI points until rescored.
 */
export type TopicScores = Record<ScoreKey, number> & { ai_focus?: number };

/** The topic's `ai_focus` (EX3-73), or null when it was scored before v3. */
export function topicAiFocus(topic: Pick<TopicRow, 'jev_notes'>): number | null {
  const value = (topic.jev_notes as { ai_focus?: unknown } | null)?.ai_focus;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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
  for (const key of Object.keys(SCORE_POINTS) as IdeaScoreKey[]) {
    total += ((scores[key] ?? 0) / 4) * SCORE_POINTS[key];
  }
  return Math.round(total * 1000) / 1000;
}

/** The gates a topic fails, in E-15 order. Empty means it survives. */
export function failedGates(scores: TopicScores): ScoreKey[] {
  return (Object.keys(SCORE_MIN) as ScoreKey[]).filter((key) => scores[key] < SCORE_MIN[key]!);
}
