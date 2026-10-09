/**
 * P1-M6 gate: every action route is unreachable while its flag is off; with
 * the flag forced on in the test, it calls the existing pipeline function
 * (stubbed) with the right arguments. Plus Content House selections.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { approveCarousel } from '@/app/api/social-hub/actions/approve-carousel/handler';
import { POST as approveCarouselPOST } from '@/app/api/social-hub/actions/approve-carousel/route';
import { approveTrialReel } from '@/app/api/social-hub/actions/approve-trial-reel/handler';
import { POST as approveTrialReelPOST } from '@/app/api/social-hub/actions/approve-trial-reel/route';
import { hardPublish } from '@/app/api/social-hub/actions/hard-publish/handler';
import { POST as hardPublishPOST } from '@/app/api/social-hub/actions/hard-publish/route';
import { hardRegenerate } from '@/app/api/social-hub/actions/hard-regenerate/handler';
import { POST as hardRegeneratePOST } from '@/app/api/social-hub/actions/hard-regenerate/route';
import { rejectContent } from '@/app/api/social-hub/actions/reject/handler';
import { POST as rejectPOST } from '@/app/api/social-hub/actions/reject/route';
import { placeContent } from '@/app/api/social-hub/actions/place/handler';
import { POST as placePOST } from '@/app/api/social-hub/actions/place/route';
import { rescheduleContent } from '@/app/api/social-hub/actions/reschedule/handler';
import { POST as reschedulePOST } from '@/app/api/social-hub/actions/reschedule/route';
import { carouselActions } from '@/lib/publishing/actions/carousels';
import { explainerActions } from '@/lib/publishing/actions/explainers';
import { reelActions } from '@/lib/publishing/actions/reels';
import { storyActions } from '@/lib/publishing/actions/stories';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { actionRoute, type ActionEnv, type ActionSpec } from '@/lib/social-hub/action-route';
import { ACTION_FLAGS, SOCIAL_HUB_FLAGS, type HubFlags } from '@/lib/social-hub/flags';
import {
  actionsFor,
  needsApproval,
  onDeck,
  parseQuotaMessage,
  publishedLast24h,
  quotaFrom,
  sourceRows,
  timeLeft,
  todayPosts,
  typeRows,
  typicalCost,
} from '@/lib/social-hub/house';
import { parseRange } from '@/lib/social-hub/time';
import type { HubPost, Vertical } from '@/lib/social-hub/types';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const U = '0b7f2c4e-1111-4a5b-9c9d-0123456789ab';
const V = '1c8f3d5f-2222-4b6c-8d0e-1234567890bc';
const ALL_ON: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, true])) as HubFlags['actions'] };

const req = (body: unknown) => new Request('http://hub.test/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function spy<A extends unknown[], R>(result: R) {
  const calls: A[] = [];
  const fn = async (...args: A) => {
    calls.push(args);
    return result;
  };
  return Object.assign(fn, { calls });
}

/**
 * The real user-action layer (lib/publishing/actions, D47) over stubbed
 * pipeline functions: each route → its verb → the type's own function, with
 * the right arguments.
 */
