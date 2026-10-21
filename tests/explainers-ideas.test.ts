/**
 * M3 idea pipeline, offline. Jev and the idea generator are stubbed with canned
 * answers; the real runner, question sets, SQL, and pool logic all run.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { analogyMarkdown, analogyTotal, pickAnalogy, topicAnalogy } from '@/lib/explainers/ideas/analogy';
import { addAndEvaluateTopics, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import {
  batchesOfFive,
  challengerWins,
  scoringCalls,
} from '@/lib/explainers/ideas/evaluate';
import {
  ANALOGIES_SCHEMA,
  ANALOGY_ASK,
  ANALOGY_LADDER,
  ANALOGY_WRITER_INSTRUCTIONS,
  ANALOGY_WRITER_VERSION,
  IDEAS_SCHEMA,
  IDEA_GENERATOR_INSTRUCTIONS,
  IDEA_GENERATOR_VERSION,
  SCOPE_WRITER_VERSION,
  REEL_SHAPE,
  SCOPES_SCHEMA,
  SCOPE_WRITER_INSTRUCTIONS,
  TERM_RULE,
  analogyWriterParams,
  ideaGeneratorParams,
  parseAnalogies,
  scopeWriterParams,
  structuredJson,
  parseIdeas,
  parseScopes,
  type IdeaModel,
} from '@/lib/explainers/ideas/generator';
import { getTopic, listPool, listTopics } from '@/lib/explainers/repository';
import { weightedScore } from '@/lib/explainers/scoring';
import { saveSetting } from '@/lib/explainers/settings';
import { ANALOGY_KEYS, type AnalogyCandidate, type AnalogyNote, type AnalogyScores, type IdeaScoreKey } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

type Scores = Record<IdeaScoreKey, number>;

const STRONG: Scores = {
  audience_fit: 4,
  teachability_45s: 4,
  analogy_potential: 4,
  visual_potential: 4,
  accuracy_under_simplification: 4,
  hook_strength: 3,
  ai_focus: 2,
};
const GOOD: Scores = { ...STRONG, hook_strength: 2, visual_potential: 3 };
const BROAD: Scores = { ...STRONG, teachability_45s: 0, accuracy_under_simplification: 1 };

type Call = { set: string; keys: string[]; state: Record<string, unknown> };

/** A candidate analogy for `title`, numbered 1 to 3. */
const candidate = (title: string, n: number): AnalogyCandidate => ({
  scene: `${title} scene ${n}`,
  elements: [{ name: `thing ${n}`, stands_for: 'the real part' }, { name: 'other', stands_for: 'another part' }],
  process: 'It happens in order.',
  payoff: 'It lands.',
  visual: 'It moves.',
  rung: ((n % 3) + 1) as 1 | 2 | 3,
  invented_rules: [],
  actor: n === 2 ? 'a student' : 'none',
  hook: `It is already moving ${n}.`,
  steps: [
    { analogy: 'first thing', technical: 'event fires' },
    { analogy: 'second thing', technical: 'request sent' },
    { analogy: 'third thing', technical: 'app updates' },
  ],
});

/**
 * Canned Jev. `scores` by topic title; `same` says whether two titles teach the
 * same takeaway (order-free); `analogy` scores a candidate analogy by its scene
 * (default 3 on every question). Every call is recorded for assertions.
 */
function stubJev(scores: Record<string, Scores>, same: [string, string][] = [], analogy: (scene: string) => number = () => 3) {
  const calls: Call[] = [];
  const isSame = (a: string, b: string) =>
    same.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const transport: JevTransport = {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const s = state as Record<string, any>;
      const keys = Object.keys(questions);
      const setId = keys[0].startsWith('pair_')
        ? 'pairs'
        : keys[0] === 'duplicate_of_existing_topic'
          ? 'gate'
          : (ANALOGY_KEYS as readonly string[]).includes(keys[0])
            ? 'analogy'
            : 'scoring';
      calls.push({ set: setId, keys, state: s });
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        if (setId === 'analogy') {
          answers[key] = { type: 'score', score: analogy((s.candidate as AnalogyCandidate).scene), confidence: 1 };
        } else if (setId === 'scoring') {
          const title = s.topic_title as string;
          answers[key] = { type: 'score', score: scores[title][key as IdeaScoreKey], confidence: 1 };
        } else if (setId === 'gate') {
          const title = s.candidate.topic_title as string;
          const yes = (s.history as { topic_title: string }[]).some((h) => isSame(title, h.topic_title));
          answers[key] = { type: 'noul', noul: yes ? 0.9 : 0.1 };
        } else {
          const yes = isSame(s.candidate.topic_title, s.incumbents[key].topic_title);
          answers[key] = { type: 'noul', noul: yes ? 0.9 : 0.1 };
        }
      }
      return {
        model: 'jev-stub',
        answers,
        usage: { input_tokens: 1000, output_tokens: 0 },
      } as unknown as SystemOneResult<Q>;
    },
  };
  return { transport, calls };
}

