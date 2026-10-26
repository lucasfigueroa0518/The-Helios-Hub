import { STORY_SCORE_KEYS, type StoryScoreKey, type StoryScores } from '@/lib/real-case/types';

/**
 * Story scoring (RC-13), applied in code, never by the model. Jev answers each question 0 to 4; the
 * total is points out of 100. The three care qualities the analogy work found matter (recognition,
 * tension, illumination; planning/Explainer Reels/3.8 checkpoint/README.md) carry most of it, with
 * mechanism fit weighted as high as illumination: a story that doesn't show the concept's own step
 * teaches nothing, however good it is.
 *
 * PROVISIONAL: the weights, the bar and the floors are calibrated after the first live scouts.
 */
export const STORY_POINTS: Record<StoryScoreKey, number> = {
  recognition: 15,
  tension: 20,
  illumination: 25,
  mechanism_fit: 25,
  tellable: 15,
};

/** After the total: mechanism fit, illumination, tension, recognition, tellable. */
export const STORY_TIE_BREAKS: StoryScoreKey[] = ['mechanism_fit', 'illumination', 'tension', 'recognition', 'tellable'];

/** The bar a story must clear to enter the pool (PROVISIONAL). */
export const STORY_BAR: { total: number; floors: Partial<Record<StoryScoreKey, number>> } = {
  total: 70,
  floors: { mechanism_fit: 2.5, illumination: 2.5, tellable: 2.5, recognition: 2 },
};

export function storyTotal(scores: StoryScores): number {
  let total = 0;
  for (const key of STORY_SCORE_KEYS) total += (scores[key] / 4) * STORY_POINTS[key];
  return Math.round(total * 1000) / 1000;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Why a story misses the bar, in words the lab page can show; empty when it clears. */
export function storyBarMisses(scores: StoryScores): string[] {
  const out: string[] = [];
  const total = storyTotal(scores);
  if (total < STORY_BAR.total) out.push(`total ${fmt(total)} of 100, under ${STORY_BAR.total}`);
  for (const key of STORY_SCORE_KEYS) {
    const floor = STORY_BAR.floors[key];
    if (floor !== undefined && scores[key] < floor) out.push(`${key.replace(/_/g, ' ')} ${fmt(scores[key])} of 4, under ${floor}`);
  }
  return out;
}

/** Order two stories: positive when `a` ranks above `b` (total, then the tie-breaks). */
export function compareStories(a: StoryScores, b: StoryScores): number {
  const order: [number, number][] = [[storyTotal(a), storyTotal(b)], ...STORY_TIE_BREAKS.map((k): [number, number] => [a[k], b[k]])];
  for (const [x, y] of order) if (x !== y) return x - y;
  return 0;
}
