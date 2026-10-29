/**
 * Targeted Revisions task 12: the read route the revision box polls
 * (GET /api/social-hub/actions/revisions), on PGlite through the real carousels
 * action layer (offline, no model calls). Mirrors tests/revisions-actions.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { revisionsRead } from '@/app/api/social-hub/actions/revisions/handler';
import { carouselActions } from '@/lib/publishing/actions/carousels';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { claimNextRequested, createRequest, markApplied, markRunning } from '@/lib/revisions/store';
import type { Interpretation } from '@/lib/revisions/types';
import { actionReadRoute, type ActionEnv } from '@/lib/social-hub/action-route';
import { ACTION_FLAGS, SOCIAL_HUB_FLAGS, type HubFlags } from '@/lib/social-hub/flags';
import type { Query } from '@/lib/social/store/pg';
import type { Vertical } from '@/lib/social-hub/types';

import { setupRevisionsDb } from './fixtures/revisions/pglite';

const U = '0b7f2c4e-1111-4a5b-9c9d-0123456789ab';
const W = '2d9f4e6a-3333-4c7d-9e1f-2345678901cd';
const EMAIL = 'lucas@helios.test';
const ALL_ON: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, true])) as HubFlags['actions'] };
const ALL_OFF: HubFlags = { views: SOCIAL_HUB_FLAGS.views, actions: Object.fromEntries(ACTION_FLAGS.map((f) => [f, false])) as HubFlags['actions'] };
const on = (extra: Partial<ActionEnv> = {}): ActionEnv => ({ flags: ALL_ON, session: async () => ({ email: EMAIL }), revalidate: () => {}, ...extra });
const get = (qs: string) => new Request(`http://hub.test/api/social-hub/actions/revisions?${qs}`, { method: 'GET' });
const part = { kind: 'slide', key: '3' };

function registry(q: Query, itemId: string, calls = { query: 0 }): () => Promise<Record<Vertical, ContentActions>> {
  const never = (name: string) => (async () => { throw new Error(`${name} must not be called`); }) as never;
  return async () => ({
    carousels: carouselActions({
      query: async () => { calls.query += 1; return q; },
      itemId: async (_q, postId) => (postId === U ? itemId : null),
      approveSchedule: never('approveSchedule'), approvePost: never('approvePost'), rejectPost: never('rejectPost'),
      hardPublishPost: never('hardPublishPost'), requestRerun: never('requestRerun'), unschedulePost: never('unschedulePost'),
      placeItem: never('placeItem'), rescheduleItem: never('rescheduleItem'),
    }),
    reels: { vertical: 'reels' },
    explainers: { vertical: 'explainers' },
    stories: { vertical: 'stories' },
    last_few_days: { vertical: 'last_few_days' },
    ai_events: { vertical: 'ai_events' },
  });
}

test('unreachable while the revise flag is off: 404, no session read, no DB read', async () => {
  let sessionRead = false;
  const neverActions = (async () => { throw new Error('must not be called'); }) as never;
  const GET = actionReadRoute(revisionsRead(neverActions), { flags: ALL_OFF, session: async () => { sessionRead = true; return { email: 'x' }; } });
  const res = await GET(get(`vertical=carousels&postId=${U}`));
  assert.equal(res.status, 404);
  assert.equal(sessionRead, false);
  // The shipped flags (revise off) too.
  const shipped = actionReadRoute(revisionsRead(neverActions), { session: async () => ({ email: 'x' }) });
  assert.equal((await shipped(get(`vertical=carousels&postId=${U}`))).status, 404);
});

test('needs a session like the sibling routes', async () => {
  const neverActions = (async () => { throw new Error('must not be called'); }) as never;
  const GET = actionReadRoute(revisionsRead(neverActions), on({ session: async () => null }));
  assert.equal((await GET(get(`vertical=carousels&postId=${U}`))).status, 401);
});

test('validates the vertical and the refs', async () => {
  const neverActions = (async () => { throw new Error('must not be called'); }) as never;
  const GET = actionReadRoute(revisionsRead(neverActions), on());
  for (const qs of ['', `postId=${U}`, `vertical=nope&postId=${U}`, 'vertical=carousels', 'vertical=carousels&postId=not-a-uuid', `vertical=carousels&post-id%3B=${U}`]) {
    assert.equal((await GET(get(qs))).status, 400, qs);
  }
});

test('returns only the safe fields of the item\'s rows, newest first', async () => {
  const { q, itemId } = await setupRevisionsDb();
  const first = await createRequest(q, { vertical: 'carousels', refs: { postId: U }, itemId, by: 'tommy@helios.test', instruction: 'shorter' });
  await claimNextRequested(q);
  const i: Interpretation = { vertical: 'carousels', part, fixKind: 'wording', stageTag: 'copy_write', instruction: 'shorter' };
  await markRunning(q, first.id, i, 0.2, 0.5);
  await markApplied(q, first.id, { before: { copy: 'old', files: ['a.png'] }, after: { copy: 'new', files: ['b.png'] }, costUsd: 0.01 });
  await new Promise((r) => setTimeout(r, 5));
  const second = await createRequest(q, { vertical: 'carousels', refs: { postId: U }, itemId, by: 'tommy@helios.test', instruction: 'brighter photo' });

  const GET = actionReadRoute(revisionsRead(registry(q, itemId)), on());
  const res = await GET(get(`vertical=carousels&postId=${U}`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  const body = (await res.json()) as { ok: boolean; rows: Array<Record<string, unknown>> };
  assert.equal(body.ok, true);
  assert.deepEqual(body.rows.map((r) => r.id), [second.id, first.id]);
  assert.equal(body.rows[1]!.status, 'applied');
  assert.deepEqual(body.rows[1]!.part, part);
  for (const r of body.rows) {
    for (const hidden of ['refs', 'requestedBy', 'before', 'after', 'interpretation', 'itemId', 'undoneBy', 'vertical']) assert.equal(hidden in r, false, hidden);
  }
  assert.equal(JSON.stringify(body).includes('tommy@'), false);
});

test('a post that is gone answers 404 with a plain note', async () => {
  const { q, itemId } = await setupRevisionsDb();
  const GET = actionReadRoute(revisionsRead(registry(q, itemId)), on());
  const res = await GET(get(`vertical=carousels&postId=${W}`));
  assert.equal(res.status, 404);
  assert.match(((await res.json()) as { note: string }).note, /gone/);
});

test('a type without the read answers 409 with no rows', async () => {
  const { q, itemId } = await setupRevisionsDb();
  const GET = actionReadRoute(revisionsRead(registry(q, itemId)), on());
  const res = await GET(get(`vertical=stories&setId=${U}`));
  assert.equal(res.status, 409);
});

test('refresh=1 drops the type\'s cached hub read so the revised preview shows; a plain poll does not', async () => {
  const { q, itemId } = await setupRevisionsDb();
  const tags: string[] = [];
  const GET = actionReadRoute(revisionsRead(registry(q, itemId)), on({ revalidate: (t) => tags.push(t) }));
  await GET(get(`vertical=carousels&postId=${U}`));
  assert.deepEqual(tags, []);
  await GET(get(`vertical=carousels&postId=${U}&refresh=1`));
  assert.deepEqual(tags, ['social-hub:data:carousels']);
});

test('a database failure is a plain note, never the raw error', async () => {
  const { itemId } = await setupRevisionsDb();
  const broken: Query = (async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:6543'); }) as never;
  const GET = actionReadRoute(revisionsRead(registry(broken, itemId)), on());
  const res = await GET(get(`vertical=carousels&postId=${U}`));
  assert.equal(res.status, 500);
  const note = ((await res.json()) as { note: string }).note;
  assert.doesNotMatch(note, /ECONNREFUSED/);
});