function stubIdeas(
  batches: [string, string][][] = [],
): IdeaModel & { requests: unknown[]; scopeRequests: string[][]; analogyRequests: string[] } {
  const requests: unknown[] = [];
  const scopeRequests: string[][] = [];
  const analogyRequests: string[] = [];
  return {
    requests,
    scopeRequests,
    analogyRequests,
    async writeAnalogies(request) {
      analogyRequests.push(request.title);
      return {
        candidates: [1, 2, 3].map((n) => candidate(request.title, n)),
        usage: { input_tokens: 300, output_tokens: 200 },
        model: 'claude-sonnet-5-5',
      };
    },
    async writeScopes(request) {
      scopeRequests.push([...request.titles]);
      return {
        scopes: request.titles.map((title) => `Explain ${title}.`),
        terms: request.titles.map((title) => title.toLowerCase()),
        usage: { input_tokens: 100, output_tokens: 40 },
        model: 'claude-sonnet-5-5',
      };
    },
    async propose(request) {
      requests.push(request);
      const next = batches.shift();
      if (!next) throw new Error('no canned ideas left');
      return {
        ideas: next.map(([topic_title, topic_scope]) => ({ topic_title, topic_scope, term: topic_title.toLowerCase() })),
        usage: { input_tokens: 200, output_tokens: 150, cache_read_input_tokens: 1200 },
        model: 'claude-sonnet-5-5',
      };
    },
  };
}

async function seedPool(db: ExplainersDb, entries: [string, Scores][]) {
  const scores = Object.fromEntries(entries);
  const { transport } = stubJev(scores);
  return addAndEvaluateTopics(
    { db, jevTransport: transport, ideaModel: stubIdeas() },
    entries.map(([title]) => ({ title, origin: 'manual' as const })),
  );
}

// ── Pure pieces ─────────────────────────────────────────────────────────────

test('each question sees only its E-15 state fields', () => {
  const noSource = scoringCalls({ title: 'T', scope: 'S', source_text: null }, 'BRIEF');
  assert.deepEqual(
    noSource.map((c) => [c.keys, Object.keys(c.state)]),
    [
      [['audience_fit'], ['topic_title', 'theme_brief']],
      [
        ['teachability_45s', 'analogy_potential', 'visual_potential', 'accuracy_under_simplification', 'hook_strength', 'ai_focus'],
        ['topic_title', 'topic_scope'],
      ],
    ],
  );
  const withSource = scoringCalls({ title: 'T', scope: 'S', source_text: 'notes' }, 'BRIEF');
  assert.deepEqual(
    withSource.map((c) => c.keys),
    [
      ['audience_fit'],
      ['teachability_45s', 'visual_potential', 'accuracy_under_simplification'],
      ['analogy_potential', 'hook_strength', 'ai_focus'],
    ],
  );
  assert.deepEqual(withSource[1].state.source_text, { untrusted_content: 'notes' });
});

test('batches of five and the head-to-head rule', () => {
  assert.deepEqual(batchesOfFive([1, 2, 3, 4, 5, 6, 7]).map((b) => b.length), [5, 2]);
  const base = { ...GOOD, weighted_score: 80 };
  assert.equal(challengerWins(base, base), false, 'exact tie keeps the incumbent');
  assert.equal(challengerWins({ ...base, weighted_score: 80.1 }, base), true);
  assert.equal(challengerWins({ ...base, teachability_45s: 3.5 }, base), false);
  assert.equal(
    challengerWins({ ...base, accuracy_under_simplification: 4, teachability_45s: 4 }, { ...base, teachability_45s: 4 }),
    false,
  );
});

test('generator output must be exactly three distinct ideas', () => {
  const ok = parseIdeas({ ideas: [{ topic_title: 'a', topic_scope: 'x', term: 'ta' }, { topic_title: 'b', topic_scope: 'y', term: 'tb' }, { topic_title: 'c', topic_scope: 'z', term: 'tc' }] });
  assert.deepEqual(ok.map((i) => i.term), ['ta', 'tb', 'tc']);
  assert.throws(() => parseIdeas({ ideas: [{ topic_title: 'a', topic_scope: 'x' }, { topic_title: 'b', topic_scope: 'y', term: 'tb' }, { topic_title: 'c', topic_scope: 'z', term: 'tc' }] }), /title, scope, or term/);
  assert.equal(ok.length, 3);
  assert.throws(() => parseIdeas({ ideas: [{ topic_title: 'a', topic_scope: 'x' }] }), /exactly 3/);
  assert.throws(
    () => parseIdeas({ ideas: [{ topic_title: 'a', topic_scope: 'x' }, { topic_title: 'A', topic_scope: 'y' }, { topic_title: 'c', topic_scope: '' }] }),
    /repeated|missing/,
  );
});

