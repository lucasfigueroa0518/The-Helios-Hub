/** The week helpers that outlive the row model (the board model is tests/week-board-model.test.ts). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { canMoveBack, chipNames, datedWeek, lfdWeekdays, mondayOf, splitBooked, stuckNote, switchOnCopy, weekLabel } from '@/lib/social-hub/views/week';
import { addDays, weekdayOf } from '@/lib/social-hub/time';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const week = (monday: string) => Array.from({ length: 7 }, (_, i) => {
  const nyDate = addDays(monday, i);
  return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(tpl, [], nyDate), personKeys: [] };
});

test('mondayOf steps back to Monday', () => {
  assert.equal(mondayOf('2026-10-20'), '2026-10-19');
  assert.equal(mondayOf('2026-10-25'), '2026-10-19');
  assert.equal(mondayOf('2026-10-19'), '2026-10-19');
});

test('weekLabel names the week; datedWeek resolves each date Monday first, with no edits of the person\'s', () => {
  assert.equal(weekLabel('2026-10-19'), 'Oct 19 – 25');
  assert.equal(weekLabel('2026-10-26'), 'Oct 26 – Nov 1');
  const t = datedWeek(tpl, '2026-10-19');
  assert.deepEqual(t.map((d) => d.weekday), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(t, week('2026-10-19'));
});

test('weekFromOverrides: each date\'s person keys are its person overrides only, adds and removes alike', async () => {
  const { weekFromOverrides } = await import('@/lib/social-hub/views/week');
  const o = (nyDate: string, startMinute: number, action: 'add' | 'remove', setBy: 'person' | 'system') =>
    ({ nyDate, vertical: 'explainers' as const, startMinute, series: null, action, feedMode: action === 'add' ? ('main' as const) : null, setBy });
  const days = weekFromOverrides(tpl, [o('2026-10-21', 1020, 'add', 'person'), o('2026-10-21', 930, 'remove', 'person'), o('2026-10-22', 1140, 'add', 'system')], '2026-10-19');
  assert.deepEqual(days[2]!.personKeys, [{ vertical: 'explainers', startMinute: 1020, series: null }, { vertical: 'explainers', startMinute: 930, series: null }]);
  assert.ok(days[2]!.slots.some((s) => s.startMinute === 1020) && !days[2]!.slots.some((s) => s.vertical === 'explainers' && s.startMinute === 930));
  assert.deepEqual(days[3]!.personKeys, [], 'a system pin is not the person\'s');
  assert.ok(days[3]!.slots.some((s) => s.startMinute === 1140));
});

test('each Stories chip names its series; other types use their short name', () => {
  assert.deepEqual(chipNames('stories', 'morning_download'), { short: 'Morning Dl', full: 'Morning Download' });
  assert.deepEqual(chipNames('stories', 'guess_the_number'), { short: 'Guess #', full: 'Guess the Number' });
  assert.deepEqual(chipNames('stories', 'free_vs_paid'), { short: 'Free/Paid', full: 'Free vs. Paid' });
  assert.deepEqual(chipNames('reels', null), { short: 'Text', full: 'Text on Screen' });
});

test('the Switch on confirm says what changes the moment it is on (ruling R8)', () => {
  const lfdDays = lfdWeekdays(seedTemplate(DEFAULT_SEED_INPUTS));
  assert.deepEqual(lfdDays, [2, 5]);
  assert.equal(switchOnCopy({ templateEmpty: true, lfdPaused: false, lfdDays }), 'From now on the calendar decides what posts when. Today’s pattern is copied in.');
  assert.equal(
    switchOnCopy({ templateEmpty: true, lfdPaused: true, lfdDays }),
    'From now on the calendar decides what posts when. Today’s pattern is copied in. Last Few Days is paused, so Tuesdays and Fridays (its days) will have no Carousels until you edit the calendar.',
  );
  assert.equal(
    switchOnCopy({ templateEmpty: false, lfdPaused: false, lfdDays }),
    'From now on the calendar decides what posts when. Your saved calendar from last time comes back, not a fresh copy of today’s settings.',
  );
  assert.doesNotMatch(switchOnCopy({ templateEmpty: true, lfdPaused: true, lfdDays: [] }), /Carousels/, 'no LFD days, nothing lost');
  assert.match(switchOnCopy({ templateEmpty: false, lfdPaused: true, lfdDays: [1, 3, 5] }), /Mondays, Wednesdays and Fridays/);
  assert.doesNotMatch(switchOnCopy({ templateEmpty: true, lfdPaused: true, lfdDays }), /nothing changes/);
});

test('switchOnCopy: when the template couldn’t be read it says neither "copied in" nor "comes back" as fact', () => {
  assert.equal(
    switchOnCopy({ templateEmpty: null, lfdPaused: false, lfdDays: [] }),
    'From now on the calendar decides what posts when. If a calendar was saved before, it comes back; otherwise today’s pattern is copied in.',
  );
  const text = switchOnCopy({ templateEmpty: null, lfdPaused: false, lfdDays: [] });
  assert.doesNotMatch(text, /Today’s pattern is copied in\./);
  assert.doesNotMatch(text, /Your saved calendar from last time comes back/);
});

test('Move back to ready: a booking with no action ref is not sent; the editor says where to unschedule it', () => {
  const list: Array<{ scheduleId: string; refs: Record<string, string> }> = [
    { scheduleId: 'a', refs: { postId: 'p-1' } },
    { scheduleId: 'b', refs: {} },
    { scheduleId: 'c', refs: { postIdeaId: 'i-1' } },
  ];
  const { movable, stuck } = splitBooked(list);
  assert.deepEqual(movable.map((b) => b.scheduleId), ['a', 'c']);
  assert.deepEqual(stuck.map((b) => b.scheduleId), ['b']);
  assert.equal(stuckNote(1), '1 post couldn’t be moved here. Unschedule it from the post page.');
  assert.equal(stuckNote(2), '2 posts couldn’t be moved here. Unschedule them from the post page.');
  assert.equal(canMoveBack(list), true, 'some can move');
  assert.equal(canMoveBack(stuck), false, 'every post is stuck: Move back to ready is disabled');
});
