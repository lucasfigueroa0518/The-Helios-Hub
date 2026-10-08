/**
 * Moving Carousels' lifecycle history onto the spine (D36). The backfill is
 * idempotent, and the hub shows exactly what it shows for rows written on the
 * spine natively (parity). Offline: PGlite with the real schema files.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { backfillCarousels, backfillExplainers, backfillReels } from '@/lib/social-hub/backfill';
import { buildDataset } from '@/lib/social-hub/dataset';
import { readAll } from '@/lib/social-hub/load';
import type { SpineQuery } from '@/lib/social-hub/spine';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, seedHubFixture } from './fixtures/social-hub/seed';

const NOW = new Date('2026-10-08T12:00:00Z');
const FORCE_ATTEMPT = '30000000-0000-4000-8000-000000000032';
const CANCELLED_SLOT = '30000000-0000-4000-8000-000000000022';

/** The fixture's Carousels lifecycle, as the old tables held it before the switch. */
const LEGACY_ROWS = `
DELETE FROM social_hub.media_insights WHERE vertical = 'carousels';
DELETE FROM social_hub.schedule WHERE vertical = 'carousels';
DELETE FROM social_hub.publish_attempts WHERE vertical = 'carousels';
DELETE FROM social_hub.approvals;
DELETE FROM social_hub.content_items WHERE vertical = 'carousels';
INSERT INTO social.publish_attempts (id, post_id, trigger, status, requested_at, finished_at, caption, image_objects, media_id, permalink)
VALUES ('${IDS.socAttempt}', '${IDS.socPost1}', 'auto', 'published', '2026-10-06T11:29:00Z', '2026-10-06T11:31:00Z', 'caption', '[]', 'm-c1', 'https://instagram.com/p/c1');
INSERT INTO social.posting_schedule (id, post_id, ny_date, slot, publish_at, status, source, publish_attempt_id, approved_at)
VALUES ('${IDS.socSched}', '${IDS.socPost1}', '2026-10-06', 'morning', '2026-10-06T11:30:00Z', 'published', 'auto', '${IDS.socAttempt}', '2026-10-06T10:00:00Z');
INSERT INTO social.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions)
VALUES ('m-c1', '2026-10-07', '${IDS.socAttempt}', 900, 700, 40, 6, 30, 22, 98);`;

/** History the native fixture doesn't have: a cancelled-unapproved slot and a failed Force try on the review post. */
const EXTRA_LEGACY = `
INSERT INTO social.posting_schedule (id, post_id, ny_date, slot, publish_at, status, source, error)
VALUES ('${CANCELLED_SLOT}', '${IDS.socPost2}', '2026-10-06', 'afternoon', '2026-10-06T18:40:00Z', 'cancelled', 'auto', 'Nobody approved this carousel before its slot, so it was not posted.');
INSERT INTO social.publish_attempts (id, post_id, trigger, status, requested_at, finished_at, caption, image_objects, error)
VALUES ('${FORCE_ATTEMPT}', '${IDS.socPost2}', 'force', 'failed', '2026-10-07T15:00:00Z', '2026-10-07T15:02:00Z', 'c', '["x.jpg"]', 'container error');`;

async function legacyDb() {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(LEGACY_ROWS);
  return { pg, query, spine: query as unknown as SpineQuery };
}

const carousels = async (query: Parameters<typeof readAll>[0]) => {
  const d = buildDataset(await readAll(query), null, NOW);
  return { posts: d.posts.filter((p) => p.vertical === 'carousels'), ideas: d.ideas.filter((i) => i.vertical === 'carousels') };
};

test('backfill: the hub shows the same Carousels from copied history as from rows written on the spine', async () => {
  const native = await openHubTestDb();
  await seedHubFixture(native.pg);
  const expected = await carousels(native.query);
  assert.ok(expected.posts.some((p) => p.status === 'published'), 'the fixture has a published carousel');

  const { query, spine } = await legacyDb();
  const empty = await carousels(query);
  assert.equal(empty.posts.some((p) => p.status === 'published'), false, 'before the backfill the spine has no Carousels history');
  await backfillCarousels(spine);
  assert.deepEqual(await carousels(query), expected);
});

