import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAddTime, checkSchedule, confirmLines, DAY_ORDER, formErrors, nextTime, pairTimes, replaceSchedule, savedToast, SCHEDULE_ENTRIES, scheduleFromTemplate, templateRowsFor, undoneToast,
  type TypeSchedule,
} from '@/lib/social-hub/slots/schedule';
import { LFD_ONCE, OFF_GRID, OUTSIDE_DAY } from '@/lib/social-hub/slots/rules';
import type { FeedMode, TemplateRow } from '@/lib/social-hub/slots/types';

const E = (label: string) => SCHEDULE_ENTRIES.find((e) => e.label === label)!;
const row = (weekday: number, vertical: TemplateRow['vertical'], startMinute: number, feedMode: FeedMode | null = null): TemplateRow =>
  ({ weekday, vertical, startMinute, series: null, feedMode });
const sched = (label: string, mins: number[], days: number[], feedMode: FeedMode | null = null): TypeSchedule =>
  ({ entry: E(label), times: mins.map((minute) => ({ minute, feedMode })), days });
const all = [0, 1, 2, 3, 4, 5, 6];

test('uniform template round trips', () => {
  const t = all.flatMap((d) => [540, 870].map((m) => row(d, 'carousels', m)));
  const r = scheduleFromTemplate(t, E('Carousels'));
  assert.deepEqual(r.schedule.times.map((x) => x.minute), [540, 870]);
  assert.deepEqual(r.schedule.days, all);
  assert.equal(r.merged, false);
  assert.equal(templateRowsFor(r.schedule).length, 14);
  assert.deepEqual(new Set(templateRowsFor(r.schedule).map((x) => `${x.weekday}|${x.startMinute}`)), new Set(t.map((x) => `${x.weekday}|${x.startMinute}`)));
});

test('different days merge', () => {
  const r = scheduleFromTemplate([row(1, 'carousels', 570), row(2, 'carousels', 600)], E('Carousels'));
  assert.deepEqual(r.schedule.times.map((x) => x.minute), [570, 600]);
  assert.deepEqual(r.schedule.days, [1, 2]);
  assert.equal(r.merged, true);
});

test('Trial on one day and Main on another is a problem', () => {
  const r = scheduleFromTemplate([row(1, 'explainers', 780, 'trial'), row(2, 'explainers', 780, 'main')], E('Explainers'));
  assert.deepEqual(r.problems, ['1:00 PM is Trial on some days and Main on others. Pick one.']);
});

test('checks: limit, duplicate, grid, bounds, LFD once', () => {
  const ex = (m: number[]) => checkSchedule(sched('Explainers', m, all, 'trial'), { cap: 3, others: [] });
  assert.deepEqual(ex([600, 660, 720, 780]).errors, ['Explainers can post 3 a day. Raise the daily limit on the Explainers page to add more.']);
  assert.deepEqual(ex([690, 690]).errors, ['11:30 AM is already in the list.']);
  assert.deepEqual(ex([695]).errors, [OFF_GRID]);
  assert.deepEqual(ex([1260]).errors, [OUTSIDE_DAY]);
  assert.deepEqual(ex([465]).errors, [OUTSIDE_DAY]);
  assert.deepEqual(checkSchedule(sched('Last Few Days', [540, 600], [2]), { cap: 1, others: [] }).errors.includes(LFD_ONCE), true);
});

test('feed warning counts Main only', () => {
  const car = sched('Carousels', [690], all);
  const main = checkSchedule(car, { cap: 3, others: [sched('Explainers', [690], all, 'main')] });
  assert.deepEqual(main.warnings, ['Explainers post at 11:30 AM too. One of them will go out around 12:00 PM.']);
  const trial = checkSchedule(car, { cap: 3, others: [sched('Explainers', [690], all, 'trial')] });
  assert.deepEqual(trial.warnings, []);
});

test('LFD and Carousels overlap asks to confirm', () => {
  const r = checkSchedule(sched('Last Few Days', [540], [2, 3, 5]), { cap: 1, others: [sched('Carousels', [540], [0, 1, 3, 4, 6])] });
  assert.deepEqual(r.confirm, { kind: 'lfd-carousels', days: [3] });
  const back = checkSchedule(sched('Carousels', [540], [0, 1, 3, 4, 6]), { cap: 3, others: [sched('Last Few Days', [540], [2, 3, 5])] });
  assert.deepEqual(back.confirm, { kind: 'carousels-lfd', days: [3] });
});

