/** SH-47 (Social Hub P2-M2): feed posts stay ≥ 30 minutes apart; Stories and Trial Reels exempt (D33). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { spacedOffsets } from '@/lib/instagram/window';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, seedHubFixture } from './fixtures/social-hub/seed';

test('spacedOffsets keeps exactly the minutes ≥ 30 minutes from every busy instant', () => {
  const base = Date.parse('2026-10-12T13:00:00Z');
  const at = (o: number) => new Date(base + o * 60_000);
  assert.deepEqual(spacedOffsets(at, 0, 61, [at(30)]), [0, ...Array.from({ length: 1 }, () => 60)]);
  assert.equal(spacedOffsets(at, 0, 10, []).length, 10);
});

test('busy feed times read Explainers and Carousels, never Trial Reels, and skip a missing schema', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  const q = (text: string, params?: unknown[]) => query(text, params) as Promise<{ rows: Array<Record<string, unknown>> }>;
  const from = new Date('2026-10-06T00:00:00Z');
  const all = (await busyFeedTimes(q, from)).map((d) => d.toISOString()).sort();
  assert.ok(all.includes('2026-10-06T19:30:00.000Z') && all.includes('2026-10-06T11:30:00.000Z'));
  assert.ok(!all.includes('2026-10-06T13:30:00.000Z'), 'a booked Trial Reel is not a feed post (D33)');
  assert.ok(!all.includes('2026-10-06T23:00:00.000Z'), 'a cancelled slot is not a feed post');
  await pg.exec('DROP SCHEMA explainers CASCADE');
  assert.ok((await busyFeedTimes(q, from)).length > 0, 'a missing schema is skipped, not fatal');
  void IDS;
});
