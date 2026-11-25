/**
 * AI Trivia's opponent (AT-74, AT-75): GPT-5 nano answers each question once, with no web search, and must
 * pick; if OpenAI stops serving it, Llama 3.1 8B on fal answers instead. The build leans the day's pick so the
 * AI wins about half the time. The slide names it before the reveal and turns the name into its result after;
 * the critter celebrates or deflates. The endpoints are stubs: no live calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { askOpponent, modelGone, OpponentHttpError, OPPONENTS, type OpponentClient } from '@/lib/stories/trivia/opponent';
import { answerTop, leanFrom, leanOrder, recentAiResults } from '@/lib/stories/trivia/lean';
import { compositionHtml, copyProblems } from '@/lib/stories/trivia/render/clip';
import { critterData, critterProblems, outcomeBeats, type CritterDirection } from '@/lib/stories/trivia/render/critter';
import { defaultDirection, DIRECT_HANDS, DIRECT_HEADS, directionFrom } from '@/lib/stories/trivia/direction';
import { answerTimeline, CLIP_S, REVEAL_S, SEAM_T } from '@/lib/stories/trivia/render/timeline';
import type { TriviaOption, TriviaPoolPayload } from '@/lib/stories/trivia/types';

import { harnessDb } from './stories-harness';

const OPTIONS: TriviaOption[] = [{ letter: 'A', text: 'About 3 minutes' }, { letter: 'B', text: 'About 3 seconds' }, { letter: 'C', text: 'About 30 seconds' }];
const QUESTION = 'About how much recorded audio does a decent voice clone need?';

/** One reply per call, in order: a letter (OpenAI tool call or fal text), a refusal, or a thrown error. */
type Reply = { choice?: string; refusal?: boolean; text?: string } | Error;
type Call = { via: 'openai' | 'fal'; body: Record<string, unknown> };
function stubClient(replies: Reply[]): OpponentClient & { calls: Call[] } {
  const calls: Call[] = [];
  const next = () => {
    const r = replies[calls.length - 1]!;
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    calls,
    openai: async (body) => {
      calls.push({ via: 'openai', body });
      const r = next();
      return {
        choices: [{ message: r.refusal ? { refusal: 'no' } : { tool_calls: r.choice === undefined ? [] : [{ function: { name: 'answer', arguments: JSON.stringify({ choice: r.choice }) } }] } }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      };
    },
    fal: async (body) => {
      calls.push({ via: 'fal', body });
      const r = next();
      return { output: r.text ?? r.choice ?? '' };
    },
  };
}
const quiet = () => {};

async function costRows(db: Awaited<ReturnType<typeof harnessDb>>['db']) {
  const { rows } = await db.query<{ vendor: string; component: string; model: string; usd: number }>(`SELECT vendor, component, model, usd::float8 AS usd FROM stories.cost_events ORDER BY created_at`);
  return rows;
}

test('askOpponent: one GPT-5 nano call, no web search, a forced strict answer tool, minimal reasoning; its pick and a cost row at its rates', async () => {
  const { db } = await harnessDb();
  const client = stubClient([{ choice: 'A' }]);
  const o = await askOpponent({ client, db, setId: null, question: QUESTION, options: OPTIONS, log: quiet });
  assert.deepEqual(o, { model: 'gpt-5-nano', label: 'GPT-5 nano', picked: 'A' });
  assert.equal(client.calls.length, 1, 'one opportunity');
  const { via, body } = client.calls[0]!;
  assert.equal(via, 'openai');
  assert.equal(body.model, 'gpt-5-nano');
  const tools = body.tools as Array<{ type: string; function: { name: string; strict: boolean; parameters: { properties: { choice: { enum: string[] } } } } }>;
  assert.equal(tools.length, 1);
  assert.equal(tools[0]!.type, 'function', 'no web search tool');
  assert.equal(tools[0]!.function.name, 'answer');
  assert.equal(tools[0]!.function.strict, true);
  assert.deepEqual(tools[0]!.function.parameters.properties.choice.enum, ['A', 'B', 'C']);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'answer' } });
  assert.equal(body.reasoning_effort, 'minimal');
  const [sys, user] = body.messages as Array<{ role: string; content: string }>;
  assert.equal(sys!.role, 'system');
  assert.match(sys!.content, /cannot look anything up/);
  assert.match(sys!.content, /must choose exactly one/);
  assert.equal(user!.content, `${QUESTION}\n\nA. About 3 minutes\nB. About 3 seconds\nC. About 30 seconds`);
  const rows = await costRows(db);
  assert.deepEqual(rows.map((r) => [r.vendor, r.component, r.model]), [['openai', 'trivia-opponent', 'gpt-5-nano']]);
  assert.ok(Math.abs(rows[0]!.usd - (200 * 0.05 + 30 * 0.4) / 1e6) < 1e-9);
});

