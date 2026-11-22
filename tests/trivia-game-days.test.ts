/**
 * The web game days (planning/AI Trivia/Game/HUB-PLAN.md): builder, lock, pull, launch date and the website export.
 * Offline: PGlite, the fact-check stubbed, opponent answers stored on the pool rows (no client is called).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import { exportAuthorized } from '@/lib/stories/trivia/export-auth';
import {
  buildGameDay, dayNumberOf, dayToBuild, exportDay, exportDays, GAME_LAUNCH_KEY, lockDue, pullQuestion, readDay, readLaunch, saveLaunch,
} from '@/lib/stories/trivia/game-days';
import type { Letter, TriviaPoolPayload } from '@/lib/stories/trivia/types';

import { harnessDb, stubWriter } from './stories-harness';

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

const LAUNCH = '2026-11-18';
// 2026-11-17 10:00 New York: tomorrow (the launch day) is buildable, not yet lockable.
const MORNING = new Date('2026-11-17T15:00:00Z');
// 2026-11-17 23:05 New York: tomorrow locks.
const NIGHT = new Date('2026-11-18T04:05:00Z');

const sc = (v: number) => ({ clear: v, real_guess: v, point: v, worth_knowing: v });

async function addQ(db: Db, cellId: string, score: number, picked: Letter | null, ease = 0.7): Promise<string> {
  const key = `trivia:${cellId}:1`;
  const p: TriviaPoolPayload = {
    kind: 'trivia',
    q: {
      cellId, n: 1, question: `Question ${cellId}?`, correct: 'B', answerLine: `Why ${cellId} matters.`, sources: ['https://source.test/a'],
      options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }, { letter: 'C', text: 'Three' }],
      writerScore: { ...sc(0.6), clear: ease, real_guess: ease },
    },
    jevScore: { ...sc(0.6), clear: ease, real_guess: ease }, score, writtenOn: '2026-11-17',
    ...(picked ? { opponent: { model: 'gpt-5-nano', label: 'GPT-5 nano', picked } } : {}),
  };
  await db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, score) VALUES ('ai_trivia', $1, 'model', $2, $3, $4::jsonb, $5)`, [key, cellId, p.q.question, JSON.stringify(p), score]);
  return key;
}

const checker = (fail: Set<string> = new Set()) => stubWriter({
  submit_check: (params) => {
    // The question under check only (the material's asked list names other questions too).
    const text = String((params.messages as Array<{ content: string }>)[0]!.content);
    const m = JSON.parse(/<material>\n([\s\S]*)\n<\/material>/.exec(text)![1]!) as { question: string };
    const bad = [...fail].some((c) => m.question === `Question ${c}?`);
    return bad ? { verdict: 'fail', problems: ['wrong fact'], sources: [] } : { verdict: 'pass', problems: [], sources: ['https://check.test/x'] };
  },
});

const deps = (db: Db, write: ReturnType<typeof stubWriter>, now = MORNING) => ({ db, write, settings: DEFAULT_SETTINGS, now, log: () => {} });

async function seeded() {
  const { db } = await harnessDb();
  await saveLaunch(db, LAUNCH);
  // 4 the AI gets right (picked B), 3 it gets wrong; scores descending in the order added.
  const right = [await addQ(db, 't01a01', 0.95, 'B', 0.5), await addQ(db, 't02a01', 0.9, 'B', 0.9), await addQ(db, 't03a01', 0.85, 'B'), await addQ(db, 't04a01', 0.8, 'B')];
  const wrong = [await addQ(db, 't05a01', 0.75, 'A', 0.95), await addQ(db, 't06a01', 0.7, 'C'), await addQ(db, 't07a01', 0.65, 'A')];
  return { db, right, wrong };
}

test('launch date: Day 1 is the launch date; dayNumberOf counts New York dates', async () => {
  const { db } = await harnessDb();
  assert.equal(await readLaunch(db), null);
  await saveLaunch(db, LAUNCH);
  assert.equal(await readLaunch(db), LAUNCH);
  assert.equal(dayNumberOf(LAUNCH, LAUNCH), 1);
  assert.equal(dayNumberOf(LAUNCH, '2026-12-01'), 14);
  await assert.rejects(() => saveLaunch(db, '11/18/2026'));
  const { rows } = await db.query<{ key: string }>(`SELECT key FROM stories.settings WHERE key = $1`, [GAME_LAUNCH_KEY]);
  assert.equal(rows.length, 1);
});

test('dayToBuild: tomorrow after 3:30 once launched; today only when it is the launch day', async () => {
  const { db } = await harnessDb();
  assert.equal(await dayToBuild(db, LAUNCH, MORNING), LAUNCH);
  assert.equal(await dayToBuild(db, LAUNCH, new Date('2026-11-17T07:00:00Z')), null, '2 am: before the builder starts');
  assert.equal(await dayToBuild(db, '2026-11-17', MORNING), '2026-11-17', 'launch today: today is built');
  assert.equal(await dayToBuild(db, '2026-11-25', MORNING), null);
});

test('build: 5 questions aiming for the AI right on 4 (3 when a right one fails the check), easiest first, reserved from the story; a fact-check fail is archived', async () => {
  const { db, right, wrong } = await seeded();
  const write = checker(new Set(['t02a01']));
  const r = await buildGameDay(deps(db, write), LAUNCH, LAUNCH);
  assert.deepEqual(r, { date: LAUNCH, dayNumber: 1, questions: 5, aiRight: 3, checks: 6, balanced: false });
  const day = (await readDay(db, LAUNCH))!;
  assert.equal(day.status, 'draft');
  const keys = day.questions.map((q) => q.key);
  assert.equal(keys.length, 5);
  assert.ok(!keys.includes(right[1]!), 'the failed question is not in the day');
  assert.equal(keys[0], wrong[0], 'the easiest (highest fair-shot) question first');
  const arch = await db.query(`SELECT 1 FROM stories.trivia_archive WHERE key = $1`, [right[1]]);
  assert.equal(arch.rows.length, 1);
  const used = await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'ai_trivia' AND used_at IS NOT NULL ORDER BY key`);
  assert.deepEqual(used.rows.map((x) => x.key).sort(), [...keys].sort(), 'only the chosen five are reserved');
  const cost = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events`);
  assert.deepEqual(cost.rows.map((x) => x.component), ['trivia-game-check'], 'costs count toward AI Trivia (trivia- prefix)');
  // A second pass with no helpful candidate left spends nothing.
  const again = await buildGameDay(deps(db, write), LAUNCH, LAUNCH);
  assert.equal((again as { checks: number }).checks, 6);
  assert.equal(write.calls.length, 6);
});

test('lock: not before 11 pm the night before; then locked and exported in the contract', async () => {
  const { db } = await seeded();
  await buildGameDay(deps(db, checker()), LAUNCH, LAUNCH);
  assert.deepEqual(await lockDue(db, MORNING), { locked: [], missed: [], served: [] });
  assert.deepEqual((await exportDays(db, null)).days, []);
  assert.deepEqual(await lockDue(db, NIGHT), { locked: [LAUNCH], missed: [], served: [] });
  const { days } = await exportDays(db, null);
  assert.equal(days.length, 1);
  const d = days[0]!;
  assert.equal(d.dayNumber, 1);
  assert.equal(d.nyDate, LAUNCH);
  assert.deepEqual(d.questions.map((q) => q.position), [1, 2, 3, 4, 5]);
  for (const q of d.questions) {
    assert.deepEqual(q.options.map((o) => o.letter), ['A', 'B', 'C']);
    assert.ok(['A', 'B', 'C'].includes(q.correct) && ['A', 'B', 'C'].includes(q.ai.picked));
    assert.equal(q.ai.model, 'gpt-5-nano');
    assert.equal(q.ai.label, 'GPT-5 nano (no web search)');
    assert.ok(q.question && q.answerLine && Array.isArray(q.sources) && q.sources.length);
    assert.match(q.id, /^d1-t\d\da\d\d-1$/);
  }
  assert.equal(new Set(d.questions.map((q) => q.id)).size, 5);
  assert.equal(d.questions.filter((q) => q.ai.picked === q.correct).length, 4);
  assert.deepEqual((await exportDays(db, LAUNCH)).days, [], 'after= is exclusive');
  assert.equal((await exportDays(db, '2026-11-17')).days.length, 1);
  await assert.rejects(() => pullQuestion(db, LAUNCH, d.questions[0]!.id, null), /locked/);
  await assert.rejects(() => saveLaunch(db, '2026-11-20'), /already locked/);
});

test('pull: the question is archived and leaves the pool; the next pass fills the gap', async () => {
  const { db } = await seeded();
  await addQ(db, 't08a01', 0.6, 'A');
  const first = await buildGameDay(deps(db, checker()), LAUNCH, LAUNCH);
  assert.equal((first as { aiRight: number }).aiRight, 4, 'all pass: the AI is right on 4 of 5');
  const day = (await readDay(db, LAUNCH))!;
  const gone = day.questions[2]!.key;
  const after = await pullQuestion(db, LAUNCH, gone, 'lucas@test');
  assert.equal(after.questions.length, 4);
  assert.equal((await db.query(`SELECT 1 FROM stories.pool WHERE key = $1`, [gone])).rows.length, 0);
  assert.equal((await db.query(`SELECT 1 FROM stories.trivia_archive WHERE key = $1`, [gone])).rows.length, 1);
  const r = await buildGameDay(deps(db, checker()), LAUNCH, LAUNCH);
  assert.equal((r as { questions: number }).questions, 5);
  assert.ok(!(await readDay(db, LAUNCH))!.questions.some((q) => q.key === gone));
});

test('a past day still short is released and logged as missed, never exported', async () => {
  const { db } = await harnessDb();
  await saveLaunch(db, '2026-11-16');
  await addQ(db, 't01a01', 0.9, 'B');
  await buildGameDay(deps(db, checker(), new Date('2026-11-16T15:00:00Z')), '2026-11-16', '2026-11-16');
  const out = await lockDue(db, MORNING);
  assert.deepEqual(out, { locked: [], missed: ['2026-11-16'], served: [] });
  const open = await db.query(`SELECT 1 FROM stories.pool WHERE used_at IS NULL`);
  assert.equal(open.rows.length, 1, 'its question is offered again');
  assert.deepEqual((await exportDays(db, null)).days, []);
});

test('exportDay refuses a day the website would reject', () => {
  const g = (picked: Letter | null) => ({
    key: 'trivia:t01a01:1', factCheck: { verdict: 'pass' as const, problems: [], sources: [] },
    payload: { kind: 'trivia', q: { cellId: 't01a01', question: 'Q?', options: [{ letter: 'A', text: 'a' }, { letter: 'B', text: 'b' }, { letter: 'C', text: 'c' }], correct: 'A', answerLine: 'x', sources: [] }, ...(picked ? { opponent: { model: 'm', label: 'M', picked } } : {}) } as unknown as TriviaPoolPayload,
  });
  assert.equal(exportDay({ day_number: 1, ny_date: LAUNCH, questions: [g('A'), g('A'), g('A'), g('A')] }), null, 'four questions');
  assert.equal(exportDay({ day_number: 1, ny_date: LAUNCH, questions: [g('A'), g('A'), g('A'), g('A'), g(null)] }), null, 'no AI pick');
  assert.ok(exportDay({ day_number: 1, ny_date: LAUNCH, questions: [g('A'), g('A'), g('A'), g('A'), g('B')] }));
});

test('export token: Bearer only, constant-time, refused when unset', () => {
  assert.equal(exportAuthorized('Bearer abc', 'abc'), true);
  assert.equal(exportAuthorized('Bearer abd', 'abc'), false);
  assert.equal(exportAuthorized('abc', 'abc'), false);
  assert.equal(exportAuthorized(null, 'abc'), false);
  assert.equal(exportAuthorized('Bearer abc', undefined), false);
  assert.equal(exportAuthorized('Bearer ', ''), false);
});

test('served: once a locked day has passed, its questions go back to the IG pool once, and the game never serves them again', async () => {
  const { db } = await seeded();
  await buildGameDay(deps(db, checker()), LAUNCH, LAUNCH);
  await lockDue(db, NIGHT);
  const keys = (await db.query<{ key: string }>(`SELECT key FROM stories.pool WHERE series = 'ai_trivia' AND used_at IS NOT NULL`)).rows.map((r) => r.key);
  assert.equal(keys.length, 5);
  const DAY_AFTER = new Date('2026-11-19T15:00:00Z');
  assert.deepEqual((await lockDue(db, DAY_AFTER)).served, [LAUNCH]);
  const open = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE series = 'ai_trivia' AND key = ANY($1::text[]) AND used_at IS NULL`, [keys]);
  assert.equal(open.rows[0]!.n, 5, 'served questions are open for stories');
  // A story uses one; the next pass must not hand it back again.
  await db.query(`UPDATE stories.pool SET used_at = now() WHERE series = 'ai_trivia' AND key = $1`, [keys[0]]);
  assert.deepEqual((await lockDue(db, DAY_AFTER)).served, []);
  const still = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.pool WHERE key = $1 AND used_at IS NOT NULL`, [keys[0]]);
  assert.equal(still.rows[0]!.n, 1);
  // The next game day skips every question the launch day served.
  await buildGameDay(deps(db, checker()), '2026-11-20', LAUNCH);
  const next = (await db.query<{ k: string }>(`SELECT q->>'key' AS k FROM stories.trivia_game_days d, jsonb_array_elements(d.questions) q WHERE d.ny_date = '2026-11-20'`)).rows.map((r) => r.k);
  assert.ok(next.every((k) => !keys.includes(k)), 'no served question is served again');
});

test('one fact, one question: a draft question repeating a served one is dropped and refilled; a repeat candidate is archived without a fact-check; old verdicts are checked again once', async () => {
  const { db, right } = await seeded();
  // A past locked day served the ELIZA question (handed back to the pool, open again).
  const eliza = await addQ(db, 't12a01', 0.99, 'B');
  const served = (await db.query<{ payload: TriviaPoolPayload }>(`SELECT payload FROM stories.pool WHERE key = $1`, [eliza])).rows[0]!.payload;
  served.q.question = 'The first chatbot, ELIZA, was built at MIT. In which decade?';
  served.q.options = [{ letter: 'A', text: '1950s' }, { letter: 'B', text: '1960s' }, { letter: 'C', text: '1980s' }];
  await db.query(`UPDATE stories.pool SET payload = $2::jsonb WHERE key = $1`, [eliza, JSON.stringify(served)]);
  await db.query(`INSERT INTO stories.trivia_game_days (day_number, ny_date, status, questions, log) VALUES (99, '2026-11-10', 'locked', $1::jsonb, '[]'::jsonb)`, [JSON.stringify([{ key: eliza, payload: served, factCheck: { verdict: 'pass', problems: [], sources: [] } }])]);
  // Two rewordings on other themes: one already in the draft (checked under the old lists), one waiting in the pool.
  const reword = async (cellId: string, text: string, score: number) => {
    const key = await addQ(db, cellId, score, 'B');
    const p = (await db.query<{ payload: TriviaPoolPayload }>(`SELECT payload FROM stories.pool WHERE key = $1`, [key])).rows[0]!.payload;
    p.q.question = text;
    p.q.options = served.q.options;
    await db.query(`UPDATE stories.pool SET payload = $2::jsonb WHERE key = $1`, [key, JSON.stringify(p)]);
    return { key, p };
  };
  const inDraft = await reword('t19a14', 'The first chatbot that held typed conversations with people was built in which decade?', 0.98);
  const waiting = await reword('t09a02', 'In which decade was the first chatbot built, at MIT?', 0.97);
  const old = { verdict: 'pass', problems: [], sources: [] };
  const draft = [inDraft, { key: right[0]!, p: (await db.query<{ payload: TriviaPoolPayload }>(`SELECT payload FROM stories.pool WHERE key = $1`, [right[0]])).rows[0]!.payload }];
  await db.query(`INSERT INTO stories.trivia_game_days (day_number, ny_date, status, questions, log) VALUES (1, $1::date, 'draft', $2::jsonb, '[]'::jsonb)`, [LAUNCH, JSON.stringify(draft.map((d) => ({ key: d.key, payload: d.p, factCheck: old })))]);
  await db.query(`UPDATE stories.pool SET used_at = now() WHERE key = ANY($1::text[])`, [draft.map((d) => d.key)]);

  const write = checker();
  const r = await buildGameDay(deps(db, write), LAUNCH, LAUNCH);
  assert.ok('questions' in r && r.questions === 5);
  const day = (await readDay(db, LAUNCH))!;
  const keys = day.questions.map((q) => q.key);
  assert.ok(!keys.includes(inDraft.key) && !keys.includes(waiting.key) && !keys.includes(eliza), 'no ELIZA repeat is played');
  const arch = (await db.query<{ key: string; reason: string }>(`SELECT key, reason FROM stories.trivia_archive ORDER BY key`)).rows;
  assert.deepEqual(arch.map((a) => a.key).sort(), [inDraft.key, waiting.key].sort());
  assert.ok(arch.every((a) => a.reason.includes('repeat: the same fact as trivia:')), JSON.stringify(arch));
  const checkedKeys = day.log.filter((l) => l.kind === 'check').map((l) => l.key);
  assert.ok(!checkedKeys.includes(inDraft.key) && !checkedKeys.includes(waiting.key), 'code repeats spend no fact-check');
  assert.ok(day.log.some((l) => l.kind === 'check' && l.key === right[0] && l.detail.startsWith('recheck pass')), 'the old verdict was checked again');
  assert.ok(day.questions.every((q) => q.factCheck.repeats === 2), 'every verdict is under the current repeat check');
  const calls = write.calls.length;
  await buildGameDay(deps(db, write), LAUNCH, LAUNCH);
  assert.equal(write.calls.length, calls, 'a full day is not checked again');
});
