/**
 * Promote / Demote last until used (B8), on PGlite with the real schema
 * files: the hub reads active moves from any day, marks used ones consumed in
 * one place, and falls back to today's moves before the column exists. The
 * Stories build reads the same active moves.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubQuery } from '@/lib/social-hub/db';
import { consumeMoves, readAdjustments } from '@/lib/social-hub/queries/day';
import type { HubPost } from '@/lib/social-hub/types';
import { activeStoryMoves } from '@/lib/stories/build';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

const TODAY = '2026-10-14';
const YESTERDAY = '2026-10-13';

async function addMove(q: HubQuery, vertical: string, ideaId: string, nyDate: string, kind: 'promote' | 'demote', createdAt: string): Promise<string> {
  return (await q<{ id: string }>(
    `INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ($1, $2, $3::date, $4, $5::timestamptz) RETURNING id::text AS id`,
    [vertical, ideaId, nyDate, kind, createdAt],
  )).rows[0]!.id;
}

test('readAdjustments: unused moves from any day, oldest first, with ISO times; used ones are gone', async () => {
  const { query: q } = await openHubTestDb();
  const old = await addMove(q, 'reels', 'reels:idea:a', YESTERDAY, 'promote', '2026-10-13T15:00:00Z');
  const used = await addMove(q, 'reels', 'reels:idea:b', YESTERDAY, 'demote', '2026-10-13T16:00:00Z');
  const fresh = await addMove(q, 'carousels', 'carousels:story:s1', TODAY, 'promote', '2026-10-14T13:00:00Z');
  await q(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = $1`, [used]);
  const got = await readAdjustments(q, TODAY);
  assert.deepEqual(got.map((a) => [a.id, a.nyDate, a.createdAt]), [[old, YESTERDAY, '2026-10-13T15:00:00.000Z'], [fresh, TODAY, '2026-10-14T13:00:00.000Z']]);
});

test('readAdjustments before the consumed_at column is applied: today’s moves, as before Phase B', async () => {
  const { pg, query: q } = await openHubTestDb();
  await addMove(q, 'reels', 'reels:idea:a', YESTERDAY, 'promote', '2026-10-13T15:00:00Z');
  const today = await addMove(q, 'reels', 'reels:idea:b', TODAY, 'promote', '2026-10-14T13:00:00Z');
  await pg.exec(`ALTER TABLE social_hub.idea_adjustments DROP COLUMN consumed_at`);
  assert.deepEqual((await readAdjustments(q, TODAY)).map((a) => a.id), [today]);
});

test('consumeMoves: a move whose idea got content after it, and a Stories move whose pool entry was used, are marked and drop out', async () => {
  const { query: q } = await openHubTestDb();
  const reel = await addMove(q, 'reels', 'reels:idea:a', TODAY, 'promote', '2026-10-14T13:00:00Z');
  const keep = await addMove(q, 'reels', 'reels:idea:b', TODAY, 'promote', '2026-10-14T13:05:00Z');
  const story = await addMove(q, 'stories', 'stories:pool:free_vs_paid:pair-1', YESTERDAY, 'promote', '2026-10-13T12:00:00Z');
  await q(`INSERT INTO stories.pool (series, key, origin, ref, title, used_at) VALUES ('free_vs_paid', 'pair-1', 'catalog', 'r', 'Pair 1', now())`);
  const posts = [{ id: 'p1', vertical: 'reels', status: 'ready', idea: { id: 'a', label: 'A' }, generatedAt: '2026-10-14T14:00:00Z' }] as unknown as HubPost[];
  const active = await consumeMoves(q, await readAdjustments(q, TODAY), posts);
  assert.deepEqual(active.map((a) => a.id), [keep]);
  const consumed = (await q<{ id: string }>(`SELECT id::text AS id FROM social_hub.idea_adjustments WHERE consumed_at IS NOT NULL`)).rows.map((r) => r.id);
  assert.deepEqual(consumed.sort(), [reel, story].sort());
  assert.deepEqual((await readAdjustments(q, TODAY)).map((a) => a.id), [keep], 'the next read no longer sees them');
});

test('the Stories build reads the series’ unused moves from any day, as pool keys', async () => {
  const { db } = await harnessDb();
  const add = (ideaId: string, kind: string, at: string) =>
    db.query<{ id: string }>(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('stories', $1, $2::date, $3, $4::timestamptz) RETURNING id::text AS id`, [ideaId, at.slice(0, 10), kind, at]);
  await add('stories:pool:free_vs_paid:k1', 'promote', '2026-10-13T12:00:00Z');
  const used = (await add('stories:pool:free_vs_paid:k2', 'demote', '2026-10-13T12:05:00Z')).rows[0]!.id;
  await add('stories:pool:morning_download:k3', 'promote', '2026-10-14T12:00:00Z');
  await db.query(`UPDATE social_hub.idea_adjustments SET consumed_at = now() WHERE id = $1`, [used]);
  assert.deepEqual(await activeStoryMoves(db, 'free_vs_paid'), [{ ideaId: 'k1', kind: 'promote' }]);
});

test('the Stories build before the consumed_at column exists: today’s moves, as before Phase B', async () => {
  const { db } = await harnessDb();
  const now = new Date('2026-10-14T16:00:00Z');
  const ins = (key: string, day: string) => db.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('stories', $1, $2::date, 'promote')`, [`stories:pool:free_vs_paid:${key}`, day]);
  await ins('old', '2026-10-13');
  await ins('today', '2026-10-14');
  await db.query(`ALTER TABLE social_hub.idea_adjustments DROP COLUMN consumed_at`);
  assert.deepEqual(await activeStoryMoves(db, 'free_vs_paid', now), [{ ideaId: 'today', kind: 'promote' }]);
});
