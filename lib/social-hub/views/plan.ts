import { nyDayStart, weekdayOf } from '@/lib/social-hub/time';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';
import { clockLabel, DRIFT, SERIES_NAME } from '@/lib/social-hub/slots/times';
import { slotId, type ResolvedSlot, type SlotsByDate } from '@/lib/social-hub/slots/types';
import type { HubPost, Vertical } from '@/lib/social-hub/types';

/**
 * The daily posting plan per content type: which windows exist on a day and
 * which are filled. Mirrors each type's own clock (docs/social-overnight.md)
 * without importing worker code into the hub; tests/social-hub-plan.test.ts
 * pins these to the source constants (lib/reels/publish/slots.ts,
 * lib/social/overnight/config.ts, lib/explainers/publish/config.ts,
 * lib/stories/settings.ts).
 */

export type PlanWindow = { id: string; label: string; startMinute: number; endMinute: number; days?: readonly number[] };

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const PLAN: Record<Vertical, readonly PlanWindow[]> = {
  reels: [
    { id: 'morning', label: 'Morning', startMinute: 8 * 60 + 45, endMinute: 10 * 60 },
    { id: 'midday', label: 'Midday', startMinute: 11 * 60 + 15, endMinute: 12 * 60 + 30 },
    { id: 'evening', label: 'Evening', startMinute: 18 * 60, endMinute: 21 * 60 },
  ],
  explainers: [
    { id: 'afternoon', label: 'Afternoon', startMinute: 13 * 60, endMinute: 14 * 60 + 30 },
    { id: 'late', label: 'Late afternoon', startMinute: 15 * 60 + 30, endMinute: 17 * 60 },
  ],
  carousels: [
    { id: 'morning', label: 'Morning', startMinute: 9 * 60, endMinute: 10 * 60 },
    { id: 'afternoon', label: 'Afternoon', startMinute: 14 * 60 + 30, endMinute: 15 * 60 + 30 },
  ],
  // lib/lfd/config.ts LFD_WINDOW on DEFAULT_LFD_DAYS (Tue, Fri); tests/lfd-hub.test.ts pins the copy.
  last_few_days: [{ id: 'morning', label: 'Morning', startMinute: 9 * 60, endMinute: 10 * 60, days: [2, 5] }],
  stories: [
    { id: 'morning_download', label: 'Morning Download', startMinute: 8 * 60 + 30, endMinute: 10 * 60, days: EVERY_DAY },
    { id: 'guess_the_number', label: 'Guess the Number', startMinute: 8 * 60 + 30, endMinute: 10 * 60, days: [1, 4] },
    { id: 'free_vs_paid', label: 'Free vs. Paid', startMinute: 8 * 60 + 30, endMinute: 10 * 60, days: [2, 6] },
  ],
};

