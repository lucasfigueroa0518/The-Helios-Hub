import { cacheCovered } from '@/lib/social-hub/cost-page/caching';
import { VENDOR_META, STAGE_META, type Stage, type VendorGroup } from '@/lib/social-hub/cost-page/normalize';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import type { Waste } from '@/lib/social-hub/cost-page/waste';
import type { Readiness } from '@/lib/social-hub/health/readiness';
import { addDays } from '@/lib/social-hub/time';
import type { HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';
import { VERTICALS, verticalInfo } from '@/lib/social-hub/verticals';

export type By = 'type' | 'vendor' | 'stage';
export type Series = { days: string[]; lead: number; keys: Array<{ id: string; label: string; color: string }>; values: number[][] };
export type Compare = { label: string; micros: number; change: 'new' | 'same' | 'up' | 'down'; pct: number | null };
export type Pace = { spentMicros: number; projectedMicros: number; watchMicros: number; underWatch: boolean };

const TYPE_COLOR: Record<Vertical, string> = { reels: '#14b8c4', explainers: '#4169e1', carousels: '#138510', stories: '#c377e0', last_few_days: '#e0529c', ai_events: '#b8860b' };

function keysFor(by: By) {
  if (by === 'type') return VERTICALS.map((v) => ({ id: v.id, label: v.label, color: TYPE_COLOR[v.id] }));
  if (by === 'vendor') return (Object.keys(VENDOR_META) as VendorGroup[]).map((id) => ({ id, ...VENDOR_META[id] }));
  return (Object.keys(STAGE_META) as Stage[]).map((id) => ({ id, ...STAGE_META[id] }));
}
const keyOf = (r: CostRow, by: By) => (by === 'type' ? r.vertical : by === 'vendor' ? r.vendor : r.stage);

/** `lead` is how many leading entries of `days` are look-back days before the range; the UI renders from index `lead`. */
export function dailySeries(rows: readonly CostRow[], days: readonly string[], by: By, lead = 0): Series {
  const keys = keysFor(by);
  const di = new Map(days.map((d, i) => [d, i]));
  const ki = new Map(keys.map((k, i) => [k.id, i]));
  const values = days.map(() => keys.map(() => 0));
  for (const r of rows) {
    const d = di.get(r.nyDate);
    const k = ki.get(keyOf(r, by));
    if (d !== undefined && k !== undefined) values[d]![k]! += r.micros;
  }
  return { days: [...days], lead, keys, values };
}

function compare(label: string, micros: number, history: number[]): Compare {
  const avg = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  if (avg <= 0) return { label, micros, change: micros > 0 ? 'new' : 'same', pct: null };
  const pct = Math.round(((micros - avg) / avg) * 100);
  return { label, micros, change: Math.abs(pct) <= 8 ? 'same' : pct > 0 ? 'up' : 'down', pct: Math.abs(pct) };
}

/** Each series vs its own average over the previous 7 days (spec §6.3). */
export function hoverCompare(s: Series, dayIndex: number): { total: Compare; parts: Compare[] } {
  const prev = s.values.slice(Math.max(0, dayIndex - 7), dayIndex);
  const parts = s.keys.map((k, j) => compare(k.label, s.values[dayIndex]![j]!, prev.map((d) => d[j]!)));
  const total = compare('Total', s.values[dayIndex]!.reduce((a, b) => a + b, 0), prev.map((d) => d.reduce((a, b) => a + b, 0)));
  return { total, parts };
}

export function spikeDrivers(rows: readonly CostRow[], day: string, days: readonly string[]) {
  const idx = days.indexOf(day);
  const prior = new Set(days.slice(Math.max(0, idx - 7), idx));
  const label = (r: CostRow) => `${verticalInfo(r.vertical).label} · ${STAGE_META[r.stage].label}`;
  const today = new Map<string, number>();
  const before = new Map<string, number>();
  for (const r of rows) {
    if (r.nyDate === day) today.set(label(r), (today.get(label(r)) ?? 0) + r.micros);
    else if (prior.has(r.nyDate)) before.set(label(r), (before.get(label(r)) ?? 0) + r.micros);
  }
  return [...today.entries()]
    .map(([l, micros]) => {
      const avg = prior.size ? (before.get(l) ?? 0) / prior.size : 0;
      return { label: l, micros, ratio: avg > 0 ? Math.round((micros / avg) * 10) / 10 : null };
    })
    .sort((a, b) => b.micros - a.micros)
    .slice(0, 4);
}

/** `month` ('YYYY-MM'): when it is not the current New York month the month is over, so there is nothing to project. */
export function pace(spentMicros: number, now: Date, watchMicros: number, month?: string): Pace {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now).map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const daysInMonth = new Date(Date.UTC(parts.year!, parts.month!, 0)).getUTCDate();
  const elapsed = Math.max(1, parts.day! - 1 + (parts.hour! % 24) / 24);
  const nyMonth = `${parts.year}-${String(parts.month).padStart(2, '0')}`;
  const closed = month !== undefined && month !== nyMonth;
  const projectedMicros = closed ? spentMicros : Math.round((spentMicros / elapsed) * daysInMonth);
  return { spentMicros, projectedMicros, watchMicros, underWatch: projectedMicros <= watchMicros };
}

