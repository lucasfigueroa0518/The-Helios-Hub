/**
 * M3 idea pipeline, offline. Jev and the idea generator are stubbed with canned
 * answers; the real runner, question sets, SQL, and pool logic all run.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { addAndEvaluateTopics, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import {
  batchesOfFive,
  challengerWins,
  scoringCalls,
} from '@/lib/explainers/ideas/evaluate';
import {
  IDEAS_SCHEMA,
  IDEA_GENERATOR_INSTRUCTIONS,
  SCOPES_SCHEMA,
  ideaGeneratorParams,
  scopeWriterParams,
  structuredJson,
  parseIdeas,
  parseScopes,
  type IdeaModel,
} from '@/lib/explainers/ideas/generator';
import { getTopic, listPool, listTopics } from '@/lib/explainers/repository';
import { saveSetting } from '@/lib/explainers/settings';
import type { ScoreKey } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

type Scores = Record<ScoreKey, number>;

const STRONG: Scores = {
  audience_fit: 4,
  teachability_45s: 4,
  analogy_potential: 4,
  visual_potential: 4,
  accuracy_under_simplification: 4,
  hook_strength: 3,
};
const GOOD: Scores = { ...STRONG, hook_strength: 2, visual_potential: 3 };
const BROAD: Scores = { ...STRONG, teachability_45s: 0, accuracy_under_simplification: 1 };

type Call = { set: string; keys: string[]; state: Record<string, unknown> };

/**
 * Canned Jev. `scores` by topic title; `same` says whether two titles teach the
 * same takeaway (order-free). Every call is recorded for assertions.
 */
function stubJev(scores: Record<string, Scores>, same: [string, string][] = []) {
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
          : 'scoring';
      calls.push({ set: setId, keys, state: s });
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        if (setId === 'scoring') {
          const title = s.topic_title as string;
          answers[key] = { type: 'score', score: scores[title][key as ScoreKey], confidence: 1 };
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

function stubIdeas(batches: [string, string][][] = []): IdeaModel & { requests: unknown[]; scopeRequests: string[][] } {
  const requests: unknown[] = [];
  const scopeRequests: string[][] = [];
  return {
    requests,
    scopeRequests,
    async writeScopes(request) {
      scopeRequests.push([...request.titles]);
      return {
        scopes: request.titles.map((title) => `Explain ${title}.`),
        usage: { input_tokens: 100, output_tokens: 40 },
        model: 'claude-sonnet-5-5',
      };
    },
    async propose(request) {
      requests.push(request);
      const next = batches.shift();
      if (!next) throw new Error('no canned ideas left');
      return {
        ideas: next.map(([topic_title, topic_scope]) => ({ topic_title, topic_scope })),
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
        ['teachability_45s', 'analogy_potential', 'visual_potential', 'accuracy_under_simplification', 'hook_strength'],
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
      ['analogy_potential', 'hook_strength'],
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
  const ok = parseIdeas({ ideas: [{ topic_title: 'a', topic_scope: 'x' }, { topic_title: 'b', topic_scope: 'y' }, { topic_title: 'c', topic_scope: 'z' }] });
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
  assert.deepEqual(parseScopes({ scopes: [{ topic_title: 'A', topic_scope: 'Explain A.' }] }, ['A']), ['Explain A.']);
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
  assert.equal(logs[0].n, 5);
  assert.deepEqual(costs, [
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
    [['gate', 1], ['pairs', 5], ['pairs', 2], ['scoring', 1], ['scoring', 5]],
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
    `INSERT INTO explainers.cost_events (mode, vendor, component, usd) VALUES ('production', 'anthropic', 'render', 6)`,
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
