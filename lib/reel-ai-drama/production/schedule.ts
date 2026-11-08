import type { Queryable } from '@/lib/explainers/db';
import { developmentSpendSince } from '@/lib/reel-ai-drama/cost';
import { loadSettings, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { PitchRow } from '@/lib/reel-ai-drama/types';

/**
 * The weekly clock (MD-28). Off unless `settings.auto`. Once a week, under the weekly development cap: one
 * development session. Production no longer comes from here (HUB-WIRING-CONTRACT.md §1.1: `per_week` is retired):
 * it comes only from the nightly fill (lib/reel-ai-drama/night.ts) or a person's click, and the worker tends the pool
 * once a day on its own. Safe to call on every worker poll.
 */

export type ScheduleDeps = {
  db: Queryable;
  runDevelopmentSession(opts: { trigger: 'auto' }): Promise<unknown>;
  nextForProduction(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<PitchRow | null>;
  tendPool(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<{ faded: number; rechecked: number }>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

export type TickResult = {
  auto: boolean;
  weekStart: string;
  development: 'ran' | 'already_ran' | 'capped' | 'off' | 'failed';
  tended: { faded: number; rechecked: number } | null;
  jobsDue: number;
  jobsThisWeek: number;
  requested: string[];
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Monday 00:00 in New York, as an instant, for the week holding `now`. */
export function weekStart(now: Date): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  const sinceMidnight = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  // New York midnight of this day minus the days since Monday; DST shifts are re-checked once.
  let start = new Date(now.getTime() - sinceMidnight - dow * DAY_MS);
  const check = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(start);
  const drift = Number(check) % 24;
  if (drift === 23) start = new Date(start.getTime() + 3600_000);
  else if (drift === 1) start = new Date(start.getTime() - 3600_000);
  return start;
}

/** How many of the week's `perWeek` slots have opened by `now`. */
export function slotsOpen(perWeek: number, start: Date, now: Date): number {
  if (perWeek <= 0) return 0;
  const elapsed = now.getTime() - start.getTime();
  return Math.min(perWeek, Math.floor(elapsed / (WEEK_MS / perWeek)) + 1);
}

export async function weeklyTick(deps: ScheduleDeps, now: Date): Promise<TickResult> {
  const { db } = deps;
  const log = deps.log ?? (() => undefined);
  const settings = await loadSettings(db);
  const start = weekStart(now);
  const result: TickResult = { auto: settings.auto, weekStart: start.toISOString(), development: 'off', tended: null, jobsDue: 0, jobsThisWeek: 0, requested: [] };
  if (!settings.auto) return result;

  // Development: once a week, under the cap (MD-28).
  const { rows: ran } = await db.query("SELECT 1 FROM reel_ai_drama.sessions WHERE trigger = 'auto' AND started_at >= $1 LIMIT 1", [start.toISOString()]);
  if (ran.length) {
    result.development = 'already_ran';
  } else if ((await developmentSpendSince(db, start)) >= settings.weekly_dev_cap_usd) {
    result.development = 'capped';
  } else {
    try {
      await deps.runDevelopmentSession({ trigger: 'auto' });
      result.development = 'ran';
    } catch (error) {
      result.development = 'failed';
      log('development_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