test('both calls use structured outputs, never forced tool use, and cache the stable prefix', () => {
  const idea = ideaGeneratorParams({
    model: 'claude-sonnet-5-5',
    themeBrief: 'BRIEF',
    pool: [{ topic_title: 'p', topic_scope: 'ps' }],
    rendered: [],
  });
  const scope = scopeWriterParams({ model: 'claude-sonnet-5-5', themeBrief: 'BRIEF', titles: ['A', 'B'] });
  for (const params of [idea, scope]) {
    // Sonnet 5.5 rejects tool_choice "tool"/"any" with a 400.
    assert.equal('tool_choice' in params, false);
    assert.equal('tools' in params, false);
    assert.equal(params.output_config.format.type, 'json_schema');
    const system = params.system as { text: string; cache_control?: unknown }[];
    assert.equal(system.length, 1);
    assert.ok(system[0].cache_control, 'system carries the breakpoint');
    assert.ok(system[0].text.includes('<theme_brief>\nBRIEF\n</theme_brief>'));
  }
  assert.deepEqual(idea.output_config.format.schema, IDEAS_SCHEMA);
  assert.deepEqual(scope.output_config.format.schema, SCOPES_SCHEMA);
  const system = idea.system as { text: string }[];
  assert.ok(system[0].text.startsWith(IDEA_GENERATOR_INSTRUCTIONS));
  assert.ok(!system[0].text.includes('"p"'), 'pool is not in the cached prefix');
  assert.ok((idea.messages[0].content as string).includes('"topic_title":"p"'));
  assert.ok((scope.messages[0].content as string).includes('["A","B"]'));
});

