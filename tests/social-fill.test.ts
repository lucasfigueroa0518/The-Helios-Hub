/**
 * The daily fill rule (Tommy, 2026-10-08; DECISIONS_LOG D54/D55), for every
 * content type, offline: the real schema files on PGlite, stubbed stages,
 * Jev, idea model and copy client. No Claude, no Jev, no Instagram.
 *
 *   - quota − what people placed for the day is what the night makes;
 *   - nothing left: the night makes nothing;
 *   - placements on other days or of other types, and cancelled or failed
 *     ones, don't count;
 *   - surviving content that ranks in is allocated without a render or any
 *     spend; surviving content below the cut is not.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { runIdeaCycle } from '@/lib/explainers/ideas/cycle';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { explainerItemId, spineOf } from '@/lib/explainers/publish/items';
import { fillCandidates, scheduleApproved } from '@/lib/explainers/publish/schedule';
import { saveFeedback } from '@/lib/explainers/repository';
import { saveSetting } from '@/lib/explainers/settings';
import type { ScoreKey } from '@/lib/explainers/types';
import { fillSlots, type SlotIdea } from '@/lib/reels/copy/slots';
import type { CopyClient } from '@/lib/reels/copy/writer';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { placedIdeas, reelsFill, reelsTonight, reusableVideos } from '@/lib/reels/pipeline/fill';
import { generatePassingReels } from '@/lib/reels/pipeline/slots';
import { windowsStillOpen } from '@/lib/reels/publish/schedule';
import { dailyFill, dailyFillOrQuota, fillReduced, remainingQuota, reportFill, userPlaced, type FillLog } from '@/lib/social-hub/fill';
import { bookSlot, ensureContentItem, rejectItem, type SpineQuery, type SpineVertical } from '@/lib/social-hub/spine';
import { carouselItemId } from '@/lib/social/overnight/items';
import { requestRun, skipRun } from '@/lib/social/overnight/runs';
import { carouselFill, nightStories, scheduleRunPosts } from '@/lib/social/overnight/schedule';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import type { StageName } from '@/lib/social/pipeline/types';
import { recordShipList, storedPostFor, storyOnCalendar, type Query } from '@/lib/social/store/pg';
import { requestAutoSets, seriesDayPlaced } from '@/lib/stories/schedule';
import { loadSettings, saveSeriesSetting } from '@/lib/stories/settings';

import { scratchExplainersDb } from './explainers-pglite';
import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

const TODAY = '2026-10-08';
const TOMORROW = '2026-10-09';

/** Capture fill lines instead of printing them. */
function capture(): { log: FillLog; lines: Array<{ message: string; fields: Record<string, unknown> }> } {
  const lines: Array<{ message: string; fields: Record<string, unknown> }> = [];
  return { lines, log: (message, fields) => lines.push({ message, fields }) };
}

