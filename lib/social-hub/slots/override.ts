// lib/social-hub/slots/override.ts
import type { FeedMode, ResolvedSlot, SetBy } from './types';

/**
 * A date override row's SQL, shared by the calendar's writes (write.ts
 * writeDiff) and a hub placement that moves or adds a slot with its booking
 * (placement.ts). Writes: social_hub.slot_override.
 */

export const OVERRIDE_INSERT = `INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode, updated_by, updated_at)`;

export const OVERRIDE_UPSERT = `ON CONFLICT (ny_date, vertical, start_minute, (coalesce(series, ''))) DO UPDATE SET action = EXCLUDED.action, feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`;

/**
 * The same with the "set by" mark as the last column (after updated_at), for
 * a database that has slot_override.set_by (columns.ts markColumns); the
 * plain pair above runs where it doesn't yet (R3).
 */
export const OVERRIDE_INSERT_SET_BY = `INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode, updated_by, updated_at, set_by)`;

export const OVERRIDE_UPSERT_SET_BY = `${OVERRIDE_UPSERT}, set_by = EXCLUDED.set_by`;

/** The WHERE of one override row, its four key params from `$first`: date, vertical, minute, series. */
export const overrideKeyWhere = (first: number): string =>
  `ny_date = $${first}::date AND vertical = $${first + 1} AND start_minute = $${first + 2} AND coalesce(series, '') = coalesce($${first + 3}::text, '')`;

/** One override write: upsert this row, or delete the date's row for the key. */
export type OverrideOp =
  | { op: 'upsert'; nyDate: string; vertical: ResolvedSlot['vertical']; startMinute: number; series: ResolvedSlot['series']; action: 'add' | 'remove'; feedMode: FeedMode | null; setBy: SetBy }
  | { op: 'delete'; nyDate: string; vertical: ResolvedSlot['vertical']; startMinute: number; series: ResolvedSlot['series'] };

/**
 * The override a date needs for one key so that its slot is `want` (present
 * with that feed mode, or absent), against the Standard week's slot at that
 * key (`base`, undefined when the weekday has none). Same rule as write.ts
 * setDateDay: 'remove' only for a Standard-week slot, 'add' for anything
 * else. Where the date matches the Standard week the system writes no row;
 * a person keeps an 'add' pin there, so a later schedule save leaves the
 * time they chose alone.
 */
export function overrideFor(
  nyDate: string,
  key: Pick<ResolvedSlot, 'vertical' | 'startMinute' | 'series'>,
  base: Pick<ResolvedSlot, 'feedMode'> | undefined,
  want: { feedMode: FeedMode | null } | null,
  setBy: SetBy,
): OverrideOp {
  const k = { nyDate, vertical: key.vertical, startMinute: key.startMinute, series: key.series };
  if (want === null) return base ? { op: 'upsert', ...k, action: 'remove', feedMode: null, setBy } : { op: 'delete', ...k };
  if (base && base.feedMode === want.feedMode && setBy === 'system') return { op: 'delete', ...k };
  return { op: 'upsert', ...k, action: 'add', feedMode: want.feedMode, setBy };
}