const INTERACTIONS: Record<Vertical, MetricKey[]> = {
  reels: ['totalInteractions'], explainers: ['totalInteractions'], carousels: ['totalInteractions'],
  stories: ['replies', 'shares', 'follows', 'profileVisits'],
  last_few_days: ['totalInteractions'],
  ai_events: ['totalInteractions'],
};
export const KINDS: Array<{ key: MetricKey; label: string }> = [
  { key: 'likes', label: 'Like' }, { key: 'saved', label: 'Save' }, { key: 'shares', label: 'Share' },
  { key: 'comments', label: 'Comment' }, { key: 'replies', label: 'Reply' }, { key: 'follows', label: 'Follow' }, { key: 'profileVisits', label: 'Profile visit' },
];
export const interactionsOf = (p: HubPost) => INTERACTIONS[p.vertical].reduce((n, k) => n + (p.metrics[k] ?? 0), 0);

export type WorthModel = {
  byType: Array<{ vertical: Vertical; label: string; interactions: number; cpiMicros: number | null; kinds: Array<{ label: string; key: MetricKey; cpiMicros: number | null }> }>;
  best: { post: HubPost; interactions: number; cpiMicros: number } | null;
};

export type CostInput = {
  rows: CostRow[]; from: string; to: string; now: Date; vertical: Vertical | null; mode: 'production' | 'development';
  watchUsd: Record<Vertical, number>; posts: HubPost[]; waste: Waste; prevWastePct: number | null;
  readiness: Readiness[]; caching: { savedMicros: number; withoutMicros: number };
  monthTotals: Array<{ month: string; micros: number }>; bestEverCpi: Partial<Record<Vertical, number>>;
};

export type CostModel = {
  totalMicros: number; unknownCalls: number; headline: string; pace: Pace;
  chips: Array<{ id: string; text: string; best?: boolean }>;
  months: Array<{ month: string; label: string; under: boolean | null }>;
  series: Record<By, Series>; rows: CostRow[]; historyRows: CostRow[]; monthClosed: boolean;
  budget: Array<{ vertical: Vertical; label: string; spentMicros: number; watchMicros: number; projectedMicros: number; onPace: boolean }>;
  worth: WorthModel; waste: Waste & { pct: number; prevPct: number | null };
  rejection: Array<{ vertical: Vertical; label: string; rate: number | null }>;
  caching: { savedMicros: number; withoutMicros: number; covered: Vertical[] };
};

const usd0 = (m: number) => `$${Math.round(m / 1e6)}`;
const usd2 = (m: number) => `$${(m / 1e6).toFixed(2)}`;