/** A person's (or the night's) slot on the spine, straight through the one schedule insert. */
async function slot(
  query: SpineQuery,
  o: { vertical: SpineVertical; nyDate: string; slot: string; source: 'auto' | 'user'; status?: string; itemId?: string | null; ideaRef?: string | null; at?: string },
): Promise<string> {
  const itemId =
    o.itemId !== undefined
      ? o.itemId
      : o.vertical === 'reels'
        ? null
        : await ensureContentItem(query, { vertical: o.vertical, format: o.vertical === 'carousels' ? 'feed' : o.vertical === 'stories' ? 'story' : 'reel', nativeRef: `hand-${Math.random()}`, ideaRef: null });
  const ideaRef = o.ideaRef ?? (o.vertical === 'reels' ? `idea-${Math.random()}` : null);
  const publishAt = new Date(o.at ?? `${o.nyDate}T18:00:00Z`);
  if (!o.status || o.status === 'scheduled') {
    return (await bookSlot(query, { vertical: o.vertical, itemId, ideaRef, nyDate: o.nyDate, slot: o.slot, publishAt, source: o.source })).id;
  }
  // A slot that already ended (posted, cancelled, failed), written as it would stand.
  const { rows } = await query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, idea_ref, ny_date, slot, publish_at, status, source)
     VALUES ($1, $2, $3, $4::date, $5, $6::timestamptz, $7, $8) RETURNING id`,
    [itemId, o.vertical, ideaRef, o.nyDate, o.slot, publishAt.toISOString(), o.status, o.source],
  );
  return rows[0].id as string;
}

// ── The shared rule ─────────────────────────────────────────────────────────

test('remainingQuota: quota less placements, never negative; a missing quota makes nothing', () => {
  assert.equal(remainingQuota(2, 0), 2);
  assert.equal(remainingQuota(2, 1), 1);
  assert.equal(remainingQuota(2, 2), 0);
  assert.equal(remainingQuota(2, 5), 0, 'never negative');
  assert.equal(remainingQuota(3, -1), 3);
  assert.equal(remainingQuota(0, 0), 0);
  assert.equal(remainingQuota(Number.NaN, 0), 0);
});

test('userPlaced counts only a person’s waiting, posting or posted slots for that type and day', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  await slot(q, { vertical: 'carousels', nyDate: TODAY, slot: 'morning', source: 'user' });
  await slot(q, { vertical: 'carousels', nyDate: TODAY, slot: 'afternoon', source: 'user', status: 'published' });
  await slot(q, { vertical: 'carousels', nyDate: TODAY, slot: 'morning', source: 'user', status: 'cancelled' });
  await slot(q, { vertical: 'carousels', nyDate: TODAY, slot: 'afternoon', source: 'user', status: 'failed' });
  await slot(q, { vertical: 'carousels', nyDate: TOMORROW, slot: 'morning', source: 'user' });
  await slot(q, { vertical: 'explainers', nyDate: TODAY, slot: 'afternoon', source: 'user' });
  await slot(q, { vertical: 'stories', nyDate: TODAY, slot: 'guess_the_number', source: 'user' });
  assert.equal(await userPlaced(q, 'carousels', TODAY), 2, 'scheduled + published; cancelled and failed never count');
  assert.equal(await userPlaced(q, 'carousels', TOMORROW), 1);
  assert.equal(await userPlaced(q, 'explainers', TODAY), 1);
  assert.equal(await userPlaced(q, 'reels', TODAY), 0);
  assert.equal(await userPlaced(q, 'stories', TODAY, { slot: 'guess_the_number' }), 1);
  assert.equal(await userPlaced(q, 'stories', TODAY, { slot: 'morning_download' }), 0);

  const fill = await dailyFill(q, 'carousels', TODAY, 2);
  assert.deepEqual(fill, { vertical: 'carousels', nyDate: TODAY, quota: 2, userPlaced: 2, making: 0 });
  const { log, lines } = capture();
  assert.equal(reportFill(fill, log, { runId: 'r' }), true);
  assert.deepEqual(lines, [{ message: 'fill_reduced', fields: { vertical: 'carousels', nyDate: TODAY, quota: 2, userPlaced: 2, making: 0, runId: 'r' } }]);
  assert.equal(fillReduced(await dailyFill(q, 'reels', TODAY, 3)), false, 'nothing placed: nothing logged');
  assert.equal(reportFill(await dailyFill(q, 'reels', TODAY, 3), log), false);

  // A read that fails never stalls a night: the whole quota, and the error is reported.
  const errors: unknown[] = [];
  const broken: SpineQuery = async () => { throw new Error('relation "social_hub.schedule" does not exist'); };
  assert.deepEqual(await dailyFillOrQuota(broken, 'explainers', TODAY, 2, (e) => errors.push(e)), { vertical: 'explainers', nyDate: TODAY, quota: 2, userPlaced: 0, making: 2 });
  assert.equal(errors.length, 1);
});

// ── Carousels (the 3 AM run) ────────────────────────────────────────────────

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function carouselDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}

async function post(query: Query, slug: string, storyId: string, runId: string | null = null): Promise<string> {
  const slides = JSON.stringify(['a', 'b', 'c'].map((f) => `posts/${slug}/${f}.jpg`));
  const { rows } = await query(
    `INSERT INTO social.posts (run_id, slug, story_id, title, status, render, origin, slide_objects)
     VALUES ($1, $2, $3, 't', 'review', $4::jsonb, 'pipeline', $5::jsonb) RETURNING id`,
    [runId, slug, storyId, JSON.stringify({ caption: 'c', attributionBlock: null, slides: [] }), slides],
  );
  return rows[0].id as string;
}

/** A carousel a person placed: its post's item in a `user` slot. */
async function placeCarousel(query: Query, o: { nyDate: string; slot: 'morning' | 'afternoon'; storyId?: string; status?: string; source?: 'auto' | 'user' }) {
  const tag = Math.random().toString(36).slice(2, 10);
  const postId = await post(query, `placed-${tag}`, o.storyId ?? `story-placed-${tag}`);
  const itemId = (await carouselItemId(query, postId))!;
  const at = o.slot === 'morning' ? `${o.nyDate}T13:20:00Z` : `${o.nyDate}T18:50:00Z`;
  await slot(query, { vertical: 'carousels', nyDate: o.nyDate, slot: o.slot, source: o.source ?? 'user', status: o.status, itemId, at });
  return postId;
}

const NIGHT = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York

test('carousels: posts_per_day less today’s placements is the run’s target; other days, other types, the night’s own and cancelled or failed slots don’t count', async () => {
  const query = await carouselDb();
  assert.deepEqual(await carouselFill(query, NIGHT), { vertical: 'carousels', nyDate: TODAY, quota: 2, userPlaced: 0, making: 2 });

  await placeCarousel(query, { nyDate: TOMORROW, slot: 'morning' });
  await placeCarousel(query, { nyDate: TODAY, slot: 'morning', source: 'auto' });
  await placeCarousel(query, { nyDate: TODAY, slot: 'afternoon', status: 'cancelled' });
  await placeCarousel(query, { nyDate: TODAY, slot: 'afternoon', status: 'failed' });
  await slot(query, { vertical: 'explainers', nyDate: TODAY, slot: 'afternoon', source: 'user' });
  assert.equal((await carouselFill(query, NIGHT)).making, 2, 'none of those are a person’s placement for today');

  await query(`UPDATE social_hub.schedule SET status = 'cancelled' WHERE vertical = 'carousels' AND source = 'auto'`);
  await placeCarousel(query, { nyDate: TODAY, slot: 'morning' });
  const fill = await carouselFill(query, NIGHT);
  assert.deepEqual([fill.quota, fill.userPlaced, fill.making], [2, 1, 1]);
  assert.equal(nightStories(fill, 2), 1, 'the run makes one story');
  assert.equal(nightStories(fill, 0), 0, 'run_stories still caps it');
  assert.equal(nightStories({ ...fill, making: 2 }, 1), 1);

  await query(`INSERT INTO social.settings (key, value) VALUES ('posts_per_day', '3'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  assert.equal((await carouselFill(query, NIGHT)).making, 2, 'the quota is posts_per_day');
});

