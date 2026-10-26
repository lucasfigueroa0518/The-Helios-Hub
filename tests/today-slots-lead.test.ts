/**
 * Today's slots follow the list (Lucas, 2026-10-26): the last run's picks lead the queue (made ones first), a pin or a
 * drag still wins, a drag above the picks keeps its place on the next read, and the slots are the top of the list as
 * the person sees it with booked ones held.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { reelIdeas } from '@/lib/social-hub/adapters/reels';
import type { ReelIdeaRow } from '@/lib/social-hub/queries/reels';
import { dropKeyBetween, queueOrder, runLead, slotsFromOrder } from '@/lib/social-hub/queue';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';

let n = 0;
const move = (ideaId: string, kind: IdeaAdjustment['kind'], extra: Partial<IdeaAdjustment> = {}): IdeaAdjustment => ({
  id: `m${++n}`, vertical: 'reels', ideaId, nyDate: '2026-10-26', kind, createdAt: new Date(Date.UTC(2026, 9, 26, 12, 0, n)).toISOString(), ...extra,
});
const items = [
  { id: 'a', score: 3.87 },
  { id: 'b', score: 3.8 },
  { id: 'c', score: 3.79 },
  { id: 'z', score: 2.8 },
];
const ids = (q: ReturnType<typeof queueOrder>) => q.map((x) => x.item.id);

test('the last run’s picks lead the queue in their order, a step above the best other idea', () => {
  const q = queueOrder(items, [], ['z', 'b']);
  assert.deepEqual(ids(q), ['z', 'b', 'a', 'c']);
  assert.ok(q[1]!.effective! > 3.87 && q[0]!.effective! > q[1]!.effective!);
  assert.ok(q[0]!.effective! < 3.9, 'lead keys stay on the score scale');
  assert.deepEqual(ids(queueOrder(items, [])), ['a', 'b', 'c', 'z'], 'no lead: score order');
});

test('a pin and a drag win over the lead, and a drag above the lead stays above it on the next read', () => {
  assert.deepEqual(ids(queueOrder(items, [move('c', 'pin')], ['z', 'b'])), ['c', 'z', 'b', 'a']);
  // Drag "a" to the very top: its key is a step above the first lead idea as the page showed it.
  const shown = queueOrder(items, [], ['z', 'b']);
  const key = dropKeyBetween(undefined, shown[0]!.effective, true);
  assert.deepEqual(ids(queueOrder(items, [move('a', 'place', { sortKey: key })], ['z', 'b'])), ['a', 'z', 'b', 'c']);
  // A dragged lead idea leaves the lead and sorts by its key.
  assert.deepEqual(ids(queueOrder(items, [move('z', 'place', { sortKey: 3.795 })], ['z', 'b'])), ['b', 'a', 'z', 'c']);
});

test('slots: booked ones hold their place, then the top of the list, never more than the day’s slots', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(slotsFromOrder(list, () => false, 3), ['a', 'b', 'c']);
  assert.deepEqual(slotsFromOrder(list, (x) => x === 'd', 3), ['d', 'a', 'b']);
  assert.deepEqual(slotsFromOrder(['b', 'a', 'c'], () => false, 2), ['b', 'a'], 'a reorder changes the slots at once');
  assert.deepEqual(slotsFromOrder(list, () => false, 0), []);
});

const row = (id: string, rank: number, extra: Partial<ReelIdeaRow> = {}): ReelIdeaRow => ({
  post_idea_id: id, headline: id, net: 4 - rank / 100, rank, selected: false, origin: 'fresh', scored_at: '2026-10-26T05:00:00Z',
  published: false, scheduled: false, has_video: false, video_count: 0, last_video_at: null, on_latest: true, ...extra,
});

test('Text on Screen ideas carry the run’s picks (made first) and say why a higher-ranked idea was skipped', () => {
  const ideas = reelIdeas([
    row('one', 1),
    row('two', 2, { selected: true }),
    row('three', 3, { copy_missed: true }),
    row('low', 39, { selected: true, made_on_latest: true }),
    row('below', 40),
    row('seed', 5, { selected: true, on_latest: false, yours: true }),
  ]);
  const by = new Map(ideas.map((i) => [i.id.replace('reels:idea:', ''), i]));
  assert.equal(by.get('low')!.runPick, 0, 'the made pick leads');
  assert.equal(by.get('two')!.runPick, 1);
  assert.equal(by.get('seed')!.runPick, null, 'an older slate’s pick is no pick');
  assert.equal(by.get('one')!.runSkip, 'Skipped by the last run');
  assert.equal(by.get('three')!.runSkip, 'Skipped: copy didn’t pass');
  assert.equal(by.get('below')!.runSkip, null, 'ranked under every pick: not a skip');
  assert.deepEqual(runLead(ideas).map((id) => id.replace('reels:idea:', '')), ['low', 'two']);
});
