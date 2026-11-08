/**
 * Ideas coverage (planning/Explainer Reels/ideas-coverage/PLAN.md, 2026-11-03), offline on PGlite with the real schema
 * and a stubbed idea model and Jev (no live calls): the bucket pick, the free term check, seeds that auto-win or are
 * blocked, a generator request that carries only tonight's buckets' history, and the altitude check's one rewrite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { BUCKETS, BUCKET_IDS, RENDERED_BUCKETS, bucketCoverage, normalizeTerm, pickBuckets, topicBucket } from '@/lib/explainers/ideas/coverage';
import { addAndEvaluateTopics, frameMissingPoolTopics, runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import { sameTermTopic } from '@/lib/explainers/ideas/evaluate';
import type { IdeaModel, IdeaRequest, LessonFrame, PayloadRequest } from '@/lib/explainers/ideas/generator';
import { getTopic } from '@/lib/explainers/repository';
import { DEFAULT_SETTINGS, saveSetting } from '@/lib/explainers/settings';
import type { TopicRow } from '@/lib/explainers/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

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

function ideas(frame: LessonFrame = FRAME): IdeaModel & { payloadCalls: PayloadRequest[]; proposals: IdeaRequest[]; scopeCalls: string[][] } {
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
      const ids = request.buckets.map((b) => b.id);
      return { ideas: ids.map((id, n) => ({ topic_title: `Idea ${n}`, topic_scope: 'Explain it.', term: `idea ${n}`, ...frame, bucket: id })), usage, model: 'claude-sonnet-5-5' };
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

async function topic(db: ExplainersDb, fields: { title: string; term?: string; bucket?: string | null; status: string; daysAgo?: number }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, term, bucket, origin, status, scope, weighted_score, rendered_at)
     VALUES ($1, $2, $3, 'generated', $4, 'S', 60, CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(days => $5::int) END)
     RETURNING id`,
    [fields.title, fields.term ?? null, fields.bucket ?? null, fields.status, fields.daysAgo ?? null],
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

test('pickBuckets: least renders in the window first, then the oldest last render; 2 AI then 1 CS', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const at = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const rendered = [
    // Every AI bucket but two has a recent render; those two are covered only long ago, one older than the other.
    ...BUCKETS.filter((b) => b.kind === 'ai' && b.id !== 'running-models' && b.id !== 'training-and-tuning').map((b) => ({ bucket: b.id, term: null, title: b.name, rendered_at: at(10) })),
    { bucket: 'running-models', term: null, title: 'x', rendered_at: at(200) },
    { bucket: 'training-and-tuning', term: null, title: 'y', rendered_at: at(300) },
    // CS: every bucket but one has a render in the window; by term through the one-time map.
    ...BUCKETS.filter((b) => b.kind === 'cs' && b.id !== 'how-software-is-built').map((b) => ({ bucket: b.id, term: null, title: b.name, rendered_at: at(5) })),
    { bucket: null, term: 'Webhook', title: 'Webhooks?', rendered_at: at(1) },
  ];
  const coverage = bucketCoverage(rendered, now);
  assert.equal(coverage['web-and-apis'].renders, 2, 'mapped by term when the bucket column is empty');
  assert.equal(coverage['running-models'].renders, 0, 'outside the 120-day window');
  assert.deepEqual(pickBuckets(coverage, { ai: 2, cs: 1 }).map((b) => b.id), ['training-and-tuning', 'running-models', 'how-software-is-built']);
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

test("the generator request carries only tonight's buckets' renders from the last 90 days, plus the pool", async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  // Covered recently, so not picked tonight.
  for (const b of BUCKETS.filter((x) => x.id !== 'retrieval-and-memory' && x.id !== 'reliability-and-safety' && x.id !== 'data-and-databases')) {
    await topic(db, { title: `Recent ${b.id}`, bucket: b.id, status: 'rendered', daysAgo: 3 });
  }
  // Tonight's buckets: one render each long enough ago to sort them, one inside 90 days and one outside it.
  await topic(db, { title: 'Old retrieval', bucket: 'retrieval-and-memory', status: 'rendered', daysAgo: 100 });
  await topic(db, { title: 'Older safety', bucket: 'reliability-and-safety', status: 'rendered', daysAgo: 150 });
  await topic(db, { title: 'Pool one', bucket: 'how-llms-work', status: 'pool' });
  const model = ideas();
  const result = await runIdeaCycle({ db, ideaModel: model, jevTransport: jev() });
  assert.equal(result.status, 'ok');
  const [request] = model.proposals;
  assert.deepEqual(request!.buckets.map((b) => b.id), ['reliability-and-safety', 'retrieval-and-memory', 'data-and-databases']);
  assert.deepEqual(request!.rendered, [], 'nothing from other buckets, nothing older than 90 days');
  assert.deepEqual(request!.pool.map((p) => p.topic_title), ['Pool one']);
  assert.equal(request!.historyDays, 90);
  const added = await db.query<{ bucket: string; lesson_altitude: string }>(`SELECT bucket, lesson_altitude FROM explainers.topics WHERE title LIKE 'Idea %' ORDER BY title`);
  assert.deepEqual(added.rows.map((r) => r.bucket), ['reliability-and-safety', 'retrieval-and-memory', 'data-and-databases']);
  assert.ok(added.rows.every((r) => r.lesson_altitude === 'unfamiliar'));
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
