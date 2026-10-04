/**
 * Ranking, shortlist and winners (spec §5B).
 *
 * Order: passes desc → outletCount desc → probability sum desc → newest.
 * (Passes are whole numbers, so the spec's outlet-count tie-break actually
 * fires; a raw probability sum almost never ties.)
 */
import type { JevAsk } from '@/lib/social/jev/client';
import * as DifferentStory from '@/lib/social/jev/questions/different-story.v1';

import type { ScoredGroup } from './types';

export const SHORTLIST_MAX = 10;
export const WINNERS = 2;

export function compareScored(a: ScoredGroup, b: ScoredGroup): number {
  return (
    b.passes - a.passes ||
    b.outletCount - a.outletCount ||
    b.probSum - a.probSum ||
    b.publishedAt.getTime() - a.publishedAt.getTime()
  );
}

export function rankQualified(scored: ScoredGroup[]): ScoredGroup[] {
  return scored.filter((g) => g.status === 'qualified').sort(compareScored);
}

export type Picks = {
  shortlist: ScoredGroup[];
  winners: ScoredGroup[];
  /** The rest of the shortlist, in rank order. */
  backups: ScoredGroup[];
  /** Shortlisted stories passed over for #2 because they match #1's company/topic. */
  sameTopicAsFirst: string[];
};

/**
 * Winner #1 is the top story. Winner #2 is the highest-ranked shortlisted
 * story that isn't about the same company or topic as #1 (one Jev call).
 */
export async function pickWinners(ranked: ScoredGroup[], jev: JevAsk): Promise<Picks> {
  const shortlist = ranked.slice(0, SHORTLIST_MAX);
  if (shortlist.length <= 1) {
    return { shortlist, winners: shortlist, backups: [], sameTopicAsFirst: [] };
  }
  const [first, ...others] = shortlist as [ScoredGroup, ...ScoredGroup[]];
  const res = await jev(
    { state: DifferentStory.buildState(first, others), questions: DifferentStory.buildQuestions(others.length) },
    { version: DifferentStory.VERSION, subjectId: first.id },
  );
  const sameTopic = others.map(
    (_, k) => (res.answers[DifferentStory.candidateId(k)]?.noul ?? 0) >= DifferentStory.THRESHOLDS.SAME_TOPIC_MIN,
  );
  const secondIdx = sameTopic.findIndex((same) => !same);
  const sameTopicAsFirst = others.filter((_, k) => sameTopic[k]).map((g) => g.id);
  if (secondIdx === -1) {
    // Everything is about #1's topic: no different #2; the rest stay backups in order.
    return { shortlist, winners: [first], backups: others, sameTopicAsFirst };
  }
  const second = others[secondIdx]!;
  return {
    shortlist,
    winners: [first, second],
    backups: others.filter((_, k) => k !== secondIdx),
    sameTopicAsFirst,
  };
}
