// lib/lfd/pick.ts
/**
 * Picking (spec §3.2–3.4; builder lane, central intake Phase 1). Seeds first;
 * then the lead queue, ordered by leadOf margin: major headlines (major-news,
 * bar 0.55) take at most 3 slots, builder stories (story-builder@2, event in the
 * last 7 days) are uncapped; the rundown fills the rest from the reels pool.
 * One slide per event, at most 2 per company, no repeats from earlier Last Few
 * Days posts. A dropped story is replaced from its own lane, then the lead
 * queue, then the rundown. With no builder scores (legacy lanes) the lead queue
 * is exactly today's major queue, so the lineup is unchanged.
 */
import { mapPool } from '@/lib/async-pool';
import { majorNewsScore, namesIn, SAME_EVENT_BAR } from '@/lib/stories/build/morning-download';
import { MAJOR_NEWS, SAME_EVENT } from '@/lib/stories/questions';
import { leadOf } from '@/lib/stories/scores';
import { companyKey } from '@/lib/social/ingest/select/companies';
import type { JevAsk } from '@/lib/social/jev/client';

import type { Lane, LfdCandidate, Pick } from './types';

export const MAX_STORIES = 6;
export const MIN_STORIES = 5;
/** Majors per post (builders are uncapped; round 3 Q3). */
export const MAX_MAJOR = 3;
/** Seeds one post may hold (design 2026-10-26): the rest wait for the next run. */
export const MAX_SEEDS = 3;
export const PER_COMPANY = 2;
export const JUDGED_MAX = 60;
export const RUNDOWN_POOL = 20;
const REELS_PER_NIGHT = 10;
const BODY_CHARS = 9000;
const MERGE_BODY_CHARS = 1200;

/** The candidate's lead lane and margin (lib/stories/scores leadOf), or null: it is not a lead. */
export function leadFor(c: { major: number | null; builder?: number | null; eventDate?: string | null }, now: Date): { lane: 'major' | 'builder'; margin: number } | null {
  const at = c.eventDate ? new Date(c.eventDate) : null;
  return leadOf({ major: c.major ?? null, builder: c.builder ?? null, eventDate: at && Number.isFinite(at.getTime()) ? at : null }, now);
}

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

export const JEV_CONCURRENCY = 8;

/**
 * major-news@2 for each candidate, up to 8 at once, in input order. `known`
 * holds scores already judged this run (the safety net's re-gather) so a
 * story is never judged twice.
 */
export async function scoreMajor(list: LfdCandidate[], jev: JevAsk, known: ReadonlyMap<string, number> = new Map()): Promise<LfdCandidate[]> {
  return mapPool(list, JEV_CONCURRENCY, async (c) => {
    const hit = known.get(c.key);
    if (hit !== undefined) return { ...c, major: hit };
    const res = await jev(
      { state: { headline: c.headline, outlets: [c.sourceName, ...c.alsoFrom], published: c.publishedAt, story: { untrusted_content: c.body.slice(0, BODY_CHARS) } }, questions: MAJOR_NEWS.questions },
      { version: MAJOR_NEWS.version, subjectId: c.key },
    );
    return { ...c, major: majorNewsScore(res.answers as Record<string, { noul: number }>) };
  });
}

/** Title-Case headline words that are not names: sharing only these never makes two stories a same-event pair. */
const COMMON_HEADLINE_WORDS = new Set([
  'Launches', 'Launch', 'Model', 'Models', 'Says', 'Said', 'New', 'Just', 'Now', 'Will', 'Is', 'Here', 'Releases', 'Release',
  'Raises', 'Announces', 'Wants', 'AI', 'Ships', 'Unveils', 'Adds', 'Gets', 'Makes', 'Can', 'Could', 'After', 'Update',
]);

/** Proper names in a headline that can pair two stories (namesIn minus common headline words). */
function pairNames(headline: string): Set<string> {
  return new Set([...namesIn(headline)].filter((n) => !COMMON_HEADLINE_WORDS.has(n)));
}

async function sameEvent(jev: JevAsk, a: { headline: string; body: string }, b: { headline: string; body: string }, subjectId: string): Promise<boolean> {
  const bNames = pairNames(b.headline);
  const shared = [...pairNames(a.headline)].some((name) => bNames.has(name));
  if (!shared) return false;
  const res = await jev(
    { state: { story_a: { headline: a.headline, untrusted_content: a.body.slice(0, MERGE_BODY_CHARS) }, story_b: { headline: b.headline, untrusted_content: b.body.slice(0, MERGE_BODY_CHARS) } }, questions: SAME_EVENT.questions },
    { version: SAME_EVENT.version, subjectId },
  );
  return (res.answers.same_event?.noul ?? 0) >= SAME_EVENT_BAR;
}

