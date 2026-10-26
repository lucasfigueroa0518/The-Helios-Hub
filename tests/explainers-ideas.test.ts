/**
 * M3 idea pipeline, offline. Jev and the idea generator are stubbed with canned
 * answers; the real runner, question sets, SQL, and pool logic all run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { analogyCheckProblems, analogyMarkdown, ANALOGY_GATE_MAX, compareScore, gateMisses, GOLDEN_HIDE_AT, normalizeAnalogyName, sameAnalogy, sentenceCount, topicAnalogy } from '@/lib/explainers/ideas/analogy';
import { chooseGap, gapCheckProblems, gapMarkdown, gapMisses, gapTotal, MAX_GAP_PASSES, pickGap, topicGap, topicGapNote } from '@/lib/explainers/ideas/gap';
import { addAndEvaluateTopics, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import {
  batchesOfFive,
  challengerWins,
  scoringCalls,
} from '@/lib/explainers/ideas/evaluate';
import {
  ANALOGY_CALLS,
  ANALOGY_SCHEMA,
  ANALOGY_WRITER_INSTRUCTIONS,
  analogyWriterSystem,
  GOLDEN_ANALOGIES,
  goldenExample,
  GAPS_SCHEMA,
  GAP_WRITER_INSTRUCTIONS,
  GAP_WRITER_VERSION,
  gapWriterParams,
  gapWriterUserMessage,
  parseGaps,
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
  analogyWriterUserMessage,
  anthropicIdeaModel,
  ideaGeneratorParams,
  parseAnalogy,
  scopeWriterParams,
  structuredJson,
  parseIdeas,
  parseScopes,
  type AnalogyRequest,
  type GapRequest,
  type IdeaModel,
} from '@/lib/explainers/ideas/generator';
import { getTopic, listPool, listTopics } from '@/lib/explainers/repository';
import { weightedScore } from '@/lib/explainers/scoring';
import { saveSetting } from '@/lib/explainers/settings';
import { GAP_KEYS, type AnalogyCandidate, type AnalogyNote, type GapCandidate, type GapNote, type GapScores, type IdeaScoreKey } from '@/lib/explainers/types';
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

/** A named analogy that passes the code checks; `n` is the writer call that wrote it (1, 2, 3). */
const candidate = (n: number): AnalogyCandidate => ({
  name: `Thing ${n}`,
  explanation: `Thing ${n} rings when something happens. Nobody has to keep checking.`,
  mapping: [
    { analogy: `thing ${n}`, concept: 'the real part' },
    { analogy: 'other', concept: 'another part' },
    { analogy: 'the bell', concept: 'the signal' },
  ],
});

/** A gap candidate that passes the code checks: 26 words, ends on its question, no term, nothing from the analogy. */
const gapLine = (n: number, attempt = 1): GapCandidate => ({
  line: `You open an app every morning and it already shows the stories you like best before you even search${attempt > 1 ? ' again' : ''}. How does it know what you want ${n}?`,
  question: `How does it know what you want ${n}?`,
  way_in: 'everyday mystery',
  why_it_pulls: 'Everyone has felt it.',
});

type JevAnswers = {
  /** p(the golden example teaches the topic's concept); default 0.1. */
  golden?: (concept: string, title: string) => number;
  /** The three gates' p per candidate, by the analogy text Jev reads (its name is the first line); default all 0.1. */
  gates?: (analogy: string) => Partial<Record<'false_mapping' | 'is_the_system' | 'real_names', number>>;
  /** p(a is more repeatable than b), by the two analogy texts; default 0.5. */
  compare?: (a: string, b: string) => number;
  gap?: (line: string) => number;
  falseClaim?: (line: string) => number;
};

/**
 * Canned Jev. `scores` by topic title; `same` says whether two titles teach the
 * same takeaway (order-free); `answers` sets the analogy and gap verdicts. Every
 * call is recorded for assertions.
 */
