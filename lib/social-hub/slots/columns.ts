// lib/social-hub/slots/columns.ts
import type { SlotQuery } from './types';

/**
 * Whether the "set by" columns exist yet (social_hub.slot_override.set_by,
 * social_hub.schedule.slot_by). Code may reach a database before
 * db/social_hub_schema.sql adds them (ruling R3/R12), so writes name a column
 * only when it is there. Reads never need this: they go through
 * `to_jsonb(row)->>'col'`, which is null on a missing column.
 *
 * Cached per query handle (one information_schema read per handle; a route's
 * transaction reads it once). SELECT only.
 */
export type MarkColumns = { overrideSetBy: boolean; scheduleSlotBy: boolean };

const cache = new WeakMap<object, Promise<MarkColumns>>();

export function markColumns(q: SlotQuery): Promise<MarkColumns> {
  const hit = cache.get(q);
  if (hit) return hit;
  const read = q(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'social_hub'
        AND ((table_name = 'slot_override' AND column_name = 'set_by') OR (table_name = 'schedule' AND column_name = 'slot_by'))`,
  ).then(({ rows }) => ({
    overrideSetBy: rows.some((r) => r.table_name === 'slot_override'),
    scheduleSlotBy: rows.some((r) => r.table_name === 'schedule'),
  }));
  cache.set(q, read);
  read.catch(() => cache.delete(q));
  return read;
}

/** A schedule row's mark: the person's when they set it (slot_by) or placed it (source 'user'), else the system's. */
export const SLOT_BY_SQL = (alias: string) =>
  `CASE WHEN (to_jsonb(${alias})->>'slot_by') = 'person' OR ${alias}.source = 'user' THEN 'person' ELSE 'system' END`;
