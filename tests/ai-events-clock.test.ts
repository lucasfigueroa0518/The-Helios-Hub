/**
 * AI Events This Week: the settings parse and the Sunday 12:00 PM clock (AE-08), decided from
 * plain inputs. A person's Generate is not the clock: it queues on any day.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { firstAiEventsCheckAt, nextAiEventsRunAt, noonQueue } from '@/lib/ai-events/clock';
import { AI_EVENTS_WINDOW } from '@/lib/ai-events/config';
import { queueManualAiEventsRun, AI_EVENTS_ALREADY_QUEUED } from '@/lib/ai-events/manual';
import { aiEventsDueOn, parseAiEventsSettings, readAiEventsSettings } from '@/lib/ai-events/settings';

import { openAiEventsDb } from './fixtures/ai-events/seed';

const on = parseAiEventsSettings([{ key: 'auto_run', value: true }]);

test('settings ship safe: Sunday only, approval on, publishing and the clock off, a $0.50 cap', async () => {
  const { query } = await openAiEventsDb();
  const s = await readAiEventsSettings(query);
  assert.deepEqual(s, { autoRun: false, publishingLive: false, requireApproval: true, days: [0], runCapUsd: 0.5, runCapRaw: 0.5 });
  assert.deepEqual(parseAiEventsSettings([]).days, [0], 'no days row: Sunday');
  assert.equal(parseAiEventsSettings([{ key: 'require_approval', value: 'no' }]).requireApproval, true, 'on unless literally false');
  assert.equal(parseAiEventsSettings([{ key: 'run_cap_usd', value: 'abc' }]).runCapUsd, null);
  assert.equal(parseAiEventsSettings([{ key: 'run_cap_usd', value: true }]).runCapUsd, null);
  assert.deepEqual(parseAiEventsSettings([{ key: 'days', value: [9] }]).days, [0], 'a bad days row falls back');
  assert.deepEqual(AI_EVENTS_WINDOW, { id: 'evening', label: '6:00–7:00 PM', startMinute: 1080, endMinute: 1140 });
});

test('the clock wakes at 12:00 PM New York, across the DST change', () => {
  assert.equal(nextAiEventsRunAt(new Date('2026-10-25T15:00:00Z')).toISOString(), '2026-10-25T16:00:00.000Z', 'Sunday 11 AM EDT → noon EDT');
  assert.equal(nextAiEventsRunAt(new Date('2026-10-25T16:00:30Z')).toISOString(), '2026-10-26T16:00:00.000Z', 'just past noon → tomorrow');
  assert.equal(nextAiEventsRunAt(new Date('2026-11-01T12:00:00Z')).toISOString(), '2026-11-01T17:00:00.000Z', 'noon EST after the change');
});

test('noon queues a run on Sunday only, with auto_run on and a usable cap', () => {
  const sunday = new Date('2026-10-25T16:00:00Z');
  assert.deepEqual(noonQueue(sunday, on), { queue: true, reason: 'an AI Events day' });
  for (const day of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']) {
    const at = new Date(`${day}T16:00:00Z`);
    assert.equal(noonQueue(at, on).queue, false, day);
    assert.match(noonQueue(at, on).reason, /not an AI Events day/);
  }
  assert.match(noonQueue(sunday, parseAiEventsSettings([])).reason, /auto_run is off/);
  assert.match(noonQueue(sunday, null).reason, /could not be read/);
  const badCap = noonQueue(sunday, parseAiEventsSettings([{ key: 'auto_run', value: true }, { key: 'run_cap_usd', value: 0 }]));
  assert.equal(badCap.queue, false);
  assert.match(badCap.reason, /run_cap_usd/);
  // Saturday 11 PM ET is Sunday in UTC: the New York date decides.
  assert.equal(noonQueue(new Date('2026-10-25T03:00:00Z'), on).queue, false);
  // Template mode: the calendar says whether today has a slot.
  assert.equal(noonQueue(new Date('2026-10-28T16:00:00Z'), on, true).queue, true);
  assert.equal(noonQueue(sunday, on, false).queue, false);
});

test('Generate queues a manual run on any day, auto_run on or off; a second click gets a note', async () => {
  assert.equal(aiEventsDueOn(on, '2026-10-28'), false);
  assert.equal(aiEventsDueOn(parseAiEventsSettings([]), '2026-10-28', true), true);
  const { query } = await openAiEventsDb();
  const first = await queueManualAiEventsRun(query, 'editor@example.com');
  assert.equal(first.ok, true);
  assert.deepEqual(await queueManualAiEventsRun(query), { ok: false, note: AI_EVENTS_ALREADY_QUEUED });
  const row = (await query<{ trigger: string; kind: string; cap_usd: number; requested_by: string }>(`SELECT trigger, kind, cap_usd, requested_by FROM ai_events.runs`)).rows;
  assert.deepEqual(row, [{ trigger: 'manual', kind: 'build', cap_usd: 0.5, requested_by: 'editor@example.com' }]);
  await query(`UPDATE ai_events.settings SET value = '"x"'::jsonb WHERE key = 'run_cap_usd'`);
  await query(`DELETE FROM ai_events.runs`);
  const refused = await queueManualAiEventsRun(query);
  assert.equal(refused.ok, false);
  assert.match(refused.note, /run_cap_usd/);
});

test('a worker started after noon New York checks the clock at once; before noon it waits for noon', () => {
  const afterNoon = new Date('2026-10-25T18:30:00Z'); // Sunday 2:30 PM EDT
  assert.equal(firstAiEventsCheckAt(afterNoon).getTime(), afterNoon.getTime());
  const beforeNoon = new Date('2026-10-25T13:00:00Z'); // Sunday 9:00 AM EDT
  assert.equal(firstAiEventsCheckAt(beforeNoon).getTime(), nextAiEventsRunAt(beforeNoon).getTime());
  assert.equal(firstAiEventsCheckAt(beforeNoon).toISOString(), '2026-10-25T16:00:00.000Z');
});
