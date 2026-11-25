/**
 * D18 (Tommy, 2026-11-20): a post approved while its type is Paused stays approved in the Made tab and is never put in
 * a slot automatically when the type later moves to Approval or Live; only a person places it. Approve while Paused
 * writes the hold marker (lib/content-type/unslot.ts holdApprovedWhilePaused, reason 'paused-hold'), which every
 * scheduler's unslotted filter already skips. Approving in Approval or Live still books, and the night's fresh posts are
 * still placed for review.
 *
 * Offline: the real schemas on PGlite, stub pipeline stages. No live Claude, web_search, Jev, Meta or HTTP call.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { APPROVED_PAUSED_REASON, holdApprovedWhilePaused, unslottedSql } from '@/lib/content-type/unslot';
import type { ExplainersDb } from '@/lib/explainers/db';
import { explainerItemId, spineOf as explainersSpine } from '@/lib/explainers/publish/items';
import { explainersHoldsSlots, fillCandidates, holdApprovedRender, publishingLive, scheduleApproved, scheduleJob, unscheduleJob } from '@/lib/explainers/publish/schedule';
import { getFeedback, saveFeedback, setVerdict } from '@/lib/explainers/repository';
import { saveSetting } from '@/lib/explainers/settings';
import { explainerActions } from '@/lib/publishing/actions/explainers';
import { reelAiDramaActions } from '@/lib/publishing/actions/reel-ai-drama';
import { reelActions } from '@/lib/publishing/actions/reels';
import {
  dramaHoldsSlots,
  dramaItemId,
  dramaPublishingLive,
  dramaVerdictOf,
  holdApprovedDrama,
  latestDramaJobId,
  scheduleApprovedDrama,
  scheduleDramaJob,
  setDramaVerdict,
  unscheduleDramaJob,
} from '@/lib/reel-ai-drama/hub';
import { writeDramaPosting } from '@/lib/reel-ai-drama/hub-posting';
import { approveReel, reelItemId, reelsSpine } from '@/lib/reels/publish/items';
import { holdApprovedReel, reelIdeaUnslottedSql, reelsHoldsSlots, scheduleLatestToday, schedulePostIdea } from '@/lib/reels/publish/schedule';
import { dbQuery } from '@/lib/db';
import { openSlots, placeItem, rescheduleItem } from '@/lib/social-hub/placement';
import type { SpineQuery } from '@/lib/social-hub/spine';
import { approvePost, scheduleRunPosts } from '@/lib/social/overnight/schedule';
import { requestRun } from '@/lib/social/overnight/runs';
import { recordShipList, type Query } from '@/lib/social/store/pg';
import { approve as approveStorySet, generate as generateStorySet } from '@/lib/stories/api';
import { claimNextRequested, markReady, rescheduleSet, saveBuild } from '@/lib/stories/repository';
import { saveSeriesSetting } from '@/lib/stories/settings';
import { unslottedSetIds } from '@/lib/stories/unslot';
import { tick } from '@/lib/stories/worker';

import { scratchExplainersDb } from './explainers-pglite';
import { NEW_SLATE, NORMAL, RUN, reelsDb } from './fixtures/reels-seed';
import { dramaHubDb, finishedJob, setDrama } from './reel-ai-drama-hub-fixture';
import { harnessDb } from './stories-harness';

delete process.env.ANTHROPIC_API_KEY; // nothing here may reach a live model

const first = () => 0;

/** The item's spine rows, newest first: [status, error]. */
async function rowsOf(q: SpineQuery, itemId: string): Promise<Array<[string, string | null]>> {
  const { rows } = await q(`SELECT status, error FROM social_hub.schedule WHERE content_item_id = $1::uuid ORDER BY created_at DESC, status`, [itemId]);
  return rows.map((r) => [r.status, r.error]);
}
const held = async (q: SpineQuery, itemId: string) => (await q(`SELECT ${unslottedSql('$1::uuid')} AS u`, [itemId])).rows[0]!.u as boolean;

/** A person places the item in the first free slot of `nyDate` (the hub's Place, D50). */
async function placeByHand(q: SpineQuery, target: { vertical: 'explainers' | 'reel_ai_drama' | 'reels'; itemId: string | null; ideaRef?: string }, nyDate: string, now: Date) {
  const free = (await openSlots(q, target.vertical, nyDate, { now })).find((s) => s.free);
  assert.ok(free, `a free ${target.vertical} slot on ${nyDate}`);
  return placeItem(q, { ...target, nyDate, slot: free.slot, now, rng: first });
}

// ── The marker itself ───────────────────────────────────────────────────────

