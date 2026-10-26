/**
 * AI Events on the calendar (AE-08, AE-29): Miami's Sunday 6:00–7:00 PM and Boston's 7:00–8:00 PM, 30 minutes from every
 * other feed post; approve, reject, unschedule, Hard publish and the due-slot release with the
 * missed-window rule. Offline (PGlite).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_EVENTS_IG_LOCATION_ID, AI_EVENTS_SPINE_VERTICAL, igLocationIdFor } from '@/lib/ai-events/config';
import { queueAiEventsPublish } from '@/lib/ai-events/publish';
import { aiEventsItemId } from '@/lib/ai-events/items';
import {
  AI_EVENTS_APPROVED_OFF_NOTE,
  AI_EVENTS_DAY_PASSED_NOTE,
  AI_EVENTS_MISSED_NOTE,
  AI_EVENTS_NOT_APPROVED_NOTE,
  AI_EVENTS_PUBLISHING_OFF_NOTE,
  AI_EVENTS_REJECTED_NOTE,
  approveAiEventsPost,
  hardPublishAiEventsPost,
  rejectAiEventsPost,
  releaseDueAiEvents,
  scheduleAiEventsPost,
  unscheduleAiEventsPost,
} from '@/lib/ai-events/schedule';
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { approveItem, bookSlot, ensureContentItem } from '@/lib/social-hub/spine';
import type { Query } from '@/lib/social/store/pg';

import { openAiEventsDb, seedAiEventsPost } from './fixtures/ai-events/seed';

/** Sunday 2026-10-25, 12:30 PM New York (after the noon run). */
const SUN_1230 = new Date('2026-10-25T16:30:00Z');
/** Monday 2026-10-26, 9:00 AM New York. */
const MON_9 = new Date('2026-10-26T13:00:00Z');

async function db(o: { publishingLive?: boolean } = { publishingLive: true }) {
  const { query } = await openAiEventsDb(o);
  return { query, q: query as unknown as Query };
}

