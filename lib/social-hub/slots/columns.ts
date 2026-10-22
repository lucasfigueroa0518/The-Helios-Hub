// lib/social-hub/slots/columns.ts
import type { SlotQuery } from './types';

/**
 * Whether a column exists yet. Code may reach a database before a schema file
 * adds it (ruling R3/R12), so writes name a new column only when it is there.
 * Reads never need this: they go through `to_jsonb(row)->>'col'`, which is
 * null on a missing column.
 *
 * Cached per query handle and column (one information_schema read each; a
 * route's request or a transaction gets a fresh handle). SELECT only. Takes a
 * bare query function (SlotQuery, SpineQuery) or a `{ query }` handle
 * (the Stories Queryable).
 */
type Handle = SlotQuery | { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const cache = new WeakMap<object, Map<string, Promise<boolean>>>();

export function hasColumn(h: Handle, schema: string, table: string, column: string): Promise<boolean> {
  let byCol = cache.get(h);
  if (!byCol) cache.set(h, (byCol = new Map()));
  const key = `${schema}.${table}.${column}`;
  const hit = byCol.get(key);
  if (hit) return hit;
  const run = typeof h === 'function' ? h : h.query.bind(h);
  const read = run(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [schema, table, column],
  ).then(({ rows }) => Number(rows[0]?.n ?? 0) > 0);
  byCol.set(key, read);
  read.catch(() => byCol!.delete(key));
  return read;
}

/** The "set by" columns of the hub's tables: social_hub.slot_override.set_by, social_hub.schedule.slot_by. */
export type MarkColumns = { overrideSetBy: boolean; scheduleSlotBy: boolean };

export async function markColumns(q: Handle): Promise<MarkColumns> {
  // One after the other: a transaction's handle runs one statement at a time.
  const overrideSetBy = await hasColumn(q, 'social_hub', 'slot_override', 'set_by');
  const scheduleSlotBy = await hasColumn(q, 'social_hub', 'schedule', 'slot_by');
  return { overrideSetBy, scheduleSlotBy };
}

/**
 * A schedule row's mark, through the row's JSON (R12): its slot_by when set
 * (a person's move, or the Stories projection mirroring stories.sets.slot_by),
 * else the person's when they placed it (source 'user'), else the system's.
 */
export const SCHEDULE_SLOT_BY_SQL = (alias: string) =>
  `coalesce(to_jsonb(${alias})->>'slot_by', CASE WHEN ${alias}.source = 'user' THEN 'person' ELSE 'system' END)`;