test('askOpponent: a refusal, no tool call, a letter off the options, or a busy or broken endpoint → no answer, never a second try', async () => {
  const { db } = await harnessDb();
  for (const reply of [{ refusal: true }, {}, { choice: 'D' }, new OpponentHttpError(429, 'rate limited'), new OpponentHttpError(500, 'server error'), new OpponentHttpError(401, 'no key'), new Error('socket hang up')] as Reply[]) {
    const client = stubClient([reply, { choice: 'B' }]);
    assert.equal(await askOpponent({ client, db, setId: null, question: QUESTION, options: OPTIONS, log: quiet }), null);
    assert.equal(client.calls.length, 1, 'no retry and no switch');
  }
});

test('askOpponent: when OpenAI stops serving GPT-5 nano, Llama 3.1 8B on fal answers (one letter), labelled and costed as Llama', async () => {
  const { db } = await harnessDb();
  const lines: string[] = [];
  const client = stubClient([new OpponentHttpError(404, '{"error":{"code":"model_not_found"}}'), { text: 'B.' }]);
  const o = await askOpponent({ client, db, setId: null, question: QUESTION, options: OPTIONS, log: (l) => lines.push(l) });
  assert.deepEqual(o, { model: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', picked: 'B' });
  assert.deepEqual(client.calls.map((c) => [c.via, c.body.model]), [['openai', 'gpt-5-nano'], ['fal', 'meta-llama/llama-3.1-8b-instruct']]);
  const fal = client.calls[1]!.body;
  assert.match(String(fal.system_prompt), /Reply with only the letter/);
  assert.equal(fal.prompt, `${QUESTION}\n\nA. About 3 minutes\nB. About 3 seconds\nC. About 30 seconds`);
  assert.ok(lines.some((l) => /gpt-5-nano unavailable, answered with meta-llama\/llama-3.1-8b-instruct/.test(l)), 'the switch is in the log');
  assert.deepEqual((await costRows(db)).map((r) => [r.vendor, r.model]), [['fal', 'meta-llama/llama-3.1-8b-instruct']]);
  assert.deepEqual(OPPONENTS.map((m) => m.model), ['gpt-5-nano', 'meta-llama/llama-3.1-8b-instruct']);
});

test('modelGone: a 404, a 400 naming a retired model, or fal dropping the model; a bad parameter, a 429 or a 500 is not', () => {
  assert.equal(modelGone(new OpponentHttpError(404, 'not found')), true);
  assert.equal(modelGone(new OpponentHttpError(400, 'The model `gpt-5-nano` has been deprecated')), true);
  assert.equal(modelGone(new OpponentHttpError(400, '{"error":{"code":"model_not_found"}}')), true);
  assert.equal(modelGone(new OpponentHttpError(422, '{"detail":[{"type":"literal_error","loc":["body","model"],"msg":"Input should be ..."}]}')), true);
  assert.equal(modelGone(new OpponentHttpError(422, '{"detail":[{"msg":"0 endpoints out of 1 requested are available"}]}')), true);
  assert.equal(modelGone(new OpponentHttpError(400, 'Unsupported value: reasoning_effort')), false);
  assert.equal(modelGone(new OpponentHttpError(422, '{"detail":[{"loc":["body","prompt"],"msg":"Field required"}]}')), false);
  assert.equal(modelGone(new OpponentHttpError(429, 'model overloaded')), false);
  assert.equal(modelGone(new Error('socket hang up')), false);
});

/* ── The lean (AT-75) ─────────────────────────────────────────────── */

const poolQ = (cellId: string, correct: 'A' | 'B' | 'C', aiPicked?: 'A' | 'B' | 'C'): TriviaPoolPayload => ({
  kind: 'trivia', q: { cellId, question: `Q ${cellId}?`, options: OPTIONS, correct } as TriviaPoolPayload['q'], jevScore: {} as TriviaPoolPayload['jevScore'], score: 0.9, writtenOn: '2026-11-16',
  ...(aiPicked ? { opponent: { model: 'gpt-5-nano', label: 'GPT-5 nano', picked: aiPicked } } : {}),
});

test('leanFrom: winning more than half → prefer a miss; less → prefer a hit; on target or no history → score order', () => {
  assert.equal(leanFrom([]), null);
  assert.equal(leanFrom([true, true, true, false, false, false]), null);
  assert.equal(leanFrom([true, true, true, true, false, false]), 'miss');
  assert.equal(leanFrom([true]), 'miss');
  assert.equal(leanFrom([false, false, true]), 'hit');
});

test('leanOrder: only the top 3 move; matching first, each group in score order; unknown answers never match', () => {
  const pool = [poolQ('t1', 'A', 'A'), poolQ('t2', 'A', 'B'), poolQ('t3', 'A'), poolQ('t4', 'A', 'C'), poolQ('t5', 'A', 'B')];
  const ids = (l: TriviaPoolPayload[]) => l.map((p) => p.q.cellId);
  assert.deepEqual(ids(leanOrder(pool, null)), ['t1', 't2', 't3', 't4', 't5']);
  assert.deepEqual(ids(leanOrder(pool, 'miss')), ['t2', 't1', 't3', 't4', 't5'], 't4 is a miss but below the top 3');
  assert.deepEqual(ids(leanOrder(pool, 'hit')), ['t1', 't2', 't3', 't4', 't5']);
  assert.deepEqual(ids(leanOrder([poolQ('t2', 'A', 'B'), poolQ('t3', 'A'), poolQ('t1', 'A', 'A')], 'hit')), ['t1', 't2', 't3']);
});

test('answerTop: asks only the top 3 that have no answer, once each, and stores the answer on its pool row', async () => {
  const { db } = await harnessDb();
  const pool = [poolQ('t01a01', 'A', 'B'), poolQ('t01a02', 'A'), poolQ('t01a03', 'B'), poolQ('t01a04', 'B')];
  for (const p of pool) await db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, score) VALUES ('ai_trivia', $1, 'model', $2, $3, $4::jsonb, 0.9)`, [`trivia:${p.q.cellId}`, p.q.cellId, p.q.question, JSON.stringify(p)]);
  const client = stubClient([{ choice: 'C' }, { choice: 'B' }]);
  const out = await answerTop({ db, setId: null, opponent: client, log: quiet }, pool);
  assert.equal(client.calls.length, 2, 'the stored answer is reused; the fourth is not asked');
  assert.deepEqual(out.map((p) => p.opponent?.picked ?? null), ['B', 'C', 'B', null]);
  const { rows } = await db.query<{ key: string; picked: string | null }>(`SELECT key, payload->'opponent'->>'picked' AS picked FROM stories.pool ORDER BY key`);
  assert.deepEqual(rows.map((r) => [r.key, r.picked]), [['trivia:t01a01', 'B'], ['trivia:t01a02', 'C'], ['trivia:t01a03', 'B'], ['trivia:t01a04', null]]);
  // A second build asks nothing: the answers come back from the rows.
  const again = stubClient([]);
  const reread = (await db.query<{ payload: TriviaPoolPayload }>(`SELECT payload FROM stories.pool ORDER BY key`)).rows.map((r) => r.payload);
  await answerTop({ db, setId: null, opponent: again, log: quiet }, reread.slice(0, 3));
  assert.equal(again.calls.length, 0);
});

test('recentAiResults: the last 6 shown sets with an opponent, newest first, not rejected or failed ones, not this set', async () => {
  const { db } = await harnessDb();
  const add = async (i: number, status: string, right: boolean | null) => {
    const trivia = { q: { correct: 'A' }, ...(right === null ? {} : { opponent: { picked: right ? 'A' : 'B' } }) };
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload, created_at) VALUES ('ai_trivia', $1, $2, 'click', 'polished', $3::jsonb, $4) RETURNING id`,
      [`2026-10-${String(i + 1).padStart(2, '0')}`, status, JSON.stringify({ trivia }), `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`],
    );
    return rows[0]!.id;
  };
  const statuses: Array<[string, boolean | null]> = [['published', true], ['published', false], ['rejected', true], ['published', null], ['ready', true], ['failed', false], ['published', true], ['approved', false], ['published', true], ['published', true]];
  const ids: string[] = [];
  for (const [i, [st, r]] of statuses.entries()) ids.push(await add(i, st, r));
  assert.deepEqual(await recentAiResults(db, null), [true, true, false, true, true, false]);
  assert.deepEqual(await recentAiResults(db, ids[9]!), [true, false, true, true, false, true]);
});

