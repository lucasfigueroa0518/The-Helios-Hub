/**
 * "Are you smarter than AI?" ideas (series ai_trivia; CONTRACT.md §5 row A,
 * CONTRACT-2 §5 row B), offline: the content map, the validator, the daily
 * writer, the pool cap and the builder's fact-check
 * loop. PGlite via the stories harness; Sonnet and Jev are stubs. No live
 * call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildAiTrivia, MAX_CHECKS, toFactCheck } from '@/lib/stories/build/ai-trivia';
import { createStoriesJev } from '@/lib/stories/jev';
import { openPool, TRIVIA_POOL_CAP, writePool } from '@/lib/stories/pool';
import { STORIES_PROMPTS } from '@/lib/stories/prompts';
import { STORIES_QUESTION_SETS } from '@/lib/stories/questions';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import { cellState, closeCell, ensureCells, reserveCell, sampleOpenCells } from '@/lib/stories/trivia/cells';
import { TRIVIA_AUDIENCE } from '@/lib/stories/trivia/audience';
import { runTriviaDaily } from '@/lib/stories/trivia/daily';
import { NEVER_REPEAT, QUALITY_TESTS, QUALITY_TEXT, RANK_KEYS } from '@/lib/stories/trivia/quality';
import { allCells, ANGLES, cellOf, isActive, RETIRED_ANGLES, RETIRED_THEMES, THEMES } from '@/lib/stories/trivia/map';
import { TRIVIA_CHECK, TRIVIA_SHORTEN, TRIVIA_WRITE, type TriviaWriteItem } from '@/lib/stories/trivia/prompts';
import { TRIVIA_SCORE } from '@/lib/stories/trivia/questions';
import { SCORECARD_KEYS, triviaPoolKey, triviaScore, type Scorecard, type TriviaPoolPayload, type TriviaQuestion } from '@/lib/stories/trivia/types';
import { validateQuestion } from '@/lib/stories/trivia/validate';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

const NOW = new Date('2026-11-10T08:30:00Z'); // 3:30 AM New York
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

/** A reserved cell with its pool row, as the daily writer leaves it. */
async function poolRow(db: Db, cellId: string, score: number): Promise<TriviaPoolPayload> {
  const key = triviaPoolKey(cellId);
  assert.ok(await reserveCell(db, cellId, key));
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
  assert.ok(ids.includes('trivia-write@3') && ids.includes('trivia-check@3') && ids.includes('trivia-shorten@1'));
  assert.ok(!ids.includes('trivia-write@2') && !ids.includes('trivia-check@2'));
  assert.ok(!ids.some((id) => id.startsWith('gtn-')));
  const sets = STORIES_QUESTION_SETS.map((s) => s.version);
  assert.ok(sets.includes('trivia-score@3') && !sets.includes('trivia-score@2'));
  assert.ok(!sets.some((v) => v.startsWith('gtn-')));
  assert.deepEqual([...SCORECARD_KEYS], ['clear', 'real_guess', 'point', 'worth_knowing']);
  assert.deepEqual([...RANK_KEYS], ['point'], 'test 3 ranks');
  assert.deepEqual(Object.keys(TRIVIA_SCORE.questions), [...SCORECARD_KEYS]);
  assert.equal(TRIVIA_WRITE.system.split(QUALITY_TEXT).length, 2, 'the definition appears once in the writer');
  assert.equal(TRIVIA_SHORTEN.system.split(QUALITY_TEXT).length, 2, 'and once in the shortener');
  assert.ok(TRIVIA_WRITE.system.includes(NEVER_REPEAT) && TRIVIA_CHECK.system.includes(NEVER_REPEAT), 'one repeat rule, read by the writer and the check');
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

test('runTriviaDaily: one writer call on 12 open cells with the asked list; 3 pool rows, 3 cells reserved; !, emoji and wrong option count rejected', async () => {
  const { db } = await harnessDb();
  await closeCell(db, 't01a01'); // a posted cell is never offered
  await poolRow(db, 't01a02', 0.6); // an earlier question: the writer sees it under asked
  let offered: string[] = [];
  let asked: unknown = null;
  const write = stubWriter({
    submit_trivia: (params) => {
      const m = materialOf(params);
      asked = m.asked;
      offered = (m.cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      const [a, b, c, d, e, f] = offered;
      return {
        questions: [
          item(a!),
          item(b!, { question: 'Can you believe this!' }),
          item(c!, { answer_line: 'Wild 🤯' }),
          item(d!, { options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }] }),
          item(e!, { correct: 'A' }),
          item(f!, { correct: 'C' }),
        ],
      };
    },
  });
  const jevStub = stubJev((k) => ({ clear: 0.9, real_guess: 0.7, point: 0.3, worth_knowing: 0.6 })[k] ?? 0);
  const r = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42 });
  assert.equal(r.ran, true);
  if (!r.ran) return;

  // One call: Sonnet from settings, ≤5 searches, cells only in the user turn.
  assert.equal(write.calls.length, 1);
  const call = write.calls[0]!;
  assert.equal(call.model, DEFAULT_SETTINGS.models.copy);
  assert.deepEqual((call.tools as Array<{ name: string; max_uses?: number }>).find((t) => t.name === 'web_search')?.max_uses, 5);
  assert.equal(offered.length, 12);
  assert.ok(!offered.includes('t01a01'));
  assert.deepEqual(asked, [{ question: 'Question for t01a02?', answer: 'Two' }]);
  assert.ok(!JSON.stringify(call.system).includes(offered[0]!), 'per-day cells stay out of the cached system prompt');

  assert.equal(r.pooled.length, 3);
  assert.deepEqual(r.shortened, []);
  assert.deepEqual(r.rejected.map((x) => x.cellId), [offered[1], offered[2], offered[3]]);
  assert.match(r.rejected[0]!.problems.join(), /exclamation/);
  assert.match(r.rejected[1]!.problems.join(), /emoji/);
  assert.match(r.rejected[2]!.problems.join(), /needs 3/);

  const { rows } = await db.query<{ key: string; origin: string; score: string; payload: TriviaPoolPayload }>(`SELECT key, origin, score, payload FROM stories.pool WHERE series = 'ai_trivia' AND key <> 'trivia:t01a02' ORDER BY key`);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((x) => x.key).sort(), [offered[0], offered[4], offered[5]].map((c) => `trivia:${c}`).sort());
  const expected = triviaScore({ clear: 0.8, real_guess: 0.7, point: 0.6, worth_knowing: 0.5 }, { clear: 0.9, real_guess: 0.7, point: 0.3, worth_knowing: 0.6 });
  assert.equal(expected, Number(((0.6 + 0.3) / 2).toFixed(4)), 'the mean of the writer and Jev on test 3');
  for (const row of rows) {
    assert.equal(row.origin, 'model');
    assert.equal(Number(row.score), expected);
    assert.equal(row.payload.kind, 'trivia');
    assert.deepEqual(row.payload.jevScore, { clear: 0.9, real_guess: 0.7, point: 0.3, worth_knowing: 0.6 });
    assert.equal(await cellState(db, row.key), 'reserved');
  }
  for (const c of [offered[1], offered[2], offered[3]]) assert.equal(await cellState(db, c!), 'open');
  assert.equal(jevStub.calls.length, 3);
  assert.deepEqual(jevStub.calls[0]!.keys, ['clear', 'real_guess', 'point', 'worth_knowing']);
  const { rows: costs } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events ORDER BY component`);
  assert.deepEqual(costs.map((c) => c.component), ['trivia-score', 'trivia-write']);

  // Once per pool day.
  const again = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(again.ran, false);
  assert.equal(write.calls.length, 1);
});

test('runTriviaDaily: no score gates (AT-62). Low scores on tests 1 and 2 still pool, ranked by test 3', async () => {
  const { db } = await harnessDb();
  let offered: string[] = [];
  const write = stubWriter({
    submit_trivia: (params) => {
      offered = (materialOf(params).cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      return { questions: offered.slice(0, 2).map((c) => item(c, { score: { clear: 0.1, real_guess: 0.1, point: 0.5, worth_knowing: 0.5 } })) };
    },
  });
  const jevStub = stubJev((k, state) => (k === 'point' ? (String((state as { question?: string }).question).includes(offered[0]!) ? 0.9 : 0.3) : 0.1));
  const r = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42 });
  assert.equal(r.ran, true);
  if (!r.ran) return;
  assert.deepEqual(r.pooled, [{ key: triviaPoolKey(offered[0]!), score: 0.7 }, { key: triviaPoolKey(offered[1]!), score: 0.4 }]);
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
      offered = (m.cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      return { questions: [item(offered[0]!), item(offered[1]!, { answer_line: 'x'.repeat(125) }), item(offered[2]!, { answer_line: 'y'.repeat(125) }), item(offered[3]!, { question: 'Nope!' })] };
    },
  });
  const jevStub = stubJev(() => 0.8);
  const r = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW, rand: () => 0.42 });
  assert.equal(r.ran, true);
  if (!r.ran) return;
  assert.equal(write.calls.length, 2, 'the writer, then one shortening call');
  assert.ok(!(write.calls[1]!.tools as Array<{ name: string }>).some((t) => t.name === 'web_search'), 'the shortener does not search');
  assert.deepEqual(r.shortened, [offered[1]]);
  assert.deepEqual(r.pooled.map((x) => x.key).sort(), [offered[0], offered[1]].map((c) => triviaPoolKey(c!)).sort());
  assert.equal(jevStub.calls.length, 2, 'the rewrite is scored like any question');
  const still = r.rejected.find((x) => x.cellId === offered[2]);
  assert.match(still!.problems.join(), /after shortening.*max 120/);
  assert.match(r.rejected.find((x) => x.cellId === offered[3])!.problems.join(), /exclamation/, 'other failures get no shortening try');
  const { rows: costs } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events ORDER BY component`);
  assert.deepEqual(costs.map((c) => c.component), ['trivia-score', 'trivia-shorten', 'trivia-write']);
});