function stubJev(scores: Record<string, Scores>, same: [string, string][] = [], verdicts: JevAnswers = {}) {
  const { golden = () => 0.1, gates = (): ReturnType<NonNullable<JevAnswers['gates']>> => ({}), compare = () => 0.5, gap = () => 3, falseClaim = () => 0.1 } = verdicts;
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
          : keys[0] === 'same_concept'
            ? 'golden'
            : keys[0] === 'false_mapping'
              ? 'analogy_gates'
              : keys[0] === 'a_over_b'
                ? 'compare'
            : keys[0] === 'false_claim'
              ? 'gap_gate'
              : (GAP_KEYS as readonly string[]).includes(keys[0])
                ? 'gap'
                : 'scoring';
      calls.push({ set: setId, keys, state: s });
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        if (setId === 'golden') {
          answers[key] = { type: 'noul', noul: golden(s.example_concept as string, s.topic_title as string) };
        } else if (setId === 'analogy_gates') {
          answers[key] = { type: 'noul', noul: gates(s.analogy as string)[key as 'false_mapping'] ?? 0.1 };
        } else if (setId === 'compare') {
          answers[key] = { type: 'noul', noul: compare(s.a as string, s.b as string) };
        } else if (setId === 'gap') {
          answers[key] = { type: 'score', score: gap(s.candidate as string), confidence: 1 };
        } else if (setId === 'gap_gate') {
          answers[key] = { type: 'noul', noul: falseClaim(s.candidate as string) };
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
): IdeaModel & { requests: unknown[]; scopeRequests: string[][]; analogyRequests: string[]; analogyCalls: AnalogyRequest[]; gapCalls: GapRequest[] } {
  const requests: unknown[] = [];
  const scopeRequests: string[][] = [];
  const analogyRequests: string[] = [];
  const analogyCalls: AnalogyRequest[] = [];
  const gapCalls: GapRequest[] = [];
  return {
    requests,
    scopeRequests,
    analogyRequests,
    analogyCalls,
    gapCalls,
    async writeAnalogy(request) {
      analogyRequests.push(request.term);
      analogyCalls.push(request);
      const n = analogyCalls.filter((c) => c.term === request.term).length;
      return { candidate: candidate(n), usage: { input_tokens: 300, output_tokens: 200 }, model: 'claude-opus-5-5' };
    },
    async writeGaps(request) {
      gapCalls.push(request);
      return {
        candidates: [1, 2, 3].map((n) => gapLine(n, request.retry ? 2 : 1)),
        usage: { input_tokens: 200, output_tokens: 100 },
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

async function seedPool(db: ExplainersDb, entries: [string, Scores][], origin: 'manual' | 'seeded' = 'seeded') {
  const scores = Object.fromEntries(entries);
  const { transport } = stubJev(scores);
  return addAndEvaluateTopics(
    { db, jevTransport: transport, ideaModel: stubIdeas() },
    entries.map(([title]) => ({ title, origin })),
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
  // Both made the pool, so each also had its 13 golden examples matched, its 2 named analogies gated
  // and compared both ways (EX3-123, EX3-124), then its 3 curiosity gaps scored and gated (EX3-120).
  assert.equal(logs[0].n, 51);
  assert.deepEqual(costs, [
    { component: 'analogy_compare', n: 4 },
    { component: 'analogy_gates', n: 4 },
    { component: 'analogy_golden_match', n: 26 },
    { component: 'duplicate_gate', n: 1 },
    { component: 'gap_gate', n: 6 },
    { component: 'gap_scoring', n: 6 },
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
    { title: 'Topic 6 again', origin: 'seeded' },
  ]);
  assert.equal(result.evaluation.outcome, 'won_head_to_head');
  assert.deepEqual(
    calls.map((c) => [c.set, c.keys.length]),
    [
      ['gate', 1], ['pairs', 5], ['pairs', 2], ['scoring', 1], ['scoring', 6],
      ...Array.from({ length: 13 }, () => ['golden', 1]),
      ['analogy_gates', 3], ['analogy_gates', 3], ['compare', 1], ['compare', 1],
      ...Array.from({ length: 3 }, () => [['gap', 3], ['gap_gate', 1]]).flat(),
    ],
  );
  const loser = (await listTopics(db, ['displaced']))[0];
  assert.equal(loser.title, 'Topic 6');
  assert.equal(loser.duplicate_of, result.topicId);

  // A weaker duplicate of the top topic loses and is displaced.
  const weak = stubJev({ 'Topic 0 redux': GOOD }, [['Topic 0 redux', 'Topic 0']]);
  const [lost] = await addAndEvaluateTopics({ db, jevTransport: weak.transport, ideaModel: stubIdeas() }, [
    { title: 'Topic 0 redux', origin: 'seeded' },
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
    { title: 'Webhooks again', origin: 'seeded' },
  ]);
  assert.equal(result.evaluation.outcome, 'rejected_history_duplicate');
  assert.deepEqual(calls.map((c) => c.set), ['gate']);

  // Past the 45-day window the same topic may return.
  await db.query(`UPDATE explainers.topics SET rendered_at = now() - interval '46 days' WHERE title = 'Webhooks'`);
  const later = stubJev({ 'Webhooks, later': STRONG }, [['Webhooks, later', 'Webhooks']]);
  const [ok] = await addAndEvaluateTopics({ db, jevTransport: later.transport, ideaModel: stubIdeas() }, [
    { title: 'Webhooks, later', origin: 'seeded' },
  ]);
  assert.equal(ok.evaluation.outcome, 'entered_pool');
});

test('the pool is trimmed to pool_size', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'pool_size', 2);
  // A person's own topics (origin manual) are never cut; machine topics are.
  await seedPool(db, [['A', STRONG], ['B', GOOD], ['C', { ...GOOD, hook_strength: 1 }]]);
  assert.deepEqual((await listPool(db)).map((t) => t.title), ['A', 'B']);
  const [cut] = await listTopics(db, ['displaced']);
  assert.equal(cut.title, 'C');
  assert.equal(cut.reject_reason, 'Below the pool cut.');
});

test('the pool never cuts a person’s own topics, and a pool_size above the standard’s 30 is held to 30', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'pool_size', 2);
  await seedPool(db, [['A', STRONG], ['B', GOOD], ['C', { ...GOOD, hook_strength: 1 }]], 'manual');
  assert.deepEqual((await listPool(db)).map((t) => t.title), ['A', 'B', 'C'], 'all three are manual: none is cut');
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

// ── The analogy writer v8 and Jev's pick (Explainers 3.9, EX3-123, EX3-124, EX3-125) ──

const registerText = () => fs.readFileSync(path.join(process.cwd(), 'planning', 'Explainer Reels', 'DECISIONS.md'), 'utf8');

test('analogy writer v8 is the golden-set prompt, with the no-real-names line and JSON output (EX3-123)', () => {
  assert.equal(ANALOGY_WRITER_VERSION, 'analogy-writer-v8');
  assert.equal(ANALOGY_CALLS, 2);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /^You write the analogy at the heart of a one-minute "AI Brain Break" reel/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /Your goal is the highest-retention analogy for the concept: one a viewer gets at once, remembers a week later, and repeats to a friend\./);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /- Its name is the whole picture\./);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /- It is one idea, not a scene\./);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /- That thing's single defining trait is the concept's defining trait\./);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /- It shows the concept doing its job\. Its limits, if any, are for later in the reel\./);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /- It names no real company, store or product, no real person, and no character from a film, show or book\./);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /They show the standard, not a template/);
  assert.match(ANALOGY_WRITER_INSTRUCTIONS, /Return JSON matching the schema: name, explanation \(two or three sentences\), and mapping \(three to six rows, most important first/);
  // The staged-scene writer's machinery is gone.
  assert.doesNotMatch(ANALOGY_WRITER_INSTRUCTIONS, /\bhook\b|critter|HARD CONSTRAINTS|candidates as JSON|<theme_brief>/);
  assert.deepEqual([...ANALOGY_SCHEMA.required], ['name', 'explanation', 'mapping']);
  assert.deepEqual([...ANALOGY_SCHEMA.properties.mapping.items.required], ['analogy', 'concept']);
});

