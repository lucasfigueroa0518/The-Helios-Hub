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
  setVerdict?: unknown; hardPublishJob?: unknown; loadSettings?: unknown; requestRerender?: unknown;
  schedulePostIdea?: unknown; rejectReel?: unknown; forcePost?: unknown;
  storyApprove?: unknown; storyReject?: unknown; storyPublishNow?: unknown; storyRegenerate?: unknown;
} = {}): () => Promise<Record<Vertical, ContentActions>> {
  const never = (name: string) => (async () => { throw new Error(`${name} must not be called`); }) as never;
  const pick = (v: unknown, name: string) => (v ?? never(name)) as never;
  return async () => ({
    carousels: carouselActions({
      query: async () => 'the-query' as never,
      approveSchedule: pick(o.approveSchedule, 'approveSchedule'), approvePost: pick(o.approvePost, 'approvePost'),
      rejectPost: pick(o.rejectPost, 'rejectPost'), hardPublishPost: pick(o.hardPublishPost, 'hardPublishPost'),
    }),
    explainers: explainerActions({
      db: async () => 'explainers-db' as never,
      setVerdict: pick(o.setVerdict, 'setVerdict'), hardPublishJob: pick(o.hardPublishJob, 'hardPublishJob'),
      loadSettings: pick(o.loadSettings, 'loadSettings'), requestRerender: pick(o.requestRerender, 'requestRerender'),
    }),
    reels: reelActions({ schedulePostIdea: pick(o.schedulePostIdea, 'schedulePostIdea'), rejectReel: pick(o.rejectReel, 'rejectReel'), forcePost: pick(o.forcePost, 'forcePost') }),
    stories: storyActions({
      approve: pick(o.storyApprove, 'approve'), reject: pick(o.storyReject, 'reject'),
      publishNow: pick(o.storyPublishNow, 'publishNow'), regenerate: pick(o.storyRegenerate, 'regenerate'),
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

test('the live action routes do nothing without their flag or a session', async () => {
  for (const POST of [approveCarouselPOST, approveTrialReelPOST, hardPublishPOST, hardRegeneratePOST, rejectPOST]) {
    assert.equal((await POST(req({ scheduleId: U }))).status, 404);
  }
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

test('hard regenerate: explainers requestRerender with loaded settings, refusals returned; stories regenerate; none for the others', async () => {
  const requestRerender = spy<[unknown, unknown], { ok: boolean; reason?: string }>({ ok: true });
  const loadSettings = spy<[unknown], unknown>({ daily_render_cap: 2 });
  const storyRegenerate = spy<[string, string], unknown>({});
  const POST = actionRoute(hardRegenerate(registry({ requestRerender, loadSettings, storyRegenerate })), on());
  assert.equal((await POST(req({ vertical: 'explainers', ref: U }))).status, 200);
  assert.equal((await POST(req({ vertical: 'stories', ref: V }))).status, 200);
  assert.deepEqual(requestRerender.calls, [['explainers-db', { topicId: U, settings: { daily_render_cap: 2 } }]]);
  assert.deepEqual(storyRegenerate.calls, [[V, 'tommy@helios.test']]);
  for (const vertical of ['carousels', 'reels']) assert.equal((await POST(req({ vertical, ref: U }))).status, 400, vertical);
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
  assert.deepEqual(cPlans.map((p) => p.kind === 'post' ? p.action : `link:${p.label}`), ['approveCarousel', 'reject', 'hardPublish', 'link:Regenerate']);
  const cReject = cPlans[1] as Extract<(typeof cPlans)[number], { kind: 'post' }>;
  assert.deepEqual(cReject.body, { vertical: 'carousels', refs: { postId: carousel.refs.postId } }, 'Reject names the type and the content (D47)');
  const reel = find((p) => p.vertical === 'reels' && p.status === 'scheduled' && !p.approval.approvedAt);
  const rPlans = actionsFor(reel, ctx);
  assert.deepEqual(rPlans.map((p) => p.kind === 'post' ? p.action : `link:${p.label}`), ['approveTrialReel', 'reject', 'hardPublish', 'link:Regenerate']);
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
