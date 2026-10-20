/** The week grid model (spec §3). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { carouselsByWeekday, chipAction, chipNames, datedWeek, lfdWeekdays, mondayOf, ROWS, splitBooked, stuckNote, switchOnCopy, templateWeek, weekLabel, weekModel } from '@/lib/social-hub/views/week';
import { addDays, weekdayOf } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const NOW = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York
const week = (monday: string) => Array.from({ length: 7 }, (_, i) => {
  const nyDate = addDays(monday, i);
  return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(tpl, [], nyDate) };
});

test('mondayOf steps back to Monday', () => {
  assert.equal(mondayOf('2026-10-20'), '2026-10-19');
  assert.equal(mondayOf('2026-10-25'), '2026-10-19');
  assert.equal(mondayOf('2026-10-19'), '2026-10-19');
});

test('eight rows in start order; Tuesday\'s 2:30 feed cell is an LFD day', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW });
  assert.deepEqual(m.rows.map((r) => r.row.id), ROWS.map((r) => r.id));
  assert.equal(ROWS.length, 8);
  const feedAfternoon = m.rows.find((r) => r.row.id === 'feed-afternoon')!;
  assert.equal(feedAfternoon.cells[1]!.blockedReason, 'LFD day');
  assert.equal(feedAfternoon.cells[2]!.chips[0]!.vertical, 'carousels');
  const feedMorning = m.rows.find((r) => r.row.id === 'feed-morning')!;
  assert.equal(feedMorning.cells[1]!.chips[0]!.vertical, 'last_few_days');
});

test('Stories series for a day share one cell', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW });
  const stories = m.rows.find((r) => r.row.id === 'stories')!;
  assert.deepEqual(stories.cells[0]!.chips.map((c) => c.windowId), ['morning_download', 'guess_the_number']); // Monday
});

test('past days and started windows are not editable; later ones are', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW });
  const reelMorning = m.rows.find((r) => r.row.id === 'reel-morning')!;
  assert.equal(reelMorning.cells[0]!.editable, false); // Monday, past
  assert.equal(reelMorning.cells[1]!.editable, false); // today 8:45, started
  const reelEvening = m.rows.find((r) => r.row.id === 'reel-evening')!;
  assert.equal(reelEvening.cells[1]!.editable, true);  // today 6:00 PM
});

test('a booked post shows on its chip; addable never offers Carousel on an LFD day', () => {
  const post = { id: 'p', vertical: 'carousels', nyDate: '2026-10-21', status: 'scheduled', slot: { id: 'morning', label: '' }, refs: { postId: 'x' } } as unknown as HubPost;
  const days = week('2026-10-19');
  days[1]!.slots = days[1]!.slots.filter((s) => s.vertical !== 'last_few_days'); // Tue without LFD
  // Monday's clock: Tuesday's 9:00 hasn't started yet, so its cell can still offer adds.
  const m = weekModel({ mode: 'week', days, posts: [post], now: new Date('2026-10-19T14:00:00Z') });
  const feedMorning = m.rows.find((r) => r.row.id === 'feed-morning')!;
  assert.equal(feedMorning.cells[2]!.chips[0]!.booked?.id, 'p');
  assert.deepEqual(feedMorning.cells[4]!.addable, []); // Friday: LFD holds 9:00, no Carousel offered
  assert.ok(feedMorning.cells[1]!.addable.some((a) => a.vertical === 'carousels')); // Tuesday without LFD
});

test('template mode has no dates and everything is editable', () => {
  const days = Array.from({ length: 7 }, (_, i) => ({ nyDate: null, weekday: (i + 1) % 7, slots: resolveDay(tpl, [], addDays('2026-10-19', i)) }));
  const m = weekModel({ mode: 'template', days, posts: [], now: NOW });
  assert.ok(m.rows.every((r) => r.cells.every((c) => c.editable)));
  assert.ok(m.columns.every((c) => c.nyDate === null));
});

test('weekLabel names the week; templateWeek drops dates, Monday first', () => {
  assert.equal(weekLabel('2026-10-19'), 'Oct 19 – 25');
  assert.equal(weekLabel('2026-10-26'), 'Oct 26 – Nov 1');
  const t = templateWeek(tpl, '2026-10-19');
  assert.deepEqual(t.map((d) => d.weekday), [1, 2, 3, 4, 5, 6, 0]);
  assert.ok(t.every((d) => d.nyDate === null));
  assert.deepEqual(datedWeek(tpl, '2026-10-19'), week('2026-10-19'));
});

test('each Stories chip names its series; other types use their short name', () => {
  assert.deepEqual(chipNames('stories', 'morning_download'), { short: 'Morning Dl', full: 'Morning Download' });
  assert.deepEqual(chipNames('stories', 'guess_the_number'), { short: 'Guess #', full: 'Guess the Number' });
  assert.deepEqual(chipNames('stories', 'free_vs_paid'), { short: 'Free/Paid', full: 'Free vs. Paid' });
  assert.deepEqual(chipNames('reels', 'morning'), { short: 'Text', full: 'Text on Screen' });
});

test('the LFD switch is open until today\'s 9:00 starts; always in template mode', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW }); // Tue 10:00 AM
  assert.deepEqual(m.columns.map((c) => c.lfdOpen), [false, false, true, true, true, true, true]);
  const early = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: new Date('2026-10-20T12:00:00Z') }); // Tue 8:00 AM
  assert.equal(early.columns[1]!.lfdOpen, true);
  const t = weekModel({ mode: 'template', days: templateWeek(tpl, '2026-10-19'), posts: [], now: NOW });
  assert.ok(t.columns.every((c) => c.lfdOpen));
});

test('carouselsByWeekday reads the template, not a date', () => {
  const by = carouselsByWeekday(tpl);
  assert.deepEqual(by[1], ['morning', 'afternoon']); // Monday
  assert.deepEqual(by[2], []); // Tuesday is an LFD day
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

test('chipAction: an editable chip edits; a read-only booked chip opens its post; a read-only empty one is plain', () => {
  const post = { id: 'p', vertical: 'reels', nyDate: '2026-10-20', status: 'published', slot: { id: 'morning', label: '' } } as unknown as HubPost;
  const chip = { vertical: 'reels' as const, windowId: 'morning', feedMode: 'trial' as const, origin: 'template' as const, booked: null };
  assert.equal(chipAction(chip, true), 'edit');
  assert.equal(chipAction({ ...chip, booked: post }, true), 'edit', 'booked but still editable: the editor (with Open post)');
  assert.equal(chipAction({ ...chip, booked: post }, false), 'open');
  assert.equal(chipAction(chip, false), 'none');
  // Today's 8:45 reel at 10:00 AM is read-only in the grid; booked, it becomes a link.
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [post], now: NOW });
  const cell = m.rows.find((r) => r.row.id === 'reel-morning')!.cells[1]!;
  assert.equal(chipAction(cell.chips[0]!, cell.editable), 'open');
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
});
