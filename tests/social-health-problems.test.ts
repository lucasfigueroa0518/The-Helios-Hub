import assert from 'node:assert/strict';
import test from 'node:test';

import { bestStreak, cleanStreak, groupProblems } from '@/lib/social-hub/health/problems';
import { carouselReason, reasonFor, REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import { nightsEnding } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

test('raw errors map to reason codes; unknown text keeps its raw error under other', () => {
  assert.equal(reasonFor('render', 'Request timed out after 120s'), 'timeout');
  assert.equal(reasonFor('publish', 'Meta returned 500 Internal Server Error'), 'service_5xx');
  assert.equal(reasonFor('build', 'monthly watch reached (25)'), 'cap_hit');
  assert.equal(reasonFor('frame', 'copy_does_not_fit'), 'too_long');
  assert.equal(reasonFor('copy', 'unexpected token in JSON at position 4'), 'malformed_output');
  assert.equal(reasonFor('x', 'something brand new'), 'other');
  assert.equal(reasonFor('x', null), 'other');
});

test('carousel reason codes normalize and have labels', () => {
  assert.equal(carouselReason('over-limit'), 'too_long');
  assert.equal(carouselReason('cost-cap'), 'cap_hit');
  assert.equal(carouselReason('render-failed'), 'render_failed');
  for (const code of ['too_long', 'cap_hit', 'render_failed', 'other']) assert.ok(REASON_LABEL[code]);
  assert.equal(stageLabel('writer'), 'Writer');
  assert.equal(stageLabel('jev-scoring'), 'Scoring');
  assert.equal(stageLabel('some_new_stage'), 'Some new stage');
});

const ev = (night: string, over: Partial<FailureEvent> = {}): FailureEvent => ({
  vertical: 'carousels', night, at: `${night}T07:14:00Z`, stage: 'writer', reason: 'too_long', severity: 'failed', ...over,
});

test('one problem per vertical+stage+reason, counted by nights, newest first', () => {
  const window = nightsEnding('2026-10-13', 14);
  const problems = groupProblems([
    ev('2026-10-03'), ev('2026-10-08'), ev('2026-10-13'), ev('2026-10-13', { at: '2026-10-13T07:15:00Z' }),
    ev('2026-10-12', { vertical: 'explainers', stage: 'publish', reason: 'service_5xx', severity: 'healed' }),
  ], window);
  assert.equal(problems.length, 2);
  const writer = problems[0]!;
  assert.equal(writer.key, 'carousels|writer|too_long');
  assert.equal(writer.count, 3);
  assert.equal(writer.firstSeen, '2026-10-03');
  assert.equal(writer.lastSeen, '2026-10-13');
  assert.equal(writer.tone, 'current');
  assert.equal(writer.backAgain, true); // gap of 4 quiet nights before 10-13
  assert.equal(problems[1]!.tone, 'quiet');
});

test('quiet 6 nights is almost, 7 is fixed; back again needs a 3-night gap', () => {
  const window = nightsEnding('2026-10-13', 14);
  const [almost] = groupProblems([ev('2026-10-07')], window);
  assert.equal(almost!.quietNights, 6);
  assert.equal(almost!.state, 'almost');
  const [fixed] = groupProblems([ev('2026-10-06')], window);
  assert.equal(fixed!.state, 'fixed');
  const [close] = groupProblems([ev('2026-10-11'), ev('2026-10-13')], window);
  assert.equal(close!.backAgain, false);
});

test('streaks count trailing worked nights and skip grey nights', () => {
  assert.equal(cleanStreak(['failed', 'worked', 'none', 'worked', 'worked']), 3);
  assert.equal(cleanStreak(['worked', 'short']), 0);
  assert.equal(bestStreak(['worked', 'worked', 'failed', 'worked']), 2);
});
