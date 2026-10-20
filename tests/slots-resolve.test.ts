/** The weekly slot resolver (spec §2) and the "day 1 = today" parity (spec §6.2). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay, validateDay, LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { OverrideRow, TemplateRow } from '@/lib/social-hub/slots/types';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

// Mon 2026-10-19 … Sun 2026-10-25.
const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const T = (weekday: number, vertical: TemplateRow['vertical'], windowId: string, feedMode: TemplateRow['feedMode'] = null): TemplateRow => ({ weekday, vertical, windowId, feedMode });

test('a template day resolves in start order with window times from PLAN', () => {
  const tpl = [T(2, 'explainers', 'afternoon', 'main'), T(2, 'reels', 'morning', 'trial'), T(3, 'reels', 'evening', 'trial')];
  const day = resolveDay(tpl, [], '2026-10-20'); // Tuesday
  assert.deepEqual(day.map((s) => `${s.vertical}:${s.windowId}`), ['reels:morning', 'explainers:afternoon']);
  assert.equal(day[0]!.startMinute, 8 * 60 + 45);
  assert.equal(day[0]!.origin, 'template');
});

test('overrides: remove drops, add inserts, add on a template key replaces it (single-date flip)', () => {
  const tpl = [T(2, 'reels', 'morning', 'trial'), T(2, 'carousels', 'afternoon')];
  const ov: OverrideRow[] = [
    { nyDate: '2026-10-20', vertical: 'reels', windowId: 'morning', action: 'add', feedMode: 'main' },
    { nyDate: '2026-10-20', vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
    { nyDate: '2026-10-20', vertical: 'explainers', windowId: 'late', action: 'add', feedMode: 'trial' },
    { nyDate: '2026-10-27', vertical: 'reels', windowId: 'morning', action: 'remove', feedMode: null },
  ];
  const day = resolveDay(tpl, ov, '2026-10-20');
  assert.deepEqual(day.map((s) => [s.vertical, s.windowId, s.feedMode, s.origin]), [
    ['reels', 'morning', 'main', 'override'],
    ['explainers', 'late', 'trial', 'override'],
  ]);
  // Another Tuesday is untouched by Oct 20's overrides.
  assert.equal(resolveDay(tpl, ov, '2026-11-03').length, 2);
});

test('an unknown window id is dropped, not crashed on', () => {
  assert.deepEqual(resolveDay([T(1, 'carousels', 'midnight')], [], '2026-10-19'), []);
});

test('validateDay: LFD and Carousels never share a day; feed_mode only on reel types', () => {
  const day = (tpl: TemplateRow[]) => resolveDay(tpl, [], '2026-10-20');
  assert.deepEqual(validateDay(day([T(2, 'last_few_days', 'morning'), T(2, 'carousels', 'afternoon')])), [LFD_CAROUSEL_CONFLICT]);
  assert.deepEqual(validateDay(day([T(2, 'last_few_days', 'morning'), T(2, 'reels', 'morning', 'trial')])), []);
  assert.deepEqual(validateDay(day([T(2, 'reels', 'morning', null)])), ['Text on Screen (morning) needs Trial or Main feed.']);
  assert.deepEqual(validateDay(day([T(2, 'stories', 'morning_download', 'main')])), ['IG Stories posts aren’t reels, so they have no Trial or Main feed.']);
});

test('parity: the seeded template gives exactly today\'s windows on every weekday', () => {
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  for (const date of WEEK) {
    for (const v of VERTICAL_IDS) {
      const legacy = windowsOn(v, date, DEFAULT_SEED_INPUTS.lfdDays).map((w) => w.id);
      const now = resolveDay(tpl, [], date).filter((s) => s.vertical === v).map((s) => s.windowId);
      assert.deepEqual(now, legacy, `${v} on ${date}`);
    }
  }
});

test('seed: reels are Trial, explainers Main, everything else has no feed_mode, and every day validates', () => {
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  for (const r of tpl) {
    if (r.vertical === 'reels') assert.equal(r.feedMode, 'trial');
    else if (r.vertical === 'explainers') assert.equal(r.feedMode, 'main');
    else assert.equal(r.feedMode, null);
  }
  for (const date of WEEK) assert.deepEqual(validateDay(resolveDay(tpl, [], date)), [], date);
});

test('seed follows custom LFD and Stories days', () => {
  const tpl = seedTemplate({ lfdDays: [3], storyDays: { morning_download: [1], guess_the_number: [], free_vs_paid: [0] } });
  const wed = resolveDay(tpl, [], '2026-10-21');
  assert.ok(wed.some((s) => s.vertical === 'last_few_days'));
  assert.ok(!wed.some((s) => s.vertical === 'carousels'));
  assert.deepEqual(resolveDay(tpl, [], '2026-10-19').filter((s) => s.vertical === 'stories').map((s) => s.windowId), ['morning_download']);
});