test("the golden set is Lucas's thirteen, verbatim, and the register holds the same block (EX3-123)", () => {
  assert.equal(GOLDEN_ANALOGIES.length, 13);
  assert.deepEqual(GOLDEN_ANALOGIES.map((g) => g.name), [
    'LEGO bricks', 'Pins on a map of meaning', 'The open-book exam', 'The improv actor', 'The forged note in the mail', 'The triage nurse',
    'Medical residency', 'The restaurant buzzer', 'The student ID number', 'The alternate timeline', 'The hotel', 'The club bouncer', 'The DJ',
  ]);
  const block = /### Golden analogies \(analogy-writer-v8\)\n[\s\S]*?```\n([\s\S]+?)\n```/.exec(registerText());
  assert.ok(block, 'the register has the golden set block');
  assert.equal(block![1], GOLDEN_ANALOGIES.map(goldenExample).join('\n\n'));
  // Every example is in the prompt when Jev hides none.
  const system = analogyWriterSystem([]);
  for (const g of GOLDEN_ANALOGIES) assert.ok(system.includes(goldenExample(g)), g.name);
  assert.ok(!system.includes('{EXAMPLES}'));
});

test('hiding: a golden example Jev matched is left out of the prompt, the others stay', () => {
  const system = analogyWriterSystem(['webhook', 'RAG']);
  assert.ok(!system.includes('The restaurant buzzer'));
  assert.ok(!system.includes('The open-book exam'));
  assert.ok(system.includes('The club bouncer'));
  assert.equal(GOLDEN_HIDE_AT, 0.5);
});

test('the analogy writer is Opus-ready: structured output, the cached golden prompt, the concept in the user message', () => {
  const params = analogyWriterParams({ model: 'claude-opus-5-5', term: 'webhook', scope: 'Explain webhooks.', hidden: [] });
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal('tools' in params, false);
  assert.deepEqual(params.output_config.format.schema, ANALOGY_SCHEMA);
  const system = params.system as { text: string; cache_control?: unknown }[];
  assert.equal(system.length, 1);
  assert.ok(system[0].cache_control, 'the golden prompt carries the breakpoint');
  assert.equal(system[0].text, analogyWriterSystem([]));
  assert.ok(!system[0].text.includes('Explain webhooks'));
  assert.equal(params.messages[0].content, 'Concept: webhook\nLearning objective: Explain webhooks.');
  assert.equal(analogyWriterUserMessage('RAG', 'Explain RAG.'), 'Concept: RAG\nLearning objective: Explain RAG.');
});

