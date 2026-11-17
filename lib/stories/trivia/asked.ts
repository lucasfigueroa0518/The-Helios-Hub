/**
 * The earlier questions a new one must not repeat (AT-57, AT-78; the definition is REPEAT_RULE in quality.ts).
 * Two scoped lists, so each stays small for years:
 *
 *   writer       per offered cell, every question ever written in it: pooled, posted, or archived (a fact the
 *                check already failed is not tried again)
 *   fact-check   the questions posted on the same theme, plus any chosen to post alongside this one
 *
 * Reads only the series' own pool and archive rows for the cells or theme named; nothing else is touched.
 */
import type { StoriesDb } from '@/lib/stories/db';

import { cellOf } from './map';
import type { AskedItem } from './prompts';
import { TRIVIA_SERIES, type TriviaPoolPayload, type TriviaQuestion } from './types';

/** One question as an asked item: its text and the text of its correct option. */
export const askedItem = (q: Pick<TriviaQuestion, 'question' | 'options' | 'correct'>): AskedItem => ({
  question: q.question,
  answer: q.options.find((o) => o.letter === q.correct)?.text ?? '',
});

const usable = (p: Partial<TriviaPoolPayload> | null | undefined): p is TriviaPoolPayload => !!p?.q?.question && Array.isArray(p.q.options);

/** For each cell id, the questions already written in it (pool rows of any state, then the archive), oldest first. */
export async function askedInCells(db: StoriesDb, cellIds: string[]): Promise<Map<string, AskedItem[]>> {
  const out = new Map<string, AskedItem[]>(cellIds.map((c) => [c, []]));
  if (!cellIds.length) return out;
  const { rows } = await db.query<{ cell_id: string; payload: TriviaPoolPayload }>(
    `SELECT payload->'q'->>'cellId' AS cell_id, payload, refreshed_at AS at FROM stories.pool
      WHERE series = $1 AND payload->'q'->>'cellId' = ANY($2::text[])
     UNION ALL
     SELECT cell_id, payload, archived_at AS at FROM stories.trivia_archive WHERE cell_id = ANY($2::text[])
     ORDER BY at`,
    [TRIVIA_SERIES, cellIds],
  );
  for (const r of rows) {
    if (!usable(r.payload)) continue;
    const item = askedItem(r.payload.q);
    const list = out.get(r.cell_id);
    if (list && !list.some((a) => a.question === item.question)) list.push(item);
  }
  return out;
}

/** The questions posted on the cell's theme (except the pool row `exceptKey`), then `alongside`. */
export async function askedOnTheme(db: StoriesDb, cellId: string, opts: { exceptKey?: string; alongside?: AskedItem[] } = {}): Promise<AskedItem[]> {
  const theme = cellOf(cellId)?.theme;
  const posted: AskedItem[] = [];
  if (theme !== undefined) {
    const { rows } = await db.query<{ key: string; payload: TriviaPoolPayload }>(
      `SELECT p.key, p.payload FROM stories.pool p
         JOIN stories.trivia_cells c ON c.cell_id = p.payload->'q'->>'cellId'
        WHERE p.series = $1 AND p.used_at IS NOT NULL AND c.theme = $2
        ORDER BY p.used_at`,
      [TRIVIA_SERIES, theme],
    );
    for (const r of rows) if (r.key !== opts.exceptKey && usable(r.payload)) posted.push(askedItem(r.payload.q));
  }
  return [...posted, ...(opts.alongside ?? [])];
}
