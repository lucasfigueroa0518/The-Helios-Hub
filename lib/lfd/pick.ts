// lib/lfd/pick.ts
/**
 * Picking (spec §3.2–3.4): two lanes. Major headlines (judged by Jev
 * major-news@2, bar 0.55) take up to 3 slots and lead; the rundown fills the
 * rest from the reels pool. One slide per event, at most 2 per company, no
 * repeats from earlier Last Few Days posts. A dropped story is replaced from
 * its own lane, then from the rundown.
 */
import { MAJOR_NEWS_BAR, SAME_EVENT_BAR, majorNewsScore, namesIn } from '@/lib/stories/build/morning-download';
import { MAJOR_NEWS, SAME_EVENT } from '@/lib/stories/questions';
import { companyKey } from '@/lib/social/ingest/select/companies';
import type { JevAsk } from '@/lib/social/jev/client';

import type { Lane, LfdCandidate, Pick } from './types';

export const MAX_STORIES = 6;
export const MIN_STORIES = 5;
export const MAX_MAJOR = 3;
export const PER_COMPANY = 2;
export const JUDGED_MAX = 60;
export const RUNDOWN_POOL = 20;
const REELS_PER_NIGHT = 10;
const BODY_CHARS = 9000;
const MERGE_BODY_CHARS = 1200;

/** Blockbusters first, then best net (spec §3.2 lane 2). */
export function rundownOrder(a: LfdCandidate, b: LfdCandidate): number {
  return b.blockbuster - a.blockbuster || (b.net ?? -1) - (a.net ?? -1);
}

/** Lane 1 candidates (spec §3.2): carousel tops, reels top 10 by net per night plus every blockbuster, then the fresh feed. About 60; the cap never cuts the feed. */
export function judgedPool(carousel: LfdCandidate[], reels: LfdCandidate[], feed: LfdCandidate[]): LfdCandidate[] {
  const byNet = (a: LfdCandidate, b: LfdCandidate) => (b.net ?? -1) - (a.net ?? -1);
  const nights = new Map<string, LfdCandidate[]>();
  for (const c of reels) {
    const night = c.firstSeen ?? '';
    nights.set(night, [...(nights.get(night) ?? []), c]);
  }
  const reelsPicked: LfdCandidate[] = [];
  for (const list of nights.values()) {
    const top = [...list].sort(byNet).slice(0, REELS_PER_NIGHT);
    const extra = list.filter((c) => c.blockbuster > 0 && !top.includes(c));
    reelsPicked.push(...top, ...extra);
  }
  const seen = new Set<string>();
  const dedupe = (list: LfdCandidate[]) =>
    list.filter((c) => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });
  const head = dedupe([...carousel, ...reelsPicked]);
  const tail = dedupe(feed);
  return [...head.slice(0, Math.max(0, JUDGED_MAX - tail.length)), ...tail];
}

/** Drop anything an earlier Last Few Days post used, by any of its source ids or its key. */
export function withoutUsed(list: LfdCandidate[], used: Set<string>): LfdCandidate[] {
  return list.filter((c) => !used.has(c.key) && !c.refs.some((r) => used.has(r)));
}

export async function scoreMajor(list: LfdCandidate[], jev: JevAsk): Promise<LfdCandidate[]> {
  const out: LfdCandidate[] = [];
  for (const c of list) {
    const res = await jev(
      { state: { headline: c.headline, outlets: [c.sourceName, ...c.alsoFrom], published: c.publishedAt, story: { untrusted_content: c.body.slice(0, BODY_CHARS) } }, questions: MAJOR_NEWS.questions },
      { version: MAJOR_NEWS.version, subjectId: c.key },
    );
    out.push({ ...c, major: majorNewsScore(res.answers as Record<string, { noul: number }>) });
  }
  return out;
}

async function sameEvent(jev: JevAsk, a: { headline: string; body: string }, b: { headline: string; body: string }, subjectId: string): Promise<boolean> {
  const shared = [...namesIn(a.headline)].some((name) => namesIn(b.headline).has(name));
  if (!shared) return false;
  const res = await jev(
    { state: { story_a: { headline: a.headline, untrusted_content: a.body.slice(0, MERGE_BODY_CHARS) }, story_b: { headline: b.headline, untrusted_content: b.body.slice(0, MERGE_BODY_CHARS) } }, questions: SAME_EVENT.questions },
    { version: SAME_EVENT.version, subjectId },
  );
  return (res.answers.same_event?.noul ?? 0) >= SAME_EVENT_BAR;
}