test('the run books its own Sunday 6–7 PM, 30 minutes from another feed post', async () => {
  const { query, q } = await db();
  const carousel = await ensureContentItem(q, { vertical: 'carousels', format: 'feed', nativeRef: 'c1', ideaRef: null });
  await bookSlot(q, { vertical: 'carousels', itemId: carousel, nyDate: '2026-10-25', slot: 'afternoon', publishAt: new Date('2026-10-25T22:10:00Z'), source: 'auto' });
  const id = await seedAiEventsPost(query);
  const out = await scheduleAiEventsPost(q, id, 'auto', SUN_1230, '2026-10-25', () => 0);
  assert.equal(out.scheduled, true);
  assert.equal(out.scheduled ? out.publishAt : '', '2026-10-25T22:40:00.000Z', '6:40 PM EDT: the first minute 30 minutes after 6:10');
  const row = (await q(`SELECT vertical, slot, ny_date::text AS d, source FROM social_hub.schedule WHERE content_item_id = $1`, [await aiEventsItemId(q, id)])).rows[0];
  assert.deepEqual([row.vertical, row.slot, row.d, row.source], ['ai_events', 'evening', '2026-10-25', 'auto']);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.approvals`)).rows[0].n, 0, 'an auto slot is not approved');
  assert.ok((await busyFeedTimes(q, SUN_1230)).some((b) => b.toISOString() === '2026-10-25T22:40:00.000Z'), 'other types now space against it');
  const again = await scheduleAiEventsPost(q, id, 'auto', SUN_1230, '2026-10-25', () => 0);
  assert.equal(again.scheduled ? again.id : '', out.scheduled ? out.id : 'x', 'a post already booked keeps its slot');
});

test('no window on any other day; without a limit the next free Sunday is taken', async () => {
  const { query, q } = await db();
  const id = await seedAiEventsPost(query);
  assert.deepEqual(await scheduleAiEventsPost(q, id, 'auto', MON_9, '2026-10-26', () => 0), {
    scheduled: false,
    note: 'No AI Events window is open on that day (this post goes out on Sundays only, 6:00–7:00 PM).',
  });
  const next = await scheduleAiEventsPost(q, id, 'auto', MON_9, undefined, () => 0);
  assert.equal(next.scheduled ? next.publishAt : '', '2026-11-01T23:00:00.000Z', 'Sunday Nov 1, 6:00 PM EST');
});

test('one AI Events post per Sunday: a second waits for the next Sunday', async () => {
  const { query, q } = await db();
  const first = await seedAiEventsPost(query);
  const second = await seedAiEventsPost(query, { weekKey: '2026-W45', slug: 'ai-events-2026-w45', nyDate: '2026-11-01' });
  assert.equal((await scheduleAiEventsPost(q, first, 'auto', SUN_1230, '2026-10-25', () => 0)).scheduled, true);
  assert.equal((await scheduleAiEventsPost(q, second, 'auto', SUN_1230, '2026-10-25', () => 0)).scheduled, false);
  const later = await scheduleAiEventsPost(q, second, 'auto', SUN_1230, undefined, () => 0);
  assert.equal(later.scheduled ? later.publishAt.slice(0, 10) : '', '2026-11-01');
});

test('two city posts on one Sunday: Miami 6–7 PM, Boston 7–8 PM; a second Miami post waits a week', async () => {
  const { query, q } = await db();
  const miami = await seedAiEventsPost(query, { metro: 'miami' });
  const boston = await seedAiEventsPost(query, { metro: 'boston' });
  const b = await scheduleAiEventsPost(q, boston, 'auto', SUN_1230, '2026-10-25', () => 0);
  const m = await scheduleAiEventsPost(q, miami, 'auto', SUN_1230, '2026-10-25', () => 0);
  assert.equal(m.scheduled ? m.publishAt : '', '2026-10-25T22:00:00.000Z', 'Miami 6:00 PM EDT');
  assert.equal(b.scheduled ? b.publishAt : '', '2026-10-25T23:00:00.000Z', 'Boston 7:00 PM EDT');
  const slots = (await q(`SELECT slot FROM social_hub.schedule ORDER BY publish_at`)).rows.map((r) => r.slot);
  assert.deepEqual(slots, ['evening', 'night']);
  const nextMiami = await seedAiEventsPost(query, { metro: 'miami', weekKey: '2026-W45', nyDate: '2026-11-01' });
  assert.equal((await scheduleAiEventsPost(q, nextMiami, 'auto', SUN_1230, '2026-10-25', () => 0)).scheduled, false, 'Miami’s window is taken');
  const boston2 = await seedAiEventsPost(query, { metro: 'boston', weekKey: '2026-W45', nyDate: '2026-11-01' });
  const late = await scheduleAiEventsPost(q, boston2, 'auto', MON_9, undefined, () => 0);
  assert.equal(late.scheduled ? late.publishAt : '', '2026-11-02T00:00:00.000Z', 'next Sunday, 7:00 PM EST');
  assert.deepEqual(await scheduleAiEventsPost(q, boston2, 'auto', MON_9, '2026-10-26', () => 0).then((o) => o.scheduled), true, 'already booked keeps its slot');
});

test('approve: publishing off approves only; live books its own Sunday; after that Sunday it approves without a slot', async () => {
  const off = await db({ publishingLive: false });
  const a = await seedAiEventsPost(off.query);
  assert.deepEqual(await approveAiEventsPost(off.q, a, SUN_1230), { scheduled: false, approved: true, note: AI_EVENTS_APPROVED_OFF_NOTE });
  assert.equal((await off.q(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0].n, 0);
  assert.equal((await off.q(`SELECT decision FROM social_hub.approvals`)).rows[0].decision, 'approved');

  const live = await db();
  const b = await seedAiEventsPost(live.query);
  const booked = await approveAiEventsPost(live.q, b, SUN_1230);
  assert.equal(booked.scheduled, true);
  assert.equal((await live.q(`SELECT ny_date::text AS d FROM social_hub.schedule`)).rows[0].d, '2026-10-25');

  const late = await db();
  const c = await seedAiEventsPost(late.query);
  assert.deepEqual(await approveAiEventsPost(late.q, c, MON_9), { scheduled: false, approved: true, note: AI_EVENTS_DAY_PASSED_NOTE });
  assert.equal((await late.q(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0].n, 0, 'never books the next Sunday by itself');
});

test('reject cancels the slot and marks the post; unschedule frees it', async () => {
  const { query, q } = await db();
  const id = await seedAiEventsPost(query);
  await scheduleAiEventsPost(q, id, 'auto', SUN_1230, '2026-10-25', () => 0);
  assert.equal((await unscheduleAiEventsPost(q, id)).ok, true);
  assert.equal((await q(`SELECT status FROM social_hub.schedule`)).rows[0].status, 'cancelled');
  await scheduleAiEventsPost(q, id, 'auto', SUN_1230, '2026-10-25', () => 0);
  assert.equal(await rejectAiEventsPost(q, id, 'editor@example.com'), true);
  const slots = (await q(`SELECT status, error FROM social_hub.schedule ORDER BY created_at`)).rows;
  assert.deepEqual(slots.map((s) => s.status), ['cancelled', 'cancelled']);
  assert.equal(slots[1].error, AI_EVENTS_REJECTED_NOTE);
  assert.equal((await q(`SELECT status FROM ai_events.posts WHERE id = $1`, [id])).rows[0].status, 'rejected');
});

test('Hard publish: refused while publishing is off; live, it approves and queues a force attempt', async () => {
  const off = await db({ publishingLive: false });
  const a = await seedAiEventsPost(off.query);
  assert.deepEqual(await hardPublishAiEventsPost(off.q, a), { queued: false, note: AI_EVENTS_PUBLISHING_OFF_NOTE, terminal: true });
  assert.equal((await off.q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0);

  const live = await db();
  const b = await seedAiEventsPost(live.query);
  const out = await hardPublishAiEventsPost(live.q, b);
  assert.equal(out.queued, true);
  const attempt = (await live.q(`SELECT vertical, trigger, caption, payload FROM social_hub.publish_attempts`)).rows[0];
  assert.deepEqual([attempt.vertical, attempt.trigger, attempt.caption, attempt.payload.image_objects.length], ['ai_events', 'force', 'Caption', 2]);
  assert.equal(attempt.payload.location_id, undefined, 'a seed with no metro is not geotagged');

  const miami = await seedAiEventsPost(live.query, { metro: 'miami', slug: 'miami-geo', weekKey: '2026-W45', nyDate: '2026-11-01' });
  const boston = await seedAiEventsPost(live.query, { metro: 'boston', slug: 'boston-geo', weekKey: '2026-W45', nyDate: '2026-11-01' });
  assert.equal((await queueAiEventsPublish(live.q, miami, 'force')).queued, true);
  assert.equal((await queueAiEventsPublish(live.q, boston, 'force')).queued, true);
  const geos = (await live.q(
    `SELECT p.metro, a.payload->>'location_id' AS location_id
       FROM social_hub.publish_attempts a
       JOIN social_hub.content_items ci ON ci.id = a.content_item_id
       JOIN ai_events.posts p ON p.id::text = ci.native_ref
      WHERE p.metro IN ('miami', 'boston')
      ORDER BY p.metro`,
  )).rows as { metro: string; location_id: string }[];
  assert.deepEqual(geos, [
    { metro: 'boston', location_id: AI_EVENTS_IG_LOCATION_ID.boston },
    { metro: 'miami', location_id: AI_EVENTS_IG_LOCATION_ID.miami },
  ]);
  assert.equal(igLocationIdFor('nyc'), undefined);
  assert.equal(igLocationIdFor(null), undefined);
  assert.deepEqual((await live.q(`SELECT decision, via FROM social_hub.approvals`)).rows.map((r) => [r.decision, r.via]), [['approved', 'force']]);
});

test('release: an approved due slot is queued; unapproved and missed ones are cancelled with the reason', async () => {
  const { query, q } = await db();
  const approved = await seedAiEventsPost(query);
  const unapproved = await seedAiEventsPost(query, { weekKey: '2026-W45', slug: 'w45', nyDate: '2026-11-01' });
  const missed = await seedAiEventsPost(query, { weekKey: '2026-W46', slug: 'w46', nyDate: '2026-11-08' });
  const now = Date.now();
  const book = async (postId: string, minutesAgo: number, nyDate: string) => {
    const itemId = (await aiEventsItemId(q, postId))!;
    await bookSlot(q, { vertical: AI_EVENTS_SPINE_VERTICAL, itemId, nyDate, slot: 'evening', publishAt: new Date(now - minutesAgo * 60_000), source: 'auto' });
    return itemId;
  };
  await approveItem(q, await book(approved, 5, '2026-10-25'), 'user');
  await book(unapproved, 5, '2026-11-01');
  await approveItem(q, await book(missed, 90, '2026-11-08'), 'user');
  assert.equal(await releaseDueAiEvents(q, { requireApproval: true }), 1);
  const rows = (await q(`SELECT ny_date::text AS d, status, error, publish_attempt_id FROM social_hub.schedule ORDER BY ny_date`)).rows;
  assert.deepEqual(rows.map((r) => [r.d, r.status, r.error]), [
    ['2026-10-25', 'publishing', null],
    ['2026-11-01', 'cancelled', AI_EVENTS_NOT_APPROVED_NOTE],
    ['2026-11-08', 'cancelled', AI_EVENTS_MISSED_NOTE],
  ]);
  assert.ok(rows[0].publish_attempt_id);
  assert.equal((await q(`SELECT trigger FROM social_hub.publish_attempts`)).rows[0].trigger, 'auto');
});
