import assert from 'node:assert/strict';
import test from 'node:test';

import { isDataWarmablePath, normalizeWarmPath } from '@/lib/hub/warm-paths';

test('warm paths reject open redirects and normalize trailing slashes', () => {
  assert.equal(normalizeWarmPath('/social/'), '/social');
  assert.equal(normalizeWarmPath('//evil.example/social'), null);
  assert.equal(normalizeWarmPath('/social\\evil'), null);
});

test('data warm covers home and social hub, not render or trello', () => {
  assert.equal(isDataWarmablePath('/'), true);
  assert.equal(isDataWarmablePath('/social'), true);
  assert.equal(isDataWarmablePath('/social/calendar'), true);
  assert.equal(isDataWarmablePath('/social/analytics/reels'), true);
  assert.equal(isDataWarmablePath('/social/render/foo'), false);
  assert.equal(isDataWarmablePath('/trello'), false);
  assert.equal(isDataWarmablePath('/dashboards'), false);
});
