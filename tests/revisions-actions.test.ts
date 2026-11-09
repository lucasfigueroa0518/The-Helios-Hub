/**
 * Targeted Revisions task 5: the revise / undoRevision / continueRevision verbs
 * and their routes, on PGlite with a fake content type (offline, no model calls).
 * Mirrors tests/social-hub-actions.test.ts: the real user-action layer over stubs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { continueRevisionContent } from '@/app/api/social-hub/actions/continue-revision/handler';
import { reviseContent } from '@/app/api/social-hub/actions/revise/handler';
import { undoRevisionContent } from '@/app/api/social-hub/actions/undo-revision/handler';
import { carouselActions } from '@/lib/publishing/actions/carousels';
import { reelActions } from '@/lib/publishing/actions/reels';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { clearRegistryForTest, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import { claimNextRequested, createRequest, listForItem, markApplied, markEnded, markRunning } from '@/lib/revisions/store';
import type { ContentTypeDescription, Interpretation, PartState, PostSnapshot } from '@/lib/revisions/types';
import { actionRoute, type ActionEnv, type ActionSpec } from '@/lib/social-hub/action-route';
import { ACTION_FLAGS, SOCIAL_HUB_FLAGS, actionEnabled, type HubFlags } from '@/lib/social-hub/flags';
import type { Query } from '@/lib/social/store/pg';
import type { Vertical } from '@/lib/social-hub/types';

import { setupRevisionsDb } from './fixtures/revisions/pglite';

const U = '0b7f2c4e-1111-4a5b-9c9d-0123456789ab';
const W = '2d9f4e6a-3333-4c7d-9e1f-2345678901cd';
const EMAIL = 'lucas@helios.test';
const ALL_ON: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, true])) as HubFlags['actions'] };
const ALL_OFF: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, false])) as HubFlags['actions'] };
const on = (extra: Partial<ActionEnv> = {}): ActionEnv => ({ flags: ALL_ON, session: async () => ({ email: EMAIL }), revalidate: () => {}, ...extra });

const req = (body: unknown) => new Request('http://hub.test/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const part = { kind: 'slide', key: '3' };

function fakeType(status: PostSnapshot['status'] = 'review') {
  const post = { status, slide3: { copy: 'v0', files: ['slide3-v0.png'] } as PartState };
  const calls = { load: 0, revise: 0, restore: 0 };
  const desc: ContentTypeDescription = {
    vertical: 'carousels',
    label: 'carousels',
    stageTags: ['copy_write'],
    fixKinds: ['wording'],
    load: async () => {
      calls.load += 1;
      return { vertical: 'carousels', refs: { postId: U }, status: post.status, parts: [{ ref: part, text: String(post.slide3.copy) }] };
    },
    estimate: () => 0.01,
    revise: async () => {
      calls.revise += 1;
      throw new Error('revise must not be called from a route');
    },
    restore: async ({ state }) => {
      calls.restore += 1;
      post.slide3 = state;
    },
    unschedule: async () => ({ ok: true, note: 'back to review' }),
  };
  return { desc, post, calls };
}

/** The real carousels and reels action layers over PGlite; every non-revision function must not be called. */
function registry(q: Query, itemId: string): () => Promise<Record<Vertical, ContentActions>> {
  const never = (name: string) => (async () => { throw new Error(`${name} must not be called`); }) as never;
  return async () => ({
    carousels: carouselActions({
      query: async () => q,
      itemId: async (_q, postId) => (postId === U ? itemId : null),
      approveSchedule: never('approveSchedule'), approvePost: never('approvePost'), rejectPost: never('rejectPost'),
      hardPublishPost: never('hardPublishPost'), requestRerun: never('requestRerun'), unschedulePost: never('unschedulePost'),
      placeItem: never('placeItem'), rescheduleItem: never('rescheduleItem'),
    }),
    reels: reelActions({
      query: q,
      itemId: async () => itemId,
      schedulePostIdea: never('schedulePostIdea'), rejectReel: never('rejectReel'), forcePost: never('forcePost'),
      unscheduleIdea: never('unscheduleIdea'), placeItem: never('placeItem'), rescheduleItem: never('rescheduleItem'),
      todaySlate: never('todaySlate'), findReelLock: never('findReelLock'), requestFinish: never('requestFinish'),
    }),
    explainers: { vertical: 'explainers' },
    stories: { vertical: 'stories' },
    last_few_days: { vertical: 'last_few_days' },
    ai_events: { vertical: 'ai_events' },
    field_notes: { vertical: 'field_notes' },
    reel_ai_drama: { vertical: 'reel_ai_drama' },
  });
}

