/**
 * AI Events in the hub's action layer (D47): what a post offers, the verbs on the real spine,
 * Rebuild post as the type's regenerate, and the publishing_live gate. Offline (PGlite).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { approveContent } from '@/app/api/social-hub/actions/approve-content/handler';
import { hardPublish } from '@/app/api/social-hub/actions/hard-publish/handler';
import { hardRegenerate } from '@/app/api/social-hub/actions/hard-regenerate/handler';
import { rejectContent } from '@/app/api/social-hub/actions/reject/handler';
import { aiEventsItemId } from '@/lib/ai-events/items';
import { queueAiEventsRun } from '@/lib/ai-events/manual';
import {
  AI_EVENTS_APPROVED_OFF_NOTE,
  AI_EVENTS_PUBLISHING_OFF_NOTE,
  approveAiEventsPost,
  hardPublishAiEventsPost,
  rejectAiEventsPost,
  scheduleAiEventsPost,
  unscheduleAiEventsPost,
} from '@/lib/ai-events/schedule';
import { readAiEventsSettings } from '@/lib/ai-events/settings';
import { aiEventsActions } from '@/lib/publishing/actions/ai-events';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { buildDataset } from '@/lib/social-hub/dataset';
import { actionsFor, type ActionPlan } from '@/lib/social-hub/house';
import { readAll } from '@/lib/social-hub/load';
import { placeItem, rescheduleItem } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';

import { openAiEventsDb, seedRenderedPost, SUN_NOON, WEEK } from './fixtures/ai-events/seed';

type PostPlan = Extract<ActionPlan, { kind: 'post' }>;

/** Saturday 2026-10-24, 9:00 AM New York. */
const SAT_9 = new Date('2026-10-24T13:00:00Z');
const never = (async () => { throw new Error('must not be called'); }) as never;

async function aiPost(query: Parameters<typeof readAll>[0]) {
  return buildDataset(await readAll(query, undefined, SUN_NOON), null, SUN_NOON).posts.find((p) => p.vertical === 'ai_events')!;
}

const LIVE = { quota: null, typicalCostLabel: null, aiEventsPublishingLive: true };

test('a post in review offers Approve, Reject, Schedule, Publish now and Rebuild post, each naming the post', async () => {
  const { query } = await openAiEventsDb();
  const { id } = await seedRenderedPost(query);
  const plans = actionsFor(await aiPost(query), LIVE).filter((p): p is PostPlan => p.kind === 'post');
  const plan = (action: PostPlan['action']) => plans.find((p) => p.action === action);
  const refs = { vertical: 'ai_events', refs: { aiEventsPostId: id } };
  assert.deepEqual(plan('approveContent')?.body, refs);
  assert.deepEqual(plan('reject')?.body, refs);
  assert.deepEqual(plan('place')?.body, refs);
  assert.deepEqual(plan('hardRegenerate')?.body, refs);
  assert.equal(plan('hardRegenerate')?.label, 'Rebuild post');
  assert.match(plan('hardRegenerate')?.confirm ?? '', /no new model spend/);
  assert.deepEqual(plan('hardPublish')?.body, { vertical: 'ai_events', ref: id });
  assert.match(plan('hardPublish')?.confirm ?? '', /AI Events post goes out now/);
  assert.deepEqual(approveContent(never).parse(plan('approveContent')!.body), { vertical: 'ai_events', target: { aiEventsPostId: id } });
  assert.deepEqual(rejectContent(never).parse(plan('reject')!.body), { vertical: 'ai_events', target: { aiEventsPostId: id } });
  assert.deepEqual(hardPublish(never).parse(plan('hardPublish')!.body), { vertical: 'ai_events', target: { aiEventsPostId: id } });
  assert.deepEqual(hardRegenerate(never).parse(plan('hardRegenerate')!.body), { vertical: 'ai_events', target: { aiEventsPostId: id } });
  assert.deepEqual(hardRegenerate(never).parse({ vertical: 'ai_events', ref: id }), { vertical: 'ai_events', target: { aiEventsPostId: id } });
});

test('a booked, unapproved post offers Approve where it is, Move, Unschedule and Rebuild post', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const { id } = await seedRenderedPost(query);
  await scheduleAiEventsPost(query as unknown as Query, id, 'auto', SUN_NOON, '2026-10-25', () => 0);
  const post = await aiPost(query);
  assert.equal(post.status, 'scheduled');
  const actions = actionsFor(post, LIVE).filter((p): p is PostPlan => p.kind === 'post').map((p) => p.action);
  for (const a of ['approveContent', 'reschedule', 'unschedule', 'reject', 'hardPublish', 'hardRegenerate'] as const) assert.ok(actions.includes(a), a);
  assert.equal(actions.includes('place'), false);
});

