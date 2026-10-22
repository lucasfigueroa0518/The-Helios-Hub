// lib/social-hub/slots/load.ts
import { addCalendarDays } from '@/lib/instagram/window';
import type { Vertical } from '@/lib/social-hub/types';

import { resolveDay } from './resolve';
import { DEFAULT_CAPS } from './times';
import { isStorySeries, type OverrideRow, type ResolvedSlot, type SlotQuery, type SlotSource, type TemplateRow } from './types';

/** SELECT only (tests/social-hub-scope.test.ts): hub read code and every worker may use it. */

/** 'template' only when the row says so; anything unreadable is 'legacy', the old behavior. */
export async function readSlotSource(q: SlotQuery): Promise<SlotSource> {
  try {
    const { rows } = await q(`SELECT value FROM social_hub.settings WHERE key = 'slot_source'`);
    return rows[0]?.value === 'template' ? 'template' : 'legacy';
  } catch {
    return 'legacy';
  }
}

const seriesOf = (v: unknown) => (isStorySeries(v) ? v : null);

export async function readTemplate(q: SlotQuery): Promise<TemplateRow[]> {
  const { rows } = await q(`SELECT weekday, vertical, start_minute, series, feed_mode FROM social_hub.slot_template`);
  return rows.map((r) => ({ weekday: Number(r.weekday), vertical: r.vertical, startMinute: Number(r.start_minute), series: seriesOf(r.series), feedMode: r.feed_mode ?? null }));
}

export async function readOverrides(q: SlotQuery, from: string, to: string): Promise<OverrideRow[]> {
  const { rows } = await q(
    // set_by through the row's JSON: null (the system's) on a database without the column yet (R12).
    `SELECT ny_date::text AS ny_date, vertical, start_minute, series, action, feed_mode, to_jsonb(o)->>'set_by' AS set_by FROM social_hub.slot_override o
      WHERE ny_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return rows.map((r) => ({
    nyDate: String(r.ny_date).slice(0, 10), vertical: r.vertical, startMinute: Number(r.start_minute), series: seriesOf(r.series), action: r.action, feedMode: r.feed_mode ?? null,
    setBy: r.set_by === 'person' ? 'person' : 'system',
  }));
}

/** Resolved slots for every date from `from` through `to` (inclusive). */
export async function loadSlots(q: SlotQuery, from: string, to: string): Promise<Map<string, ResolvedSlot[]>> {
  const [template, overrides] = await Promise.all([readTemplate(q), readOverrides(q, from, to)]);
  const out = new Map<string, ResolvedSlot[]>();
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) out.set(d, resolveDay(template, overrides, d));
  return out;
}

const isCap = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10;

/**
 * Each type's daily safety cap (spec §Safety cap), from social_hub.settings
 * 'daily_caps'. A missing row, a bad value or any read error gives that
 * type's default (times.ts DEFAULT_CAPS). Stories: per series.
 */
export async function readCaps(q: SlotQuery): Promise<Record<Vertical, number>> {
  const out = { ...DEFAULT_CAPS };
  try {
    const { rows } = await q(`SELECT value FROM social_hub.settings WHERE key = 'daily_caps'`);
    const stored = rows[0]?.value as Partial<Record<Vertical, unknown>> | undefined;
    if (stored && typeof stored === 'object') {
      for (const v of Object.keys(out) as Vertical[]) if (isCap(stored[v])) out[v] = stored[v] as number;
    }
  } catch { /* defaults */ }
  return out;
}
