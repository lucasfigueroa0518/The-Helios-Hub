import assert from 'node:assert/strict';
import test from 'node:test';

import { completeUtcDaysInWindow } from '@/lib/analytics-attributed-cost';
import {
  ANALYTICS_ALL_TIME_START,
  isAllTimePeriod,
  resolveAnalyticsWindow,
} from '@/lib/analytics';

test('resolveAnalyticsWindow defaults to week', () => {
  const now = new Date('2026-07-28T15:00:00.000Z');
  const window = resolveAnalyticsWindow({ now });
  assert.equal(window.period, 'week');
  assert.equal(window.from, '2026-07-22T00:00:00.000Z');
});

test('resolveAnalyticsWindow custom requires bounds', () => {
  assert.throws(
    () => resolveAnalyticsWindow({ period: 'custom' }),
    /from and to/i,
  );
});

test('resolveAnalyticsWindow all time uses a bounded start, not epoch', () => {
  const now = new Date('2026-08-24T15:00:00.000Z');
  const window = resolveAnalyticsWindow({ now, period: 'all' });
  assert.equal(window.period, 'all');
  assert.equal(window.from, ANALYTICS_ALL_TIME_START);
  assert.equal(window.to, '2026-08-24T23:59:59.999Z');
});

test('all-time earliest bound uses runs.started_at, not created_at', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../lib/analytics.ts', import.meta.url), 'utf8');
  assert.match(source, /min\(started_at\) FROM outreach\.runs/);
  assert.equal(/min\(created_at\) FROM outreach\.runs/.test(source), false);
});

test('isAllTimePeriod accepts all-time aliases', () => {
  assert.equal(isAllTimePeriod('all'), true);
  assert.equal(isAllTimePeriod('all_time'), true);
  assert.equal(isAllTimePeriod('all-time'), true);
  assert.equal(isAllTimePeriod('All Time'), true);
  assert.equal(isAllTimePeriod('week'), false);
});

test('completeUtcDaysInWindow excludes today', () => {
  const now = new Date('2026-08-19T15:00:00.000Z');
  const window = resolveAnalyticsWindow({ now, period: 'week' });
  const days = completeUtcDaysInWindow(window, now);
  assert.deepEqual(days, { fromDay: '2026-08-13', toDay: '2026-08-18' });
});

test('completeUtcDaysInWindow is null when the window is only today', () => {
  const now = new Date('2026-08-19T15:00:00.000Z');
  const days = completeUtcDaysInWindow({
    from: '2026-08-19T00:00:00.000Z',
    to: '2026-08-19T23:59:59.999Z',
  }, now);
  assert.equal(days, null);
});

test('attributed spend UNION does not read lead_cost_events', async () => {
  const { ATTRIBUTED_COST_UNION_SQL } = await import('@/lib/analytics-attributed-cost');
  assert.equal(/lead_cost_events/i.test(ATTRIBUTED_COST_UNION_SQL), false);
  assert.match(ATTRIBUTED_COST_UNION_SQL, /company_research_jobs/);
  assert.match(ATTRIBUTED_COST_UNION_SQL, /drafting_job_cost_events/);
  assert.match(ATTRIBUTED_COST_UNION_SQL, /reply_sends/);
  assert.match(ATTRIBUTED_COST_UNION_SQL, /extraction_summary/);
  assert.match(ATTRIBUTED_COST_UNION_SQL, /context_updates/);
});
