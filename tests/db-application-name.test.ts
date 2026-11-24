/** Each process's DB connections are named for the service that holds them (perf/db/prod-diagnose.sql). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applicationName } from '@/lib/db';

test('connections are named per service', () => {
  assert.equal(applicationName({ VERCEL: '1' }, []), 'helios-web');
  assert.equal(applicationName({}, ['node', 'scripts/reels_worker.ts']), 'helios-reels');
  assert.equal(applicationName({}, ['node', 'scripts/orchestration_worker.ts']), 'helios-worker');
  assert.equal(applicationName({ npm_lifecycle_event: 'worker' }, ['node', 'x.ts']), 'helios-worker');
  assert.equal(applicationName({ npm_lifecycle_event: 'social:worker' }, ['node', 'x.ts']), 'helios-social-worker');
  assert.equal(applicationName({ npm_lifecycle_event: 'reel-ai-drama:worker' }, ['node', 'x.ts']), 'helios-reel-ai-drama-worker');
  assert.equal(applicationName({}, ['/usr/bin/tsx', 'scripts/publisher_worker.ts']), 'helios-publisher-worker');
  assert.equal(applicationName({}, ['node', 'next', 'start']), 'helios-node');
});
