import type { Queryable } from '@/lib/explainers/db';
import { zoneDateParts, zonedTime } from '@/lib/instagram/clock';
import { developmentSpendSince } from '@/lib/reel-ai-drama/cost';
import { readDramaGate } from '@/lib/reel-ai-drama/gate';
import { makeableCount } from '@/lib/reel-ai-drama/development/pool';
import { DRAMA_REFILL_HOUR_NY } from '@/lib/reel-ai-drama/publish/config';
import { loadSettings, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { PitchRow } from '@/lib/reel-ai-drama/types';

/**
 * The nightly refill clock (MD-156; was weekly, MD-28). The development session is AI Drama's pool refill (settings
 * standard D16, D3): it runs in every state, each night from 22:00 New York until the 00:00 fill, only while fewer than
 * `pool_refill_below` makeable pitches are pooled, under `nightly_dev_cap_usd` and the refill cap
 * (`pool_refill_cap_usd`, D14). Production does not come from here (HUB-WIRING-CONTRACT.md §1.1): it comes only
 * from the nightly fill (lib/reel-ai-drama/night.ts) or a person's click, and the worker tends the pool once a day on
 * its own. Safe to call on every worker poll.
 */

export type ScheduleDeps = {
  db: Queryable;
  runDevelopmentSession(opts: { trigger: 'auto'; refillCapUsd?: number }): Promise<unknown>;
  nextForProduction(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<PitchRow | null>;
  tendPool(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<{ faded: number; rechecked: number }>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

export type TickResult = {
  auto: boolean;
  /** The refill night this tick belongs to: the last 22:00 New York at or before now. */
  nightStart: string;
  /** `not_yet`: outside 22:00–00:00. `pool_stocked`: enough makeable pitches pooled, so tonight is skipped. */
  development: 'ran' | 'already_ran' | 'capped' | 'off' | 'failed' | 'not_yet' | 'pool_stocked';
  /** Makeable pooled pitches when the tick checked (null when it stopped before checking). */
  makeable: number | null;
};

/** The refill may start from 22:00 until the 00:00 fill; a night the worker misses waits for the next. */
export const REFILL_WINDOW_MS = (24 - DRAMA_REFILL_HOUR_NY) * 3600_000;

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

/**
 * The start of the refill night holding `now`: the last 22:00 New York at or before it. The nightly development
 * budget (refill and clicks together) is counted from here.
 */
export function refillNightStart(now: Date): Date {
  const { year, month, day } = zoneDateParts(now);
  const tonight = zonedTime(year, month, day, DRAMA_REFILL_HOUR_NY);
  if (tonight.getTime() <= now.getTime()) return tonight;
  const prev = new Date(Date.UTC(year, month - 1, day - 1));
  return zonedTime(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), DRAMA_REFILL_HOUR_NY);
}

export async function nightlyTick(deps: ScheduleDeps, now: Date): Promise<TickResult> {
  const { db } = deps;
  const log = deps.log ?? (() => undefined);
  const settings = await loadSettings(db);
  const gate = await readDramaGate(db);
  const start = refillNightStart(now);
  // `auto` reports Generate; the refill runs whatever it says (settings standard D16).
  const result: TickResult = { auto: settings.auto, nightStart: start.toISOString(), development: 'off', makeable: null };
  if (now.getTime() - start.getTime() >= REFILL_WINDOW_MS) {
    result.development = 'not_yet';
    return result;
  }

  const { rows: ran } = await db.query("SELECT 1 FROM reel_ai_drama.sessions WHERE trigger = 'auto' AND started_at >= $1 LIMIT 1", [start.toISOString()]);
  if (ran.length) {
    result.development = 'already_ran';
    return result;
  }
  result.makeable = await makeableCount(db, settings, now);
  if (result.makeable >= settings.pool_refill_below) {
    result.development = 'pool_stocked';
  } else if ((await developmentSpendSince(db, start)) >= settings.nightly_dev_cap_usd) {
    result.development = 'capped';
  } else {
    try {
      await deps.runDevelopmentSession({ trigger: 'auto', refillCapUsd: gate.refillCapUsd });
      result.development = 'ran';
    } catch (error) {
      result.development = 'failed';
      log('development_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
