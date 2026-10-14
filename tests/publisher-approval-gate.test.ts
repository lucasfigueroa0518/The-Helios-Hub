/**
 * B5 (Content page Phase B): with require_approval on, a booked slot that no
 * one approved, or one whose content was rejected, never posts, on every
 * type's publisher. Explainers start booking unapproved slots at finish in
 * Phase B (B2), so this gate is proven first. Offline: the real schema files
 * on PGlite, no Meta, no model.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import type { Queryable } from '@/lib/explainers/db';
import { explainerItemId, spineOf } from '@/lib/explainers/publish/items';
import { NOT_APPROVED_NOTE as EXPLAINER_NOT_APPROVED, releaseDueSchedules as releaseExplainers } from '@/lib/explainers/publish/schedule';
import { REJECTED_SLOT_NOTE, saveFeedback } from '@/lib/explainers/repository';
import { reelItemId } from '@/lib/reels/publish/items';
import {
  NOT_APPROVED_NOTE as REEL_NOT_APPROVED,
  REJECTED_NOTE as REEL_REJECTED,
  releaseDueSchedules as releaseReels,
  schedulePostIdea,
} from '@/lib/reels/publish/schedule';
import { bookSlot, rejectItem } from '@/lib/social-hub/spine';
import { carouselItemId } from '@/lib/social/overnight/items';
import {
  NOT_APPROVED_NOTE as CAROUSEL_NOT_APPROVED,
  REJECTED_NOTE as CAROUSEL_REJECTED,
  releaseDueSchedules as releaseCarousels,
  schedulePost,
} from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';
import { generate } from '@/lib/stories/api';
import { approveSet, claimNextRequested, dueSets, markReady, rejectSet, saveBuild, scheduleSet } from '@/lib/stories/repository';

import { scratchExplainersDb } from './explainers-pglite';
import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

const NOW = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York

// ── Carousels ───────────────────────────────────────────────────────────────

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function carouselDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}

/** A carousel in review, booked by the night (source 'auto', unapproved) and due now. */
async function carouselOnTheClock(query: Query, slug: string): Promise<string> {
  const { rows } = await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, slide_objects)
     VALUES ($1, $2, 't', 'review', $3::jsonb, $4::jsonb) RETURNING id`,
    [slug, `story-${slug}`, JSON.stringify({ caption: 'A caption.', attributionBlock: 'Photo: Someone', slides: [] }), JSON.stringify(['a.jpg', 'b.jpg', 'c.jpg'].map((f) => `posts/${slug}/${f}`))],
  );
  const postId = rows[0].id as string;
  const booked = await schedulePost(query, postId, 'auto', NOW, undefined, () => 0);
  assert.equal(booked.scheduled, true);
  await query(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);
  return postId;
}

const slotRow = async (query: Query, vertical: string) => {
  const row = (await query(`SELECT status, error FROM social_hub.schedule WHERE vertical = $1`, [vertical])).rows[0];
  return [row.status, row.error] as [string, string | null];
};
const attemptCount = async (query: Query) => Number((await query(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n);

test('carousels: a due slot nobody approved is cancelled and never queued', async () => {
  const query = await carouselDb();
  await carouselOnTheClock(query, 'gate-unapproved');
  assert.equal(await releaseCarousels(query, { requireApproval: true }), 0);
  assert.deepEqual(await slotRow(query, 'carousels'), ['cancelled', CAROUSEL_NOT_APPROVED]);
  assert.equal(await attemptCount(query), 0);
});

test('carousels: a due slot whose carousel was rejected is cancelled, even with require_approval off', async () => {
  const query = await carouselDb();
  const postId = await carouselOnTheClock(query, 'gate-rejected');
  await rejectItem(query, (await carouselItemId(query, postId))!);
  assert.equal(await releaseCarousels(query, { requireApproval: false }), 0);
  assert.deepEqual(await slotRow(query, 'carousels'), ['cancelled', CAROUSEL_REJECTED]);
  assert.equal(await attemptCount(query), 0);
});

// ── Trial Reels ─────────────────────────────────────────────────────────────

const IDEA = '60000000-0000-4000-8000-000000000001';
const SLATE = '60000000-0000-4000-8000-000000000002';
const VIDEO = '60000000-0000-4000-8000-000000000003';
const RUN = '60000000-0000-4000-8000-000000000004';

/** Trial Reels read lib/db.ts's shared pool: point it at PGlite holding one finished reel (as tests/reels-spine.test.ts does). */
async function reelsDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ('${SLATE}', '${RUN}', '2026-10-08', now(), 'p1', 'p2');
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags)
    VALUES ('${SLATE}', '${IDEA}', 'v1', 'm', 'b', 'f', 'ok', 'A new model shipped today.', 'Follow for more.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path)
    VALUES ('${VIDEO}', '${IDEA}', '${SLATE}', 'ok', now(), 'videos/x.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist)
    VALUES ('${VIDEO}', '${IDEA}', 'ok', now(), 'aud-7', 'Song', 'Artist');`);
  return pg;
}

const reelDue = (pg: PGlite) => pg.exec(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute' WHERE status = 'scheduled'`);

test('reels: a due slot nobody approved is cancelled and never released', async () => {
  const pg = await reelsDb();
  assert.equal((await schedulePostIdea(IDEA, 'auto', null, NOW)).scheduled, true);
  await reelDue(pg);
  assert.equal(await releaseReels(), 0);
  const row = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.status, row.error], ['cancelled', REEL_NOT_APPROVED]);
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 0);
});