test('holdApprovedWhilePaused: one cancelled paused-hold row, written once, never over a live slot', async () => {
  const { db } = await scratchExplainersDb();
  const q = explainersSpine(db);
  const { rows } = await db.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'x-1') RETURNING id::text AS id`);
  const itemId = rows[0]!.id;
  const at = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York
  assert.equal(await holdApprovedWhilePaused(q, { vertical: 'explainers', itemId, now: at }), true);
  assert.equal(await holdApprovedWhilePaused(q, { vertical: 'explainers', itemId, now: at }), false, 'written once');
  const row = (await db.query<{ status: string; error: string; ny_date: string; slot: string; source: string }>(
    `SELECT status, error, ny_date::text AS ny_date, slot, source FROM social_hub.schedule WHERE content_item_id = $1`, [itemId],
  )).rows[0]!;
  assert.deepEqual([row.status, row.error, row.ny_date, row.slot, row.source], ['cancelled', APPROVED_PAUSED_REASON, '2026-10-08', 't0000', 'user']);
  assert.equal(await held(q, itemId), true);
  assert.equal(await holdApprovedWhilePaused(q, { vertical: 'explainers', itemId: null }), false, 'no item, no marker');
});

// ── Explainers ──────────────────────────────────────────────────────────────

const CYCLE_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York, Thursday

async function explainerRender(db: ExplainersDb, title: string): Promise<string> {
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status, weighted_score, rendered_at) VALUES ($1, 'manual', 'rendered', 50, now()) RETURNING id`, [title]);
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at, spend_usd)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now() - interval '1 day', 1) RETURNING id`,
    [t[0]!.id],
  );
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', 'v.mp4', 1, 'bucket')`, [j[0]!.id]);
  return j[0]!.id;
}

function explainerLayer(db: ExplainersDb) {
  return explainerActions({
    db: async () => db,
    setVerdict,
    hardPublishJob: async () => ({ queued: false }),
    loadSettings: async () => ({}),
    requestRerender: async () => ({ ok: false }),
    itemId: explainerItemId,
    unscheduleJob,
    verdictOf: async (d, jobId) => (await getFeedback(d, jobId))?.verdict ?? null,
    placeItem: (query, input) => placeItem(query, { ...input, now: CYCLE_AT, rng: first }),
    rescheduleItem: (query, input) => rescheduleItem(query, { ...input, now: CYCLE_AT, rng: first }),
    scheduleJob: (d, jobId, source, now, through) => scheduleJob(d, jobId, source, now, through, first),
    publishingLive,
    holdsSlots: explainersHoldsSlots,
    holdApproved: (d, jobId) => holdApprovedRender(d, jobId, CYCLE_AT),
    now: () => CYCLE_AT,
  });
}