function registry(o: {
  approveSchedule?: unknown; approvePost?: unknown; rejectPost?: unknown; hardPublishPost?: unknown;
  carouselItemId?: unknown; requestRerun?: unknown;
  setVerdict?: unknown; hardPublishJob?: unknown; loadSettings?: unknown; requestRerender?: unknown;
  explainerItemId?: unknown; verdictOf?: unknown;
  schedulePostIdea?: unknown; rejectReel?: unknown; forcePost?: unknown;
  reelItemId?: unknown; todaySlate?: unknown; findReelLock?: unknown; requestFinish?: unknown;
  storyApprove?: unknown; storyReject?: unknown; storyPublishNow?: unknown; storyRegenerate?: unknown;
  getSet?: unknown; slotOf?: unknown; plan?: unknown; rescheduleSet?: unknown;
  placeItem?: unknown; rescheduleItem?: unknown;
} = {}): () => Promise<Record<Vertical, ContentActions>> {
  const never = (name: string) => (async () => { throw new Error(`${name} must not be called`); }) as never;
  const pick = (v: unknown, name: string) => (v ?? never(name)) as never;
  return async () => ({
    carousels: carouselActions({
      query: async () => 'the-query' as never,
      approveSchedule: pick(o.approveSchedule, 'approveSchedule'), approvePost: pick(o.approvePost, 'approvePost'),
      rejectPost: pick(o.rejectPost, 'rejectPost'), hardPublishPost: pick(o.hardPublishPost, 'hardPublishPost'),
      itemId: pick(o.carouselItemId, 'carouselItemId'), requestRerun: pick(o.requestRerun, 'requestRerun'),
      placeItem: pick(o.placeItem, 'placeItem'), rescheduleItem: pick(o.rescheduleItem, 'rescheduleItem'),
    }),
    explainers: explainerActions({
      db: async () => 'explainers-db' as never,
      setVerdict: pick(o.setVerdict, 'setVerdict'), hardPublishJob: pick(o.hardPublishJob, 'hardPublishJob'),
      loadSettings: pick(o.loadSettings, 'loadSettings'), requestRerender: pick(o.requestRerender, 'requestRerender'),
      itemId: pick(o.explainerItemId, 'explainerItemId'), verdictOf: pick(o.verdictOf, 'verdictOf'),
      placeItem: pick(o.placeItem, 'placeItem'), rescheduleItem: pick(o.rescheduleItem, 'rescheduleItem'),
    }),
    reels: reelActions({
      schedulePostIdea: pick(o.schedulePostIdea, 'schedulePostIdea'), rejectReel: pick(o.rejectReel, 'rejectReel'), forcePost: pick(o.forcePost, 'forcePost'),
      query: 'reels-query' as never, itemId: pick(o.reelItemId, 'reelItemId'),
      placeItem: pick(o.placeItem, 'placeItem'), rescheduleItem: pick(o.rescheduleItem, 'rescheduleItem'),
      todaySlate: pick(o.todaySlate, 'todaySlate'), findReelLock: pick(o.findReelLock, 'findReelLock'), requestFinish: pick(o.requestFinish, 'requestFinish'),
    }),
    stories: storyActions({
      approve: pick(o.storyApprove, 'approve'), reject: pick(o.storyReject, 'reject'),
      publishNow: pick(o.storyPublishNow, 'publishNow'), regenerate: pick(o.storyRegenerate, 'regenerate'),
      query: 'stories-query' as never, getSet: pick(o.getSet, 'getSet'), slotOf: pick(o.slotOf, 'slotOf'),
      plan: pick(o.plan, 'plan'), rescheduleSet: pick(o.rescheduleSet, 'rescheduleSet'),
    }),
  });
}

test('with every flag off, each action spec answers 404 before reading the session or the body', async () => {
  const OFF: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, false])) as HubFlags['actions'] };
  const neverActions = (async () => { throw new Error('must not be called'); }) as never;
  const specs: Array<ActionSpec<any>> = [
    approveCarousel(neverActions), approveTrialReel(neverActions), hardPublish(neverActions), hardRegenerate(neverActions), rejectContent(neverActions),
  ];
  for (const spec of specs) {
    let sessionRead = false;
    const POST = actionRoute(spec, { flags: OFF, session: async () => { sessionRead = true; return { email: 'x' }; } });
    const res = await POST(req({ scheduleId: U }));
    assert.equal(res.status, 404, spec.flag);
    assert.equal(sessionRead, false, `${spec.flag}: no session read`);
  }
});

test('the live action routes exist; their flag and session checks are covered by the specs below', () => {
  // The flags are on now (Tommy, 2026-10-08), so a bare route call would reach the session read. Every flag-off
  // and no-session path is exercised through actionRoute(spec, env) in the tests around this one.
  for (const POST of [approveCarouselPOST, approveTrialReelPOST, hardPublishPOST, hardRegeneratePOST, rejectPOST]) assert.equal(typeof POST, 'function');
});

const on = (extra: Partial<ActionEnv> = {}): ActionEnv => ({ flags: ALL_ON, session: async () => ({ email: 'tommy@helios.test' }), ...extra });