/* ── Render ───────────────────────────────────────────────────────── */

const COPY = { question: QUESTION, options: OPTIONS, correct: 'B' as const, answerLine: 'Three seconds gave an 85% match.' };
const DIRECTION: CritterDirection = {
  spot: 'sign-right',
  question: [{ at: 0, mood: 'happy' }],
  answer: [{ at: 0.2, mood: 'focused' }, { at: 0.5, mood: 'surprised' }, { at: 2, mood: 'proud' }],
};

test('the speech bubble: "<model> (no web search)" by the critter on both clips; clip 2 adds "<model> selected X", hidden until the hit', async () => {
  for (const [picked, cls, mark] of [['B', 'opp-post ok', 'M12 27'], ['A', 'opp-post no', 'M15 15']] as const) {
    const opponent = { label: 'GPT-5 nano', picked };
    const q = await compositionHtml({ role: 'question', ...COPY, opponent, questionPx: 66 });
    const a = await compositionHtml({ role: 'answer', ...COPY, opponent, questionPx: 66, linePx: 48 });
    for (const html of [q, a]) {
      assert.match(html, /id="tv-opp-pre" class="opp-pre bubble"><span class="opp-n">GPT-5 nano<\/span><span class="opp-t">\(no web search\)<\/span>/);
      assert.match(html, /--room:250px/, 'the room above the sign is kept for the label');
    }
    assert.doesNotMatch(q, /tv-opp-post/);
    assert.match(a, new RegExp(`id="tv-opp-post" class="${cls.replace('opp-post', 'opp-post bubble')}"`));
    assert.match(a, new RegExp(`<span class="opp-n">GPT-5 nano selected ${picked}</span>`));
    assert.match(a, new RegExp(mark));
  }
  assert.doesNotMatch(await compositionHtml({ role: 'answer', ...COPY, questionPx: 66, linePx: 48 }), /tv-opp/);
});

