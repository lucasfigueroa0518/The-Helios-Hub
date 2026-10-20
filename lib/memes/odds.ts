/**
 * The pre-generation odds (LFD lab plan §2): a story's chance that its slate
 * will hold at least one good meme (rated Yes or Awesome), from the success
 * rates of stories with the same traits.
 *
 * A story falls in one of 8 cells: tension (built-in irony or a launch) ×
 * number story × short headline. A cell's rate is shrunk toward its parent
 * cell, so a cell with few graded stories leans on the broader evidence:
 *
 *   p(cell) = (good + K·p(parent)) / (n + K)
 *
 * The chain is base → (tension) → (tension, number) → (tension, number, short).
 * There is nothing to fit: the counts are recomputed from the grades on every
 * read, so each new grade counts at once.
 *
 * Integrity (PREDICTOR.md): rows come from one generation regime and one
 * tagger version only; the caller filters them (odds-store.ts).
 */
import type { StoryTags } from './story-tags';

export const SHRINK_K = 4;
export const MAX_MEME_STORIES = 3;
export const DEFAULT_GATE_THRESHOLD = 0.92;
/**
 * A story passes only when its own cell has at least this many graded stories: shrinkage lets an empty cell
 * borrow its parent's rate, which is fine for showing odds but not for an "extremely reliable" gate. Every
 * cell is meant to reach this count through grading (see the lab's evidence table), so no kind of story
 * stays out for lack of examples.
 */
export const MIN_CELL_N = 5;

/** One graded story: its tags and whether its slate held a good meme. */
export type OddsRow = { storyId: string; tags: Pick<StoryTags, 'irony' | 'launch' | 'numberStory' | 'shortHeadline' | 'conflict'>; anyGood: boolean };

export type Tally = { good: number; n: number };
export type Level = { key: string; label: string; good: number; n: number; p: number };
export type Odds = { p: number; chain: Level[]; why: string };
export type OddsModel = { base: Tally; tallies: Map<string, Tally>; rows: number };

type Traits = Pick<StoryTags, 'irony' | 'launch' | 'numberStory' | 'shortHeadline'>;

export const tension = (t: Pick<StoryTags, 'irony' | 'launch'>) => t.irony || t.launch;

const LEVELS: Array<{ key: (t: Traits) => string; label: (t: Traits) => string }> = [
  { key: (t) => `t${+tension(t)}`, label: (t) => (tension(t) ? 'irony or a launch' : 'no irony, not a launch') },
  { key: (t) => `t${+tension(t)}n${+t.numberStory}`, label: (t) => (t.numberStory ? 'a number story' : 'not a number story') },
  { key: (t) => `t${+tension(t)}n${+t.numberStory}s${+t.shortHeadline}`, label: (t) => (t.shortHeadline ? 'short headline' : 'long headline') },
];

export function fitOdds(rows: OddsRow[]): OddsModel {
  const tallies = new Map<string, Tally>();
  const base: Tally = { good: 0, n: 0 };
  for (const r of rows) {
    base.n += 1;
    base.good += +r.anyGood;
    for (const lv of LEVELS) {
      const k = lv.key(r.tags);
      const t = tallies.get(k) ?? { good: 0, n: 0 };
      t.n += 1;
      t.good += +r.anyGood;
      tallies.set(k, t);
    }
  }
  return { base, tallies, rows: rows.length };
}

/** With no graded stories at all the odds are 0: nothing passes a gate on no evidence. */
export function oddsFor(model: OddsModel, t: Traits): Odds {
  let p = model.base.n ? model.base.good / model.base.n : 0;
  const chain: Level[] = [{ key: 'all', label: 'all graded stories', good: model.base.good, n: model.base.n, p }];
  const labels: string[] = [];
  for (const lv of LEVELS) {
    const tally = model.tallies.get(lv.key(t)) ?? { good: 0, n: 0 };
    p = (tally.good + SHRINK_K * p) / (tally.n + SHRINK_K);
    labels.push(lv.label(t));
    chain.push({ key: lv.key(t), label: labels.join(', '), good: tally.good, n: tally.n, p });
  }
  const cell = chain[chain.length - 1]!;
  return { p, chain, why: `Stories with ${cell.label}: ${cell.good} of ${cell.n} had a good meme (${Math.round(100 * p)}% after shrinking toward the broader groups).` };
}

export type GateCandidate = { key: string; origIndex: number; tags: Traits };
export type GateResult = { key: string; odds: Odds; passes: boolean; chosen: boolean };

/** Whether odds clear the gate: the threshold, and enough graded stories in the story's own cell. */
export const clears = (o: Odds, threshold: number) => o.p >= threshold && (o.chain[o.chain.length - 1]?.n ?? 0) >= MIN_CELL_N;

/** Which stories get a slate: those that clear the gate, the best MAX_MEME_STORIES by odds (ties: original order). */
export function gate(model: OddsModel, stories: GateCandidate[], threshold: number, max = MAX_MEME_STORIES): GateResult[] {
  const scored = stories.map((s) => ({ s, odds: oddsFor(model, s.tags) }));
  const passing = scored.filter((x) => clears(x.odds, threshold)).sort((a, b) => b.odds.p - a.odds.p || a.s.origIndex - b.s.origIndex);
  const chosen = new Set(passing.slice(0, max).map((x) => x.s.key));
  return scored.map((x) => ({ key: x.s.key, odds: x.odds, passes: clears(x.odds, threshold), chosen: chosen.has(x.s.key) }));
}

/** Every cell with its counts and odds, for the lab's statistics panel. */
export function cellTable(model: OddsModel): Array<{ traits: Traits; odds: Odds }> {
  const out: Array<{ traits: Traits; odds: Odds }> = [];
  for (const t of [true, false]) for (const n of [false, true]) for (const s of [true, false]) {
    const traits: Traits = { irony: t, launch: false, numberStory: n, shortHeadline: s };
    out.push({ traits, odds: oddsFor(model, traits) });
  }
  return out;
}

export const FACTORS = ['irony', 'launch', 'tension', 'numberStory', 'shortHeadline', 'conflict'] as const;
export type Factor = (typeof FACTORS)[number];
const factorValue = (r: OddsRow, f: Factor) => (f === 'tension' ? tension(r.tags) : r.tags[f]);

/** Each factor's good-slate rate with and without it. */
export function factorTable(rows: OddsRow[]): Array<{ factor: Factor; with: Tally; without: Tally }> {
  return FACTORS.map((factor) => {
    const w: Tally = { good: 0, n: 0 };
    const wo: Tally = { good: 0, n: 0 };
    for (const r of rows) {
      const t = factorValue(r, factor) ? w : wo;
      t.n += 1;
      t.good += +r.anyGood;
    }
    return { factor, with: w, without: wo };
  });
}