test('reels: a due slot whose video was rejected is cancelled, even with require_approval off', async () => {
  const pg = await reelsDb();
  await schedulePostIdea(IDEA, 'auto', null, NOW);
  // The rejection sits on the video's item (D39), and the slot was left waiting (as a failed cancel would leave it).
  const itemId = (await reelItemId(VIDEO))!;
  await pg.query(`UPDATE social_hub.schedule SET content_item_id = $1 WHERE vertical = 'reels'`, [itemId]);
  await pg.query(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'rejected', 'user')`, [itemId]);
  await pg.query(`INSERT INTO reels.settings (key, value) VALUES ('require_approval', 'false'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await reelDue(pg);
  assert.equal(await releaseReels(), 0);
  const row = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.status, row.error], ['cancelled', REEL_REJECTED]);
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n, 0);
});

// ── Explainers ──────────────────────────────────────────────────────────────

/** A finished render with its video in Storage and a caption; `approved` writes the review verdict (mirrored onto the spine). */
async function explainerRender(db: Queryable, verdict: 'approved' | null): Promise<string> {
  const { rows: t } = await db.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ('What is an API?', 'manual', 'rendered') RETURNING id`);
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'auto', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', $2, 5000000, 'bucket')`, [jobId, `jobs/${jobId}/video.mp4`]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', 'The door between two programs.')`, [jobId]);
  if (verdict) await saveFeedback(db, { jobId, verdict, tags: [] });
  return jobId;
}

/** A system slot (source 'auto') for the render, already due. */
async function dueExplainerSlot(db: Queryable, jobId: string): Promise<void> {
  const itemId = (await explainerItemId(db, jobId))!;
  await bookSlot(spineOf(db), { vertical: 'explainers', itemId, nyDate: '2026-10-08', slot: 'afternoon', publishAt: new Date(Date.now() - 60_000), source: 'auto' });
}

const explainerSlot = async (db: Queryable) =>
  (await db.query<{ status: string; error: string | null }>(`SELECT status, error FROM social_hub.schedule WHERE vertical = 'explainers'`)).rows[0]!;
const explainerAttempts = async (db: Queryable) =>
  Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0]!.n);

test('explainers: a due slot nobody approved is cancelled and never queued (B3)', async () => {
  const { db } = await scratchExplainersDb();
  await dueExplainerSlot(db, await explainerRender(db, null));
  assert.equal(await releaseExplainers(db), 0);
  const slot = await explainerSlot(db);
  assert.deepEqual([slot.status, slot.error], ['cancelled', EXPLAINER_NOT_APPROVED]);
  assert.equal(await explainerAttempts(db), 0);
});

test('explainers: a slot rejected on the review page only (spine still approved, D41) is cancelled, never queued (Review Focus 2)', async () => {
  const { db } = await scratchExplainersDb();
  const jobId = await explainerRender(db, 'approved');
  await dueExplainerSlot(db, jobId);
  await db.query(`UPDATE explainers.feedback SET verdict = 'rejected' WHERE job_id = $1`, [jobId]);
  assert.equal(await releaseExplainers(db), 0);
  const slot = await explainerSlot(db);
  assert.deepEqual([slot.status, slot.error], ['cancelled', REJECTED_SLOT_NOTE]);
  assert.equal(await explainerAttempts(db), 0);
});

test('explainers: an approved due slot is still released; with require_approval off an unreviewed one is too', async () => {
  const { db } = await scratchExplainersDb();
  await dueExplainerSlot(db, await explainerRender(db, 'approved'));
  assert.equal(await releaseExplainers(db), 1);
  assert.equal(await explainerAttempts(db), 1);

  const off = (await scratchExplainersDb()).db;
  await off.query(`UPDATE explainers.settings SET value = 'false'::jsonb WHERE key = 'require_approval'`);
  await dueExplainerSlot(off, await explainerRender(off, null));
  assert.equal(await releaseExplainers(off), 1);
});

// ── Stories ─────────────────────────────────────────────────────────────────

/** A Free vs. Paid set built and waiting at `ready` (Saturday 2026-10-10 is one of its days). */
async function readyStorySet() {
  const { db } = await harnessDb();
  const { set } = await generate(db, 'free_vs_paid', 'lucas@x', new Date('2026-10-10T12:00:00Z'));
  await claimNextRequested(db);
  await saveBuild(db, set.id, { payload: {}, frames: [{ seq: 1, role: 'intro', backdrop: 'black', copy: { role: 'intro' } }], candidates: [] });
  await markReady(db, set.id, false);
  return { db, id: set.id };
}

test('stories: a built set nobody approved is never due, even with a minute on it; approved and scheduled, it is', async () => {
  const { db, id } = await readyStorySet();
  const minute = new Date('2026-10-10T13:00:00Z');
  const after = new Date('2026-10-10T13:30:00Z');
  await db.query(`UPDATE stories.sets SET publish_at = $2 WHERE id = $1`, [id, minute.toISOString()]);
  assert.deepEqual(await dueSets(db, after), [], 'ready, with a minute: not due');
  await approveSet(db, id);
  assert.deepEqual(await dueSets(db, after), [], 'approved but not scheduled: not due');
  await scheduleSet(db, id, minute);
  assert.deepEqual((await dueSets(db, after)).map((s) => s.id), [id]);
});

test('stories: a rejected set is never due', async () => {
  const { db, id } = await readyStorySet();
  await approveSet(db, id);
  await scheduleSet(db, id, new Date('2026-10-10T13:00:00Z'));
  await rejectSet(db, id, { note: 'no', by: 'tommy' });
  assert.deepEqual(await dueSets(db, new Date('2026-10-10T13:30:00Z')), []);
});