test('approve carousel: a waiting slot (approveSchedule) or a post in review (approvePost, P2-M4); older and new bodies', async () => {
  const approveSchedule = spy<[unknown, string], boolean>(true);
  const approvePost = spy<[unknown, string], unknown>({ scheduled: true, id: U, publishAt: '2026-10-09T13:30:00.000Z' });
  const POST = actionRoute(approveCarousel(registry({ approveSchedule, approvePost })), on());
  assert.equal((await POST(req({ scheduleId: U }))).status, 200);
  const placed = await POST(req({ postId: V }));
  assert.match((await placed.json()).note, /Approved and scheduled for 2026-10-09T13:30/);
  assert.equal((await POST(req({ vertical: 'carousels', refs: { postId: V } }))).status, 200, 'the new { vertical, refs } body');
  assert.deepEqual(approveSchedule.calls, [['the-query', U]]);
  assert.deepEqual(approvePost.calls, [['the-query', V], ['the-query', V]]);
  assert.equal((await POST(req({ scheduleId: 'nope' }))).status, 400);
  assert.equal((await POST(req({ vertical: 'reels', refs: { postIdeaId: U } }))).status, 400, 'this route only approves carousels');
  const gone = actionRoute(approveCarousel(registry({ approveSchedule: spy(false) })), on());
  assert.equal((await gone(req({ scheduleId: U }))).status, 409);
  const full = actionRoute(approveCarousel(registry({ approvePost: spy({ scheduled: false, note: 'No carousel window is open in the next two weeks.' }) })), on());
  const refused = await full(req({ postId: U }));
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).note, /No carousel window/);
  const anon = actionRoute(approveCarousel(registry({ approveSchedule })), on({ session: async () => null }));
  assert.equal((await anon(req({ scheduleId: U }))).status, 401);
  assert.equal(approveSchedule.calls.length, 1, 'no call without a session');
});

test('approve trial reel: schedulePostIdea(idea, "user", video)', async () => {
  const schedulePostIdea = spy<[string, string, string | null], { scheduled: boolean; note: string }>({ scheduled: true, note: 'Approved' });
  const POST = actionRoute(approveTrialReel(registry({ schedulePostIdea })), on());
  assert.equal((await POST(req({ postIdeaId: U, videoJobId: V }))).status, 200);
  assert.equal((await POST(req({ postIdeaId: U }))).status, 200);
  assert.deepEqual(schedulePostIdea.calls, [[U, 'user', V], [U, 'user', null]]);
  assert.equal((await POST(req({ postIdeaId: U, videoJobId: 'x' }))).status, 400);
});

test('hard publish: each type\'s own function with the right arguments', async () => {
  const forcePost = spy<[string], { queued: boolean }>({ queued: true });
  const hardPublishPost = spy<[unknown, string], { queued: boolean }>({ queued: true });
  const hardPublishJob = spy<[unknown, string, string], { queued: boolean; note: string }>({ queued: false, note: 'This render was rejected in review.' });
  const storyPublishNow = spy<[string], unknown>({});
  const POST = actionRoute(hardPublish(registry({ forcePost, hardPublishPost, hardPublishJob, storyPublishNow })), on());
  assert.equal((await POST(req({ vertical: 'reels', ref: V }))).status, 200);
  assert.equal((await POST(req({ vertical: 'carousels', ref: U }))).status, 200);
  const exp = await POST(req({ vertical: 'explainers', ref: V }));
  assert.equal(exp.status, 409, 'the pipeline refused; the note comes back');
  assert.match((await exp.json()).note, /rejected/);
  assert.equal((await POST(req({ vertical: 'stories', ref: U }))).status, 200);
  assert.deepEqual(forcePost.calls, [[V]]);
  assert.deepEqual(hardPublishPost.calls, [['the-query', U]]);
  assert.deepEqual(hardPublishJob.calls, [['explainers-db', V, 'tommy@helios.test']]);
  assert.deepEqual(storyPublishNow.calls, [[U]]);
  assert.equal((await POST(req({ vertical: 'nope', ref: U }))).status, 400);
});

test('hard regenerate: explainers requestRerender with loaded settings, refusals returned; stories regenerate; carousels and trial reels too (D51, D52)', async () => {
  const requestRerender = spy<[unknown, unknown], { ok: boolean; reason?: string }>({ ok: true });
  const loadSettings = spy<[unknown], unknown>({ daily_render_cap: 2 });
  const storyRegenerate = spy<[string, string], unknown>({});
  const POST = actionRoute(hardRegenerate(registry({ requestRerender, loadSettings, storyRegenerate })), on());
  assert.equal((await POST(req({ vertical: 'explainers', ref: U }))).status, 200);
  assert.equal((await POST(req({ vertical: 'stories', ref: V }))).status, 200);
  assert.deepEqual(requestRerender.calls, [['explainers-db', { topicId: U, settings: { daily_render_cap: 2 } }]]);
  assert.deepEqual(storyRegenerate.calls, [[V, 'tommy@helios.test']]);
  assert.equal((await POST(req({ vertical: 'nope', ref: U }))).status, 400);
  const capped = actionRoute(hardRegenerate(registry({ loadSettings: async () => ({}), requestRerender: async () => ({ ok: false, reason: 'daily_render_cap' }) })), on());
  const res = await capped(req({ vertical: 'explainers', ref: U }));
  assert.equal(res.status, 409, 'a cap refusal is a failure, never "queued"');
  assert.match((await res.json()).note, /render cap/);
});

