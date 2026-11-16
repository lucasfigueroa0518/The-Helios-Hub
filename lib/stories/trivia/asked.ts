/**
 * The questions the series has already asked (AT-57), for the repeat rule in quality.ts: the writer
 * sees every pool row (posted or waiting), the fact-check sees the posted ones. Reads only the
 * series' own pool rows; nothing else in the database is touched.
 */
import type { StoriesDb } from '@/lib/stories/db';

import type { AskedItem } from './prompts';
import { TRIVIA_SERIES, type TriviaPoolPayload } from './types';

export async function askedQuestions(db: StoriesDb, opts: { postedOnly: boolean; exceptKey?: string }): Promise<AskedItem[]> {
  const { rows } = await db.query<{ key: string; payload: TriviaPoolPayload }>(
    `SELECT key, payload FROM stories.pool WHERE series = $1 ${opts.postedOnly ? 'AND used_at IS NOT NULL' : ''} ORDER BY refreshed_at`,
    [TRIVIA_SERIES],
  );
  return rows
    .filter((r) => r.key !== opts.exceptKey && r.payload?.q?.question)
    .map((r) => ({ question: r.payload.q.question, answer: r.payload.q.options.find((o) => o.letter === r.payload.q.correct)?.text ?? '' }));
}
