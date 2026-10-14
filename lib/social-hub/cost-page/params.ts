import { addDays, isDayKey, nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { isVertical } from '@/lib/social-hub/verticals';

type Params = { get(name: string): string | null };

/** Longest custom range, in days (inclusive). A longer one keeps its `to` and starts 365 days earlier. */
export const MAX_CUSTOM_DAYS = 366;

export type CostRange = '7d' | '30d' | 'month' | 'custom';
export type CostParams = { range: CostRange; from: string; to: string; vertical: Vertical | null; mode: 'production' | 'development' };

/**
 * Pure. The Cost page's URL: range (7d, 30d, this month, custom from/to), type and mode.
 * Lives apart from load.ts so the fixture preview can parse params without importing a loader.
 */
export function parseCostParams(p: Params, now: Date): CostParams {
  const today = nyDateOf(now)!;
  const type = p.get('type');
  const vertical: Vertical | null = isVertical(type) ? type : null;
  const mode = p.get('mode') === 'development' ? 'development' : 'production';
  const r = p.get('range');
  if (r === '7d') return { range: '7d', from: addDays(today, -6), to: today, vertical, mode };
  if (r === '30d') return { range: '30d', from: addDays(today, -29), to: today, vertical, mode };
  const from = p.get('from');
  const to = p.get('to');
  if (r === 'custom' && isDayKey(from) && isDayKey(to) && from <= to) {
    const earliest = addDays(to, -(MAX_CUSTOM_DAYS - 1));
    return { range: 'custom', from: from < earliest ? earliest : from, to, vertical, mode };
  }
  return { range: 'month', from: `${today.slice(0, 7)}-01`, to: today, vertical, mode };
}
