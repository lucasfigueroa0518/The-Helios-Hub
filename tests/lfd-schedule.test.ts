// tests/lfd-schedule.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { lfdItemId } from '@/lib/lfd/items';
import {
  approveLfdPost,
  hardPublishLfdPost,
  LFD_HARD_PUBLISH_NOTE,
  LFD_NOT_APPROVED_NOTE,
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

async function db() {
  const { query } = await openHubTestDb();
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

test('approving on a Wednesday approves the post and books Friday', async () => {
  const { query, q } = await db();
  const id = await seedLfdPost(query, { nyDate: '2026-10-14' });
  const out = await approveLfdPost(q, id, WED_8);
  assert.equal(out.scheduled, true);
  assert.equal((await q(`SELECT ny_date::text AS d FROM social_hub.schedule`)).rows[0].d, '2026-10-16');
  const ap = (await q(`SELECT decision, via FROM social_hub.approvals`)).rows[0];
  assert.deepEqual([ap.decision, ap.via], ['approved', 'user']);
  const again = await approveLfdPost(q, id, WED_8);
  assert.equal(again.scheduled ? again.id : '', out.scheduled ? out.id : 'x', 'a post already booked keeps its slot');
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
