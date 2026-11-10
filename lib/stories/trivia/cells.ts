/**
 * The content map's cell states (CONTRACT.md §2), in stories.trivia_cells:
 *
 *   open      the writer may get it
 *   reserved  a validated question holds it (pool key in pool_key)
 *   closed    its question posted: never offered again
 *
 * Writer output validated → reserved; pool row dropped (cap) or archived
 * (fact-check) → open; set published → closed. freeCell and closeCell take a
 * cell id or a pool key (`trivia:<cellId>`).
 */
import type { Queryable } from '@/lib/stories/db';

import { allCells, cellOf, type Cell } from './map';
import { TRIVIA_KEY_PREFIX } from './types';

export type CellState = 'open' | 'reserved' | 'closed';

const idOf = (cellOrKey: string) => (cellOrKey.startsWith(TRIVIA_KEY_PREFIX) ? cellOrKey.slice(TRIVIA_KEY_PREFIX.length) : cellOrKey);

/** Insert any map cell the table lacks (the schema file seeds all 400; this only fills a gap). Returns the count added. */
export async function ensureCells(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.trivia_cells`);
  const cells = allCells();
  if (Number(rows[0]?.n ?? 0) >= cells.length) return 0;
  const { rows: added } = await db.query<{ cell_id: string }>(
    `INSERT INTO stories.trivia_cells (cell_id, theme, angle)
     SELECT * FROM unnest($1::text[], $2::smallint[], $3::smallint[])
     ON CONFLICT (cell_id) DO NOTHING RETURNING cell_id`,
    [cells.map((c) => c.cellId), cells.map((c) => c.theme), cells.map((c) => c.angle)],
  );
  return added.length;
}

/** The ids of every open cell. */
export async function openCellIds(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ cell_id: string }>(`SELECT cell_id FROM stories.trivia_cells WHERE state = 'open'`);
  return new Set(rows.map((r) => r.cell_id));
}

/** `n` random open cells that are on the map. `rand` is injectable for tests. */
export async function sampleOpenCells(db: Queryable, n: number, rand: () => number = Math.random): Promise<Cell[]> {
  const open = [...(await openCellIds(db))].map(cellOf).filter((c): c is Cell => c !== null);
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [open[i], open[j]] = [open[j]!, open[i]!];
  }
  return open.slice(0, n);
}

/** Reserve an open cell for a pool key. False when the cell was not open. */
export async function reserveCell(db: Queryable, cellOrKey: string, poolKey: string): Promise<boolean> {
  const { rows } = await db.query<{ cell_id: string }>(
    `UPDATE stories.trivia_cells SET state = 'reserved', pool_key = $2, updated_at = now() WHERE cell_id = $1 AND state = 'open' RETURNING cell_id`,
    [idOf(cellOrKey), poolKey],
  );
  return rows.length > 0;
}

/** Back to open (dropped by the cap, archived by the fact-check, or never pooled). A closed cell stays closed. */
export async function freeCell(db: Queryable, cellOrKey: string): Promise<boolean> {
  const { rows } = await db.query<{ cell_id: string }>(
    `UPDATE stories.trivia_cells SET state = 'open', pool_key = NULL, updated_at = now() WHERE cell_id = $1 AND state <> 'closed' RETURNING cell_id`,
    [idOf(cellOrKey)],
  );
  return rows.length > 0;
}

/** Closed for good: its question posted. */
export async function closeCell(db: Queryable, cellOrKey: string): Promise<boolean> {
  const { rows } = await db.query<{ cell_id: string }>(
    `UPDATE stories.trivia_cells SET state = 'closed', updated_at = now() WHERE cell_id = $1 RETURNING cell_id`,
    [idOf(cellOrKey)],
  );
  return rows.length > 0;
}

export async function cellState(db: Queryable, cellOrKey: string): Promise<CellState | null> {
  const { rows } = await db.query<{ state: CellState }>(`SELECT state FROM stories.trivia_cells WHERE cell_id = $1`, [idOf(cellOrKey)]);
  return rows[0]?.state ?? null;
}