test('the writer reply: a name, an explanation and a mapping, or the call fails', async () => {
  const reply = { name: ' The restaurant buzzer ', explanation: 'It buzzes. You stop asking.', mapping: [{ analogy: ' the buzzer ', concept: 'the webhook call' }] };
  assert.deepEqual(parseAnalogy(reply), { name: 'The restaurant buzzer', explanation: 'It buzzes. You stop asking.', mapping: [{ analogy: 'the buzzer', concept: 'the webhook call' }] });
  assert.throws(() => parseAnalogy({ candidates: [] }), /a name, an explanation and a mapping/);
  const calls: unknown[] = [];
  const client = {
    messages: {
      create: async (params: unknown) => {
        calls.push(params);
        return { content: [{ type: 'text', text: JSON.stringify(candidate(1)) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 }, model: 'claude-opus-5-5' };
      },
    },
  };
  const out = await anthropicIdeaModel(client as never).writeAnalogy({ model: 'claude-opus-5-5', term: 'webhook', scope: 'Explain webhooks.', hidden: [] });
  assert.equal(calls.length, 1);
  assert.equal(out.candidate.name, 'Thing 1');
});

test('the code checks: two or three sentences, three to six rows, the term never in the name or the analogy side', () => {
  assert.equal(sentenceCount('Without it, you ask the host "is my table ready?" every two minutes. With it, the buzzer goes off.'), 2);
  assert.equal(sentenceCount('One. Two. Three. Four.'), 4);
  assert.deepEqual(analogyCheckProblems(candidate(1), 'webhook'), []);
  assert.match(analogyCheckProblems({ ...candidate(1), explanation: 'Just one.' }, 'webhook').join(), /1 sentences \(2 or 3\)/);
  assert.match(analogyCheckProblems({ ...candidate(1), explanation: 'One. Two. Three. Four.' }, 'webhook').join(), /4 sentences/);
  assert.match(analogyCheckProblems({ ...candidate(1), mapping: candidate(1).mapping.slice(0, 2) }, 'webhook').join(), /2 rows \(3 to 6\)/);
  assert.match(analogyCheckProblems({ ...candidate(1), mapping: [...candidate(1).mapping, { analogy: 'x', concept: '' }] }, 'webhook').join(), /missing a side/);
  assert.match(analogyCheckProblems({ ...candidate(1), name: 'The webhook bell' }, 'webhook').join(), /its name says the term "webhook"/);
  assert.match(analogyCheckProblems({ ...candidate(1), mapping: [{ analogy: 'the webhook bell', concept: 'x' }, ...candidate(1).mapping] }, 'webhook').join(), /analogy side says the term/);
  // The concept side may name the real thing.
  assert.deepEqual(analogyCheckProblems({ ...candidate(1), mapping: [{ analogy: 'the bell', concept: 'the webhook call' }, ...candidate(1).mapping] }, 'webhook'), []);
});

test('the pick rules: names match loosely, gates fail at 0.5, the swapped-order score is the mean of both readings', () => {
  assert.equal(normalizeAnalogyName('The Restaurant Buzzer!'), 'restaurant buzzer');
  assert.equal(sameAnalogy({ name: 'The restaurant buzzer' }, { name: 'restaurant buzzer' }), true);
  assert.equal(sameAnalogy({ name: 'The restaurant buzzer' }, { name: 'The club bouncer' }), false);
  assert.equal(ANALOGY_GATE_MAX, 0.5);
  assert.deepEqual(gateMisses({ false_mapping: 0.1, is_the_system: 0.2, real_names: 0.3 }), []);
  assert.deepEqual(gateMisses({ false_mapping: 0.5, is_the_system: 0.2, real_names: 0.9 }), [
    'its mapping teaches something false or misleading',
    'it names a real brand, person or character',
  ]);
  // A over B 0.8, B over A 0.4: A scores 0.7 and wins.
  assert.equal(compareScore(0.8, 0.4), 0.7);
  // Position bias cancels: Jev says "yes, the first" both times, so neither wins outright.
  assert.equal(compareScore(0.7, 0.7), 0.5);
  assert.equal(compareScore(0.2, 0.9), 0.15);
});

const noteOf = async (db: ExplainersDb, id: string) =>
  ((await getTopic(db, id))?.jev_notes as { analogy: Extract<AnalogyNote, { candidates: unknown }> }).analogy;

test("a topic that makes the pool gets its named analogy from two Opus calls and Jev's pick, then its curiosity gap", async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  // Jev prefers the second analogy in both orders.
  const { transport, calls } = stubJev(
    { Webhooks: STRONG, 'Everything about agents': BROAD },
    [],
    { golden: (concept, title) => (concept === 'webhook' && title === 'Webhooks' ? 0.92 : 0.05), compare: (a) => (a.startsWith('Thing 2') ? 0.8 : 0.3) },
  );
  const results = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [
    { title: 'Webhooks', origin: 'seeded' },
    { title: 'Everything about agents', origin: 'seeded' },
  ]);
  assert.deepEqual(results.map((r) => r.evaluation.outcome), ['entered_pool', 'rejected_gates']);
  assert.deepEqual(ideas.analogyRequests, ['webhooks', 'webhooks'], 'two calls; rejected topics get no analogy spend');
  assert.deepEqual(ideas.analogyCalls.map((c) => c.model), ['claude-opus-5-5', 'claude-opus-5-5'], 'analogy_model, Opus by default');
  assert.deepEqual(ideas.analogyCalls[0].hidden, ['webhook'], 'Jev hid the golden example that teaches this concept');
  assert.equal(calls.filter((c) => c.set === 'golden').length, 13, 'one golden match per example');

  const webhooks = (await getTopic(db, results[0].topicId))!;
  const note = await noteOf(db, results[0].topicId);
  assert.ok('pick' in note);
  assert.equal(note.version, 'analogy-writer-v8');
  assert.deepEqual(note.golden_hidden, ['webhook']);
  assert.equal(note.candidates.length, 2);
  assert.equal(note.pick, 1);
  assert.equal(note.pick_reason, 'compared');
  assert.deepEqual(note.comparison, { first_over_second: 0.3, second_over_first: 0.8, first_score: 0.25 });
  assert.equal(note.third, undefined, 'no third call when both pass');
  assert.equal(topicAnalogy(webhooks)?.name, 'Thing 2');
  // The comparison ran in both orders, and Jev never saw the golden set.
  const compares = calls.filter((c) => c.set === 'compare');
  assert.deepEqual(compares.map((c) => [String(c.state.a).split('\n')[0], String(c.state.b).split('\n')[0]]), [['Thing 1', 'Thing 2'], ['Thing 2', 'Thing 1']]);
  for (const c of calls.filter((x) => x.set === 'analogy_gates' || x.set === 'compare')) {
    assert.doesNotMatch(JSON.stringify(c.state), /restaurant buzzer|LEGO|open-book/i);
  }

  assert.equal(
    analogyMarkdown(topicAnalogy(webhooks)!),
    'Name: Thing 2\n\nThing 2 rings when something happens. Nobody has to keep checking.\n\n| Analogy | Concept |\n|---|---|\n| thing 2 | the real part |\n| other | another part |\n| the bell | the signal |\n\nThe reel shows the first three or four rows.',
  );
  // ai_focus is stored in jev_notes and counted in the weighted score (EX3-73).
  assert.equal((webhooks.jev_notes as { ai_focus?: number }).ai_focus, 2);
  assert.equal(Number(webhooks.weighted_score), weightedScore(STRONG));

  // An analogy from an older writer is picked again at render time (EX3-31).
  const old = { ...webhooks, jev_notes: { ...webhooks.jev_notes, analogy: { ...note, version: 'analogy-writer-v7' } } };
  assert.equal(topicAnalogy(old), null);
  assert.equal(topicAnalogy((await getTopic(db, results[1].topicId))!), null);

  const { rows } = await db.query<{ vendor: string; component: string; n: number }>(
    `SELECT vendor, component, count(*)::int AS n FROM explainers.cost_events
      WHERE component LIKE 'analogy%' GROUP BY vendor, component ORDER BY component`,
  );
  assert.deepEqual(rows, [
    { vendor: 'jev', component: 'analogy_compare', n: 2 },
    { vendor: 'jev', component: 'analogy_gates', n: 2 },
    { vendor: 'jev', component: 'analogy_golden_match', n: 13 },
    { vendor: 'anthropic', component: 'analogy_writer', n: 2 },
  ]);

  // The curiosity gap is written for the picked analogy right away (EX3-120), on the idea model.
  assert.equal(ideas.gapCalls.length, 1);
  assert.equal(ideas.gapCalls[0].analogy.name, 'Thing 2');
  assert.equal(ideas.gapCalls[0].model, 'claude-sonnet-5-5');
  assert.equal(ideas.gapCalls[0].term, 'webhooks');
  assert.equal(topicGap(webhooks, topicAnalogy(webhooks))?.question, 'How does it know what you want 1?', 'a tie keeps the first');
  const gapNote = (webhooks.jev_notes as { gap: GapNote }).gap;
  assert.equal(gapNote.version, GAP_WRITER_VERSION);
  assert.equal(gapNote.analogy_name, 'Thing 2');
  // A gap written for another analogy is written again.
  assert.equal(topicGap(webhooks, { name: 'Another thing' }), null);
});

