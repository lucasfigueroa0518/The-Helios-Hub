import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { reelsLane } from '@/lib/lfd/sources';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { resetSeed, seedReelsIdea, seedScore } from './fixtures/lfd/seed';

beforeEach(() => resetSeed());

test('an idea first timely inside the window is eligible; its carryover score counts', async () => {
  const { query } = await openHubTestDb();
  const fridayNight = await seedReelsIdea(query, { headline: 'Story broke Friday night', url: 'https://a.com/1' });
  await seedScore(query, fridayNight, { nyDate: '2026-10-10', origin: 'timely', net: 0.4 });
  await seedScore(query, fridayNight, { nyDate: '2026-10-11', origin: 'carryover', net: 0.7 });
  const lane = await reelsLane(query, { after: '2026-10-09', through: '2026-10-13' });
  assert.equal(lane.length, 1);
  assert.equal(lane[0]!.headline, 'Story broke Friday night');
  assert.equal(lane[0]!.net, 0.7);
  assert.equal(lane[0]!.firstSeen, '2026-10-10');
  assert.deepEqual(lane[0]!.refs, [fridayNight]);
});

test('an idea first timely before the window is excluded even if carried over into it', async () => {
  const { query } = await openHubTestDb();
  const old = await seedReelsIdea(query, { headline: 'Old news', url: 'https://a.com/2' });
  await seedScore(query, old, { nyDate: '2026-10-09', origin: 'timely', net: 0.9 });
  await seedScore(query, old, { nyDate: '2026-10-10', origin: 'carryover', net: 0.9 });
  assert.equal((await reelsLane(query, { after: '2026-10-09', through: '2026-10-13' })).length, 0);
});

test('blockbusters rank first, then best net', async () => {
  const { query } = await openHubTestDb();
  const a = await seedReelsIdea(query, { headline: 'High net', url: 'https://a.com/a' });
  const b = await seedReelsIdea(query, { headline: 'Blockbuster', url: 'https://a.com/b' });
  await seedScore(query, a, { nyDate: '2026-10-12', origin: 'timely', net: 0.9 });
  await seedScore(query, b, { nyDate: '2026-10-12', origin: 'timely', net: 0.2, blockbuster: 1 });
  const lane = await reelsLane(query, { after: '2026-10-09', through: '2026-10-13' });
  assert.deepEqual(lane.map((c) => c.headline), ['Blockbuster', 'High net']);
});
