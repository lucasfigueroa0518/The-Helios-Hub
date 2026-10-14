/** The Last Few Days window (spec §3.1): every nightly reels batch after the previous post, through today's. */
import type { LfdWindow } from './types';

export const FIRST_RUN_BATCHES = 4;
export const SAFETY_EXTRA_BATCHES = 3;

/** Shift a YYYY-MM-DD key by whole days (calendar math in UTC, no DST). */
export function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function windowFor(todayNy: string, previousNy: string | null): LfdWindow {
  return { after: previousNy ?? shiftDate(todayNy, -FIRST_RUN_BATCHES), through: todayNy };
}

/** Safety net (spec §3.4): reach 3 batches further back; the repeat rules still apply. */
export function extendWindow(w: LfdWindow): LfdWindow {
  return { after: shiftDate(w.after, -SAFETY_EXTRA_BATCHES), through: w.through };
}