/* ── Pool ─────────────────────────────────────────────────────────── */

test('pool cap: 21 trivia rows → 20; the lowest goes to the archive and its cell opens; no stale or not-returned drop', async () => {
  const { db } = await harnessDb();
  const cells = allCells().slice(0, 21).map((c) => c.cellId);
  for (const [i, c] of cells.entries()) await poolRow(db, c, Number((0.5 + i / 100).toFixed(2)));
  // A refresh far in the future that read every series: AI Trivia's rows are neither stale nor "not returned".
  const r = await writePool(db, { items: [], refreshed: ['morning_download', 'free_vs_paid', 'ai_trivia'] }, new Date('2027-06-01T12:00:00Z'));
  assert.equal(r.dropped, 1);
  const { rows } = await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'ai_trivia'`);
  assert.equal(rows.length, TRIVIA_POOL_CAP);
  assert.ok(!rows.some((x) => x.key === `trivia:${cells[0]}`), 'the lowest-scored row is the one dropped');
  assert.equal(await cellState(db, cells[0]!), 'open');
  assert.equal(await cellState(db, cells[1]!), 'reserved');
  const { rows: arch } = await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.trivia_archive`);
  assert.deepEqual(arch, [{ key: `trivia:${cells[0]}`, reason: 'cap' }]);
  const pool = await openPool(db, 'ai_trivia');
  assert.equal(pool.trivia!.length, 20);
  assert.equal(pool.trivia![0]!.q.cellId, cells[20]);
});

