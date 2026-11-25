/**
 * "Are you smarter than AI?" ideas (series ai_trivia; CONTRACT.md §5 row A,
 * CONTRACT-2 §5 row B), offline: the content map, the validator, the daily
 * writer, the pool cap and the builder's fact-check
 * loop. PGlite via the stories harness; Sonnet and Jev are stubs. No live
 * call of any kind.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildAiTrivia, MAX_CHECKS, toFactCheck } from '@/lib/stories/build/ai-trivia';
import { createStoriesJev } from '@/lib/stories/jev';
import { capTriviaPool, openPool, TRIVIA_POOL_CAP, TRIVIA_SERVED_CAP, unusedTriviaCount, writePool } from '@/lib/stories/pool';
import { STORIES_PROMPTS } from '@/lib/stories/prompts';
import { STORIES_QUESTION_SETS } from '@/lib/stories/questions';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { schemaSql } from '@/lib/stories/local-db';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import { checkRepeat, loadEarlier, sameFact } from '@/lib/stories/trivia/repeats';
import { cellState, claimQuestionNumber, ensureCells, reportSpent, sampleOpenCells } from '@/lib/stories/trivia/cells';
import { AI_RIGHT_TARGET, chooseGameDay, fairShot, GAME_SIZE, MAX_GAME_CHECKS, orderEasiestFirst, wantsMore } from '@/lib/stories/trivia/game';
import { TRIVIA_AUDIENCE } from '@/lib/stories/trivia/audience';
import { DAILY_TARGET, MAX_WRITER_CALLS, runTriviaDaily } from '@/lib/stories/trivia/daily';
import { QUALITY_TESTS, REPEAT_RULE, QUALITY_TEXT, RANK_KEYS } from '@/lib/stories/trivia/quality';
import { allCells, ANGLES, cellOf, isActive, RETIRED_ANGLES, RETIRED_THEMES, THEMES } from '@/lib/stories/trivia/map';
import { TRIVIA_CHECK, TRIVIA_SHORTEN, TRIVIA_WRITE, type TriviaWriteItem } from '@/lib/stories/trivia/prompts';
import { TRIVIA_SCORE } from '@/lib/stories/trivia/questions';
import { SCORECARD_KEYS, triviaPoolKey, triviaScore, type Scorecard, type TriviaPoolPayload, type TriviaQuestion } from '@/lib/stories/trivia/types';
import { validateQuestion } from '@/lib/stories/trivia/validate';
import { citedSources } from '@/lib/stories/trivia/research';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

const NOW = new Date('2026-11-10T08:30:00Z'); // 3:30 AM New York
/** The tests written for two writer calls a day keep them. */
const TWO_CALLS = { target: DAILY_TARGET, maxCalls: 2 };
const DATE = '2026-11-10';

const materialOf = (params: Record<string, unknown>) => {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
  return JSON.parse(m![1]!) as Record<string, unknown>;
};

const item = (cellId: string, o: Partial<TriviaWriteItem> = {}): TriviaWriteItem => ({
  cell_id: cellId,
  question: `Question for ${cellId}?`,
  options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }, { letter: 'C', text: 'Three' }],
  correct: 'B',
  answer_line: 'Why it matters to you.',
  sources: ['https://source.test/a'],
  score: { clear: 0.8, real_guess: 0.7, point: 0.6, worth_knowing: 0.5 },
  ...o,
});

const question = (cellId: string): TriviaQuestion => {
  const v = validateQuestion(item(cellId), { offered: new Set([cellId]), open: new Set([cellId]) });
  assert.ok(v.ok);
  return v.q;
};

