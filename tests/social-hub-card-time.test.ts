/**
 * The time line on a Today's Content card (B4): a Stories set waiting for
 * Approve says when its window is, since Stories book only at Approve.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubPost } from '@/lib/social-hub/types';
import { cardTimeLine } from '@/lib/social-hub/views/card-time';
import { clock } from '@/lib/social-hub/views/format';

import { previewDataset } from './fixtures/social-hub/preview-dataset';

const d = previewDataset();
const base = (vertical: HubPost['vertical']) => {
  const p = d.posts.find((x) => x.vertical === vertical);
  assert.ok(p, `fixture has a ${vertical} post`);
  return p!;
};

test('a Stories set waiting for Approve says when it would post (B4)', () => {
  const s = base('stories');
  const waiting: HubPost = { ...s, status: 'ready', publishAt: null, postedAt: null, approval: { ...s.approval, approvedAt: null }, idea: { id: 'stories:morning_download:2026-10-09', label: 'Morning Download' } };
  assert.equal(cardTimeLine(waiting, new Date('2026-10-09T12:00:00Z')), 'No slot yet · posts 8:30–10:00 AM once approved');
  assert.equal(cardTimeLine({ ...waiting, approval: { ...waiting.approval, approvedAt: '2026-10-09T15:00:00Z' } }, new Date('2026-10-09T12:00:00Z')), 'No slot yet', 'approved after its window: no promise');
});

test('a Stories set whose window has closed today says plain No slot yet', () => {
  const s = base('stories');
  const waiting: HubPost = { ...s, status: 'ready', publishAt: null, postedAt: null, approval: { ...s.approval, approvedAt: null }, idea: { id: 'stories:morning_download:2026-10-09', label: 'Morning Download' } };
  assert.equal(cardTimeLine(waiting, new Date('2026-10-09T13:59:00Z')), 'No slot yet · posts 8:30–10:00 AM once approved', '9:59 AM NY: still open');
  assert.equal(cardTimeLine(waiting, new Date('2026-10-09T14:00:00Z')), 'No slot yet', '10:00 AM NY: closed');
  assert.equal(cardTimeLine(waiting, new Date('2026-10-09T20:00:00Z')), 'No slot yet', 'afternoon: closed');
});

const NOW = new Date('2026-10-09T12:00:00Z');

test('other cards: their time, Being made, or No slot yet', () => {
  const r = base('reels');
  assert.equal(cardTimeLine({ ...r, status: 'ready', publishAt: null, postedAt: null }, NOW), 'No slot yet');
  assert.equal(cardTimeLine({ ...r, status: 'generating', publishAt: null, postedAt: null }, NOW), 'Being made');
  assert.equal(cardTimeLine({ ...r, status: 'scheduled', publishAt: '2026-10-09T13:05:00Z', postedAt: null }, NOW), clock('2026-10-09T13:05:00Z'));
});
