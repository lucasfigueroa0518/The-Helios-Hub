// tests/lfd-actions.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { approveContent } from '@/app/api/social-hub/actions/approve-content/handler';
import { hardPublish } from '@/app/api/social-hub/actions/hard-publish/handler';
import { rejectContent } from '@/app/api/social-hub/actions/reject/handler';
import { postsToInstagram, stateOf } from '@/lib/content-type/state';
import { lfdItemId } from '@/lib/lfd/items';
import { approveLfdPost, hardPublishLfdPost, LFD_APPROVED_OFF_NOTE, LFD_PUBLISHING_OFF_NOTE, rejectLfdPost, scheduleLfdPost, unscheduleLfdPost } from '@/lib/lfd/schedule';
import { readLfdSettings } from '@/lib/lfd/settings';
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

const LIVE = { quota: null, typicalCostLabel: null, lfdPublishingLive: true };
type Q = { (text: string, params?: unknown[]): Promise<unknown> };
/** The type's state (D16) as its two stored keys: Generate (auto_run) and publishing_live. */
const setState = async (query: Q, state: 'paused' | 'approval' | 'live' | 'mismatch') => {
  const set = (key: string, on: boolean) =>
    query(`INSERT INTO lfd.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(on)]);
  await set('auto_run', state === 'approval' || state === 'live');
  await set('publishing_live', state === 'live' || state === 'mismatch');
};
const live = (query: Q) => setState(query, 'live');

test('a post in review offers Approve, Reject, Schedule and Publish now, each naming the post', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  const plans = actionsFor(await lfdPost(query), LIVE).filter((p): p is PostPlan => p.kind === 'post');
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
  const actions = actionsFor(post, LIVE).filter((p): p is PostPlan => p.kind === 'post').map((p) => p.action);
  for (const a of ['approveContent', 'reschedule', 'unschedule', 'reject', 'hardPublish'] as const) assert.ok(actions.includes(a), a);
  assert.equal(actions.includes('place'), false);
});

function actionsOn(q: Query, now: Date): ContentActions {
  return lastFewDaysActions({
    query: async () => q,
    approvePost: (qq, id) => approveLfdPost(qq, id, now),
    rejectPost: rejectLfdPost,
    hardPublishPost: hardPublishLfdPost,
    // Live only (D16), as lib/publishing/actions/live.ts wires it.
    publishingLive: async (qq) => {
      const s = await readLfdSettings(qq);
      return postsToInstagram(stateOf(s.autoRun, s.publishingLive).state);
    },
    unschedulePost: unscheduleLfdPost,
    itemId: lfdItemId,
    placeItem: (qq, input) => placeItem(qq, { ...input, now, rng: () => 0 }),
    rescheduleItem: (qq, input) => rescheduleItem(qq, { ...input, now, rng: () => 0 }),
  });
}

test('the verbs on the real spine: approve, move, unschedule, place, reject, delete, publish now', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  await live(query);
  const a = actionsOn(q, WED_8);
  const one = await seedLfdPost(query, { slug: 'lfd-1', nyDate: '2026-10-16' });
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
  // (publishing is on in this test)
  assert.deepEqual(await a.publishNow!({ lfdPostId: four }, 'tommy'), { ok: true, note: 'Queued to publish now.' });
  assert.equal(a.regenerate, undefined);
});

test('a rejected post is refused by approve and Publish now, and the hub offers neither', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const a = actionsOn(q, WED_8);
  const id = await seedLfdPost(query, { slug: 'lfd-rej' });
  await scheduleLfdPost(q, id, 'auto', TUE_330, '2026-10-13', () => 0);
  assert.equal((await a.reject!({ lfdPostId: id }, 'tommy')).ok, true);
  const approve = await a.approve!({ lfdPostId: id }, 'tommy');
  assert.equal(approve.ok, false);
  assert.match(approve.note, /rejected/);
  assert.equal(approve.status, 409);
  const publish = await a.publishNow!({ lfdPostId: id }, 'tommy');
  assert.equal(publish.ok, false);
  assert.match(publish.note, /rejected/);
  assert.equal(publish.status, 409);
  const posts = buildDataset(await readAll(query), null, TUE_330).posts.filter((p) => p.vertical === 'last_few_days');
  assert.equal(posts.length, 1, 'the rejected card exists');
  for (const p of posts) {
    const actions = actionsFor(p, { quota: null, typicalCostLabel: null }).filter((x): x is PostPlan => x.kind === 'post').map((x) => x.action);
    assert.equal(actions.includes('approveContent'), false);
    assert.equal(actions.includes('hardPublish'), false);
  }
});

test('while Last Few Days isn’t Live: the hub offers no Publish now, Publish now refuses with 409; Paused approves without a slot, Approval books it', async () => {
  for (const state of ['paused', 'approval', 'mismatch'] as const) {
    const { query } = await openHubTestDb();
    await setState(query, state);
    const q = query as unknown as Query;
    const id = await seedLfdPost(query);
    const post = await lfdPost(query);
    for (const ctx of [{ quota: null, typicalCostLabel: null }, { quota: null, typicalCostLabel: null, lfdPublishingLive: false }]) {
      const actions = actionsFor(post, ctx).filter((x): x is PostPlan => x.kind === 'post').map((x) => x.action);
      assert.equal(actions.includes('hardPublish'), false, state);
      assert.ok(actions.includes('approveContent'), state);
    }
    const a = actionsOn(q, TUE_330);
    assert.deepEqual(await a.publishNow!({ lfdPostId: id }, 'tommy'), { ok: false, status: 409, note: LFD_PUBLISHING_OFF_NOTE }, state);
    assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0, state);
    const approved = await a.approve!({ lfdPostId: id }, 'tommy');
    const slots = (await q(`SELECT count(*)::int AS n FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0].n;
    if (state === 'approval') {
      // Approval holds slots (contract §4.3): the post is ready in its own day's slot; it posts only once Live.
      assert.equal(approved.ok, true, approved.note);
      assert.match(approved.note, /^Approved and scheduled for 2026-10-13T1[34]:/);
      assert.equal(slots, 1);
    } else {
      // Paused, and a Generate off + Live on mismatch (reads as paused): approved, it stays in Made (D17).
      assert.deepEqual(approved, { ok: true, note: LFD_APPROVED_OFF_NOTE }, state);
      assert.equal(slots, 0, state);
    }
  }
});

test('the hub reads Last Few Days publishing into the offer (Publish now appears once it is on)', async () => {
  const { query } = await openHubTestDb();
  await seedLfdPost(query);
  const { loadDataset } = await import('@/lib/social-hub/load');
  const { offerer } = await import('@/lib/social-hub/views/offer');
  const has = async () => {
    const dataset = await loadDataset(query, TUE_330);
    const post = dataset.posts.find((p) => p.vertical === 'last_few_days')!;
    const o = offerer(dataset, TUE_330).offer(post);
    return JSON.stringify(o).includes('hard-publish');
  };
  assert.equal(await has(), false);
  // Live with Generate off is a mismatch: it reads as paused, so still no Publish now (D16).
  await setState(query, 'mismatch');
  assert.equal(await has(), false);
  await live(query);
  assert.equal(await has(), true);
});