async function withDb(fake: ReturnType<typeof fakeType>, fn: (ctx: { q: Query; itemId: string; actions: ReturnType<typeof registry> }) => Promise<void>) {
  const { q, itemId } = await setupRevisionsDb();
  clearRegistryForTest();
  // The verb refuses a type with no approved cap at submit (final wave), so the carousels fake gets one.
  setCapsForTest({ carousels: { wording: { capUsd: 0.2, ceilingUsd: 0.5 } } });
  try {
    registerDescription(fake.desc);
    await fn({ q, itemId, actions: registry(q, itemId) });
  } finally {
    restoreRegistryForTest();
    resetCapsForTest();
  }
}

/** One applied revision of slide 3, as the worker and engine would leave it. */
async function applied(q: Query, itemId: string, before: PartState, after: PartState) {
  const r = await createRequest(q, { vertical: 'carousels', refs: { postId: U }, itemId, by: 'tommy', instruction: 'shorter' });
  await claimNextRequested(q);
  const i: Interpretation = { vertical: 'carousels', part, fixKind: 'wording', stageTag: 'copy_write', instruction: 'shorter' };
  await markRunning(q, r.id, i, 0.2, 0.5);
  assert.equal(await markApplied(q, r.id, { before, after, costUsd: 0.01 }), true);
  return r.id;
}

test('the revise flag is on by default', () => {
  assert.equal(ACTION_FLAGS.includes('revise'), true);
  assert.equal(actionEnabled('revise'), true);
});

test('route is unreachable while the flag is off', async () => {
  const neverActions = (async () => { throw new Error('must not be called'); }) as never;
  const specs: Array<ActionSpec<any>> = [reviseContent(neverActions), undoRevisionContent(neverActions), continueRevisionContent(neverActions)];
  for (const spec of specs) {
    assert.equal(spec.flag, 'revise');
    let sessionRead = false;
    const POST = actionRoute(spec, { flags: ALL_OFF, session: async () => { sessionRead = true; return { email: 'x' }; } });
    const res = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'shorter' }));
    assert.equal(res.status, 404);
    assert.equal(sessionRead, false, 'no session read');
  }
});

test('revise inserts one requested row with the user\'s words and returns immediately', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ q, itemId, actions }) => {
    const POST = actionRoute(reviseContent(actions), on());
    const res = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'Make the slide 3 headline shorter' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, note: 'Revising…' });
    const rows = await listForItem(q, itemId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'requested');
    assert.equal(rows[0].instruction, 'Make the slide 3 headline shorter');
    assert.equal(rows[0].requestedBy, EMAIL);
    assert.equal(rows[0].vertical, 'carousels');
    assert.deepEqual(rows[0].refs, { postId: U });
    assert.equal(rows[0].parentId, null);
    assert.equal(fake.calls.revise, 0, 'the route never runs the revision itself');
  });
});

test('empty or over-length instruction is a 400', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ q, itemId, actions }) => {
    const POST = actionRoute(reviseContent(actions), on());
    for (const instruction of ['', '   ', 'x'.repeat(1001), 42, undefined]) {
      const res = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction }));
      assert.equal(res.status, 400, JSON.stringify(instruction));
    }
    // The verb refuses on its own too, when called without the route's parser.
    const verb = (await actions()).carousels.revise!;
    assert.equal((await verb({ postId: U }, EMAIL, { instruction: '  ' })).status, 400);
    assert.equal((await verb({ postId: U }, EMAIL, { instruction: 'y'.repeat(1001) })).status, 400);
    assert.equal((await verb({ postId: U }, EMAIL, { instruction: 'z'.repeat(1000) })).ok, true, '1000 characters is allowed');
    assert.equal((await listForItem(q, itemId)).length, 1);
  });
});