test('carousels: people placed the whole day: nothing to make, nothing to schedule, the run is skipped with why', async () => {
  const query = await carouselDb();
  await placeCarousel(query, { nyDate: TODAY, slot: 'morning' });
  await placeCarousel(query, { nyDate: TODAY, slot: 'afternoon', status: 'published' });
  const fill = await carouselFill(query, NIGHT);
  assert.equal(fill.making, 0);
  assert.equal(nightStories(fill, 2), 0);

  const runId = (await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true }))!;
  await query(`UPDATE social.runs SET status = 'running', started_at = now() WHERE id = $1`, [runId]);
  await skipRun(query, runId, 'Daily fill: people placed 2 carousels.');
  const run = (await query(`SELECT status, stop_reason, error, finished_at FROM social.runs WHERE id = $1`, [runId])).rows[0];
  assert.deepEqual([run.status, run.stop_reason, run.error], ['skipped', 'quota-filled', 'Daily fill: people placed 2 carousels.']);
  assert.ok(run.finished_at);

  // Even a run that shipped something schedules nothing over a filled day.
  const fresh = await post(query, 'fresh', 'story-z', runId);
  await recordShipList(query, runId, [fresh]);
  const out = await scheduleRunPosts(query, runId, NIGHT, () => 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.scheduled, false);
  assert.match((out[0] as { note: string }).note, /people placed 2 carousels for 2026-10-08, which covers the day's quota of 2/);
  assert.equal((await query(`SELECT count(*)::int AS n FROM social_hub.schedule WHERE status = 'scheduled' AND source = 'auto'`)).rows[0].n, 0);
});

test('carousels: a stored post that ranks first takes the night’s one remaining place with no stage run, and the free window', async () => {
  const query = await carouselDb();
  await placeCarousel(query, { nyDate: TODAY, slot: 'morning' });
  const stored = await post(query, 'stored-a', 'story-a');
  const fill = await carouselFill(query, NIGHT);

  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages({ calls }),
    meter: createCostMeter({ capUsd: 2 }),
    log: createInMemorySetAsideLog(),
    now: NIGHT,
    targetPosts: nightStories(fill, 2),
    stored: (id) => storedPostFor(query, id),
    onCalendar: (id) => storyOnCalendar(query, id),
  });
  assert.deepEqual(result.shipped, [{ storyId: 'story-a', reusedPostId: stored }], 'one place left, and the stored post wins it');
  assert.equal(result.posts.length, 0, 'nothing was made');
  assert.deepEqual(calls.map((c) => c.stage), ['jev-scoring'], 'no stage ran for any story: no spend beyond selection');
  assert.equal(result.stopReason, 'target-reached');

  const runId = (await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true }))!;
  await recordShipList(query, runId, result.shipped.map((e) => e.reusedPostId!));
  const out = await scheduleRunPosts(query, runId, NIGHT, () => 0);
  assert.deepEqual(out.map((o) => o.scheduled), [true]);
  const rows = (await query(
    `SELECT ci.native_ref, s.slot, s.source FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id
      WHERE s.ny_date = '2026-10-08' AND s.status = 'scheduled' ORDER BY s.publish_at`,
  )).rows;
  assert.deepEqual(rows.map((r) => [r.native_ref === stored ? 'stored' : 'placed', r.slot, r.source]), [['placed', 'morning', 'user'], ['stored', 'afternoon', 'auto']]);
});

