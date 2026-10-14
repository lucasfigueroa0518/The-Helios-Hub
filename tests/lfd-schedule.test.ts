// tests/lfd-schedule.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { lfdItemId } from '@/lib/lfd/items';
import {
  approveLfdPost,
  hardPublishLfdPost,
  LFD_HARD_PUBLISH_NOTE,
  LFD_NOT_APPROVED_NOTE,
  LFD_APPROVED_OFF_NOTE,
  LFD_DAY_PASSED_NOTE,
  LFD_MISSED_NOTE,
  LFD_PUBLISHING_OFF_NOTE,
  LFD_REJECTED_NOTE,
  rejectLfdPost,
  releaseDueLfd,
  scheduleLfdPost,
  unscheduleLfdPost,
} from '@/lib/lfd/schedule';
import { approveItem, bookSlot, ensureContentItem } from '@/lib/social-hub/spine';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 3:30 AM New York (after the 3:00 run). */
const TUE_330 = new Date('2026-10-13T07:30:00Z');
/** Wednesday 2026-10-14, 8:00 AM New York. */
const WED_8 = new Date('2026-10-14T12:00:00Z');

async function db(o: { publishingLive?: boolean } = { publishingLive: true }) {
  const { query } = await openHubTestDb();
  if (o.publishingLive) await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  return { query, q: query as unknown as Query };
}

test('the run books its own day: Tuesday 9–10 AM, 30 minutes from a carousel', async () => {
  const { query, q } = await db();
  const carousel = await ensureContentItem(q, { vertical: 'carousels', format: 'feed', nativeRef: 'c1', ideaRef: null });
  await bookSlot(q, { vertical: 'carousels', itemId: carousel, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:10:00Z'), source: 'auto' });
  const id = await seedLfdPost(query);
  const out = await scheduleLfdPost(q, id, 'auto', TUE_330, '2026-10-13', () => 0);
  assert.equal(out.scheduled, true);
  assert.equal(out.scheduled ? out.publishAt : '', '2026-10-13T13:40:00.000Z', 'the first minute 30 minutes after 9:10');
  const row = (await q(`SELECT vertical, slot, ny_date::text AS d, source FROM social_hub.schedule WHERE vertical = 'last_few_days'`)).rows[0];
  assert.deepEqual([row.vertical, row.slot, row.d, row.source], ['last_few_days', 'morning', '2026-10-13', 'auto']);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.approvals`)).rows[0].n, 0, 'an auto slot is not approved');
});

test('auto-booking on a day that is not a Last Few Days day books nothing', async () => {
  const { query, q } = await db();
  const id = await seedLfdPost(query, { nyDate: '2026-10-14' });
  const out = await scheduleLfdPost(q, id, 'auto', WED_8, '2026-10-14', () => 0);
  assert.deepEqual(out, { scheduled: false, note: 'No Last Few Days window is open on that day (it posts on its days only, 9:00–10:00 AM).' });
});

test('approving books only the post\'s own day: on its Tuesday it books Tuesday 9–10 AM', async () => {
  const { query, q } = await db();
  const id = await seedLfdPost(query);
  const out = await approveLfdPost(q, id, TUE_330);
  assert.equal(out.scheduled, true);
  assert.equal((await q(`SELECT ny_date::text AS d FROM social_hub.schedule`)).rows[0].d, '2026-10-13');
  const ap = (await q(`SELECT decision, via FROM social_hub.approvals`)).rows[0];
  assert.deepEqual([ap.decision, ap.via], ['approved', 'user']);
  const again = await approveLfdPost(q, id, TUE_330);
  assert.equal(again.scheduled ? again.id : '', out.scheduled ? out.id : 'x', 'a post already booked keeps its slot');
});

test('approving after the post\'s day approves it without booking a later day', async () => {
  const { query, q } = await db();
  const id = await seedLfdPost(query); // Tuesday's post, approved on Wednesday
  const out = await approveLfdPost(q, id, WED_8);
  assert.deepEqual(out, { scheduled: false, approved: true, note: LFD_DAY_PASSED_NOTE });
  assert.equal(LFD_DAY_PASSED_NOTE, 'Its day has passed; use Place to pick a Tuesday or Friday.');
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0].n, 0, 'never auto-books Friday');
  assert.equal((await q(`SELECT decision FROM social_hub.approvals`)).rows[0].decision, 'approved');
});

test('approving when its day\'s window is already taken approves without booking', async () => {
  const { query, q } = await db();
  const first = await seedLfdPost(query, { slug: 'lfd-first' });
  const second = await seedLfdPost(query, { slug: 'lfd-second' });
  assert.equal((await approveLfdPost(q, first, TUE_330)).scheduled, true);
  const out = await approveLfdPost(q, second, TUE_330);
  assert.deepEqual(out, { scheduled: false, approved: true, note: LFD_DAY_PASSED_NOTE });
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0].n, 1);
});

test('with Last Few Days publishing off, Approve approves without booking a slot', async () => {
  const { query, q } = await db({ publishingLive: false });
  const id = await seedLfdPost(query);
  const out = await approveLfdPost(q, id, TUE_330);
  assert.deepEqual(out, { scheduled: false, approved: true, note: LFD_APPROVED_OFF_NOTE });
  assert.equal(LFD_APPROVED_OFF_NOTE, 'Approved. It will be scheduled when Last Few Days publishing is on.');
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0].n, 0);
  assert.equal((await q(`SELECT decision FROM social_hub.approvals`)).rows[0].decision, 'approved');
});

test('with Last Few Days publishing off, Hard publish refuses: no approval, no attempt, the slot stays', async () => {
  const { query, q } = await db({ publishingLive: false });
  const id = await seedLfdPost(query);
  await scheduleLfdPost(q, id, 'auto', TUE_330, '2026-10-13', () => 0);
  const out = await hardPublishLfdPost(q, id);
  assert.deepEqual(out, { queued: false, note: LFD_PUBLISHING_OFF_NOTE, terminal: true });
  assert.equal(LFD_PUBLISHING_OFF_NOTE, 'Last Few Days publishing is off. Turn it on before publishing.');
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.approvals`)).rows[0].n, 0);
  assert.equal((await q(`SELECT status FROM social_hub.schedule`)).rows[0].status, 'scheduled');
});

