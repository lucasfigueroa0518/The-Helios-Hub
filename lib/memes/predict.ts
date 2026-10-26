/**
 * The pre-generation predictor: from a story's inputs, before any meme is
 * written, how likely is the run to give a strong slate? Two stages:
 *
 *   story  features of the story and its brief, known before the run
 *   turns  plus the turns step 1 kept, known before any meme is drafted
 *
 * Integrity rules (Lucas, 2026-10-17; planning/Memes/PREDICTOR.md):
 * - It learns only from runs of one regime (lib/memes/regime.ts) and predicts
 *   only for that regime. Mixing regimes, or predicting for a changed system,
 *   is refused, not warned about.
 * - The outcome is Lucas's grades, never the judges.
 * - The features are fixed before looking at outcomes; nothing is selected on
 *   the data it is evaluated on. Evaluation is leave-one-out, and a model is
 *   only allowed to predict once it beats the base rate out of sample on
 *   enough runs (MIN_RUNS).
 * - The runner saves each run's features before its memes are written, so
 *   every later prediction can be checked prospectively.
 * Pure; no model calls.
 */
import type { Brief } from '@/lib/social/reporter/brief';

import type { EvalSet } from './eval';
import { INCIDENT, nameContext } from './lint';
import { runRegime } from './regime';
import { playersInStory, type MemeStory } from './story';

// ── Features ────────────────────────────────────────────────────────────────


export type StoryFeatures = {
  /** The brief was made from the carousel's own short copy, not from the article body. */
  copyBrief: number;
  facts: number;
  quotes: number;
  numbers: number;
  tensions: number;
  claims: number;
  /** Share of facts that hold a digit. */
  numericFacts: number;
  /** Blue-chip players the brief names. */
  players: number;
  /** The headline or the news line reads as harm, crime or the courts. */
  incident: number;
  headlineChars: number;
  /**
   * Capitalized names in the headline (after its first word) that a casual
   * follower would not know: not a blue chip, not a household name. Added
   * 2026-10-18 from Lucas's observation (UPGRADE_V5 U8), before any v5 grade;
   * scored prospectively only.
   */
  headlineUnknownNames: number;
  /** Blue-chip players the headline itself names. */
  headlinePlayers: number;
};

export type TurnFeatures = {
  turnsKept: number;
  turnTypes: number;
  meanStrength: number;
  /** A kept turn lands in the viewer's own day. */
  viewerTurn: number;
  /** Mean characters per beat across kept turns. */
  beatChars: number;
  /** Share of beats that hold a digit. */
  numericBeats: number;
};

export const STORY_FEATURES = ['copyBrief', 'facts', 'quotes', 'numbers', 'tensions', 'claims', 'numericFacts', 'players', 'incident', 'headlineChars', 'headlineUnknownNames', 'headlinePlayers'] as const;

/** What a follower knows without the story: blue chips and household names only. */
const KNOWN = nameContext('', null).known;

/**
 * Names in a headline a casual follower would not know. In a title-case
 * headline every word is capitalized, so only name-shaped words count there:
 * acronyms, inner capitals or digits ("xAI", "GPT-6", "DeepSeek-v4.1"). In a
 * sentence-case headline, any capitalized word after the first counts.
 */
