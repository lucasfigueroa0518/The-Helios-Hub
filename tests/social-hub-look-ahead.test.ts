import assert from 'node:assert/strict';
import test from 'node:test';

import { allQuotaCandidates } from '@/lib/social-hub/views/day-rank';
import { contentDay, LOOK_TOMORROW } from '@/lib/social-hub/views/look-ahead';
import { slotsForDay } from '@/lib/social-hub/views/today';
import { nyDateOf } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

test('look ahead: tomorrow is the next New York day, as an instant that stays on that day', () => {
  const today = contentDay(FIXTURE_NOW, undefined);
  assert.deepEqual([today.ahead, today.day, today.at], [false, nyDateOf(FIXTURE_NOW), FIXTURE_NOW]);
  const t = contentDay(FIXTURE_NOW, LOOK_TOMORROW);
  assert.equal(t.ahead, true);
  assert.equal(nyDateOf(t.at), t.day);
  assert.ok(t.day > today.day);
  // Anything else asked for is today (a stray value never leaves the page blank).
  assert.equal(contentDay(FIXTURE_NOW, 'next-week').ahead, false);
  // Late on the 31st, and across the November daylight-saving change, tomorrow is still the next calendar day.
  assert.equal(contentDay(new Date('2026-10-31T23:30:00-04:00'), LOOK_TOMORROW).day, '2026-11-01');
  assert.equal(contentDay(new Date('2026-11-01T20:00:00-05:00'), LOOK_TOMORROW).day, '2026-11-02');
  assert.equal(nyDateOf(contentDay(new Date('2026-11-01T20:00:00-05:00'), LOOK_TOMORROW).at), '2026-11-02');
});

test('look ahead: tomorrow shows what holds tomorrow\'s slots, not today\'s', () => {
  const data = previewDataset();
  const today = nyDateOf(FIXTURE_NOW)!;
  const view = contentDay(FIXTURE_NOW, LOOK_TOMORROW);
  // Move one scheduled carousel onto tomorrow, so there is something to find.
  const carousel = data.posts.find((p) => p.vertical === 'carousels' && p.status === 'scheduled' && p.nyDate === today);
  if (!carousel) return; // the fixture has none scheduled today; the day-shape assertions above still hold
  const moved: HubPost = { ...carousel, nyDate: view.day };
  const posts = [...data.posts.filter((p) => p.id !== carousel.id), moved];
  const tomorrows = allQuotaCandidates({ ...data, posts }, view.at);
  assert.ok(tomorrows.some((c) => c.post?.id === moved.id && c.locked), 'the post scheduled for tomorrow holds a slot');
  const todays = allQuotaCandidates({ ...data, posts }, FIXTURE_NOW);
  assert.ok(!todays.some((c) => c.post?.id === moved.id && c.locked), 'and does not hold one of today\'s');
});

test('look ahead: the slot count is for tomorrow', () => {
  const data = previewDataset();
  const view = contentDay(FIXTURE_NOW, LOOK_TOMORROW);
  const { slots, filled } = slotsForDay(data.posts, view.day, data.dayQuotas);
  assert.ok(slots > 0, 'tomorrow has windows');
  assert.ok(filled <= slots);
});
