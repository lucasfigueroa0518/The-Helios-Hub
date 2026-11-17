/**
 * The "Are you smarter than AI?" daily writer (series ai_trivia; PLAN.md Stage 5, AT-3, AT-7, AT-8, AT-11, AT-54 to AT-62):
 *
 *   calls      WRITER_CALLS (2) writer calls a day (AT-78), each run through the steps below
 *   cells      CELLS_PER_CALL (10) open cells, weighted toward cells with fewer questions (cells.ts);
 *              the second call never gets a cell the first was offered
 *   research   SS-33: in intake mode (consumer switch 'trivia'; stale or error → legacy), the pages the
 *              intake holds for order 'trivia' (research.ts); legacy: none. Read once for the day.
 *   writer     one trivia-write@5 call (Sonnet, settings.models.copy, ≤5 web searches) asked for
 *              QUESTIONS_PER_CALL (4); each offered cell carries the questions already written in it
 *              (asked.ts) for the repeat rule; the research when there is any
 *   deposit    SS-30: every page the writer cited (URL, title, quoted line) goes into the central
 *              intake (research.ts); a failure is recorded and never stops the day
 *   validator  code (validate.ts); a failing question is dropped
 *   shorten    questions that broke only a length limit get one trivia-shorten@1 call (no search);
 *              the rewrite is validated and scored like any question, and dropped if it fails
 *   number     each valid question takes its cell's next number (at most QUESTIONS_PER_CALL a call)
 *   Jev        trivia-score@3 per question (tests 1–4 of quality.ts)
 *              No score gates (AT-62): tests 1 and 2 are required writing rules, not scores that archive.
 *   pool       score = mean of the writer's and Jev's scores on test 3 (AT-61); one stories.pool row
 *              per question (key trivia:<cellId>:<n>)
 *   spent      the cells the writer reported spent get one more report; the second retires the cell
 *   cap        after both calls, the pool cap (TRIVIA_POOL_CAP, 40)
 *
 * Runs once per pool day (the record in stories.settings 'trivia_daily'); a
 * second call the same day does nothing unless forced. Nothing in the
 * database is swept: the only rows read are the cell table, the pool and one
 * bounded window of the intake order's own stories.
 */
import type { StoriesDb } from '@/lib/stories/db';
import type { IntakeQuery } from '@/lib/intake/types';
import type { StoriesJev } from '@/lib/stories/jev';
import { capTriviaPool, poolDay } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import type { StoriesSettings } from '@/lib/stories/settings';
import { writeStructured, type WriterCreate } from '@/lib/stories/writer';

import { askedInCells } from './asked';
import { claimQuestionNumber, ensureCells, openCellIds, reportSpent, sampleOpenCells } from './cells';
import type { Cell } from './map';
import { TRIVIA_SHORTEN, TRIVIA_WRITE, TRIVIA_WRITE_SEARCHES, type TriviaShortenMaterial, type TriviaWriteItem, type TriviaWriteMaterial, type TriviaWriteOut } from './prompts';
import { TRIVIA_SCORE } from './questions';
import { poolKeyOf, SCORECARD_KEYS, TRIVIA_SERIES, triviaScore, type Scorecard, type TriviaPoolPayload, type TriviaQuestion } from './types';
import { validateQuestion } from './validate';
import { citedSources, depositCitedSources, readTriviaResearch, type TriviaIntakeDeps, type TriviaResearchMode } from './research';