export function unknownHeadlineNames(title: string): number {
  const words = title.split(/\s+/).map((w) => w.replace(/[’']s$/, '').replace(/[^A-Za-z0-9.-]/g, '')).filter(Boolean);
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
  const titleCase = words.length >= 4 && caps / words.length >= 0.6;
  const nameShaped = (w: string) => /[A-Z].*[A-Z]|\d|^[a-z]+[A-Z]/.test(w);
  return words
    .slice(1)
    .filter((w) => w.length > 1 && (titleCase ? nameShaped(w) : /^[A-Z]/.test(w) || nameShaped(w)))
    .filter((w) => !KNOWN.has(w.toLowerCase().replace(/[.-]/g, ''))).length;
}
export const TURN_FEATURES = ['turnsKept', 'turnTypes', 'meanStrength', 'viewerTurn', 'beatChars', 'numericBeats'] as const;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function storyFeatures(story: Pick<MemeStory, 'title' | 'brief'>): StoryFeatures {
  const b = story.brief as Brief & { single_story?: { note?: string | null } };
  const facts = [...(b.facts ?? []), ...(b.background ?? [])];
  return {
    copyBrief: /copy/i.test(b.single_story?.note ?? '') ? 1 : 0,
    facts: b.facts?.length ?? 0,
    quotes: b.quotes?.length ?? 0,
    numbers: b.numbers?.length ?? 0,
    tensions: (b as { tensions?: unknown[] }).tensions?.length ?? 0,
    claims: facts.filter((f) => f.claim_by).length,
    numericFacts: facts.length ? facts.filter((f) => /\d/.test(f.text)).length / facts.length : 0,
    players: playersInStory(b).length,
    incident: INCIDENT.test(`${story.title} ${b.the_news?.text ?? ''}`) ? 1 : 0,
    headlineChars: story.title.length,
    headlineUnknownNames: unknownHeadlineNames(story.title),
    headlinePlayers: playersInStory({ facts: [{ id: 'H', text: story.title, sources: [], claim_by: null, notes: [] }] } as unknown as Brief).length,
  };
}

/** The turns as a run saves them (shape.turns). */
export type SavedTurn = { kept?: boolean; type: string; strength?: number; touchesViewer?: boolean; beats?: Array<{ text: string }> };

export function turnFeatures(turns: readonly SavedTurn[]): TurnFeatures {
  const kept = turns.filter((t) => t.kept);
  const beats = kept.flatMap((t) => t.beats ?? []);
  return {
    turnsKept: kept.length,
    turnTypes: new Set(kept.map((t) => t.type)).size,
    meanStrength: mean(kept.map((t) => t.strength ?? 0)),
    viewerTurn: kept.some((t) => t.touchesViewer) ? 1 : 0,
    beatChars: mean(beats.map((x) => x.text.length)),
    numericBeats: beats.length ? beats.filter((x) => /\d/.test(x.text)).length / beats.length : 0,
  };
}

// ── The dataset ─────────────────────────────────────────────────────────────

export type PredictRow = {
  runId: string;
  storyId: string;
  regime: string;
  headline: string;
  story: StoryFeatures;
  turns: TurnFeatures;
  /** Exploratory features joined by story id (Hub scores, the story probe); null when unknown. */
  extra: Record<string, number | null>;
  /** Graded slate memes, and how many were Yes or Awesome. */
  graded: number;
  good: number;
  best: number;
  /** The outcome: at least two thirds of the graded slate is good. */
  strong: boolean;
};

/**
 * One row per single-story run of the regime whose slate Lucas graded. Runs of
 * any other regime, or of none, are left out: they are a different system.
 */
export function predictRows(set: EvalSet, regime: string, extra: Record<string, Record<string, number | null>> = {}): PredictRow[] {
  const stories = new Map(set.stories.map((s) => [s.id, s]));
  const out: PredictRow[] = [];
  for (const run of set.runs) {
    if (run.kind !== 'single' || run.status !== 'ok' || runRegime(run) !== regime) continue;
    const s = stories.get(run.storyIds[0] ?? '');
    if (!s?.brief) continue;
    const rated = set.memes.filter((m) => m.runId === run.id && m.inSlate && m.rating != null);
    if (!rated.length) continue;
    const good = rated.filter((m) => m.rating! >= 3).length;
    out.push({
      runId: run.id,
      storyId: s.id,
      regime,
      headline: s.headline,
      story: storyFeatures({ title: s.headline, brief: s.brief }),
      turns: turnFeatures(((run.shape?.turns as SavedTurn[] | undefined) ?? [])),
      extra: extra[s.id] ?? {},
      graded: rated.length,
      good,
      best: Math.max(...rated.map((m) => m.rating!)),
      strong: good / rated.length >= 2 / 3,
    });
  }
  return out;
}

// ── Measures ────────────────────────────────────────────────────────────────

/** How often a score ranks a strong run above a weak one (0.5 is chance). */
export function auc(scores: number[], labels: boolean[]): number | null {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return null;
  let w = 0;
  for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

/**
 * Exploratory features, joined from outside the run (planning/Memes/PREDICTOR.md):
 * the Hub's own story scores and the story probe's four Jev questions. They
 * were not fixed before the v5 grades were read (the probe's questions were,
 * but they are new), so they are reported as hypotheses until a later graded
 * batch confirms them, and they never enter the fixed model.
 */
export const EXPLORATORY_FEATURES = ['hubNet', 'hubBlockbuster', 'carouselRank', 'probeKnownEntities', 'probeTwist', 'probeHarm', 'probeNiche'] as const;

export type FeatureKey = (typeof STORY_FEATURES)[number] | (typeof TURN_FEATURES)[number] | (typeof EXPLORATORY_FEATURES)[number];
export const featureValue = (r: PredictRow, k: FeatureKey): number => {
  if (k in r.story) return r.story[k as keyof StoryFeatures];
  if (k in r.turns) return r.turns[k as keyof TurnFeatures];
  return r.extra[k] ?? Number.NaN;
};
const known = (v: number) => !Number.isNaN(v);

/** Each feature alone: its AUC for a strong slate. Exploration only; never used to pick the model's features. */
export function univariate(rows: PredictRow[], keys: readonly FeatureKey[]): Array<{ feature: FeatureKey; auc: number | null }> {
  return keys.map((k) => {
    const have = rows.filter((r) => known(featureValue(r, k)));
    return { feature: k, auc: auc(have.map((r) => featureValue(r, k)), have.map((r) => r.strong)) };
  });
}

export type SplitSignal = { feature: FeatureKey; n: number; all: number | null; a: number | null; b: number | null; consistent: boolean };

/**
 * A feature's AUC on all rows and on two halves (the natural held-out split:
 * stories the system had seen before vs brand-new ones). It counts as
 * consistent only when both halves lean the same way.
 */
export function splitSignals(rows: PredictRow[], keys: readonly FeatureKey[], inB: (r: PredictRow) => boolean): SplitSignal[] {
  return keys.map((k) => {
    const have = rows.filter((r) => known(featureValue(r, k)));
    const a = (sub: PredictRow[]) => auc(sub.map((r) => featureValue(r, k)), sub.map((r) => r.strong));
    const all = a(have);
    const ha = a(have.filter((r) => !inB(r)));
    const hb = a(have.filter(inB));
    return { feature: k, n: have.length, all, a: ha, b: hb, consistent: ha != null && hb != null && (ha - 0.5) * (hb - 0.5) > 0 };
  });
}

/** A 90% Wilson interval for k successes in n. */
export function wilson(k: number, n: number, z = 1.645): [number, number] {
  if (!n) return [0, 0];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [c - h, c + h];
}

export type ScreenResult = { rule: string; passes: number; of: number; strong: number; strongRate: number; ci: [number, number]; anyGood: number; baseRate: number };

/**
 * A screening rule as precision and coverage: of the stories that pass it,
 * how many gave a strong slate (with a 90% interval), and how many stories
 * pass at all. The base rate is the strong share of all rows.
 */
export function screen(rows: PredictRow[], rule: string, pass: (r: PredictRow) => boolean): ScreenResult {
  const sel = rows.filter(pass);
  const strong = sel.filter((r) => r.strong).length;
  return {
    rule, passes: sel.length, of: rows.length, strong, strongRate: sel.length ? strong / sel.length : 0,
    ci: wilson(strong, sel.length), anyGood: sel.filter((r) => r.good > 0).length,
    baseRate: rows.length ? rows.filter((r) => r.strong).length / rows.length : 0,
  };
}

/** A ridge-penalised logistic regression on standardised features: few parameters, nothing hidden. */
export type Model = { keys: FeatureKey[]; mu: number[]; sd: number[]; w: number[]; b: number };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function fitLogistic(rows: PredictRow[], keys: readonly FeatureKey[], lambda = 1, iters = 2000, lr = 0.1): Model {
  const X = rows.map((r) => keys.map((k) => featureValue(r, k)));
  const mu = keys.map((_, j) => mean(X.map((x) => x[j]!)));
  const sd = keys.map((_, j) => Math.sqrt(mean(X.map((x) => (x[j]! - mu[j]!) ** 2))) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]!) / sd[j]!));
  const y = rows.map((r) => (r.strong ? 1 : 0));
  const w = keys.map(() => 0);
  let b = 0;
  const n = rows.length;
  for (let it = 0; it < iters; it++) {
    const gw = w.map((wj) => lambda * wj);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(b + Z[i]!.reduce((a, z, j) => a + z * w[j]!, 0));
      const e = p - y[i]!;
      gb += e;
      Z[i]!.forEach((z, j) => (gw[j]! += e * z));
    }
    for (let j = 0; j < w.length; j++) w[j]! -= (lr * gw[j]!) / n;
    b -= (lr * gb) / n;
  }
  return { keys: [...keys], mu, sd, w, b };
}