test('backfill: copies once, keeps ids, and a second run changes nothing', async () => {
  const { pg, spine } = await legacyDb();
  await pg.exec(EXTRA_LEGACY);
  const first = await backfillCarousels(spine);
  assert.deepEqual(first, { items: 2, attempts: 2, schedule: 2, insights: 1, approvals: 2 });
  assert.deepEqual(await backfillCarousels(spine), { items: 0, attempts: 0, schedule: 0, insights: 0, approvals: 0 });

  const attempt = (await pg.query<{ id: string; legacy_id: string; payload: unknown }>(`SELECT id, legacy_id, payload FROM social_hub.publish_attempts WHERE id = '${FORCE_ATTEMPT}'`)).rows[0]!;
  assert.equal(attempt.legacy_id, FORCE_ATTEMPT, 'same id, recorded as legacy_id');
  assert.deepEqual(attempt.payload, { image_objects: ['x.jpg'] });
  const approvals = (await pg.query<{ native_ref: string; via: string }>(
    `SELECT ci.native_ref, a.via FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id ORDER BY ci.native_ref`,
  )).rows;
  assert.deepEqual(approvals.map((a) => [a.native_ref, a.via]), [[IDS.socPost1, 'user'], [IDS.socPost2, 'force']], 'slot approval and Force (SH-17) both carry over');
  const cancelled = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule WHERE id = '${CANCELLED_SLOT}'`)).rows[0]!;
  assert.equal(cancelled.status, 'cancelled');
});

test('backfill skips a row the switched code already wrote (no duplicate post for one item)', async () => {
  const { pg, spine } = await legacyDb();
  // After the switch the worker queued a new try for the same post before the backfill ran.
  await pg.exec(`
    INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('carousels', 'feed', '${IDS.socPost1}', 'story-1');
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption)
    SELECT id, 'carousels', 'force', 'published', 'c' FROM social_hub.content_items WHERE native_ref = '${IDS.socPost1}';`);
  const counts = await backfillCarousels(spine);
  assert.equal(counts.attempts, 0, 'publish_once: the item already has a published attempt');
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.content_items WHERE vertical = 'carousels'`)).rows[0]!.n, 1);
});

// ── Explainers ──────────────────────────────────────────────────────────────

/** The fixture's Explainers lifecycle as the old tables held it, plus an approved render nobody scheduled yet. */
const EXPLAINER_LEGACY = `
DELETE FROM social_hub.media_insights WHERE vertical = 'explainers';
DELETE FROM social_hub.schedule WHERE vertical = 'explainers';
DELETE FROM social_hub.publish_attempts WHERE vertical = 'explainers';
DELETE FROM social_hub.approvals WHERE content_item_id IN (SELECT id FROM social_hub.content_items WHERE vertical = 'explainers');
DELETE FROM social_hub.content_items WHERE vertical = 'explainers';
INSERT INTO explainers.publish_attempts (id, job_id, trigger, status, requested_at, finished_at, caption, video_object, media_id, permalink)
VALUES ('${IDS.expAttempt}', '${IDS.job1}', 'auto', 'published', '2026-10-06T19:25:00Z', '2026-10-06T19:30:00Z', 'caption', 'jobs/1/video.mp4', 'm-e1', 'https://instagram.com/reel/e1');
INSERT INTO explainers.posting_schedule (id, job_id, ny_date, slot, publish_at, status, source, publish_attempt_id)
VALUES ('${IDS.expSched}', '${IDS.job1}', '2026-10-06', 'afternoon', '2026-10-06T19:30:00Z', 'published', 'auto', '${IDS.expAttempt}');
INSERT INTO explainers.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate)
VALUES ('m-e1', '2026-10-07', '${IDS.expAttempt}', 400, 310, 20, 3, 15, 12, 50, 9000, 3600000, 0.22);
INSERT INTO explainers.feedback (job_id, verdict) VALUES ('${IDS.job2}', 'approved');`;

