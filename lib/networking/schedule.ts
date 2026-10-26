/**
 * When the weekly ingest runs (AE-08): Sunday from 09:00 America/New_York, so the AI Events
 * ranking at 12:00 PM reads a fresh pool. The worker clock is UTC, so the zone is explicit.
 * Before this change the job was keyed by the UTC ISO week and so ran Monday 00:00 UTC
 * (Sunday about 8 PM ET), after the Sunday evening post.
 */
export const INGEST_TIMEZONE = 'America/New_York';
export const INGEST_WEEKDAY = 0;
export const INGEST_HOUR = 9;

export type WeeklyIngestDecision =
  | { due: false }
  | {
      due: true;
      /** ISO week of the New York calendar day (Sunday ends its ISO week). */
      weekKey: string;
      /**
       * Orchestration dedupe key: one ingest per ISO week. Prefixed so it never collides with
       * the old bare `2026-W43` keys, which would silently skip the first Sunday after deploy.
       */
      dedupeKey: string;
    };

/** ISO week of `date`'s calendar day in the process zone, e.g. "2026-W43". */
export function isoWeekKey(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

type ZonedParts = { year: number; month: number; day: number; weekday: number; hour: number };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zonedParts(now: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
    hour: Number(get('hour')),
  };
}

/** Pure: is the weekly ingest due at `now`? Reconcile asks every tick; the dedupe key keeps it to one a week. */
export function weeklyIngestDecision(now: Date): WeeklyIngestDecision {
  const local = zonedParts(now, INGEST_TIMEZONE);
  if (local.weekday !== INGEST_WEEKDAY || local.hour < INGEST_HOUR) return { due: false };
  const weekKey = isoWeekKey(new Date(local.year, local.month - 1, local.day, 12));
  return { due: true, weekKey, dedupeKey: `sunday:${weekKey}` };
}