export const predictProb = (m: Model, r: PredictRow) => sigmoid(m.b + m.keys.reduce((a, k, j) => a + ((featureValue(r, k) - m.mu[j]!) / m.sd[j]!) * m.w[j]!, 0));

export type Evaluation = {
  runs: number;
  strong: number;
  /** Leave-one-out AUC of the model; null when one class is missing. */
  looAuc: number | null;
  /** Brier score of the model out of sample, and of always predicting the base rate. */
  brier: number;
  brierBaseRate: number;
  predictions: Array<{ runId: string; headline: string; p: number; strong: boolean }>;
};

/** Leave-one-out: each run is predicted by a model that never saw it. */
export function looEvaluate(rows: PredictRow[], keys: readonly FeatureKey[], lambda = 1): Evaluation {
  const predictions = rows.map((r, i) => {
    const rest = rows.filter((_, j) => j !== i);
    const base = rest.filter((x) => x.strong).length / rest.length;
    const p = rest.some((x) => x.strong) && rest.some((x) => !x.strong) ? predictProb(fitLogistic(rest, keys, lambda), r) : base;
    return { runId: r.runId, headline: r.headline, p, strong: r.strong, base };
  });
  const brier = mean(predictions.map((x) => (x.p - (x.strong ? 1 : 0)) ** 2));
  const brierBaseRate = mean(predictions.map((x) => (x.base - (x.strong ? 1 : 0)) ** 2));
  return {
    runs: rows.length,
    strong: rows.filter((r) => r.strong).length,
    looAuc: auc(predictions.map((x) => x.p), predictions.map((x) => x.strong)),
    brier,
    brierBaseRate,
    predictions: predictions.map(({ base: _base, ...x }) => x),
  };
}

/** Graded runs a regime needs before its model may predict at all. */
export const MIN_RUNS = 60;

export type Readiness = { ready: true } | { ready: false; reason: string };

/** May this regime's model predict? Only with enough runs and a leave-one-out score that beats the base rate. */
export function readiness(ev: Evaluation): Readiness {
  if (ev.runs < MIN_RUNS) return { ready: false, reason: `${ev.runs} graded runs; it needs ${MIN_RUNS}` };
  if (ev.looAuc == null || ev.looAuc < 0.65) return { ready: false, reason: `leave-one-out AUC ${ev.looAuc?.toFixed(2) ?? 'n/a'}; it needs 0.65` };
  if (ev.brier >= ev.brierBaseRate) return { ready: false, reason: 'it does not beat the base rate out of sample' };
  return { ready: true };
}