/** A pool row as the daily writer left it before AT-78 (key `trivia:<cellId>`, no number): old rows keep working. */
async function poolRow(db: Db, cellId: string, score: number): Promise<TriviaPoolPayload> {
  const key = triviaPoolKey(cellId);
  const p: TriviaPoolPayload = { kind: 'trivia', q: question(cellId), jevScore: { clear: score, real_guess: score, point: score, worth_knowing: score }, score, writtenOn: DATE };
  await db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at) VALUES ('ai_trivia', $1, 'model', $2, $3, $4::jsonb, $5, $6)`, [key, cellId, p.q.question, JSON.stringify(p), score, '2026-10-01T00:00:00Z']);
  return p;
}

async function trivDeps(db: Db, write: ReturnType<typeof stubWriter>): Promise<BuildDeps> {
  const { set } = await requestSet(db, { series: 'ai_trivia', nyDate: DATE, trigger: 'click', style: 'polished' });
  await claimNextRequested(db);
  return { db, sourceDb: db, jev: createStoriesJev(stubJev(), db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE };
}

/* ── Content map ──────────────────────────────────────────────────── */

test('content map: 20 themes × 20 angles, 400 unique cell ids that round-trip', () => {
  assert.equal(THEMES.length, 20);
  assert.equal(ANGLES.length, 20);
  const cells = allCells();
  assert.equal(new Set(cells.map((c) => c.cellId)).size, 400);
  assert.deepEqual(cellOf('t07a13'), { cellId: 't07a13', theme: 7, angle: 13, themeText: THEMES[6], angleText: ANGLES[12] });
  assert.equal(cellOf('t21a01'), null);
  assert.equal(cellOf('x07a13'), null);
});

test('content map: AT-53 everyday themes fill slots 6, 11, 15, 16, 17 in place; cell ids unchanged', () => {
  assert.equal(THEMES[5], "AI at work: the jobs and tasks it's changing");
  assert.equal(THEMES[10], 'Scams, fakes and deepfakes');
  assert.equal(THEMES[14], 'AI at home: speakers, cameras and smart gadgets');
  assert.equal(THEMES[15], 'AI in school and homework');
  assert.equal(THEMES[16], 'AI in dating, friendships and social life');
  assert.equal(new Set(THEMES).size, 20);
  const cells = allCells();
  assert.equal(cells[0]!.cellId, 't01a01');
  assert.equal(cells[399]!.cellId, 't20a20');
  assert.deepEqual(cellOf('t11a07'), { cellId: 't11a07', theme: 11, angle: 7, themeText: 'Scams, fakes and deepfakes', angleText: ANGLES[6] });
  for (const [i, c] of cells.entries()) assert.equal(c.cellId, `t${String(Math.floor(i / 20) + 1).padStart(2, '0')}a${String((i % 20) + 1).padStart(2, '0')}`);
});

test('content map: AT-63/AT-65 retire 2 themes and 8 angles in place; only the 216 active cells are ever offered', async () => {
  assert.deepEqual([...RETIRED_THEMES].map((t) => THEMES[t - 1]), ['How AI learns: data and training', 'Discoveries AI made in science']);
  assert.deepEqual([...RETIRED_ANGLES].map((a) => ANGLES[a - 1]), [
    'The first time it happened', 'How it actually works', 'What it cost', 'Something you use without knowing', 'A close call or near miss',
    'The year it happened', 'What went wrong', 'The rule nobody knows about',
  ]);
  assert.equal(allCells().length, 400, 'the grid and its ids are unchanged');
  assert.equal(allCells().filter(isActive).length, 216);
  const { db } = await harnessDb();
  await ensureCells(db);
  const offered = await sampleOpenCells(db, 400);
  assert.equal(offered.length, 216);
  assert.ok(offered.every(isActive));
});

/* ── Validator ────────────────────────────────────────────────────── */

test('validator: exactly 3 options; no !, no emoji, limits, known open cell; length-only flag', () => {
  const ctx = { offered: new Set(['t01a01', 't02a02']), open: new Set(['t01a01']) };
  assert.equal(validateQuestion(item('t01a01'), ctx).ok, true);
  const problems = (o: Partial<TriviaWriteItem>, cell = 't01a01') => {
    const v = validateQuestion(item(cell, o), ctx);
    return v.ok ? [] : v.problems;
  };
  assert.match(problems({ question: 'Guess what!' }).join(), /exclamation/);
  assert.match(problems({ answer_line: 'Big news 🤖' }).join(), /emoji/);
  assert.match(problems({ options: [{ letter: 'A', text: 'Yes 🎯' }, { letter: 'B', text: 'No' }, { letter: 'C', text: 'Maybe' }] }).join(), /emoji/);
  assert.match(problems({ options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }] }).join(), /options: 2 \(needs 3\)/);
  assert.match(problems({ correct: 'D' as TriviaWriteItem['correct'] }).join(), /correct: D/);
  assert.match(problems({ question: 'x'.repeat(111) }).join(), /max 110/);
  assert.match(problems({ options: [{ letter: 'A', text: 'x'.repeat(33) }, { letter: 'B', text: 'Two' }, { letter: 'C', text: 'Three' }] }).join(), /max 32/);
  assert.match(problems({ answer_line: 'x'.repeat(121) }).join(), /max 120/);
  assert.match(problems({ question: 'AI TRIVIA: what year?' }).join(), /fixed copy/);
  assert.match(problems({ answer_line: 'Are you smarter than AI? Now you are.' }).join(), /fixed copy/);
  assert.match(problems({}, 't02a02').join(), /not open/);
  assert.match(problems({}, 't09a09').join(), /not one of the cells offered/);
  assert.match(problems({ score: { clear: 1.4, real_guess: 0.5, point: 0.5, worth_knowing: 0.5 } }).join(), /score.clear/);
  assert.match(problems({ score: { clear: 0.5, real_guess: 0.5, point: 0.5 } as TriviaWriteItem['score'] }).join(), /score.worth_knowing/);
  const long = validateQuestion(item('t01a01', { answer_line: 'x'.repeat(121), question: 'q'.repeat(111) + '?' }), ctx);
  assert.ok(!long.ok && long.lengthOnly, 'only limits broken: one shortening try is allowed');
  const mixed = validateQuestion(item('t01a01', { answer_line: 'x'.repeat(121) + '!' }), ctx);
  assert.ok(!mixed.ok && !mixed.lengthOnly, 'any other problem: no shortening try');
  const v = validateQuestion(item('t01a01'), ctx);
  assert.ok(v.ok && !Object.keys(v.q).some((k) => /photo/i.test(k)), 'no photo fields on a question');
});

/* ── Prompts and registry ─────────────────────────────────────────── */

test('prompts: registered at @3, GTN gone, one quality definition shared by writer, shortener and Jev, no photos, no tap line', () => {
  const ids = STORIES_PROMPTS.map((p) => p.id);
  assert.ok(ids.includes('trivia-write@6') && ids.includes('trivia-check@5') && ids.includes('trivia-shorten@1'));
  assert.ok(!ids.includes('trivia-write@5') && !ids.includes('trivia-check@4'));
  assert.ok(!ids.some((id) => id.startsWith('gtn-')));
  const sets = STORIES_QUESTION_SETS.map((s) => s.version);
  assert.ok(sets.includes('trivia-score@3') && !sets.includes('trivia-score@2'));
  assert.ok(!sets.some((v) => v.startsWith('gtn-')));
  assert.deepEqual([...SCORECARD_KEYS], ['clear', 'real_guess', 'point', 'worth_knowing']);
  assert.deepEqual([...RANK_KEYS], ['point'], 'test 3 ranks');
  assert.deepEqual(Object.keys(TRIVIA_SCORE.questions), [...SCORECARD_KEYS]);
  assert.equal(TRIVIA_WRITE.system.split(QUALITY_TEXT).length, 2, 'the definition appears once in the writer');
  assert.equal(TRIVIA_SHORTEN.system.split(QUALITY_TEXT).length, 2, 'and once in the shortener');
  assert.ok(TRIVIA_WRITE.system.includes(REPEAT_RULE) && TRIVIA_CHECK.system.includes(REPEAT_RULE), 'one repeat definition, read by the writer and the check');
  assert.equal(TRIVIA_WRITE.system.split(REPEAT_RULE).length, 2);
  assert.match(TRIVIA_WRITE.system, /under asked, every question the series has already written on each offered theme/);
  assert.match(TRIVIA_CHECK.system, /the series' questions on the same theme, any from other themes that look close, and any already chosen to post alongside this one/);
  assert.match(REPEAT_RULE, /a reworded, shorter or narrower version of an earlier question/);
  assert.match(TRIVIA_WRITE.system, /the material asks for \(count\)/);
  assert.ok(!/three/i.test(TRIVIA_WRITE.system.split('<humanizer>')[0]!), 'the count comes from the material');
  const writeSchema = TRIVIA_WRITE.tool.input_schema as { required: string[] };
  assert.deepEqual(writeSchema.required, ['questions', 'spent_cells'], 'spent_cells is required');
  assert.deepEqual((TRIVIA_SHORTEN.tool.input_schema as { required: string[] }).required, ['questions'], 'the shortener reports no spent cells');
  for (const k of SCORECARD_KEYS) {
    assert.ok(TRIVIA_WRITE.system.includes(QUALITY_TESTS[k].check), `writer scores ${k}`);
    assert.ok(String(TRIVIA_SCORE.questions[k].instructions).includes(QUALITY_TESTS[k].check), `Jev carries ${k}`);
    assert.ok(String(TRIVIA_SCORE.questions[k].instructions).includes(TRIVIA_AUDIENCE), `Jev's ${k} knows the viewer`);
  }
  assert.equal(TRIVIA_WRITE.system.split(TRIVIA_AUDIENCE).length, 2, 'the audience appears once in the writer prompt');
  assert.ok(!/difficulty|hard:|easy:/i.test(TRIVIA_WRITE.system.split('<humanizer>')[0]!), 'no difficulty section');
  assert.match(TRIVIA_WRITE.system, /options: exactly 3/);
  const own = TRIVIA_WRITE.system.split('<humanizer>')[0]!;
  assert.ok(!own.includes('!'), 'no exclamation mark in the writer prompt');
  assert.ok(!/AI TRIVIA|Tap to reveal/i.test(own), 'the writer never sees the tap line or the old name');
  assert.ok(!/photo/i.test(own) && !/photo/i.test(JSON.stringify(TRIVIA_WRITE.tool)), 'no photo anywhere in the writer prompt or schema');
  assert.ok(!/photo/i.test(TRIVIA_CHECK.system));
  assert.ok(!TRIVIA_CHECK.system.includes('!'));
});