test('backfill Explainers: same hub view, verdicts mirrored (an approved, unscheduled render stays schedulable), idempotent', async () => {
  const native = await openHubTestDb();
  await seedHubFixture(native.pg);
  await native.pg.exec(`
    INSERT INTO explainers.feedback (job_id, verdict) VALUES ('${IDS.job2}', 'approved');
    INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('explainers', 'reel', '${IDS.job2}', '${IDS.topic1}');
    INSERT INTO social_hub.approvals (content_item_id, decision, via) SELECT id, 'approved', 'user' FROM social_hub.content_items WHERE native_ref = '${IDS.job2}';
    UPDATE explainers.feedback SET created_at = '2026-10-07T08:00:00Z', updated_at = '2026-10-07T08:00:00Z';`);
  const expected = buildDataset(await readAll(native.query), null, NOW).posts.filter((p) => p.vertical === 'explainers');

  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(EXPLAINER_LEGACY);
  await pg.exec(`UPDATE explainers.feedback SET created_at = '2026-10-07T08:00:00Z', updated_at = '2026-10-07T08:00:00Z';`);
  const spine = query as unknown as SpineQuery;
  assert.deepEqual(await backfillExplainers(spine), { items: 2, attempts: 1, schedule: 1, insights: 1, approvals: 2 });
  assert.deepEqual(await backfillExplainers(spine), { items: 0, attempts: 0, schedule: 0, insights: 0, approvals: 0 });
  const got = buildDataset(await readAll(query), null, NOW).posts.filter((p) => p.vertical === 'explainers');
  assert.deepEqual(got, expected);
  const job2 = (await pg.query<{ decision: string }>(
    `SELECT a.decision FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id WHERE ci.native_ref = '${IDS.job2}'`,
  )).rows[0];
  assert.equal(job2?.decision, 'approved', 'the scheduler reads this; without it the render would never get a slot');
  // A verdict changed after the copy is re-synced by running again.
  await pg.exec(`UPDATE explainers.feedback SET verdict = 'rejected', updated_at = now() WHERE job_id = '${IDS.job2}'`);
  assert.equal((await backfillExplainers(spine)).approvals, 1);
});

// ── Trial Reels (D39) ───────────────────────────────────────────────────────

const REEL_ORPHAN_ATTEMPT = '10000000-0000-4000-8000-000000000059';

/** The fixture's Trial Reels lifecycle as the old tables held it. */
const REEL_LEGACY = `
DELETE FROM social_hub.media_insights WHERE vertical = 'reels';
DELETE FROM social_hub.schedule WHERE vertical = 'reels';
DELETE FROM social_hub.publish_attempts WHERE vertical = 'reels';
DELETE FROM social_hub.approvals WHERE content_item_id IN (SELECT id FROM social_hub.content_items WHERE vertical = 'reels');
DELETE FROM social_hub.content_items WHERE vertical = 'reels';
INSERT INTO reels.publish_attempts (id, video_job_id, post_idea_id, trigger, status, requested_at, finished_at, audio_id, caption, graduation_strategy, media_id, permalink)
VALUES ('${IDS.reelAttempt}', '${IDS.video1}', '${IDS.idea1}', 'auto', 'published', '2026-10-06T13:25:00Z', '2026-10-06T13:30:00Z', 'aud-1', 'caption', 'MANUAL', 'm-r1', 'https://instagram.com/reel/r1');
INSERT INTO reels.publish_attempts (id, video_job_id, post_idea_id, trigger, status, requested_at, finished_at, audio_id, caption, graduation_strategy, error)
VALUES ('${IDS.reelAttemptFailed}', '${IDS.video1}', '${IDS.idea1}', 'force', 'failed', '2026-10-07T13:00:00Z', '2026-10-07T13:01:00Z', 'aud-1', 'caption', 'MANUAL', 'quota');
INSERT INTO reels.posting_schedule (id, post_idea_id, video_job_id, ny_date, slot, publish_at, status, source, publish_attempt_id, approved_at) VALUES
 ('${IDS.reelSched1}', '${IDS.idea1}', '${IDS.video1}', '2026-10-06', 'morning', '2026-10-06T13:30:00Z', 'published', 'auto', '${IDS.reelAttempt}', '2026-10-06T11:00:00Z'),
 ('${IDS.reelSched2}', '${IDS.idea2}', NULL, '2026-10-07', 'midday', '2026-10-07T16:00:00Z', 'scheduled', 'auto', NULL, NULL),
 ('${IDS.reelSched3}', '${IDS.idea3}', NULL, '2026-10-06', 'evening', '2026-10-06T23:00:00Z', 'cancelled', 'auto', NULL, NULL);
UPDATE reels.posting_schedule SET error = 'not approved before its slot' WHERE id = '${IDS.reelSched3}';
INSERT INTO reels.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, reposts, total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate) VALUES
 ('m-r1', '2026-10-06', '${IDS.reelAttempt}', 100, 80, 5, 1, 2, 3, 0, 11, 4000, 400000, 0.4),
 ('m-r1', '2026-10-07', '${IDS.reelAttempt}', 250, 190, 12, 2, 6, 9, 1, 30, 5200, 1300000, 0.31);`;