test('the swap: on the hit the name fades out and the result pops in; no opponent, no swap', () => {
  const t = answerTimeline(3, 1, true);
  const pre = t.find((x) => x.target === '#tv-opp-pre')!;
  const post = t.find((x) => x.target === '#tv-opp-post')!;
  assert.equal(pre.at, REVEAL_S);
  assert.deepEqual([pre.from, pre.to], [{ opacity: 1 }, { opacity: 0 }]);
  assert.equal(post.at, REVEAL_S);
  assert.equal(post.ease, 'pop');
  assert.deepEqual([post.from, post.to], [{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }]);
  assert.ok(!answerTimeline(3, 1).some((x) => String(x.target).startsWith('#tv-opp')));
});

test('the critter with an opponent: stands on sign-right; from the reveal it celebrates a right pick and deflates a wrong one', () => {
  assert.deepEqual(critterProblems(DIRECTION, CLIP_S, true), []);
  assert.match(critterProblems({ ...DIRECTION, spot: 'sign-left' }, CLIP_S, true).join(), /sign-right/);
  assert.deepEqual(critterProblems({ ...DIRECTION, spot: 'sign-left' }, CLIP_S), []);
  assert.match(copyProblems({ ...COPY, opponent: { label: 'GPT-5 nano', picked: 'D' as never } }).join(), /opponent picked D/);

  const answerOf = (outcome: 'right' | 'wrong' | null) => (JSON.parse(critterData(DIRECTION, 'answer', 1, outcome)) as { beats: Array<{ at: number; mood?: string; state?: string }> }).beats.filter((b) => b.at > SEAM_T).map((b) => ({ ...b, at: Math.round((b.at - SEAM_T) * 1000) / 1000 }));
  assert.deepEqual(answerOf(null).map((b) => b.mood), ['focused', 'surprised', 'proud'], 'no opponent: the direction as written');
  const right = answerOf('right');
  assert.deepEqual(right.map((b) => [b.at, b.mood ?? b.state]), [[0.2, 'focused'], [REVEAL_S, 'done'], [outcomeBeats('right')[1]!.at, 'happy']]);
  const wrong = answerOf('wrong');
  assert.deepEqual(wrong.map((b) => [b.at, b.mood ?? b.state]), [[0.2, 'focused'], [REVEAL_S, 'worried'], [outcomeBeats('wrong')[1]!.at, 'sleepy']]);
});

test('every question has a critter: a built or default direction passes the rules, with only kit pieces', async () => {
  const kit = (await import('@/lib/stories/trivia/render/kit/wear.js' as string)) as { HEADS: string[]; HANDS: string[] };
  assert.deepEqual([...DIRECT_HEADS], kit.HEADS);
  assert.deepEqual([...DIRECT_HANDS], kit.HANDS);
  for (const d of [defaultDirection(), directionFrom({ head: 'gradcap', hand: 'book', opening_mood: 'proud', pondering_mood: 'worried' }), directionFrom({ head: 'crown', hand: 'none' })]) {
    assert.deepEqual(critterProblems(d, CLIP_S, true), []);
    assert.deepEqual(critterProblems(d, CLIP_S), []);
    assert.ok(d.head || d.hand);
  }
});
