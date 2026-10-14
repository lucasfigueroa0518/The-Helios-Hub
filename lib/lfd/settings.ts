/**
 * lfd.settings, read and checked (spec §7.1). SELECT only and no network, so
 * hub read code may use it (tests/social-hub-scope.test.ts). Writes live in
 * lib/content-type/posting.ts.
 */
import { DEFAULT_LFD_DAYS, DEFAULT_LFD_RUN_CAP_USD } from './config';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query). */
export type LfdQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type LfdSettings = {
  autoRun: boolean;
  publishingLive: boolean;
  /** On unless set to false (docs/social-overnight.md, Approval). */
  requireApproval: boolean;
  /** Weekdays it posts (0 = Sunday), sorted. */
  days: number[];
  /** The run cap, or null when the stored value is not a positive number: a run then refuses to start. */
  runCapUsd: number | null;
  runCapRaw: unknown;
};

export function parseLfdSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): LfdSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const rawDays = get('days');
  const days =
    Array.isArray(rawDays) && rawDays.length > 0 && rawDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ? [...new Set(rawDays as number[])].sort((a, b) => a - b)
      : [...DEFAULT_LFD_DAYS];
  const rawCap = rows.some((r) => r.key === 'run_cap_usd') ? get('run_cap_usd') : DEFAULT_LFD_RUN_CAP_USD;
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

export async function readLfdSettings(q: LfdQuery): Promise<LfdSettings> {
  const { rows } = await q(`SELECT key, value FROM lfd.settings`);
  return parseLfdSettings(rows as Array<{ key: string; value: unknown }>);
}

/**
 * The weekdays Carousels give up (LFD-02): Last Few Days' days while its
 * auto_run is on, else none. An unreadable lfd schema means none, so
 * Carousels never stop because of it.
 */
export async function carouselOffDays(q: LfdQuery): Promise<number[]> {
  try {
    const s = await readLfdSettings(q);
    return s.autoRun ? s.days : [];
  } catch {
    return [];
  }
}

/**
 * Whether Last Few Days makes a post on `nyDate`: on its days while auto_run
 * is on. `anyDay`: its own page's button (Make Last Few Days now) makes one on
 * any day, auto_run on or off.
 */
export function lfdDueOn(s: Pick<LfdSettings, 'autoRun' | 'days'>, nyDate: string, anyDay = false): boolean {
  const weekday = new Date(`${nyDate}T12:00:00Z`).getUTCDay();
  return anyDay || (s.autoRun && s.days.includes(weekday));
}