test('carousels: a stored post below the cut is not shipped; the story above it is made', async () => {
  const query = await carouselDb();
  await placeCarousel(query, { nyDate: TODAY, slot: 'morning' });
  const storedB = await post(query, 'stored-b', 'story-b');
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages({ calls }),
    meter: createCostMeter({ capUsd: 2 }),
    log: createInMemorySetAsideLog(),
    now: NIGHT,
    targetPosts: nightStories(await carouselFill(query, NIGHT), 2),
    stored: (id) => storedPostFor(query, id),
    onCalendar: (id) => storyOnCalendar(query, id),
  });
  assert.deepEqual(result.shipped, [{ storyId: 'story-a', reusedPostId: null }]);
  assert.equal(result.shipped.some((e) => e.reusedPostId === storedB), false);
  assert.equal(calls.some((c) => c.storyId === 'story-b'), false, 'the run stopped at its target');
});

test('carousels: a story whose post a person placed is passed over, not made again and not counted twice', async () => {
  const query = await carouselDb();
  await placeCarousel(query, { nyDate: TODAY, slot: 'morning', storyId: 'story-a' });
  assert.equal(await storyOnCalendar(query, 'story-a'), true);
  assert.equal(await storyOnCalendar(query, 'story-b'), false);
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages({ calls }),
    meter: createCostMeter({ capUsd: 2 }),
    log: createInMemorySetAsideLog(),
    now: NIGHT,
    targetPosts: nightStories(await carouselFill(query, NIGHT), 2),
    stored: (id) => storedPostFor(query, id),
    onCalendar: (id) => storyOnCalendar(query, id),
  });
  assert.deepEqual(result.onCalendar, ['story-a']);
  assert.deepEqual(result.shipped, [{ storyId: 'story-b', reusedPostId: null }]);
  assert.equal(calls.some((c) => c.storyId === 'story-a'), false);
});

// ── Explainers (the 2 AM idea cycle) ────────────────────────────────────────

type Scores = Record<ScoreKey, number>;
/** Below the E-15 gates: generated ideas never enter the pool, so the seeded pool decides the ranking. */
const BROAD: Scores = { audience_fit: 4, teachability_45s: 0, analogy_potential: 4, visual_potential: 4, accuracy_under_simplification: 1, hook_strength: 3 };

function stubJev(): JevTransport {
  return {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const keys = Object.keys(questions);
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        answers[key] = keys[0] === 'duplicate_of_existing_topic' || key.startsWith('pair_')
          ? { type: 'noul', noul: 0.1 }
          : { type: 'score', score: BROAD[key as ScoreKey], confidence: 1 };
      }
      void state;
      return { model: 'jev-stub', answers, usage: { input_tokens: 10, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

function stubIdeas(): IdeaModel & { calls: number } {
  const model = {
    calls: 0,
    async writeScopes(request: { titles: string[] }) {
      return { scopes: request.titles.map((t) => `Explain ${t}.`), usage: { input_tokens: 1, output_tokens: 1 }, model: 'stub' };
    },
    async propose() {
      model.calls += 1;
      return {
        ideas: [1, 2, 3].map((n) => ({ topic_title: `Generated ${n} ${Math.random()}`, topic_scope: 'Scope.' })),
        usage: { input_tokens: 10, output_tokens: 10 },
        model: 'stub',
      };
    },
  };
  return model as unknown as IdeaModel & { calls: number };
}

const CYCLE_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York

async function poolTopic(db: ExplainersDb, title: string, score: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status, weighted_score) VALUES ($1, 'manual', 'pool', $2) RETURNING id`,
    [title, score],
  );
  return rows[0]!.id;
}

/** A topic already rendered, its render finished and in Storage, approved by the review page unless told otherwise. */
async function renderedTopic(db: ExplainersDb, title: string, score: number, verdict: 'approved' | 'rejected' | null = 'approved') {
  const { rows: t } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status, weighted_score, rendered_at) VALUES ($1, 'manual', 'rendered', $2, now()) RETURNING id`,
    [title, score],
  );
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at, spend_usd)
     VALUES ($1, 'ok', 'auto', 'development', 5, 'm', 'm', now() - interval '1 day', 3.2) RETURNING id`,
    [t[0]!.id],
  );
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 1, 'bucket')`, [j[0]!.id]);
  if (verdict) await saveFeedback(db, { jobId: j[0]!.id, verdict, tags: [] });
  return { topicId: t[0]!.id, jobId: j[0]!.id };
}