test('a due LFD slot more than 60 minutes late is cancelled, not released; a fresh one still goes out', async () => {
  const { query, q } = await db();
  const late = await seedLfdPost(query, { slug: 'lfd-late' });
  const fresh = await seedLfdPost(query, { slug: 'lfd-fresh', nyDate: '2026-10-16' });
  await scheduleLfdPost(q, late, 'user', TUE_330, '2026-10-13', () => 0);
  await scheduleLfdPost(q, fresh, 'user', TUE_330, undefined, () => 0);
  const lateItem = (await lfdItemId(q, late))!;
  const freshItem = (await lfdItemId(q, fresh))!;
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '61 minutes' WHERE content_item_id = $1`, [lateItem]);
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '59 minutes' WHERE content_item_id = $1`, [freshItem]);
  assert.equal(await releaseDueLfd(q, { requireApproval: true }), 1);
  const lateSlot = (await q(`SELECT status, error FROM social_hub.schedule WHERE content_item_id = $1`, [lateItem])).rows[0];
  assert.deepEqual([lateSlot.status, lateSlot.error], ['cancelled', LFD_MISSED_NOTE]);
  assert.equal(LFD_MISSED_NOTE, 'Missed its window; place it again to post.');
  const attempts = (await q(`SELECT content_item_id FROM social_hub.publish_attempts`)).rows;
  assert.deepEqual(attempts.map((r) => r.content_item_id), [freshItem]);
});
test('a due slot: approved goes out, unapproved is cancelled with the reason', async () => {
  const { query, q } = await db();
  const a = await seedLfdPost(query, { slug: 'lfd-a' });
  const b = await seedLfdPost(query, { slug: 'lfd-b' });
  await scheduleLfdPost(q, a, 'auto', TUE_330, undefined, () => 0);
  await scheduleLfdPost(q, b, 'auto', TUE_330, undefined, () => 0);
  await approveItem(q, (await lfdItemId(q, a))!, 'user');
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueLfd(q, { requireApproval: true }), 1);
  const attempt = (await q(`SELECT vertical, trigger, status FROM social_hub.publish_attempts`)).rows;
  assert.deepEqual(attempt.map((r) => [r.vertical, r.trigger, r.status]), [['last_few_days', 'auto', 'requested']]);
  const cancelled = (await q(`SELECT status, error FROM social_hub.schedule WHERE status = 'cancelled'`)).rows[0];
  assert.equal(cancelled.error, LFD_NOT_APPROVED_NOTE);
});

test('reject, unschedule and hard publish use the shared spine helpers', async () => {
  const { query, q } = await db();
  const rejected = await seedLfdPost(query, { slug: 'lfd-r' });
  await approveLfdPost(q, rejected, TUE_330);
  assert.equal(await rejectLfdPost(q, rejected, 'tommy'), true);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [rejected])).rows[0].status, 'rejected');
  const slot = (await q(`SELECT status, error FROM social_hub.schedule`)).rows[0];
  assert.deepEqual([slot.status, slot.error], ['cancelled', LFD_REJECTED_NOTE]);

  const moved = await seedLfdPost(query, { slug: 'lfd-u' });
  await approveLfdPost(q, moved, TUE_330);
  const out = await unscheduleLfdPost(q, moved);
  assert.equal(out.ok, true);
  const item = (await lfdItemId(q, moved))!;
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.approvals WHERE content_item_id = $1`, [item])).rows[0].n, 0);

  const forced = await seedLfdPost(query, { slug: 'lfd-f' });
  await approveLfdPost(q, forced, TUE_330);
  assert.equal((await hardPublishLfdPost(q, forced)).queued, true);
  const fItem = (await lfdItemId(q, forced))!;
  assert.equal((await q(`SELECT via FROM social_hub.approvals WHERE content_item_id = $1`, [fItem])).rows[0].via, 'user', 'a first approval keeps how it came');
  assert.equal((await q(`SELECT trigger FROM social_hub.publish_attempts WHERE content_item_id = $1`, [fItem])).rows[0].trigger, 'force');
  assert.equal((await q(`SELECT error FROM social_hub.schedule WHERE content_item_id = $1`, [fItem])).rows[0].error, LFD_HARD_PUBLISH_NOTE);
});