test('reject (D47): every type through its own function; the body names the type and its refs', async () => {
  const rejectPost = spy<[unknown, string, string], boolean>(true);
  const rejectReel = spy<[string, string | null, string], { rejected: boolean; note: string }>({ rejected: true, note: 'Rejected. It will not post.' });
  const setVerdict = spy<[unknown, string, string, string], unknown>({});
  const storyReject = spy<[string, string], unknown>({});
  const POST = actionRoute(rejectContent(registry({ rejectPost, rejectReel, setVerdict, storyReject })), on());
  for (const body of [
    { vertical: 'carousels', refs: { postId: U } },
    { vertical: 'reels', refs: { postIdeaId: U, videoJobId: V } },
    { vertical: 'explainers', refs: { jobId: U } },
    { vertical: 'stories', refs: { setId: V } },
  ]) assert.equal((await POST(req(body))).status, 200, body.vertical);
  assert.deepEqual(rejectPost.calls, [['the-query', U, 'tommy@helios.test']]);
  assert.deepEqual(rejectReel.calls, [[U, V, 'tommy@helios.test']]);
  assert.deepEqual(setVerdict.calls, [['explainers-db', U, 'rejected', 'tommy@helios.test']]);
  assert.deepEqual(storyReject.calls, [[V, 'tommy@helios.test']]);
  assert.equal((await POST(req({ vertical: 'carousels', refs: { scheduleId: U } }))).status, 400, 'a missing ref the verb needs is a 400');
  assert.equal((await POST(req({ vertical: 'carousels', refs: { postId: 'x' } }))).status, 400, 'every ref is a uuid');
});

// ── D50–D53: placement, carousel and Trial Reels regenerate, Explainers reject with tags ──

/** Every flag on, plus the placement routes' `reschedule` (not in flags.ts yet; see content-action.ts). */
const PLACE_ON: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: { ...ALL_ON.actions, reschedule: true } as HubFlags['actions'] };
const onPlace = (extra: Partial<ActionEnv> = {}): ActionEnv => ({ ...on(), flags: PLACE_ON, ...extra });

test('place and reschedule: 404 while the reschedule flag is off (or not defined yet), before any session read', async () => {
  for (const POST of [placePOST, reschedulePOST]) assert.equal(typeof POST, 'function');
  const RESCHEDULE_OFF: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: { ...ALL_ON.actions, reschedule: false } as HubFlags['actions'] };
  for (const spec of [placeContent(async () => { throw new Error('never'); }), rescheduleContent(async () => { throw new Error('never'); })]) {
    const NOT_DEFINED: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: {} as HubFlags['actions'] };
    for (const flags of [RESCHEDULE_OFF, NOT_DEFINED]) {
      let sessionRead = false;
      const POST = actionRoute(spec, { flags, session: async () => { sessionRead = true; return { email: 'x' }; } });
      assert.equal((await POST(req({ vertical: 'carousels', refs: { postId: U }, nyDate: '2026-10-09', slot: 'morning' }))).status, 404);
      assert.equal(sessionRead, false);
    }
  }
});

