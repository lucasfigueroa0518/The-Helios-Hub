/**
 * Freshness window (spec §5B): 24h, 36h on weekends, 48h when widened
 * because fewer than 2 stories qualified. Weekend = Saturday or Sunday in
 * the pipeline's day time zone.
 */
import { DAY_TIME_ZONE } from '@/lib/social/pipeline/set-aside-log';

import type { IngestArticle } from './types';

export const WEEKDAY_HOURS = 24;
export const WEEKEND_HOURS = 36;
export const WIDENED_HOURS = 48;

export function isWeekend(now: Date, timeZone: string = DAY_TIME_ZONE): boolean {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  return day === 'Sat' || day === 'Sun';
}

export function windowHours(now: Date, widened: boolean): number {
  if (widened) return WIDENED_HOURS;
  return isWeekend(now) ? WEEKEND_HOURS : WEEKDAY_HOURS;
}

export function inWindow(article: Pick<IngestArticle, 'publishedAt'>, now: Date, hours: number): boolean {
  const age = now.getTime() - article.publishedAt.getTime();
  return age >= 0 ? age <= hours * 3_600_000 : true;
}
