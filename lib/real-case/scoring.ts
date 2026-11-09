import { STORY_SCORE_KEYS, type StoryScoreKey, type StoryScores } from '@/lib/real-case/types';

/**
 * Story scoring (RC-26, RC-27), applied in code, never by the model. Jev answers six questions 0 to 4
 * and code adds freshness from the event date; the total is points out of 100. The story carries most
 * of it (stakes, turn, scene); the reveal weighs as much as the stakes, because a story whose concept
 * doesn't explain it teaches nothing.
 *
 * PROVISIONAL: the weights, the bar and the floors are calibrated after the first live news scouts.
 */
export const STORY_POINTS: Record<StoryScoreKey, number> = {
  stakes: 20,
  turn: 15,
  scene: 15,
  reveal: 20,
  artifacts: 10,
  players: 10,
  freshness: 10,
};

/** After the total: reveal, stakes, turn, scene, freshness, artifacts, players. */
export const STORY_TIE_BREAKS: StoryScoreKey[] = ['reveal', 'stakes', 'turn', 'scene', 'freshness', 'artifacts', 'players'];

/** The bar a story must clear to enter the pool (PROVISIONAL). */
export const STORY_BAR: { total: number; floors: Partial<Record<StoryScoreKey, number>> } = {
  total: 70,
  floors: { reveal: 2.5, stakes: 2, scene: 2 },
};

/** Days at or under which a story is fully fresh; freshness falls to 0 at the window's end. */
export const FULLY_FRESH_DAYS = 14;

/**
 * Freshness, 0 to 4, from the event date (RC-27): 4 up to FULLY_FRESH_DAYS old, then falling in a
 * straight line to 0 at `windowDays`. An event in the future (a date slip) counts as today.
 */
export function freshness(eventDate: string, windowDays: number, now: Date = new Date()): number {
  const days = Math.max(0, (now.getTime() - Date.parse(`${eventDate}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return 0;
  if (days <= FULLY_FRESH_DAYS) return 4;
  if (days >= windowDays) return 0;
  return Math.round((4 * (windowDays - days)) / (windowDays - FULLY_FRESH_DAYS) * 1000) / 1000;
}

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
    if (floor !== undefined && scores[key] < floor) out.push(`${key} ${fmt(scores[key])} of 4, under ${floor}`);
  }
  return out;
}

/** Order two stories: positive when `a` ranks above `b` (total, then the tie-breaks). */
export function compareStories(a: StoryScores, b: StoryScores): number {
  const order: [number, number][] = [[storyTotal(a), storyTotal(b)], ...STORY_TIE_BREAKS.map((k): [number, number] => [a[k], b[k]])];
  for (const [x, y] of order) if (x !== y) return x - y;
  return 0;
}
