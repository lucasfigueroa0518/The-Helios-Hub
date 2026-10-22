/** The queue API's parser and the server-side drop key (no database). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { keyFor, parseQueueAction } from '@/lib/content-type/idea-queue';
import type { HubDataset } from '@/lib/social-hub/dataset';

const A = 'explainers:topic:a';
const B = 'explainers:topic:b';

test('parseQueueAction accepts each action and rejects other types’ ideas, bad actions and long lists', () => {
  assert.deepEqual(parseQueueAction({ vertical: 'explainers', action: 'pin', ideaId: A }), { action: 'pin', vertical: 'explainers', ideaId: A });
  assert.deepEqual(parseQueueAction({ vertical: 'explainers', action: 'place', ideaId: A, aboveId: B, belowId: null, up: true }),
    { action: 'place', vertical: 'explainers', ideaId: A, aboveId: B, belowId: null, up: true });
  assert.throws(() => parseQueueAction({ vertical: 'explainers', action: 'pin', ideaId: 'reels:idea:x' }), /Unknown idea/);
  assert.throws(() => parseQueueAction({ vertical: 'nope', action: 'pin', ideaId: A }), /Unknown content type/);
  assert.throws(() => parseQueueAction({ vertical: 'explainers', action: 'delete', ideaId: A }), /action must be/);
  assert.throws(() => parseQueueAction({ vertical: 'explainers', action: 'reorder-pins', order: new Array(201).fill(A) }), /order must/);
  assert.throws(() => parseQueueAction(null), /Unknown content type/);
  assert.throws(() => parseQueueAction({ vertical: 'last_few_days', action: 'pin', ideaId: 'last_few_days:story:x' }), /does not take pins/, 'a type whose night does not follow the queue refuses');
});

test('keyFor: the key comes from the neighbours the dataset shows, 0.01 off the one it moved toward', () => {
  const idea = (id: string, score: number) => ({ id, vertical: 'explainers', score }) as never;
  const dataset = { ideas: [idea('explainers:topic:a', 90), idea('explainers:topic:b', 80), idea('explainers:topic:c', 70), idea('explainers:topic:d', 60)], adjustments: [] } as unknown as HubDataset;
  const place = (aboveId: string | null, belowId: string | null, up: boolean) => ({ action: 'place' as const, vertical: 'explainers' as const, ideaId: 'explainers:topic:d', aboveId, belowId, up });
  assert.equal(keyFor(dataset, place('explainers:topic:a', 'explainers:topic:b', true)), 80.01);
  assert.equal(keyFor(dataset, place('explainers:topic:a', 'explainers:topic:b', false)), 89.99);
  assert.equal(keyFor(dataset, place(null, 'explainers:topic:a', true)), 90.01);
  assert.equal(keyFor(dataset, place('explainers:topic:c', null, false)), 69.99);
});
