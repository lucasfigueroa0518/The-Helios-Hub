import { formatMetricKey, metricSpec, postMetric, sumReported } from '@/lib/social-hub/metrics';
import { addDays, monthGrid, nyDateOf, nyDayStart } from '@/lib/social-hub/time';
import { dayPlan, windowsOn, type PlanWindow } from '@/lib/social-hub/views/plan';
import { needsPerson } from '@/lib/social-hub/views/state';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';
import type { HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';

/**
 * The month (BRIEFS.md §2): how each past day went and where the gaps are
 * ahead. A past day's main number is its total for the chosen metric, tinted
 * by how it ranks in the month; a future day shows its slots, filled or open.
 */

export type Mark = { vertical: Vertical; kind: 'posted' | 'scheduled' | 'failed' | 'missed' | 'open' };

export type DayCell = {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  past: boolean;
  total: number | null;
  /** 0–1 rank of the day's total among the month's past days (for the tint). */
  rank: number | null;
  marks: Mark[];
  needs: number;
  posts: number;
};

/** `previous` is the month before over the same days (Sep 1–8 against Oct 1–8 while October is under way). */
export type MonthSummary = {
  published: number;
  total: number | null;
  best: { day: string; total: number } | null;
  failed: number;
  openAhead: number;
  previous: { label: string; published: number; total: number | null };
};

export type MonthModel = { weeks: DayCell[][]; summary: MonthSummary; metric: MetricKey };

const ORDER = new Map(VERTICAL_IDS.map((v, i) => [v, i]));

function markOf(post: HubPost): Mark['kind'] | null {
  switch (post.status) {
    case 'published':
    case 'publishing':
      return 'posted';
    case 'scheduled':
      return 'scheduled';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'skipped':
      return 'missed';
    default:
      return null;
  }
}

/**
 * `actionable` narrows "needs you" to what a person can act on from here (defaults to every post that waits on one).
 * A day's count covers only content placed on it, exactly what its day sheet lists; made-and-unplaced content
 * belongs to Content's "Made, waiting for a slot", not to a day.
 */
export function monthModel(posts: readonly HubPost[], month: string, now: Date, metric: MetricKey, types: ReadonlySet<Vertical>, actionable: (post: HubPost) => boolean = () => true): MonthModel {
  const today = nyDateOf(now)!;
  const shown = posts.filter((p) => types.has(p.vertical));
  const byDay = new Map<string, HubPost[]>();
  for (const p of shown) {
    if (!p.nyDate) continue;
    const list = byDay.get(p.nyDate) ?? [];
    list.push(p);
    byDay.set(p.nyDate, list);
  }
  const weeks = monthGrid(month).map((week) => week.map(({ day, inMonth }): DayCell => {
    const list = byDay.get(day) ?? [];
    const past = day <= today;
    const marks: Mark[] = list
      .map((p) => ({ vertical: p.vertical, kind: markOf(p) }))
      .filter((m): m is Mark => m.kind != null);
    if (day >= today && day <= addDays(today, 1)) {
      // Open slots, today and tomorrow only: past that the nightly run fills them,
      // so rings would only repeat the predictable (critique 2026-10-08, P2-D).
      for (const t of dayPlan(shown, day).types) {
        if (!types.has(t.vertical)) continue;
        for (let i = 0; i < t.open.length; i++) marks.push({ vertical: t.vertical, kind: 'open' });
      }
    }
    marks.sort((a, b) => (ORDER.get(a.vertical)! - ORDER.get(b.vertical)!) || a.kind.localeCompare(b.kind));
    const published = list.filter((p) => p.status === 'published');
    const total = past && metricSpec(metric).aggregate === 'sum' ? sumReported(published.map((p) => postMetric(p, metric))) : null;
    return { day, inMonth, isToday: day === today, past, total, rank: null, marks, needs: list.filter((p) => p.status !== 'ready' && needsPerson(p, now) && actionable(p)).length, posts: list.length };
  }));

  const ranked = weeks.flat().filter((c) => c.inMonth && c.total != null).sort((a, b) => a.total! - b.total!);
  ranked.forEach((c, i) => {
    c.rank = ranked.length > 1 ? i / (ranked.length - 1) : 1;
  });

  const inMonth = weeks.flat().filter((c) => c.inMonth);
  const monthPosts = shown.filter((p) => p.nyDate?.startsWith(month));
  // The month before, over the same days so a month under way compares fairly.
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const throughDay = today.startsWith(month) ? Number(today.slice(8, 10)) : 31;
  const prevPosts = shown.filter((p) => p.nyDate?.startsWith(prevMonth) && Number(p.nyDate.slice(8, 10)) <= throughDay && p.status === 'published');
  const prevName = new Date(`${prevMonth}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const best = ranked.at(-1);
  return {
    weeks,
    metric,
    summary: {
      published: monthPosts.filter((p) => p.status === 'published').length,
      total: sumReported(monthPosts.filter((p) => p.status === 'published').map((p) => postMetric(p, metric))),
      best: best ? { day: best.day, total: best.total! } : null,
      failed: monthPosts.filter((p) => p.status === 'failed').length,
      openAhead: weeks.flat().filter((c) => c.day >= today).reduce((n, c) => n + c.marks.filter((m) => m.kind === 'open').length, 0),
      previous: {
        label: throughDay < 28 ? `${prevName} 1–${throughDay}` : prevName,
        published: prevPosts.length,
        total: sumReported(prevPosts.map((p) => postMetric(p, metric))),
      },
    },
  };
}

export function totalLabel(value: number | null, metric: MetricKey): string {
  return value == null ? '' : formatMetricKey(value, metric);
}

/** A day's slots in time order: placed content and open windows (the day panel). */
export type DaySlot =
  | { kind: 'post'; post: HubPost; at: string | null }
  | { kind: 'open'; vertical: Vertical; window: PlanWindow; at: string };

export function daySlots(posts: readonly HubPost[], day: string, types: ReadonlySet<Vertical>, now: Date): DaySlot[] {
  const today = nyDateOf(now)!;
  const shown = posts.filter((p) => types.has(p.vertical));
  const placed: DaySlot[] = shown
    .filter((p) => p.nyDate === day && p.status !== 'ready')
    .map((p) => ({ kind: 'post', post: p, at: p.postedAt ?? p.publishAt }));
  const open: DaySlot[] = day < today ? [] : dayPlan(shown, day).types
    .filter((t) => types.has(t.vertical))
    .flatMap((t) => t.open
      // A window that has already closed today isn't a slot anyone can fill.
      .filter((w) => day !== today || minuteIso(day, w.endMinute) > now.toISOString())
      .map((w) => ({ kind: 'open' as const, vertical: t.vertical, window: w, at: minuteIso(day, w.startMinute) })));
  return [...placed, ...open].sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9'));
}

/** The instant a window opens on a New York day (for ordering against real post times). */
function minuteIso(day: string, minute: number): string {
  return new Date(nyDayStart(day).getTime() + minute * 60_000).toISOString();
}

export function windowsFor(vertical: Vertical, day: string): PlanWindow[] {
  return windowsOn(vertical, day);
}

export { addDays };
