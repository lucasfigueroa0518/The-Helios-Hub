import assert from 'node:assert/strict';
import test from 'node:test';

import { explainerIdeas } from '@/lib/social-hub/adapters/explainers';
import type { ExplainerTopicRow } from '@/lib/social-hub/queries/explainers';
import { elapsedSeconds, runStatusText, shortRunError } from '@/lib/content-type/run-status';

const NOW = Date.parse('2026-10-08T23:41:00Z');

function topic(over: Partial<ExplainerTopicRow> = {}): ExplainerTopicRow {
  return {
    topic_id: 'topic-1',
    title: 'What is a database index?',
    scope: null,
    status: 'queued',
    origin: 'seeded',
    weighted_score: 80,
    created_at: '2026-10-07T12:00:00Z',
    ok_jobs: 0,
    last_render_at: null,
    published: false,
    scheduled: false,
    job_id: null,
    job_status: null,
    job_stage: null,
    job_error: null,
    job_requested_at: null,
    job_started_at: null,
    ...over,
  };
}

test('a queued run says it is waiting, with the time since it was asked for', () => {
  const text = runStatusText(
    { state: 'queued', stage: null, error: null, requestedAt: '2026-10-08T23:39:00Z', startedAt: null },
    NOW,
  );
  assert.equal(text, 'Queued · waiting for the worker · 2:00');
});

test('a running run names the stage and counts from when work started', () => {
  const run = { state: 'running' as const, stage: 'session_a', error: null, requestedAt: '2026-10-08T23:30:00Z', startedAt: '2026-10-08T23:40:00Z' };
  assert.equal(runStatusText(run, NOW), 'Writing the plan · 1:00');
  assert.equal(elapsedSeconds(run, NOW), 60);
});

test('a failed run keeps the reason and does not grow a timer', () => {
  const error = 'Session A ended without a plan (incomplete: Claude Code process exited with code 1. stderr: --dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons).';
  const run = { state: 'failed' as const, stage: 'session_a_done', error, requestedAt: '2026-10-08T23:39:00Z', startedAt: '2026-10-08T23:39:10Z' };
  assert.equal(elapsedSeconds(run, NOW), null);
  assert.equal(shortRunError(error), '--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons');
  assert.equal(runStatusText(run, NOW), 'Failed · --dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons');
});

test('explainer ideas carry the latest run so the row can say it before the poll', () => {
  const [failed, quiet] = explainerIdeas([
    topic({
      job_id: 'job-1',
      job_status: 'failed',
      job_stage: 'session_a_done',
      job_error: 'Session A ended without a plan',
      job_requested_at: '2026-10-08T23:39:00Z',
      job_started_at: '2026-10-08T23:39:10Z',
    }),
    topic({ topic_id: 'topic-2', title: 'What is a server?' }),
  ]);
  assert.equal(failed?.run?.state, 'failed');
  assert.equal(runStatusText(failed!.run!, NOW), 'Failed · Session A ended without a plan');
  assert.equal(quiet?.run, null);
});