test('structured replies: JSON from the text blocks, refusals and truncation are errors', () => {
  const text = (t: string) => ({ type: 'text', text: t, citations: null }) as never;
  assert.deepEqual(
    structuredJson({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' } as never, text('{"a":1}')] }, 'x'),
    { a: 1 },
  );
  assert.throws(() => structuredJson({ stop_reason: 'refusal', content: [] }, 'x'), /declined/);
  assert.throws(() => structuredJson({ stop_reason: 'max_tokens', content: [text('{"a"')] }, 'x'), /max_tokens/);
  assert.throws(() => structuredJson({ stop_reason: 'end_turn', content: [text('not json')] }, 'x'), /not valid JSON/);
});

// ── Intake and dedupe against the database ──────────────────────────────────

test('hand-added topics are scored, gated, and ranked', async () => {
  const { db } = await scratchExplainersDb();
  const results = await seedPool(db, [
    ['API call', STRONG],
    ['React', GOOD],
    ['Everything about agents', BROAD],
  ]);
  assert.deepEqual(results.map((r) => r.evaluation.outcome), ['entered_pool', 'entered_pool', 'rejected_gates']);
  assert.deepEqual((await listPool(db)).map((t) => t.title), ['API call', 'React']);
  const broad = (await listTopics(db, ['rejected']))[0];
  assert.match(broad.reject_reason ?? '', /teachability_45s, accuracy_under_simplification/);
});

test('hand-added titles get their scopes from one model call per click', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  const { transport } = stubJev({ Webhooks: STRONG, 'Git branches': GOOD });
  const results = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [
    { title: '  Webhooks ', origin: 'seeded' },
    { title: 'Git branches', origin: 'seeded' },
  ]);
  assert.deepEqual(ideas.scopeRequests, [['Webhooks', 'Git branches']]);
  assert.deepEqual(results.map((r) => r.scope), ['Explain Webhooks.', 'Explain Git branches.']);
  assert.equal((await getTopic(db, results[0].topicId))?.scope, 'Explain Webhooks.');
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM explainers.cost_events WHERE component = 'scope_writer' AND usd > 0`,
  );
  assert.equal(rows[0].n, 1);
});

test('scope writer output must match the titles one for one', () => {
  assert.deepEqual(parseScopes({ scopes: [{ topic_title: 'A', topic_scope: 'Explain A.', term: 'a' }] }, ['A']), { scopes: ['Explain A.'], terms: ['a'] });
  assert.throws(() => parseScopes({ scopes: [{ topic_title: 'A', topic_scope: 'Explain A.' }] }, ['A']), /no term/);
  assert.throws(() => parseScopes({ scopes: [] }, ['A']), /must return 1/);
  assert.throws(() => parseScopes({ scopes: [{ topic_title: 'B', topic_scope: 'x' }] }, ['A']), /does not match/);
  assert.throws(() => parseScopes({ scopes: [{ topic_title: 'A', topic_scope: ' ' }] }, ['A']), /empty/);
});

test('Jev logs and costs land in the explainers tables', async () => {
  const { db } = await scratchExplainersDb();
  await seedPool(db, [['API call', STRONG], ['React', GOOD]]);
  const { rows: logs } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM explainers.jev_logs');
  const { rows: costs } = await db.query<{ component: string; n: number }>(
    `SELECT component, count(*)::int AS n FROM explainers.cost_events
      WHERE vendor = 'jev' GROUP BY component ORDER BY component`,
  );
  // First topic: 2 scoring calls (empty history, no gate). Second: 1 gate + 2 scoring.
  // Both made the pool, so each also had its 3 candidate analogies scored (EX3-30).
  assert.equal(logs[0].n, 11);
  assert.deepEqual(costs, [
    { component: 'analogy_scoring', n: 6 },
    { component: 'duplicate_gate', n: 1 },
    { component: 'idea_scoring', n: 4 },
  ]);
});

test('duplicate of a pool topic: Stage 2 finds it in batches of five, the better one stays', async () => {
  const { db } = await scratchExplainersDb();
  const pool: [string, Scores][] = Array.from({ length: 7 }, (_, i) => [
    `Topic ${i}`,
    { ...GOOD, hook_strength: 3 - i * 0.1 },
  ]);
  await seedPool(db, pool);

  // "Topic 6 again" duplicates Topic 6, ranked 7th, so it sits in the second batch.
  const { transport, calls } = stubJev({ 'Topic 6 again': STRONG }, [['Topic 6 again', 'Topic 6']]);
  const [result] = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: stubIdeas() }, [
    { title: 'Topic 6 again', origin: 'manual' },
  ]);
  assert.equal(result.evaluation.outcome, 'won_head_to_head');
  assert.deepEqual(
    calls.map((c) => [c.set, c.keys.length]),
    [['gate', 1], ['pairs', 5], ['pairs', 2], ['scoring', 1], ['scoring', 6], ['analogy', 7], ['analogy', 7], ['analogy', 7]],
  );
  const loser = (await listTopics(db, ['displaced']))[0];
  assert.equal(loser.title, 'Topic 6');
  assert.equal(loser.duplicate_of, result.topicId);

  // A weaker duplicate of the top topic loses and is displaced.
  const weak = stubJev({ 'Topic 0 redux': GOOD }, [['Topic 0 redux', 'Topic 0']]);
  const [lost] = await addAndEvaluateTopics({ db, jevTransport: weak.transport, ideaModel: stubIdeas() }, [
    { title: 'Topic 0 redux', origin: 'manual' },
  ]);
  assert.equal(lost.evaluation.outcome, 'lost_head_to_head');
  assert.equal(weak.calls.filter((c) => c.set === 'pairs').length, 1, 'stops at the first batch with a match');
});

test('duplicate of a recently rendered topic is rejected without scoring', async () => {
  const { db } = await scratchExplainersDb();
  await seedPool(db, [['Webhooks', STRONG]]);
  await db.query(`UPDATE explainers.topics SET status = 'rendered', rendered_at = now() - interval '10 days'`);

  const { transport, calls } = stubJev({}, [['Webhooks again', 'Webhooks']]);
  const [result] = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: stubIdeas() }, [
    { title: 'Webhooks again', origin: 'manual' },
  ]);
  assert.equal(result.evaluation.outcome, 'rejected_history_duplicate');
  assert.deepEqual(calls.map((c) => c.set), ['gate']);

  // Past the 45-day window the same topic may return.
  await db.query(`UPDATE explainers.topics SET rendered_at = now() - interval '46 days' WHERE title = 'Webhooks'`);
  const later = stubJev({ 'Webhooks, later': STRONG }, [['Webhooks, later', 'Webhooks']]);
  const [ok] = await addAndEvaluateTopics({ db, jevTransport: later.transport, ideaModel: stubIdeas() }, [
    { title: 'Webhooks, later', origin: 'manual' },
  ]);
  assert.equal(ok.evaluation.outcome, 'entered_pool');
});

test('the pool is trimmed to pool_size', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'pool_size', 2);
  await seedPool(db, [['A', STRONG], ['B', GOOD], ['C', { ...GOOD, hook_strength: 1 }]]);
  assert.deepEqual((await listPool(db)).map((t) => t.title), ['A', 'B']);
  const [cut] = await listTopics(db, ['displaced']);
  assert.equal(cut.title, 'C');
  assert.equal(cut.reject_reason, 'Below the pool cut.');
});

// ── The daily cycle ─────────────────────────────────────────────────────────

test('the daily cycle does nothing while auto_render is off', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas([]);
  const { transport, calls } = stubJev({});
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: transport });
  assert.deepEqual(result, { status: 'skipped', reason: 'auto_render_off' });
  assert.equal(ideas.requests.length, 0);
  assert.equal(calls.length, 0);
});

test('the daily cycle generates, dedupes, promotes, queues, and logs telemetry once a day', async () => {
  const { db } = await scratchExplainersDb();
  await seedPool(db, [['Primary keys', GOOD]]);
  await saveSetting(db, 'auto_render', true);

  const ideas = stubIdeas([[
    ['APIs', 'Explain an API call.'],
    ['APIs, again', 'Explain an API call.'],
    ['Learn Python in 45 seconds', 'Explain Python.'],
  ]]);
  const { transport } = stubJev(
    { APIs: STRONG, 'APIs, again': GOOD, 'Learn Python in 45 seconds': BROAD },
    [['APIs, again', 'APIs']],
  );
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: transport });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.evaluations.map((e) => e.outcome), ['entered_pool', 'lost_head_to_head', 'rejected_gates']);

  const promoted = await getTopic(db, result.promotedTopicId!);
  assert.equal(promoted?.title, 'APIs');
  assert.equal(promoted?.status, 'queued');
  assert.ok(result.render?.ok);
  if (result.render?.ok) assert.equal(result.render.job.trigger, 'auto');

  const { rows: [cycle] } = await db.query<Record<string, unknown>>('SELECT * FROM explainers.idea_cycles');
  assert.equal(cycle.status, 'ok');
  assert.equal(cycle.ideas_generated, 3);
  assert.equal(cycle.ideas_surviving_dedupe, 2);
  assert.equal(cycle.ideas_entering_pool, 1);
  assert.ok(Number(cycle.generator_cost_usd) > 0);
  assert.ok(Number(cycle.scoring_cost_usd) > 0);
  assert.ok(Number(cycle.duplicate_check_cost_usd) > 0);

  const generator = ideas.requests[0] as { pool: { topic_title: string }[] };
  assert.deepEqual(generator.pool.map((p) => p.topic_title), ['Primary keys']);

  const again = await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: transport });
  assert.deepEqual(again, { status: 'skipped', reason: 'already_ran_today' });
});

test('production: the idea run is skipped once the day has spent its cap', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  await saveSetting(db, 'mode', 'production');
  await db.query(
    `INSERT INTO explainers.cost_events (mode, vendor, component, usd) VALUES ('production', 'anthropic', 'render', 10)`,
  );
  const ideas = stubIdeas([]);
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: stubJev({}).transport });
  assert.deepEqual(result, { status: 'skipped', reason: 'daily_spend_cap' });
  assert.equal(ideas.requests.length, 0);
});

test('a failed generator call marks the cycle failed and keeps the pool', async () => {
  const { db } = await scratchExplainersDb();
  await seedPool(db, [['Primary keys', GOOD]]);
  await saveSetting(db, 'auto_render', true);
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport });
  assert.equal(result.status, 'failed');
  assert.deepEqual((await listPool(db)).map((t) => t.title), ['Primary keys']);
});


// ── Retrying a failed night ─────────────────────────────────────────────────

import { CYCLE_RETRY_DELAY_MS, nextCycleTry } from '@/lib/explainers/ideas/retry';

const NIGHT = new Date('2026-10-13T06:00:00Z'); // 2:00 AM New York

test('a failed cycle may run once more, after the delay, and the failed row stays', async () => {
  const { db } = await scratchExplainersDb();
  await seedPool(db, [['Primary keys', GOOD]]);
  await saveSetting(db, 'auto_render', true);

  const first = await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport, now: NIGHT });
  assert.equal(first.status, 'failed');
  await db.query(`UPDATE explainers.idea_cycles SET finished_at = $1`, [NIGHT]); // the table stamps real time; pin it to the test clock

  const tooSoon = new Date(NIGHT.getTime() + CYCLE_RETRY_DELAY_MS - 60_000);
  const waiting = await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport, now: tooSoon });
  assert.deepEqual(waiting, { status: 'skipped', reason: 'retry_wait' });

  const later = new Date(NIGHT.getTime() + CYCLE_RETRY_DELAY_MS + 1000);
  const retry = await runIdeaCycle({
    db,
    ideaModel: stubIdeas([[['APIs', 'Explain an API call.']]]),
    jevTransport: stubJev({ APIs: STRONG }).transport,
    now: later,
  });
  assert.equal(retry.status, 'ok');

  const { rows } = await db.query<{ status: string }>('SELECT status FROM explainers.idea_cycles ORDER BY started_at');
  assert.deepEqual(rows.map((r) => r.status).sort(), ['failed', 'ok']);
  const again = await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport, now: later });
  assert.deepEqual(again, { status: 'skipped', reason: 'already_ran_today' });
});

test('a night that failed twice is not tried a third time', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  const run = (now: Date) => runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport, now });
  assert.equal((await run(NIGHT)).status, 'failed');
  await db.query(`UPDATE explainers.idea_cycles SET finished_at = $1`, [NIGHT]);
  const second = new Date(NIGHT.getTime() + CYCLE_RETRY_DELAY_MS + 1000);
  assert.equal((await run(second)).status, 'failed');
  const third = new Date(second.getTime() + 3 * CYCLE_RETRY_DELAY_MS);
  assert.deepEqual(await run(third), { status: 'skipped', reason: 'retry_exhausted' });
  const { rows } = await db.query('SELECT 1 FROM explainers.idea_cycles');
  assert.equal(rows.length, 2);
});

test('a failed night that already has an auto render requested is not retried', async () => {
  const { db } = await scratchExplainersDb();
  await seedPool(db, [['Primary keys', GOOD]]);
  await saveSetting(db, 'auto_render', true);
  assert.equal((await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport, now: NIGHT })).status, 'failed');
  await db.query(`UPDATE explainers.idea_cycles SET finished_at = $1`, [NIGHT]);
  const { rows: [topic] } = await db.query<{ id: string }>('SELECT id FROM explainers.topics LIMIT 1');
  await db.query(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, requested_at)
     VALUES ($1, 'requested', 'auto', 'development', 5, 'm', 'm', $2)`,
    [topic.id, new Date(NIGHT.getTime() + 1000)],
  );
  const later = new Date(NIGHT.getTime() + CYCLE_RETRY_DELAY_MS + 1000);
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas([]), jevTransport: stubJev({}).transport, now: later });
  assert.deepEqual(result, { status: 'skipped', reason: 'render_already_requested' });
});