/* ── Builder ──────────────────────────────────────────────────────── */

test('buildAiTrivia: a failed fact-check archives the top row and frees its cell; the next passes → 2 copy-only frames', async () => {
  const { db } = await harnessDb();
  await poolRow(db, 't03a05', 0.9);
  await poolRow(db, 't04a02', 0.8);
  const write = stubWriter({
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
  assert.equal(write.calls.length, 2);
  assert.equal((write.calls[0]!.tools as Array<{ name: string; max_uses?: number }>).find((t) => t.name === 'web_search')?.max_uses, 3);

  // The failed one: archived, out of the pool, cell open.
  const { rows: arch } = await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.trivia_archive`);
  assert.deepEqual(arch.map((a) => a.key), ['trivia:t03a05']);
  assert.match(arch[0]!.reason, /^fact-check: The marked answer is wrong/);
  assert.equal(await cellState(db, 't03a05'), 'open');
  assert.equal((await db.query(`SELECT 1 FROM stories.pool WHERE key = 'trivia:t03a05'`)).rows.length, 0);
  assert.equal(await cellState(db, 't04a02'), 'reserved', 'closes at publish, not at build');

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
  assert.equal(await cellState(db, 't01a07'), 'reserved', 'the sixth is never tried');
  assert.equal((await db.query(`SELECT 1 FROM stories.trivia_archive`)).rows.length, 5);
  assert.deepEqual(toFactCheck({ verdict: 'fail', problems: [], sources: [] }).problems, ['verdict fail']);
});
