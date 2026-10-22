// lib/social-hub/slots/schedule.ts
import type { Vertical } from '@/lib/social-hub/types';

import { LFD_ONCE, OFF_GRID, OUTSIDE_DAY } from './rules';
import { clockLabel, DAY_START, DEFAULT_FEED_MODE, FEED_GAP, GRID, isFeedSlot, LAST_START } from './times';
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

/** One entry's schedule as the page hands it to the Schedules form. */
export type ScheduleView = { schedule: TypeSchedule; merged: boolean; problems: string[] };

export function scheduleFromTemplate(
  template: readonly TemplateRow[],
  entry: ScheduleEntry,
): ScheduleView {
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
        // The later of the two goes out FEED_GAP after the earlier one (ruling P6).
        add(warnings, `${o.entry.label} post at ${clockLabel(ot.minute)} too. One of them will go out around ${clockLabel(Math.min(t.minute, ot.minute) + FEED_GAP)}.`);
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

// ── The Schedules form (Calendar header): pure helpers the client form and the preview sandbox share ──

/** The day chips' order: Monday first (days are 0 = Sunday). */
export const DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** "Add a time" stays on below the type's daily cap; Last Few Days takes one time whatever its cap. */
export function canAddTime(s: TypeSchedule, cap: number): boolean {
  const most = s.entry.vertical === 'last_few_days' ? Math.min(1, cap) : cap;
  return s.times.length < most;
}

/** The time "Add a time" starts at: the first free mark an hour after the last time, else the first free mark of the day (9 AM when empty). */
export function nextTime(times: readonly ScheduleTime[]): number {
  if (!times.length) return 540;
  const taken = new Set(times.map((t) => t.minute));
  const last = Math.max(...taken);
  for (let m = last + 60; m <= LAST_START; m += GRID) if (!taken.has(m)) return m;
  for (let m = DAY_START; m <= LAST_START; m += GRID) if (!taken.has(m)) return m;
  return DAY_START;
}

/** The form's checks: checkSchedule plus any merge problem the person hasn't settled yet (those block Save too). */
export function formErrors(
  s: TypeSchedule,
  ctx: { cap: number; others: readonly TypeSchedule[]; problems: readonly string[] },
): ReturnType<typeof checkSchedule> {
  const r = checkSchedule(s, ctx);
  return { ...r, errors: [...ctx.problems.filter((p) => !r.errors.includes(p)), ...r.errors] };
}

/**
 * The standing week after one entry's save, as the server writes it: the
 * entry's rows replaced, and after an LFD / Carousels confirm the other
 * type loses the confirmed days. The preview sandbox recomputes its board
 * from this.
 */
export function replaceSchedule(template: readonly TemplateRow[], s: TypeSchedule, confirm: ScheduleConfirm | null): TemplateRow[] {
  const other: Vertical | null = confirm ? (confirm.kind === 'lfd-carousels' ? 'carousels' : 'last_few_days') : null;
  const clear = new Set(confirm?.days ?? []);
  return [
    ...template.filter((r) => !sameEntry(r, s.entry) && !(other && r.vertical === other && clear.has(r.weekday))),
    ...templateRowsFor(s),
  ];
}

const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What a save asks before it goes ahead: each day LFD / Carousels trade, or that the type stops posting. The server's 422 and the sandbox say the same. */
export function confirmLines(c: ScheduleConfirm | { kind: 'empty' }, label: string): string[] {
  if (c.kind === 'empty') return [`${label} will stop posting.`];
  return c.days.map((d) =>
    c.kind === 'lfd-carousels'
      ? `${WEEKDAY_NAME[d]} becomes a Last Few Days day. Carousels come off ${WEEKDAY_NAME[d]}.`
      : `${WEEKDAY_NAME[d]} becomes a Carousels day. Last Few Days comes off ${WEEKDAY_NAME[d]}.`,
  );
}

/** "Carousels schedule saved. Every week from now on." plus how many went back to Ready to place. */
export function savedToast(label: string, toReady: number): string {
  const back = toReady > 0 ? ` ${toReady} ${label} went back to Ready to place.` : '';
  return `${label} schedule saved. Every week from now on.${back}`;
}

/** After Undo: posts the save sent back to Ready to place don't come back. */
export function undoneToast(label: string, toReady: number): string {
  return `Undone: ${label} schedule.${toReady > 0 ? ' Posts that went back to Ready to place stay there.' : ''}`;
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