const jobsFor = async (db: ExplainersDb, topicId: string) =>
  Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM explainers.jobs WHERE topic_id = $1`, [topicId])).rows[0]!.n);

async function explainersOn(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true);
  return db;
}

test('explainers: posts_per_day less the day’s placements is how many renders the cycle starts; other days, types and dead slots don’t count', async () => {
  const db = await explainersOn();
  const spine = spineOf(db);
  const a = await poolTopic(db, 'A', 90);
  const b = await poolTopic(db, 'B', 80);
  await slot(spine, { vertical: 'explainers', nyDate: TODAY, slot: 'afternoon', source: 'user' });
  await slot(spine, { vertical: 'explainers', nyDate: TODAY, slot: 'late', source: 'user', status: 'cancelled' });
  await slot(spine, { vertical: 'explainers', nyDate: TOMORROW, slot: 'late', source: 'user' });
  await slot(spine, { vertical: 'carousels', nyDate: TODAY, slot: 'morning', source: 'user' });

  const { log, lines } = capture();
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT, log });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual([result.fill.quota, result.fill.userPlaced, result.fill.making], [2, 1, 1]);
  assert.deepEqual(result.renders, [a], 'one render: the best topic');
  assert.equal(await jobsFor(db, a), 1);
  assert.equal(await jobsFor(db, b), 0, 'the second topic waits in the pool');
  assert.deepEqual(lines.map((l) => [l.message, l.fields.userPlaced, l.fields.making]), [['fill_reduced', 1, 1]]);
});

test('explainers: people placed the whole day: the cycle is skipped before any idea call or render', async () => {
  const db = await explainersOn();
  const spine = spineOf(db);
  const a = await poolTopic(db, 'A', 90);
  await slot(spine, { vertical: 'explainers', nyDate: TODAY, slot: 'afternoon', source: 'user' });
  await slot(spine, { vertical: 'explainers', nyDate: TODAY, slot: 'late', source: 'user', status: 'published' });
  const ideas = stubIdeas();
  const { log, lines } = capture();
  const result = await runIdeaCycle({ db, ideaModel: ideas, jevTransport: stubJev(), now: CYCLE_AT, log });
  assert.equal(result.status, 'skipped');
  assert.equal(result.status === 'skipped' && result.reason, 'quota_filled');
  assert.equal(ideas.calls, 0, 'no idea call: no spend');
  assert.equal(await jobsFor(db, a), 0);
  assert.equal(Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM explainers.cost_events`)).rows[0]!.n), 0);
  assert.equal(lines[0]?.fields.making, 0);
});

