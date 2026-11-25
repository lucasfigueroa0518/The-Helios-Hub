/**
 * Lab metrics (D7) and the mix sweep (D9). Pure: no DB, no calls.
 */
import type { LabTag, VariantMetrics } from '@/lib/news-ranker/types';

export type ScoreRow = {
  storyId: string;
  cool: number | null;
  needToKnow: number | null;
  /** The variant's own mixed score (or lead margin). */
  mixed: number;
  gatePass: boolean;
  finalPosition: number | null;
};

export const MIX_SWEEP = [0, 0.25, 0.5, 0.75, 1] as const;

/** score = w·cool + (1−w)·need; a failed gate sinks to −1. */
export function mixScore(row: Pick<ScoreRow, 'cool' | 'needToKnow' | 'gatePass'>, w: number): number {
  if (!row.gatePass) return -1;
  return w * (row.cool ?? 0) + (1 - w) * (row.needToKnow ?? 0);
}

const byScoreThenId = (a: { s: number; id: string }, b: { s: number; id: string }) => b.s - a.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The variant's own order: final position first (when set), then mixed desc, ties by id. */
export function ownOrder(rows: readonly ScoreRow[]): string[] {
  const finals = rows.filter((r) => r.finalPosition != null).sort((a, b) => a.finalPosition! - b.finalPosition!);
  const rest = rows.filter((r) => r.finalPosition == null).map((r) => ({ s: r.gatePass ? r.mixed : -Infinity, id: r.storyId })).sort(byScoreThenId);
  return [...finals.map((r) => r.storyId), ...rest.map((r) => r.id)];
}

/** Order by the mix at weight w (scores only; no final order). */
export function mixOrder(rows: readonly ScoreRow[], w: number): string[] {
  return rows.map((r) => ({ s: mixScore(r, w), id: r.storyId })).sort(byScoreThenId).map((x) => x.id);
}

/** Mean of a 0–10 rating over the first k RATED stories in the order (unrated are skipped). 0 rated → 0. */
export function meanAt(order: readonly string[], tags: ReadonlyMap<string, LabTag>, k: number, value: (t: LabTag) => number): number {
  const top = order.filter((id) => tags.has(id)).slice(0, k);
  if (!top.length) return 0;
  return round(top.reduce((a, id) => a + value(tags.get(id)!), 0) / top.length);
}

/** Share of the first k rated stories for which `hit` holds. */
export function shareAt(order: readonly string[], tags: ReadonlyMap<string, LabTag>, k: number, hit: (t: LabTag) => boolean): number {
  const top = order.filter((id) => tags.has(id)).slice(0, k);
  return top.length ? round(top.filter((id) => hit(tags.get(id)!)).length / top.length) : 0;
}

/** Average ranks (1-based, ties share the mean rank). */
const ranks = (xs: readonly number[]): number[] => {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array<number>(xs.length);
  for (let a = 0; a < idx.length;) {
    let b = a;
    while (b + 1 < idx.length && idx[b + 1]!.x === idx[a]!.x) b++;
    for (let k = a; k <= b; k++) r[idx[k]!.i] = (a + b) / 2 + 1;
    a = b + 1;
  }
  return r;
};

/**
 * Spearman correlation between the variant's order (earlier = better) and a
 * rating, over rated stories only. Fewer than 3 rated, or no spread → 0.
 */
export function rankCorrelation(order: readonly string[], tags: ReadonlyMap<string, LabTag>, value: (t: LabTag) => number): number {
  const rated = order.filter((id) => tags.has(id));
  if (rated.length < 3) return 0;
  const a = ranks(rated.map((_, i) => -i));
  const b = ranks(rated.map((id) => value(tags.get(id)!)));
  const n = a.length, ma = (n + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i]! - ma) * (b[i]! - ma); da += (a[i]! - ma) ** 2; db += (b[i]! - ma) ** 2; }
  return da && db ? round(num / Math.sqrt(da * db)) : 0;
}

export function metricsFor(variantId: string, mixCool: number, order: readonly string[], tags: ReadonlyMap<string, LabTag>): VariantMetrics {
  const cool = (t: LabTag) => t.cool;
  const need = (t: LabTag) => t.needToKnow;
  const blend = (t: LabTag) => mixCool * t.cool + (1 - mixCool) * t.needToKnow;
  const m = (v: (t: LabTag) => number) => ({ at5: meanAt(order, tags, 5, v), at10: meanAt(order, tags, 10, v) });
  return {
    variantId,
    mixCool,
    meanCool: m(cool),
    meanNeed: m(need),
    meanBlend: m(blend),
    rankCorr: { cool: rankCorrelation(order, tags, cool), need: rankCorrelation(order, tags, need), blend: rankCorrelation(order, tags, blend) },
    noShareTop5: shareAt(order, tags, 5, (t) => t.cool <= 2 && t.needToKnow <= 2),
  };
}

/** Free once scores exist: metrics at every sweep weight. */
export function mixSweep(variantId: string, rows: readonly ScoreRow[], tags: ReadonlyMap<string, LabTag>): VariantMetrics[] {
  return MIX_SWEEP.map((w) => metricsFor(variantId, w, mixOrder(rows, w), tags));
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;
