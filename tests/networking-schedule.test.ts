import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isoWeekKey as ingestIsoWeekKey } from '@/lib/networking/ingest';
import { isoWeekKey, weeklyIngestDecision } from '@/lib/networking/schedule';
import { KIND_CONFIG } from '@/lib/orchestration/config';

// Sunday 2026-10-25 is EDT (UTC-4); Sunday 2026-11-01 is EST (UTC-5) after the change at 2 AM.

test('weekly ingest is due from Sunday 09:00 New York time, not before', () => {
  assert.deepEqual(weeklyIngestDecision(new Date('2026-10-25T12:59:00Z')), { due: false }, 'Sunday 08:59 EDT');
  assert.deepEqual(weeklyIngestDecision(new Date('2026-10-25T13:00:00Z')), {
    due: true,
    weekKey: '2026-W43',
    dedupeKey: 'sunday:2026-W43',
  });
  assert.deepEqual(weeklyIngestDecision(new Date('2026-10-24T14:00:00Z')), { due: false }, 'Saturday 10:00 EDT');
  assert.deepEqual(weeklyIngestDecision(new Date('2026-10-21T15:00:00Z')), { due: false }, 'Wednesday');
});

test('late Sunday in New York is still that Sunday, though UTC has moved to Monday', () => {
  const late = weeklyIngestDecision(new Date('2026-10-26T03:30:00Z'));
  assert.deepEqual(late, { due: true, weekKey: '2026-W43', dedupeKey: 'sunday:2026-W43' }, 'Sunday 23:30 EDT');
  // The old reconcile keyed by UTC ISO week, which is why the ingest ran Sunday about 8 PM ET.
  assert.equal(isoWeekKey(new Date(2026, 9, 26, 12)), '2026-W44');
  assert.deepEqual(weeklyIngestDecision(new Date('2026-10-26T04:30:00Z')), { due: false }, 'Monday 00:30 EDT');
});

test('the 09:00 boundary follows daylight saving time', () => {
  assert.deepEqual(weeklyIngestDecision(new Date('2026-11-01T13:30:00Z')), { due: false }, 'Sunday 08:30 EST');
  assert.deepEqual(weeklyIngestDecision(new Date('2026-11-01T14:00:00Z')), {
    due: true,
    weekKey: '2026-W44',
    dedupeKey: 'sunday:2026-W44',
  });
});

test('the new dedupe key never collides with the old per-week keys', () => {
  const decision = weeklyIngestDecision(new Date('2026-10-25T13:00:00Z'));
  assert.ok(decision.due);
  if (decision.due) assert.notEqual(decision.dedupeKey, decision.weekKey);
  assert.equal(ingestIsoWeekKey, isoWeekKey, 'ingest still exports the same week key');
});

test('reconcile asks the pure decision, and a successful ingest queues the details job', () => {
  const source = readFileSync(path.join(process.cwd(), 'lib/orchestration/handlers.ts'), 'utf8');
  assert.match(source, /weeklyIngestDecision\(new Date\(\)\)/);
  assert.match(source, /if \(decision\.due\)/);
  assert.match(source, /'networking\.event_details',[\s\S]{0,200}`ingest:\$\{result\.runId\}`/);
  assert.match(source, /'networking\.event_details': handleNetworkingEventDetails as Handler/);
  assert.deepEqual(KIND_CONFIG['networking.event_details'], KIND_CONFIG['networking.weekly_ingest']);
});