test('place: each type resolves its content, then the placement rules run with the day and slot', async () => {
  const placeItem = spy<[unknown, Record<string, unknown>], unknown>({ ok: true, note: 'Scheduled for Fri Oct 9, 9:23 AM.', scheduleId: U, publishAt: '2026-10-09T13:23:00.000Z' });
  const carouselItemId = spy<[unknown, string], string>('item-c');
  const explainerItemId = spy<[unknown, string], string>('item-e');
  const verdictOf = spy<[unknown, string], string | null>(null);
  const reelItemId = spy<[string], string>('item-r');
  const POST = actionRoute(placeContent(registry({ placeItem, carouselItemId, explainerItemId, verdictOf, reelItemId })), onPlace());
  const ok = await POST(req({ vertical: 'carousels', refs: { postId: U }, nyDate: '2026-10-09', slot: 'morning' }));
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).note, /^Scheduled for Fri Oct 9, 9:23 AM\.$/);
  assert.equal((await POST(req({ vertical: 'explainers', refs: { jobId: V, topicId: U }, nyDate: '2026-10-09', slot: 'late' }))).status, 200);
  assert.equal((await POST(req({ vertical: 'reels', refs: { postIdeaId: U, videoJobId: V }, nyDate: '2026-10-10', slot: 'evening' }))).status, 200);
  assert.deepEqual(carouselItemId.calls, [['the-query', U]]);
  assert.deepEqual(verdictOf.calls.map((c) => c[1]), [V]);
  assert.deepEqual(reelItemId.calls, [[V]]);
  assert.deepEqual(placeItem.calls.map(([q, input]) => [typeof q === 'function' ? 'explainers-spine' : q, input]), [
    ['the-query', { vertical: 'carousels', itemId: 'item-c', nyDate: '2026-10-09', slot: 'morning' }],
    ['explainers-spine', { vertical: 'explainers', itemId: 'item-e', nyDate: '2026-10-09', slot: 'late' }],
    ['reels-query', { vertical: 'reels', itemId: 'item-r', ideaRef: U, nyDate: '2026-10-10', slot: 'evening' }],
  ]);
  // Bodies: the day must be a real YYYY-MM-DD, the slot a slot name, refs uuids.
  for (const body of [
    { vertical: 'carousels', refs: { postId: U }, nyDate: '2026-13-01', slot: 'morning' },
    { vertical: 'carousels', refs: { postId: U }, nyDate: '2026-10-09' },
    { vertical: 'carousels', refs: { postId: U }, nyDate: '2026-10-09', slot: 'DROP TABLE' },
    { vertical: 'carousels', refs: { postId: 'x' }, nyDate: '2026-10-09', slot: 'morning' },
    { vertical: 'carousels', refs: { postId: U } },
  ]) assert.equal((await POST(req(body))).status, 400, JSON.stringify(body));
  assert.equal(placeItem.calls.length, 3);
  const refused = actionRoute(placeContent(registry({ carouselItemId, placeItem: async () => ({ ok: false, note: 'That slot is taken.' }) })), onPlace());
  const r = await refused(req({ vertical: 'carousels', refs: { postId: U }, nyDate: '2026-10-09', slot: 'morning' }));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).note, 'That slot is taken.');
  const rejected = actionRoute(placeContent(registry({ verdictOf: async () => 'rejected' })), onPlace());
  const rr = await rejected(req({ vertical: 'explainers', refs: { jobId: V }, nyDate: '2026-10-09', slot: 'late' }));
  assert.equal(rr.status, 409, 'a review-page rejection wins before the spine is asked (D41)');
});

test('reschedule: each type moves through rescheduleItem; Stories through their own set', async () => {
  const rescheduleItem = spy<[unknown, Record<string, unknown>], unknown>({ ok: true, note: 'Moved to Sat Oct 10, 2:41 PM.', scheduleId: U, publishAt: '2026-10-10T18:41:00.000Z' });
  const carouselItemId = spy<[unknown, string], string>('item-c');
  const getSet = spy<[string], unknown>({ set: { status: 'scheduled', series: 'morning_download', ny_date: '2026-10-09', publish_at: '2026-10-09T13:00:00Z' } });
  const slotOf = spy<[string], unknown>({ id: V, publishAt: new Date('2026-10-09T13:00:00Z') });
  const plan = spy<[unknown, Record<string, unknown>], unknown>({ ok: true, nyDate: '2026-10-10', slot: 'morning_download', publishAt: new Date('2026-10-10T13:12:00Z') });
  const rescheduleSet = spy<[string, string, Date], unknown>({});
  const POST = actionRoute(rescheduleContent(registry({ rescheduleItem, carouselItemId, getSet, slotOf, plan, rescheduleSet })), onPlace());
  const moved = await POST(req({ vertical: 'carousels', refs: { postId: U, scheduleId: V }, nyDate: '2026-10-10', slot: 'afternoon' }));
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).note, 'Moved to Sat Oct 10, 2:41 PM.');
  assert.deepEqual(rescheduleItem.calls, [['the-query', { vertical: 'carousels', itemId: 'item-c', nyDate: '2026-10-10', slot: 'afternoon' }]]);
  const story = await POST(req({ vertical: 'stories', refs: { setId: U }, nyDate: '2026-10-10', slot: 'morning_download' }));
  assert.equal(story.status, 200);
  assert.equal((await story.json()).note, 'Moved to Sat Oct 10, 9:12 AM.');
  assert.deepEqual(plan.calls, [['stories-query', { vertical: 'stories', nyDate: '2026-10-10', slot: 'morning_download', moving: { scheduleId: V, publishAt: new Date('2026-10-09T13:00:00Z') } }]]);
  assert.deepEqual(rescheduleSet.calls, [[U, '2026-10-10', new Date('2026-10-10T13:12:00Z')]]);
  const wrongSeries = await POST(req({ vertical: 'stories', refs: { setId: U }, nyDate: '2026-10-10', slot: 'free_vs_paid' }));
  assert.equal(wrongSeries.status, 409);
  assert.match((await wrongSeries.json()).note, /Morning Download set posts only in its own slot/);
  const posting = actionRoute(rescheduleContent(registry({ getSet: async () => ({ set: { status: 'publishing', series: 'morning_download', ny_date: '2026-10-09', publish_at: null } }) })), onPlace());
  const p = await posting(req({ vertical: 'stories', refs: { setId: U }, nyDate: '2026-10-10', slot: 'morning_download' }));
  assert.equal(p.status, 409);
  assert.match((await p.json()).note, /posting or has posted/);
});

