// lib/social-hub/slots/load.ts
import { addCalendarDays } from '@/lib/instagram/window';

import { resolveDay } from './resolve';
import type { OverrideRow, ResolvedSlot, SlotQuery, SlotSource, TemplateRow } from './types';

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

export async function readTemplate(q: SlotQuery): Promise<TemplateRow[]> {
  const { rows } = await q(`SELECT weekday, vertical, window_id, feed_mode FROM social_hub.slot_template`);
  return rows.map((r) => ({ weekday: Number(r.weekday), vertical: r.vertical, windowId: r.window_id, feedMode: r.feed_mode ?? null }));
}

export async function readOverrides(q: SlotQuery, from: string, to: string): Promise<OverrideRow[]> {
  const { rows } = await q(
    `SELECT ny_date::text AS ny_date, vertical, window_id, action, feed_mode FROM social_hub.slot_override
      WHERE ny_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return rows.map((r) => ({ nyDate: String(r.ny_date).slice(0, 10), vertical: r.vertical, windowId: r.window_id, action: r.action, feedMode: r.feed_mode ?? null }));
}

/** Resolved slots for every date from `from` through `to` (inclusive). */
export async function loadSlots(q: SlotQuery, from: string, to: string): Promise<Map<string, ResolvedSlot[]>> {
  const [template, overrides] = await Promise.all([readTemplate(q), readOverrides(q, from, to)]);
  const out = new Map<string, ResolvedSlot[]>();
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) out.set(d, resolveDay(template, overrides, d));
  return out;
}
