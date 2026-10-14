/**
 * Each Today's Content card's buttons (spec §2, offline). Needs you: Approve +
 * Schedule/Reschedule, Post now, Regenerate, Reject. Approved/scheduled:
 * Reschedule, Unschedule, Post now, Reject. Failed: Try again + what's left.
 * Nothing on posting, posted or being made. Only Post now, Regenerate and
 * Reject ask first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTION_FLAGS, type ActionFlag } from '@/lib/social-hub/flags';
import { actionsFor } from '@/lib/social-hub/house';
import type { HubPost } from '@/lib/social-hub/types';
import { cardActions } from '@/lib/social-hub/views/card-actions';
import { postState } from '@/lib/social-hub/views/state';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const d = previewDataset();
const ON = Object.fromEntries(ACTION_FLAGS.map((f) => [f, true])) as Record<ActionFlag, boolean>;
const OFF = Object.fromEntries(ACTION_FLAGS.map((f) => [f, false])) as Record<ActionFlag, boolean>;
const card = (post: HubPost, on = ON) => cardActions(postState(post, FIXTURE_NOW), actionsFor(post, { quota: null, typicalCostLabel: '$1.00' }), on);
const keys = (c: ReturnType<typeof card>) => [c.primary?.key ?? null, ...c.grid.map((a) => a.key)];
const find = (pred: (p: HubPost) => boolean) => {
  const p = d.posts.find(pred);
  assert.ok(p, 'fixture has this post');
  return p!;
};

test('needs you, no slot: Approve, then Schedule, Post now, Regenerate, Reject', () => {
  const post = find((p) => p.vertical === 'carousels' && p.status === 'ready' && postState(p, FIXTURE_NOW).id === 'needs_you');
  const c = card(post);
  assert.equal(c.primary?.label, 'Approve');
  assert.deepEqual(c.grid.map((a) => a.label), ['Schedule', 'Post now', 'Regenerate', 'Reject']);
});

test('needs you, slot booked: Approve, then Reschedule (not Schedule), and no Unschedule', () => {
  const post = find((p) => p.status === 'scheduled' && postState(p, FIXTURE_NOW).id === 'needs_you' && (p.vertical === 'carousels' || p.vertical === 'reels'));
  const c = card(post);
  assert.equal(c.primary?.label, 'Approve');
  assert.ok(c.grid.some((a) => a.label === 'Reschedule'));
  assert.ok(!c.grid.some((a) => a.key === 'unschedule' || a.key === 'place'));
});

test('approved and scheduled: Reschedule, Unschedule, Post now, Reject; no Approve', () => {
  const post = find((p) => p.status === 'scheduled' && postState(p, FIXTURE_NOW).id === 'scheduled');
  const c = card(post);
  assert.equal(c.primary, null);
  const order = ['reschedule', 'unschedule', 'hardPublish', 'reject'];
  const idx = c.grid.map((a) => order.indexOf(a.key));
  assert.ok(idx.every((i) => i >= 0), 'only these buttons');
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'in this order');
  assert.ok(c.grid.some((a) => a.key === 'unschedule'), 'Unschedule stays (D7)');
});

test('posted, posting and being made: no buttons', () => {
  for (const status of ['published', 'publishing', 'generating'] as const) {
    const post = d.posts.find((p) => p.status === status);
    if (!post) continue;
    assert.deepEqual(keys(card(post)), [null], status);
  }
});

test('only Post now, Regenerate and Reject ask first; Approve, Schedule and Unschedule are one click', () => {
  const posts = d.posts.filter((p) => ['ready', 'scheduled'].includes(p.status));
  for (const post of posts) {
    const c = card(post);
    for (const a of [c.primary, ...c.grid].filter(Boolean)) {
      const asks = a!.key === 'hardPublish' || a!.key === 'hardRegenerate' || a!.key === 'reject';
      assert.equal(Boolean(a!.plan.confirm), asks, `${post.vertical} ${a!.key}`);
    }
  }
});

test('every card button turns off with its flag; Delete is never offered', () => {
  for (const post of d.posts) {
    assert.deepEqual(keys(card(post, OFF)), [null]);
    assert.ok(!card(post).grid.some((a) => (a.key as string) === 'delete'));
  }
});

test('explainers can be rejected from the card', () => {
  const post = find((p) => p.vertical === 'explainers' && p.status === 'ready' && postState(p, FIXTURE_NOW).id === 'needs_you');
  const reject = card(post).grid.find((a) => a.key === 'reject');
  assert.ok(reject);
  assert.deepEqual((reject!.plan.body as { refs: Record<string, string> }).refs, { jobId: post.refs.jobId });
});
