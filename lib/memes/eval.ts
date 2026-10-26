/**
 * The graded set and the measures the upgrade is held to
 * (planning/Memes/UPGRADE_PLAN.md U0). The set is exported from the lab's
 * local database by scripts/memes_eval_export.ts into .memes-local/eval/
 * (ME-108, never committed). Everything here is pure: scripts and tests
 * read a set and get numbers back, with no model calls.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { Brief } from '@/lib/social/reporter/brief';

import type { SlotFill } from './fill';
import { lintFills, nameContext, writtenChars, type LintHit, type LintKind } from './lint';

export const EVAL_DIR = path.join(process.cwd(), '.memes-local', 'eval');

export type Rating = 1 | 2 | 3 | 4;

export type EvalMeme = {
  id: string;
  runId: string;
  kind: string;
  /** Which pipeline wrote it ('v2' before the upgrade). */
  pipeline: string;
  storyIds: string[];
  headline: string;
  templateId: string;
  situationId: string | null;
  turnId: string | null;
  turnType: string | null;
  /** The golden-card pattern the writer named (v4 on); null before. */
  pattern: string | null;
  inSlate: boolean;
  rank: number | null;
  relation: string;
  fills: SlotFill[];
  why: Record<string, string>;
  judges: Record<string, unknown>;
  dropped: string | null;
  belowBar: string | null;
  imagePath: string | null;
  rating: Rating | null;
  tags: string[];
  note: string | null;
};

export type EvalStory = { id: string; headline: string; briefSource: string | null; bodyChars: number | null; brief: Brief | null };

export type EvalRun = {
  id: string; kind: string; status: string; requestedAt: string; costUsd: number;
  storyIds: string[]; pipeline: string; shape: Record<string, unknown> | null;
};

export type EvalSet = { version: 1; exportedAt: string; runs: EvalRun[]; stories: EvalStory[]; memes: EvalMeme[] };

export function loadEvalSet(file: string): EvalSet {
  const set = JSON.parse(fs.readFileSync(file, 'utf8')) as EvalSet;
  if (set.version !== 1) throw new Error(`${file}: unknown eval set version ${String(set.version)}`);
  return set;
}

/** The newest graded-*.json in the eval folder, or null. */
export function latestEvalFile(dir = EVAL_DIR): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^graded-.*\.json$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]!) : null;
}

export const isGood = (r: Rating) => r >= 3;
export const ratedMemes = (set: EvalSet, pipeline?: string) =>
  set.memes.filter((m): m is EvalMeme & { rating: Rating } => m.rating != null && (!pipeline || m.pipeline === pipeline));

export type Split = { n: number; good: number; rate: number | null };
export const split = (ratings: Rating[]): Split => {
  const good = ratings.filter(isGood).length;
  return { n: ratings.length, good, rate: ratings.length ? good / ratings.length : null };
};

/**
 * Within a slate, how often a score orders two differently rated memes the
 * way Lucas did. Ties on either side are skipped. Chance is 50%.
 */
export function slateConcordance(memes: Array<EvalMeme & { rating: Rating }>, score: (m: EvalMeme) => number | null): { agree: number; pairs: number } {
  const bySlate = new Map<string, Array<EvalMeme & { rating: Rating }>>();
  for (const m of memes) bySlate.set(m.runId, [...(bySlate.get(m.runId) ?? []), m]);
  let agree = 0;
  let pairs = 0;
  for (const group of bySlate.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const sa = score(a);
        const sb = score(b);
        if (a.rating === b.rating || sa == null || sb == null || sa === sb) continue;
        pairs += 1;
        if ((sa - sb) * (a.rating - b.rating) > 0) agree += 1;
      }
    }
  }
  return { agree, pairs };
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export type Baseline = {
  rated: number;
  ratings: Record<Rating, number>;
  good: Split;
  slates: number;
  slatesWithGood: number;
  slatesWithAwesome: number;
  zeroGoodStories: string[];
  byRank: Record<string, Split>;
  judges: Record<string, { agree: number; pairs: number }>;
  byChars: Record<string, Split>;
  meanCharsByRating: Record<Rating, number>;
  templateRuns: Array<{ templateId: string; runs: number }>;
  runs: number;
  dropRate: number;
  meanCostUsd: number;
};

const CHAR_BUCKETS: Array<[string, number, number]> = [['0-40', 0, 40], ['40-80', 40, 80], ['80-120', 80, 120], ['120+', 120, Infinity]];