/* ── Daily writer ─────────────────────────────────────────────────── */

test('runTriviaDaily (AT-78): writer calls of 10 cells, 4 questions each; each offered theme lists its questions; numbered keys; spent cells', async () => {
  const { db } = await harnessDb();
  await ensureCells(db);
  await db.query(`UPDATE stories.trivia_cells SET state = 'retired' WHERE cell_id = 't01a01'`); // a retired cell is never offered
  await poolRow(db, 't01a03', 0.6); // an earlier question in t01a03: the writer sees it under that cell's asked
  const mats: Array<Record<string, unknown>> = [];
  const write = stubWriter({
    submit_trivia: (params) => {
      const m = materialOf(params);
      mats.push(m);
      const ids = (m.cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      if (mats.length === 1) {
        const [a, b, c, d, e, f] = ids;
        return {
          questions: [
            item(a!, { question: `A new fact for ${a}?` }),
            item(b!, { question: 'Can you believe this!' }),
            item(c!, { answer_line: 'Wild 🤯' }),
            item(d!, { options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }] }),
            item(e!, { correct: 'A' }),
            item(f!, { correct: 'C' }),
          ],
          spent_cells: [],
        };
      }
      // Second call: five valid questions (the fifth is over the 4 a call); one offered cell spent, one not offered ignored.
      return { questions: ids.slice(0, 5).map((c) => item(c)), spent_cells: [ids[9]!, 't01a01'] };
    },
  });
  const jevStub = stubJev((k) => ({ clear: 0.9, real_guess: 0.7, point: 0.3, worth_knowing: 0.6 })[k] ?? 0);
  const r = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42, fill: TWO_CALLS });
  assert.equal(r.ran, true);
  if (!r.ran) return;

  // Two calls: Sonnet from settings, ≤5 searches, 10 cells and a count of 4 in the user turn only.
  assert.equal(write.calls.length, 2);
  for (const call of write.calls) {
    assert.equal(call.model, DEFAULT_SETTINGS.models.copy);
    assert.deepEqual((call.tools as Array<{ name: string; max_uses?: number }>).find((t) => t.name === 'web_search')?.max_uses, 5);
  }
  const offered1 = (mats[0]!.cells as Array<{ cell_id: string; theme: string }>);
  const offered2 = (mats[1]!.cells as Array<{ cell_id: string; theme: string }>);
  assert.equal(offered1.length, 10);
  assert.equal(offered2.length, 10);
  assert.deepEqual([mats[0]!.count, mats[1]!.count], [4, 4]);
  assert.ok(!('asked' in offered1[0]!), 'the lists are per theme, not per cell');
  const asked1 = mats[0]!.asked as Array<{ theme: string; questions: unknown[] }>;
  assert.deepEqual(asked1.map((a) => a.theme).sort(), [...new Set(offered1.map((c) => c.theme))].sort(), 'one list per offered theme');
  const all = [...offered1, ...offered2].map((c) => c.cell_id);
  assert.equal(new Set(all).size, 20, 'the second call never gets a cell the first was offered');
  assert.deepEqual(r.offered, all);
  assert.ok(!all.includes('t01a01'));
  assert.ok(all.every((c) => isActive(cellOf(c)!)));
  assert.ok(offered1.some((c) => c.cell_id === 't01a03'));
  const theme1 = cellOf('t01a03')!.themeText;
  assert.deepEqual(asked1.find((a) => a.theme === theme1)?.questions, [{ question: 'Question for t01a03?', answer: 'Two' }], 'the theme lists the question in t01a03');
  assert.ok(asked1.filter((a) => a.theme !== theme1).every((a) => a.questions.length === 0));
  // The second call's lists carry the first call's new questions on its themes.
  const firstNew = [[offered1[0]!, `A new fact for ${offered1[0]!.cell_id}?`], [offered1[4]!, `Question for ${offered1[4]!.cell_id}?`]] as const;
  for (const a of mats[1]!.asked as Array<{ theme: string; questions: Array<{ question: string }> }>) {
    for (const [c, text] of firstNew) if (c.theme === a.theme) assert.ok(a.questions.some((q) => q.question === text));
  }
  assert.ok(!JSON.stringify(write.calls[0]!.system).includes(all[0]!), 'per-day cells stay out of the cached system prompt');

  const ids1 = offered1.map((c) => c.cell_id);
  const ids2 = offered2.map((c) => c.cell_id);
  assert.equal(r.pooled.length, 3 + 4, JSON.stringify(r.rejected));
  assert.deepEqual(r.rejected.map((x) => x.cellId), [ids1[1], ids1[2], ids1[3], ids2[4]]);
  assert.match(r.rejected[0]!.problems.join(), /exclamation/);
  assert.match(r.rejected[1]!.problems.join(), /emoji/);
  assert.match(r.rejected[2]!.problems.join(), /needs 3/);
  assert.match(r.rejected[3]!.problems.join(), /over the 4 a call/);

  const { rows } = await db.query<{ key: string; origin: string; score: string; payload: TriviaPoolPayload }>(`SELECT key, origin, score, payload FROM stories.pool WHERE series = 'ai_trivia' AND key <> 'trivia:t01a03' ORDER BY key`);
  assert.deepEqual(rows.map((x) => x.key).sort(), [ids1[0], ids1[4], ids1[5], ...ids2.slice(0, 4)].map((c) => `trivia:${c}:1`).sort());
  const expected = triviaScore({ clear: 0.8, real_guess: 0.7, point: 0.6, worth_knowing: 0.5 }, { clear: 0.9, real_guess: 0.7, point: 0.3, worth_knowing: 0.6 });
  assert.equal(expected, Number(((0.6 + 0.3) / 2).toFixed(4)), 'the mean of the writer and Jev on test 3');
  for (const row of rows) {
    assert.equal(row.origin, 'model');
    assert.equal(Number(row.score), expected);
    assert.equal(row.payload.kind, 'trivia');
    assert.equal(`trivia:${row.payload.q.cellId}:${row.payload.q.n}`, row.key, 'the number rides on the question');
    assert.deepEqual(row.payload.jevScore, { clear: 0.9, real_guess: 0.7, point: 0.3, worth_knowing: 0.6 });
    assert.equal(await cellState(db, row.payload.q.cellId), 'open', 'a cell stays open after a question');
  }
  assert.equal(jevStub.calls.length, 7);
  assert.deepEqual(jevStub.calls[0]!.keys, ['clear', 'real_guess', 'point', 'worth_knowing']);

  // Spent: only offered cells count; one report leaves the cell open.
  assert.deepEqual(r.spent, [ids2[9]]);
  assert.deepEqual(r.retired, []);
  const { rows: spent } = await db.query<{ spent: number; state: string }>(`SELECT spent, state FROM stories.trivia_cells WHERE cell_id = $1`, [ids2[9]]);
  assert.deepEqual(spent[0], { spent: 1, state: 'open' });

  const { rows: costs } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events ORDER BY component`);
  assert.deepEqual(costs.map((c) => c.component), ['trivia-score', 'trivia-write']);

  // Once per pool day.
  const again = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(again.ran, false);
  assert.equal(write.calls.length, 2);
});

test('cells (AT-78): weighted toward fewer questions, exclude honoured, numbers count up, two spent reports retire', async () => {
  const { db } = await harnessDb();
  await ensureCells(db);
  const active = allCells().filter(isActive).map((c) => c.cellId);
  // Every active cell but two has given 50 questions: those two win almost every draw.
  await db.query(`UPDATE stories.trivia_cells SET questions = 50 WHERE cell_id <> ALL($1::text[])`, [[active[0], active[1]]]);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    const got = (await sampleOpenCells(db, 2, rand)).map((c) => c.cellId);
    hits += got.filter((c) => c === active[0] || c === active[1]).length;
  }
  // Uniform draws would land on them about 0.4 times in 20; weighted, far more.
  assert.ok(hits >= 8, `fresh cells drawn ${hits} of 40`);
  const ex = await sampleOpenCells(db, 216, rand, new Set([active[0]!]));
  assert.equal(ex.length, 215);
  assert.ok(!ex.some((c) => c.cellId === active[0]));

  assert.equal(await claimQuestionNumber(db, active[0]!), 1);
  assert.equal(await claimQuestionNumber(db, active[0]!), 2);
  assert.deepEqual(await reportSpent(db, [active[0]!]), []);
  assert.deepEqual(await reportSpent(db, [active[0]!]), [active[0]]);
  assert.equal(await cellState(db, active[0]!), 'retired');
  assert.equal(await claimQuestionNumber(db, active[0]!), null, 'a retired cell gives no number');
  assert.ok(!(await sampleOpenCells(db, 216, rand)).some((c) => c.cellId === active[0]), 'and is never offered');
});

test('repeats: one list from the pool, the archive and every game day; the first of two on one fact is kept; close questions from other themes are shown', async () => {
  const { db } = await harnessDb();
  await ensureCells(db);
  const at = (cellId: string, text: string, answer: string, writtenOn: string): TriviaPoolPayload => ({
    kind: 'trivia', score: 0.5, writtenOn, jevScore: { clear: 0.5, real_guess: 0.5, point: 0.5, worth_knowing: 0.5 },
    q: { ...question(cellId), question: text, options: [{ letter: 'A', text: 'Other' }, { letter: 'B', text: answer }, { letter: 'C', text: 'Else' }] },
  });
  const put = (p: TriviaPoolPayload, used = false) => db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, used_at) VALUES ('ai_trivia', $1, 'model', $2, $3, $4::jsonb, 0.5, $5)`, [`trivia:${p.q.cellId}`, p.q.cellId, p.q.question, JSON.stringify(p), used ? '2026-11-01T00:00:00Z' : null]);
  // Served by the game and handed back to the pool (open again): still counts, on any theme.
  const eliza = at('t04a01', 'The first chatbot, ELIZA, was built at MIT. In which decade?', '1960s', '2026-11-10');
  await put(eliza);
  await db.query(`INSERT INTO stories.trivia_game_days (day_number, ny_date, status, questions) VALUES (1, '2026-11-11', 'locked', $1::jsonb)`, [JSON.stringify([{ key: 'trivia:t04a01', payload: eliza, factCheck: { verdict: 'pass', problems: [], sources: [] } }])]);
  // Archived (a failed check), on theme 3, written before the open one below.
  const netflixOld = at('t03a18', 'On Netflix, about how much of the viewing time comes from its recommendations rather than search?', 'About 80 percent', '2026-11-12');
  await db.query(`INSERT INTO stories.trivia_archive (key, cell_id, payload, reason) VALUES ('trivia:t03a18', 't03a18', $1::jsonb, 'fact-check: dated')`, [JSON.stringify(netflixOld)]);
  const netflixNew = at('t03a15', 'On Netflix, about how much of what people watch comes from its AI recommendations rather than search?', 'Over three quarters', '2026-11-20');
  await put(netflixNew);

  const all = await loadEarlier(db);
  assert.deepEqual(all.map((e) => [e.key, e.spent]), [['trivia:t04a01', true], ['trivia:t03a18', false], ['trivia:t03a15', false]]);

  // A reworded ELIZA question on another theme (19) is caught in code.
  const again = at('t19a14', 'The first chatbot that held typed conversations with people was built in which decade?', 'The 1960s', '2026-11-21');
  assert.equal(checkRepeat(all, again).repeat?.key, 'trivia:t04a01');
  // The newer Netflix question is shown the older one (same theme) for the model; the older is never shown the newer.
  const newer = checkRepeat(all, netflixNew);
  assert.ok(newer.asked.some((a) => a.answer === 'About 80 percent'));
  assert.ok(!newer.asked.some((a) => a.question === netflixNew.q.question), 'never itself');
  assert.ok(!checkRepeat(all, netflixOld).asked.some((a) => a.answer === 'Over three quarters'), 'an unposted later question does not count against an earlier one');
  // A spent question counts whenever it was written; `alongside` counts too.
  const early = at('t04a09', 'In which decade was the term "artificial intelligence" coined?', '1950s', '2026-11-01');
  assert.ok(checkRepeat(all, early).asked.some((a) => a.answer === '1960s'), 'served questions on the theme are shown to an older question');
  assert.ok(checkRepeat(all, early, [again]).asked.some((a) => a.answer === 'The 1960s'));
  // Of two played copies of one fact, the older stays usable (an IG story may still post it); the newer does not.
  const playedLater = at('t04a05', 'In which decade was the first chatbot built, at MIT?', '1960s', '2026-11-15');
  await put(playedLater, true);
  const now2 = await loadEarlier(db);
  assert.equal(checkRepeat(now2, playedLater).repeat?.key, 'trivia:t04a01');
  assert.equal(checkRepeat(now2, eliza).repeat, null);
});

