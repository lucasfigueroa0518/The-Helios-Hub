/**
 * One Jev call per candidate (story-scoring@2), then plain-code rules:
 *   - any skip-list category ≥ SKIP_MIN, or already posted ≥ POSTED_MIN → skipped;
 *   - relevance and substance both ≥ REQUIRED_MIN → qualified;
 *   - passes = how many of the three other questions reach BONUS_MIN.
 */
import { mapPool } from '@/lib/async-pool';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v2';

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
  const passes = Scoring.BONUS_IDS.filter((id) => p(id) >= t.BONUS_MIN).length;
  const probSum = Scoring.BONUS_IDS.reduce((s, id) => s + p(id), 0);
  const base = { ...group, answers, passes, probSum };

  const skipHit = Scoring.SKIP_IDS.find((id) => p(id) >= t.SKIP_MIN);
  if (skipHit) return { ...base, status: 'skipped', reason: skipHit };
  if (p(Scoring.POSTED_ID) >= t.POSTED_MIN) return { ...base, status: 'skipped', reason: Scoring.POSTED_ID };

  const missing = Scoring.REQUIRED_IDS.filter((id) => p(id) < t.REQUIRED_MIN);
  if (missing.length > 0) return { ...base, status: 'not-qualified', reason: `required: ${missing.join(', ')}` };
  return { ...base, status: 'qualified' };
}