/** The baseline numbers the upgrade plan quotes, recomputed from a set. */
export function baseline(set: EvalSet, pipeline?: string): Baseline {
  const rated = ratedMemes(set, pipeline);
  const ratings = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Rating, number>;
  for (const m of rated) ratings[m.rating] += 1;
  const bySlate = new Map<string, Array<EvalMeme & { rating: Rating }>>();
  for (const m of rated) bySlate.set(m.runId, [...(bySlate.get(m.runId) ?? []), m]);
  const slates = [...bySlate.values()];
  const byRank: Record<string, Split> = {};
  for (const r of [1, 2, 3]) byRank[String(r)] = split(rated.filter((m) => m.rank === r).map((m) => m.rating));
  const judges: Baseline['judges'] = {};
  for (const k of ['funny', 'relevant', 'accurate', 'clear', 'fit', 'turn_visible', 'legible', 'format_true', 'punch_last', 'score']) {
    const c = slateConcordance(rated, (m) => num(m.judges[k]));
    if (c.pairs) judges[k] = c;
  }
  const byChars: Record<string, Split> = {};
  for (const [label, lo, hi] of CHAR_BUCKETS) byChars[label] = split(rated.filter((m) => writtenChars(m.fills) >= lo && writtenChars(m.fills) < hi).map((m) => m.rating));
  const meanCharsByRating = {} as Record<Rating, number>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const xs = rated.filter((m) => m.rating === r).map((m) => writtenChars(m.fills));
    meanCharsByRating[r] = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  }
  const runs = set.runs.filter((r) => r.status === 'ok' && (!pipeline || r.pipeline === pipeline));
  const all = set.memes.filter((m) => !pipeline || m.pipeline === pipeline);
  const usedBy = new Map<string, Set<string>>();
  for (const m of all) usedBy.set(m.templateId, (usedBy.get(m.templateId) ?? new Set()).add(m.runId));
  const judged = all.filter((m) => m.dropped || m.inSlate);
  return {
    rated: rated.length,
    ratings,
    good: split(rated.map((m) => m.rating)),
    slates: slates.length,
    slatesWithGood: slates.filter((g) => g.some((m) => isGood(m.rating))).length,
    slatesWithAwesome: slates.filter((g) => g.some((m) => m.rating === 4)).length,
    zeroGoodStories: slates.filter((g) => !g.some((m) => isGood(m.rating))).map((g) => g[0]!.headline),
    byRank,
    judges,
    byChars,
    meanCharsByRating,
    templateRuns: [...usedBy.entries()].map(([templateId, s]) => ({ templateId, runs: s.size })).sort((a, b) => b.runs - a.runs),
    runs: runs.length,
    dropRate: judged.length ? all.filter((m) => m.dropped?.startsWith('judges')).length / all.length : 0,
    meanCostUsd: runs.length ? runs.reduce((a, r) => a + r.costUsd, 0) / runs.length : 0,
  };
}

/** Lint hits for one graded meme, with its story's names. */
export function lintEvalMeme(set: EvalSet, m: EvalMeme, opts: { budget?: number; slotCap?: number } = {}): LintHit[] {
  const story = set.stories.find((s) => m.storyIds.includes(s.id));
  return lintFills(m.fills, { ...opts, names: nameContext(m.headline, story?.brief ?? null) });
}

export type LintSplit = { kind: string; hit: Split; clean: Split };

/** For each lint (and each length setting), the good rate of rated memes with and without a hit. */
export function lintSplits(set: EvalSet, pipeline?: string): LintSplit[] {
  const rated = ratedMemes(set, pipeline);
  const out: LintSplit[] = [];
  const by = (label: string, hitOf: (m: EvalMeme) => boolean) => {
    out.push({
      kind: label,
      hit: split(rated.filter(hitOf).map((m) => m.rating)),
      clean: split(rated.filter((m) => !hitOf(m)).map((m) => m.rating)),
    });
  };
  for (const kind of ['hedge', 'narration', 'obscure-name'] as LintKind[]) by(kind, (m) => lintEvalMeme(set, m).some((h) => h.kind === kind));
  for (const budget of [60, 80, 90, 100]) by(`length: total > ${budget}`, (m) => writtenChars(m.fills) > budget);
  for (const cap of [40, 50]) by(`length: a slot > ${cap}`, (m) => m.fills.some((f) => f.kind !== 'entity' && f.text.length > cap));
  by('any of hedge, narration, obscure name', (m) => lintEvalMeme(set, m).some((h) => h.kind !== 'length'));
  return out;
}

export const pctOf = (s: Split) => (s.rate == null ? '–' : `${Math.round(s.rate * 100)}%`);