test('backfill Trial Reels: same hub view, slots without a video keep their idea, idempotent', async () => {
  const native = await openHubTestDb();
  await seedHubFixture(native.pg);
  const reelsOf = async (q: Parameters<typeof readAll>[0]) => {
    const d = buildDataset(await readAll(q), null, NOW);
    return { posts: d.posts.filter((p) => p.vertical === 'reels'), ideas: d.ideas.filter((i) => i.vertical === 'reels') };
  };
  const expected = await reelsOf(native.query);
  assert.ok(expected.posts.some((p) => p.status === 'published'));

  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(REEL_LEGACY);
  const spine = query as unknown as SpineQuery;
  assert.deepEqual(await backfillReels(spine), { items: 1, attempts: 2, schedule: 3, insights: 2, approvals: 1 });
  assert.deepEqual(await backfillReels(spine), { items: 0, attempts: 0, schedule: 0, insights: 0, approvals: 0 });
  assert.deepEqual(await reelsOf(query), expected);

  const slots = (await pg.query<{ idea_ref: string; content_item_id: string | null }>(
    `SELECT idea_ref, content_item_id FROM social_hub.schedule WHERE vertical = 'reels' ORDER BY id`,
  )).rows;
  assert.deepEqual(slots.map((s) => [s.idea_ref, s.content_item_id != null]), [
    [IDS.idea1, true],
    [IDS.idea2, false],
    [IDS.idea3, false],
  ], 'a slot booked before any video carries only its idea');
  const payload = (await pg.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM social_hub.publish_attempts WHERE id = '${IDS.reelAttempt}'`)).rows[0]!.payload;
  assert.equal(payload.graduation_strategy, 'MANUAL', 'the trial setting is carried, never lost');
  assert.equal(payload.audio_id, 'aud-1');
});

test('backfill Trial Reels: an attempt whose video retention deleted keeps its record on its own item', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(REEL_LEGACY);
  await pg.exec(`INSERT INTO reels.publish_attempts (id, video_job_id, post_idea_id, trigger, status, requested_at, finished_at, audio_id, caption, graduation_strategy, media_id)
                 VALUES ('${REEL_ORPHAN_ATTEMPT}', NULL, '${IDS.idea2}', 'auto', 'published', '2026-09-01T13:00:00Z', '2026-09-01T13:01:00Z', 'aud-9', 'c', 'MANUAL', 'm-old')`);
  await backfillReels(query as unknown as SpineQuery);
  const row = (await pg.query<{ native_ref: string; idea_ref: string }>(
    `SELECT ci.native_ref, ci.idea_ref FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id WHERE a.id = '${REEL_ORPHAN_ATTEMPT}'`,
  )).rows[0]!;
  assert.deepEqual([row.native_ref, row.idea_ref], [`attempt:${REEL_ORPHAN_ATTEMPT}`, IDS.idea2]);
});

// ── Contract: after the switch nothing writes the old lifecycle tables ───────

const LEGACY = /\b(social|explainers|reels)\.(posting_schedule|publish_attempts|media_insights)\b/;
/** The backfill reads them; spine-tables.ts names them in comments describing the shapes it keeps. */
const ALLOWED = new Set(['lib/social-hub/backfill.ts', 'lib/reels/spine-tables.ts']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [path.relative(process.cwd(), full)] : [];
  });
}

test('only the backfill still names the frozen Carousels, Explainers and Trial Reels lifecycle tables', () => {
  const offenders = ['lib', 'app', 'scripts', 'components']
    .flatMap((dir) => walk(path.join(process.cwd(), dir)))
    .filter((file) => !ALLOWED.has(file) && LEGACY.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('re-applying the hub schema over rows of every type never fails (no constraint narrows mid-file, D45)', async () => {
  const { pg } = await openHubTestDb({ withHubSchema: true });
  await pg.exec(`
    INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES
      ('carousels', 'feed', 'c'), ('explainers', 'reel', 'e'), ('reels', 'reel', 'r'), ('stories', 'story', 's');
    INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source)
      SELECT id, vertical, '2026-10-08', CASE vertical WHEN 'carousels' THEN 'morning' WHEN 'explainers' THEN 'late' WHEN 'reels' THEN 'evening' ELSE 'free_vs_paid' END,
             now(), 'cancelled', 'auto' FROM social_hub.content_items;
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption)
      SELECT id, vertical, CASE vertical WHEN 'reels' THEN 'mix_test' ELSE 'auto' END, 'failed', '' FROM social_hub.content_items;`);
  const sql = readFileSync(path.join(process.cwd(), 'db/social_hub_schema.sql'), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
  await pg.exec(sql);
  await assert.rejects(pg.exec(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('tiktok', 'reel', 'x')`), 'the vertical check is back after a re-apply');
});