test('both calls write the same analogy: it is taken, with no comparison (Lucas: "Accept")', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  ideas.writeAnalogy = async (request) => {
    ideas.analogyCalls.push(request);
    return { candidate: { ...candidate(1), name: ideas.analogyCalls.length === 1 ? 'The Bell' : 'bell' }, usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-opus-5-5' };
  };
  const { transport, calls } = stubJev({ Webhooks: STRONG });
  const [result] = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [{ title: 'Webhooks', origin: 'manual' }]);
  const note = await noteOf(db, result.topicId);
  assert.ok('pick' in note);
  assert.equal(note.pick, 0);
  assert.equal(note.pick_reason, 'same');
  assert.equal(calls.filter((c) => c.set === 'compare').length, 0);
});

test('one candidate passes: it wins; a gate or a code check fails the other', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  const { transport, calls } = stubJev({ Webhooks: STRONG }, [], { gates: (a) => (a.startsWith('Thing 1') ? { real_names: 0.85 } : {}) });
  const [result] = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [{ title: 'Webhooks', origin: 'manual' }]);
  const note = await noteOf(db, result.topicId);
  assert.ok('pick' in note);
  assert.equal(note.pick, 1);
  assert.equal(note.pick_reason, 'only_pass');
  assert.deepEqual(note.candidates[0].misses, ['it names a real brand, person or character']);
  assert.equal(note.candidates[0].gates?.real_names, 0.85);
  assert.equal(calls.filter((c) => c.set === 'compare').length, 0);

  // A candidate that breaks a code check never reaches Jev.
  const { db: db2 } = await scratchExplainersDb();
  const ideas2 = stubIdeas();
  ideas2.writeAnalogy = async (request) => {
    ideas2.analogyCalls.push(request);
    const c = candidate(ideas2.analogyCalls.length);
    return { candidate: ideas2.analogyCalls.length === 1 ? { ...c, explanation: 'Only one sentence here' } : c, usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-opus-5-5' };
  };
  const jev2 = stubJev({ Webhooks: STRONG });
  const [r2] = await addAndEvaluateTopics({ db: db2, jevTransport: jev2.transport, ideaModel: ideas2 }, [{ title: 'Webhooks', origin: 'manual' }]);
  const n2 = await noteOf(db2, r2.topicId);
  assert.ok('pick' in n2);
  assert.equal(n2.pick, 1);
  assert.equal(n2.candidates[0].gates, null);
  assert.match(n2.candidates[0].misses.join(), /1 sentences/);
  assert.equal(jev2.calls.filter((c) => c.set === 'analogy_gates').length, 1);
});

test('neither passes: a third call; it passes, it wins', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  const { transport } = stubJev({ Webhooks: STRONG }, [], { gates: (a) => (a.startsWith('Thing 3') ? {} : { false_mapping: 0.7 }) });
  const [result] = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [{ title: 'Webhooks', origin: 'manual' }]);
  assert.equal(ideas.analogyCalls.length, 3);
  assert.deepEqual(ideas.analogyCalls[2].hidden, ideas.analogyCalls[0].hidden, 'the third call sees the same examples');
  const note = await noteOf(db, result.topicId);
  assert.ok('pick' in note);
  assert.equal(note.pick, 2);
  assert.equal(note.pick_reason, 'third');
  assert.equal(note.third?.analogy?.name, 'Thing 3');
  assert.equal(topicAnalogy((await getTopic(db, result.topicId))!)?.name, 'Thing 3');
});

