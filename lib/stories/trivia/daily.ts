/**
 * The "Are you smarter than AI?" daily writer (series ai_trivia; PLAN.md Stage 5, AT-3, AT-7, AT-8, AT-11, AT-54 to AT-62):
 *
 *   cells      12 random open cells from the content map
 *   writer     one trivia-write@3 call (Sonnet, settings.models.copy, ≤5 web searches); the material
 *              also lists every question already asked (asked.ts) for the repeat rule
 *   validator  code (validate.ts); a failing question is dropped and its cell stays open
 *   shorten    questions that broke only a length limit get one trivia-shorten@1 call (no search);
 *              the rewrite is validated and scored like any question, and dropped if it fails
 *   reserve    each valid question reserves its cell (at most 3 a day)
 *   Jev        trivia-score@3 per question (tests 1–4 of quality.ts)
 *              No score gates (AT-62): tests 1 and 2 are required writing rules, not scores that archive.
 *   pool       score = mean of the writer's and Jev's scores on test 3 (AT-61); one stories.pool row
 *              per question (key trivia:<cellId>), then the cap of 20
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

import { askedQuestions } from './asked';
import { ensureCells, freeCell, openCellIds, reserveCell, sampleOpenCells } from './cells';
import { TRIVIA_SHORTEN, TRIVIA_WRITE, TRIVIA_WRITE_SEARCHES, type TriviaShortenMaterial, type TriviaWriteItem, type TriviaWriteMaterial, type TriviaWriteOut } from './prompts';
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
  /** Cells whose question broke only a length limit and passed validation after one shortening try (AT-58). */
  shortened: string[];
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
  const rec: TriviaDailyRecord = { day, at: now.toISOString(), offered: [], pooled: [], rejected: [], shortened: [], dropped: [] };
  try {
    await ensureCells(db);
    const cells = await sampleOpenCells(db, CELLS_OFFERED, deps.rand);
    rec.offered = cells.map((c) => c.cellId);
    if (!cells.length) {
      rec.error = 'no open cells';
      return { ran: true, ...rec };
    }

    // 1. One writer call.
    const asked = await askedQuestions(db, { postedOnly: false });
    const mat: TriviaWriteMaterial = { today: day, cells: cells.map((c) => ({ cell_id: c.cellId, theme: c.themeText, angle: c.angleText })), asked };
    const out = (await writeStructured<TriviaWriteOut>({
      create: deps.write, db, setId: null, component: 'trivia-write', model: deps.settings.models.copy,
      system: TRIVIA_WRITE.system, tool: TRIVIA_WRITE.tool, user: material(mat), webSearch: { maxUses: TRIVIA_WRITE_SEARCHES },
    })).value;

    // 2. Validate in code; at most QUESTIONS_PER_DAY valid questions go on.
    const offered = new Set(rec.offered);
    const open = await openCellIds(db);
    const taken = new Set<string>();
    const valid: TriviaQuestion[] = [];
    const tooLong: TriviaShortenMaterial['questions'] = [];
    const accept = (item: TriviaWriteItem): { cellId: string; problems: string[]; lengthOnly: boolean } | null => {
      const v = validateQuestion(item, { offered, open, taken });
      if (!v.ok) return v;
      if (valid.length >= QUESTIONS_PER_DAY) return { cellId: v.q.cellId, problems: [`over the ${QUESTIONS_PER_DAY} a day`], lengthOnly: false };
      taken.add(v.q.cellId);
      valid.push(v.q);
      return null;
    };
    for (const item of Array.isArray(out?.questions) ? out.questions : []) {
      const bad = accept(item);
      if (bad?.lengthOnly) tooLong.push({ question: item, problems: bad.problems });
      else if (bad) rec.rejected.push({ cellId: bad.cellId, problems: bad.problems });
    }

    // 2b. AT-58: one shortening try for questions that broke only a length limit, while the day has room.
    const room = QUESTIONS_PER_DAY - valid.length;
    if (tooLong.length && room > 0) {
      const tries = tooLong.slice(0, room);
      for (const t of tooLong.slice(room)) rec.rejected.push({ cellId: t.question.cell_id, problems: t.problems });
      try {
        const short = (await writeStructured<TriviaWriteOut>({
          create: deps.write, db, setId: null, component: 'trivia-shorten', model: deps.settings.models.copy,
          system: TRIVIA_SHORTEN.system, tool: TRIVIA_SHORTEN.tool, user: material({ questions: tries } satisfies TriviaShortenMaterial),
        })).value;
        const wanted = new Set(tries.map((t) => t.question.cell_id));
        for (const item of Array.isArray(short?.questions) ? short.questions : []) {
          if (!wanted.delete(item?.cell_id)) continue;
          const bad = accept(item);
          if (bad) rec.rejected.push({ cellId: bad.cellId, problems: ['after shortening', ...bad.problems] });
          else rec.shortened.push(item.cell_id);
        }
        for (const cellId of wanted) rec.rejected.push({ cellId, problems: ['not returned by the shortening try'] });
      } catch (err) {
        for (const t of tries) rec.rejected.push({ cellId: t.question.cell_id, problems: [...t.problems, `shortening failed: ${err instanceof Error ? err.message : String(err)}`] });
      }
    } else {
      for (const t of tooLong) rec.rejected.push({ cellId: t.question.cell_id, problems: t.problems });
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
