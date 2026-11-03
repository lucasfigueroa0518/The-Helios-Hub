/**
 * The nightly idea-pool refresh: scoring without making. Offline only: stubbed stages, no Claude, no Jev, no DB.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { poolRunDue } from '@/lib/social/overnight/pool';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import type { StageName } from '@/lib/social/pipeline/types';

test('a score-only run scores once, makes nothing, and says it scored', async () => {
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const r = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages({ calls }),
    meter: createCostMeter({}),
    log: createInMemorySetAsideLog(),
    now: new Date('2026-10-04T15:00:00Z'),
    targetPosts: 0,
    scoreOnly: true,
  });
  assert.equal(r.stopReason, 'scored');
  assert.equal(r.posts.length, 0);
  assert.equal(r.shipped.length, 0);
  assert.deepEqual(calls.map((c) => c.stage), ['jev-scoring']);
});

test('the pool refresh is queued only when the carousel run is not', () => {
  assert.equal(poolRunDue('none', true), true);
  assert.equal(poolRunDue('none', false), false);
  assert.equal(poolRunDue('carousels', true), false);
  assert.equal(poolRunDue('last_few_days', true), false);
});
