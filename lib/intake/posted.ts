/**
 * The per-order posted check (contract PostedCheck). story-scoring@4's
 * `already_posted` question, asked alone at read time on qualified stories,
 * with the same `recently_posted` state shape, against the list the type uses
 * today. It replaces that noul inside the cached story-scoring row, because the
 * posted list changes nightly and so cannot be cached.
 *
 * readCarouselPosted reads another type's posting history (read-only, 14 days,
 * the same query as createPgPosted). It never waits on that type.
 */
import { mapPool } from '@/lib/async-pool';
import * as StoryScoring from '@/lib/social/jev/questions/story-scoring.v4';
import { createPgPosted } from '@/lib/social/store/pg';

import { feedMembersOf, storyGroupOf } from './scorecards';
import type { IntakeQuery, PostedCheck } from './types';

const CONCURRENCY = 8;

/**
 * A story whose check fails (a Jev error, the cap included) counts as not posted: the check never throws, so one
 * bad call cannot take a lane or a set down (fix 2).
 */
export const postedCheck: PostedCheck = async (stories, postedHeadlines, jev) => {
  const posted = new Set<string>();
  if (stories.length === 0 || postedHeadlines.length === 0) return posted;
  const question = StoryScoring.buildQuestions(postedHeadlines)[StoryScoring.POSTED_ID]!;
  const questions = { [StoryScoring.POSTED_ID]: question };
  let ask: ReturnType<typeof jev.asSocialAsk>;
  try {
    ask = jev.asSocialAsk();
  } catch {
    return posted;
  }
  await mapPool(stories, CONCURRENCY, async (story) => {
    try {
      const feeds = feedMembersOf(story);
      const group = storyGroupOf(story, feeds.length > 0 ? feeds : story.members);
      const res = await ask({ state: StoryScoring.buildState(group, postedHeadlines), questions }, { version: StoryScoring.VERSION, subjectId: story.id });
      if ((res.answers[StoryScoring.POSTED_ID]?.noul ?? 0) >= StoryScoring.THRESHOLDS.POSTED_MIN) posted.add(story.id);
    } catch {
      // Not posted: the story stays a candidate.
    }
  });
  return posted;
};

/** Carousel headlines posted in the last 14 days (social.posted_stories, read-only). */
export function readCarouselPosted(q: IntakeQuery, now: Date): Promise<string[]> {
  return createPgPosted((text, params) => q.query(text, params)).recentHeadlines(now);
}
