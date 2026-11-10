/**
 * The AI Trivia daily writer (PLAN.md Stage 5, AT-3, AT-7 to AT-11):
 *
 *   cells      12 random open cells from the content map
 *   writer     one trivia-write@1 call (Sonnet, settings.models.copy, ≤5 web searches)
 *   validator  code (validate.ts); a failing question is dropped and its cell stays open
 *   reserve    each valid question reserves its cell (at most 3 a day)
 *   Jev        trivia-score@1 per question; score = mean of writer's and Jev's 6 numbers
 *   pool       one stories.pool row per question (key trivia:<cellId>), then the cap of 20
 *
 * Runs once per pool day (the record in stories.settings 'trivia_daily'); a
 * second call the same day does nothing unless forced. Nothing in the
 * database is swept: the only rows read are the cell table and the pool.
 */
import type { StoriesDb } from '@/lib/stories/db';
import type { StoriesJev } from '@/lib/stories/jev';
import { capTriviaPool, poolDay } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import type { StoriesSettings } from '@/lib/stories/settings';
import { writeStructured, type WriterCreate } from '@/lib/stories/writer';

import { ensureCells, freeCell, openCellIds, reserveCell, sampleOpenCells } from './cells';
import { TRIVIA_WRITE, TRIVIA_WRITE_SEARCHES, type TriviaWriteMaterial, type TriviaWriteOut } from './prompts';
import { TRIVIA_SCORE } from './questions';
import { SCORECARD_KEYS, TRIVIA_SERIES, triviaPoolKey, triviaScore, type Scorecard, type TriviaPoolPayload, type TriviaQuestion } from './types';
import { validateQuestion } from './validate';

export const CELLS_OFFERED = 12;
export const QUESTIONS_PER_DAY = 3;
const RECORD_KEY = 'trivia_daily';

export type TriviaDailyDeps = {
  db: StoriesDb;
  jev: StoriesJev;
  write: WriterCreate;
  settings: StoriesSettings;
  now: Date;
  /** Cell sampling (tests pass a fixed one). */
  rand?: () => number;
  /** Run even if today's run is recorded. */
  force?: boolean;
};

export type TriviaDailyRecord = {
  day: string;
  at: string;
  offered: string[];
  pooled: Array<{ key: string; score: number }>;
  rejected: Array<{ cellId: string; problems: string[] }>;
  dropped: string[];
  error?: string;
};

export type TriviaDailyResult = { ran: false; reason: string } | ({ ran: true } & TriviaDailyRecord);

const jevScorecard = (answers: Record<string, unknown>): Scorecard => {
  const out = {} as Scorecard;
  for (const k of SCORECARD_KEYS) {
    const v = (answers[k] as { noul?: unknown } | undefined)?.noul;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`trivia-score: no answer for ${k}`);
    out[k] = Math.min(1, Math.max(0, v));
  }
  return out;
};

async function saveRecord(db: StoriesDb, rec: TriviaDailyRecord): Promise<void> {
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, 'worker', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [RECORD_KEY, JSON.stringify(rec)],
  );
}

export async function runTriviaDaily(deps: TriviaDailyDeps): Promise<TriviaDailyResult> {
  const { db, now } = deps;
  const day = poolDay(now);
  if (!deps.force) {
    const { rows } = await db.query<{ value: { day?: string } | null }>(`SELECT value FROM stories.settings WHERE key = $1`, [RECORD_KEY]);
    if (rows[0]?.value?.day === day) return { ran: false, reason: `already ran for ${day}` };
  }
  const rec: TriviaDailyRecord = { day, at: now.toISOString(), offered: [], pooled: [], rejected: [], dropped: [] };
  try {
    await ensureCells(db);
    const cells = await sampleOpenCells(db, CELLS_OFFERED, deps.rand);
    rec.offered = cells.map((c) => c.cellId);
    if (!cells.length) {
      rec.error = 'no open cells';
      return { ran: true, ...rec };
    }

    // 1. One writer call.
    const mat: TriviaWriteMaterial = { today: day, cells: cells.map((c) => ({ cell_id: c.cellId, theme: c.themeText, angle: c.angleText })) };
    const out = (await writeStructured<TriviaWriteOut>({
      create: deps.write, db, setId: null, component: 'trivia-write', model: deps.settings.models.copy,
      system: TRIVIA_WRITE.system, tool: TRIVIA_WRITE.tool, user: material(mat), webSearch: { maxUses: TRIVIA_WRITE_SEARCHES },
    })).value;

    // 2. Validate in code; at most QUESTIONS_PER_DAY valid questions go on.
    const offered = new Set(rec.offered);
    const open = await openCellIds(db);
    const taken = new Set<string>();
    const valid: TriviaQuestion[] = [];
    for (const item of Array.isArray(out?.questions) ? out.questions : []) {
      const v = validateQuestion(item, { offered, open, taken });
      if (!v.ok) {
        rec.rejected.push({ cellId: v.cellId, problems: v.problems });
        continue;
      }
      if (valid.length >= QUESTIONS_PER_DAY) {
        rec.rejected.push({ cellId: v.q.cellId, problems: [`over the ${QUESTIONS_PER_DAY} a day`] });
        continue;
      }
      taken.add(v.q.cellId);
      valid.push(v.q);
    }

    // 3. Reserve, score with Jev, pool.
    for (const q of valid) {
      const key = triviaPoolKey(q.cellId);
      if (!(await reserveCell(db, q.cellId, key))) {
        rec.rejected.push({ cellId: q.cellId, problems: ['cell no longer open'] });
        continue;
      }
      let jevScore: Scorecard;
      try {
        const res = await deps.jev.ask({
          component: 'trivia-score', set: TRIVIA_SCORE, setId: null,
          state: { question: q.question, options: q.options.map((o) => `${o.letter}. ${o.text}`), correct: q.correct, answer_line: q.answerLine },
        });
        jevScore = jevScorecard(res.answers as Record<string, unknown>);
      } catch (err) {
        await freeCell(db, q.cellId);
        rec.rejected.push({ cellId: q.cellId, problems: [`jev: ${err instanceof Error ? err.message : String(err)}`] });
        continue;
      }
      const score = triviaScore(q.writerScore, jevScore);
      const payload: TriviaPoolPayload & { story_key: null; source: string; url: string | null; breakdown: null } = {
        kind: 'trivia', q, jevScore, score, writtenOn: day, story_key: null, source: 'AI Trivia writer', url: q.sources[0] ?? null, breakdown: null,
      };
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
         VALUES ($1, $2, 'model', $3, $4, $5::jsonb, $6, $7::timestamptz)
         ON CONFLICT (series, key) DO UPDATE SET
           origin = EXCLUDED.origin, ref = EXCLUDED.ref, title = EXCLUDED.title,
           payload = EXCLUDED.payload, score = EXCLUDED.score, refreshed_at = EXCLUDED.refreshed_at
         WHERE stories.pool.used_at IS NULL
         RETURNING id`,
        [TRIVIA_SERIES, key, q.cellId, q.question, JSON.stringify(payload), score, now.toISOString()],
      );
      if (!rows.length) {
        await freeCell(db, q.cellId);
        rec.rejected.push({ cellId: q.cellId, problems: ['pool key already used'] });
        continue;
      }
      rec.pooled.push({ key, score });
    }

    // 4. The cap: the lowest go and their cells open again.
    rec.dropped = await capTriviaPool(db, now);
    return { ran: true, ...rec };
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // Recorded even on a failure, so a broken day is not retried (and paid for) on every worker pass.
    await saveRecord(db, rec).catch(() => undefined);
  }
}
