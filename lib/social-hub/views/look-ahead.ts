import { addDays, nyDateOf, nyDayStart } from '@/lib/social-hub/time';

/**
 * The Content page's look-ahead (Tommy, 2026-10-11): the same Today's Content
 * view pointed at tomorrow, to plan it. Everything the view reads (quota
 * candidates, slots, the ranking) takes its day from one instant, so
 * "tomorrow" is that instant moved to midday of the next New York day. Midday
 * keeps it on that date through a daylight-saving change.
 *
 * The page asks for it with `?look=tomorrow`. (Not `day`: an old link's `day`
 * means a calendar day and redirects to the calendar.)
 */
export type ContentDay = {
  /** True when the view is tomorrow. */
  ahead: boolean;
  /** The New York day being shown, YYYY-MM-DD. */
  day: string;
  /** An instant on that day: what the day's views are computed from. */
  at: Date;
};

export const LOOK_PARAM = 'look';
export const LOOK_TOMORROW = 'tomorrow';

export function contentDay(now: Date, look: string | null | undefined): ContentDay {
  const today = nyDateOf(now)!;
  if (look !== LOOK_TOMORROW) return { ahead: false, day: today, at: now };
  const day = addDays(today, 1);
  return { ahead: true, day, at: new Date(nyDayStart(day).getTime() + 12 * 3_600_000) };
}
