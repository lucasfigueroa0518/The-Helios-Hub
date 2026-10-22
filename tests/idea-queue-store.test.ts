/**
 * The pool standard's writes (pin, unpin, place, archive, expiry) on PGlite with the
 * real schema files: what each leaves in social_hub.idea_adjustments, and that
 * readAdjustments and the queue read it back.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { queueOrder } from '@/lib/social-hub/queue';
import { archiveIdea, expireOldPlacements, finishPlacements, pinIdea, placeIdea, reorderPins, unpinIdea } from '@/lib/social-hub/queue-store';
import { readAdjustments } from '@/lib/social-hub/queries/day';
import { readMoves } from '@/lib/social-hub/moves-store';
import { madeMoveIds } from '@/lib/social-hub/views/day-rank';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const V = 'explainers' as const;
const A = 'explainers:topic:a';
const B = 'explainers:topic:b';
const C = 'explainers:topic:c';
const ideas = [{ id: A, score: 90 }, { id: B, score: 80 }, { id: C, score: 70 }];
const order = async (q: Parameters<typeof readAdjustments>[0]) => queueOrder(ideas, await readAdjustments(q, '2026-10-21')).map((x) => x.item.id.slice(-1));

test('pin: leads the queue, twice is once, unpin takes it off', async () => {
  const { query: q } = await openHubTestDb();
  await pinIdea(q, V, C, 'tommy');
  await pinIdea(q, V, C, 'tommy');
  assert.equal((await readAdjustments(q, '2026-10-21')).length, 1);
  assert.deepEqual(await order(q), ['c', 'a', 'b']);
  await unpinIdea(q, V, C);
  assert.deepEqual(await order(q), ['a', 'b', 'c']);
});

test('pins hold the order they were made, and reorderPins rewrites it', async () => {
  const { query: q } = await openHubTestDb();
  await pinIdea(q, V, B, null);
  await pinIdea(q, V, C, null);
  assert.deepEqual(await order(q), ['b', 'c', 'a']);
  await reorderPins(q, V, [C, B], null);
  assert.deepEqual(await order(q), ['c', 'b', 'a']);
});

test('place: sorts among the others, replaces its earlier placement, and a pin uses it up', async () => {
  const { query: q } = await openHubTestDb();
  await placeIdea(q, V, C, 90.01, 'tommy');
  assert.deepEqual(await order(q), ['c', 'a', 'b']);
  await placeIdea(q, V, C, 79.99, 'tommy');
  assert.equal((await readAdjustments(q, '2026-10-21')).filter((m) => m.kind === 'place').length, 1);
  assert.deepEqual(await order(q), ['a', 'b', 'c']);
  await pinIdea(q, V, B, null);
  await placeIdea(q, V, B, 10, null); // a drag takes a pinned idea off the pins and puts it where it was dropped
  assert.deepEqual(await order(q), ['a', 'c', 'b']);
});

test('dragging a placed idea into the pins pins it', async () => {
  const { query: q } = await openHubTestDb();
  await placeIdea(q, V, C, 85, null);
  await pinIdea(q, V, C, null);
  const rows = await readAdjustments(q, '2026-10-21');
  assert.deepEqual(rows.map((m) => m.kind), ['pin']);
});

test('archive: hides the idea for good, writes once, and clears its pin and placement', async () => {
  const { query: q } = await openHubTestDb();
  await pinIdea(q, V, A, null);
  await archiveIdea(q, V, A, 'tommy');
  await archiveIdea(q, V, A, 'tommy');
  const rows = await readAdjustments(q, '2026-10-21');
  assert.deepEqual(rows.map((m) => m.kind), ['archive']);
  assert.deepEqual(await order(q), ['b', 'c']);
  assert.deepEqual(madeMoveIds(rows, [{ vertical: V, status: 'ready', idea: { id: 'a' }, generatedAt: '2030-01-01T00:00:00Z' } as never]), []);
});

test('finishPlacements uses up placements only; pins stay. A Stories series can be finished alone', async () => {
  const { query: q } = await openHubTestDb();
  await pinIdea(q, V, A, null);
  await placeIdea(q, V, B, 75, null);
  await finishPlacements(q, V);
  assert.deepEqual((await readAdjustments(q, '2026-10-21')).map((m) => m.kind), ['pin']);
  await placeIdea(q, 'stories', 'stories:pool:morning_download:x', 5, null);
  await placeIdea(q, 'stories', 'stories:pool:free_vs_paid:y', 5, null);
  await finishPlacements(q, 'stories', 'stories:pool:morning_download:');
  const left = await readMoves(q, 'stories');
  assert.deepEqual(left.map((m) => m.ideaId), ['stories:pool:free_vs_paid:y']);
});

test('expireOldPlacements: a week-old placement goes, a fresh one and any pin stay', async () => {
  const { query: q } = await openHubTestDb();
  await placeIdea(q, V, A, 95, null);
  await placeIdea(q, V, B, 75, null);
  await pinIdea(q, V, C, null);
  await q(`UPDATE social_hub.idea_adjustments SET created_at = now() - interval '8 days' WHERE idea_id = $1`, [A]);
  await q(`UPDATE social_hub.idea_adjustments SET created_at = now() - interval '8 days' WHERE idea_id = $1`, [C]);
  await expireOldPlacements(q, V);
  assert.deepEqual((await readMoves(q, V)).map((m) => [m.ideaId.slice(-1), m.kind]).sort(), [['b', 'place'], ['c', 'pin']]);
});
