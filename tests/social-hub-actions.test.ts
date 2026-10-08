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
import type { HubPost } from '@/lib/social-hub/types';

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

test('with every flag off, each action spec answers 404 before reading the session or the body', async () => {
  const OFF: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, false])) as HubFlags['actions'] };
  const never = (async () => { throw new Error('must not be called'); }) as never;
  const specs: Array<ActionSpec<any>> = [
    approveCarousel({ approveSchedule: never, socialQuery: never }),
    approveTrialReel({ schedulePostIdea: never }),
    hardPublish({ reelsForcePost: never, carouselHardPublish: never, socialQuery: never, explainerHardPublish: never, explainersDb: never, storiesPublishNow: never, storiesDb: null }),
    hardRegenerate({ explainersDb: never, loadExplainerSettings: never, explainerRerender: never, storiesRegenerate: never, storiesDb: null }),
  ];
  for (const spec of specs) {
    const res = await actionRoute(spec, { flags: OFF, session: never })(req({ scheduleId: U, postIdeaId: U, vertical: 'carousels', ref: U }));
    assert.equal(res.status, 404, spec.flag);
    assert.deepEqual(await res.json(), { ok: false, note: 'This action is turned off.' });
  }
});

test('the live action routes do nothing without their flag or a session', async () => {
  for (const POST of [approveCarouselPOST, approveTrialReelPOST, hardPublishPOST, hardRegeneratePOST]) {
    const res = await POST(req({ scheduleId: U })).catch(() => null);
    assert.ok(!res || res.status === 404 || res.status === 401 || res.status >= 500, 'flag off or no session: no call');
  }
});

test('with a flag off, nothing behind the route runs (session, body, pipeline call)', async () => {
  const approveSchedule = spy<[unknown, string], boolean>(true);
  const session = spy<[], { email: string }>({ email: 'a@b.c' });
  let bodyRead = false;
  const request = new Request('http://hub.test', { method: 'POST', body: JSON.stringify({ scheduleId: U }) });
  const originalJson = request.json.bind(request);
  request.json = async () => {
    bodyRead = true;
    return originalJson();
  };
  const OFF: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: { ...SOCIAL_HUB_FLAGS.actions, approveCarousel: false } };
  const POST = actionRoute(approveCarousel({ approveSchedule: approveSchedule as never, socialQuery: async () => 'q' }), { session, flags: OFF });
  assert.equal((await POST(request)).status, 404);
  assert.equal(approveSchedule.calls.length, 0);
  assert.equal(session.calls.length, 0);
  assert.equal(bodyRead, false);
});

const on = (extra: Partial<ActionEnv> = {}): ActionEnv => ({ flags: ALL_ON, session: async () => ({ email: 'tommy@helios.test' }), ...extra });

test('approve carousel (flag forced on): approveSchedule(query, scheduleId)', async () => {
  const approveSchedule = spy<[unknown, string], boolean>(true);
  const POST = actionRoute(approveCarousel({ approveSchedule: approveSchedule as never, socialQuery: async () => 'the-query' }), on());
  const res = await POST(req({ scheduleId: U }));
  assert.equal(res.status, 200);
  assert.deepEqual(approveSchedule.calls, [['the-query', U]]);
  assert.equal((await POST(req({ scheduleId: 'nope' }))).status, 400);
  const gone = actionRoute(approveCarousel({ approveSchedule: spy(false) as never, socialQuery: async () => 'q' }), on());
  assert.equal((await gone(req({ scheduleId: U }))).status, 409);
  const anon = actionRoute(approveCarousel({ approveSchedule: approveSchedule as never, socialQuery: async () => 'q' }), on({ session: async () => null }));
  assert.equal((await anon(req({ scheduleId: U }))).status, 401);
  assert.equal(approveSchedule.calls.length, 1, 'no call without a session');
});

test('approve trial reel (flag forced on): schedulePostIdea(idea, "user", video)', async () => {
  const schedulePostIdea = spy<[string, string, string | null], { scheduled: boolean; note: string }>({ scheduled: true, note: 'Approved' });
  const POST = actionRoute(approveTrialReel({ schedulePostIdea: schedulePostIdea as never }), on());
  assert.equal((await POST(req({ postIdeaId: U, videoJobId: V }))).status, 200);
  assert.equal((await POST(req({ postIdeaId: U }))).status, 200);
  assert.deepEqual(schedulePostIdea.calls, [[U, 'user', V], [U, 'user', null]]);
  assert.equal((await POST(req({ postIdeaId: U, videoJobId: 'x' }))).status, 400);
});