test('a published post is refused at submit with a clear note', async () => {
  for (const status of ['published', 'rejected'] as const) {
    const fake = fakeType(status);
    await withDb(fake, async ({ q, itemId, actions }) => {
      const POST = actionRoute(reviseContent(actions), on());
      const res = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'shorter' }));
      assert.equal(res.status, 409);
      assert.match((await res.json()).note, new RegExp(`carousels post is ${status}`));
      assert.equal((await listForItem(q, itemId)).length, 0);
    });
  }
});

test('a type with no description yet is refused with its label', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ q, itemId, actions }) => {
    const POST = actionRoute(reviseContent(actions), on());
    const res = await POST(req({ vertical: 'reels', refs: { videoJobId: U }, instruction: 'shorter' }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).note, 'Revisions are not available for text on screen yet.');
    assert.equal((await listForItem(q, itemId)).length, 0);
  });
});

test('a post that is gone is refused', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ actions }) => {
    const POST = actionRoute(reviseContent(actions), on());
    const res = await POST(req({ vertical: 'carousels', refs: { postId: W }, instruction: 'shorter' }));
    assert.equal(res.status, 409);
    assert.match((await res.json()).note, /gone/);
  });
});

test('a reply with parentId links to the earlier row', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ q, itemId, actions }) => {
    const first = await createRequest(q, { vertical: 'carousels', refs: { postId: U }, itemId, by: EMAIL, instruction: 'fix it' });
    await q(`UPDATE revisions.requests SET status = 'asking', question = 'Which slide?' WHERE id = $1`, [first.id]);
    const POST = actionRoute(reviseContent(actions), on());
    const res = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'slide 3', parentId: first.id }));
    assert.equal(res.status, 200);
    const reply = (await listForItem(q, itemId)).find((r) => r.id !== first.id)!;
    assert.equal(reply.parentId, first.id);
    assert.equal(reply.status, 'requested');
    assert.equal(reply.instruction, 'slide 3');

    // A parentId that is not a uuid, or not a question on this post, is a 400.
    assert.equal((await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'x', parentId: 'nope' }))).status, 400);
    assert.equal((await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'x', parentId: W }))).status, 400);
    assert.equal((await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'x', parentId: reply.id }))).status, 400, 'the parent must be asking');
    assert.equal((await listForItem(q, itemId)).length, 2);

    // A second reply to the same question is refused, so it cannot start a second run.
    const again = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'slide 3 please', parentId: first.id }));
    assert.equal(again.status, 409);
    assert.equal((await again.json()).note, 'That question was already answered.');
    assert.equal((await listForItem(q, itemId)).length, 2);
  });
});

