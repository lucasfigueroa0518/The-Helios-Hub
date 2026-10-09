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
 *
 * This file only counts and logs. It reads `social_hub.schedule` (SELECT
 * only) and imports nothing, so any worker, and hub read code, can use it.
 */

/** The query shape every type's database handle already offers. */
export type FillQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type FillVertical = 'carousels' | 'explainers' | 'reels' | 'stories';

/** Slot statuses that hold a day's place: waiting, posting, or posted. Cancelled and failed never count. */
export const PLACED_STATUSES = ['scheduled', 'publishing', 'published'] as const;

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
    [vertical, nyDate, opts.slot ?? null, [...PLACED_STATUSES]],
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
  userPlaced: number;
  /** What the night may still make or allocate: quota − userPlaced. Each type may cap it further. */
  making: number;
};

/** The day's fill for one type: its quota, what people placed, and what is left for the night. */
export async function dailyFill(
  query: FillQuery,
  vertical: FillVertical,
  nyDate: string,
  quota: number,
  opts: { slot?: string | null } = {},
): Promise<DailyFill> {
  const placed = await userPlaced(query, vertical, nyDate, opts);
  return { vertical, nyDate, quota, userPlaced: placed, making: remainingQuota(quota, placed) };
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
  opts: { slot?: string | null } = {},
): Promise<DailyFill> {
  try {
    return await dailyFill(query, vertical, nyDate, quota, opts);
  } catch (error) {
    onError(error);
    return { vertical, nyDate, quota, userPlaced: 0, making: remainingQuota(quota, 0) };
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
  log('fill_reduced', { vertical: fill.vertical, nyDate: fill.nyDate, quota: fill.quota, userPlaced: fill.userPlaced, making: fill.making, ...extra });
  return true;
}

/** Why the night makes nothing new, in words for a run row, a result note or a log line. */
export function quotaFilledNote(fill: DailyFill, noun: string): string {
  const placed = `${fill.userPlaced} ${noun}${fill.userPlaced === 1 ? '' : 's'}`;
  return `Daily fill: people placed ${placed} for ${fill.nyDate}, which covers the day's quota of ${fill.quota}.`;
}