test('the worker retries a failed or thrown night after the delay, at most twice a day', () => {
  const now = 1_000_000;
  assert.equal(nextCycleTry({ status: 'failed' }, 1, now), now + CYCLE_RETRY_DELAY_MS);
  assert.equal(nextCycleTry('threw', 1, now), now + CYCLE_RETRY_DELAY_MS);
  assert.equal(nextCycleTry({ status: 'failed' }, 2, now), null);
  assert.equal(nextCycleTry('threw', 2, now), null);
  assert.equal(nextCycleTry({ status: 'ok' }, 1, now), null);
  assert.equal(nextCycleTry({ status: 'skipped', reason: 'already_ran_today' }, 1, now), null);
  assert.equal(nextCycleTry({ status: 'skipped', reason: 'retry_exhausted' }, 1, now), null);
  assert.equal(nextCycleTry({ status: 'skipped', reason: 'retry_wait' }, 1, now), now + CYCLE_RETRY_DELAY_MS);
});

// ── The analogy pick (Explainers 3.0, EX3-30) ───────────────────────────────

const scoreRow = (v: number, overrides: Partial<AnalogyScores> = {}): AnalogyScores => ({
  simplicity: v,
  reach: v,
  mapping_fidelity: v,
  visual_strength: v,
  visual_payoff: v,
  familiarity: v,
  hook_clarity: v,
  ...overrides,
});

