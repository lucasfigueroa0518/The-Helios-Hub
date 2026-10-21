/** The weekly slot resolver on free-time keys (vertical, startMinute, series) and the seed's default times. Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay, validateDay, LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate, type StorySeries } from '@/lib/social-hub/slots/seed';
import type { OverrideRow, TemplateRow } from '@/lib/social-hub/slots/types';

// Mon 2026-10-19 … Sun 2026-10-25.
const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const T = (weekday: number, vertical: TemplateRow['vertical'], startMinute: number, feedMode: TemplateRow['feedMode'] = null, series: StorySeries | null = null): TemplateRow => ({ weekday, vertical, startMinute, series, feedMode });
const O = (nyDate: string, vertical: OverrideRow['vertical'], startMinute: number, action: OverrideRow['action'], feedMode: OverrideRow['feedMode'] = null, series: StorySeries | null = null): OverrideRow => ({ nyDate, vertical, startMinute, series, action, feedMode });

test('a template day resolves in start order at its free times', () => {
  const tpl = [T(2, 'explainers', 780, 'main'), T(2, 'reels', 525, 'trial'), T(3, 'reels', 1080, 'trial')];
  const day = resolveDay(tpl, [], '2026-10-20'); // Tuesday
  assert.deepEqual(day, [
    { vertical: 'reels', startMinute: 525, series: null, feedMode: 'trial', origin: 'template' },
    { vertical: 'explainers', startMinute: 780, series: null, feedMode: 'main', origin: 'template' },
  ]);
});

test('overrides: remove drops, add inserts, add on a template key replaces it (single-date flip)', () => {
  const tpl = [T(2, 'reels', 525, 'trial'), T(2, 'carousels', 870)];
  const ov: OverrideRow[] = [
    O('2026-10-20', 'reels', 525, 'add', 'main'),
    O('2026-10-20', 'carousels', 870, 'remove'),
    O('2026-10-20', 'explainers', 720, 'add', 'trial'),
    O('2026-10-27', 'reels', 525, 'remove'),
  ];
  const day = resolveDay(tpl, ov, '2026-10-20');
  assert.deepEqual(day.map((s) => [s.vertical, s.startMinute, s.feedMode, s.origin]), [
    ['reels', 525, 'main', 'override'],
    ['explainers', 720, 'trial', 'override'],
  ]);
  assert.equal(resolveDay(tpl, ov, '2026-11-03').length, 2);
});

test('Stories key on series too: two series at one minute, one series twice a day', () => {
  const tpl = [T(1, 'stories', 510, null, 'morning_download'), T(1, 'stories', 510, null, 'guess_the_number')];
  const ov = [O('2026-10-19', 'stories', 900, 'add', null, 'morning_download'), O('2026-10-19', 'stories', 510, 'remove', null, 'guess_the_number')];
  assert.deepEqual(resolveDay(tpl, ov, '2026-10-19').map((s) => `${s.series}@${s.startMinute}`), ['morning_download@510', 'morning_download@900']);
});

test('an invalid minute is dropped, not crashed on', () => {
  assert.deepEqual(resolveDay([T(1, 'carousels', 541), T(1, 'carousels', 1440), T(1, 'stories', 510)], [], '2026-10-19'), []);
});

test('validateDay: LFD and Carousels never share a day; feed_mode only on reel types', () => {
  const day = (tpl: TemplateRow[]) => resolveDay(tpl, [], '2026-10-20');
  assert.deepEqual(validateDay(day([T(2, 'last_few_days', 540), T(2, 'carousels', 870)])), [LFD_CAROUSEL_CONFLICT]);
  assert.deepEqual(validateDay(day([T(2, 'last_few_days', 540), T(2, 'reels', 525, 'trial')])), []);
  assert.deepEqual(validateDay(day([T(2, 'reels', 525, null)])), ['Text on Screen (8:45 AM) needs Trial or Main feed.']);
  assert.deepEqual(validateDay(day([T(2, 'stories', 510, 'main', 'morning_download')])), ['IG Stories posts aren’t reels, so they have no Trial or Main feed.']);
  // Two of one type at different free times is fine (no per-window limit any more).
  assert.deepEqual(validateDay(day([T(2, 'explainers', 720, 'main'), T(2, 'explainers', 780, 'main')])), []);
});

test('seed parity: Mon 2026-10-19 resolves to exactly the default times', () => {
  const mon = resolveDay(seedTemplate(DEFAULT_SEED_INPUTS), [], '2026-10-19');
  assert.deepEqual(mon.map((s) => [s.vertical, s.startMinute, s.series, s.feedMode]), [
    ['stories', 510, 'guess_the_number', null],
    ['stories', 510, 'morning_download', null],
    ['reels', 525, null, 'trial'],
    ['carousels', 540, null, null],
    ['reels', 675, null, 'trial'],
    ['explainers', 780, null, 'main'],
    ['carousels', 870, null, null],
    ['explainers', 930, null, 'main'],
    ['reels', 1080, null, 'trial'],
  ]);
});

test('seed: Tue/Fri LFD at 9 AM instead of Carousels; Stories on their days; every day validates', () => {
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  for (const r of tpl) {
    if (r.vertical === 'reels') assert.equal(r.feedMode, 'trial');
    else if (r.vertical === 'explainers') assert.equal(r.feedMode, 'main');
    else assert.equal(r.feedMode, null);
    assert.equal(r.series !== null, r.vertical === 'stories');
  }
  for (const date of WEEK) assert.deepEqual(validateDay(resolveDay(tpl, [], date)), [], date);
  const tue = resolveDay(tpl, [], '2026-10-20');
  assert.deepEqual(tue.filter((s) => s.vertical === 'last_few_days').map((s) => s.startMinute), [540]);
  assert.ok(!tue.some((s) => s.vertical === 'carousels'));
  assert.deepEqual(tue.filter((s) => s.vertical === 'stories').map((s) => s.series), ['free_vs_paid', 'morning_download']);
});

test('seed follows custom LFD and Stories days', () => {
  const tpl = seedTemplate({ lfdDays: [3], storyDays: { morning_download: [1], guess_the_number: [], free_vs_paid: [0] } });
  const wed = resolveDay(tpl, [], '2026-10-21');
  assert.ok(wed.some((s) => s.vertical === 'last_few_days'));
  assert.ok(!wed.some((s) => s.vertical === 'carousels'));
  assert.deepEqual(resolveDay(tpl, [], '2026-10-19').filter((s) => s.vertical === 'stories').map((s) => s.series), ['morning_download']);
});
