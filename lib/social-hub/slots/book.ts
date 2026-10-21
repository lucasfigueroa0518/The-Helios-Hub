// lib/social-hub/slots/book.ts
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { openWindowRange, spacedOffsets, windowMinuteInstant, type PostingWindow } from '@/lib/instagram/window';

import { DAY_END, DRIFT, FEED_GAP, isFeedSlot } from './times';
import { slotId, type FeedMode, type ResolvedSlot } from './types';

/**
 * Template-mode booking time (week board spec): a post takes the earliest
 * untaken slot and goes out at a drifted minute in [slot, slot + 15], never
 * before now. Feed posts keep FEED_GAP minutes from every other feed post,
 * pushed later when no drift minute clears, never past the slot's own day.
 * Pure: no DB, no clock.
 */

/**
 * The minute a post goes out for one slot on one date, or null when nothing
 * fits. Shared with the calendar's move-a-booking write.
 */
export function driftMinute(nyDate: string, slot: ResolvedSlot, now: Date, busy: readonly Date[], rng: (n: number) => number): Date | null {
  const w: PostingWindow = { id: slotId(slot.startMinute, slot.series), label: '', startMinute: slot.startMinute, endMinute: slot.startMinute + DRIFT };
  const open = openWindowRange(w, nyDate, now);
  if (!open) return null;
  const spaced = isFeedSlot(slot) ? busy : [];
  const offsets = spacedOffsets((o) => windowMinuteInstant(w, nyDate, o), open.startOffset, open.count, spaced);
  if (offsets.length) {
    const i = rng(offsets.length);
    if (!Number.isInteger(i) || i < 0 || i >= offsets.length) throw new Error(`Slot draw returned ${i} for ${offsets.length} open minutes.`);
    return windowMinuteInstant(w, nyDate, offsets[i]!);
  }
  // Every drift minute is too close to another feed post: the smallest push later that clears them all.
  const gap = FEED_GAP * 60_000;
  const rest: PostingWindow = { id: w.id, label: '', startMinute: w.endMinute + 1, endMinute: DAY_END - 1 };
  if (rest.startMinute > rest.endMinute) return null;
  for (let o = 0; o <= rest.endMinute - rest.startMinute; o += 1) {
    const t = windowMinuteInstant(rest, nyDate, o).getTime();
    if (busy.every((b) => Math.abs(b.getTime() - t) >= gap)) return new Date(t);
  }
  return null;
}

export type SlotChoice = { nyDate: string; slot: string; publishAt: Date; feedMode: FeedMode | null };

/** Slots in day order: by start minute, then series. */
export const bySlotTime = (a: ResolvedSlot, b: ResolvedSlot): number => a.startMinute - b.startMinute || (a.series ?? '').localeCompare(b.series ?? '');

/**
 * The earliest untaken slot. `byDate` holds the type's slots per New York
 * date (they differ by weekday and override); dates are read ascending, those
 * before today (NY) are skipped, and the search stops after `throughDate`.
 * `taken` holds `${nyDate}|${slotId}`. Slots that cannot book (past, or boxed
 * in by feed posts) are skipped.
 */
export function chooseSlotTime(
  byDate: ReadonlyMap<string, readonly ResolvedSlot[]>,
  now: Date,
  taken: ReadonlySet<string>,
  busy: readonly Date[],
  rng: (n: number) => number,
  throughDate?: string,
): SlotChoice | null {
  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
  for (const nyDate of [...byDate.keys()].sort()) {
    if (nyDate < today) continue;
    if (throughDate && nyDate > throughDate) break;
    for (const slot of [...byDate.get(nyDate)!].sort(bySlotTime)) {
      const id = slotId(slot.startMinute, slot.series);
      if (taken.has(`${nyDate}|${id}`)) continue;
      const publishAt = driftMinute(nyDate, slot, now, busy, rng);
      if (publishAt) return { nyDate, slot: id, publishAt, feedMode: slot.feedMode };
    }
  }
  return null;
}
