import { sortSlots } from '@/lib/social-hub/slots/resolve';
import { pairTimes, type ScheduleEntry } from '@/lib/social-hub/slots/schedule';
import type { ResolvedSlot, TemplateRow } from '@/lib/social-hub/slots/types';
import type { WeekDayInput } from '@/lib/social-hub/views/week';

/**
 * A Schedules save as the preview board shows it: the on-screen week
 * changes the way the server's save changes the calendar (schedule-write.ts),
 * so the sandbox never shows what a real save wouldn't do.
 *  - Past days, and today's slots that have started, are never touched; a
 *    started slot is tied to its paired new time, so today gains no extra
 *    slot (ruling P7).
 *  - A slot that differs from the old standing week (a board edit) is
 *    hand-set and keeps its time; a routine slot that's missing from a date
 *    (removed or moved by hand) ties its paired new time, which isn't added
 *    there. A hand-set slot at a new time wins over the new one.
 *  - After an LFD / Carousels confirm, the other type's routine slots come
 *    off the confirmed weekdays; where it has a hand-set slot, the saved type
 *    skips that date.
 * The Standard week (no dates) is the template itself: each entry's slots
 * are replaced outright. Pure: no React, no clock of its own.
 */

type EntryKey = Pick<ScheduleEntry, 'vertical' | 'series'>;

export type ScheduleChange = {
  /** Increments with each save, so the board applies each change once. */
  id: number;
  before: readonly TemplateRow[];
  after: readonly TemplateRow[];
  /** The entries whose times this change sets (Undo of an LFD / Carousels save sets both). */
  entries: readonly EntryKey[];
  /** After an LFD / Carousels confirm: the type that comes off these weekdays. */
  clear: { entry: EntryKey; days: readonly number[] } | null;
};

const isEntry = (k: EntryKey, e: EntryKey) => k.vertical === e.vertical && k.series === e.series;
const rowsOf = (t: readonly TemplateRow[], e: EntryKey, weekday: number) => t.filter((r) => r.weekday === weekday && isEntry(r, e));
const asSlot = (r: TemplateRow): ResolvedSlot => ({ vertical: r.vertical, startMinute: r.startMinute, series: r.series, feedMode: r.feedMode, origin: 'template' });

/** One weekday of the Standard week after the change: the entries' slots replaced, the cleared type off its days. */
export function scheduleStandardDay(slots: readonly ResolvedSlot[], weekday: number, c: ScheduleChange): ResolvedSlot[] {
  const cleared = c.clear && c.clear.days.includes(weekday) ? c.clear.entry : null;
  const kept = slots.filter((s) => !c.entries.some((e) => isEntry(s, e)) && !(cleared && isEntry(s, cleared)));
  return sortSlots([...kept, ...c.entries.flatMap((e) => rowsOf(c.after, e, weekday).map(asSlot))]);
}

/** The board's days after the change. `clock` is the board's (today and now); the Standard week ignores it. */
export function scheduleDays(days: readonly WeekDayInput[], c: ScheduleChange, clock: { today: string; nowMinute: number }): WeekDayInput[] {
  return days.map((d) => {
    if (!d.nyDate) return { ...d, slots: scheduleStandardDay(d.slots, d.weekday, c) };
    if (d.nyDate < clock.today) return d;
    const started = (m: number) => d.nyDate === clock.today && m <= clock.nowMinute;
    let slots = [...d.slots];
    const routine = (e: EntryKey, s: ResolvedSlot) => rowsOf(c.before, e, d.weekday).some((r) => r.startMinute === s.startMinute && r.feedMode === s.feedMode);

    // The cleared type: its routine, unstarted slots come off; a hand-set one stays and the saved type skips the date.
    let skip = false;
    if (c.clear && c.clear.days.includes(d.weekday)) {
      const other = c.clear.entry;
      skip = slots.some((s) => isEntry(s, other) && !routine(other, s) && !started(s.startMinute));
      slots = slots.filter((s) => !isEntry(s, other) || !routine(other, s) || started(s.startMinute));
    }

    for (const e of c.entries) {
      const oldRows = rowsOf(c.before, e, d.weekday);
      const newRows = rowsOf(c.after, e, d.weekday);
      const pair = pairTimes(
        [...new Set(c.before.filter((r) => isEntry(r, e)).map((r) => r.startMinute))],
        [...new Set(c.after.filter((r) => isEntry(r, e)).map((r) => r.startMinute))],
      );
      const mine = slots.filter((s) => isEntry(s, e));
      const moving = mine.filter((s) => routine(e, s) && !started(s.startMinute));
      const kept = mine.filter((s) => !moving.includes(s));
      // A routine time that isn't moving (missing, hand-changed, or started today) ties its paired new time.
      const tied = new Set<number>();
      for (const r of oldRows) {
        if (moving.some((s) => s.startMinute === r.startMinute)) continue;
        const to = pair.get(r.startMinute);
        if (to != null) tied.add(to);
      }
      const added = skip ? [] : newRows
        .filter((r) => !started(r.startMinute) && !tied.has(r.startMinute) && !kept.some((s) => s.startMinute === r.startMinute))
        .map(asSlot);
      slots = [...slots.filter((s) => !isEntry(s, e)), ...kept, ...added];
    }
    return { ...d, slots: sortSlots(slots) };
  });
}