test('the analogy pick: equal sevenths, then fidelity, familiarity, hook clarity, reach…; invented rules lose (EX3-85)', () => {
  assert.equal(analogyTotal(scoreRow(4)), 100);
  assert.equal(analogyTotal(scoreRow(2)), 50);
  assert.equal(pickAnalogy([scoreRow(2), scoreRow(3), scoreRow(2.5)]), 1);
  // Same total: the more faithful mapping wins.
  assert.equal(pickAnalogy([scoreRow(3, { mapping_fidelity: 2, reach: 4 }), scoreRow(3, { mapping_fidelity: 4, reach: 2 })]), 1);
  // Same total and fidelity: the more familiar analogy wins, then the clearer hook.
  assert.equal(pickAnalogy([scoreRow(3, { familiarity: 2, reach: 4 }), scoreRow(3, { familiarity: 4, reach: 2 })]), 1);
  assert.equal(pickAnalogy([scoreRow(3, { hook_clarity: 2, reach: 4 }), scoreRow(3, { hook_clarity: 4, reach: 2 })]), 1);
  // A perfect tie keeps the earlier candidate.
  assert.equal(pickAnalogy([scoreRow(3), scoreRow(3)]), 0);
  // A candidate that needs an invented rule loses to a finished one, whatever its score…
  assert.equal(pickAnalogy([scoreRow(4), scoreRow(2)], [{ invented_rules: ['the jar knows which words follow'] }, { invented_rules: [] }]), 1);
  // …unless every candidate needs one.
  assert.equal(pickAnalogy([scoreRow(4), scoreRow(2)], [{ invented_rules: ['x'] }, { invented_rules: ['y'] }]), 0);
});