/** Keep the stronger article (the longer body); carry every source id, outlet and the best scores. */
function fold(into: LfdCandidate, from: LfdCandidate): LfdCandidate {
  const keep = from.body.length > into.body.length ? from : into;
  const other = keep === into ? from : into;
  const max = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
  return {
    ...keep,
    key: into.key,
    refs: [...new Set([...into.refs, ...from.refs])],
    alsoFrom: [...new Set([...keep.alsoFrom, other.sourceName, ...other.alsoFrom])].filter((s) => s && s !== keep.sourceName),
    net: max(into.net, from.net),
    blockbuster: Math.max(into.blockbuster, from.blockbuster),
    major: max(into.major, from.major),
    firstSeen: into.firstSeen ?? from.firstSeen,
  };
}

/** One story per event (spec §3.3 step 1). List order is priority: a later item folds into an earlier one. */
export async function mergeSameEvent(list: LfdCandidate[], jev: JevAsk): Promise<LfdCandidate[]> {
  const kept: LfdCandidate[] = [];
  for (const c of list) {
    let folded = false;
    for (let i = 0; i < kept.length; i++) {
      if (await sameEvent(jev, kept[i]!, c, `${kept[i]!.key}|${c.key}`)) {
        kept[i] = fold(kept[i]!, c);
        folded = true;
        break;
      }
    }
    if (!folded) kept.push(c);
  }
  return kept;
}

/** Majors by score, then the rundown in rank order (spec §4.2: slides in rank order). */
export function slideOrder(picks: Pick[]): Pick[] {
  const majors = picks.filter((p) => p.lane === 'major').sort((a, b) => (b.major ?? 0) - (a.major ?? 0));
  const rundown = picks.filter((p) => p.lane === 'rundown').sort(rundownOrder);
  return [...majors, ...rundown];
}

export class Selector {
  readonly picks: Pick[] = [];
  private readonly majors: LfdCandidate[];
  private readonly rundown: LfdCandidate[];
  private readonly tried = new Set<string>();

  constructor(
    majors: LfdCandidate[],
    rundown: LfdCandidate[],
    private readonly previous: Array<{ headline: string; body: string }>,
    private readonly jev: JevAsk,
  ) {
    this.majors = majors.filter((c) => (c.major ?? 0) >= MAJOR_NEWS_BAR).sort((a, b) => (b.major ?? 0) - (a.major ?? 0));
    this.rundown = [...rundown].sort(rundownOrder);
  }

  async fill(): Promise<Pick[]> {
    while (this.picks.filter((p) => p.lane === 'major').length < MAX_MAJOR) {
      if (!(await this.take('major'))) break;
    }
    while (this.picks.length < MAX_STORIES) {
      if (!(await this.take('rundown'))) break;
    }
    return [...this.picks];
  }

  drop(key: string): void {
    const i = this.picks.findIndex((p) => p.key === key);
    if (i !== -1) this.picks.splice(i, 1);
  }

  /** The next story for a dropped slot: its own lane first, then the rundown. */
  async replace(lane: Lane): Promise<Pick | null> {
    if (lane === 'major') {
      const major = await this.take('major');
      if (major) return major;
    }
    return this.take('rundown');
  }

  private async take(lane: Lane): Promise<Pick | null> {
    const queue = lane === 'major' ? this.majors : this.rundown;
    for (const c of queue) {
      if (this.tried.has(c.key)) continue;
      if (this.picks.some((p) => p.key === c.key || p.refs.some((r) => c.refs.includes(r)))) {
        this.tried.add(c.key);
        continue;
      }
      // Skipped only for a full company: stay eligible, a drop may free the slot (spec §3.4).
      if (this.companyFull(c)) continue;
      this.tried.add(c.key);
      if (await this.coveredLastTime(c)) continue;
      const pick: Pick = { ...c, lane };
      this.picks.push(pick);
      return pick;
    }
    return null;
  }

  private companyFull(c: LfdCandidate): boolean {
    const company = companyKey(c.headline);
    if (!company) return false;
    return this.picks.filter((p) => companyKey(p.headline) === company).length >= PER_COMPANY;
  }

  private async coveredLastTime(c: LfdCandidate): Promise<boolean> {
    for (const prev of this.previous) {
      if (await sameEvent(this.jev, prev, c, `prev|${c.key}`)) return true;
    }
    return false;
  }
}