function actionsOn(q: Query, now: Date): ContentActions {
  return aiEventsActions({
    query: async () => q,
    approvePost: (qq, id) => approveAiEventsPost(qq, id, now),
    rejectPost: rejectAiEventsPost,
    hardPublishPost: hardPublishAiEventsPost,
    publishingLive: async (qq) => (await readAiEventsSettings(qq)).publishingLive,
    unschedulePost: unscheduleAiEventsPost,
    queueRebuild: (qq, o) => queueAiEventsRun(qq as never, { kind: 'rebuild', requestedBy: o.requestedBy, weekKey: o.weekKey }),
    itemId: aiEventsItemId,
    placeItem: (qq, input) => placeItem(qq, { ...input, now, rng: () => 0 }),
    rescheduleItem: (qq, input) => rescheduleItem(qq, { ...input, now, rng: () => 0 }),
  });
}

test('the verbs on the real spine: approve, move, unschedule, place, reject, delete, publish now', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const q = query as unknown as Query;
  const a = actionsOn(q, SAT_9);
  const { id: one } = await seedRenderedPost(query, { slug: 'ae-1' });
  const approved = await a.approve!({ aiEventsPostId: one }, 'tommy');
  assert.equal(approved.ok, true);
  assert.match(approved.note, /^Approved and scheduled for 2026-10-25T22:/);
  // A later Sunday is refused: by then the week the post lists has started (its own Sunday only).
  const late = await a.reschedule!({ aiEventsPostId: one }, 'tommy', { nyDate: '2026-11-01', slot: 'evening' });
  assert.equal(late.ok, false);
  assert.match(late.note, /for the week after Sun, Oct 25, so it can’t post after that day/);
  const moved = await a.reschedule!({ aiEventsPostId: one }, 'tommy', { nyDate: '2026-10-25', slot: 'evening' });
  assert.equal(moved.ok, true, moved.note);
  assert.equal((await q(`SELECT ny_date::text AS d FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0].d, '2026-10-25');
  assert.equal((await a.unschedule!({ aiEventsPostId: one }, 'tommy')).ok, true);
  const mon = await a.place!({ aiEventsPostId: one }, 'tommy', { nyDate: '2026-10-26', slot: 'evening' });
  assert.equal(mon.ok, false);
  assert.match(mon.note, /doesn’t post on Mondays/);
  const after = await a.place!({ aiEventsPostId: one }, 'tommy', { nyDate: '2026-11-01', slot: 'evening' });
  assert.deepEqual([after.ok, /can’t post after that day/.test(after.note)], [false, true]);
  assert.equal((await a.place!({ aiEventsPostId: one }, 'tommy', { nyDate: '2026-10-25', slot: 'evening' })).ok, true);

  const { id: two } = await seedRenderedPost(query, { slug: 'ae-2', weekKey: '2026-W45', nyDate: '2026-11-01' });
  assert.deepEqual(await a.reject!({ aiEventsPostId: two }, 'tommy'), { ok: true, note: 'Rejected. It will not post.' });
  assert.equal((await q(`SELECT status FROM ai_events.posts WHERE id = $1`, [two])).rows[0].status, 'rejected');

  const { id: three } = await seedRenderedPost(query, { slug: 'ae-3', weekKey: '2026-W46', nyDate: '2026-11-08' });
  assert.equal((await a.delete!({ aiEventsPostId: three }, 'tommy')).ok, true);
  assert.ok((await q(`SELECT deleted_at FROM social_hub.content_items WHERE native_ref = $1`, [three])).rows[0].deleted_at);

  const { id: four } = await seedRenderedPost(query, { slug: 'ae-4', weekKey: '2026-W47', nyDate: '2026-11-15' });
  assert.deepEqual(await a.publishNow!({ aiEventsPostId: four }, 'tommy'), { ok: true, note: 'Queued to publish now.' });
});

test('Rebuild post queues a rebuild of the post’s own week, once; a rejected or published post is refused', async () => {
  const { query } = await openAiEventsDb();
  const q = query as unknown as Query;
  const a = actionsOn(q, SUN_NOON);
  const { id } = await seedRenderedPost(query);
  const out = await a.regenerate!({ aiEventsPostId: id }, 'tommy@helios.test');
  assert.equal(out.ok, true);
  assert.match(out.note, /Rebuild queued/);
  const runs = (await q(`SELECT trigger, kind, status, week_key, requested_by FROM ai_events.runs`)).rows;
  assert.deepEqual(runs.map((r) => [r.trigger, r.kind, r.status, r.week_key, r.requested_by]), [['manual', 'rebuild', 'requested', WEEK, 'tommy@helios.test']]);
  const again = await a.regenerate!({ aiEventsPostId: id }, 'tommy@helios.test');
  assert.deepEqual([again.ok, again.status], [false, 409]);
  assert.match(again.note, /already queued or running/);

  const { id: done } = await seedRenderedPost(query, { slug: 'ae-pub', weekKey: '2026-W43', nyDate: '2026-10-18', status: 'published' });
  assert.deepEqual(await a.regenerate!({ aiEventsPostId: done }, 't'), { ok: false, status: 409, note: 'This post is already published, so it isn’t rebuilt.' });
  const { id: gone } = await seedRenderedPost(query, { slug: 'ae-rej', weekKey: '2026-W42', nyDate: '2026-10-11', status: 'rejected' });
  const refused = await a.regenerate!({ aiEventsPostId: gone }, 't');
  assert.deepEqual([refused.ok, refused.status], [false, 409]);
  assert.match(refused.note, /rejected/);
});

test('a rejected post is refused by approve and Publish now, and the hub offers neither (nor Rebuild post)', async () => {
  const { query } = await openAiEventsDb({ publishingLive: true });
  const q = query as unknown as Query;
  const a = actionsOn(q, SAT_9);
  const { id } = await seedRenderedPost(query);
  await scheduleAiEventsPost(q, id, 'auto', SAT_9, '2026-10-25', () => 0);
  assert.equal((await a.reject!({ aiEventsPostId: id }, 'tommy')).ok, true);
  const approve = await a.approve!({ aiEventsPostId: id }, 'tommy');
  assert.deepEqual([approve.ok, approve.status], [false, 409]);
  assert.match(approve.note, /rejected/);
  const publish = await a.publishNow!({ aiEventsPostId: id }, 'tommy');
  assert.deepEqual([publish.ok, publish.status], [false, 409]);
  const posts = buildDataset(await readAll(query, undefined, SAT_9), null, SAT_9).posts.filter((p) => p.vertical === 'ai_events');
  assert.equal(posts.length, 1, 'the rejected card exists');
  for (const p of posts) {
    const actions = actionsFor(p, LIVE).filter((x): x is PostPlan => x.kind === 'post').map((x) => x.action);
    for (const not of ['approveContent', 'hardPublish', 'hardRegenerate'] as const) assert.equal(actions.includes(not), false, not);
  }
});

test('while AI Events publishing is off: no Publish now in the hub, Publish now refuses with 409, Approve approves without a slot', async () => {
  const { query } = await openAiEventsDb();
  const q = query as unknown as Query;
  const { id } = await seedRenderedPost(query);
  const post = await aiPost(query);
  for (const ctx of [{ quota: null, typicalCostLabel: null }, { quota: null, typicalCostLabel: null, aiEventsPublishingLive: false }, { quota: null, typicalCostLabel: null, lfdPublishingLive: true }]) {
    const actions = actionsFor(post, ctx).filter((x): x is PostPlan => x.kind === 'post').map((x) => x.action);
    assert.equal(actions.includes('hardPublish'), false);
    assert.ok(actions.includes('approveContent'));
  }
  const a = actionsOn(q, SAT_9);
  assert.deepEqual(await a.publishNow!({ aiEventsPostId: id }, 'tommy'), { ok: false, status: 409, note: AI_EVENTS_PUBLISHING_OFF_NOTE });
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0);
  assert.deepEqual(await a.approve!({ aiEventsPostId: id }, 'tommy'), { ok: true, note: AI_EVENTS_APPROVED_OFF_NOTE });
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0].n, 0);
});

test('the hub reads AI Events publishing into the offer (Publish now appears once it is on), and the menu says Rebuild post', async () => {
  const { query } = await openAiEventsDb();
  await seedRenderedPost(query);
  const { loadDataset } = await import('@/lib/social-hub/load');
  const { offerer } = await import('@/lib/social-hub/views/offer');
  const offer = async () => {
    const dataset = await loadDataset(query, SUN_NOON);
    return JSON.stringify(offerer(dataset, SUN_NOON).offer(dataset.posts.find((p) => p.vertical === 'ai_events')!));
  };
  const off = await offer();
  assert.equal(off.includes('hard-publish'), false);
  // The menu and the card both say Rebuild post; neither says Regenerate.
  assert.equal((off.match(/"key":"hardRegenerate","label":"Rebuild post"/g) ?? []).length, 2);
  assert.equal((off.match(/"confirmTitle":"Rebuild this post\?"/g) ?? []).length, 2);
  assert.doesNotMatch(off, /"label":"Regenerate"|Make a new version/);
  await query(`UPDATE ai_events.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  assert.equal((await offer()).includes('hard-publish'), true);
});
