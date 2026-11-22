/**
 * Ideas coverage (planning/Explainer Reels/ideas-coverage/PLAN.md, 2026-11-03), offline on PGlite with the real schema
 * and a stubbed idea model and Jev (no live calls): the bucket pick, the free term check, seeds that auto-win or are
 * blocked, the curriculum's assigned topics in the generator request (2026-11-21), and the altitude check's one rewrite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { BUCKETS, BUCKET_IDS, RENDERED_BUCKETS, normalizeTerm, topicBucket } from '@/lib/explainers/ideas/coverage';
import { addAndEvaluateTopics, frameMissingPoolTopics, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { CURRICULUM } from '@/lib/explainers/ideas/curriculum';
import { SYLLABUS } from '@/lib/explainers/ideas/syllabus';
import { sameTermTopic } from '@/lib/explainers/ideas/evaluate';
import type { IdeaModel, IdeaRequest, LessonFrame, PayloadRequest } from '@/lib/explainers/ideas/generator';
import { fillCandidates } from '@/lib/explainers/publish/schedule';
import { getTopic, listPool } from '@/lib/explainers/repository';
import { DEFAULT_SETTINGS, saveSetting } from '@/lib/explainers/settings';
import type { TopicRow } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';
import { fakeTotalLedger } from './helpers/refill-total-fake';

const FRAME: LessonFrame = { bucket: 'web-and-apis', payload: 'The one thing.', altitude: 'unfamiliar', map_position: 'Where it sits.' };

/** Every score 4; duplicate questions answer `duplicate`; the altitude question answers `familiar`. */
function jev(duplicate = 0.1, familiar = 0.1): JevTransport & { keys: string[][] } {
  const keys: string[][] = [];
  return {
    keys,
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      void state;
      const answers: Record<string, unknown> = {};
      keys.push(Object.keys(questions));
      for (const key of Object.keys(questions)) {
        answers[key] =
          key === 'duplicate_of_existing_topic' || key.startsWith('pair_')
            ? { type: 'noul', noul: duplicate }
            : key === 'viewer_knows_word'
              ? { type: 'noul', noul: familiar }
              : { type: 'score', score: 4, confidence: 1 };
      }
      return { model: 'jev-stub', answers, usage: { input_tokens: 10, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

function ideas(frame: LessonFrame = FRAME, terms?: (request: IdeaRequest) => string[]): IdeaModel & { payloadCalls: PayloadRequest[]; proposals: IdeaRequest[]; scopeCalls: string[][] } {
  const payloadCalls: PayloadRequest[] = [];
  const proposals: IdeaRequest[] = [];
  const scopeCalls: string[][] = [];
  const usage = { input_tokens: 10, output_tokens: 10 };
  return {
    payloadCalls,
    proposals,
    scopeCalls,
    async writeScopes(request) {
      scopeCalls.push([...request.titles]);
      return { scopes: request.titles.map((t) => `Explain ${t}.`), terms: request.titles.map((t) => t.toLowerCase()), frames: request.titles.map(() => ({ ...frame })), usage, model: 'claude-sonnet-5-5' };
    },
    async propose(request) {
      proposals.push(request);
      // By default each idea takes its assigned term, as the generator is told to; `terms` lets a test answer otherwise.
      const written = terms ? terms(request) : request.topics.map((t) => t.term);
      return { ideas: written.map((term, n) => ({ topic_title: `Idea ${n}`, topic_scope: 'Explain it.', term, ...frame })), usage, model: 'claude-sonnet-5-5' };
    },
    async rewritePayload(request) {
      payloadCalls.push(request);
      return { payload: `Past the definition (${request.altitude}).`, usage, model: 'claude-sonnet-5-5' };
    },
    async writeAnalogy() {
      throw new Error('not used');
    },
    async writeGaps() {
      throw new Error('not used');
    },
  };
}

async function topic(db: ExplainersDb, fields: { title: string; term?: string; bucket?: string | null; status: string; daysAgo?: number; rank?: number; score?: number }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, term, bucket, origin, status, scope, weighted_score, rendered_at, syllabus_rank)
     VALUES ($1, $2, $3, 'generated', $4, 'S', $6, CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(days => $5::int) END, $7)
     RETURNING id`,
    [fields.title, fields.term ?? null, fields.bucket ?? null, fields.status, fields.daysAgo ?? null, fields.score ?? 60, fields.rank ?? null],
  );
  return rows[0]!.id;
}

const seed = (db: ExplainersDb, title: string, transport: JevTransport, model = ideas()) =>
  addAndEvaluateTopics({ db, jevTransport: transport, ideaModel: model }, [{ title, origin: 'manual' }]);

// ── Pure pieces ─────────────────────────────────────────────────────────────

test('thirteen buckets, seven AI and six CS; every rendered term maps to a real bucket; settings are 120 and 90 days', () => {
  assert.equal(BUCKETS.length, 13);
  assert.equal(BUCKETS.filter((b) => b.kind === 'ai').length, 7);
  for (const id of Object.values(RENDERED_BUCKETS)) assert.ok(BUCKET_IDS.includes(id), id);
  assert.equal(RENDERED_BUCKETS['what is a context window?'], 'prompts-and-context');
  assert.equal(DEFAULT_SETTINGS.dedupe_lookback_days, 120);
  assert.equal(DEFAULT_SETTINGS.prompt_history_days, 90);
});

test('term normalization and the free match: case, punctuation and simple plurals', () => {
  assert.equal(normalizeTerm('  Vector Databases! '), 'vector database');
  assert.equal(normalizeTerm('Hallucinations'), 'hallucination');
  assert.equal(normalizeTerm('Retries'), 'retry');
  assert.equal(normalizeTerm('class'), 'class');
  const row = (id: string, term: string | null, title = id) => ({ id, term, title }) as TopicRow;
  const topics = [row('a', 'Embeddings'), row('b', null, 'Rate limits')];
  assert.equal(sameTermTopic(row('c', 'embedding'), topics)?.id, 'a');
  assert.equal(sameTermTopic(row('d', 'rate-limit'), topics)?.id, 'b');
  assert.equal(sameTermTopic(row('e', 'embedding model'), topics), null);
  assert.equal(topicBucket({ bucket: null, term: 'MCP', title: 'x' }), 'agents-and-tools');
});

// ── Seeds ───────────────────────────────────────────────────────────────────

test('a seed whose term matches a pool topic auto-wins: the pool topic is displaced', async () => {
  const { db } = await scratchExplainersDb();
  const incumbent = await topic(db, { title: 'What is a webhook?', term: 'webhook', bucket: 'web-and-apis', status: 'pool' });
  const [r] = await seed(db, 'Webhooks', jev());
  assert.equal(r!.evaluation.outcome, 'entered_pool');
  assert.deepEqual(r!.evaluation, { outcome: 'entered_pool', score: (r!.evaluation as { score: number }).score, flags: ['near_pool_topic'], displacedId: incumbent });
  assert.equal((await getTopic(db, r!.topicId))?.status, 'pool');
  const old = await getTopic(db, incumbent);
  assert.equal(old?.status, 'displaced');
  assert.equal(old?.duplicate_of, r!.topicId);
});

test('a seed Jev matches to a pool topic auto-wins too', async () => {
  const { db } = await scratchExplainersDb();
  const incumbent = await topic(db, { title: 'A pool idea', term: 'something', bucket: 'web-and-apis', status: 'pool' });
  const [r] = await seed(db, 'A near twin', jev(0.9));
  assert.equal((r!.evaluation as { displacedId?: string }).displacedId, incumbent);
  assert.equal((await getTopic(db, incumbent))?.status, 'displaced');
});

test('a seed that repeats a render from the last 120 days is blocked, naming the earlier topic', async () => {
  const { db } = await scratchExplainersDb();
  const earlier = await topic(db, { title: 'Why LLMs hallucinate', term: 'hallucinations', bucket: 'web-and-apis', status: 'rendered', daysAgo: 100 });
  const [r] = await seed(db, 'Why do LLMs make things up?', jev(0.9));
  assert.equal(r!.evaluation.outcome, 'rejected_history_duplicate');
  const row = await getTopic(db, r!.topicId);
  assert.equal(row?.status, 'rejected');
  assert.match(row?.reject_reason ?? '', /Repeats "Why LLMs hallucinate", rendered in the last 120 days/);
  assert.equal(row?.duplicate_of, earlier);
  // The free term check blocks across buckets, with no Jev duplicate call.
  await topic(db, { title: 'Tokens', term: 'token', bucket: 'how-llms-work', status: 'rendered', daysAgo: 20 });
  const transport = jev();
  const [same] = await seed(db, 'Token', transport);
  assert.equal(same!.evaluation.outcome, 'rejected_history_duplicate');
  assert.ok(!transport.keys.flat().includes('duplicate_of_existing_topic'));
});

// ── The generator request ───────────────────────────────────────────────────

test('the curriculum assigns tonight\'s topics: the first untaken syllabus terms with level, unit and prerequisites; ideas off them are dropped', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  // Passed over: the first syllabus term, rejected twice. Taken: an aka of the second, rendered. The third failed once only.
  await topic(db, { title: 'What is AI?', term: 'AI', status: 'rendered', daysAgo: 200 });
  for (const n of [1, 2]) await topic(db, { title: `Algorithms ${n}`, term: 'algorithm', status: 'rejected' });
  await topic(db, { title: 'Rules', term: 'rule-based system', status: 'rejected' });
  await topic(db, { title: 'Pool one', status: 'pool' });
  // the failed tries were syllabus ideas (they carry a rank); only those count
  await db.query(`UPDATE explainers.topics SET syllabus_rank = 0 WHERE status = 'rejected'`);
  // Lead time (Bald-Eagle D4, D8): earlier nights filled today and tomorrow, so this night runs one cycle (for day+2).
  for (const n of [0, 1]) {
    const d = new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    await db.query(`INSERT INTO explainers.idea_cycles (status, mode, ny_date) VALUES ('ok', 'development', $1::date)`, [d]);
  }
  // The stub answers the first topic in other spacing and case, the second by its aka, the third off the syllabus.
  const model = ideas(FRAME, () => ['Rule-Based  System', 'ML', 'blockchain']);
  const result = await runIdeaCycle({ db, ideaModel: model, jevTransport: jev(), totalQuery: fakeTotalLedger().q });
  assert.equal(result.status, 'ok', result.status === 'failed' ? result.error : '');
  const [request] = model.proposals;
  assert.deepEqual(request!.topics.map((t) => t.term), ['rule-based system', 'binary', 'machine learning']);
  const first = request!.topics[0]!;
  assert.deepEqual([first.level, first.levelName, first.unitName, first.requires], [1, SYLLABUS[0]!.name, 'What AI is', ['artificial intelligence', 'algorithm']]);
  assert.equal(first.angle, CURRICULUM[2]!.angle, 'each assigned topic carries its angle');
  assert.deepEqual(request!.pool.map((p) => p.topic_title), ['Pool one']);
  const added = await db.query<{ term: string; syllabus_rank: number; bucket: string }>(
    `SELECT term, syllabus_rank, bucket FROM explainers.topics WHERE title LIKE 'Idea %' ORDER BY syllabus_rank`,
  );
  assert.deepEqual(added.rows.map((r) => [r.term, r.syllabus_rank]), [['rule-based system', 2], ['machine learning', 4]], 'exact assigned terms; the stray idea is dropped');
  assert.ok(added.rows.every((r) => r.bucket === FRAME.bucket), 'each idea still labels its bucket');
  if (result.status === 'ok') assert.equal((await getTopic(db, result.promotedTopicId!))?.term, 'rule-based system', 'the night makes the earliest syllabus topic');
  const { rows: [cycle] } = await db.query<{ ideas_generated: number }>(`SELECT ideas_generated FROM explainers.idea_cycles WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1`);
  assert.equal(cycle!.ideas_generated, 2);
});

test('the night fill follows the syllabus first, then the score; topics off the syllabus come last', async () => {
  const { db } = await scratchExplainersDb();
  const late = await topic(db, { title: 'Late', status: 'pool', rank: 40, score: 50 });
  const early = await topic(db, { title: 'Early', status: 'pool', rank: 1, score: 40 });
  const off = await topic(db, { title: 'Off the syllabus', status: 'pool', score: 99 });
  assert.deepEqual((await fillCandidates(db, false)).map((c) => c.topicId), [early, late, off]);
  assert.deepEqual((await listPool(db)).map((t) => t.id), [early, late, off], 'POOL_ORDER_BY agrees');
});

// ── The altitude check ──────────────────────────────────────────────────────

test('altitude: Jev disagrees (familiar), so exactly one call rewrites the payload; agreement costs nothing', async () => {
  const { db } = await scratchExplainersDb();
  const model = ideas();
  const [r] = await seed(db, 'Bias', jev(0.1, 0.9), model);
  assert.equal(model.payloadCalls.length, 1);
  assert.equal(model.payloadCalls[0]!.altitude, 'familiar');
  const row = await getTopic(db, r!.topicId);
  assert.equal(row?.lesson_altitude, 'familiar');
  assert.equal(row?.lesson_payload, 'Past the definition (familiar).');
  assert.equal(row?.lesson_map, 'Where it sits.');
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM explainers.cost_events WHERE component = 'payload_rewriter'`);
  assert.equal(rows[0]!.n, 1);

  const agree = ideas();
  await seed(db, 'OAuth', jev(0.1, 0.1), agree);
  assert.equal(agree.payloadCalls.length, 0);
  // Embedded stays unless Jev says familiar.
  const embedded = ideas({ ...FRAME, altitude: 'embedded' });
  await seed(db, 'Index', jev(0.1, 0.2), embedded);
  assert.equal(embedded.payloadCalls.length, 0);
  // A near coin-flip leaves the generator's label alone (ALTITUDE_MARGIN).
  const close = ideas({ ...FRAME, altitude: 'familiar' });
  await seed(db, 'Prompt', jev(0.1, 0.49), close);
  assert.equal(close.payloadCalls.length, 0);
});

test('frameMissingPoolTopics frames pool topics that lack a frame in one call, and touches nothing else', async () => {
  const { db } = await scratchExplainersDb();
  const bare = await topic(db, { title: 'Bare', status: 'pool' });
  await topic(db, { title: 'Rendered bare', status: 'rendered', daysAgo: 2 });
  const model = ideas();
  const { framed } = await frameMissingPoolTopics({ db, ideaModel: model });
  assert.deepEqual(framed, [bare]);
  assert.deepEqual(model.scopeCalls, [['Bare']]);
  const row = await getTopic(db, bare);
  assert.equal(row?.bucket, 'web-and-apis');
  assert.equal(row?.scope, 'S', 'the scope is kept');
});
