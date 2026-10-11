/**
 * One Jev call per candidate (story-scoring@3), then plain-code rules:
 *   - any skip-list category ≥ SKIP_MIN, or already posted ≥ POSTED_MIN → skipped;
 *   - relevance and substance both ≥ REQUIRED_MIN → qualified;
 *   - probSum = the engagement score (Scoring.engagementScore, 0 to 5.5) the
 *     pool ranks by; passes = how many of the four engagement questions reach
 *     BONUS_MIN (shown on the hub).
 */
import { mapPool } from '@/lib/async-pool';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v3';

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
  const p = (id: string) => answers[id] ?? 0;
  const passes = Scoring.ENGAGEMENT_IDS.filter((id) => p(id) >= t.BONUS_MIN).length;
  const probSum = Scoring.engagementScore(answers, group.outletCount);
  const base = { ...group, answers, passes, probSum };

  const skipHit = Scoring.SKIP_IDS.find((id) => p(id) >= t.SKIP_MIN);
  if (skipHit) return { ...base, status: 'skipped', reason: skipHit };
  if (p(Scoring.POSTED_ID) >= t.POSTED_MIN) return { ...base, status: 'skipped', reason: Scoring.POSTED_ID };

  const missing = Scoring.REQUIRED_IDS.filter((id) => p(id) < t.REQUIRED_MIN);
  if (missing.length > 0) return { ...base, status: 'not-qualified', reason: `required: ${missing.join(', ')}` };
  return { ...base, status: 'qualified' };
}