/** AT-78: two writer calls a day, each offered 10 cells and asked for 4 questions (about 8 a day for the story and the game). */
export const WRITER_CALLS = 2;
export const CELLS_PER_CALL = 10;
export const QUESTIONS_PER_CALL = 4;
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
  /** The central intake (SS-30, SS-33): the db defaults to `db`, the reads and the deposit to the live ones. Tests stub them. */
  intake?: TriviaIntakeDeps;
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
  /** AT-78: the cells the writer reported spent, and those retired by it. */
  spent: string[];
  retired: string[];
  /** SS-30/SS-33: the path the writer took, how many research items it got, and the deposit of its cited pages. */
  intake?: { mode: TriviaResearchMode; research: number; deposited: number; created: number; failed: number; depositError?: string };
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
  const rec: TriviaDailyRecord = { day, at: now.toISOString(), offered: [], pooled: [], rejected: [], shortened: [], dropped: [], spent: [], retired: [] };
  try {
    await ensureCells(db);
    const iq: IntakeQuery = deps.intake?.query ?? db;
    const { mode, research } = await readTriviaResearch(iq, now, deps.intake);
    rec.intake = { mode, research: research.length, deposited: 0, created: 0, failed: 0 };
    // Cells used by a valid question today, across both calls.
    const taken = new Set<string>();
    for (let call = 0; call < WRITER_CALLS; call++) {
      const cells = await sampleOpenCells(db, CELLS_PER_CALL, deps.rand, new Set(rec.offered));
      if (!cells.length) {
        if (!rec.offered.length) rec.error = 'no open cells';
        break;
      }
      rec.offered.push(...cells.map((c) => c.cellId));
      await writerCall(deps, rec, { cells, research, iq, taken });
    }

    // The cap: the lowest go to the archive.
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

type CallInput = { cells: Cell[]; research: NonNullable<TriviaWriteMaterial['research']>; iq: IntakeQuery; taken: Set<string> };

/** One writer call (AT-78): write, deposit, validate, shorten, number, score and pool its questions, then the spent report. */
async function writerCall(deps: TriviaDailyDeps, rec: TriviaDailyRecord, c: CallInput): Promise<void> {
  const { db, now } = deps;
  const day = rec.day;

  // 1. The writer; in intake mode its material carries the research the intake holds (SS-33).
  const asked = await askedInCells(db, c.cells.map((x) => x.cellId));
  const mat: TriviaWriteMaterial = {
    today: day,
    count: QUESTIONS_PER_CALL,
    cells: c.cells.map((x) => ({ cell_id: x.cellId, theme: x.themeText, angle: x.angleText, asked: asked.get(x.cellId) ?? [] })),
  };
  if (c.research.length) mat.research = c.research;
  // The raw responses are kept for the deposit: the quoted lines live in their search results and citations.
  const responses: unknown[] = [];
  const out = (await writeStructured<TriviaWriteOut>({
    create: async (params) => {
      const res = await deps.write(params);
      responses.push(res);
      return res;
    },
    db, setId: null, component: 'trivia-write', model: deps.settings.models.copy,
    system: TRIVIA_WRITE.system, tool: TRIVIA_WRITE.tool, user: material(mat), webSearch: { maxUses: TRIVIA_WRITE_SEARCHES },
  })).value;

  // 1b. SS-30: the pages it cited go into the central intake (never breaks the day).
  const dep = await depositCitedSources(c.iq, citedSources(Array.isArray(out?.questions) ? out.questions : [], responses), now, deps.intake?.deposit);
  const prev = rec.intake!;
  rec.intake = { ...prev, deposited: prev.deposited + dep.deposited, created: prev.created + dep.created, failed: prev.failed + dep.failed, ...(dep.error ? { depositError: dep.error } : {}) };

  // 2. Validate in code; at most QUESTIONS_PER_CALL valid questions go on.
  const offered = new Set(c.cells.map((x) => x.cellId));
  const open = await openCellIds(db);
  const valid: TriviaQuestion[] = [];
  const tooLong: TriviaShortenMaterial['questions'] = [];
  const accept = (item: TriviaWriteItem): { cellId: string; problems: string[]; lengthOnly: boolean } | null => {
    const v = validateQuestion(item, { offered, open, taken: c.taken });
    if (!v.ok) return v;
    if (valid.length >= QUESTIONS_PER_CALL) return { cellId: v.q.cellId, problems: [`over the ${QUESTIONS_PER_CALL} a call`], lengthOnly: false };
    c.taken.add(v.q.cellId);
    valid.push(v.q);
    return null;
  };
  for (const item of Array.isArray(out?.questions) ? out.questions : []) {
    const bad = accept(item);
    if (bad?.lengthOnly) tooLong.push({ question: item, problems: bad.problems });
    else if (bad) rec.rejected.push({ cellId: bad.cellId, problems: bad.problems });
  }

  // 2b. AT-58: one shortening try for questions that broke only a length limit, while the call has room.
  const room = QUESTIONS_PER_CALL - valid.length;
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

  // 3. Number, score with Jev, pool.
  for (const v of valid) {
    const n = await claimQuestionNumber(db, v.cellId);
    if (n === null) {
      rec.rejected.push({ cellId: v.cellId, problems: ['cell no longer open'] });
      continue;
    }
    const q: TriviaQuestion = { ...v, n };
    const key = poolKeyOf(q);
    let jevScore: Scorecard;
    try {
      const res = await deps.jev.ask({
        component: 'trivia-score', set: TRIVIA_SCORE, setId: null,
        state: { question: q.question, options: q.options.map((o) => `${o.letter}. ${o.text}`), correct: q.correct, answer_line: q.answerLine },
      });
      jevScore = jevScorecard(res.answers as Record<string, unknown>);
    } catch (err) {
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
       ON CONFLICT (series, key) DO NOTHING
       RETURNING id`,
      [TRIVIA_SERIES, key, q.cellId, q.question, JSON.stringify(payload), score, now.toISOString()],
    );
    if (!rows.length) {
      rec.rejected.push({ cellId: q.cellId, problems: ['pool key already used'] });
      continue;
    }
    rec.pooled.push({ key, score });
  }

  // 4. AT-78: the cells the writer reported spent (offered ones only); the second report retires a cell.
  const spent = [...new Set(Array.isArray(out?.spent_cells) ? out.spent_cells.filter((x): x is string => typeof x === 'string' && offered.has(x)) : [])];
  rec.spent.push(...spent);
  rec.retired.push(...(await reportSpent(db, spent)));
}