test('nothing passes in three calls: no pick, and the topic stays in the pool (EX3-125, supersedes EX3-104)', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  const { transport } = stubJev({ Webhooks: STRONG }, [], { gates: () => ({ is_the_system: 0.9 }) });
  const [result] = await addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: ideas }, [{ title: 'Webhooks', origin: 'manual' }]);
  assert.equal(result.evaluation.outcome, 'entered_pool');
  assert.equal(ideas.analogyCalls.length, 3);
  const topic = (await getTopic(db, result.topicId))!;
  assert.equal(topic.status, 'pool');
  assert.equal(topic.reject_reason, null);
  assert.equal(topicAnalogy(topic), null, 'the render tries again');
  const note = await noteOf(db, result.topicId);
  assert.ok('below_bar' in note && note.below_bar);
  assert.deepEqual(note.third?.misses, ['it is the real system at work, not a comparison']);
  assert.equal(ideas.gapCalls.length, 0, 'no gap without an analogy');
});

test('a writer call that fails is a failed candidate; a failed pass is recorded and never changes the evaluation', async () => {
  const { db } = await scratchExplainersDb();
  const ideas = stubIdeas();
  ideas.writeAnalogy = async (request) => {
    ideas.analogyCalls.push(request);
    if (ideas.analogyCalls.length === 1) throw new Error('analogy writer: the reply was not valid JSON');
    return { candidate: candidate(2), usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-opus-5-5' };
  };
  const [result] = await addAndEvaluateTopics({ db, jevTransport: stubJev({ Webhooks: STRONG }).transport, ideaModel: ideas }, [{ title: 'Webhooks', origin: 'manual' }]);
  const note = await noteOf(db, result.topicId);
  assert.ok('pick' in note);
  assert.equal(note.pick, 1);
  assert.equal(note.candidates[0].analogy, null);
  assert.match(note.candidates[0].misses.join(), /could not be used: analogy writer: the reply was not valid JSON/);

  // Jev failing mid-pass: the error is recorded on the topic, and it still makes the pool.
  const { db: db2 } = await scratchExplainersDb();
  const jev = stubJev({ Webhooks: STRONG });
  const failing: JevTransport = {
    async systemOne(state, questions) {
      if ('same_concept' in questions) throw new Error('Jev is down');
      return jev.transport.systemOne(state, questions);
    },
  };
  const [r2] = await addAndEvaluateTopics({ db: db2, jevTransport: failing, ideaModel: stubIdeas() }, [{ title: 'Webhooks', origin: 'manual' }]);
  assert.equal(r2.evaluation.outcome, 'entered_pool');
  const topic = (await getTopic(db2, r2.topicId))!;
  assert.match(((topic.jev_notes as { analogy: { error?: string } }).analogy.error ?? ''), /Jev is down/);
  assert.equal(topicAnalogy(topic), null, 'the render runs the pass again (EX3-31)');
});

test('the idea generator skews to AI and still asks for CS or tech (EX3-73); both write the term (EX3-86)', () => {
  assert.equal(IDEA_GENERATOR_VERSION, 'idea-generator-v5');
  assert.equal(SCOPE_WRITER_VERSION, 'scope-writer-v5');
  for (const prompt of [IDEA_GENERATOR_INSTRUCTIONS, SCOPE_WRITER_INSTRUCTIONS]) assert.ok(prompt.includes(TERM_RULE));
  assert.match(IDEA_GENERATOR_INSTRUCTIONS, /Exactly 2 of the 3 ideas teach an AI concept/);
  assert.match(IDEA_GENERATOR_INSTRUCTIONS, /The other idea teaches a computer-science or tech concept/);
  for (const prompt of [IDEA_GENERATOR_INSTRUCTIONS, SCOPE_WRITER_INSTRUCTIONS]) {
    assert.match(prompt, /one minute|one-minute/);
    assert.doesNotMatch(prompt, /45/);
  }
});

test('the generator and scope writer ask for the eight-beat shape, with no technical caveat (EX3-35)', () => {
  for (const prompt of [IDEA_GENERATOR_INSTRUCTIONS, SCOPE_WRITER_INSTRUCTIONS]) {
    assert.ok(prompt.includes(REEL_SHAPE));
    assert.doesNotMatch(prompt, /caveat|technical insight/);
  }
  // 3.9 (EX3-123): a well-known analogy whose defining trait is the concept, not a single everyday scene.
  assert.match(REEL_SHAPE, /one well-known analogy whose defining trait is the concept, that can carry the reel/);
  assert.doesNotMatch(REEL_SHAPE, /single scene|everyday analogy/);
});

// ── The curiosity gap writer (EX3-120) ──────────────────────────────────────

const gapScores = (v: number, overrides: Partial<GapScores> = {}): GapScores => ({ pull: v, clarity: v, closable: v, ...overrides });
const pickedAnalogy = candidate(2);

test('gap writer v2 writes for the most pull, with ways in, and keeps only the hard rules (EX3-120, EX3-123)', () => {
  assert.equal(GAP_WRITER_VERSION, 'gap-writer-v2');
  assert.match(GAP_WRITER_INSTRUCTIONS, /Nothing from the analogy appears in the line: not its name, and none of its parts, characters, places or actions\./);
  assert.doesNotMatch(GAP_WRITER_INSTRUCTIONS, /analogy's scene|analogy's process/);
  assert.match(GAP_WRITER_INSTRUCTIONS, /Your goal is engagement\. Write the opening question with the most pull for this topic/);
  assert.match(GAP_WRITER_INSTRUCTIONS, /- The everyday mystery:.*\n- The contradiction:.*\n- The stakes:.*\n- The impossible-seeming number:.*\n- The belief that's wrong:.*\n- The "you did this today":/);
  assert.match(GAP_WRITER_INSTRUCTIONS, /Jev scores your 3 candidates on pull, clarity, whether the analogy answers the question, and accuracy/);
  for (const rule of [/2\. About the real technology, never the analogy\./, /3\. True\./, /4\. End on the question\./, /5\. No term and no jargon/, /6\. 18 to 36 words/, /7\. The analogy can answer it/]) {
    assert.match(GAP_WRITER_INSTRUCTIONS, rule);
  }
  // The old formula and its whitelist are gone.
  assert.doesNotMatch(GAP_WRITER_INSTRUCTIONS, /named as they name it|relevance/);
  const item = (GAPS_SCHEMA.properties.candidates.items as { required: readonly string[] }).required;
  assert.deepEqual([...item], ['line', 'question', 'way_in', 'why_it_pulls']);
});

test('the gap writer caches its stable prefix; the topic, term and analogy go in the user message', () => {
  const request = { model: 'claude-sonnet-5-5', themeBrief: 'BRIEF', title: 'Webhooks', scope: 'Explain webhooks.', term: 'webhook', analogy: pickedAnalogy };
  const params = gapWriterParams(request);
  assert.deepEqual(params.output_config.format.schema, GAPS_SCHEMA);
  const system = params.system as { text: string; cache_control?: unknown }[];
  assert.ok(system[0].cache_control);
  assert.ok(system[0].text.startsWith(GAP_WRITER_INSTRUCTIONS));
  assert.ok(!system[0].text.includes('Webhooks'));
  const message = gapWriterUserMessage(request);
  assert.match(message, /^Topic: Webhooks\nLearning objective: Explain webhooks\.\nTerm \(never say it\): webhook\n/);
  assert.match(message, /Name: Thing 2\nThing 2 rings when something happens\. Nobody has to keep checking\.\n- thing 2: the real part\n- other: another part\n- the bell: the signal\n/);
  assert.ok(message.endsWith('Write exactly 3 candidates.'));
  const retry = gapWriterUserMessage({ ...request, retry: { previous: [{ line: 'A line?', misses: ['pull 1 of 4, under 3'] }] } });
  assert.match(retry, /Earlier candidates could not be picked:\n- "A line\?" \(pull 1 of 4, under 3\)/);
  assert.deepEqual(gapWriterParams({ ...request, retry: { previous: [] } }).system, params.system);
});

test('gap writer output must be exactly three non-empty, distinct candidates', () => {
  const three = [1, 2, 3].map((n) => gapLine(n));
  assert.equal(parseGaps({ candidates: three }).length, 3);
  assert.throws(() => parseGaps({ candidates: three.slice(0, 2) }), /exactly 3/);
  assert.throws(() => parseGaps({ candidates: [three[0], three[0], three[2]] }), /repeated/);
  assert.throws(() => parseGaps({ candidates: [{ ...three[0], question: ' ' }, three[1], three[2]] }), /missing a field/);
});

test('the gap code checks: its question last, no toss, no term, 18–36 words, nothing from the analogy', () => {
  const input = { term: 'webhook', analogy: pickedAnalogy };
  assert.deepEqual(gapCheckProblems(gapLine(1), input), []);
  const line = (text: string, question = 'How does it know?') => ({ ...gapLine(1), line: text, question });
  const base = 'You open an app every morning and it already shows the stories you like best before you even search.';
  assert.match(gapCheckProblems(line(`${base} How does it know? Stick around.`), input).join(), /does not end on its question/);
  assert.match(gapCheckProblems(line(`${base} Here's why it matters, how does it know?`, "Here's why it matters, how does it know?"), input).join(), /tosses to the next beat/);
  assert.match(gapCheckProblems(line(`${base} How does a webhook know?`, 'How does a webhook know?'), input).join(), /says the term "webhook"/);
  assert.match(gapCheckProblems(line('How does it know?'), input).join(), /4 words \(18 to 36\)/);
  assert.match(gapCheckProblems(line(`${base} How does the bell know?`, 'How does the bell know?'), input).join(), /names the analogy's world \(bell\)/);
  assert.match(gapCheckProblems(line(`${base} How does it know?`, 'Why?'), input).join(), /its question is not the last sentence/);
  // A word the real thing shares with the analogy is not the analogy's world (the DNS reel: a
  // "numbered page" stands for a "numeric IP address").
  const dns = { term: 'DNS', topic: 'What is DNS and how does a website name find its server?', analogy: { name: 'The cookbook index', mapping: [{ analogy: 'the numbered page with the recipe', concept: 'the web server at the numeric IP address' }, { analogy: 'the cookbook index', concept: 'the DNS lookup system' }] } };
  const numbers = line('You typed a website\'s name today, yet the internet only finds websites by number. So how does a name you can remember get turned into the right number?', 'So how does a name you can remember get turned into the right number?');
  assert.deepEqual(gapCheckProblems(numbers, dns), []);
  assert.match(gapCheckProblems(line(`${base} So who keeps the cookbook?`, 'So who keeps the cookbook?'), dns).join(), /names the analogy's world \(cookbook\)/);
  // Mapping rows are phrases: their pronouns and time words are not the analogy's world (the cache reel's live run).
  const fridge = { term: 'cache', analogy: { name: 'The kitchen fridge', mapping: [{ analogy: 'An empty shelf, so you go to the store and restock', concept: 'a cache miss' }, { analogy: 'Grabbing it from the fridge in seconds', concept: 'a cache hit' }] } };
  const second = line('The second time you open a website, it loads almost instantly, even though nothing about your internet changed. So where is your device finding the page so fast?', 'So where is your device finding the page so fast?');
  assert.deepEqual(gapCheckProblems(second, fridge), []);
  assert.match(gapCheckProblems(line(`${base} So what is in the fridge?`, 'So what is in the fridge?'), fridge).join(), /names the analogy's world \(fridge\)/);
});

test('the gap pick: pull weighs most; clarity and closable at least 3; a false claim is never picked', () => {
  assert.equal(gapTotal(gapScores(4)), 100);
  assert.equal(gapTotal(gapScores(2, { pull: 4 })), 75);
  assert.equal(pickGap([gapScores(3), gapScores(3, { pull: 4 }), gapScores(3.5)]), 1);
  // Same total: the one with more pull wins.
  assert.equal(pickGap([gapScores(3, { pull: 2, clarity: 4, closable: 4 }), gapScores(3, { pull: 4, clarity: 2, closable: 2 })]), 1);
  assert.equal(pickGap([gapScores(3), gapScores(3)]), 0);
  assert.deepEqual(gapMisses(gapScores(3), 0.1), []);
  assert.deepEqual(gapMisses(gapScores(4, { clarity: 2.9 }), 0.1), ['clarity 2.9 of 4, under 3']);
  assert.deepEqual(gapMisses(gapScores(4), 0.6), ['may state something untrue']);
});

test('chooseGap: Jev scores the lines that pass the code checks, code picks the most pull, BRIEF.md gets the pick', async () => {
  const { db } = await scratchExplainersDb();
  const [seeded] = await seedPool(db, [['Webhooks', STRONG]]);
  const ideas = stubIdeas();
  ideas.writeGaps = async (request) => {
    ideas.gapCalls.push(request);
    return { candidates: [{ ...gapLine(1), line: 'Too short? How?', question: 'How?' }, gapLine(2), gapLine(3)], usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-sonnet-5-5' };
  };
  const { transport, calls } = stubJev({}, [], { gap: (line) => (line.endsWith('want 3?') ? 4 : 3) });
  const topic = (await getTopic(db, seeded.topicId))!;
  const note = await chooseGap(
    { db, jev: new (await import('@/lib/explainers/jev/runner')).RecordingExplainersJevRunner(transport, db, { mode: 'development' }), ideaModel: ideas, model: 'm', mode: 'development', themeBrief: 'BRIEF' },
    topic,
    pickedAnalogy,
  );
  assert.ok('pick' in note);
  assert.deepEqual(note.pick, { pass: 0, index: 2 }, 'the most pull among the checked lines');
  assert.equal(note.passes[0].scores[0], null, 'a line that fails the code checks never reaches Jev');
  assert.match(note.passes[0].misses[0].join(), /words/);
  assert.equal(calls.filter((c) => c.set === 'gap').length, 2);
  const md = gapMarkdown(note);
  assert.match(md, /^Say this line in frame 2, word for word \(written by the gap writer, picked by Jev, EX3-120\):\n\n> You open an app .* How does it know what you want 3\?\n\n- gap_question: How does it know what you want 3\?\n- way in: everyday mystery\n- score: 100 of 100\n/);
  assert.match(md, /The other candidates \(for reference only; never use them\):\n- "Too short\? How\?" \(not scored; .*words/);
  const stored = (await getTopic(db, seeded.topicId))!;
  assert.equal(topicGapNote(stored, pickedAnalogy)?.version, GAP_WRITER_VERSION);
});

test('no gap can be picked: one retry told why, then below the bar; the topic stays (EX3-120)', async () => {
  const { db } = await scratchExplainersDb();
  const [seeded] = await seedPool(db, [['Webhooks', STRONG]]);
  const ideas = stubIdeas();
  const { transport } = stubJev({}, [], { gap: () => 1 });
  const { RecordingExplainersJevRunner } = await import('@/lib/explainers/jev/runner');
  const note = await chooseGap(
    { db, jev: new RecordingExplainersJevRunner(transport, db, { mode: 'development' }), ideaModel: ideas, model: 'm', mode: 'development', themeBrief: 'BRIEF' },
    (await getTopic(db, seeded.topicId))!,
    pickedAnalogy,
  );
  assert.equal(MAX_GAP_PASSES, 2);
  assert.ok('below_bar' in note && note.below_bar);
  assert.equal(ideas.gapCalls.length, 1 + 1, 'the seed pass is not counted here; one call and one retry');
  assert.match(JSON.stringify(ideas.gapCalls[1].retry?.previous[0].misses), /pull 1 of 4, under|clarity 1 of 4, under 3/);
  const topic = (await getTopic(db, seeded.topicId))!;
  assert.equal(topic.status, 'pool');
  assert.equal(topicGap(topic, pickedAnalogy), null);
});