test('Explainers (D18): approved while Paused, neither scheduleApproved nor the night fill places it in Approval or Live; a person can', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', false); // Paused
  const q = explainersSpine(db);
  const layer = explainerLayer(db);
  const jobId = await explainerRender(db, 'Approved while paused');
  const out = await layer.approve!({ jobId }, 'tommy', {});
  assert.equal(out.ok, true);
  assert.match(out.note, /Explainers are Paused, so it stays in the Made tab/);
  const itemId = (await explainerItemId(db, jobId))!;
  assert.deepEqual(await rowsOf(q, itemId), [['cancelled', APPROVED_PAUSED_REASON]], 'no slot, only the hold');
  assert.equal((await getFeedback(db, jobId))?.verdict, 'approved', 'it stays approved');

  for (const live of [false, true]) {
    await saveSetting(db, 'auto_render', true);
    await db.query(`INSERT INTO explainers.settings (key, value) VALUES ('publishing_live', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(live)]);
    assert.equal(await explainersHoldsSlots(db), true);
    assert.equal(await scheduleApproved(db, CYCLE_AT, first), 0, live ? 'Live' : 'Approval');
    const candidates = await fillCandidates(db, true);
    assert.equal(candidates.some((c) => c.jobId === jobId), false, 'the night fill does not offer it');
    assert.deepEqual(await rowsOf(q, itemId), [['cancelled', APPROVED_PAUSED_REASON]]);
  }

  // A person places it: the hold no longer applies.
  const placed = await placeByHand(q, { vertical: 'explainers', itemId }, '2026-10-09', CYCLE_AT);
  assert.equal(placed.ok, true, placed.note);
  assert.equal(await held(q, itemId), false);
  assert.equal((await rowsOf(q, itemId)).filter(([s]) => s === 'scheduled').length, 1);
});

test('Explainers: approved in Approval still books its slot, with no hold; the review page holds only while Paused', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'auto_render', true); // Approval
  const q = explainersSpine(db);
  const jobId = await explainerRender(db, 'Approved in approval');
  const out = await explainerLayer(db).approve!({ jobId }, 'tommy', {});
  assert.equal(out.ok, true, out.note);
  const itemId = (await explainerItemId(db, jobId))!;
  assert.deepEqual((await rowsOf(q, itemId)).map(([s]) => s), ['scheduled']);
  assert.equal(await held(q, itemId), false);

  // The review page (E-08) saves the verdict, then holds only while Paused.
  const other = await explainerRender(db, 'Review page');
  await saveFeedback(db, { jobId: other, verdict: 'approved', tags: [] });
  assert.equal(await holdApprovedRender(db, other, CYCLE_AT), false, 'Approval: no hold; scheduleApproved places it');
  assert.equal(await scheduleApproved(db, CYCLE_AT, first), 1);
  await saveSetting(db, 'auto_render', false);
  const third = await explainerRender(db, 'Review page paused');
  await saveFeedback(db, { jobId: third, verdict: 'approved', tags: [] });
  assert.equal(await holdApprovedRender(db, third, CYCLE_AT), true, 'Paused: held');
  await saveSetting(db, 'auto_render', true);
  assert.equal(await scheduleApproved(db, CYCLE_AT, first), 0);
});

// ── AI Drama ────────────────────────────────────────────────────────────────

const MONDAY = new Date('2026-11-09T15:00:00Z'); // Monday 10:00 AM New York

function dramaLayer(db: ExplainersDb) {
  return reelAiDramaActions({
    db: async () => db,
    setVerdict: setDramaVerdict,
    hardPublishJob: (async () => ({ queued: false })) as never,
    requestJob: (async () => ({ ok: false })) as never,
    itemId: dramaItemId,
    unscheduleJob: unscheduleDramaJob,
    latestJobId: latestDramaJobId,
    verdictOf: dramaVerdictOf,
    scheduleJob: (d, jobId, source, now, through) => scheduleDramaJob(d, jobId, source, now, through, first),
    publishingLive: dramaPublishingLive,
    holdsSlots: dramaHoldsSlots,
    holdApproved: (d, jobId) => holdApprovedDrama(d, jobId, MONDAY),
    placeItem: (query, input) => placeItem(query, { ...input, now: MONDAY, rng: first }),
    rescheduleItem: (query, input) => rescheduleItem(query, { ...input, now: MONDAY, rng: first }),
    now: () => MONDAY,
  });
}

test('AI Drama (D18): approved while Paused, the state change and scheduleApprovedDrama never place it; a person can; Approval approve books', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'auto', false); // Paused
  const q = explainersSpine(db);
  const layer = dramaLayer(db);
  const back = await finishedJob(db);
  const out = await layer.approve!({ jobId: back.jobId }, 'lucas', {});
  assert.equal(out.ok, true);
  assert.match(out.note, /AI Drama Reels are Paused, so it stays in the Made tab/);
  const itemId = (await dramaItemId(db, back.jobId))!;
  assert.deepEqual(await rowsOf(q, itemId), [['cancelled', APPROVED_PAUSED_REASON]]);

  // Approval, through the Settings write (its hook books approved reels), then Live.
  await writeDramaPosting(db, { generate: true });
  assert.equal(await scheduleApprovedDrama(db, MONDAY, first), 0, 'Approval: not placed');
  await writeDramaPosting(db, { live: true });
  assert.equal(await scheduleApprovedDrama(db, MONDAY, first), 0, 'Live: not placed');
  assert.deepEqual(await rowsOf(q, itemId), [['cancelled', APPROVED_PAUSED_REASON]]);

  // Approved now, in Live: Approve books it as before.
  const fresh = await finishedJob(db);
  const booked = await layer.approve!({ jobId: fresh.jobId }, 'lucas', {});
  assert.equal(booked.ok, true, booked.note);
  const freshItem = (await dramaItemId(db, fresh.jobId))!;
  assert.deepEqual((await rowsOf(q, freshItem)).map(([s]) => s), ['scheduled']);

  // A person places the held one.
  const placed = await placeByHand(q, { vertical: 'reel_ai_drama', itemId }, '2026-11-12', MONDAY);
  assert.equal(placed.ok, true, placed.note);
  assert.equal(await held(q, itemId), false);
});

// ── Text on Screen ──────────────────────────────────────────────────────────

const VIDEO = 'a0000000-0000-4000-8000-0000000000a1';
const FRESH = 'a0000000-0000-4000-8000-000000000012';
const REELS_AT = new Date('2026-10-08T06:00:00Z'); // 2:00 AM New York

async function reelsSetting(key: string, value: unknown) {
  await dbQuery(`INSERT INTO reels.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
}

function reelLayer() {
  return reelActions({
    schedulePostIdea: (idea, source, video) => schedulePostIdea(idea, source, video, REELS_AT),
    rejectReel: async () => ({ rejected: true, note: '' }),
    forcePost: async () => ({ queued: false }),
    unscheduleIdea: async () => ({ ok: true, note: '' }),
    query: reelsSpine,
    itemId: reelItemId,
    placeItem: async () => ({ ok: false, note: 'not used' }),
    rescheduleItem: async () => ({ ok: false, note: 'not used' }),
    todaySlate: async () => null,
    findReelLock: async () => null,
    requestFinish: async () => ({ status: 'done', note: '' }),
    holdsSlots: () => reelsHoldsSlots(),
    approveVideo: (videoJobId) => approveReel(videoJobId, 'user'),
    holdApproved: (postIdeaId, videoJobId) => holdApprovedReel(postIdeaId, videoJobId, REELS_AT),
  });
}

test('Text on Screen (D18): approved while Paused, scheduleLatestToday on the move to Approval passes it over but still places the night’s fresh pick', async () => {
  const pg = await reelsDb(); // NEW_SLATE (2026-10-08) with NORMAL selected
  await pg.exec(`
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${NORMAL}', '${NEW_SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.post_ideas (id, timely) VALUES ('${FRESH}', false);
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, components)
    VALUES ('${NEW_SLATE}', '${FRESH}', 'timely', 1, 2, true, '{}'::jsonb);`);
  void RUN;
  // Paused: no auto_run.
  const layer = reelLayer();
  const out = await layer.approve!({ postIdeaId: NORMAL, videoJobId: VIDEO }, 'tommy', {});
  assert.equal(out.ok, true, out.note);
  assert.match(out.note, /Text on Screen is Paused, so it stays in the Made tab/);
  const itemId = (await reelItemId(VIDEO))!;
  assert.deepEqual(await rowsOf(reelsSpine, itemId), [['cancelled', APPROVED_PAUSED_REASON]]);
  const ideaHeld = async (idea: string) => (await dbQuery<{ u: boolean }>(`SELECT ${reelIdeaUnslottedSql('$1::uuid')} AS u`, [idea])).rows[0]!.u;
  assert.equal(await ideaHeld(NORMAL), true);

  // Approval (what posting.ts writePosting does on the move): only the fresh pick is placed, for review.
  await reelsSetting('auto_run', true);
  assert.deepEqual(await scheduleLatestToday(REELS_AT), { scheduled: 1 });
  const slots = (await dbQuery<{ idea_ref: string; approved_at: string | null }>(
    `SELECT idea_ref, approved_at FROM social_hub.schedule WHERE vertical = 'reels' AND status = 'scheduled'`,
  )).rows;
  assert.deepEqual(slots.map((s) => [s.idea_ref, s.approved_at]), [[FRESH, null]], 'the fresh pick waits for review; the held reel has no slot');
  await reelsSetting('publishing_live', true);
  await scheduleLatestToday(REELS_AT); // Live: counts the fresh pick's slot it keeps, places nothing new
  const live = (await dbQuery<{ idea_ref: string }>(`SELECT idea_ref FROM social_hub.schedule WHERE vertical = 'reels' AND status = 'scheduled'`)).rows;
  assert.deepEqual(live.map((s) => s.idea_ref), [FRESH], 'Live: the held reel is still not placed');

  // Approve in Approval/Live keeps (approves) the fresh pick’s slot, no hold.
  const ok = await layer.approve!({ postIdeaId: FRESH }, 'tommy', {});
  assert.equal(ok.ok, true, ok.note);
  const approved = (await dbQuery<{ approved_at: string | null }>(`SELECT approved_at FROM social_hub.schedule WHERE idea_ref = $1 AND status = 'scheduled'`, [FRESH])).rows[0]!;
  assert.ok(approved.approved_at, 'approved in its slot');
  assert.equal(await ideaHeld(FRESH), false);

  // A person places the held reel.
  const placed = await placeByHand(reelsSpine, { vertical: 'reels', itemId, ideaRef: NORMAL }, '2026-10-09', REELS_AT);
  assert.equal(placed.ok, true, placed.note);
  assert.equal(await ideaHeld(NORMAL), false);
});

// ── Stories ─────────────────────────────────────────────────────────────────

async function readyStorySet(db: Awaited<ReturnType<typeof harnessDb>>['db'], at: Date, series: 'real_or_ai' | 'ai_trivia' = 'real_or_ai') {
  const { set } = await generateStorySet(db, series, 'lucas@x', at);
  await claimNextRequested(db);
  await saveBuild(db, set.id, { payload: {}, frames: [{ seq: 1, role: 'intro', backdrop: 'black', copy: { role: 'intro' } }], candidates: [] });
  await markReady(db, set.id, true);
  return set.id;
}

function storiesDeps(db: Awaited<ReturnType<typeof harnessDb>>['db'], now: Date) {
  return {
    db,
    sourceDb: db,
    now: () => now,
    log: () => undefined,
    poolReads: () => ({ morning: async () => ({ reels: [], carousel: [] }), leads: async () => [] }),
    triviaDaily: async () => ({ ran: false, capped: false }),
    roaDaily: async () => ({ ran: false, capped: false }),
    builder: async () => { throw new Error('nothing is built here'); },
    meta: () => { throw new Error('nothing posts'); },
    storage: () => { throw new Error('not used'); },
    insights: () => { throw new Error('not used'); },
  };
}

test('Stories (D18): a set approved while Paused is never booked by step 3 in Approval; a person can place it; Approval approve books', async () => {
  const { db } = await harnessDb(); // every series Paused
  const made = new Date('2026-10-10T08:00:00Z');
  const before = new Date('2026-10-10T09:00:00Z'); // 5:00 AM New York, before the window
  const id = await readyStorySet(db, made);
  const out = await approveStorySet(db, id, before);
  assert.equal(out.status, 'approved');
  assert.deepEqual([...(await unslottedSetIds(db, [id]))], [id], 'held');

  await saveSeriesSetting(db, 'real_or_ai', { auto: true }); // Approval
  assert.equal((await tick(storiesDeps(db, before) as never)).scheduled, 0, 'step 3 leaves it in Made');
  assert.equal((await db.query<{ status: string }>(`SELECT status FROM stories.sets WHERE id = $1`, [id])).rows[0]!.status, 'approved');

  // Approved in Approval: books today’s minute at once (B1). (Another series: one set per series per day.)
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  const other = await readyStorySet(db, made, 'ai_trivia');
  const booked = await approveStorySet(db, other, before);
  assert.equal(booked.status, 'scheduled');
  assert.equal((await unslottedSetIds(db, [other])).size, 0);

  // A person places the held set.
  const placed = await rescheduleSet(db, id, '2026-10-11', new Date('2026-10-11T13:00:00Z'), null, 'person');
  assert.equal(placed.status, 'scheduled');
  assert.equal((await unslottedSetIds(db, [id])).size, 0, 'placing it clears the hold');
});

// ── Carousels (no scheduler re-books an approved post, but a run’s ship list reuses stored posts) ──

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

test('Carousels (D18): a post approved while Paused is not booked from a run’s ship list once the type is in Approval', async () => {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  const setting = (key: string, on: boolean) => query(`INSERT INTO social.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(on)]);
  const post = async (slug: string, runId: string | null = null) =>
    (await query(
      `INSERT INTO social.posts (run_id, slug, story_id, title, status, render, origin, slide_objects) VALUES ($1, $2, $2, 't', 'review', '{}'::jsonb, 'pipeline', $3::jsonb) RETURNING id`,
      [runId, slug, JSON.stringify([`posts/${slug}/a.jpg`])],
    )).rows[0].id as string;
  await setting('auto_run', false);
  await setting('publishing_live', false);
  const kept = await post('kept');
  const out = await approvePost(query, kept, new Date('2026-10-08T07:30:00Z'));
  assert.equal(out.scheduled, false);
  const keptItem = (await query(`SELECT id::text AS id FROM social_hub.content_items WHERE native_ref = $1`, [kept])).rows[0].id as string;
  assert.deepEqual(await rowsOf(query as SpineQuery, keptItem), [['cancelled', APPROVED_PAUSED_REASON]]);

  await setting('auto_run', true); // Approval
  const runId = (await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true }))!;
  const fresh = await post('fresh', runId);
  await recordShipList(query, runId, [kept, fresh]);
  const booked = await scheduleRunPosts(query, runId, new Date('2026-10-08T07:30:00Z'), first);
  assert.ok(booked.some((o) => o.scheduled));
  const scheduled = (await query(
    `SELECT ci.native_ref FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE s.status = 'scheduled'`,
  )).rows.map((r) => r.native_ref);
  assert.deepEqual(scheduled, [fresh], 'only the run’s fresh post is placed, for review');
  assert.equal(await held(query as SpineQuery, keptItem), true);
});