test('undoRevision and continueRevision call the engine with the user\'s email', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ q, itemId, actions }) => {
    const v0 = { copy: 'v0', files: ['slide3-v0.png'] };
    const v1 = { copy: 'v1', files: ['slide3-v1.png'] };
    const v2 = { copy: 'v2', files: ['slide3-v2.png'] };
    const first = await applied(q, itemId, v0, v1);
    const second = await applied(q, itemId, v1, v2);
    fake.post.slide3 = v2;

    const UNDO = actionRoute(undoRevisionContent(actions), on());
    const undone = await UNDO(req({ vertical: 'carousels', refs: { postId: U }, part }));
    assert.equal(undone.status, 200);
    assert.match((await undone.json()).note, /Undid the last revision of slide 3/);
    let rows = await listForItem(q, itemId);
    assert.equal(rows.find((r) => r.id === second)?.status, 'undone');
    assert.equal(rows.find((r) => r.id === second)?.undoneBy, EMAIL);
    assert.deepEqual(fake.post.slide3, v1);

    // original: true restores the pipeline's original (restoreOriginal).
    const restored = await UNDO(req({ vertical: 'carousels', refs: { postId: U }, part, original: true }));
    assert.equal(restored.status, 200);
    rows = await listForItem(q, itemId);
    assert.equal(rows.find((r) => r.id === first)?.undoneBy, EMAIL);
    assert.deepEqual(fake.post.slide3, v0);

    // Nothing left to undo: the engine's refusal comes back as a 409.
    const nothing = await UNDO(req({ vertical: 'carousels', refs: { postId: U }, part }));
    assert.equal(nothing.status, 409);
    assert.equal((await UNDO(req({ vertical: 'carousels', refs: { postId: U } }))).status, 400, 'part is required');
    assert.equal((await UNDO(req({ vertical: 'carousels', refs: { postId: U }, part: { kind: '', key: '3' } }))).status, 400);

    // Continue a paused row.
    const paused = await createRequest(q, { vertical: 'carousels', refs: { postId: U }, itemId, by: 'tommy', instruction: 'new photo' });
    await claimNextRequested(q);
    await markEnded(q, paused.id, 'paused_at_cap', 'over cap', 0);
    const CONT = actionRoute(continueRevisionContent(actions), on());
    assert.equal((await CONT(req({ vertical: 'carousels', refs: { postId: U }, revisionId: paused.id, overrideUsd: 0 }))).status, 400);
    assert.equal((await CONT(req({ vertical: 'carousels', refs: { postId: U }, revisionId: paused.id, overrideUsd: -1 }))).status, 400);
    assert.equal((await CONT(req({ vertical: 'carousels', refs: { postId: U }, revisionId: paused.id }))).status, 400);
    assert.equal((await CONT(req({ vertical: 'carousels', refs: { postId: U }, revisionId: 'nope', overrideUsd: 1 }))).status, 400);
    assert.equal((await CONT(req({ vertical: 'carousels', refs: { postId: U }, revisionId: W, overrideUsd: 1 }))).status, 404, 'not a revision of this post');
    const cont = await CONT(req({ vertical: 'carousels', refs: { postId: U }, revisionId: paused.id, overrideUsd: 1.5 }));
    assert.equal(cont.status, 200);
    const row = (await listForItem(q, itemId)).find((r) => r.id === paused.id)!;
    assert.equal(row.status, 'requested');
    assert.equal(row.overrideUsd, 1.5);
    assert.match(row.note!, new RegExp(`Continued by ${EMAIL}`));
    assert.equal(fake.calls.revise, 0);
  });
});

/* ── Final wave: no paid interpretation without a cap ── */

test('a type with no approved cap is refused at submit with a 409 and the plain note; no row is inserted', async () => {
  const fake = fakeType();
  await withDb(fake, async ({ q, itemId, actions }) => {
    const POST = actionRoute(reviseContent(actions), on());
    for (const caps of [{}, { carousels: null }, { carousels: {} }, { reels: { wording: { capUsd: 1, ceilingUsd: 2 } } }]) {
      setCapsForTest(caps);
      const res = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'Make the slide 3 headline shorter' }));
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { ok: false, note: 'There is no approved cap for carousels yet, so nothing was run.', status: 409 });
    }
    assert.equal((await listForItem(q, itemId)).length, 0);
    // A cap present: it flows as before.
    setCapsForTest({ carousels: { photo: { capUsd: 0.2, ceilingUsd: 0.5 } } });
    const ok = await POST(req({ vertical: 'carousels', refs: { postId: U }, instruction: 'Make the slide 3 headline shorter' }));
    assert.equal(ok.status, 200);
    assert.equal((await listForItem(q, itemId)).length, 1);
  });
});

test('no cap for reels: the note says "text on screen"', async () => {
  const fake = fakeType();
  const reels = { ...fake, desc: { ...fake.desc, vertical: 'reels' as const } };
  await withDb(reels, async ({ actions }) => {
    setCapsForTest({});
    const POST = actionRoute(reviseContent(actions), on());
    const res = await POST(req({ vertical: 'reels', refs: { videoJobId: U }, instruction: 'shorter' }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).note, 'There is no approved cap for text on screen yet, so nothing was run.');
  });
});