/** "8:45 AM" for a minute of the day. */
export function minuteLabel(m: number): string {
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "8:45–10:00 AM" */
export function windowRange(w: PlanWindow): string {
  const fmt = (m: number, withPeriod: boolean) => {
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm}${withPeriod ? ` ${period}` : ''}`;
  };
  const samePeriod = (w.startMinute < 720) === (w.endMinute < 720);
  return `${fmt(w.startMinute, !samePeriod)}–${fmt(w.endMinute, true)}`;
}

/**
 * A calendar slot as a plan window: its id is the booking slot id (`t0780`,
 * `t0510:morning_download`) and it runs over the slot's drift minutes
 * [slot, slot + DRIFT]. Stories are labeled by series, the rest by time.
 */
export function slotPlanWindow(s: Pick<ResolvedSlot, 'startMinute' | 'series'>): PlanWindow {
  return { id: slotId(s.startMinute, s.series), label: s.series ? SERIES_NAME[s.series].one : clockLabel(s.startMinute), startMinute: s.startMinute, endMinute: s.startMinute + DRIFT };
}

/**
 * A type's windows on a day. With the calendar (`slots` covers the date),
 * exactly that day's slot times for the type, in time order. Otherwise the
 * old rule: `carouselOff` holds the weekdays Carousels give up to Last Few
 * Days while its auto_run is on (LFD-02; DayQuotas.lfdDays).
 */
export function windowsOn(vertical: Vertical, nyDate: string, carouselOff: readonly number[] = [], slots?: SlotsByDate | null): PlanWindow[] {
  const slotDay = slots?.[nyDate];
  if (slotDay) {
    return slotDay
      .filter((s) => s.vertical === vertical)
      .sort((a, b) => a.startMinute - b.startMinute || (a.series ?? '').localeCompare(b.series ?? ''))
      .map(slotPlanWindow);
  }
  const day = weekdayOf(nyDate);
  if (vertical === 'carousels' && carouselOff.includes(day)) return [];
  return PLAN[vertical].filter((w) => !w.days || w.days.includes(day));
}

/** A post occupies a window when it is placed, posting, or posted. A failed generation gives the slot back. */
const PLACED = new Set(['scheduled', 'publishing', 'published', 'generating']);

/** How many posts of a type hold a place on a day. */
export function placedCount(posts: readonly HubPost[], vertical: Vertical, nyDate: string): number {
  return posts.filter((p) => p.vertical === vertical && p.nyDate === nyDate && PLACED.has(p.status)).length;
}

/**
 * The windows that COUNT on a day. Closing Carousels on Last Few Days days only removes open capacity:
 * a past day keeps every window, and a day keeps as many as the content already on it (`held`), so nothing
 * placed there is hidden or benched. No new open slot is offered (windowsOn stays the offer rule).
 * With the calendar (`slots`): the day's slot times, and a booking kept after its slot left the calendar
 * still holds its place until it posts, so the day keeps as many windows as it holds (padded with the
 * type's old windows, at most all of them). A past day also keeps as many as it had before the calendar.
 */
export function capacityWindows(vertical: Vertical, nyDate: string, carouselOff: readonly number[], held: number, today?: string, slots?: SlotsByDate | null): PlanWindow[] {
  if (slots?.[nyDate]) {
    const on = windowsOn(vertical, nyDate, [], slots);
    const before = today !== undefined && nyDate < today ? windowsOn(vertical, nyDate).length : 0;
    const pad = PLAN[vertical].slice(0, Math.max(0, Math.max(held, before) - on.length));
    return [...on, ...pad].sort((a, b) => a.startMinute - b.startMinute);
  }
  const all = windowsOn(vertical, nyDate, [], slots);
  const open = windowsOn(vertical, nyDate, carouselOff, slots);
  if (open.length === all.length || (today !== undefined && nyDate < today)) return all;
  return all.slice(0, Math.max(open.length, Math.min(held, all.length)));
}

export type TypePlan = {
  vertical: Vertical;
  windows: PlanWindow[];
  placed: HubPost[];
  /** Windows with nothing placed (by slot id where the type records one). */
  open: PlanWindow[];
};

export type DayPlan = { nyDate: string; types: TypePlan[]; slots: number; filled: number };

/**
 * The window a placed post fills: the one its time falls in, so a slot id
 * that disagrees with the clock never frees the window the post really holds
 * (critique 2026-10-08, P1-B). Falls back to the recorded slot id.
 */
function windowOf(post: HubPost, windows: readonly PlanWindow[], nyDate: string): string | null {
  const at = post.publishAt ?? post.postedAt;
  if (at) {
    const minute = Math.round((Date.parse(at) - nyDayStart(nyDate).getTime()) / 60_000);
    const hit = windows.find((w) => minute >= w.startMinute && minute <= w.endMinute);
    if (hit) return hit.id;
  }
  return post.slot?.id ?? null;
}

export function dayPlan(posts: readonly HubPost[], nyDate: string, carouselOff: readonly number[] = [], today?: string, slots?: SlotsByDate | null): DayPlan {
  const types = VERTICAL_IDS.map((vertical): TypePlan => {
    const windows = capacityWindows(vertical, nyDate, carouselOff, placedCount(posts, vertical, nyDate), today, slots);
    const placed = posts.filter((p) => p.vertical === vertical && p.nyDate === nyDate && PLACED.has(p.status));
    const taken = new Set(placed.map((p) => windowOf(p, windows, nyDate)).filter((id): id is string => Boolean(id)));
    // Stories record one generic window, so count instead of matching ids.
    const open = vertical === 'stories'
      ? windows.slice(Math.min(placed.length, windows.length))
      : windows.filter((w) => !taken.has(w.id)).slice(0, Math.max(0, windows.length - placed.length));
    return { vertical, windows, placed, open };
  });
  const total = types.reduce((n, t) => n + t.windows.length, 0);
  const filled = types.reduce((n, t) => n + Math.min(t.placed.length, t.windows.length), 0);
  return { nyDate, types, slots: total, filled };
}