test('analogy writer output must be exactly three complete, distinct candidates', () => {
  const three = [1, 2, 3].map((n) => candidate('T', n));
  assert.equal(parseAnalogies({ candidates: three }).length, 3);
  assert.throws(() => parseAnalogies({ candidates: three.slice(0, 2) }), /exactly 3/);
  assert.throws(() => parseAnalogies({ candidates: [three[0], three[0], three[2]] }), /repeated/);
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], payoff: ' ' }, three[1], three[2]] }), /missing a field/);
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], elements: [{ name: 'x', stands_for: '' }] }, three[1], three[2]] }), /stands for/);
  // v2 (EX3-66): at most four elements, a hook, and 3–5 steps with both labels.
  const five = [1, 2, 3, 4, 5].map((i) => ({ name: `e${i}`, stands_for: 'a part' }));
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], elements: five }, three[1], three[2]] }), /at most 4/);
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], hook: '' }, three[1], three[2]] }), /hook/);
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], steps: three[0].steps!.slice(0, 2) }, three[1], three[2]] }), /3 to 5 steps/);
  assert.throws(
    () => parseAnalogies({ candidates: [{ ...three[0], steps: [...three[0].steps!.slice(0, 2), { analogy: 'x', technical: '' }] }, three[1], three[2]] }),
    /technical name/,
  );
  assert.deepEqual(parseAnalogies({ candidates: three })[0].steps?.map((st) => st.technical), ['event fires', 'request sent', 'app updates']);
  // v3 (EX3-85): the rung, the invented rules (a list, kept), and the actor.
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], rung: 4 }, three[1], three[2]] }), /rung/);
  assert.throws(() => parseAnalogies({ candidates: [{ ...three[0], invented_rules: undefined }, three[1], three[2]] }), /invented_rules/);
  const parsed = parseAnalogies({ candidates: [{ ...three[0], invented_rules: ['a rule', ' '] }, three[1], { ...three[2], actor: '' }] });
  assert.deepEqual(parsed[0].invented_rules, ['a rule']);
  assert.equal(parsed[1].actor, 'a student');
  assert.equal(parsed[2].actor, 'none');
});

