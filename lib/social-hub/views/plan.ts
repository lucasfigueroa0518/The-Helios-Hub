import { nyDayStart, weekdayOf } from '@/lib/social-hub/time';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';
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

export function windowsOn(vertical: Vertical, nyDate: string): PlanWindow[] {
  const day = weekdayOf(nyDate);
  return PLAN[vertical].filter((w) => !w.days || w.days.includes(day));
}

/** A post occupies a window when it is placed, posting, or posted. A failed generation gives the slot back. */
const PLACED = new Set(['scheduled', 'publishing', 'published', 'generating']);

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

export function dayPlan(posts: readonly HubPost[], nyDate: string): DayPlan {
  const types = VERTICAL_IDS.map((vertical): TypePlan => {
    const windows = windowsOn(vertical, nyDate);
    const placed = posts.filter((p) => p.vertical === vertical && p.nyDate === nyDate && PLACED.has(p.status));
    const taken = new Set(placed.map((p) => windowOf(p, windows, nyDate)).filter((id): id is string => Boolean(id)));
    // Stories record one generic window, so count instead of matching ids.
    const open = vertical === 'stories'
      ? windows.slice(Math.min(placed.length, windows.length))
      : windows.filter((w) => !taken.has(w.id)).slice(0, Math.max(0, windows.length - placed.length));
    return { vertical, windows, placed, open };
  });
  const slots = types.reduce((n, t) => n + t.windows.length, 0);
  const filled = types.reduce((n, t) => n + Math.min(t.placed.length, t.windows.length), 0);
  return { nyDate, types, slots, filled };
}
