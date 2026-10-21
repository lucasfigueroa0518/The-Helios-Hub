// lib/social-hub/slots/times.ts
import { SOCIAL_TIMEZONE, zoneOffsetMinutes } from '@/lib/instagram/clock';
import type { Vertical } from '@/lib/social-hub/types';

import type { FeedMode, ResolvedSlot, StorySeries } from './types';

/**
 * Free-time constants and helpers for the week board
 * (docs/superpowers/specs/2026-10-20-calendar-week-board-redesign.md). All
 * minutes are minutes of the New York day. Pure: no DB, no clock.
 */

/** Board grid, magnetic snap reach, posting drift after the slot time, gap between feed posts. */
export const GRID = 15;
export const MAGNET = 20;
export const DRIFT = 15;
export const FEED_GAP = 30;

/** The timeline runs 8 AM–9 PM; the last start is 8:45 PM so drift still posts by 9 PM. */
export const DAY_START = 8 * 60;
export const DAY_END = 21 * 60;
export const LAST_START = DAY_END - DRIFT;

/** Each type's usual windows: hint bands while dragging, and the magnet's starts. */
export const USUAL: Record<Vertical, ReadonlyArray<{ start: number; end: number; name: string }>> = {
  reels: [
    { start: 525, end: 600, name: 'Morning' },
    { start: 675, end: 750, name: 'Midday' },
    { start: 1080, end: 1260, name: 'Evening' },
  ],
  explainers: [
    { start: 780, end: 870, name: 'Afternoon' },
    { start: 930, end: 1020, name: 'Late afternoon' },
  ],
  carousels: [
    { start: 540, end: 600, name: 'Morning' },
    { start: 870, end: 930, name: 'Afternoon' },
  ],
  last_few_days: [{ start: 540, end: 600, name: 'Morning' }],
  stories: [{ start: 510, end: 600, name: 'Morning' }],
};

/** Default slot times per type (the seed). LFD runs on its days (Tue/Fri), Stories series on theirs. */
export const DEFAULT_TIMES: Record<Vertical, readonly number[]> = {
  reels: [525, 675, 1080],
  explainers: [780, 930],
  carousels: [540, 870],
  last_few_days: [540],
  stories: [510],
};

/** The hidden safety cap per day the overnight runs never exceed. Stories: per series. */
export const DEFAULT_CAPS: Record<Vertical, number> = { reels: 5, explainers: 3, carousels: 3, last_few_days: 1, stories: 2 };

/** When each type's overnight run makes the day's posts. */
export const RUN_HOUR_LABEL: Record<Vertical, string> = { reels: '1 AM', explainers: '2 AM', carousels: '3 AM', last_few_days: '3 AM', stories: '4 AM' };

/** Default Trial / Main feed for a new slot of a type (reels Trial, Explainers Main, the rest none). */
export const DEFAULT_FEED_MODE: Record<Vertical, FeedMode | null> = { reels: 'trial', explainers: 'main', carousels: null, last_few_days: null, stories: null };

/** Names for board copy ("{Day} has {n} {Type}s…", "At the daily limit for {Type}s ({cap})"). */
export const TYPE_NAME: Record<Vertical, { one: string; many: string }> = {
  reels: { one: 'Text on Screen', many: 'Text on Screen reels' },
  explainers: { one: 'Explainer', many: 'Explainers' },
  carousels: { one: 'Carousel', many: 'Carousels' },
  last_few_days: { one: 'Last Few Days', many: 'Last Few Days posts' },
  stories: { one: 'Stories', many: 'Stories' },
};

export const SERIES_NAME: Record<StorySeries, { one: string; many: string }> = {
  morning_download: { one: 'Morning Download', many: 'Morning Downloads' },
  guess_the_number: { one: 'Guess the Number', many: 'Guess the Number sets' },
  free_vs_paid: { one: 'Free vs. Paid', many: 'Free vs. Paid sets' },
};

/** "8:45 AM" for a minute of the day. */
export function clockLabel(m: number): string {
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const clamp = (m: number) => Math.min(LAST_START, Math.max(DAY_START, m));

/**
 * Snap a raw minute to the board: round to the 15-minute grid; take a usual
 * start within MAGNET minutes when the raw value is within 7 minutes of it
 * or the grid value equals it; otherwise keep the grid value. Every
 * 15-minute mark stays reachable. Clamped to the timeline.
 */
export function snapMinute(raw: number, vertical: Vertical): { minute: number; snappedTo: string | null } {
  const grid = clamp(Math.round(raw / GRID) * GRID);
  for (const w of USUAL[vertical]) {
    const d = Math.abs(raw - w.start);
    if (d <= MAGNET && (d <= 7 || grid === w.start)) return { minute: w.start, snappedTo: w.name };
  }
  return { minute: grid, snappedTo: null };
}

/** Whether a start minute sits inside one of the type's usual windows (end exclusive). */
export function isUsual(vertical: Vertical, minute: number): boolean {
  return USUAL[vertical].some((w) => minute >= w.start && minute < w.end);
}

/** The usual start closest to a minute (ties go earlier). */
export function nearestUsualStart(vertical: Vertical, minute: number): number {
  let best = USUAL[vertical][0]!.start;
  for (const w of USUAL[vertical]) if (Math.abs(w.start - minute) < Math.abs(best - minute)) best = w.start;
  return best;
}

/** The first 15-minute mark strictly after now: a slot at now has already started. */
export function nextOpenMinute(nowMinute: number): number {
  return (Math.floor(nowMinute / GRID) + 1) * GRID;
}

/** Feed posts keep 30 minutes apart: Main-feed reels, Carousels, LFD. Stories and Trial reels are exempt. */
export function isFeedSlot(s: Pick<ResolvedSlot, 'vertical' | 'feedMode'>): boolean {
  if (s.vertical === 'stories') return false;
  if (s.vertical === 'reels' || s.vertical === 'explainers') return s.feedMode === 'main';
  return true;
}

/** Minute of the New York day (wall clock) of an instant; a DST day's minutes skip or repeat the changed hour. */
export function nyMinuteOf(at: Date): number {
  const local = new Date(at.getTime() + zoneOffsetMinutes(at, SOCIAL_TIMEZONE) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}
