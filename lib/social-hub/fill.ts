/**
 * The daily fill rule (Tommy, 2026-10-08; DECISIONS_LOG D54):
 *
 *   1. A content type that is on fills its day's quota (posts_per_day) in its
 *      nightly run (docs/social-overnight.md clock).
 *   2. Anything a person placed for that New York day counts toward the
 *      quota: a `social_hub.schedule` row with `source = 'user'` that is
 *      scheduled, posting or posted, for that type and `ny_date`. The night
 *      makes only `quota − userPlaced` (never negative; zero makes nothing).
 *   3. Fresh ideas and surviving content that is already made rank together;
 *      surviving content that ranks in is allocated, not made again (each
 *      type's own wiring).
 *   4. A cushion type (lead > 0, lib/social-hub/lead.ts; Bald-Eagle D4) fills a
 *      target date days ahead. There, EVERY booking already on that date
 *      counts, the night's own from an earlier night included (`opts.lead`),
 *      so a night never over-makes a date an earlier night already filled.
 *
 * This file only counts and logs. It reads `social_hub.schedule` (SELECT
 * only) and imports only pure type maps, so any worker, and hub read code, can use it.
 */
import { parseSlotId } from '@/lib/social-hub/slots/types';
import { isStoryVertical, verticalOfSeries } from '@/lib/social-hub/story-types';

/** The query shape every type's database handle already offers. */
export type FillQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type FillVertical = 'carousels' | 'explainers' | 'reels' | 'stories' | 'ai_trivia' | 'real_or_ai' | 'last_few_days' | 'ai_events' | 'field_notes' | 'reel_ai_drama';

/** Slot statuses that hold a day's place: waiting, posting, or posted. Cancelled and failed never count. */
export const PLACED_STATUSES = ['scheduled', 'publishing', 'published'] as const;

/**
 * The type a Stories booking counts under (SS-1): the Stories engine asks as `stories` with its series as the
 * slot, and the series names the type (`ai_trivia` → Are you smarter than AI?). Every other type is itself.
 */
function bookingType(vertical: FillVertical, slot: string | null | undefined): FillVertical {
  if (!isStoryVertical(vertical) || !slot) return vertical;
  return verticalOfSeries(parseSlotId(slot)?.series ?? slot);
}

/**
 * How many slots a person placed for this type on this New York day.
 * `slot` narrows it to one window (Stories: one per series).
 */
export async function userPlaced(
  query: FillQuery,
  vertical: FillVertical,
  nyDate: string,
  opts: { slot?: string | null } = {},
): Promise<number> {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date AND source = 'user'
        AND status = ANY($4::text[])
        AND ($3::text IS NULL OR slot = $3::text)`,
    [bookingType(vertical, opts.slot), nyDate, opts.slot ?? null, [...PLACED_STATUSES]],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * How many slots are booked for this type on this New York day, by anyone
 * (person or night): the quota a cushion type subtracts on its target date.
 * `slot` narrows it to one window (Stories: one per series).
 */
export async function bookedOn(
  query: FillQuery,
  vertical: FillVertical,
  nyDate: string,
  opts: { slot?: string | null } = {},
): Promise<number> {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date
        AND status = ANY($4::text[])
        AND ($3::text IS NULL OR slot = $3::text)`,
    [bookingType(vertical, opts.slot), nyDate, opts.slot ?? null, [...PLACED_STATUSES]],
  );
  return Number(rows[0]?.n ?? 0);
}

/** `quota − placed`, never negative. A quota that isn't a positive number makes nothing. */
export function remainingQuota(quota: number, placed: number): number {
  if (!Number.isFinite(quota) || quota <= 0) return 0;
  const used = Number.isFinite(placed) && placed > 0 ? Math.floor(placed) : 0;
  return Math.max(0, Math.floor(quota) - used);
}

export type DailyFill = {
  vertical: FillVertical;
  nyDate: string;
  quota: number;
  /** What the quota subtracts: a person's placements, or every booking on a cushion type's target date (`counted`). */
  userPlaced: number;
  /** What the night may still make or allocate: quota − userPlaced. Each type may cap it further. */
  making: number;
  /** 'every': a cushion type's target date, where every booking counts (opts.lead > 0). Absent: people's placements only. */
  counted?: 'every';
};

/** Options for one day's fill: `slot` narrows to one window; `lead` > 0 counts every booking (rule 4). */
export type FillOptions = { slot?: string | null; lead?: number };

const countsEvery = (opts: FillOptions) => (opts.lead ?? 0) > 0;

/**
 * The day's fill for one type: its quota, what is already placed, and what is left for the night.
 * A cushion type passes its target date as `nyDate` and `lead: leadDaysFor(type)`, so every booking
 * already on that date counts (rule 4).
 */
export async function dailyFill(
  query: FillQuery,
  vertical: FillVertical,
  nyDate: string,
  quota: number,
  opts: FillOptions = {},
): Promise<DailyFill> {
  const every = countsEvery(opts);
  const placed = every ? await bookedOn(query, vertical, nyDate, opts) : await userPlaced(query, vertical, nyDate, opts);
  return { vertical, nyDate, quota, userPlaced: placed, making: remainingQuota(quota, placed), ...(every ? { counted: 'every' as const } : {}) };
}

/**
 * The day's fill, or, when the placements can't be read, the whole quota
 * (the night makes what it made before the rule) after telling `onError`.
 * A night run never stalls on this read.
 */
export async function dailyFillOrQuota(
  query: FillQuery,
  vertical: FillVertical,
  nyDate: string,
  quota: number,
  onError: (error: unknown) => void,
  opts: FillOptions = {},
): Promise<DailyFill> {
  try {
    return await dailyFill(query, vertical, nyDate, quota, opts);
  } catch (error) {
    onError(error);
    return { vertical, nyDate, quota, userPlaced: 0, making: remainingQuota(quota, 0), ...(countsEvery(opts) ? { counted: 'every' as const } : {}) };
  }
}

/** True when people's placements took some of the night's quota. */
export const fillReduced = (fill: DailyFill): boolean => fill.userPlaced > 0 && fill.making < fill.quota;

export type FillLog = (message: string, fields: Record<string, unknown>) => void;

/** The structured line every worker writes when a placement cut the night's count. */
export const consoleFillLog: FillLog = (message, fields) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'daily-fill', message, ...fields }));

/**
 * Log `fill_reduced { vertical, nyDate, quota, userPlaced, making, … }` when
 * placements cut the count; `extra` adds the type's own detail (series,
 * the count after the type's own caps). Returns whether it logged.
 */
export function reportFill(fill: DailyFill, log: FillLog = consoleFillLog, extra: Record<string, unknown> = {}): boolean {
  if (!fillReduced(fill)) return false;
  log('fill_reduced', { vertical: fill.vertical, nyDate: fill.nyDate, quota: fill.quota, userPlaced: fill.userPlaced, making: fill.making, ...(fill.counted ? { counted: fill.counted } : {}), ...extra });
  return true;
}

/** Why the night makes nothing new, in words for a run row, a result note or a log line. */
export function quotaFilledNote(fill: DailyFill, noun: string): string {
  const placed = `${fill.userPlaced} ${noun}${fill.userPlaced === 1 ? '' : 's'}`;
  if (fill.counted === 'every') return `Daily fill: ${placed} already booked for ${fill.nyDate}, which covers the day's quota of ${fill.quota}.`;
  return `Daily fill: people placed ${placed} for ${fill.nyDate}, which covers the day's quota of ${fill.quota}.`;
}