test('explainers: an approved, unposted render whose topic ranks first is placed instead of rendered again', async () => {
  const db = await explainersOn();
  await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const survivor = await renderedTopic(db, 'Survivor', 95);
  const a = await poolTopic(db, 'A', 90);
  const b = await poolTopic(db, 'B', 80);
  await renderedTopic(db, 'Rejected one', 99, 'rejected');
  await renderedTopic(db, 'Unreviewed', 98, null);

  const ranked = await fillCandidates(db, true);
  assert.deepEqual(ranked.map((c) => [c.title, c.jobId ? 'render' : 'topic']), [['Survivor', 'render'], ['A', 'topic'], ['B', 'topic']], 'one ranking; rejected and unreviewed renders never compete');

  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.allocated.map((x) => x.jobId), [survivor.jobId]);
  assert.equal(result.allocated[0]!.scheduled?.scheduled, true, 'placed in a window (publishing is live)');
  assert.equal(await jobsFor(db, survivor.topicId), 1, 'not rendered again: no new job, no spend');
  assert.deepEqual(result.renders, [a], 'the other place goes to the best pool topic');
  assert.equal(await jobsFor(db, b), 0);
  const itemId = (await explainerItemId(db, survivor.jobId))!;
  const placed = (await db.query<{ source: string; ny_date: string }>(
    `SELECT source, ny_date::text AS ny_date FROM social_hub.schedule WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId],
  )).rows[0]!;
  assert.deepEqual([placed.source, placed.ny_date], ['auto', TODAY]);
});

test('explainers: a surviving render below the cut is not placed by the night; publishing off, a ranked one counts without a slot', async () => {
  const db = await explainersOn();
  const survivor = await renderedTopic(db, 'Survivor', 50);
  const a = await poolTopic(db, 'A', 90);
  const b = await poolTopic(db, 'B', 80);
  const result = await runIdeaCycle({ db, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.allocated, []);
  assert.deepEqual(result.renders, [a, b]);
  assert.equal(await jobsFor(db, survivor.topicId), 1, 'below the cut: neither placed nor rendered again');
  assert.equal((await db.query(`SELECT 1 FROM social_hub.schedule`)).rows.length, 0, 'the night placed nothing');

  // Next night, ranked first while publishing is off: it takes a place, gets no render, and no slot yet.
  const db2 = await explainersOn();
  const top = await renderedTopic(db2, 'Top', 95);
  const c = await poolTopic(db2, 'C', 90);
  const second = await runIdeaCycle({ db: db2, ideaModel: stubIdeas(), jevTransport: stubJev(), now: CYCLE_AT });
  assert.equal(second.status, 'ok');
  if (second.status !== 'ok') return;
  assert.deepEqual(second.allocated.map((x) => [x.jobId, x.scheduled]), [[top.jobId, null]]);
  assert.deepEqual(second.renders, [c]);
  assert.equal(await jobsFor(db2, top.topicId), 1);
  // scheduleApproved (the regular path, once publishing is on) still places it.
  assert.equal(await scheduleApproved(db2, new Date('2026-10-08T12:00:00Z'), () => 0), 1);
});

// ── Trial Reels (the 1 AM run) ──────────────────────────────────────────────

const R = {
  RUN: '90000000-0000-4000-8000-000000000001',
  RUN2: '90000000-0000-4000-8000-000000000004',
  YESTERDAY: '90000000-0000-4000-8000-000000000002',
  TODAY: '90000000-0000-4000-8000-000000000003',
  CARRY: '90000000-0000-4000-8000-000000000011',
  FRESH: '90000000-0000-4000-8000-000000000012',
  PLACED: '90000000-0000-4000-8000-000000000013',
  VIDEO: '90000000-0000-4000-8000-000000000021',
};
const REELS_NIGHT = new Date('2026-10-08T05:30:00Z'); // 1:30 AM New York

async function reelsDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  return pg;
}

/**
 * Yesterday's slate made CARRY a finished reel (copy, video, song) that never
 * posted; today's slate carries CARRY over (knowledge lane, top net) next to
 * a fresh idea and, optionally, an idea a person already placed.
 */
async function seedReels(pg: PGlite, o: { carryNet?: number; carryOrigin?: 'carryover' | 'timely' } = {}): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${R.RUN}', 'scheduled', 'ok'), ('${R.RUN2}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${R.CARRY}'), ('${R.FRESH}'), ('${R.PLACED}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES
      ('${R.YESTERDAY}', '${R.RUN2}', '2026-10-07', '2026-10-07T05:30:00Z', 'p1', 'p2'),
      ('${R.TODAY}', '${R.RUN}', '2026-10-08', '2026-10-08T05:30:00Z', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components) VALUES
      ('${R.YESTERDAY}', '${R.CARRY}', 'timely', 2.4, 1, true, 'ball_knowledge', 'identity', 0.8, 0.8, 0.9, '{}'::jsonb),
      ('${R.TODAY}', '${R.CARRY}', '${o.carryOrigin ?? 'carryover'}', ${o.carryNet ?? 2.4}, 1, false, 'ball_knowledge', 'identity', 0.8, 0.8, 0.9, '{}'::jsonb),
      ('${R.TODAY}', '${R.FRESH}', 'timely', 2.0, 2, false, 'the_saga', 'arousal', 0.7, 0.7, 0.9, '{}'::jsonb),
      ('${R.TODAY}', '${R.PLACED}', 'timely', 2.9, 3, false, 'ball_knowledge', 'identity', 0.9, 0.9, 0.9, '{}'::jsonb);
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${R.YESTERDAY}', '${R.CARRY}', 'v1', 'm', 'ball_knowledge', 'identity', 'ok', 'Yesterday’s caption.', 'Follow.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${R.VIDEO}', '${R.CARRY}', '${R.YESTERDAY}', 'ok', '2026-10-07T07:00:00Z', 'videos/carry.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${R.VIDEO}', '${R.CARRY}', 'ok', '2026-10-07T07:05:00Z', 'aud-1', 'Song', 'Artist');`);
}

test('trial reels: three a night less today’s placements, one per window still open; other days, types and dead slots don’t count', async () => {
  const pg = await reelsDb();
  const q: SpineQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as any[] });
  let fill = await reelsFill(REELS_NIGHT);
  assert.deepEqual([fill.quota, fill.userPlaced, fill.making], [3, 0, 3]);
  assert.equal(reelsTonight(await windowsStillOpen(REELS_NIGHT), fill), 3);

  await slot(q, { vertical: 'reels', nyDate: TODAY, slot: 'morning', source: 'user' });
  await slot(q, { vertical: 'reels', nyDate: TODAY, slot: 'midday', source: 'user', status: 'cancelled' });
  await slot(q, { vertical: 'reels', nyDate: TODAY, slot: 'evening', source: 'user', status: 'failed' });
  await slot(q, { vertical: 'reels', nyDate: TOMORROW, slot: 'midday', source: 'user' });
  await slot(q, { vertical: 'carousels', nyDate: TODAY, slot: 'afternoon', source: 'user' });
  fill = await reelsFill(REELS_NIGHT);
  assert.deepEqual([fill.userPlaced, fill.making], [1, 2]);
  assert.equal(reelsTonight(await windowsStillOpen(REELS_NIGHT), fill), 2, 'two reels for the two windows left');

  await slot(q, { vertical: 'reels', nyDate: TODAY, slot: 'midday', source: 'user', status: 'published' });
  await slot(q, { vertical: 'reels', nyDate: TODAY, slot: 'evening', source: 'user' });
  fill = await reelsFill(REELS_NIGHT);
  assert.deepEqual([fill.userPlaced, fill.making], [3, 0]);
  assert.equal(reelsTonight(3, fill), 0, 'nothing left: the night writes and renders nothing');
});

