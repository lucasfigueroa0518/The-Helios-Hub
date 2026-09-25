import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_STAGE_ATTEMPTS, nextFinishAction, type FinishProgress } from '@/lib/reels/visual/finish';

function progress(partial: Partial<FinishProgress>): FinishProgress {
  return { copy: 'missing', frame: 'missing', video: 'missing', ...partial };
}

test('whole generation starts at the first missing stage', () => {
  assert.equal(nextFinishAction(progress({})), 'copy');
  assert.equal(nextFinishAction(progress({ copy: 'ok' })), 'frame');
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'ok' })), 'video');
});

test('whole generation waits while any stage is in flight', () => {
  assert.equal(nextFinishAction(progress({ copy: 'in_flight' })), 'wait');
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'in_flight' })), 'wait');
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'ok', video: 'in_flight' })), 'wait');
});

test('a failed stage is retried until it runs out of attempts', () => {
  const tries = (n: number) => ({ copy: n, frame: n, video: n });
  assert.equal(nextFinishAction(progress({ copy: 'failed' }), tries(1)), 'copy');
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'failed' }), tries(2)), 'frame');
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'ok', video: 'failed' }), tries(1)), 'video');
  assert.equal(nextFinishAction(progress({ copy: 'failed' }), tries(MAX_STAGE_ATTEMPTS)), 'failed');
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'ok', video: 'failed' }), tries(MAX_STAGE_ATTEMPTS)), 'failed');
});

test('a finished video ends the walk', () => {
  assert.equal(nextFinishAction(progress({ copy: 'ok', frame: 'ok', video: 'ok' })), 'done');
  assert.equal(nextFinishAction(progress({ copy: 'failed', video: 'ok' })), 'done');
});
