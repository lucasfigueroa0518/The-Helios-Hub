/**
 * Last Few Days and AI Events follow the shared idea queue (Tommy, 2026-11-16: "Yes, same buttons"), and the queue API
 * takes Field Notes, Last Few Days and AI Events ideas. Pure, no database, no model:
 *   - nightQueue: pins in the order pinned, drags, archives (an archive outranks a pin; a skipped pin steps aside)
 *   - Last Few Days' Selector: pins after the seeds and before the lanes, archived stories gone, a drag moves a story in its lane
 *   - AI Events: a shared pin is a pin and a shared archive an exclude (with the AE-04 columns), pins in the order pinned,
 *     a dragged event ranks at its key
 *   - parseQueueAction accepts the three types' ideas once config.ts has them on the live queue
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseQueueAction } from '@/lib/content-type/idea-queue';
import { Selector } from '@/lib/lfd/pick';
import type { LfdCandidate } from '@/lib/lfd/types';
import { choosePicks, rankCity, type RankInput } from '@/lib/networking/pick/picks';
import { weekHolds } from '@/lib/networking/pick/rank';
import { nightQueue, QUEUE_LIVE } from '@/lib/social-hub/queue';
import type { JevAsk } from '@/lib/social/jev/client';

const NOW = new Date('2026-11-16T08:00:00Z');

test('nightQueue: pins in the order pinned, drags by key, archives; an archive outranks a pin; a skipped pin steps aside; other prefixes ignored', () => {
  const q = nightQueue([
    { ideaId: 'x:b', kind: 'pin' },
    { ideaId: 'x:a', kind: 'pin' },
    { ideaId: 'x:c', kind: 'pin', skipReason: 'gone' },
    { ideaId: 'x:d', kind: 'place', sortKey: 4 },
    { ideaId: 'x:a', kind: 'archive' },
    { ideaId: 'y:z', kind: 'pin' },
  ], 'x:');
  assert.deepEqual(q.pins, ['b']);
  assert.deepEqual([...q.placed], [['d', 4]]);
  assert.deepEqual([...q.archived], ['a']);
});

// ── Last Few Days ────────────────────────────────────────────────────────────

const lfd = (key: string, o: { major?: number; net?: number }): LfdCandidate => ({
  key, refs: [key], origin: 'reels', headline: `Story ${key} about Company${key.toUpperCase()}`, sourceName: 'News', url: `https://news.test/${key}`, body: 'body',
  publishedAt: '2026-11-15T00:00:00Z', net: o.net ?? null, blockbuster: 0, firstSeen: null, alsoFrom: [], major: o.major ?? null, builder: null, eventDate: null,
}) as LfdCandidate;
const noJev: JevAsk = async () => {
  throw new Error('no Jev call expected');
};
const leads = [lfd('m1', { major: 0.9 }), lfd('m2', { major: 0.8 })];
const rundown = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((k, i) => lfd(k, { net: 0.9 - i * 0.1 }));
const fill = async (queue?: Parameters<typeof nightQueue>[0]) => (await new Selector(leads, rundown, [], noJev, [], NOW, queue ? nightQueue(queue) : undefined).fill()).map((p) => p.key).join(',');

test('Last Few Days without moves: leads by margin, then the rundown by net, as before', async () => {
  assert.equal(await fill(), 'm1,m2,r1,r2,r3,r4');
  assert.equal(await fill([]), 'm1,m2,r1,r2,r3,r4');
});

test('Last Few Days: a pin goes in first, an archived story never, a dragged story moves up its lane', async () => {
  assert.equal(
    await fill([
      { ideaId: 'r1', kind: 'archive' },
      { ideaId: 'r6', kind: 'pin' },
      // The hub scores the queue by position (0, -1, ...): -1.5 sits between m2 and the rundown's head.
      { ideaId: 'r5', kind: 'place', sortKey: -1.5 },
    ]),
    'r6,m1,m2,r5,r2,r3',
  );
  // An archived lead is gone too, and a seed still goes before a pin.
  const seed = { ...lfd('s1', {}), origin: 'seed' as const, yours: true };
  const picks = await new Selector(leads, rundown, [], noJev, [seed], NOW, nightQueue([{ ideaId: 'm1', kind: 'archive' }, { ideaId: 'r4', kind: 'pin' }])).fill();
  assert.equal(picks.map((p) => p.key).join(','), 's1,r4,m2,r1,r2,r3');
});

// ── AI Events ────────────────────────────────────────────────────────────────

const ev = (id: string, score: number, o: Partial<RankInput> = {}): RankInput => ({ eventId: id, score, gate: null, organizerKey: null, startAt: '2026-11-20T18:00:00Z', going: 10, pinned: false, excluded: false, ...o });

test('AI Events: shared pins and archives join the AE-04 columns; pins in the order pinned; a drag ranks at its key', () => {
  const holds = weekHolds(
    [
      { event_id: 'col-pin', pinned_at: '2026-11-15T10:00:00Z', excluded_at: null },
      { event_id: 'col-ex', pinned_at: null, excluded_at: '2026-11-15T10:00:00Z' },
    ],
    nightQueue([{ ideaId: 'e5', kind: 'pin' }, { ideaId: 'e4', kind: 'pin' }, { ideaId: 'e1', kind: 'archive' }, { ideaId: 'e3', kind: 'place', sortKey: 9.5 }]),
  );
  assert.deepEqual([...holds.pinned], ['e5', 'e4', 'col-pin']);
  assert.deepEqual([...holds.excluded].sort(), ['col-ex', 'e1']);
  assert.deepEqual([...holds.placed], [['e3', 9.5]]);

  const events = ['e1', 'e2', 'e3', 'e4', 'e5', 'col-pin', 'col-ex'].map((id, i) => ev(id, 9 - i, {
    pinned: holds.pinned.has(id), excluded: holds.excluded.has(id), pinOrder: holds.pinOrder.get(id) ?? null, sortKey: holds.placed.get(id) ?? null,
  }));
  assert.deepEqual(rankCity(events).map((e) => e.eventId).slice(0, 2), ['e3', 'e1'], 'the dragged event ranks at its key');
  assert.deepEqual(choosePicks(events).map((e) => e.eventId), ['e5', 'e4', 'col-pin', 'e3', 'e2'], 'pins first in the order pinned; archived (excluded) events never');
});

test('AI Events without shared moves: the columns alone, as before', () => {
  const holds = weekHolds([{ event_id: 'a', pinned_at: '2026-11-15T10:00:00Z', excluded_at: null }], nightQueue([]));
  assert.deepEqual([...holds.pinned], ['a']);
  assert.equal(holds.excluded.size, 0);
});

// ── the queue API ────────────────────────────────────────────────────────────

test('parseQueueAction takes Field Notes, Last Few Days and AI Events ideas (pin, place, reorder-pins, archive) once they are live', () => {
  const ids = { field_notes: 'field_notes:tip:11111111-1111-4111-8111-111111111111', last_few_days: 'last_few_days:story:news.test/a', ai_events: 'ai_events:event:22222222-2222-4222-8222-222222222222' } as const;
  for (const [vertical, ideaId] of Object.entries(ids)) {
    if (!QUEUE_LIVE.has(vertical)) {
      // Builder A's config.ts change makes them live; until then the gate answers, never "Unknown content type".
      assert.throws(() => parseQueueAction({ vertical, action: 'pin', ideaId }), (e: Error) => !/Unknown content type|Unknown idea/.test(e.message));
      continue;
    }
    assert.deepEqual(parseQueueAction({ vertical, action: 'pin', ideaId }), { action: 'pin', vertical, ideaId });
    assert.deepEqual(parseQueueAction({ vertical, action: 'archive', ideaId }), { action: 'archive', vertical, ideaId });
    assert.deepEqual(parseQueueAction({ vertical, action: 'place', ideaId, aboveId: null, belowId: ideaId, up: true }), { action: 'place', vertical, ideaId, aboveId: null, belowId: ideaId, up: true });
    assert.deepEqual(parseQueueAction({ vertical, action: 'reorder-pins', order: [ideaId] }), { action: 'reorder-pins', vertical, order: [ideaId] });
    assert.throws(() => parseQueueAction({ vertical, action: 'pin', ideaId: 'explainers:topic:x' }), /Unknown idea/);
  }
});
