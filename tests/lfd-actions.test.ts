// tests/lfd-actions.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { approveContent } from '@/app/api/social-hub/actions/approve-content/handler';
import { hardPublish } from '@/app/api/social-hub/actions/hard-publish/handler';
import { rejectContent } from '@/app/api/social-hub/actions/reject/handler';
import { lfdItemId } from '@/lib/lfd/items';
import { approveLfdPost, hardPublishLfdPost, rejectLfdPost, scheduleLfdPost, unscheduleLfdPost } from '@/lib/lfd/schedule';
import { lastFewDaysActions } from '@/lib/publishing/actions/last-few-days';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { buildDataset } from '@/lib/social-hub/dataset';
import { actionsFor, type ActionPlan } from '@/lib/social-hub/house';
import { readAll } from '@/lib/social-hub/load';
import { placeItem, rescheduleItem } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

type PostPlan = Extract<ActionPlan, { kind: 'post' }>;

/** Tuesday 2026-10-13, 3:30 AM New York. */
const TUE_330 = new Date('2026-10-13T07:30:00Z');
/** Wednesday 2026-10-14, 8:00 AM New York. */
const WED_8 = new Date('2026-10-14T12:00:00Z');
const never = (async () => { throw new Error('must not be called'); }) as never;

async function lfdPost(query: Parameters<typeof readAll>[0]) {
  return buildDataset(await readAll(query), null, TUE_330).posts.find((p) => p.vertical === 'last_few_days')!;
}

test('a post in review offers Approve, Reject, Schedule and Publish now, each naming the post', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  const plans = actionsFor(await lfdPost(query), { quota: null, typicalCostLabel: null }).filter((p): p is PostPlan => p.kind === 'post');
  const plan = (action: PostPlan['action']) => plans.find((p) => p.action === action);
  assert.deepEqual(plan('approveContent')?.body, { vertical: 'last_few_days', refs: { lfdPostId: id } });
  assert.deepEqual(plan('reject')?.body, { vertical: 'last_few_days', refs: { lfdPostId: id } });
  assert.deepEqual(plan('place')?.body, { vertical: 'last_few_days', refs: { lfdPostId: id } });
  assert.deepEqual(plan('hardPublish')?.body, { vertical: 'last_few_days', ref: id });
  assert.equal(plan('hardRegenerate'), undefined, 'a post is not rebuilt from the hub');
  assert.deepEqual(approveContent(never).parse(plan('approveContent')!.body), { vertical: 'last_few_days', target: { lfdPostId: id } });
  assert.deepEqual(rejectContent(never).parse(plan('reject')!.body), { vertical: 'last_few_days', target: { lfdPostId: id } });
  assert.deepEqual(hardPublish(never).parse(plan('hardPublish')!.body), { vertical: 'last_few_days', target: { lfdPostId: id } });
});

test('a booked, unapproved post offers Approve where it is, Move and Unschedule', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  await scheduleLfdPost(query as unknown as Query, id, 'auto', TUE_330, '2026-10-13', () => 0);
  const post = await lfdPost(query);
  assert.equal(post.status, 'scheduled');
  const actions = actionsFor(post, { quota: null, typicalCostLabel: null }).filter((p): p is PostPlan => p.kind === 'post').map((p) => p.action);
  for (const a of ['approveContent', 'reschedule', 'unschedule', 'reject', 'hardPublish'] as const) assert.ok(actions.includes(a), a);
  assert.equal(actions.includes('place'), false);
});

function actionsOn(q: Query, now: Date): ContentActions {
  return lastFewDaysActions({
    query: async () => q,
    approvePost: (qq, id) => approveLfdPost(qq, id, now),
    rejectPost: rejectLfdPost,
    hardPublishPost: hardPublishLfdPost,
    unschedulePost: unscheduleLfdPost,
    itemId: lfdItemId,
    placeItem: (qq, input) => placeItem(qq, { ...input, now, rng: () => 0 }),
    rescheduleItem: (qq, input) => rescheduleItem(qq, { ...input, now, rng: () => 0 }),
  });
}

test('the verbs on the real spine: approve, move, unschedule, place, reject, delete, publish now', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const a = actionsOn(q, WED_8);
  const one = await seedLfdPost(query, { slug: 'lfd-1', nyDate: '2026-10-14' });
  const approved = await a.approve!({ lfdPostId: one }, 'tommy');
  assert.equal(approved.ok, true);
  assert.match(approved.note, /^Approved and scheduled for 2026-10-16T1[34]:/);
  const moved = await a.reschedule!({ lfdPostId: one }, 'tommy', { nyDate: '2026-10-20', slot: 'morning' });
  assert.equal(moved.ok, true, moved.note);
  assert.equal((await q(`SELECT ny_date::text AS d FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0].d, '2026-10-20');
  assert.equal((await a.unschedule!({ lfdPostId: one }, 'tommy')).ok, true);
  const wed = await a.place!({ lfdPostId: one }, 'tommy', { nyDate: '2026-10-14', slot: 'morning' });
  assert.equal(wed.ok, false);
  assert.match(wed.note, /doesn’t post on Wednesdays/);
  assert.equal((await a.place!({ lfdPostId: one }, 'tommy', { nyDate: '2026-10-16', slot: 'morning' })).ok, true);

  const two = await seedLfdPost(query, { slug: 'lfd-2' });
  assert.deepEqual(await a.reject!({ lfdPostId: two }, 'tommy'), { ok: true, note: 'Rejected. It will not post.' });
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [two])).rows[0].status, 'rejected');

  const three = await seedLfdPost(query, { slug: 'lfd-3' });
  assert.equal((await a.delete!({ lfdPostId: three }, 'tommy')).ok, true);
  assert.ok((await q(`SELECT deleted_at FROM social_hub.content_items WHERE native_ref = $1`, [three])).rows[0].deleted_at);

  const four = await seedLfdPost(query, { slug: 'lfd-4' });
  assert.deepEqual(await a.publishNow!({ lfdPostId: four }, 'tommy'), { ok: true, note: 'Queued to publish now.' });
  assert.equal(a.regenerate, undefined);
});

test('a rejected post is refused by approve and Publish now, and the hub offers neither', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const a = actionsOn(q, WED_8);
  const id = await seedLfdPost(query, { slug: 'lfd-rej' });
  assert.equal((await a.reject!({ lfdPostId: id }, 'tommy')).ok, true);
  const approve = await a.approve!({ lfdPostId: id }, 'tommy');
  assert.equal(approve.ok, false);
  assert.match(approve.note, /rejected/);
  const publish = await a.publishNow!({ lfdPostId: id }, 'tommy');
  assert.equal(publish.ok, false);
  assert.match(publish.note, /rejected/);
  const posts = buildDataset(await readAll(query), null, TUE_330).posts.filter((p) => p.vertical === 'last_few_days');
  for (const p of posts) {
    const actions = actionsFor(p, { quota: null, typicalCostLabel: null }).filter((x): x is PostPlan => x.kind === 'post').map((x) => x.action);
    assert.equal(actions.includes('approveContent'), false);
    assert.equal(actions.includes('hardPublish'), false);
  }
});
