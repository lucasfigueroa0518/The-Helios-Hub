/**
 * The idea pool standard's pure core (spec 2026-10-21-idea-pool-standard-design):
 * queue order (pins, then effective score), the drop key for a drag, and the
 * cap's overflow. No database, no model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { POOL_CAP, capOverflow, dropKey, isArchived, queueOrder } from '@/lib/social-hub/queue';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';

const idea = (id: string, score: number | null) => ({ id, score });
let n = 0;
const move = (ideaId: string, kind: IdeaAdjustment['kind'], extra: Partial<IdeaAdjustment> = {}): IdeaAdjustment => ({
  id: `m${++n}`, vertical: 'explainers', ideaId, nyDate: '2026-10-21', kind, createdAt: new Date(Date.UTC(2026, 9, 21, 12, 0, n)).toISOString(), ...extra,
});
const ids = (q: Array<{ item: { id: string } }>) => q.map((x) => x.item.id);

const pool = [idea('a', 90), idea('b', 80), idea('c', 70), idea('d', 60), idea('e', 50)];

test('no moves: score order, nothing pinned or placed', () => {
  const q = queueOrder(pool, []);
  assert.deepEqual(ids(q), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(q.every((x) => !x.pinned && !x.placed));
  assert.deepEqual(q.map((x) => x.rank), [1, 2, 3, 4, 5]);
});

test('pins go first, in the order pinned, whatever their score', () => {
  const q = queueOrder(pool, [move('d', 'pin'), move('e', 'pin')]);
  assert.deepEqual(ids(q), ['d', 'e', 'a', 'b', 'c']);
  assert.deepEqual(q.map((x) => x.pinned), [true, true, false, false, false]);
});

test('an old Promote row reads as a pin; an old Demote row sinks its idea (the latest of an idea’s rows wins)', () => {
  const q = queueOrder(pool, [move('c', 'promote'), move('a', 'demote')]);
  assert.deepEqual(ids(q), ['c', 'b', 'd', 'e', 'a']);
  assert.deepEqual(ids(queueOrder(pool, [move('a', 'demote'), move('a', 'pin')])), ['a', 'b', 'c', 'd', 'e'], 'pinned after being demoted');
  assert.deepEqual(ids(queueOrder(pool, [move('a', 'pin'), move('a', 'demote')])), ['b', 'c', 'd', 'e', 'a'], 'demoted after being pinned');
});

test('a placement key sorts the idea among the others, not above them all', () => {
  const q = queueOrder(pool, [move('e', 'place', { sortKey: 70.01 })]);
  assert.deepEqual(ids(q), ['a', 'b', 'e', 'c', 'd']);
  assert.equal(q[2]!.placed, true);
  assert.equal(q[2]!.effective, 70.01);
});

test('the latest placement wins; a pin outranks a placement', () => {
  const q = queueOrder(pool, [move('e', 'place', { sortKey: 85 }), move('e', 'place', { sortKey: 55 }), move('d', 'place', { sortKey: 99 }), move('d', 'pin')]);
  assert.deepEqual(ids(q), ['d', 'a', 'b', 'c', 'e']);
});

test('archived ideas are gone, and stay gone', () => {
  const moves = [move('b', 'archive')];
  assert.equal(isArchived(moves, 'b'), true);
  assert.equal(isArchived(moves, 'a'), false);
  assert.deepEqual(ids(queueOrder(pool, moves)), ['a', 'c', 'd', 'e']);
});

test('moves on ideas that are not in the pool are ignored', () => {
  const q = queueOrder(pool, [move('zzz', 'pin'), move('yyy', 'place', { sortKey: 100 })]);
  assert.deepEqual(ids(q), ['a', 'b', 'c', 'd', 'e']);
});

test('unscored ideas sort last, in the order given', () => {
  assert.deepEqual(ids(queueOrder([idea('x', null), idea('a', 5), idea('y', null)], [])), ['a', 'x', 'y']);
});

test('dropKey: dragged up, lands 0.01 above the idea now below it', () => {
  // 15 -> 5: the others (without the dragged idea) are 14 long; inserting at index 4 puts it above the idea at index 4.
  const others = [100, 95, 90, 85, 80, 75];
  assert.equal(dropKey(others, 4, true), 80.01);
});

test('dropKey: dragged down, lands 0.01 below the idea now above it', () => {
  const others = [100, 95, 90, 85, 80, 75];
  assert.equal(dropKey(others, 4, false), 84.99);
});

test('dropKey: top and bottom of the list', () => {
  assert.equal(dropKey([50, 40], 0, true), 50.01);
  assert.equal(dropKey([50, 40], 2, false), 39.99);
});

test('dropKey: a gap under 0.02 uses the midpoint, and stays between the neighbours', () => {
  const k = dropKey([50, 49.99], 1, true);
  assert.ok(k < 50 && k > 49.99);
});

test('dropKey: unscored neighbours', () => {
  assert.equal(dropKey([50, null, null], 1, false), 49.99);
  assert.equal(dropKey([null, null], 0, true), 0.01);
  assert.equal(dropKey([], 0, true), 0);
});

test('a dropped idea lands exactly where it was dropped, including between near scores', () => {
  const items = [idea('a', 50), idea('b', 49.99), idea('c', 10)];
  const others = [50, 49.99];
  const key = dropKey(others, 1, true);
  const q = queueOrder([...items, idea('z', 1)], [move('z', 'place', { sortKey: key })]);
  assert.deepEqual(ids(q), ['a', 'z', 'b', 'c']);
});

test('capOverflow: drops the lowest unprotected, never a protected one', () => {
  const items = Array.from({ length: 34 }, (_, i) => idea(`i${i}`, 100 - i));
  const queued = queueOrder(items, [move('i33', 'pin')]);
  const protectedIds = new Set(['i32']);
  const dropped = capOverflow(queued, POOL_CAP, (q) => q.pinned || q.placed || protectedIds.has(q.item.id));
  assert.equal(POOL_CAP, 30);
  assert.deepEqual(dropped.map((d) => d.id), ['i29', 'i30', 'i31'], 'the pin leads (rank 1), so i0 to i28 hold the other places; i32 is protected, past the line');
});

test('capOverflow: nothing to drop at or under the cap, and protected ideas may push the pool past it', () => {
  const small = queueOrder(Array.from({ length: 30 }, (_, i) => idea(`i${i}`, 100 - i)), []);
  assert.deepEqual(capOverflow(small, 30, () => false), []);
  const allProtected = queueOrder(Array.from({ length: 33 }, (_, i) => idea(`i${i}`, 100 - i)), []);
  assert.deepEqual(capOverflow(allProtected, 30, () => true), []);
});

test('orderForNight: archived dropped, pins lead in pin order, placed ideas slot in by key, the rest keep the worker’s order', async () => {
  const { orderForNight } = await import('@/lib/social-hub/queue');
  const list = [idea('a', 90), idea('b', 80), idea('c', 70), idea('d', 60), idea('e', 50)];
  const night = (over: Partial<Parameters<typeof orderForNight>[3]> = {}) => ({ pins: [] as string[], placed: new Map<string, number>(), archived: new Set<string>(), ...over });
  const order = (n: ReturnType<typeof night>, l = list) => orderForNight(l, (x) => x.id, (x) => x.score, n).map((x) => x.id).join('');
  assert.equal(order(night()), 'abcde');
  assert.equal(order(night({ archived: new Set(['b']) })), 'acde');
  assert.equal(order(night({ pins: ['e', 'd'] })), 'edabc');
  assert.equal(order(night({ placed: new Map([['e', 75]]) })), 'abecd');
  assert.equal(order(night({ placed: new Map([['a', 10]]) })), 'bcdea');
  assert.equal(order(night({ pins: ['c'], placed: new Map([['e', 85]]), archived: new Set(['a']) })), 'cebd');
  assert.equal(order(night(), [idea('x', 5), idea('y', 5)]), 'xy', 'the worker’s order is not re-sorted');
});

test('tonightMoves on a queue type: ordered pins (a skipped one steps aside), archived, placed, and the demoted', async () => {
  const { tonightMoves } = await import('@/lib/social-hub/views/moves');
  const m = [
    move('explainers:topic:a', 'pin'), move('explainers:topic:b', 'promote'), move('explainers:topic:c', 'pin', { skipReason: 'nope' }),
    move('explainers:topic:d', 'place', { sortKey: 70 }), move('explainers:topic:e', 'archive'), move('explainers:topic:f', 'demote'),
    move('explainers:topic:a', 'place', { sortKey: 99 }),
  ];
  const t = tonightMoves(m, 'explainers');
  assert.deepEqual(t.pins.map((p) => p.ideaId.slice(-1)), ['a', 'b']);
  assert.equal(t.promote?.ideaId, 'explainers:topic:a');
  assert.deepEqual([...t.archived], ['explainers:topic:e']);
  assert.deepEqual([...t.placed], [['explainers:topic:d', 70]], 'a placement on a pinned idea is ignored');
  assert.deepEqual([...t.demoted], ['explainers:topic:f']);
  const legacy = tonightMoves([{ ...move('reels:idea:x', 'promote'), vertical: 'reels' }], 'reels');
  assert.equal(legacy.pins.length, 1, 'a type not on the queue keeps its single promote');
});