/** Keep the stronger article (the longer body); carry every source id, outlet and the best scores. */
function fold(into: LfdCandidate, from: LfdCandidate): LfdCandidate {
  // A person's seed keeps its own article, url and origin: it absorbs the duplicate rather than being replaced by it.
  const keep = into.yours ? into : from.yours ? from : from.body.length > into.body.length ? from : into;
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
    builder: max(into.builder ?? null, from.builder ?? null),
    eventDate: into.eventDate ?? from.eventDate ?? null,
    firstSeen: into.firstSeen ?? from.firstSeen,
    ...(into.yours || from.yours ? { yours: true, origin: 'seed' as const } : {}),
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

/** Leads (majors and builders) by margin, then the rundown in rank order (spec §4.2: slides in rank order). */
export function slideOrder(picks: Pick[], now: Date = new Date()): Pick[] {
  const margin = (p: Pick) => leadFor(p, now)?.margin ?? (p.lane === 'major' ? (p.major ?? 0) - 1 : -1);
  const leads = picks.filter((p) => p.lane !== 'rundown').sort((a, b) => margin(b) - margin(a));
  const rundown = picks.filter((p) => p.lane === 'rundown').sort(rundownOrder);
  return [...leads, ...rundown];
}

type LeadEntry = { c: LfdCandidate; lane: 'major' | 'builder'; margin: number };

export class Selector {
  readonly picks: Pick[] = [];
  /** Majors and builders together, by leadOf margin (a tie keeps input order). */
  private readonly leads: LeadEntry[];
  private readonly rundown: LfdCandidate[];
  private readonly tried = new Set<string>();
  private readonly forced: LfdCandidate[];
  /** Seeds taken that the last post already covered (they are taken anyway; the run records it). */
  readonly repeats = new Set<string>();

  constructor(
    /** Lead candidates: anything with a major-news or story-builder score (leadOf decides which clear). */
    leads: LfdCandidate[],
    rundown: LfdCandidate[],
    private readonly previous: Array<{ headline: string; body: string }>,
    private readonly jev: JevAsk,
    /** A person's seeds, taken before the lanes (up to MAX_SEEDS), oldest first. They skip the company cap and the repeat check. */
    forced: LfdCandidate[] = [],
    /** The builder window (7 days) is measured from here. */
    private readonly now: Date = new Date(),
  ) {
    this.forced = forced.slice(0, MAX_SEEDS);
    this.leads = leads
      .map((c) => ({ c, lead: leadFor(c, now) }))
      .filter((x): x is { c: LfdCandidate; lead: NonNullable<ReturnType<typeof leadFor>> } => x.lead !== null)
      .map(({ c, lead }) => ({ c, lane: lead.lane, margin: lead.margin }))
      .sort((a, b) => b.margin - a.margin);
    this.rundown = [...rundown].sort(rundownOrder);
  }

  /** The lane a seed takes: its lead lane, else the rundown. */
  laneOf(c: LfdCandidate): Lane {
    return leadFor(c, this.now)?.lane ?? 'rundown';
  }

  async fill(): Promise<Pick[]> {
    for (const c of this.forced) {
      if (this.picks.some((p) => p.key === c.key || p.refs.some((r) => c.refs.includes(r)))) continue;
      this.tried.add(c.key);
      if (await this.coveredLastTime(c)) this.repeats.add(c.key);
      this.picks.push({ ...c, lane: this.laneOf(c) });
    }
    while (this.picks.length < MAX_STORIES) {
      if (!(await this.take('lead'))) break;
    }
    while (this.picks.length < MAX_STORIES) {
      if (!(await this.take('rundown'))) break;
    }
    return [...this.picks];
  }

  /** The head of a lane's queue, for the run record (spec §8 Ideas view). */
  top(lane: Lane, n: number): LfdCandidate[] {
    return (lane === 'rundown' ? this.rundown : this.leads.filter((x) => x.lane === lane).map((x) => x.c)).slice(0, n);
  }

  /**
   * Unused leads (by margin) then unused rundown (by net), skipping `skip` keys and
   * shared refs. The meme-pool scan uses this when the lineup has no 92% story.
   */
  unused(n: number, skip: Iterable<string>): LfdCandidate[] {
    const blocked = new Set(skip);
    const out: LfdCandidate[] = [];
    for (const c of [...this.leads.map((x) => x.c), ...this.rundown]) {
      if (blocked.has(c.key) || c.refs.some((r) => blocked.has(r))) continue;
      blocked.add(c.key);
      c.refs.forEach((r) => blocked.add(r));
      out.push(c);
      if (out.length >= n) break;
    }
    return out;
  }

  /** Take a story that the meme scan added, so a later replace will not pick it again. */
  adopt(c: LfdCandidate, lane: Lane): Pick {
    this.tried.add(c.key);
    const pick: Pick = { ...c, lane };
    this.picks.push(pick);
    return pick;
  }

  drop(key: string): void {
    const i = this.picks.findIndex((p) => p.key === key);
    if (i !== -1) this.picks.splice(i, 1);
  }

  /** The next story for a dropped slot: its own lane first, then the lead queue, then the rundown. */
  async replace(lane: Lane): Promise<Pick | null> {
    const order: Array<Lane | 'lead'> = lane === 'rundown' ? ['rundown', 'lead'] : [lane, 'lead', 'rundown'];
    for (const from of order) {
      const pick = await this.take(from);
      if (pick) return pick;
    }
    return null;
  }

  private majorsFull(): boolean {
    return this.picks.filter((p) => p.lane === 'major').length >= MAX_MAJOR;
  }

  private queue(from: Lane | 'lead'): Array<{ c: LfdCandidate; lane: Lane }> {
    if (from === 'rundown') return this.rundown.map((c) => ({ c, lane: 'rundown' as const }));
    const leads = from === 'lead' ? this.leads : this.leads.filter((x) => x.lane === from);
    return leads.map(({ c, lane }) => ({ c, lane }));
  }

  private async take(from: Lane | 'lead'): Promise<Pick | null> {
    for (const { c, lane } of this.queue(from)) {
      // Majors stay capped at MAX_MAJOR (builders are not): a capped major stays eligible for a later replacement.
      if (lane === 'major' && this.majorsFull()) continue;
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
