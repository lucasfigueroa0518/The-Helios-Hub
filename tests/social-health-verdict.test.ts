// tests/social-health-verdict.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { cycleBounds, nightsEnding, reportNightFor, weekdayIndex } from '@/lib/social-hub/health/time';
import type { NightReport } from '@/lib/social-hub/health/types';
import { checksFor, nightVerdict, typeVerdict, worst } from '@/lib/social-hub/health/verdict';

const base = (over: Partial<NightReport> = {}): NightReport => ({
  vertical: 'carousels', night: '2026-10-13', due: true, ran: true, target: 1, made: 1, needed: 1, ready: 1,
  scheduledYesterday: 1, postedYesterday: 1, retriedOk: 0, funnel: [], failures: [], spendUsd: 1.2,
  unknownCostCalls: 0, feedsStale: [], nearCap: false, reportError: null, ...over,
});

test('a clean night is green on every check', () => {
  assert.deepEqual(checksFor(base(), 'worked').map((c) => c.tone), ['worked', 'worked', 'worked', 'worked']);
  assert.equal(typeVerdict(base(), 'worked').tone, 'worked');
});

test('made fewer than the target is red, even by one', () => {
  const v = typeVerdict(base({ target: 3, made: 2, ready: 2, needed: 3 }), 'worked');
  assert.equal(v.checks[0]!.tone, 'failed');
  assert.equal(v.tone, 'failed');
});

test('a type that is switched off is grey, never red', () => {
  const v = typeVerdict(base({ due: false, ran: false, made: 0, target: 0, needed: 0, ready: 0 }), 'worked');
  assert.equal(v.tone, 'none');
});

test('a scheduled post that never went out is red; one that needed a retry is yellow', () => {
  assert.equal(checksFor(base({ scheduledYesterday: 2, postedYesterday: 1 }), 'worked')[2]!.tone, 'failed');
  assert.equal(checksFor(base({ retriedOk: 1 }), 'worked')[2]!.tone, 'short');
});

test('ready: none waiting is red, fewer than needed is yellow', () => {
  assert.equal(checksFor(base({ ready: 0, needed: 2 }), 'worked')[1]!.tone, 'failed');
  assert.equal(checksFor(base({ ready: 1, needed: 2 }), 'worked')[1]!.tone, 'short');
});

test('plumbing: dead publisher red, stale feed or near cap yellow, reporter error yellow with grey checks', () => {
  assert.equal(checksFor(base(), 'failed')[3]!.tone, 'failed');
  assert.equal(checksFor(base({ feedsStale: ['TechCrunch AI'] }), 'worked')[3]!.tone, 'short');
  assert.equal(checksFor(base({ nearCap: true }), 'worked')[3]!.tone, 'short');
  const err = checksFor(base({ reportError: 'boom' }), 'worked');
  assert.deepEqual(err.map((c) => c.tone), ['none', 'none', 'none', 'short']);
});

test('night verdict counts non-red types out of types that were due', () => {
  const v = nightVerdict('2026-10-13', [
    base({ vertical: 'reels' }),
    base({ vertical: 'explainers', retriedOk: 1 }),
    base({ vertical: 'carousels', made: 0, ready: 0 }),
    base({ vertical: 'stories', due: false, ran: false, made: 0, target: 0, needed: 0, ready: 0 }),
  ], 'worked');
  assert.equal(v.total, 3);
  assert.equal(v.worked, 2);
});

test('worst picks the most severe tone and ignores none', () => {
  assert.equal(worst(['worked', 'short', 'none']), 'short');
  assert.equal(worst(['none', 'none']), 'none');
});

test('cycle bounds: 08:00 the day before to 07:30, New York time, across DST', () => {
  const oct = cycleBounds('2026-10-13');
  assert.equal(oct.start.toISOString(), '2026-10-12T12:00:00.000Z');
  assert.equal(oct.end.toISOString(), '2026-10-13T11:30:00.000Z');
  const nov = cycleBounds('2026-11-02');
  assert.equal(nov.start.toISOString(), '2026-11-01T13:00:00.000Z');
  assert.equal(nov.end.toISOString(), '2026-11-02T12:30:00.000Z');
});

test('reportNightFor: before 07:30 the latest report is yesterday', () => {
  assert.equal(reportNightFor(new Date('2026-10-13T11:00:00Z')), '2026-10-12');
  assert.equal(reportNightFor(new Date('2026-10-13T11:31:00Z')), '2026-10-13');
});

test('nightsEnding is ascending and weekdayIndex is 0 = Sunday', () => {
  assert.deepEqual(nightsEnding('2026-10-13', 3), ['2026-10-11', '2026-10-12', '2026-10-13']);
  assert.equal(weekdayIndex('2026-10-11'), 0);
});
