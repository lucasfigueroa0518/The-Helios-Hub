/**
 * AI Trivia ideas (CONTRACT.md §5 row A), offline: the content map, the
 * validator, the daily writer, the pool cap and the builder's fact-check
 * loop. PGlite via the stories harness; Sonnet, Jev, the photo finder and the
 * music pick are stubs. No live call of any kind.
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
import { cellState, closeCell, reserveCell } from '@/lib/stories/trivia/cells';
import { runTriviaDaily } from '@/lib/stories/trivia/daily';
import { allCells, ANGLES, cellOf, THEMES } from '@/lib/stories/trivia/map';
import { TRIVIA_CHECK, TRIVIA_WRITE, type TriviaWriteItem } from '@/lib/stories/trivia/prompts';
import { SCORECARD, TRIVIA_SCORE } from '@/lib/stories/trivia/questions';
import { triviaPoolKey, triviaScore, type TriviaMusic, type TriviaPoolPayload, type TriviaQuestion } from '@/lib/stories/trivia/types';
import { validateQuestion } from '@/lib/stories/trivia/validate';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

const NOW = new Date('2026-11-10T08:30:00Z'); // 3:30 AM New York
const DATE = '2026-11-10';
const MUSIC: TriviaMusic = { trackId: 'trk-1', url: 'https://music.test/1.mp3', bpm: 100, beatMs: [0, 600, 1200], startMs: 4000 };

const materialOf = (params: Record<string, unknown>) => {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
  return JSON.parse(m![1]!) as Record<string, unknown>;
};

const item = (cellId: string, o: Partial<TriviaWriteItem> = {}): TriviaWriteItem => ({
  cell_id: cellId,
  question: `Question for ${cellId}?`,
  difficulty: 'medium',
  options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }, { letter: 'C', text: 'Three' }],
  correct: 'B',
  answer_line: 'Why it matters to you.',
  photo_kind: 'thematic',
  photo_name: '',
  photo_subject: 'a server room',
  answer_photo_kind: 'thematic',
  answer_photo_name: '',
  answer_photo_subject: 'a phone screen',
  sources: ['https://source.test/a'],
  score: { surprise: 0.7, about_you: 0.6, social_currency: 0.5 },
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
  const p: TriviaPoolPayload = { kind: 'trivia', q: question(cellId), jevScore: { surprise: score, about_you: score, social_currency: score }, score, writtenOn: DATE };
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

/* ── Validator ────────────────────────────────────────────────────── */

test('validator: option count follows difficulty; no !, no emoji, limits, known open cell', () => {
  const ctx = { offered: new Set(['t01a01', 't02a02']), open: new Set(['t01a01']) };
  assert.equal(validateQuestion(item('t01a01'), ctx).ok, true);
  const problems = (o: Partial<TriviaWriteItem>, cell = 't01a01') => {
    const v = validateQuestion(item(cell, o), ctx);
    return v.ok ? [] : v.problems;
  };
  assert.match(problems({ question: 'Guess what!' }).join(), /exclamation/);
  assert.match(problems({ answer_line: 'Big news 🤖' }).join(), /emoji/);
  assert.match(problems({ options: [{ letter: 'A', text: 'Yes 🎯' }, { letter: 'B', text: 'No' }, { letter: 'C', text: 'Maybe' }] }).join(), /emoji/);
  assert.match(problems({ difficulty: 'hard' }).join(), /3 for hard \(needs 2\)/);
  assert.match(problems({ difficulty: 'easy' }).join(), /3 for easy \(needs 4\)/);
  assert.match(problems({ correct: 'D' }).join(), /correct: D/);
  assert.match(problems({ question: 'x'.repeat(111) }).join(), /max 110/);
  assert.match(problems({ options: [{ letter: 'A', text: 'x'.repeat(33) }, { letter: 'B', text: 'Two' }, { letter: 'C', text: 'Three' }] }).join(), /max 32/);
  assert.match(problems({ answer_line: 'x'.repeat(121) }).join(), /max 120/);
  assert.match(problems({ question: 'AI TRIVIA: what year?' }).join(), /fixed copy/);
  assert.match(problems({}, 't02a02').join(), /not open/);
  assert.match(problems({}, 't09a09').join(), /not one of the cells offered/);
  assert.match(problems({ score: { surprise: 1.4, about_you: 0.5, social_currency: 0.5 } }).join(), /score.surprise/);
  const hard = validateQuestion(item('t01a01', { difficulty: 'hard', options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }] }), ctx);
  assert.equal(hard.ok, true);
});

