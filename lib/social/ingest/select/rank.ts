/**
 * Ranking, shortlist and winners (spec §5B; story-scoring@3, 2026-10-11).
 *
 * Order: engagement score desc (probSum, story-scoring@3) → outletCount desc
 * → newest. The shortlist, which the hub shows as the idea pool, is the top
 * SHORTLIST_MAX after duplicates are folded (dedupe.ts) and the top
 * SPREAD_TOP are spread so no company holds more than SPREAD_PER_COMPANY of
 * them (spreadByCompany).
 */
import type { JevAsk } from '@/lib/social/jev/client';
import * as DifferentStory from '@/lib/social/jev/questions/different-story.v1';

import { companyKey } from './companies';
import type { ScoredGroup } from './types';

export const SHORTLIST_MAX = 25;
/** The first SPREAD_TOP places hold at most SPREAD_PER_COMPANY stories about one company. */
export const SPREAD_TOP = 10;
export const SPREAD_PER_COMPANY = 2;
export const WINNERS = 2;

export function compareScored(a: ScoredGroup, b: ScoredGroup): number {
  return (
    b.probSum - a.probSum ||
    b.outletCount - a.outletCount ||
    b.publishedAt.getTime() - a.publishedAt.getTime()
  );
}

export function rankQualified(scored: ScoredGroup[]): ScoredGroup[] {
  return scored.filter((g) => g.status === 'qualified').sort(compareScored);
}

/**
 * Spread the top of the pool across companies: a story whose company already
 * holds SPREAD_PER_COMPANY of the first SPREAD_TOP places waits just below
 * them, in its own order. Nothing is dropped; stories naming no known
 * company are never held back.
 */
export function spreadByCompany(ranked: ScoredGroup[], top = SPREAD_TOP, perCompany = SPREAD_PER_COMPANY): ScoredGroup[] {
  const head: ScoredGroup[] = [];
  const held: ScoredGroup[] = [];
  const rest: ScoredGroup[] = [];
  const counts = new Map<string, number>();
  for (const g of ranked) {
    if (head.length >= top) {
      rest.push(g);
      continue;
    }
    const key = companyKey(g.representative.headline);
    if (key && (counts.get(key) ?? 0) >= perCompany) {
      held.push(g);
      continue;
    }
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    head.push(g);
  }
  return [...head, ...held, ...rest];
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
