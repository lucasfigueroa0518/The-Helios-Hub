/**
 * One Jev call per candidate (story-scoring@4), then plain-code rules:
 *   - Scoring.gate(): any skip-list category ≥ SKIP_MIN, or already posted
 *     ≥ POSTED_MIN → skipped; AI-is-the-subject and substance ≥ REQUIRED_MIN,
 *     "something happened" ≥ EVENT_MIN and commentary < COMMENTARY_MIN →
 *     qualified;
 *   - probSum = the ranking score (Scoring.engagementScore, 0 to 5.5) the pool
 *     ranks by; passes = how many of the five impact and audience questions
 *     reach BONUS_MIN (shown on the hub).
 */
import { mapPool } from '@/lib/async-pool';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v4';

import type { ScoredGroup, StoryGroup } from './types';

export async function scoreGroups(
  groups: StoryGroup[],
  jev: JevAsk,
  postedHeadlines: string[],
): Promise<ScoredGroup[]> {
  const questions = Scoring.buildQuestions(postedHeadlines);
  return mapPool(groups, 8, async (group) => {
    const res = await jev(
      { state: Scoring.buildState(group, postedHeadlines), questions },
      { version: Scoring.VERSION, subjectId: group.id },
    );
    const answers: Record<string, number> = {};
    for (const [id, a] of Object.entries(res.answers)) answers[id] = a.noul ?? 0;
    return judge(group, answers);
  });
}

export function judge(group: StoryGroup, answers: Record<string, number>): ScoredGroup {
  const t = Scoring.THRESHOLDS;
  const passes = Scoring.ENGAGEMENT_IDS.filter((id) => (answers[id] ?? 0) >= t.BONUS_MIN).length;
  const probSum = Scoring.engagementScore(answers, group.outletCount);
  const base = { ...group, answers, passes, probSum };
  const verdict = Scoring.gate(answers);
  return verdict.reason === undefined ? { ...base, status: verdict.status } : { ...base, status: verdict.status, reason: verdict.reason };
}
