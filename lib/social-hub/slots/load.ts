// lib/social-hub/slots/load.ts
import { addCalendarDays } from '@/lib/instagram/window';
import { isStoryVertical, SERIES_OF_VERTICAL, verticalOfSeries } from '@/lib/social-hub/story-types';
import type { Vertical } from '@/lib/social-hub/types';

import { resolveDay } from './resolve';
import { DEFAULT_CAPS } from './times';
import { isStorySeries, type OverrideRow, type StorySeries, type ResolvedSlot, type SlotQuery, type SlotSource, type TemplateRow } from './types';

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
/**
 * A Stories-format row's type is its series' type (SS-1): a row written before db/stories_split.sql moved it
 * (`vertical = 'stories'`, series `ai_trivia`) reads as Are you smarter than AI?'s.
 */
const typeOf = (vertical: Vertical, series: StorySeries | null): Vertical => (isStoryVertical(vertical) && series ? verticalOfSeries(series) : vertical);
/** A Stories-format row must name its type's live series: a retired one's rows (Guess the Number, AT-14) are not read. */
const live = <T extends { vertical: Vertical; series: StorySeries | null }>(r: T) => !isStoryVertical(r.vertical) || (r.series !== null && SERIES_OF_VERTICAL[r.vertical] === r.series);

export async function readTemplate(q: SlotQuery): Promise<TemplateRow[]> {
  const { rows } = await q(`SELECT weekday, vertical, start_minute, series, feed_mode FROM social_hub.slot_template`);
  return rows.map((r) => ({ weekday: Number(r.weekday), vertical: typeOf(r.vertical, seriesOf(r.series)), startMinute: Number(r.start_minute), series: seriesOf(r.series), feedMode: r.feed_mode ?? null })).filter(live);
}

export async function readOverrides(q: SlotQuery, from: string, to: string): Promise<OverrideRow[]> {
  const { rows } = await q(
    // set_by through the row's JSON: null (the system's) on a database without the column yet (R12).
    `SELECT ny_date::text AS ny_date, vertical, start_minute, series, action, feed_mode, to_jsonb(o)->>'set_by' AS set_by FROM social_hub.slot_override o
      WHERE ny_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return rows.map((r) => ({
    nyDate: String(r.ny_date).slice(0, 10), vertical: typeOf(r.vertical, seriesOf(r.series)), startMinute: Number(r.start_minute), series: seriesOf(r.series), action: r.action, feedMode: r.feed_mode ?? null,
    setBy: (r.set_by === 'person' ? 'person' : 'system') as OverrideRow['setBy'],
  })).filter(live);
}

/** Resolved slots for every date from `from` through `to` (inclusive). */
export async function loadSlots(q: SlotQuery, from: string, to: string): Promise<Map<string, ResolvedSlot[]>> {
  const [template, overrides] = await Promise.all([readTemplate(q), readOverrides(q, from, to)]);
  const out = new Map<string, ResolvedSlot[]>();
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) out.set(d, resolveDay(template, overrides, d));
  return out;
}

/**
 * Each type's ceiling on slots a day: its fixed maximum (times.ts DEFAULT_CAPS). Since D20 the calendar's slots are
 * the count, so the old adjustable limit (social_hub.settings 'daily_caps') is no longer read. Async and given the
 * query so every caller stays as it was.
 */
export async function readCaps(_q: SlotQuery): Promise<Record<Vertical, number>> {
  return { ...DEFAULT_CAPS };
}