/* ── Prompts and registry ─────────────────────────────────────────── */

test('prompts: registered, GTN gone, scorecard wording shared with Jev, no fixed copy', () => {
  const ids = STORIES_PROMPTS.map((p) => p.id);
  assert.ok(ids.includes('trivia-write@1') && ids.includes('trivia-check@1'));
  assert.ok(!ids.some((id) => id.startsWith('gtn-')));
  const sets = STORIES_QUESTION_SETS.map((s) => s.version);
  assert.ok(sets.includes('trivia-score@1'));
  assert.ok(!sets.some((v) => v.startsWith('gtn-')));
  for (const k of ['surprise', 'about_you', 'social_currency'] as const) {
    assert.ok(TRIVIA_WRITE.system.includes(SCORECARD[k].instructions), `writer carries ${k}`);
    assert.ok(String(TRIVIA_SCORE.questions[k].instructions).includes(SCORECARD[k].instructions), `Jev carries ${k}`);
  }
  assert.match(TRIVIA_WRITE.system, /hard: exactly 2 options[\s\S]*medium: exactly 3 options[\s\S]*easy: exactly 4 options/);
  const own = TRIVIA_WRITE.system.split('<humanizer>')[0]!;
  assert.ok(!own.includes('!'), 'no exclamation mark in the writer prompt');
  assert.ok(!/AI TRIVIA|Tap to reveal/.test(own), 'the writer never sees the fixed copy');
  assert.ok(!TRIVIA_CHECK.system.includes('!'));
});

/* ── Daily writer ─────────────────────────────────────────────────── */