test('empty schedule is not an error', () => {
  for (const s of [sched('Carousels', [], all), sched('Carousels', [540], [])]) {
    const r = checkSchedule(s, { cap: 3, others: [] });
    assert.equal(r.empty, true);
    assert.deepEqual(r.errors, []);
  }
});

test('pairTimes', () => {
  assert.deepEqual([...pairTimes([570, 1080], [690, 1080])], [[1080, 1080], [570, 690]]);
  assert.deepEqual([...pairTimes([570, 720], [720, 900])], [[720, 720], [570, 900]]);
  assert.deepEqual([...pairTimes([570, 720], [720])], [[720, 720], [570, null]]);
});

test('feed warning: the later post goes out 30 minutes after the earlier one (ruling P6)', () => {
  // The other post is earlier: 11:30 AM + 30 = 12:00 PM.
  const later = checkSchedule(sched('Carousels', [700], all), { cap: 3, others: [sched('Explainers', [690], all, 'main')] });
  assert.deepEqual(later.warnings, ['Explainers post at 11:30 AM too. One of them will go out around 12:00 PM.']);
  // The other post is later: this one goes at 11:30 AM, so the other slips to 12:00 PM, not 12:10 PM.
  const earlier = checkSchedule(sched('Carousels', [690], all), { cap: 3, others: [sched('Explainers', [700], all, 'main')] });
  assert.deepEqual(earlier.warnings, ['Explainers post at 11:40 AM too. One of them will go out around 12:00 PM.']);
});