test('sameFact: a reworded or shorter version of a question is a repeat; another fact on the same subject is not', () => {
  const q = (question: string, answer: string) => ({ question, answer });
  assert.ok(sameFact(q('The first chatbot, ELIZA, was built at MIT. In which decade?', '1960s'), q('In which decade was the first chatbot built, at MIT?', '1960s')));
  assert.ok(sameFact(q('In which decade was the first chatbot built, at MIT?', '1960s'), q('The first chatbot that held typed conversations with people was built in which decade?', 'The 1960s')));
  assert.ok(sameFact(q('Which company built the chess computer Deep Blue that beat Kasparov in 1997?', 'IBM'), q('Who built Deep Blue?', 'IBM')), 'a shorter version');
  assert.ok(!sameFact(q('After its November 2022 launch, how long did ChatGPT take to reach 1 million users?', '5 days'), q('After launch, how long did ChatGPT take to reach an estimated 100 million users?', 'About two months')));
  assert.ok(!sameFact(q('In a 2024 Pew survey, about what share of US teens said they used ChatGPT for schoolwork?', 'About 26%'), q('Which medical field has the most FDA-cleared AI tools?', 'Radiology')));
});

test('game day (RT-3): 5 questions with the AI right on 4 when it can be, best by score; easiest first', () => {
  const p = (id: string, score: number, aiPick: 'A' | 'B' | null, fair = 0.5): TriviaPoolPayload => {
    const q = { ...question(id), writerScore: { clear: fair, real_guess: fair, point: 0.5, worth_knowing: 0.5 } };
    return { kind: 'trivia', q, jevScore: { clear: fair, real_guess: fair, point: score, worth_knowing: 0.5 }, score, writtenOn: DATE, ...(aiPick ? { opponent: { model: 'gpt-5-nano', label: 'GPT-5 nano', picked: aiPick } } : {}) };
  };
  // correct is B: picked B = AI right.
  const right = [p('t01a01', 0.9, 'B'), p('t01a03', 0.8, 'B'), p('t01a05', 0.7, 'B'), p('t01a09', 0.6, 'B')];
  const wrong = [p('t02a01', 0.85, 'A'), p('t02a03', 0.5, 'A'), p('t02a05', 0.4, 'A')];
  const none = p('t03a01', 0.99, null);
  const c = chooseGameDay([...right, ...wrong, none]);
  assert.equal(c.balanced, true);
  assert.equal(c.aiRight, AI_RIGHT_TARGET);
  assert.equal(c.chosen.length, GAME_SIZE);
  assert.deepEqual(c.chosen.map((x) => x.q.cellId).sort(), ['t01a01', 't01a03', 't01a05', 't01a09', 't02a01'].sort(), 'best of each kind; no unanswered question');
  assert.equal(wantsMore(c, 3), false);

  const short = chooseGameDay([...right, p('t01a11', 0.55, 'B')]);
  assert.equal(short.chosen.length, 5);
  assert.equal(short.aiRight, 5, 'too few AI-wrong: filled with AI-right rather than run short');
  assert.equal(short.balanced, false);
  assert.equal(wantsMore(short, 4), true);
  assert.equal(wantsMore(short, MAX_GAME_CHECKS), false, 'the check budget stops it');

  const easy = p('t05a01', 0.5, 'A', 0.9);
  const tieRight = p('t05a03', 0.5, 'B', 0.6);
  const tieWrong = p('t05a05', 0.5, 'A', 0.6);
  assert.equal(fairShot(easy), 0.9);
  assert.deepEqual(orderEasiestFirst([tieWrong, easy, tieRight]).map((x) => x.q.cellId), ['t05a01', 't05a03', 't05a05']);
});

