import type { Questions } from '@typesafe-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import {
  DUPLICATE_YES,
  GATE_YES,
  PAIR_KEYS,
  STORY_GATE,
  STORY_RECENT_LESSON,
  STORY_SAME_EVENT_GATE,
  STORY_SAME_EVENT_PAIRS,
  STORY_SCORING,
} from '@/lib/real-case/jev/questions';
import type { RealCaseJevRunner } from '@/lib/real-case/jev/runner';
import {
  getStory,
  listRecentlyMadeStories,
  listStories,
  saveStoryCheck,
  saveStoryScores,
  setStoryStatus,
  storyScores,
} from '@/lib/real-case/repository';
import { compareStories, storyBarMisses, storyTotal } from '@/lib/real-case/scoring';
import { checkStoryClaims, fetchPage, type PageFetcher } from '@/lib/real-case/source-check';
import { STORY_SCORE_KEYS, type StoryRow, type StoryScores } from '@/lib/real-case/types';

/**
 * One scouted story, end to end (RC-13), cheapest step first: the source check (code, free), the gates
 * and the scores (one Jev call each), the bar (code), then the duplicate checks (Jev), and the pool.
 */

export type EvaluateStoryDeps = {
  db: Queryable;
  jev: RealCaseJevRunner;
  fetcher?: PageFetcher;
  lookbackDays: number;
  now?: Date;
};

export type StoryEvaluation =
  | { outcome: 'source_failed'; failedCore: string[] }
  | { outcome: 'gated'; gates: string[] }
  | { outcome: 'below_bar'; score: number; misses: string[] }
  | { outcome: 'recent_lesson'; score: number }
  | { outcome: 'already_made'; score: number; matchId: string }
  | { outcome: 'entered_pool'; score: number }
  | { outcome: 'won_head_to_head'; score: number; displacedId: string }
  | { outcome: 'lost_head_to_head'; score: number; winnerId: string };

export function enteredPool(e: StoryEvaluation): boolean {
  return e.outcome === 'entered_pool' || e.outcome === 'won_head_to_head';
}

/** What every story question sees: the term, the story, and only the facts that passed the source check. */
export function storyState(story: Pick<StoryRow, 'term' | 'title' | 'summary' | 'polarity' | 'story' | 'claims'>) {
  return {
    term: story.term,
    story: { title: story.title, summary: story.summary, polarity: story.polarity, ...story.story },
    facts: story.claims.filter((c) => c.check?.status === 'verified').map((c) => c.text),
  };
}

/** The short form the duplicate checks compare. */
export function storyRef(story: Pick<StoryRow, 'term' | 'title' | 'summary'>) {
  return { term: story.term, title: story.title, summary: story.summary };
}

function subset<Q extends Questions>(questions: Q, keys: readonly string[]): Questions {
  const out: Questions = {};
  for (const key of keys) out[key] = questions[key as keyof Q] as Questions[string];
  return out;
}