test('hard regenerate for carousels queues a one-story rerun (D51); for Trial Reels it rebuilds today\'s video (D52)', async () => {
  const requestRerun = spy<[unknown, string, string], unknown>({ queued: true, id: V });
  const todaySlate = spy<[string], string | null>(V);
  const findReelLock = spy<[string, string], unknown>(null);
  const requestFinish = spy<[string, string], unknown>({ status: 'active', note: 'Generating: copy, then the frame, then the video.' });
  const POST = actionRoute(hardRegenerate(registry({ requestRerun, todaySlate, findReelLock, requestFinish })), on());
  const c = await POST(req({ vertical: 'carousels', ref: U }));
  assert.equal(c.status, 200);
  assert.match((await c.json()).note, /rerun of this story is queued/);
  assert.deepEqual(requestRerun.calls, [['the-query', U, 'tommy@helios.test']]);
  const r = await POST(req({ vertical: 'reels', refs: { postIdeaId: U, videoJobId: V } }));
  assert.equal(r.status, 200);
  assert.match((await r.json()).note, /Rebuilding today’s video/);
  assert.deepEqual(todaySlate.calls, [[U]]);
  assert.deepEqual(findReelLock.calls, [[V, U]]);
  assert.deepEqual(requestFinish.calls, [[U, V]], 'requestFinish(idea, today’s slate)');

  const locked = actionRoute(hardRegenerate(registry({ todaySlate: async () => V, findReelLock: async () => ({ nyDate: '2026-10-08', slot: 1 }), requestFinish: async () => { throw new Error('must not be called'); } })), on());
  const l = await locked(req({ vertical: 'reels', ref: U }));
  assert.equal(l.status, 409);
  assert.equal((await l.json()).note, 'This reel is locked for 2026-10-08 and stays as it is.');
  const notToday = actionRoute(hardRegenerate(registry({ todaySlate: async () => null })), on());
  const n = await notToday(req({ vertical: 'reels', ref: U }));
  assert.equal(n.status, 409);
  assert.match((await n.json()).note, /isn’t on today’s slate/);
  const queued = actionRoute(hardRegenerate(registry({ requestRerun: async () => ({ queued: false, note: 'A rerun of this story is already queued.' }) })), on());
  const q = await queued(req({ vertical: 'carousels', ref: U }));
  assert.equal(q.status, 409);
  assert.equal((await q.json()).note, 'A rerun of this story is already queued.');
});

test('reject with a review (D53): tags from the Explainers vocabulary and a note reach setVerdict; anything else is a 400', async () => {
  const setVerdict = spy<[unknown, string, string, string, unknown?], unknown>({});
  const POST = actionRoute(rejectContent(registry({ setVerdict })), on());
  assert.equal((await POST(req({ vertical: 'explainers', refs: { jobId: U }, tags: ['hook', 'pacing', 'hook'], note: 'Slow open.' }))).status, 200);
  assert.equal((await POST(req({ vertical: 'explainers', refs: { jobId: U }, tags: [] }))).status, 200);
  assert.deepEqual(setVerdict.calls, [
    ['explainers-db', U, 'rejected', 'tommy@helios.test', { tags: ['hook', 'pacing'], note: 'Slow open.' }],
    ['explainers-db', U, 'rejected', 'tommy@helios.test', { tags: [] }],
  ]);
  for (const body of [
    { vertical: 'explainers', refs: { jobId: U }, tags: ['boring'] },
    { vertical: 'explainers', refs: { jobId: U }, tags: 'hook' },
    { vertical: 'explainers', refs: { jobId: U }, note: 'x'.repeat(501) },
    { vertical: 'explainers', refs: { jobId: U }, note: 7 },
  ]) assert.equal((await POST(req(body))).status, 400, JSON.stringify(body));
  assert.equal((await POST(req({ vertical: 'explainers', refs: { jobId: U }, note: 'x'.repeat(500) }))).status, 200, '500 characters is fine');
  assert.equal(setVerdict.calls.length, 3);
});