test('runTriviaDaily: no score gates (AT-62). Low scores on tests 1 and 2 still pool, ranked by test 3', async () => {
  const { db } = await harnessDb();
  let offered: string[] = [];
  const write = stubWriter({
    submit_trivia: (params, n) => {
      if (n > 1) return { questions: [], spent_cells: [] };
      offered = (materialOf(params).cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      return { questions: offered.slice(0, 2).map((c) => item(c, { score: { clear: 0.1, real_guess: 0.1, point: 0.5, worth_knowing: 0.5 } })), spent_cells: [] };
    },
  });
  const jevStub = stubJev((k, state) => (k === 'point' ? (String((state as { question?: string }).question).includes(offered[0]!) ? 0.9 : 0.3) : 0.1));
  const r = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42, fill: TWO_CALLS });
  assert.equal(r.ran, true);
  if (!r.ran) return;
  assert.deepEqual(r.pooled, [{ key: triviaPoolKey(offered[0]!, 1), score: 0.7 }, { key: triviaPoolKey(offered[1]!, 1), score: 0.4 }]);
  const { rows } = await db.query(`SELECT 1 FROM stories.trivia_archive`);
  assert.equal(rows.length, 0, 'nothing archived for its scores');
});

test('runTriviaDaily: a length-only failure gets one shortening try; the rewrite is validated and scored, and dropped if still too long', async () => {
  const { db } = await harnessDb();
  let offered: string[] = [];
  const write = stubWriter({
    submit_trivia: (params) => {
      const m = materialOf(params);
      if (m.questions) {
        // The shortener: fixes the first, leaves the second too long.
        const qs = m.questions as Array<{ question: TriviaWriteItem }>;
        return { questions: [{ ...qs[0]!.question, answer_line: 'Short now.' }, qs[1]!.question] };
      }
      if (offered.length) return { questions: [], spent_cells: [] }; // the second writer call writes nothing
      offered = (m.cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      return { questions: [item(offered[0]!), item(offered[1]!, { answer_line: 'x'.repeat(125) }), item(offered[2]!, { answer_line: 'y'.repeat(125) }), item(offered[3]!, { question: 'Nope!' })], spent_cells: [] };
    },
  });
  const jevStub = stubJev(() => 0.8);
  const r = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42, fill: TWO_CALLS });
  assert.equal(r.ran, true);
  if (!r.ran) return;
  assert.equal(write.calls.length, 3, 'the writer, one shortening call, then the second writer call');
  assert.ok(!(write.calls[1]!.tools as Array<{ name: string }>).some((t) => t.name === 'web_search'), 'the shortener does not search');
  assert.deepEqual(r.shortened, [offered[1]]);
  assert.deepEqual(r.pooled.map((x) => x.key).sort(), [offered[0], offered[1]].map((c) => triviaPoolKey(c!, 1)).sort());
  assert.equal(jevStub.calls.length, 2, 'the rewrite is scored like any question');
  const still = r.rejected.find((x) => x.cellId === offered[2]);
  assert.match(still!.problems.join(), /after shortening.*max 120/);
  assert.match(r.rejected.find((x) => x.cellId === offered[3])!.problems.join(), /exclamation/, 'other failures get no shortening try');
  const { rows: costs } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events ORDER BY component`);
  assert.deepEqual(costs.map((c) => c.component), ['trivia-score', 'trivia-shorten', 'trivia-write']);
});

/* ── Central intake (Stories split SS-30, SS-33) ────────────────── */

/** The harness db plus the intake schema (db/intake_schema.sql, db/intake_stories_split.sql), as one Postgres in production. */
async function intakeHarness() {
  const h = await harnessDb();
  await h.pg.exec(schemaSql(path.join(process.cwd(), 'db', 'intake_schema.sql')));
  await h.pg.exec(schemaSql(path.join(process.cwd(), 'db', 'intake_stories_split.sql')));
  return h;
}

/**
 * A writer whose response also carries web search results and a cited line, as the live trivia-write call does. Each
 * run makes two writer calls (AT-78): the first writes `questions` and searches; the second writes nothing.
 */
function searchingWriter(questions: (cells: string[]) => TriviaWriteItem[]) {
  const materials: Array<Record<string, unknown>> = [];
  const first = () => materials.length % 2 === 1;
  const base = stubWriter({
    submit_trivia: (params) => {
      const m = materialOf(params);
      materials.push(m);
      return { questions: first() ? questions((m.cells as Array<{ cell_id: string }>).map((c) => c.cell_id)) : [], spent_cells: [] };
    },
  });
  const write = Object.assign(
    async (params: Record<string, unknown>) => {
      const res = await base(params);
      if (!first()) return res;
      return {
        ...res,
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'transformer paper year' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [
            { type: 'web_search_result', url: 'https://arxiv.test/attention', title: 'Attention Is All You Need', page_age: 'June 12, 2017', encrypted_content: 'x' },
            { type: 'web_search_result', url: 'https://wiki.test/Perceptron', title: 'Perceptron - Wikipedia', encrypted_content: 'x' },
          ] },
          { type: 'text', text: 'The paper came out in 2017.', citations: [
            { type: 'web_search_result_location', url: 'https://arxiv.test/attention', title: 'Attention Is All You Need', cited_text: 'We propose a new simple network architecture, the Transformer.', encrypted_index: 'x' },
          ] },
          ...res.content,
        ],
      } as typeof res;
    },
    { calls: base.calls },
  );
  return { write, materials };
}

test('runTriviaDaily (SS-30): each page the writer cited goes into the intake once: URL, title, quoted line; legacy mode gets no research', async () => {
  const { db } = await intakeHarness();
  const { write, materials } = searchingWriter((cells) => [
    item(cells[0]!, { sources: ['https://arxiv.test/attention', 'https://wiki.test/Perceptron'] }),
    item(cells[1]!, { sources: ['https://arxiv.test/attention/', 'not a url'] }),
    item(cells[2]!, { question: 'Nope!', sources: ['https://blog.test/rejected-but-cited'] }),
  ]);
  const r = await runTriviaDaily({ db, jev: createStoriesJev(stubJev(() => 0.8), db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42, fill: TWO_CALLS });
  assert.equal(r.ran, true);
  if (!r.ran) return;
  assert.equal(r.pooled.length, 2, 'question writing is unchanged');
  assert.ok(!('research' in materials[0]!), 'legacy: no research in the material');
  assert.deepEqual(r.intake, { mode: 'legacy', research: 0, deposited: 3, created: 3, failed: 0 });

  const { rows } = await db.query<{ key: string; family: string; source_id: string; source_type: string; headline: string; body: string; publish_time: Date | null; story_id: string | null }>(
    `SELECT key, family, source_id, source_type, headline, body, publish_time, story_id FROM intake.items ORDER BY key`,
  );
  assert.deepEqual(rows.map((x) => [x.family, x.source_id, x.source_type, x.story_id]), Array(3).fill(['search', 'search:trivia', 'B6', null]));
  const byUrl = (u: string) => rows.find((x) => x.key.includes(u))!;
  const attention = byUrl('arxiv.test/attention');
  assert.equal(attention.headline, 'Attention Is All You Need');
  assert.equal(attention.body, 'We propose a new simple network architecture, the Transformer.', 'the quoted line');
  assert.equal(new Date(attention.publish_time!).getUTCFullYear(), 2017, 'the page age');
  const perceptron = byUrl('wiki.test/Perceptron');
  assert.equal(perceptron.headline, 'Perceptron - Wikipedia');
  assert.match(perceptron.body, /^Confirms: Question for t\d{2}a\d{2}\? Answer: Two\.$/, 'no quote: the claim it confirms');
  assert.equal(byUrl('blog.test').headline, 'https://blog.test/rejected-but-cited', 'no title: the URL');

  // A second run the same day (forced) bumps the same pages instead of adding rows.
  const again = await runTriviaDaily({ db, jev: createStoriesJev(stubJev(() => 0.8), db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42, fill: TWO_CALLS, force: true });
  assert.ok(again.ran && again.intake?.deposited === 3 && again.intake.created === 0);
  assert.equal((await db.query(`SELECT 1 FROM intake.items`)).rows.length, 3);
});

test('runTriviaDaily (SS-30): a failed deposit never stops the day; it is recorded', async () => {
  const { db } = await harnessDb(); // no intake schema at all
  const { write } = searchingWriter((cells) => [item(cells[0]!, { sources: ['https://arxiv.test/attention'] })]);
  const r = await runTriviaDaily({ db, jev: createStoriesJev(stubJev(() => 0.8), db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42, fill: TWO_CALLS });
  assert.ok(r.ran);
  if (!r.ran) return;
  assert.equal(r.pooled.length, 1);
  assert.equal(r.intake?.mode, 'legacy', 'an unreadable switch is legacy');
  assert.deepEqual([r.intake?.deposited, r.intake?.failed], [0, 1]);
  assert.match(r.intake?.depositError ?? '', /intake/);
});

test('runTriviaDaily (SS-33): intake mode hands the writer the order\'s research; stale or a failed read falls back to legacy', async () => {
  const { db } = await intakeHarness();
  const insertStory = async (key: string, sourceId: string, title: string, body: string, seenHoursAgo: number) => {
    const at = new Date(NOW.getTime() - seenHoursAgo * 3_600_000);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO intake.stories (representative_key, headline, first_seen_at, last_joined_at) VALUES ($1, $2, $3, $3) RETURNING id::text AS id`, [key, title, at]);
    await db.query(
      `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, first_seen_at, last_seen_at, story_id, role, joined_at)
       VALUES ($1, 'search', $2, 'x', 'B6', $3, $4, $1, $5, $5, $6::uuid, 'primary', $5)`, [key, sourceId, title, body, at, rows[0]!.id]);
  };
  await insertStory('https://wiki.test/Turing', 'search:trivia', 'Alan Turing - Wikipedia', 'Turing proposed the imitation game in 1950.', 30);
  await insertStory('https://news.test/b6-find', 'search:b6', 'A Reels find', 'Not trivia research.', 5);
  await insertStory('https://wiki.test/Old', 'search:trivia', 'Too old', 'Outside the 30-day window.', 24 * 31);
  await db.query(`UPDATE intake.settings SET value = value || '{"trivia":"intake"}' WHERE key = 'consumers'`);
  await db.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ('main', 'ok', $1, '{"scored":true,"orders":["trivia"]}')`, [new Date(NOW.getTime() - 8 * 3_600_000)]);

  const { write, materials } = searchingWriter((cells) => [item(cells[0]!)]);
  const run = (now = NOW, intake?: Parameters<typeof runTriviaDaily>[0]['intake']) =>
    runTriviaDaily({ db, jev: createStoriesJev(stubJev(() => 0.8), db), write, settings: DEFAULT_SETTINGS, now, rand: () => 0.42, fill: TWO_CALLS, force: true, intake });

  const r = await run();
  assert.ok(r.ran && r.intake?.mode === 'intake' && r.intake.research === 1);
  assert.deepEqual(materials[0]!.research, [{ url: 'https://wiki.test/Turing', title: 'Alan Turing - Wikipedia', quote: 'Turing proposed the imitation game in 1950.' }]);
  assert.deepEqual(materials[1]!.research, materials[0]!.research, 'both writer calls get the research');
  assert.equal(write.calls.length, 2, 'two writer calls');
  assert.ok(!JSON.stringify(write.calls[0]!.system).includes('Turing'), 'research stays out of the cached system prompt');

  // Stale: the last main run is over 26 h old → legacy path, no research.
  const stale = await run(new Date(NOW.getTime() + 20 * 3_600_000));
  assert.ok(stale.ran && stale.intake?.mode === 'stale-fallback' && stale.intake.research === 0);
  assert.ok(!('research' in materials[2]!));

  // The intake read fails → error-fallback, no research; the day still pools.
  const broken = await run(NOW, { listOrderStories: async () => { throw new Error('intake.stories is missing'); } });
  assert.ok(broken.ran && stale.ran && broken.intake?.mode === 'error-fallback' && broken.pooled.length > stale.pooled.length, 'a top-up adds to the day');
  assert.ok(!('research' in materials[4]!));
});

test('citedSources: http(s) only, once per page, the first quotes joined, capped', () => {
  const finds = citedSources(
    [item('t01a01', { sources: ['https://a.test/x#frag', 'https://a.test/x/', 'ftp://no.test', 'https://b.test'] })],
    [{ content: [{ type: 'text', text: '.', citations: [
      { type: 'web_search_result_location', url: 'https://a.test/x', title: 'A', cited_text: 'First line.' },
      { type: 'web_search_result_location', url: 'https://a.test/x', title: 'A', cited_text: 'Second line.' },
    ] }] }],
  );
  assert.deepEqual(finds.map((f) => [f.canonicalUrl, f.headline, f.body]), [
    ['https://a.test/x#frag', 'A', 'First line. … Second line.'],
    ['https://b.test', 'https://b.test', 'Confirms: Question for t01a01? Answer: Two.'],
  ]);
});

/* ── Pool ─────────────────────────────────────────────────────────── */

test('pool cap: the unused bank holds 50 and served questions 40, apart; the lowest of each go to the archive; no stale or not-returned drop', async () => {
  const { db } = await harnessDb();
  assert.equal(TRIVIA_POOL_CAP, 50);
  assert.equal(TRIVIA_SERVED_CAP, 40);
  const cells = allCells().slice(0, 51 + 42).map((c) => c.cellId);
  const unused = cells.slice(0, 51);
  const served = cells.slice(51);
  for (const [i, c] of unused.entries()) await poolRow(db, c, Number((0.3 + i / 100).toFixed(2)));
  // Served questions score higher, so a cap on all open rows would push the bank out.
  for (const [i, c] of served.entries()) await poolRow(db, c, Number((0.9 + i / 1000).toFixed(3)));
  await db.query(`INSERT INTO stories.trivia_game_days (day_number, ny_date, status, questions) VALUES (1, '2026-11-11', 'locked', $1::jsonb)`, [JSON.stringify(served.map((c) => ({ key: `trivia:${c}` })))]);
  assert.equal(await unusedTriviaCount(db), 51);
  // A refresh far in the future that read every series: AI Trivia's rows are neither stale nor "not returned".
  const r = await writePool(db, { items: [], refreshed: ['morning_download', 'free_vs_paid', 'ai_trivia'] }, new Date('2027-06-01T12:00:00Z'));
  assert.equal(r.dropped, 3);
  assert.equal(await unusedTriviaCount(db), TRIVIA_POOL_CAP);
  const { rows: arch } = await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.trivia_archive ORDER BY key`);
  assert.deepEqual(arch, [unused[0], served[0], served[1]].map((c) => ({ key: `trivia:${c}`, reason: 'cap' })).sort((a, b) => a.key.localeCompare(b.key)), 'the lowest of each group');
  const pool = await openPool(db, 'ai_trivia');
  assert.equal(pool.trivia!.length, 90);
  assert.deepEqual(await capTriviaPool(db), [], 'nothing more to drop');
});

