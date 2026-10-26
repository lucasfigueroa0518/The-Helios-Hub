/** Placing an AI Events post by hand (D50, AE-29): its Sunday evening and night windows, spaced from other feed posts. Offline (PGlite). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { placementRules, planPlacement } from '@/lib/social-hub/placement';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Sunday 2026-10-25, 12:30 PM New York. */
const SUN = new Date('2026-10-25T16:30:00Z');

test('placement: AI Events has an evening and a night window on its days, spaced from other feed posts', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const rules = await placementRules(q, 'ai_events');
  assert.deepEqual(rules.windows.map((w) => [w.id, w.name, w.startMinute, w.endMinute, w.days]), [['evening', 'Evening', 1080, 1140, [0]], ['night', 'Night', 1140, 1200, [0]]]);
  assert.equal(rules.spaced, true);
  const mon = await planPlacement(q, { vertical: 'ai_events', nyDate: '2026-10-26', slot: 'evening', now: SUN, rng: () => 0 });
  assert.equal(mon.ok, false);
  assert.match(mon.ok ? '' : mon.note, /doesn’t post on Mondays/);
  const sun = await planPlacement(q, { vertical: 'ai_events', nyDate: '2026-10-25', slot: 'evening', now: SUN, rng: () => 0 });
  assert.equal(sun.ok, true);
  assert.equal((await planPlacement(q, { vertical: 'ai_events', nyDate: '2026-10-25', slot: 'night', now: SUN, rng: () => 0 })).ok, true);
  assert.equal((await planPlacement(q, { vertical: 'ai_events', nyDate: '2026-10-25', slot: 'morning', now: SUN })).ok, false);
});

test('placement follows ai_events.settings days', async () => {
  const { query } = await openHubTestDb();
  await query(`UPDATE ai_events.settings SET value = '[6]'::jsonb WHERE key = 'days'`);
  assert.deepEqual((await placementRules(query as SpineQuery, 'ai_events')).windows.map((w) => w.days), [[6], [6]]);
});

test('feed spacing counts a booked AI Events post for every other feed type, not for itself', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const item = await ensureContentItem(q, { vertical: 'ai_events', format: 'feed', nativeRef: 'p1', ideaRef: null });
  await bookSlot(q, { vertical: 'ai_events', itemId: item, nyDate: '2026-10-25', slot: 'evening', publishAt: new Date('2026-10-25T22:20:00Z'), source: 'auto' });
  assert.ok((await busyFeedTimes(q, SUN)).some((b) => b.toISOString() === '2026-10-25T22:20:00.000Z'));
  assert.ok((await busyFeedTimes(q, SUN, 'lfd')).some((b) => b.toISOString() === '2026-10-25T22:20:00.000Z'));
  assert.equal((await busyFeedTimes(q, SUN, 'ai_events')).length, 0);
});

test('a calendar move never takes an AI Events booking past its own Sunday; within it, the post follows (final review)', async () => {
  const { setSlotSource, applySlotChanges } = await import('@/lib/social-hub/slots/write');
  const { aiEventsItemId } = await import('@/lib/ai-events/items');
  const { openAiEventsDb, seedRenderedPost } = await import('./fixtures/ai-events/seed');
  const { query } = await openAiEventsDb();
  const q = query as never;
  const THU = new Date('2026-10-22T14:00:00Z');
  await setSlotSource(q, 'template', 't');
  const { id } = await seedRenderedPost(query);
  const item = (await aiEventsItemId(query as SpineQuery, id))!;
  await bookSlot(query as SpineQuery, { vertical: 'ai_events', itemId: item, nyDate: '2026-10-25', slot: 't1080', publishAt: new Date('2026-10-25T22:05:00Z'), source: 'auto' });
  const move = (to: { nyDate: string; startMinute: number }) =>
    applySlotChanges(q, [{ scope: 'date', op: 'move', from: { nyDate: '2026-10-25', vertical: 'ai_events', startMinute: 1080, series: null }, to }], { by: 't', now: THU, rng: () => 0 });
  // To Saturday Oct 31: its week (Oct 26–Nov 1) has started by then, so the post can't follow (409, nothing written).
  // (The next Sunday already has its own AI Events slot, which rules.ts refuses first.)
  const late = await move({ nyDate: '2026-10-31', startMinute: 1080 });
  assert.equal(late.ok, false, JSON.stringify(late));
  assert.deepEqual('booked' in late ? late.booked.map((b) => [b.why, b.refs]) : null, [['removed', { aiEventsPostId: id }]]);
  assert.equal((await query<{ ny_date: string }>(`SELECT ny_date::text AS ny_date FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0]!.ny_date, '2026-10-25');
  // Later the same Sunday: it follows. (7:00 PM is Boston's slot, so 6:30 PM.)
  const same = await move({ nyDate: '2026-10-25', startMinute: 1110 });
  assert.equal(same.ok, true, JSON.stringify(same));
  assert.equal((await query<{ slot: string }>(`SELECT slot FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0]!.slot, 't1110');
});

test('placing or moving an AI Events post refuses a day after its own Sunday (final review)', async () => {
  const { aiEventsDateRefusal } = await import('@/lib/social-hub/placement');
  const { aiEventsItemId } = await import('@/lib/ai-events/items');
  const { openAiEventsDb, seedRenderedPost } = await import('./fixtures/ai-events/seed');
  const { query } = await openAiEventsDb();
  const { id } = await seedRenderedPost(query);
  const itemId = (await aiEventsItemId(query as SpineQuery, id))!;
  const target = { vertical: 'ai_events' as const, itemId };
  assert.equal(await aiEventsDateRefusal(query as SpineQuery, target, '2026-10-25'), null);
  assert.equal(await aiEventsDateRefusal(query as SpineQuery, target, '2026-10-24'), null);
  assert.match((await aiEventsDateRefusal(query as SpineQuery, target, '2026-11-01')) ?? '', /for the week after Sun, Oct 25/);
  assert.equal(await aiEventsDateRefusal(query as SpineQuery, { vertical: 'last_few_days', itemId }, '2026-11-01'), null);
});