test('trial reels: which carryover video can be reused', async () => {
  const pg = await reelsDb();
  await seedReels(pg);
  const ideas = [R.CARRY, R.FRESH];
  assert.deepEqual([...(await reusableVideos(R.TODAY, ideas))], [[R.CARRY, R.VIDEO]], 'a finished, unposted carryover video');

  // Rejected: never reused.
  await pg.exec(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', '${R.VIDEO}', '${R.CARRY}')`);
  const itemId = (await pg.query<{ id: string }>(`SELECT id FROM social_hub.content_items WHERE native_ref = '${R.VIDEO}'`)).rows[0]!.id;
  await rejectItem(async (t, p) => ({ rows: (await pg.query(t, p as unknown[])).rows as any[] }), itemId);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 0, 'rejected');
  await pg.exec(`DELETE FROM social_hub.approvals`);

  // A try that may have reached Instagram: never reused. A clean failure is fine.
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, error) VALUES ($1, 'reels', 'auto', 'failed', 'c', 'quota')`, [itemId]);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 1, 'a clean failure leaves it reusable');
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reels', 'auto', 'creating', 'c')`, [itemId]);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 0, 'a try in flight');
  await pg.exec(`DELETE FROM social_hub.publish_attempts`);

  // Something new in the making for the idea, or already made on this slate: not reused.
  await pg.exec(`INSERT INTO reels.video_jobs (post_idea_id, slate_id, status) VALUES ('${R.CARRY}', '${R.YESTERDAY}', 'requested')`);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 0, 'a newer video in the making');
  await pg.exec(`DELETE FROM reels.video_jobs WHERE status = 'requested'`);
  const SAME_DAY = '90000000-0000-4000-8000-000000000022';
  await pg.exec(`INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
                 VALUES ('${SAME_DAY}', '${R.CARRY}', '${R.TODAY}', 'ok', '2026-10-08T06:00:00Z', 'videos/today.mp4')`);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 0, 'today’s slate already made it a video: nothing to reuse');
  await pg.exec(`DELETE FROM reels.video_jobs WHERE id = '${SAME_DAY}'`);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 1);
  assert.equal((await reusableVideos(R.TODAY, [R.FRESH])).size, 0, 'a fresh idea has nothing to reuse');
  await pg.exec(`INSERT INTO reels.published_status (post_idea_id, published) VALUES ('${R.CARRY}', true)`);
  assert.equal((await reusableVideos(R.TODAY, ideas)).size, 0, 'the idea already posted');
});

test('trial reels: a timely (not carried) idea is never a reuse', async () => {
  const pg = await reelsDb();
  await seedReels(pg, { carryOrigin: 'timely' });
  assert.equal((await reusableVideos(R.TODAY, [R.CARRY])).size, 0);
});

function slotIdea(id: string, net: number, framework: SlotIdea['framework'], bucket: SlotIdea['bucket']): SlotIdea {
  return { id, net, bucketScore: 1, psychologyScore: 1, lastJoinedMs: 0, confidence: 1, framework, bucket };
}

test('trial reels: a reusable idea that comes up for a slot takes it with no attempt; one below the cut is never used', async () => {
  const pass = (id: string) => ({ passed: true, judged: true, lines: [{ ideaId: id, lineIndex: 0, plain: 4, stake: 4, loop: 2, care: 2, reward: 2, sameStory: 0.9, inRange: true }] });
  const ideas = [
    slotIdea('carry', 3, 'identity', 'ball_knowledge'),
    slotIdea('saga', 2.5, 'arousal', 'the_saga'),
    slotIdea('warn', 2.2, 'arousal', 'the_warning'),
  ];
  const tried: string[] = [];
  const filled = await fillSlots({
    ideas, locks: [], count: 2, penalties: new Map(),
    attempt: async (idea) => { tried.push(idea.id); return pass(idea.id); },
    onPenalty: () => undefined, onFallback: () => undefined,
    reusable: new Set(['carry']),
  });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId, s.reused === true]), [[1, 'carry', true], [2, 'saga', false]]);
  assert.deepEqual(tried, ['saga'], 'the reused idea was never written');

  // Below the cut: one reel tonight, a fresher idea ranks first; the reusable one isn't touched.
  const tried2: string[] = [];
  const below = await fillSlots({
    ideas: [slotIdea('fresh', 3, 'identity', 'ball_knowledge'), slotIdea('carry', 2, 'identity', 'ball_knowledge')],
    locks: [], count: 1, penalties: new Map(),
    attempt: async (idea) => { tried2.push(idea.id); return pass(idea.id); },
    onPenalty: () => undefined, onFallback: () => undefined,
    reusable: new Set(['carry']),
  });
  assert.deepEqual(below.map((s) => [s.postIdeaId, s.reused === true]), [['fresh', false]]);
  assert.deepEqual(tried2, ['fresh']);
});

