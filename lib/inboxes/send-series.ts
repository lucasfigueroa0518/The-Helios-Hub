/**
 * Today-centered send series for the inbox drawer: 7 past days, today, 7 future.
 *
 * Warmup actuals come from Smartlead warmup-stats. Warmup future is projected
 * from live Smartlead warmup_details (current daily cap, ramping to max).
 * Campaign actuals come from email_sends. Campaign future is inbox capacity.
 */
import { addCalendarDays } from '@/lib/drafting/send-queue-schedule';

export const SEND_SERIES_PAST_DAYS = 7;
export const SEND_SERIES_FUTURE_DAYS = 7;

export type SendSeriesKind = 'actual' | 'today' | 'future';

export type SendSeriesDay = {
  date: string;
  warmup: number;
  campaign: number;
  kind: SendSeriesKind;
};

export type WarmupRamp = {
  enabled: boolean;
  /** Smartlead's current daily warmup cap (`warmup_details.max_email_per_day`). */
  currentDaily: number;
  /** Ceiling Smartlead ramps toward (`warmup_max_count`). */
  maxPerDay: number;
  dailyRampup: number;
};

export function buildSendSeries(input: {
  today: string;
  warmupByDate: Record<string, number>;
  warmupRamp: WarmupRamp;
  campaignByDate: Record<string, number>;
  campaignCapacityByDate: Record<string, number>;
}): SendSeriesDay[] {
  const days: SendSeriesDay[] = [];
  for (let offset = -SEND_SERIES_PAST_DAYS; offset <= SEND_SERIES_FUTURE_DAYS; offset += 1) {
    const date = addCalendarDays(input.today, offset);
    const kind: SendSeriesKind = offset < 0 ? 'actual' : offset === 0 ? 'today' : 'future';
    if (kind === 'future') {
      days.push({
        date,
        warmup: projectWarmup(input.warmupRamp, offset),
        campaign: input.campaignCapacityByDate[date] ?? 0,
        kind,
      });
      continue;
    }
    days.push({
      date,
      warmup: input.warmupByDate[date] ?? 0,
      campaign: input.campaignByDate[date] ?? 0,
      kind,
    });
  }
  return days;
}

export function projectWarmup(ramp: WarmupRamp, daysAhead: number): number {
  if (!ramp.enabled || daysAhead <= 0) return 0;
  const current = Math.max(0, ramp.currentDaily);
  const ceiling = Math.max(current, ramp.maxPerDay);
  const step = Math.max(0, ramp.dailyRampup);
  return Math.min(ceiling, current + daysAhead * step);
}

export function countsByDate(
  rows: Array<{ date: string; sent_count?: number; sent?: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const sent = Number(row.sent_count ?? row.sent ?? 0);
    if (!row.date || !Number.isFinite(sent)) continue;
    out[row.date] = sent;
  }
  return out;
}

export function actualTotals(days: SendSeriesDay[]): { warmup: number; campaign: number } {
  return days
    .filter((day) => day.kind !== 'future')
    .reduce(
      (sum, day) => ({ warmup: sum.warmup + day.warmup, campaign: sum.campaign + day.campaign }),
      { warmup: 0, campaign: 0 },
    );
}
