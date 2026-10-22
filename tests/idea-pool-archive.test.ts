/**
 * Archive (idea pool standard, 2026-10-21), offline: a queue type's card offers Approve, Regenerate and Archive and
 * nothing else; Archive rejects the post through the type's verb, then archives its idea, once; a refused reject
 * archives nothing; a bad idea id is a bad request.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { archiveContent } from '@/app/api/social-hub/actions/archive/handler';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { ACTION_FLAGS, type ActionFlag } from '@/lib/social-hub/flags';
import { actionsFor } from '@/lib/social-hub/house';
import type { Vertical } from '@/lib/social-hub/types';
import { cardActions } from '@/lib/social-hub/views/card-actions';
import { postState } from '@/lib/social-hub/views/state';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const ON = Object.fromEntries(ACTION_FLAGS.map((f) => [f, true])) as Record<ActionFlag, boolean>;
const d = previewDataset();
const post = d.posts.find((p) => p.vertical === 'explainers' && (p.status === 'ready' || p.status === 'scheduled'));

test('a queue type’s card: Regenerate and Archive, no Reject, Schedule, Post now or Unschedule', { skip: !post }, () => {
  const plans = actionsFor(post!, { quota: null, typicalCostLabel: '$1.00', archive: { ideaId: 'explainers:topic:a' } });
  const c = cardActions(postState(post!, FIXTURE_NOW), plans, ON);
  assert.deepEqual(c.grid.map((a) => a.label), ['Regenerate', 'Archive']);
  assert.ok(!plans.some((p) => p.kind === 'post' && p.action === 'reject'), 'Archive replaces Reject');
  const archive = c.grid.find((a) => a.key === 'archive')!;
  assert.equal(archive.danger, true);
  assert.equal(archive.confirmTitle, 'Archive this post?');
  assert.equal((archive.plan as { endpoint: string }).endpoint, '/api/social-hub/actions/archive');
  assert.equal((archive.plan as { body: Record<string, unknown> }).body.ideaId, 'explainers:topic:a');
});

test('the other types keep Reject until they are converted', () => {
  const carousel = d.posts.find((p) => p.vertical === 'carousels' && p.status === 'ready');
  assert.ok(carousel);
  const plans = actionsFor(carousel!, { quota: null, typicalCostLabel: '$1.00' });
  assert.ok(plans.some((p) => p.kind === 'post' && p.action === 'reject'));
  assert.ok(!plans.some((p) => p.kind === 'post' && p.action === 'archive'));
});

const UUID = '11111111-1111-4111-8111-111111111111';
const actions = (reject: ContentActions['reject']) => async () => ({ explainers: { vertical: 'explainers', reject } }) as unknown as Record<Vertical, ContentActions>;
const body = (over: Record<string, unknown> = {}) => ({ vertical: 'explainers', refs: { jobId: UUID }, ideaId: 'explainers:topic:abc', ...over });

test('Archive rejects the post, then archives its idea', async () => {
  const calls: string[] = [];
  const spec = archiveContent(
    actions(async (t, by) => (calls.push(`reject ${t.jobId} by ${by}`), { ok: true, note: 'Rejected.' })),
    async (v, id, by) => void calls.push(`archive ${v} ${id} by ${by}`),
  );
  const parsed = spec.parse(body())!;
  assert.deepEqual(await spec.run(parsed, { email: 'tommy@x' }), { ok: true, note: 'Archived. It won’t post, and the idea won’t come back.' });
  assert.deepEqual(calls, [`reject ${UUID} by tommy@x`, 'archive explainers explainers:topic:abc by tommy@x']);
});

test('a refused reject (posting or posted) archives nothing', async () => {
  const calls: string[] = [];
  const spec = archiveContent(actions(async () => ({ ok: false, note: 'It has posted.', status: 409 })), async () => void calls.push('archive'));
  const out = await spec.run(spec.parse(body())!, { email: 't' });
  assert.equal(out.ok, false);
  assert.deepEqual(calls, []);
});

test('an idea that is gone still archives the post; another type’s or a malformed idea id is a bad request', async () => {
  const calls: string[] = [];
  const spec = archiveContent(actions(async () => ({ ok: true, note: 'ok' })), async () => void calls.push('archive'));
  assert.equal((await spec.run(spec.parse(body({ ideaId: null }))!, { email: 't' })).ok, true);
  assert.deepEqual(calls, []);
  assert.equal(spec.parse(body({ ideaId: 'reels:idea:abc' })), null);
  assert.equal(spec.parse(body({ ideaId: 'nonsense' })), null);
  assert.equal(spec.parse(body({ refs: { jobId: 'not-a-uuid' } })), null);
});