async function askScores(deps: EvaluateStoryDeps, story: StoryRow): Promise<StoryScores> {
  const result = await deps.jev.ask({ component: 'story_scoring', state: storyState(story), set: STORY_SCORING, questions: STORY_SCORING.questions, storyId: story.id });
  const answers = result.answers as Record<string, { score?: number }>;
  const scores = {} as StoryScores;
  for (const key of STORY_SCORE_KEYS) {
    const value = answers[key]?.score;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Jev returned no ${key} score for a story`);
    scores[key] = Math.min(4, Math.max(0, value));
  }
  return scores;
}

async function askGates(deps: EvaluateStoryDeps, story: StoryRow): Promise<string[]> {
  const result = await deps.jev.ask({ component: 'story_gate', state: storyState(story), set: STORY_GATE, questions: STORY_GATE.questions, storyId: story.id });
  const answers = result.answers as Record<string, { noul?: number }>;
  return Object.keys(STORY_GATE.questions).filter((key) => {
    const p = answers[key]?.noul;
    if (typeof p !== 'number' || !Number.isFinite(p)) throw new Error(`Jev returned no ${key} answer for a story`);
    return p >= GATE_YES;
  });
}

/** The same event in the pool or among stories made: stage 1 against all, then batches of five to find it. */
async function findSameEvent(deps: EvaluateStoryDeps, story: StoryRow, history: readonly StoryRow[]): Promise<StoryRow | null> {
  if (history.length === 0) return null;
  const gate = await deps.jev.ask({
    component: 'same_event_gate',
    state: { candidate: storyRef(story), history: history.map(storyRef) },
    set: STORY_SAME_EVENT_GATE,
    questions: STORY_SAME_EVENT_GATE.questions,
    storyId: story.id,
  });
  if ((gate.answers.same_event_as_existing.noul ?? 0) < DUPLICATE_YES) return null;
  for (let i = 0; i < history.length; i += PAIR_KEYS.length) {
    const batch = history.slice(i, i + PAIR_KEYS.length);
    const keys = PAIR_KEYS.slice(0, batch.length);
    const incumbents = Object.fromEntries(keys.map((key, j) => [key, storyRef(batch[j])]));
    const result = await deps.jev.ask({
      component: 'same_event_pairs',
      state: { candidate: storyRef(story), incumbents },
      set: STORY_SAME_EVENT_PAIRS,
      questions: subset(STORY_SAME_EVENT_PAIRS.questions, keys),
      storyId: story.id,
    });
    const answers = result.answers as Record<string, { noul?: number }>;
    const hit = batch.find((_, j) => (answers[keys[j]]?.noul ?? 0) >= DUPLICATE_YES);
    if (hit) return hit;
  }
  return null;
}

export async function evaluateStory(deps: EvaluateStoryDeps, storyId: string): Promise<StoryEvaluation> {
  const { db } = deps;
  let story = await getStory(db, storyId);
  if (!story) throw new Error(`story ${storyId} not found`);

  // 1 · The source check (code, no model).
  const check = await checkStoryClaims(story.claims, story.sources, deps.fetcher ?? fetchPage, deps.now);
  if ((await saveStoryCheck(db, story.id, check)) === 'rejected') return { outcome: 'source_failed', failedCore: check.failedCore };
  story = (await getStory(db, story.id))!;

  // 2 · The gates.
  const gates = await askGates(deps, story);
  if (gates.length) {
    await setStoryStatus(db, story.id, 'rejected', { reason: `Failed gate: ${gates.map((g) => g.replace(/_/g, ' ')).join(', ')}.` });
    return { outcome: 'gated', gates };
  }

  // 3 · The scores and the bar.
  const scores = await askScores(deps, story);
  const total = storyTotal(scores);
  const misses = storyBarMisses(scores);
  await saveStoryScores(db, story.id, scores, total, misses.length ? { bar_misses: misses } : {});
  if (misses.length) {
    await setStoryStatus(db, story.id, 'rejected', { reason: `Below the bar: ${misses.join('; ')}.` });
    return { outcome: 'below_bar', score: total, misses };
  }

  // 4 · The same lesson as a reel made inside the lookback (RC-09).
  const recent = (await listRecentlyMadeStories(db, deps.lookbackDays, deps.now)).filter((s) => s.id !== story!.id);
  if (recent.length) {
    const lesson = await deps.jev.ask({
      component: 'recent_lesson',
      state: { candidate: storyRef(story), recent: recent.map(storyRef) },
      set: STORY_RECENT_LESSON,
      questions: STORY_RECENT_LESSON.questions,
      storyId: story.id,
    });
    if ((lesson.answers.same_lesson_as_recent.noul ?? 0) >= DUPLICATE_YES) {
      await setStoryStatus(db, story.id, 'rejected', { reason: 'Same lesson as a reel made recently.' });
      return { outcome: 'recent_lesson', score: total };
    }
  }

  // 5 · The same event as a story in the pool or already made.
  const history = (await listStories(db, ['pool', 'promoted', 'rendered'], 10_000)).filter((s) => s.id !== story!.id);
  const match = await findSameEvent(deps, story, history);
  if (!match) {
    await setStoryStatus(db, story.id, 'pool');
    return { outcome: 'entered_pool', score: total };
  }
  if (match.status !== 'pool') {
    await setStoryStatus(db, story.id, 'rejected', { reason: 'Same event as a story already made or being made.', duplicateOf: match.id });
    return { outcome: 'already_made', score: total, matchId: match.id };
  }
  const incumbent = storyScores(match);
  if (incumbent && compareStories(scores, incumbent) > 0) {
    await setStoryStatus(db, match.id, 'displaced', { reason: 'A stronger telling of the same event entered the pool.', duplicateOf: story.id });
    await setStoryStatus(db, story.id, 'pool');
    return { outcome: 'won_head_to_head', score: total, displacedId: match.id };
  }
  await setStoryStatus(db, story.id, 'displaced', { reason: 'The pool already holds a stronger telling of the same event.', duplicateOf: match.id });
  return { outcome: 'lost_head_to_head', score: total, winnerId: match.id };
}
