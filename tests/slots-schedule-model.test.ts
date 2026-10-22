import assert from 'node:assert/strict';
import test from 'node:test';

import { checkSchedule, pairTimes, SCHEDULE_ENTRIES, scheduleFromTemplate, templateRowsFor, type TypeSchedule } from '@/lib/social-hub/slots/schedule';
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