test('failure paths: pipeline refusals and thrown errors come back as failures, never as success', async () => {
  const refuse = actionRoute(approveTrialReel(registry({ schedulePostIdea: async () => ({ scheduled: false, note: 'No open slot today.', status: 409 }) })), on());
  const r1 = await refuse(req({ postIdeaId: U }));
  assert.equal(r1.status, 409);
  assert.deepEqual(await r1.json(), { ok: false, note: 'No open slot today.', status: 409 });
  const carouselRefuses = actionRoute(hardPublish(registry({ hardPublishPost: async () => ({ queued: false, note: 'This carousel is not in review.' }) })), on());
  assert.equal((await carouselRefuses(req({ vertical: 'carousels', ref: U }))).status, 409);
  const storyStale = actionRoute(hardRegenerate(registry({
    storyRegenerate: async () => { throw Object.assign(new Error('This set has moved on; refresh to see where it is.'), { status: 409 }); },
  })), on());
  const r3 = await storyStale(req({ vertical: 'stories', ref: U }));
  assert.equal(r3.status, 409, "the pipeline's ApiError status passes through");
  assert.match((await r3.json()).note, /moved on/);
  const boom = actionRoute(approveCarousel(registry({ approveSchedule: async () => { throw new Error('db down'); } })), on());
  assert.equal((await boom(req({ scheduleId: U }))).status, 500);
});

test('JSON only: a form-encoded post is refused before any call', async () => {
  const approveSchedule = spy<[unknown, string], boolean>(true);
  const POST = actionRoute(approveCarousel(registry({ approveSchedule })), on());
  const form = new Request('http://hub.test', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `scheduleId=${U}` });
  assert.equal((await POST(form)).status, 415);
  assert.equal(approveSchedule.calls.length, 0);
});

// ── Content House selections ─────────────────────────────────────────────────

const d = previewDataset();
const today = '2026-10-08';

test('needs approval: unapproved future slots and unreviewed content, soonest slot first, with time left', () => {
  const list = needsApproval(d.posts, FIXTURE_NOW);
  assert.ok(list.length > 0);
  assert.ok(list.every((p) => (p.status === 'scheduled' && !p.approval.approvedAt && p.publishAt! > FIXTURE_NOW.toISOString()) || p.status === 'ready'));
  const slotted = list.filter((p) => p.publishAt).map((p) => p.publishAt!);
  assert.deepEqual(slotted, [...slotted].sort());
  assert.ok(list.findIndex((p) => !p.publishAt) > list.findLastIndex((p) => p.publishAt));
  assert.match(timeLeft(list[0]!, FIXTURE_NOW)!, /left$/);
  assert.equal(timeLeft({ publishAt: '2026-10-08T18:00:00Z' } as HubPost, FIXTURE_NOW), 'slot passed');
});

test('today, on deck, types and sources', () => {
  assert.ok(todayPosts(d.posts, today).every((p) => p.nyDate === today && p.status !== 'ready'));
  const deck = onDeck(d.posts);
  assert.ok(deck.length > 0 && deck.every((p) => p.status === 'scheduled' || p.status === 'publishing'));
  const rows = typeRows(d.posts, 'views', parseRange({}, FIXTURE_NOW));
  assert.deepEqual(rows.map((r) => r.vertical), ['reels', 'explainers', 'carousels', 'stories']);
  assert.ok(rows.every((r) => r.posts > 0 && r.costPerPost != null && r.value != null));
  const skip = typeRows(d.posts, 'skipRate', parseRange({}, FIXTURE_NOW));
  assert.equal(skip.find((r) => r.vertical === 'stories')!.value, null, 'a reel-only metric is n/a for Stories');
  const src = sourceRows(d.sources, d.posts, 'views');
  assert.ok(src.every((s) => s.reuse === s.postIds.length));
  assert.ok(typicalCost(d.posts, 'explainers', today)! > 0);
});