test('runTriviaDaily: one writer call on 12 open cells; 3 pool rows, 3 cells reserved; !, emoji and wrong option count rejected', async () => {
  const { db } = await harnessDb();
  await closeCell(db, 't01a01'); // a posted cell is never offered
  let offered: string[] = [];
  const write = stubWriter({
    submit_trivia: (params) => {
      offered = (materialOf(params).cells as Array<{ cell_id: string }>).map((c) => c.cell_id);
      const [a, b, c, d, e, f] = offered;
      return {
        questions: [
          item(a!),
          item(b!, { question: 'Can you believe this!' }),
          item(c!, { answer_line: 'Wild 🤯' }),
          item(d!, { difficulty: 'hard' }),
          item(e!, { difficulty: 'easy', correct: 'D', options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }, { letter: 'C', text: 'Three' }, { letter: 'D', text: 'Four' }] }),
          item(f!, { difficulty: 'hard', correct: 'A', options: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }] }),
        ],
      };
    },
  });
  const jevStub = stubJev((k) => ({ surprise: 0.9, about_you: 0.3, social_currency: 0.6 })[k] ?? 0);
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
  assert.ok(!JSON.stringify(call.system).includes(offered[0]!), 'per-day cells stay out of the cached system prompt');

  assert.equal(r.pooled.length, 3);
  assert.deepEqual(r.rejected.map((x) => x.cellId), [offered[1], offered[2], offered[3]]);
  assert.match(r.rejected[0]!.problems.join(), /exclamation/);
  assert.match(r.rejected[1]!.problems.join(), /emoji/);
  assert.match(r.rejected[2]!.problems.join(), /needs 2/);

  const { rows } = await db.query<{ key: string; origin: string; score: string; payload: TriviaPoolPayload }>(`SELECT key, origin, score, payload FROM stories.pool WHERE series = 'ai_trivia' ORDER BY key`);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((x) => x.key).sort(), [offered[0], offered[4], offered[5]].map((c) => `trivia:${c}`).sort());
  const expected = triviaScore({ surprise: 0.7, about_you: 0.6, social_currency: 0.5 }, { surprise: 0.9, about_you: 0.3, social_currency: 0.6 });
  for (const row of rows) {
    assert.equal(row.origin, 'model');
    assert.equal(Number(row.score), expected);
    assert.equal(row.payload.kind, 'trivia');
    assert.deepEqual(row.payload.jevScore, { surprise: 0.9, about_you: 0.3, social_currency: 0.6 });
    assert.equal(await cellState(db, row.key), 'reserved');
  }
  for (const c of [offered[1], offered[2], offered[3]]) assert.equal(await cellState(db, c!), 'open');
  assert.equal(jevStub.calls.length, 3);
  assert.deepEqual(jevStub.calls[0]!.keys, ['surprise', 'about_you', 'social_currency']);
  const { rows: costs } = await db.query<{ component: string }>(`SELECT DISTINCT component FROM stories.cost_events ORDER BY component`);
  assert.deepEqual(costs.map((c) => c.component), ['trivia-score', 'trivia-write']);

  // Once per pool day.
  const again = await runTriviaDaily({ db, jev: createStoriesJev(jevStub, db), write, settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(again.ran, false);
  assert.equal(write.calls.length, 1);
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

test('buildAiTrivia: a failed fact-check archives the top row and frees its cell; the next passes → 2 frames', async () => {
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
  const r = await buildAiTrivia(deps, { music: async () => MUSIC });
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
  assert.ok(r.frames[0]!.photo && r.frames[1]!.photo && r.frames[0]!.photo.src !== r.frames[1]!.photo.src);
  const trivia = r.payload.trivia as { q: TriviaQuestion; factCheck: { verdict: string }; music: TriviaMusic; scores: { score: number } };
  assert.equal(trivia.q.cellId, 't04a02');
  assert.equal(trivia.factCheck.verdict, 'pass');
  assert.deepEqual(trivia.music, MUSIC);
  assert.equal(trivia.scores.score, 0.8);
  assert.deepEqual(r.historyKeys, ['trivia:t04a02']);
  assert.deepEqual(r.candidates.map((c) => [c.ref, c.chosen, c.reason]), [['trivia:t03a05', false, 'fact-check fail'], ['trivia:t04a02', true, null]]);
});

test('buildAiTrivia: slide 2 reuses slide 1 photo when nothing fits the answer', async () => {
  const { db } = await harnessDb();
  await poolRow(db, 't05a16', 0.7);
  const deps = await trivDeps(db, stubWriter({ submit_check: () => ({ verdict: 'pass', problems: [], sources: [] }) }));
  deps.photos = stubPhotos((req) => (req.query === 'a server room' ? { src: 'https://photos.test/q.jpg', credit: 'Photo', kind: 'scene' } : null));
  const r = await buildAiTrivia(deps, { music: async () => MUSIC });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.frames[1]!.photo?.src, 'https://photos.test/q.jpg');
});

test('buildAiTrivia: nothing passes in 5 tries → skipped with triviaSkip; a pass that lists problems is a fail', async () => {
  const { db } = await harnessDb();
  for (const [i, c] of ['t01a02', 't01a03', 't01a04', 't01a05', 't01a06', 't01a07'].entries()) await poolRow(db, c, 0.9 - i / 100);
  const write = stubWriter({ submit_check: () => ({ verdict: 'pass', problems: ['Option C is also arguably right.'], sources: [] }) });
  const deps = await trivDeps(db, write);
  const r = await buildAiTrivia(deps, { music: async () => MUSIC });
  assert.equal(r.ok, false);
  assert.equal(write.calls.length, MAX_CHECKS);
  const { rows } = await db.query<{ skip: { tried: unknown[] } }>(`SELECT payload->'triviaSkip' AS skip FROM stories.sets WHERE id = $1`, [deps.setId]);
  assert.equal(rows[0]!.skip.tried.length, 5);
  assert.equal(await cellState(db, 't01a07'), 'reserved', 'the sixth is never tried');
  assert.equal((await db.query(`SELECT 1 FROM stories.trivia_archive`)).rows.length, 5);
  assert.deepEqual(toFactCheck({ verdict: 'fail', problems: [], sources: [] }).problems, ['verdict fail']);
});
