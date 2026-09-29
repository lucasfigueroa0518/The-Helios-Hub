/**
 * Posting slots. No database and no Instagram: the minute draw and which
 * window is still open.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCalendarDays,
  chooseSlot,
  slotKey,
  slotMinuteCount,
  slotMinuteInstant,
} from '@/lib/reels/publish/slots';

const oneAm = new Date('2026-09-29T05:00:00Z');

test('each slot counts every minute, including both ends', () => {
  assert.equal(slotMinuteCount('morning'), 76);
  assert.equal(slotMinuteCount('midday'), 76);
  assert.equal(slotMinuteCount('evening'), 181);
  assert.equal(slotMinuteInstant('2026-09-29', 'morning', 0).toISOString(), '2026-09-29T12:45:00.000Z');
  assert.equal(slotMinuteInstant('2026-09-29', 'morning', 75).toISOString(), '2026-09-29T14:00:00.000Z');
  assert.equal(slotMinuteInstant('2026-09-29', 'midday', 75).toISOString(), '2026-09-29T16:30:00.000Z');
  assert.equal(slotMinuteInstant('2026-09-29', 'evening', 180).toISOString(), '2026-09-30T01:00:00.000Z');
});

test('a night run can land on any minute of the morning slot, and only one', () => {
  const first = chooseSlot(oneAm, new Set(), () => 0);
  const last = chooseSlot(oneAm, new Set(), (count) => count - 1);
  assert.equal(first?.nyDate, '2026-09-29');
  assert.equal(first?.slot, 'morning');
  assert.equal(first?.publishAt.toISOString(), '2026-09-29T12:45:00.000Z');
  assert.equal(last?.slot, 'morning');
  assert.equal(last?.publishAt.toISOString(), '2026-09-29T14:00:00.000Z');
});

test('a taken slot is skipped, and a slot that has started is not used', () => {
  const taken = new Set([slotKey('2026-09-29', 'morning')]);
  const next = chooseSlot(oneAm, taken, () => 0);
  assert.equal(next?.slot, 'midday');
  assert.equal(next?.publishAt.toISOString(), '2026-09-29T15:15:00.000Z');

  const duringMorning = new Date('2026-09-29T13:30:00Z');
  const later = chooseSlot(duringMorning, new Set(), () => 0);
  assert.equal(later?.slot, 'midday');

  const afterEvening = new Date('2026-09-30T02:00:00Z');
  const tomorrow = chooseSlot(afterEvening, new Set(), () => 0);
  assert.equal(tomorrow?.nyDate, '2026-09-30');
  assert.equal(tomorrow?.slot, 'morning');
});

test('calendar days do not drift across a 24-hour add', () => {
  assert.equal(addCalendarDays('2026-09-29', 1), '2026-09-30');
  assert.equal(addCalendarDays('2026-03-08', 1), '2026-03-09');
});