test("analogy writer v3 asks in Lucas's words, climbs the ladder, casts critters, judges the hook alone (EX3-66, EX3-85)", () => {
  assert.equal(ANALOGY_WRITER_VERSION, 'analogy-writer-v3');
  assert.equal(
    ANALOGY_ASK,
    'The simplest physical or conceptual metaphor that carries the mechanism. Start from basic elements, situations, objects that are universally understandable or part of everyday life. Use an everyday place only if it requires 3 or fewer recognizable parts for the viewer to understand the everyday place.',
  );
  assert.ok(ANALOGY_WRITER_INSTRUCTIONS.includes(`What to write: ${ANALOGY_ASK}`));
  // No example scenes to copy (v1 named waiting in a line, sending a letter, ordering food).
  assert.doesNotMatch(ANALOGY_WRITER_INSTRUCTIONS, /waiting in a line|sending a letter|ordering food|restaurant|mailbox|chef/i);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /At most 4 elements/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /not a default/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /technical \(the real step's name/);
  assert.doesNotMatch(ANALOGY_WRITER_INSTRUCTIONS, /45/);
  // The ladder with zero invented rules, critters only, and the standalone hook (Lucas, 2026-10-13).
  assert.ok(ANALOGY_WRITER_INSTRUCTIONS.includes(ANALOGY_LADDER));
  assert.match(ANALOGY_LADDER, /Rung 1: one object or physical effect\. Rung 2: one everyday action by one character, with at most 3 objects\. Rung 3: a familiar everyday situation/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /invented_rules: .* It must be empty/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /Anyone who acts in the scene is a critter/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /never a person's body part/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /knows what they are looking at within one second/);
  // No example scenes, and no hand anywhere as something to draw (example pollution, Lucas).
  assert.doesNotMatch(ANALOGY_WRITER_INSTRUCTIONS, /jar|word-card|light switch|dark room/i);
  const item = (ANALOGIES_SCHEMA.properties.candidates.items as { required: readonly string[] }).required;
  assert.deepEqual([...item], ['scene', 'elements', 'process', 'payoff', 'visual', 'rung', 'invented_rules', 'actor', 'hook', 'steps']);
});

test('the idea generator skews to AI and still asks for CS or tech (EX3-73); both write the term (EX3-86)', () => {
  assert.equal(IDEA_GENERATOR_VERSION, 'idea-generator-v4');
  assert.equal(SCOPE_WRITER_VERSION, 'scope-writer-v4');
  for (const prompt of [IDEA_GENERATOR_INSTRUCTIONS, SCOPE_WRITER_INSTRUCTIONS]) assert.ok(prompt.includes(TERM_RULE));
  assert.match(IDEA_GENERATOR_INSTRUCTIONS, /Exactly 2 of the 3 ideas teach an AI concept/);
  assert.match(IDEA_GENERATOR_INSTRUCTIONS, /The other idea teaches a computer-science or tech concept/);
  for (const prompt of [IDEA_GENERATOR_INSTRUCTIONS, SCOPE_WRITER_INSTRUCTIONS]) {
    assert.match(prompt, /one minute|one-minute/);
    assert.doesNotMatch(prompt, /45/);
  }
});

test('the analogy writer caches its stable prefix and keeps the topic out of it', () => {
  const params = analogyWriterParams({ model: 'claude-sonnet-5-5', themeBrief: 'BRIEF', title: 'Webhooks', scope: 'Explain webhooks.' });
  assert.equal('tools' in params, false);
  assert.deepEqual(params.output_config.format.schema, ANALOGIES_SCHEMA);
  const system = params.system as { text: string; cache_control?: unknown }[];
  assert.ok(system[0].cache_control);
  assert.ok(system[0].text.startsWith(ANALOGY_WRITER_INSTRUCTIONS));
  assert.ok(!system[0].text.includes('Webhooks'));
  assert.match(params.messages[0].content as string, /Topic: Webhooks\nLearning objective: Explain webhooks\./);
});

test('the generator and scope writer ask for the eight-beat shape, with no technical caveat (EX3-35)', () => {
  for (const prompt of [IDEA_GENERATOR_INSTRUCTIONS, SCOPE_WRITER_INSTRUCTIONS]) {
    assert.ok(prompt.includes(REEL_SHAPE));
    assert.doesNotMatch(prompt, /caveat|technical insight/);
  }
});

test('a topic that makes the pool gets its analogy picked from three Jev-scored candidates', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  const { transport } = stubJev(
    { Webhooks: STRONG, 'Everything about agents': BROAD },
    [],
    (scene) => (scene.endsWith('scene 2') ? 4 : 2),
  );
  const results = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [
    { title: 'Webhooks', origin: 'manual' },
    { title: 'Everything about agents', origin: 'manual' },
  ]);
  assert.deepEqual(results.map((r) => r.evaluation.outcome), ['entered_pool', 'rejected_gates']);
  assert.deepEqual(ideas.analogyRequests, ['Webhooks'], 'rejected topics get no analogy spend');

  const webhooks = await getTopic(db, results[0].topicId);
  const note = (webhooks?.jev_notes as { analogy: AnalogyNote & { pick: number; totals: number[] } }).analogy;
  assert.equal(note.version, 'analogy-writer-v3');
  assert.equal(note.pick, 1);
  assert.deepEqual(note.totals, [50, 100, 50]);
  assert.equal((webhooks as { term?: string | null }).term, 'webhooks', 'the scope writer wrote its term');
  assert.equal(topicAnalogy(webhooks!)?.scene, 'Webhooks scene 2');
  assert.match(analogyMarkdown(topicAnalogy(webhooks!)!), /^Scene: Webhooks scene 2\n\nElements:\n- thing 2 — stands for the real part/);
  assert.match(analogyMarkdown(topicAnalogy(webhooks!)!), /Rung: 3 \(a familiar everyday situation\)\n\nActor: a critter: a student\n\nHook \(the opener's moment, clear on its own\): It is already moving 2\.\n\nSteps \(what happens in the scene — the real step\):\n1\. first thing — event fires\n2\. second thing — request sent\n3\. third thing — app updates$/);
  // ai_focus is stored in jev_notes and counted in the weighted score (EX3-73).
  assert.equal((webhooks?.jev_notes as { ai_focus?: number }).ai_focus, 2);
  assert.equal(Number(webhooks?.weighted_score), weightedScore(STRONG));

  // An analogy from an older writer is picked again at render time (EX3-31, 3.1).
  const old = { ...webhooks!, jev_notes: { ...webhooks!.jev_notes, analogy: { ...note, version: 'analogy-writer-v2' } } };
  assert.equal(topicAnalogy(old), null);
  assert.equal(topicAnalogy((await getTopic(db, results[1].topicId))!), null);

  const { rows } = await db.query<{ vendor: string; component: string; n: number }>(
    `SELECT vendor, component, count(*)::int AS n FROM explainers.cost_events
      WHERE component LIKE 'analogy%' GROUP BY vendor, component ORDER BY component`,
  );
  assert.deepEqual(rows, [
    { vendor: 'jev', component: 'analogy_scoring', n: 3 },
    { vendor: 'anthropic', component: 'analogy_writer', n: 1 },
  ].sort((a, b) => a.component.localeCompare(b.component)));
});

test('a failed analogy pass is recorded on the topic and never changes the evaluation', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  ideas.writeAnalogies = async () => {
    throw new Error('analogy writer must return exactly 3 candidates');
  };
  const [result] = await addAndEvaluateTopics({ db, jevTransport: stubJev({ Webhooks: STRONG }).transport, ideaModel: ideas }, [
    { title: 'Webhooks', origin: 'manual' },
  ]);
  assert.equal(result.evaluation.outcome, 'entered_pool');
  const topic = await getTopic(db, result.topicId);
  const note = (topic?.jev_notes as { analogy: { error?: string } }).analogy;
  assert.match(note.error ?? '', /exactly 3/);
  assert.equal(topicAnalogy(topic!), null, 'the render runs the pass again (EX3-31)');
});
