/**
 * ai_events.settings, read and checked (plan M4; the lfd.settings rules). SELECT only and no
 * network, so hub read code may use it (tests/social-hub-scope.test.ts). Writes live in
 * lib/content-type/posting.ts.
 */
import { DEFAULT_AI_EVENTS_DAYS, DEFAULT_AI_EVENTS_RUN_CAP_USD } from './config';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query). */
export type AiEventsQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type AiEventsSettings = {
  autoRun: boolean;
  publishingLive: boolean;
  /** On unless set to false (docs/social-overnight.md, Approval). */
  requireApproval: boolean;
  /** Weekdays it runs and posts (0 = Sunday), sorted. */
  days: number[];
  /** The run cap, or null when the stored value is not a positive number: a run then refuses to start. */
  runCapUsd: number | null;
  runCapRaw: unknown;
};

export function parseAiEventsSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): AiEventsSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const rawDays = get('days');
  const days =
    Array.isArray(rawDays) && rawDays.length > 0 && rawDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ? [...new Set(rawDays as number[])].sort((a, b) => a - b)
      : [...DEFAULT_AI_EVENTS_DAYS];
  const rawCap = rows.some((r) => r.key === 'run_cap_usd') ? get('run_cap_usd') : DEFAULT_AI_EVENTS_RUN_CAP_USD;
  const cap = Number(rawCap);
  return {
    autoRun: get('auto_run') === true,
    publishingLive: get('publishing_live') === true,
    requireApproval: get('require_approval') !== false,
    days,
    runCapUsd: typeof rawCap !== 'boolean' && rawCap !== null && Number.isFinite(cap) && cap > 0 ? cap : null,
    runCapRaw: rawCap,
  };
}

export async function readAiEventsSettings(q: AiEventsQuery): Promise<AiEventsSettings> {
  const { rows } = await q(`SELECT key, value FROM ai_events.settings`);
  return parseAiEventsSettings(rows as Array<{ key: string; value: unknown }>);
}

/**
 * Whether AI Events makes a post on `nyDate`: on its days while auto_run is on. `anyDay`: its
 * own page's Generate makes one on any day, auto_run on or off.
 */
export function aiEventsDueOn(s: Pick<AiEventsSettings, 'autoRun' | 'days'>, nyDate: string, anyDay = false): boolean {
  const weekday = new Date(`${nyDate}T12:00:00Z`).getUTCDay();
  return anyDay || (s.autoRun && s.days.includes(weekday));
}