function nyMonthOf(now: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function costModel(i: CostInput): CostModel {
  const rows = i.rows.filter((r) => r.mode === i.mode && (!i.vertical || r.vertical === i.vertical));
  const days = daysBetween(i.from, i.to);
  const LEAD = 7;
  const histDays = daysBetween(addDays(i.from, -LEAD), i.to);
  const historyRows = rows.filter((r) => r.nyDate >= histDays[0]! && r.nyDate <= i.to);
  const inRange = rows.filter((r) => r.nyDate >= i.from && r.nyDate <= i.to);
  const totalMicros = inRange.reduce((n, r) => n + r.micros, 0);
  const unknownCalls = inRange.filter((r) => r.unknown).length;
  const types = i.vertical ? VERTICALS.filter((v) => v.id === i.vertical) : VERTICALS;
  const month = i.to.slice(0, 7);
  const monthMicros = (v?: Vertical) => rows.filter((r) => r.nyDate.startsWith(month) && (!v || r.vertical === v)).reduce((n, r) => n + r.micros, 0);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const watch = (v: Vertical) => Math.round(i.watchUsd[v] * 1e6);
  const totalWatch = types.reduce((n, v) => n + watch(v.id), 0);
  const p = pace(monthMicros(i.vertical ?? undefined), i.now, totalWatch, month);
  const monthClosed = month !== nyMonthOf(i.now);
  const last = rows.filter((r) => r.nyDate === i.to).reduce((n, r) => n + r.micros, 0);
  const prior7 = histDays.slice(-8, -1).map((d) => rows.filter((r) => r.nyDate === d).reduce((n, r) => n + r.micros, 0));
  const avg7 = prior7.length ? prior7.reduce((a, b) => a + b, 0) / prior7.length : 0;
  const lastWord = avg7 <= 0 ? '' : Math.abs(last - avg7) / avg7 <= 0.15 ? ', about normal' : last > avg7 ? `, ${(last / avg7).toFixed(1)}× a normal day` : ', below normal';
  const wasteMicros = i.waste.rejected + i.waste.failed + i.waste.expired;
  const headline = `${monthClosed ? 'Came to' : 'On pace for'} ${usd0(p.projectedMicros)} ${monthClosed ? 'in the month' : 'this month'}, ${p.underWatch ? 'under' : 'over'} the ${usd0(totalWatch)} watch. Last night cost ${usd2(last)}${lastWord}. ${usd0(wasteMicros)} went to drafts that never posted.`;

  const budget = types.map((v) => {
    const spent = monthMicros(v.id);
    const proj = pace(spent, i.now, watch(v.id), month).projectedMicros;
    return { vertical: v.id, label: v.label, spentMicros: spent, watchMicros: watch(v.id), projectedMicros: proj, onPace: proj <= watch(v.id) };
  });

  const published = i.posts.filter((p) => p.status === 'published' && p.postedAt && p.postedAt.slice(0, 10) >= i.from && p.postedAt.slice(0, 10) <= i.to && (!i.vertical || p.vertical === i.vertical));
  const byType = types.map((v) => {
    const posts = published.filter((p) => p.vertical === v.id && p.costMicros != null);
    const cost = posts.reduce((n, p) => n + (p.costMicros ?? 0), 0);
    const interactions = posts.reduce((n, p) => n + interactionsOf(p), 0);
    const kinds = KINDS.map((k) => {
      const n = posts.reduce((a, p) => a + (p.metrics[k.key] ?? 0), 0);
      return { label: k.label, key: k.key, cpiMicros: n > 0 ? Math.round(cost / n) : null };
    }).filter((k) => k.cpiMicros !== null);
    return { vertical: v.id, label: v.label, interactions, cpiMicros: interactions > 0 ? Math.round(cost / interactions) : null, kinds };
  }).sort((a, b) => (a.cpiMicros ?? Infinity) - (b.cpiMicros ?? Infinity));
  const bestPost = published
    .filter((p) => (p.costMicros ?? 0) > 0 && interactionsOf(p) > 0)
    .map((p) => ({ post: p, interactions: interactionsOf(p), cpiMicros: Math.round((p.costMicros ?? 0) / interactionsOf(p)) }))
    .sort((a, b) => a.cpiMicros - b.cpiMicros)[0] ?? null;

  const chips: CostModel['chips'] = [];
  const low = byType.find((t) => t.cpiMicros !== null && i.bestEverCpi[t.vertical] !== undefined && t.cpiMicros! < i.bestEverCpi[t.vertical]!);
  if (low) chips.push({ id: 'low', text: `✦ New low: ${low.label} at $${(low.cpiMicros! / 1e6).toFixed(3)} per interaction`, best: true });
  const dailyPace = totalWatch / daysInMonth;
  let streak = 0;
  for (let d = addDays(i.to, -1); d.startsWith(month); d = addDays(d, -1)) {
    if (rows.filter((r) => r.nyDate === d).reduce((n, r) => n + r.micros, 0) > dailyPace) break;
    streak++;
  }
  if (streak >= 2) chips.push({ id: 'pace', text: `🔥 ${streak} days in a row under daily pace` });
  const pct = totalMicros > 0 ? Math.round((wasteMicros / totalMicros) * 100) : 0;
  if (i.prevWastePct !== null) {
    const text = pct === i.prevWastePct ? `Waste ${pct}%, same as last month` : `Waste ${pct}%, ${pct < i.prevWastePct ? 'down' : 'up'} from ${i.prevWastePct}%`;
    chips.push({ id: 'waste', text });
  }

  const months = i.monthTotals.slice(-3).map((m) => ({
    month: m.month,
    label: new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    under: m.month === month ? null : m.micros <= totalWatch,
  }));

  return {
    totalMicros, unknownCalls, headline, pace: p, chips, months, rows: inRange, historyRows, monthClosed,
    series: { type: dailySeries(historyRows, histDays, 'type', LEAD), vendor: dailySeries(historyRows, histDays, 'vendor', LEAD), stage: dailySeries(historyRows, histDays, 'stage', LEAD) },
    budget, worth: { byType, best: bestPost }, waste: { ...i.waste, pct, prevPct: i.prevWastePct },
    rejection: i.readiness.map((r) => ({ vertical: r.vertical, label: verticalInfo(r.vertical).label, rate: r.rate === null ? null : 1 - r.rate })),
    caching: { ...i.caching, covered: cacheCovered(i.vertical) },
  };
}
