// lib/social-hub/slots/schedule.ts
import type { Vertical } from '@/lib/social-hub/types';

import { LFD_ONCE, OFF_GRID, OUTSIDE_DAY } from './rules';
import { clockLabel, DAY_START, DEFAULT_FEED_MODE, FEED_GAP, isFeedSlot, LAST_START } from './times';
import { isReelType, isSlotMinute, type FeedMode, type StorySeries, type TemplateRow } from './types';

/**
 * Per-type standing schedules: one type's weekly template rows as a single
 * list of times plus the days they run, and back. Pure: no DB, no clock, so
 * client components can import it.
 */

export type ScheduleEntry = { vertical: Vertical; series: StorySeries | null; label: string };

export const SCHEDULE_ENTRIES: readonly ScheduleEntry[] = [
  { vertical: 'reels', series: null, label: 'Text on Screen' },
  { vertical: 'explainers', series: null, label: 'Explainers' },
  { vertical: 'carousels', series: null, label: 'Carousels' },
  { vertical: 'last_few_days', series: null, label: 'Last Few Days' },
  { vertical: 'stories', series: 'morning_download', label: 'Morning Download' },
  { vertical: 'stories', series: 'guess_the_number', label: 'Guess the Number' },
  { vertical: 'stories', series: 'free_vs_paid', label: 'Free vs. Paid' },
];

export type ScheduleTime = { minute: number; feedMode: FeedMode | null };

/** Days use 0 = Sunday. Times are sorted by minute. */
export type TypeSchedule = { entry: ScheduleEntry; times: ScheduleTime[]; days: number[] };

const sameEntry = (a: Pick<ScheduleEntry, 'vertical' | 'series'>, b: Pick<ScheduleEntry, 'vertical' | 'series'>) =>
  a.vertical === b.vertical && a.series === b.series;

export function scheduleFromTemplate(
  template: readonly TemplateRow[],
  entry: ScheduleEntry,
): { schedule: TypeSchedule; merged: boolean; problems: string[] } {
  const rows = template.filter((r) => sameEntry(r, entry));
  const byDay = new Map<number, Set<number>>();
  const modes = new Map<number, Set<FeedMode | null>>();
  for (const r of rows) {
    if (!byDay.has(r.weekday)) byDay.set(r.weekday, new Set());
    byDay.get(r.weekday)!.add(r.startMinute);
    if (!modes.has(r.startMinute)) modes.set(r.startMinute, new Set());
    modes.get(r.startMinute)!.add(r.feedMode);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const sets = days.map((d) => [...byDay.get(d)!].sort((a, b) => a - b).join(','));
  const merged = new Set(sets).size > 1;

  const problems: string[] = [];
  const times: ScheduleTime[] = [...modes.keys()]
    .sort((a, b) => a - b)
    .map((minute) => {
      if (!isReelType(entry.vertical)) return { minute, feedMode: null };
      const seen = modes.get(minute)!;
      if (seen.has('trial') && seen.has('main')) {
        problems.push(`${clockLabel(minute)} is Trial on some days and Main on others. Pick one.`);
        return { minute, feedMode: 'main' as FeedMode };
      }
      const only = [...seen][0] ?? null;
      return { minute, feedMode: only ?? DEFAULT_FEED_MODE[entry.vertical] };
    });
  return { schedule: { entry, times, days }, merged, problems };
}

export function templateRowsFor(s: TypeSchedule): TemplateRow[] {
  const days = [...s.days].sort((a, b) => a - b);
  const times = [...s.times].sort((a, b) => a.minute - b.minute);
  const rows: TemplateRow[] = [];
  for (const weekday of days) {
    for (const t of times) {
      rows.push({
        weekday,
        vertical: s.entry.vertical,
        startMinute: t.minute,
        series: s.entry.series,
        feedMode: isReelType(s.entry.vertical) ? (t.feedMode ?? DEFAULT_FEED_MODE[s.entry.vertical]) : null,
      });
    }
  }
  return rows;
}


export type ScheduleConfirm = { kind: 'lfd-carousels' | 'carousels-lfd'; days: number[] };

export function checkSchedule(
  s: TypeSchedule,
  ctx: { cap: number; others: readonly TypeSchedule[] },
): { errors: string[]; warnings: string[]; confirm: ScheduleConfirm | null; empty: boolean } {
  const empty = s.times.length === 0 || s.days.length === 0;
  if (empty) return { errors: [], warnings: [], confirm: null, empty: true };

  const errors: string[] = [];
  const add = (list: string[], msg: string) => { if (!list.includes(msg)) list.push(msg); };
  const label = s.entry.label;

  const seen = new Set<number>();
  for (const t of s.times) {
    if (!isSlotMinute(t.minute)) add(errors, OFF_GRID);
    else if (t.minute < DAY_START || t.minute > LAST_START) add(errors, OUTSIDE_DAY);
    if (seen.has(t.minute)) add(errors, `${clockLabel(t.minute)} is already in the list.`);
    seen.add(t.minute);
  }
  if (s.times.length > ctx.cap) {
    add(errors, `${label} can post ${ctx.cap} a day. Raise the daily limit on the ${label} page to add more.`);
  }
  if (s.entry.vertical === 'last_few_days' && s.times.length > 1) add(errors, LFD_ONCE);

  const warnings: string[] = [];
  for (const t of s.times) {
    if (!isFeedSlot({ vertical: s.entry.vertical, feedMode: t.feedMode })) continue;
    for (const o of ctx.others) {
      if (sameEntry(o.entry, s.entry)) continue;
      if (!o.days.some((d) => s.days.includes(d))) continue;
      for (const ot of o.times) {
        if (!isFeedSlot({ vertical: o.entry.vertical, feedMode: ot.feedMode })) continue;
        if (Math.abs(ot.minute - t.minute) >= FEED_GAP) continue;
        add(warnings, `${o.entry.label} post at ${clockLabel(ot.minute)} too. One of them will go out around ${clockLabel(ot.minute + FEED_GAP)}.`);
      }
    }
  }

  let confirm: ScheduleConfirm | null = null;
  const other = (v: Vertical) => ctx.others.find((o) => o.entry.vertical === v && o.times.length > 0);
  if (s.entry.vertical === 'last_few_days') {
    const c = other('carousels');
    const days = c ? s.days.filter((d) => c.days.includes(d)).sort((a, b) => a - b) : [];
    if (days.length) confirm = { kind: 'lfd-carousels', days };
  } else if (s.entry.vertical === 'carousels') {
    const l = other('last_few_days');
    const days = l ? s.days.filter((d) => l.days.includes(d)).sort((a, b) => a - b) : [];
    if (days.length) confirm = { kind: 'carousels-lfd', days };
  }

  return { errors, warnings, confirm, empty: false };
}

/**
 * Pair old times with new ones for a schedule edit: unchanged minutes map to
 * themselves; the remaining old minutes take the remaining new minutes in
 * ascending order; leftover old minutes map to null.
 */
export function pairTimes(before: readonly number[], after: readonly number[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  for (const m of before) if (afterSet.has(m)) out.set(m, m);
  const oldRest = [...beforeSet].filter((m) => !afterSet.has(m)).sort((a, b) => a - b);
  const newRest = [...afterSet].filter((m) => !beforeSet.has(m)).sort((a, b) => a - b);
  oldRest.forEach((m, i) => out.set(m, newRest[i] ?? null));
  return out;
}
