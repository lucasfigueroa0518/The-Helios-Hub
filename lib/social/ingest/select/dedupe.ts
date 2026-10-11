/**
 * A second duplicate pass over the ranked stories (2026-10-11). Grouping
 * (group.ts) only asks Jev about articles whose headlines share words, so the
 * same event worded differently by two outlets ("Anthropic is banning cruel
 * behaviour toward Claude" / "Like bullying AI? Claude will give you the cold
 * shoulder") reached the pool twice. Here each of the top ranked stories is
 * asked, once, whether it is the same event as any higher-ranked story about
 * the same company (companies.ts); a match folds into the higher one, whose
 * outlets and members grow (so coverage counts every outlet).
 */
import { mapPool } from '@/lib/async-pool';
import type { JevAsk } from '@/lib/social/jev/client';
import * as SameEvent from '@/lib/social/jev/questions/same-event.v1';
import { coverageScore } from '@/lib/social/jev/questions/story-scoring.v3';

import { companyKey } from './companies';
import { outletKey } from './outlets';
import { compareScored } from './rank';
import type { ScoredGroup } from './types';

/** How many top stories are checked; the pool shows 25, so this leaves room for merges. */
export const DEDUPE_TOP = 40;
/** Higher-ranked stories each one is compared with (same company only). */
export const DEDUPE_NEIGHBOURS = 5;

function fold(into: ScoredGroup, from: ScoredGroup): ScoredGroup {
  const outlets = [...into.outlets];
  const seen = new Set(outlets.map(outletKey));
  for (const o of from.outlets) if (!seen.has(outletKey(o))) { seen.add(outletKey(o)); outlets.push(o); }
  const members = [...into.members, ...from.members.filter((m) => !into.members.some((x) => x.url === m.url))];
  const merged = { ...into, outlets, outletCount: outlets.length, members, read: [...into.read, ...from.read.filter((r) => !into.read.some((x) => x.url === r.url))] };
  // Only coverage changes: the answers are the higher story's own.
  return { ...merged, probSum: into.probSum + coverageScore(outlets.length) - coverageScore(into.outletCount) };
}

export async function mergeSameEvent(ranked: ScoredGroup[], jev: JevAsk): Promise<{ ranked: ScoredGroup[]; merged: Array<{ kept: string; dropped: string }> }> {
  const top = ranked.slice(0, DEDUPE_TOP);
  const keys = top.map((g) => companyKey(g.representative.headline));
  // One Jev call per story that has same-company stories above it.
  const asks = top.map((g, i) => ({
    i,
    above: top.slice(0, i).map((_, j) => j).filter((j) => keys[j] !== null && keys[j] === keys[i]).slice(-DEDUPE_NEIGHBOURS),
  })).filter((a) => a.above.length > 0);
  const answers = await mapPool(asks, 8, async ({ i, above }) => {
    const res = await jev(
      { state: SameEvent.buildState(top[i]!.representative, above.map((j) => top[j]!.representative)), questions: SameEvent.buildQuestions(above.length) },
      { version: SameEvent.VERSION, subjectId: top[i]!.id },
    );
    const k = above.findIndex((_, n) => (res.answers[SameEvent.neighbourId(n)]?.noul ?? 0) >= SameEvent.THRESHOLDS.SAME_EVENT_MIN);
    return { i, into: k === -1 ? null : above[k]! };
  });
  // Fold top-down so a chain (c → b → a) lands on the highest-ranked story.
  const target = new Map<number, number>();
  for (const { i, into } of answers) if (into !== null) target.set(i, into);
  const root = (i: number): number => (target.has(i) ? root(target.get(i)!) : i);
  const groups = new Map<number, ScoredGroup>();
  const merged: Array<{ kept: string; dropped: string }> = [];
  top.forEach((g, i) => {
    const r = root(i);
    if (r === i) groups.set(i, g);
    else {
      groups.set(r, fold(groups.get(r)!, g));
      merged.push({ kept: top[r]!.id, dropped: g.id });
    }
  });
  return { ranked: [...groups.values(), ...ranked.slice(DEDUPE_TOP)].sort(compareScored), merged };
}