test('actions per vertical: flagged posts where an existing function exists, links elsewhere, reasons when unavailable', () => {
  const find = (pred: (p: HubPost) => boolean) => d.posts.find(pred)!;
  const ctx = { quota: null, typicalCostLabel: '$3.00' };
  const carousel = find((p) => p.vertical === 'carousels' && p.status === 'scheduled' && !p.approval.approvedAt);
  const cPlans = actionsFor(carousel, ctx);
  assert.deepEqual(cPlans.map((p) => p.kind === 'post' ? p.action : `link:${p.label}`), ['approveCarousel', 'reject', 'reschedule', 'hardPublish', 'hardRegenerate']);
  const cReject = cPlans[1] as Extract<(typeof cPlans)[number], { kind: 'post' }>;
  assert.deepEqual(cReject.body, { vertical: 'carousels', refs: { postId: carousel.refs.postId } }, 'Reject names the type and the content (D47)');
  const reel = find((p) => p.vertical === 'reels' && p.status === 'scheduled' && !p.approval.approvedAt);
  const rPlans = actionsFor(reel, ctx);
  assert.deepEqual(rPlans.map((p) => p.kind === 'post' ? p.action : `link:${p.label}`), ['approveTrialReel', 'reject', 'reschedule', 'hardPublish', 'hardRegenerate']);
  const rApprove = rPlans[0] as Extract<(typeof rPlans)[number], { kind: 'post' }>;
  assert.deepEqual(rApprove.body, { postIdeaId: reel.refs.postIdeaId, videoJobId: reel.refs.videoJobId ?? null });
  const readyExplainer = find((p) => p.vertical === 'explainers' && p.status === 'ready');
  const ePlans = actionsFor(readyExplainer, ctx);
  assert.ok(ePlans.some((p) => p.kind === 'link' && p.href === '/explainers/reels'));
  const eRegen = ePlans.find((p) => p.kind === 'post' && p.action === 'hardRegenerate') as Extract<(typeof ePlans)[number], { kind: 'post' }>;
  assert.equal(eRegen.body.ref, readyExplainer.refs.topicId, 'explainer reruns go through requestRerender (P2-M3)');
  const readySet = find((p) => p.vertical === 'stories' && p.status === 'ready');
  const regen = actionsFor(readySet, ctx).find((p) => p.kind === 'post' && p.action === 'hardRegenerate') as Extract<ReturnType<typeof actionsFor>[number], { kind: 'post' }>;
  assert.equal(regen.body.ref, readySet.refs.setId);
  assert.equal(regen.disabled, null);
  assert.match(regen.confirm!, /\$3\.00/);
  const readyCarousel = find((p) => p.vertical === 'carousels' && p.status === 'ready');
  const noSlot = actionsFor(readyCarousel, ctx).find((p) => p.kind === 'post' && p.action === 'approveCarousel') as Extract<ReturnType<typeof actionsFor>[number], { kind: 'post' }>;
  // P2-M4: a carousel in review is approved straight into the earliest open window.
  assert.equal(noSlot.disabled, null);
  assert.deepEqual(noSlot.body, { postId: readyCarousel.refs.postId });
  const skipped = find((p) => p.vertical === 'stories' && p.status === 'skipped');
  const sPub = actionsFor(skipped, ctx).find((p) => p.kind === 'post' && p.action === 'hardPublish') as Extract<ReturnType<typeof actionsFor>[number], { kind: 'post' }>;
  assert.match(sPub.disabled!, /never reused/);
  const low = actionsFor(carousel, { quota: { left: 3, total: 100, source: 'x', publishedLast24h: 0 }, typicalCostLabel: null })
    .find((p) => p.kind === 'post' && p.action === 'hardPublish') as Extract<ReturnType<typeof actionsFor>[number], { kind: 'post' }>;
  assert.match(low.disabled!, /Fewer than 5/);
  const published = find((p) => p.status === 'published' && p.vertical === 'carousels');
  assert.ok(!actionsFor(published, ctx).some((p) => p.kind === 'post' && p.action === 'hardPublish'), 'a posted carousel is not posted again');
});

test('quota: parse the publishers\' messages; only the last 24 h counts; media counted from rows', () => {
  assert.deepEqual(parseQuotaMessage('The Instagram account has 3 of 100 posts left in its 24-hour quota.'), { left: 3, total: 100 });
  assert.deepEqual(parseQuotaMessage('publishing quota: 98/100 used in 24 hours, 5 frames to post'), { left: 2, total: 100 });
  assert.equal(parseQuotaMessage('container error'), null);
  const fresh = quotaFrom({ text: 'has 62 of 100 posts left', at: '2026-10-08T15:00:00Z' }, d.posts, FIXTURE_NOW);
  assert.equal(fresh.left, 62);
  const stale = quotaFrom({ text: 'has 62 of 100 posts left', at: '2026-10-01T15:00:00Z' }, d.posts, FIXTURE_NOW);
  assert.equal(stale.left, null);
  assert.ok(publishedLast24h(d.posts, FIXTURE_NOW) > 0);
});
