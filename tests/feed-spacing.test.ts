/** SH-47 (Social Hub P2-M2): feed posts across every type stay ≥ 30 minutes apart; Stories exempt. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { spacedOffsets } from '@/lib/instagram/window';
import { chooseSlot } from '@/lib/reels/publish/slots';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, seedHubFixture } from './fixtures/social-hub/seed';

test('Trial Reels: with nothing booked the draw is unchanged; a carousel at 9:00 pushes the morning reel to 9:30', () => {
  const now = new Date('2026-10-12T07:00:00Z'); // 3:00 AM EDT
  const plain = chooseSlot(now, new Set(), () => 0)!;
  assert.deepEqual([plain.slot, plain.publishAt.toISOString()], ['morning', '2026-10-12T12:45:00.000Z']); // 8:45 AM, as before
  const spaced = chooseSlot(now, new Set(), () => 0, undefined, undefined, [new Date('2026-10-12T13:00:00Z')])!;
  assert.deepEqual([spaced.slot, spaced.publishAt.toISOString()], ['morning', '2026-10-12T13:30:00.000Z']);
});

test('spacedOffsets keeps exactly the minutes ≥ 30 minutes from every busy instant', () => {
  const base = Date.parse('2026-10-12T13:00:00Z');
  const at = (o: number) => new Date(base + o * 60_000);
  assert.deepEqual(spacedOffsets(at, 0, 61, [at(30)]), [0, ...Array.from({ length: 1 }, () => 60)]);
  assert.equal(spacedOffsets(at, 0, 10, []).length, 10);
});

test('busy feed times read every other schema and skip a schema that is missing', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  const q = (text: string, params?: unknown[]) => query(text, params) as Promise<{ rows: Array<Record<string, unknown>> }>;
  const from = new Date('2026-10-06T00:00:00Z');
  const all = (await busyFeedTimes(q, from)).map((d) => d.toISOString()).sort();
  assert.ok(all.includes('2026-10-06T13:30:00.000Z') && all.includes('2026-10-06T19:30:00.000Z') && all.includes('2026-10-06T11:30:00.000Z'));
  assert.ok(!all.includes('2026-10-06T23:00:00.000Z'), 'a cancelled slot is not a feed post');
  const noReels = (await busyFeedTimes(q, from, 'reels')).map((d) => d.toISOString());
  assert.ok(!noReels.includes('2026-10-06T13:30:00.000Z'));
  await pg.exec('DROP SCHEMA explainers CASCADE');
  assert.ok((await busyFeedTimes(q, from)).length > 0, 'a missing schema is skipped, not fatal');
  void IDS;
});