test('hard publish (flag forced on): each vertical\'s own function with the right arguments', async () => {
  const reels = spy<[string], { queued: boolean }>({ queued: true });
  const carousel = spy<[unknown, string], { queued: boolean }>({ queued: true });
  const explainer = spy<[unknown, string, string], { queued: boolean; note: string }>({ queued: false, note: 'This render was rejected in review.' });
  const stories = spy<[unknown, string], unknown>({});
  const POST = actionRoute(hardPublish({
    reelsForcePost: reels as never,
    carouselHardPublish: carousel as never,
    socialQuery: async () => 'social-q',
    explainerHardPublish: explainer as never,
    explainersDb: async () => 'explainers-db',
    storiesPublishNow: stories as never,
    storiesDb: 'stories-db',
  }), on());
  assert.equal((await POST(req({ vertical: 'reels', ref: V }))).status, 200);
  assert.equal((await POST(req({ vertical: 'carousels', ref: U }))).status, 200);
  const exp = await POST(req({ vertical: 'explainers', ref: V }));
  assert.equal(exp.status, 409, 'the pipeline refused; the note comes back');
  assert.match((await exp.json()).note, /rejected/);
  assert.equal((await POST(req({ vertical: 'stories', ref: U }))).status, 200);
  assert.deepEqual(reels.calls, [[V]]);
  assert.deepEqual(carousel.calls, [['social-q', U]]);
  assert.deepEqual(explainer.calls, [['explainers-db', V, 'tommy@helios.test']]);
  assert.deepEqual(stories.calls, [['stories-db', U]]);
  assert.equal((await POST(req({ vertical: 'nope', ref: U }))).status, 400);
});

test('hard regenerate (flag forced on): explainers requestRerender with loaded settings, refusals returned; stories regenerate', async () => {
  const rerender = spy<[unknown, unknown], { ok: boolean; reason?: string }>({ ok: true });
  const settings = spy<[unknown], unknown>({ daily_render_cap: 2 });
  const regen = spy<[unknown, string, string], unknown>({});
  const POST = actionRoute(hardRegenerate({
    explainersDb: async () => 'explainers-db', loadExplainerSettings: settings as never, explainerRerender: rerender as never,
    storiesRegenerate: regen as never, storiesDb: 'stories-db',
  }), on());
  assert.equal((await POST(req({ vertical: 'explainers', ref: U }))).status, 200);
  assert.equal((await POST(req({ vertical: 'stories', ref: V }))).status, 200);
  assert.deepEqual(rerender.calls, [['explainers-db', { topicId: U, settings: { daily_render_cap: 2 } }]]);
  assert.deepEqual(regen.calls, [['stories-db', V, 'tommy@helios.test']]);
  for (const vertical of ['carousels', 'reels']) assert.equal((await POST(req({ vertical, ref: U }))).status, 400, vertical);
  const capped = actionRoute(hardRegenerate({
    explainersDb: async () => 'db', loadExplainerSettings: async () => ({}), storiesRegenerate: spy({}) as never, storiesDb: null,
    explainerRerender: (async () => ({ ok: false, reason: 'daily_render_cap' })) as never,
  }), on());
  const res = await capped(req({ vertical: 'explainers', ref: U }));
  assert.equal(res.status, 409, 'a cap refusal is a failure, never "queued"');
  assert.match((await res.json()).note, /render cap/);
});

test('failure paths: pipeline refusals and thrown errors come back as failures, never as success', async () => {
  const refuse = actionRoute(approveTrialReel({ schedulePostIdea: (async () => ({ scheduled: false, note: 'No open slot today.', status: 409 })) as never }), on());
  const r1 = await refuse(req({ postIdeaId: U }));
  assert.equal(r1.status, 409);
  assert.deepEqual(await r1.json(), { ok: false, note: 'No open slot today.', status: 409 });
  const carouselRefuses = actionRoute(hardPublish({
    reelsForcePost: spy({ queued: true }) as never,
    carouselHardPublish: (async () => ({ queued: false, note: 'This carousel is not in review.' })) as never, socialQuery: async () => 'q',
    explainerHardPublish: spy({ queued: true }) as never, explainersDb: async () => 'db', storiesPublishNow: spy({}) as never, storiesDb: null,
  }), on());
  assert.equal((await carouselRefuses(req({ vertical: 'carousels', ref: U }))).status, 409);
  const storyStale = actionRoute(hardRegenerate({
    explainersDb: async () => 'db', loadExplainerSettings: async () => ({}), explainerRerender: spy({ ok: true }) as never,
    storiesRegenerate: (async () => { throw Object.assign(new Error('This set has moved on; refresh to see where it is.'), { status: 409 }); }) as never, storiesDb: null,
  }), on());
  const r3 = await storyStale(req({ vertical: 'stories', ref: U }));
  assert.equal(r3.status, 409, "the pipeline's ApiError status passes through");
  assert.match((await r3.json()).note, /moved on/);
  const boom = actionRoute(approveCarousel({ approveSchedule: (async () => { throw new Error('db down'); }) as never, socialQuery: async () => 'q' }), on());
  assert.equal((await boom(req({ scheduleId: U }))).status, 500);
});

test('JSON only: a form-encoded post is refused before any call', async () => {
  const approveSchedule = spy<[unknown, string], boolean>(true);
  const POST = actionRoute(approveCarousel({ approveSchedule: approveSchedule as never, socialQuery: async () => 'q' }), on());
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
  assert.deepEqual(cPlans.map((p) => p.kind === 'post' ? p.action : `link:${p.label}`), ['approveCarousel', 'hardPublish', 'link:Regenerate']);
  const reel = find((p) => p.vertical === 'reels' && p.status === 'scheduled' && !p.approval.approvedAt);
  const rPlans = actionsFor(reel, ctx);
  assert.deepEqual(rPlans.map((p) => p.kind === 'post' ? p.action : `link:${p.label}`), ['approveTrialReel', 'hardPublish', 'link:Regenerate']);
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
  assert.match(noSlot.disabled!, /Needs a slot first/);
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
