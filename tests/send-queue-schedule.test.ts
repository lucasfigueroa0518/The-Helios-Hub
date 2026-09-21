import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCalendarDays,
  formatNyDate,
  formatNyDateLabel,
  formatNyWeekday,
  isNyCalendarWeekend,
  nyWallTimeToUtc,
  remainingCapacity,
  sendQueueBoardWindow,
} from '@/lib/drafting/send-queue-schedule';

function nyHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date),
  );
}

function nyDate(date: Date): string {
  return formatNyDate(date);
}

test('formatNyDateLabel renders month and day', () => {
  assert.equal(formatNyDateLabel('2026-08-12'), 'Aug 12');
});

test('addCalendarDays rolls months', () => {
  assert.equal(addCalendarDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
});

test('sendQueueBoardWindow includes the prior week and two-week lookahead', () => {
  assert.deepEqual(sendQueueBoardWindow('2026-08-20'), {
    from: '2026-08-13',
    to: '2026-09-03',
  });
});

test('nyWallTimeToUtc lands on the intended NY wall clock', () => {
  const noon = nyWallTimeToUtc('2026-08-12', 12, 0);
  assert.equal(nyDate(noon), '2026-08-12');
  assert.equal(nyHour(noon), 12);
  assert.equal(noon.toISOString(), '2026-08-12T16:00:00.000Z');
});

test('formatNyWeekday and weekend detection', () => {
  assert.equal(formatNyWeekday('2026-09-14'), 'Mon');
  assert.equal(isNyCalendarWeekend('2026-09-14'), false);
  assert.equal(isNyCalendarWeekend('2026-09-19'), true);
});

test('remainingCapacity clamps at zero', () => {
  assert.equal(remainingCapacity(0, 10), 10);
  assert.equal(remainingCapacity(7, 10), 3);
  assert.equal(remainingCapacity(10, 10), 0);
  assert.equal(remainingCapacity(25, 10), 0);
});
