/**
 * The content map's cells (CONTRACT.md §2; AT-78), in stories.trivia_cells. A cell holds many questions over time:
 *
 *   open      the writer may get it; `questions` counts the question numbers it has given out
 *   retired   the writer reported twice (`spent`) that it has no fresh fact left: never offered again
 *
 * Offered cells are sampled from the open ones, weighted toward those with fewer questions. A pooled
 * question's key is `trivia:<cellId>:<n>` (types.ts poolKeyOf), n its number in the cell. Nothing here
 * sweeps the database: each call reads the cell table or updates the cells it is given.
 */
import type { Queryable } from '@/lib/stories/db';

import { allCells, cellOf, isActive, type Cell } from './map';

export type CellState = 'open' | 'retired';

/** Two writer reports that a cell has no fresh fact left retire it (AT-78). */
export const SPENT_TO_RETIRE = 2;

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

/**
 * `n` open cells on the map, drawn without replacement with weight 1 / (1 + questions), so a cell that has
 * given fewer questions is likelier. `exclude` skips cells already offered today. `rand` is injectable for tests.
 */
export async function sampleOpenCells(db: Queryable, n: number, rand: () => number = Math.random, exclude: ReadonlySet<string> = new Set()): Promise<Cell[]> {
  const { rows } = await db.query<{ cell_id: string; questions: number }>(`SELECT cell_id, questions FROM stories.trivia_cells WHERE state = 'open'`);
  const drawn: Array<{ cell: Cell; k: number }> = [];
  for (const r of rows) {
    const cell = cellOf(r.cell_id);
    // AT-63: retired themes and angles are never offered.
    if (!cell || !isActive(cell) || exclude.has(cell.cellId)) continue;
    // Weighted sampling without replacement (Efraimidis–Spirakis): the n largest u^(1/w) win.
    const w = 1 / (1 + Math.max(0, Number(r.questions) || 0));
    drawn.push({ cell, k: Math.pow(rand(), 1 / w) });
  }
  return drawn.sort((a, b) => b.k - a.k || a.cell.cellId.localeCompare(b.cell.cellId)).slice(0, n).map((d) => d.cell);
}

/** The next question number in an open cell (counted in `questions`). Null when the cell is not open. */
export async function claimQuestionNumber(db: Queryable, cellId: string): Promise<number | null> {
  const { rows } = await db.query<{ questions: number }>(
    `UPDATE stories.trivia_cells SET questions = questions + 1, updated_at = now() WHERE cell_id = $1 AND state = 'open' RETURNING questions`,
    [cellId],
  );
  return rows.length ? Number(rows[0]!.questions) : null;
}

/** The writer reported these open cells spent: one more report each; the second retires the cell. Returns the cells retired now. */
export async function reportSpent(db: Queryable, cellIds: string[]): Promise<string[]> {
  if (!cellIds.length) return [];
  const { rows } = await db.query<{ cell_id: string; state: CellState }>(
    `UPDATE stories.trivia_cells
        SET spent = spent + 1, state = CASE WHEN spent + 1 >= $2 THEN 'retired' ELSE state END, updated_at = now()
      WHERE cell_id = ANY($1::text[]) AND state = 'open'
      RETURNING cell_id, state`,
    [cellIds, SPENT_TO_RETIRE],
  );
  return rows.filter((r) => r.state === 'retired').map((r) => r.cell_id);
}

export async function cellState(db: Queryable, cellId: string): Promise<CellState | null> {
  const { rows } = await db.query<{ state: CellState }>(`SELECT state FROM stories.trivia_cells WHERE cell_id = $1`, [cellId]);
  return rows[0]?.state ?? null;
}
