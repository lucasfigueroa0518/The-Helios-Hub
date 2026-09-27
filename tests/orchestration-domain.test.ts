import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIND_CONFIG,
  laneLimit,
  workerMaxConcurrency,
} from '@/lib/orchestration/config';
import { isUncertainMailboxProbeError } from '@/lib/orchestration/mailbox-probe';
import { STALE_WORKER_GC_SQL } from '@/lib/orchestration/repository';
import {
  RetryableWorkError,
  WORK_KINDS,
  WORK_LANES,
} from '@/lib/orchestration/types';

test('every orchestration work kind has a valid lane and retry policy', () => {
  assert.deepEqual(Object.keys(KIND_CONFIG).sort(), [...WORK_KINDS].sort());
  for (const kind of WORK_KINDS) {
    const config = KIND_CONFIG[kind];
    assert.ok(WORK_LANES.includes(config.lane));
    assert.ok(config.defaultMaxAttempts > 0);
    assert.ok(Number.isInteger(config.priority));
  }
});

test('lane limits are positive and bounded', () => {
  for (const lane of WORK_LANES) {
    const limit = laneLimit(lane);
    assert.ok(Number.isInteger(limit));
    assert.ok(limit >= 1);
    assert.ok(limit <= 100);
  }
  assert.equal(laneLimit('auto_campaign'), 1);
});

test('drafting lane defaults derive from the Anthropic in-flight budget without changing enrichment or mailbox lanes', () => {
  const keys = [
    'ORG_DRAFT_RESEARCH_CONCURRENCY',
    'ORG_DRAFT_WRITE_CONCURRENCY',
    'ORCHESTRATION_WORKER_MAX_CONCURRENCY',
    'DRAFTING_ANTHROPIC_MAX_INFLIGHT',
  ] as const;
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    // Budget 8 in flight: research takes 8 / 2 calls per pipeline = 4 slots,
    // write gets the remainder (never below 1), and the worker adds 2 headroom.
    assert.equal(laneLimit('drafting'), 4);
    assert.equal(laneLimit('drafting_write'), 1);
    assert.equal(workerMaxConcurrency(), 7);
    assert.equal(
      workerMaxConcurrency(),
      laneLimit('drafting') + laneLimit('drafting_write') + 2,
    );
    assert.equal(laneLimit('research'), 2);
    assert.equal(laneLimit('mailbox_verify'), 3);
  } finally {
    for (const key of keys) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('retryable errors clamp unsafe zero delays', () => {
  const retry = new RetryableWorkError('retry', 0, 'fixture');
  assert.equal(retry.delayMs, 250);
  assert.equal(retry.code, 'fixture');
});

test('uncertain mailbox sends are recognized and never blindly retried', () => {
  assert.equal(
    isUncertainMailboxProbeError(
      'Mailbox probe send outcome is uncertain; refusing duplicate send',
    ),
    true,
  );
  assert.equal(isUncertainMailboxProbeError('rate limited'), false);
});

test('worker registry GC is cleanup-only at the ten-minute contract', () => {
  assert.match(STALE_WORKER_GC_SQL, /DELETE FROM outreach\.orchestration_workers/);
  assert.match(STALE_WORKER_GC_SQL, /make_interval\(mins => \$1\)/);
  assert.doesNotMatch(STALE_WORKER_GC_SQL, /45 seconds/);
});