test('runTriviaDaily: calls until the day pools DAILY_TARGET, at most MAX_WRITER_CALLS, and none once the bank is full; a code repeat is dropped', async () => {
  assert.ok(DAILY_TARGET > GAME_SIZE, 'production stays ahead of the game');
  const { db } = await harnessDb();
  await ensureCells(db);
  await poolRow(db, 't02a01', 0.5);
  let n = 0;
  const write = stubWriter({
    submit_trivia: (params) => {
      const ids = (materialOf(params).cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      n++;
      // 3 new questions a call, plus a reworded copy of the pooled one (anchored to another cell): dropped in code.
      return {
        questions: [
          ...ids.slice(0, 3).map((c) => item(c, { question: `Distinct fact number ${n}${c} about something else?`, options: [{ letter: 'A', text: `x${n}${c}` }, { letter: 'B', text: `y${n}${c}` }, { letter: 'C', text: `z${n}${c}` }] })),
          item(ids[3]!, { question: 'Question for t02a01 again?' }),
        ],
        spent_cells: [],
      };
    },
  });
  const jev = createStoriesJev(stubJev(() => 0.6), db);
  const r = await runTriviaDaily({ db, jev, write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.3 });
  assert.equal(r.ran, true);
  if (!r.ran) return;
  assert.equal(r.calls, 4, `3 a call: ${DAILY_TARGET} takes 4 calls`);
  assert.ok(MAX_WRITER_CALLS >= r.calls!);
  assert.equal(r.pooled.length, 12);
  assert.equal(r.rejected.filter((x) => /repeat: the same fact as trivia:t02a01/.test(x.problems.join())).length, 4);
  assert.deepEqual(r.bank, { before: 1, after: 13 });

  // A top-up the same day adds to the record; the bank cap stops it.
  await db.query(`UPDATE stories.pool SET score = 0.5`);
  const top = await runTriviaDaily({ db, jev, write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.3, force: true, fill: { target: 100, maxCalls: 30 } });
  assert.equal(top.ran, true);
  if (!top.ran) return;
  assert.equal(top.pooled.length, 12 + 39, 'the earlier run stays on the record');
  assert.equal(top.bank!.after, TRIVIA_POOL_CAP, 'stops at the cap (the last call may overshoot; the cap trims it)');
  assert.equal(top.calls, 13);
});

/* ── Builder ──────────────────────────────────────────────────────── */

test('buildAiTrivia: questions the game already served go first, so the story leaves the unused bank to the game', async () => {
  const { db } = await harnessDb();
  await poolRow(db, 't03a05', 0.9); // unused, higher score
  const served = await poolRow(db, 't04a02', 0.5);
  await db.query(`INSERT INTO stories.trivia_game_days (day_number, ny_date, status, questions) VALUES (1, '2026-11-01', 'locked', $1::jsonb)`, [JSON.stringify([{ key: 'trivia:t04a02', payload: served, factCheck: { verdict: 'pass', problems: [], sources: [] } }])]);
  const checked: string[] = [];
  const write = stubWriter({ submit_check: (params) => (checked.push(String(materialOf(params).question)), { verdict: 'pass', problems: [], sources: [] }) });
  const r = await buildAiTrivia(await trivDeps(db, write));
  assert.equal(r.ok, true);
  assert.deepEqual(checked, ['Question for t04a02?']);
  assert.equal(await unusedTriviaCount(db), 1, 'the bank keeps its question');
});

test('buildAiTrivia: a failed fact-check archives the top row; the next passes → 2 copy-only frames', async () => {
  const { db } = await harnessDb();
  await poolRow(db, 't03a05', 0.9);
  await poolRow(db, 't04a02', 0.8);
  const write = stubWriter({
    submit_direction: () => ({ head: 'gradcap', hand: 'none', opening_mood: 'happy', pondering_mood: 'curious' }),
    submit_check: (params, n) => {
      const m = materialOf(params);
      assert.ok(typeof m.question === 'string' && Array.isArray(m.options) && typeof m.answer_line === 'string');
      return n === 1 ? { verdict: 'fail', problems: ['The marked answer is wrong.'], sources: ['https://check.test/1'] } : { verdict: 'pass', problems: [], sources: ['https://check.test/2'] };
    },
  });
  const deps = await trivDeps(db, write);
  const r = await buildAiTrivia(deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(write.calls.length, 3, 'two checks, then the critter direction');
  for (const f of r.frames) assert.equal((f.copy as unknown as { critter?: { head?: string } }).critter?.head, 'gradcap', 'the direction reaches both frames');
  assert.equal((write.calls[0]!.tools as Array<{ name: string; max_uses?: number }>).find((t) => t.name === 'web_search')?.max_uses, 3);

  // The failed one: archived and out of the pool.
  const { rows: arch } = await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.trivia_archive`);
  assert.deepEqual(arch.map((a) => a.key), ['trivia:t03a05']);
  assert.match(arch[0]!.reason, /^fact-check: The marked answer is wrong/);
  assert.equal((await db.query(`SELECT 1 FROM stories.pool WHERE key = 'trivia:t03a05'`)).rows.length, 0);

  assert.deepEqual(r.frames.map((f) => [f.seq, f.role]), [[1, 'question'], [2, 'answer']]);
  const copy = r.frames[0]!.copy as unknown as Record<string, unknown>;
  assert.equal(copy.question, 'Question for t04a02?');
  assert.equal(copy.correct, 'B');
  assert.equal((copy.options as unknown[]).length, 3);
  for (const f of r.frames) {
    assert.equal(f.photo ?? null, null, `${f.role}: no photo`);
    assert.ok(!('photo' in (f.copy as object)), `${f.role}: no photo in the copy`);
  }
  assert.equal((deps.photos as ReturnType<typeof stubPhotos>).requests.length, 0, 'no photo search');
  const trivia = r.payload.trivia as { q: TriviaQuestion; factCheck: { verdict: string }; scores: { score: number } };
  assert.deepEqual(Object.keys(trivia).sort(), ['factCheck', 'q', 'scores']);
  assert.equal(trivia.q.cellId, 't04a02');
  assert.equal(trivia.factCheck.verdict, 'pass');
  assert.equal(trivia.scores.score, 0.8);
  assert.deepEqual(r.historyKeys, ['trivia:t04a02']);
  assert.deepEqual(r.candidates.map((c) => [c.ref, c.chosen, c.reason]), [['trivia:t03a05', false, 'fact-check fail'], ['trivia:t04a02', true, null]]);
});

test('buildAiTrivia: nothing passes in 5 tries → skipped with triviaSkip; a pass that lists problems is a fail', async () => {
  const { db } = await harnessDb();
  for (const [i, c] of ['t01a02', 't01a03', 't01a04', 't01a05', 't01a06', 't01a07'].entries()) await poolRow(db, c, 0.9 - i / 100);
  const write = stubWriter({ submit_check: () => ({ verdict: 'pass', problems: ['Option C is also arguably right.'], sources: [] }) });
  const deps = await trivDeps(db, write);
  const r = await buildAiTrivia(deps);
  assert.equal(r.ok, false);
  assert.equal(write.calls.length, MAX_CHECKS);
  const { rows } = await db.query<{ skip: { tried: unknown[] } }>(`SELECT payload->'triviaSkip' AS skip FROM stories.sets WHERE id = $1`, [deps.setId]);
  assert.equal(rows[0]!.skip.tried.length, 5);
  assert.equal((await db.query(`SELECT 1 FROM stories.pool WHERE key = 'trivia:t01a07'`)).rows.length, 1, 'the sixth is never tried');
  assert.equal((await db.query(`SELECT 1 FROM stories.trivia_archive`)).rows.length, 5);
  assert.deepEqual(toFactCheck({ verdict: 'fail', problems: [], sources: [] }).problems, ['verdict fail']);
});

test('buildAiTrivia with an opponent (AT-74/75): both frames carry its label and pick, the payload keeps it; no answer still builds', async () => {
  for (const choice of ['C', null] as const) {
    const { db } = await harnessDb();
    await poolRow(db, 't04a02', 0.8);
    const write = stubWriter({ submit_check: () => ({ verdict: 'pass', problems: [], sources: ['https://check.test/1'] }) });
    const asked: Array<Record<string, unknown>> = [];
    const opponent: NonNullable<BuildDeps['opponent']> = {
      openai: async (body) => {
        asked.push(body);
        return { choices: [{ message: choice ? { tool_calls: [{ function: { arguments: JSON.stringify({ choice }) } }] } : { refusal: 'no' } }], usage: { prompt_tokens: 200, completion_tokens: 30 } };
      },
      fal: async () => {
        throw new Error('fal is only the fallback');
      },
    };
    const deps = { ...(await trivDeps(db, write)), opponent };
    const r = await buildAiTrivia(deps);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(asked.length, 1, 'asked once');
    assert.equal(write.calls.length, 2, 'the fact-check and the critter direction; the opponent does not go through the writer');
    for (const f of r.frames) {
      const o = (f.copy as unknown as { opponent?: unknown }).opponent;
      assert.deepEqual(o, choice ? { label: 'GPT-5 nano', picked: choice } : undefined, `${f.role}`);
    }
    const p = (r.payload.trivia as { opponent?: unknown }).opponent;
    assert.deepEqual(p, choice ? { model: 'gpt-5-nano', label: 'GPT-5 nano', picked: choice } : undefined);
  }
});

test('buildAiTrivia lean (AT-75): the AI has been winning, so a top-3 question it missed is fact-checked first', async () => {
  const { db } = await harnessDb();
  await poolRow(db, 't05a01', 0.9);
  await poolRow(db, 't05a02', 0.8);
  // Three earlier sets the AI won.
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) {
    await db.query(`INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload) VALUES ('ai_trivia', $1, 'published', 'click', 'polished', $2::jsonb)`, [d, JSON.stringify({ trivia: { q: { correct: 'B' }, opponent: { picked: 'B' } } })]);
  }
  const write = stubWriter({ submit_check: () => ({ verdict: 'pass', problems: [], sources: [] }) });
  // The answer is B on both: the AI gets the top one right and the second wrong.
  const replies = ['B', 'A'];
  const opponent: NonNullable<BuildDeps['opponent']> = {
    openai: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ choice: replies.shift() }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    fal: async () => ({}),
  };
  const r = await buildAiTrivia({ ...(await trivDeps(db, write)), opponent });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal((r.payload as { cellId: string }).cellId, 't05a02', 'the miss goes first');
  assert.deepEqual((r.payload.trivia as { opponent: { picked: string } }).opponent.picked, 'A');
  assert.equal(replies.length, 0, 'both top questions answered once');
});