test('the form: days run Monday first, Add a time stops at the cap (Last Few Days at one)', () => {
  assert.deepEqual(DAY_ORDER, [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(canAddTime(sched('Carousels', [540, 690], all), 3), true);
  assert.equal(canAddTime(sched('Carousels', [540, 690, 900], all), 3), false);
  assert.equal(canAddTime(sched('Last Few Days', [540], [2]), 1), false);
  assert.equal(canAddTime(sched('Last Few Days', [540], [2]), 3), false, 'Last Few Days takes one time whatever its cap');
  assert.equal(canAddTime(sched('Last Few Days', [], [2]), 1), true);
});

test('the form: a new time adds no warning or error, inside the usual window when it can (fix round 1, B3)', () => {
  const ex = [sched('Explainers', [780, 930], all, 'main')];
  // Carousels 9:00 / 2:30 against Explainers Main 1:00 / 3:30: not 3:30 PM (the old pick, a feed warning), and 30 minutes from 9:00.
  const car = sched('Carousels', [540, 870], all);
  const m = nextTime(car, { cap: 3, others: ex });
  assert.notEqual(m, 930);
  assert.equal(m, 570, 'the first clean mark in the Carousels morning window');
  const r = checkSchedule({ ...car, times: [...car.times, { minute: m, feedMode: null }] }, { cap: 3, others: ex });
  assert.deepEqual([r.errors, r.warnings], [[], []]);
  // Empty: the usual window's start.
  assert.equal(nextTime(sched('Carousels', [], all), { cap: 3, others: [] }), 540);
  // Both usual windows full of conflicts: falls outside them, still clean.
  const busy = [sched('Explainers', [540, 570, 870, 900], all, 'main')];
  const out = nextTime(sched('Carousels', [], all), { cap: 3, others: busy });
  assert.deepEqual(checkSchedule(sched('Carousels', [out], all), { cap: 3, others: busy }).warnings, []);
  // Trial reels never warn against feed times.
  assert.equal(nextTime(sched('Text on Screen', [], all, 'trial'), { cap: 5, others: ex }), 525);
});

test('the form: unresolved merge problems block like errors; warnings and confirms pass through', () => {
  const s = sched('Explainers', [780], all, 'main');
  const f = formErrors(s, { cap: 3, others: [], problems: ['1:00 PM is Trial on some days and Main on others. Pick one.'] });
  assert.deepEqual(f.errors, ['1:00 PM is Trial on some days and Main on others. Pick one.']);
  const ok = formErrors(sched('Carousels', [690], all), { cap: 3, others: [sched('Explainers', [690], all, 'main')], problems: [] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.warnings.length, 1);
  const empty = formErrors(sched('Carousels', [], all), { cap: 3, others: [], problems: [] });
  assert.equal(empty.empty, true);
});

test('replaceSchedule: swaps one entry\'s rows; a Last Few Days confirm takes Carousels off those days', () => {
  const t = [row(1, 'carousels', 570), row(3, 'carousels', 570), row(3, 'explainers', 780, 'main'), row(2, 'last_few_days', 540)];
  const car = replaceSchedule(t, sched('Carousels', [690, 1080], [1, 3]), null);
  assert.deepEqual(car.filter((r) => r.vertical === 'carousels').map((r) => `${r.weekday}|${r.startMinute}`).sort(), ['1|1080', '1|690', '3|1080', '3|690']);
  assert.equal(car.filter((r) => r.vertical !== 'carousels').length, 2, 'other types untouched');
  const lfd = replaceSchedule(t, sched('Last Few Days', [540], [2, 3]), { kind: 'lfd-carousels', days: [3] });
  assert.deepEqual(lfd.filter((r) => r.vertical === 'carousels').map((r) => r.weekday), [1]);
  assert.deepEqual(lfd.filter((r) => r.vertical === 'last_few_days').map((r) => r.weekday), [2, 3]);
  const back = replaceSchedule(t, sched('Carousels', [570], [1, 2, 3]), { kind: 'carousels-lfd', days: [2] });
  assert.deepEqual(back.filter((r) => r.vertical === 'last_few_days'), []);
});

test('toasts: saved, back to Ready, and undone', () => {
  assert.equal(savedToast('Carousels', []), 'Carousels schedule saved. Every week from now on.');
  assert.equal(savedToast('Carousels', [{ label: 'Carousels', count: 2 }]), 'Carousels schedule saved. Every week from now on. 2 Carousels went back to Ready to place.');
  // After a Last Few Days confirm, each type is counted under its own name.
  assert.equal(
    savedToast('Last Few Days', [{ label: 'Last Few Days', count: 1 }, { label: 'Carousels', count: 2 }, { label: 'Explainers', count: 0 }]),
    'Last Few Days schedule saved. Every week from now on. 1 Last Few Days went back to Ready to place. 2 Carousels went back to Ready to place.',
  );
  assert.equal(undoneToast('Carousels', 0), 'Undone: Carousels schedule.');
  assert.equal(undoneToast('Carousels', 2), 'Undone: Carousels schedule. Posts that went back to Ready to place stay there.');
});

test('confirm lines: LFD / Carousels days both ways, and the empty schedule', () => {
  assert.deepEqual(confirmLines({ kind: 'lfd-carousels', days: [3] }, 'Last Few Days'), ['Wednesday becomes a Last Few Days day. Carousels come off Wednesday.']);
  assert.deepEqual(confirmLines({ kind: 'carousels-lfd', days: [0, 3] }, 'Carousels'), [
    'Sunday becomes a Carousels day. Last Few Days comes off Sunday.',
    'Wednesday becomes a Carousels day. Last Few Days comes off Wednesday.',
  ]);
  assert.deepEqual(confirmLines({ kind: 'empty' }, 'Carousels'), ['Carousels will stop posting.']);
});

test('LFD and Carousels never raise each other\'s feed warning (fix round 1, B2)', () => {
  const lfd = checkSchedule(sched('Last Few Days', [540], [2, 3, 5]), { cap: 1, others: [sched('Carousels', [540], [0, 1, 3, 4, 6])] });
  assert.deepEqual(lfd.warnings, []);
  assert.equal(lfd.confirm?.kind, 'lfd-carousels');
  const car = checkSchedule(sched('Carousels', [555], [0, 1, 2, 3]), { cap: 3, others: [sched('Last Few Days', [540], [2, 5])] });
  assert.deepEqual(car.warnings, []);
  // Each still warns against another feed type.
  const ex = checkSchedule(sched('Last Few Days', [540], [2]), { cap: 1, others: [sched('Explainers', [555], all, 'main')] });
  assert.equal(ex.warnings.length, 1);
});

// ── The preview board after a Schedules save (fix round 1, B1) ──

test('the sandbox board: past days and today\'s started slots stay, ties hold, board edits are kept', async () => {
  const { scheduleDays, scheduleStandardDay } = await import('@/lib/social-hub/views/schedule-week');
  const { datedWeek, templateWeek } = await import('@/lib/social-hub/views/week');
  const C = E('Carousels');
  const before = all.flatMap((d) => [row(d, 'carousels', 540), row(d, 'carousels', 870), row(d, 'explainers', 780, 'main')]);
  const after = replaceSchedule(before, sched('Carousels', [690, 1080], all), null);
  const change = { id: 1, before, after, entries: [C], clear: null };
  const week = datedWeek(before, '2026-10-05');
  // A board edit on Fri Oct 9: the 9:00 Carousel moved to 10:00 (hand-set).
  week[4] = { ...week[4]!, slots: [...week[4]!.slots.filter((s) => !(s.vertical === 'carousels' && s.startMinute === 540)), { vertical: 'carousels', startMinute: 600, series: null, feedMode: null, origin: 'override' }] };
  const out = scheduleDays(week, change, { today: '2026-10-08', nowMinute: 900 });
  const car = (i: number) => out[i]!.slots.filter((s) => s.vertical === 'carousels').map((s) => s.startMinute);
  assert.deepEqual(car(2), [540, 870], 'Wed (past) untouched');
  assert.deepEqual(car(3), [540, 870], 'Thu (today, both started) keeps them and gains nothing (P7)');
  assert.deepEqual(car(4), [600, 1080], 'Fri keeps the hand-set 10:00; its 9:00 tie stops 11:30; 2:30 follows to 6:00');
  assert.deepEqual(car(5), [690, 1080], 'Sat follows the schedule');
  assert.ok(out[5]!.slots.some((s) => s.vertical === 'explainers'), 'other types untouched');
  // Today with one started slot: 9:00 started stays and ties 11:30; 2:30 (not started at 10:00) moves to 6:00.
  const morning = scheduleDays(datedWeek(before, '2026-10-05'), change, { today: '2026-10-08', nowMinute: 600 });
  assert.deepEqual(morning[3]!.slots.filter((s) => s.vertical === 'carousels').map((s) => s.startMinute), [540, 1080]);
  // The Standard week is the template: replaced outright.
  const std = scheduleDays(templateWeek(before, '2026-10-05'), change, { today: '2026-10-08', nowMinute: 900 });
  assert.deepEqual(std[3]!.slots.filter((s) => s.vertical === 'carousels').map((s) => s.startMinute), [690, 1080]);
  assert.deepEqual(scheduleStandardDay(week[0]!.slots, 1, change).filter((s) => s.vertical === 'carousels').map((s) => s.startMinute), [690, 1080]);
});

test('the sandbox board: an LFD confirm takes routine Carousels off; a hand-set Carousel stays and LFD skips the date', async () => {
  const { scheduleDays } = await import('@/lib/social-hub/views/schedule-week');
  const { datedWeek } = await import('@/lib/social-hub/views/week');
  const before = [...[0, 1, 3, 4, 6].map((d) => row(d, 'carousels', 570)), ...[2, 5].map((d) => row(d, 'last_few_days', 540))];
  const after = replaceSchedule(before, sched('Last Few Days', [540], [2, 3, 5]), { kind: 'lfd-carousels', days: [3] });
  const change = { id: 1, before, after, entries: [E('Last Few Days')], clear: { entry: E('Carousels'), days: [3] } };
  const clock = { today: '2026-10-05', nowMinute: 480 };
  const kinds = (d: { slots: Array<{ vertical: string; startMinute: number }> }) => d.slots.map((s) => `${s.vertical}@${s.startMinute}`);
  const out = scheduleDays(datedWeek(before, '2026-10-05'), change, clock);
  assert.deepEqual(kinds(out[2]!), ['last_few_days@540'], 'Wed Oct 7 becomes a Last Few Days day');
  const week = datedWeek(before, '2026-10-05');
  week[2] = { ...week[2]!, slots: [{ vertical: 'carousels', startMinute: 600, series: null, feedMode: null, origin: 'override' }] };
  assert.deepEqual(kinds(scheduleDays(week, change, clock)[2]!), ['carousels@600'], 'the hand-set Carousel stays; LFD skips');
  // Undo: both entries set back from the saved template.
  const undo = { id: 2, before: after, after: before, entries: [E('Last Few Days'), E('Carousels')], clear: null };
  assert.deepEqual(kinds(scheduleDays(out, undo, clock)[2]!), ['carousels@570']);
});