test('trial reels: the nightly generation reuses the carried video (no copy, no render) and leaves a person’s placed idea out', async () => {
  const pg = await reelsDb();
  await seedReels(pg);
  // A person already put PLACED (the best net) on today's calendar.
  await pg.query(
    `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source) VALUES ('reels', $1, '2026-10-08', 'morning', '2026-10-08T13:30:00Z', 'scheduled', 'user')`,
    [R.PLACED],
  );
  assert.deepEqual([...(await placedIdeas([R.PLACED, R.CARRY]))], [R.PLACED]);
  let copyCalls = 0;
  const client: CopyClient = { messages: { create: async () => { copyCalls += 1; throw new Error('no live call in tests'); } } };
  {
    const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client, dailyFill: true });
    assert.deepEqual(out.filled.map((s) => [s.postIdeaId, s.reused === true]), [[R.CARRY, true]]);
    assert.deepEqual(out.reused, [{ postIdeaId: R.CARRY, videoJobId: R.VIDEO }]);
    assert.deepEqual(out.placed, [R.PLACED]);
    assert.equal(out.usd, 0);
    assert.equal(copyCalls, 0, 'no copy was written');
    assert.equal((await pg.query(`SELECT 1 FROM reels.finish_requests`)).rows.length, 0, 'no frame or video was queued');
    assert.equal((await pg.query(`SELECT 1 FROM reels.video_jobs WHERE slate_id = '${R.TODAY}'`)).rows.length, 0);
    const selected = (await pg.query<{ post_idea_id: string }>(`SELECT post_idea_id FROM reels.idea_scores WHERE slate_id = '${R.TODAY}' AND selected`)).rows;
    assert.deepEqual(selected.map((r) => r.post_idea_id), [R.CARRY], 'the reused idea is today’s pick, so its slot books by idea');
  }
});

// ── IG Stories (4 AM auto sets) ─────────────────────────────────────────────

const STORIES_AT = new Date('2026-10-08T08:00:00Z'); // 4:00 AM New York, Thursday

async function storySet(db: Awaited<ReturnType<typeof harnessDb>>['db'], series: string, nyDate: string, status: string, trigger: 'click' | 'auto' = 'click') {
  await db.query(`INSERT INTO stories.sets (series, ny_date, status, trigger, style) VALUES ($1, $2, $3, $4, 'polished')`, [series, nyDate, status, trigger]);
}

test('stories: a set a person approved or scheduled fills its series’ day; no auto set, one fill_reduced line', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await saveSeriesSetting(db, 'morning_download', { auto: true });
  await storySet(db, 'guess_the_number', TODAY, 'scheduled');
  assert.equal(await seriesDayPlaced(db, 'guess_the_number', TODAY), 1);
  assert.equal(await seriesDayPlaced(db, 'morning_download', TODAY), 0, 'per series');
  const { log, lines } = capture();
  const settings = await loadSettings(db);
  assert.deepEqual(await requestAutoSets(db, settings, STORIES_AT, { log }), ['morning_download']);
  assert.deepEqual(await requestAutoSets(db, settings, STORIES_AT, { log }), []);
  assert.deepEqual(lines.map((l) => [l.message, l.fields.series, l.fields.quota, l.fields.userPlaced, l.fields.making]), [['fill_reduced', 'guess_the_number', 1, 1, 0]], 'logged once, not every pass');
  const sets = (await db.query<{ series: string; trigger: string }>(`SELECT series, trigger FROM stories.sets ORDER BY series`)).rows;
  assert.deepEqual(sets.map((s) => [s.series, s.trigger]), [['guess_the_number', 'click'], ['morning_download', 'auto']]);
});

test('stories: a person’s slot on the spine counts; rejected, failed, skipped sets, other days and the night’s own set don’t', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await storySet(db, 'guess_the_number', TODAY, 'rejected');
  await storySet(db, 'guess_the_number', TODAY, 'failed');
  await storySet(db, 'guess_the_number', TODAY, 'skipped');
  await storySet(db, 'guess_the_number', TOMORROW, 'approved');
  assert.equal(await seriesDayPlaced(db, 'guess_the_number', TODAY), 0);
  const spine: SpineQuery = (t, p) => db.query(t, p) as ReturnType<SpineQuery>;
  await slot(spine, { vertical: 'stories', nyDate: TODAY, slot: 'morning_download', source: 'user' });
  await slot(spine, { vertical: 'stories', nyDate: TODAY, slot: 'guess_the_number', source: 'user', status: 'cancelled' });
  assert.equal(await seriesDayPlaced(db, 'guess_the_number', TODAY), 0, 'a cancelled slot never counts');
  assert.equal(await seriesDayPlaced(db, 'morning_download', TODAY), 1, 'a person’s slot for that series and day');

  const { log, lines } = capture();
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), STORIES_AT, { log }), ['guess_the_number']);
  assert.deepEqual(lines, []);
  // The night's own set, approved, holds the day as before, but it isn't a person's placement.
  await db.query(`UPDATE stories.sets SET status = 'approved' WHERE trigger = 'auto'`);
  assert.equal(await seriesDayPlaced(db, 'guess_the_number', TODAY), 0);
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), STORIES_AT, { log }), []);
  assert.deepEqual(lines, []);
});
