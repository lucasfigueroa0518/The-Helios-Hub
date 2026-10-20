/** The one shared placement rule set (calendar week board spec, Must handle §1, §3; Review Focus 2, 3). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';
import { applyMove, applyPlace, applyRemove, canPlace, gapsFor, NO_TIME_LEFT, type DayCtx } from '@/lib/social-hub/slots/rules';
import { DEFAULT_CAPS } from '@/lib/social-hub/slots/times';
import type { ResolvedSlot } from '@/lib/social-hub/slots/types';

const S = (vertical: ResolvedSlot['vertical'], startMinute: number, extra: Partial<ResolvedSlot> = {}): ResolvedSlot => ({
  vertical, startMinute, series: null,
  feedMode: vertical === 'reels' ? 'trial' : vertical === 'explainers' ? 'main' : null,
  origin: 'template', ...extra,
});
// Wed 2026-10-21; "today" is earlier so nothing is locked unless a test says so.
const day = (slots: ResolvedSlot[], over: Partial<DayCtx> = {}): DayCtx => ({ nyDate: '2026-10-21', weekday: 3, slots, today: '2026-10-20', nowMinute: 600, ...over });

test('canPlace: no Carousel on a Last Few Days day', () => {
  const r = canPlace(day([S('last_few_days', 540)]), { vertical: 'carousels', startMinute: 870, series: null });
  assert.deepEqual(r, { ok: false, reason: LFD_CAROUSEL_CONFLICT });
});

test('canPlace: one slot per (type, minute); one series twice at different times is fine', () => {
  const r = canPlace(day([S('explainers', 720)]), { vertical: 'explainers', startMinute: 720, series: null });
  assert.equal(r.ok, false);
  assert.deepEqual(canPlace(day([S('reels', 720)]), { vertical: 'explainers', startMinute: 720, series: null }), { ok: true, minute: 720 });
  const stories = day([S('stories', 510, { series: 'morning_download' })]);
  assert.deepEqual(canPlace(stories, { vertical: 'stories', startMinute: 900, series: 'morning_download' }), { ok: true, minute: 900 });
  assert.equal(canPlace(stories, { vertical: 'stories', startMinute: 510, series: 'morning_download' }).ok, false);
  assert.equal(canPlace(stories, { vertical: 'stories', startMinute: 510, series: 'guess_the_number' }).ok, true);
});

test('canPlace: today, a passed time moves to the next 15-minute mark; no time left is refused', () => {
  const today = day([], { nyDate: '2026-10-20', weekday: 2, nowMinute: 600 });
  assert.deepEqual(canPlace(today, { vertical: 'carousels', startMinute: 540, series: null }), { ok: true, minute: 615 });
  assert.deepEqual(canPlace(today, { vertical: 'carousels', startMinute: 600, series: null }), { ok: true, minute: 615 });
  assert.deepEqual(canPlace(today, { vertical: 'carousels', startMinute: 630, series: null }), { ok: true, minute: 630 });
  const late = { ...today, nowMinute: 1250 };
  assert.deepEqual(canPlace(late, { vertical: 'carousels', startMinute: 540, series: null }), { ok: false, reason: NO_TIME_LEFT });
  assert.equal(NO_TIME_LEFT, 'No time left today.');
  assert.equal(canPlace(day([], { nyDate: '2026-10-19', weekday: 1 }), { vertical: 'carousels', startMinute: 900, series: null }).ok, false);
});

test('canPlace: 8 AM to 9 PM, the 15-minute grid, series only on Stories', () => {
  const d = day([]);
  assert.equal(canPlace(d, { vertical: 'reels', startMinute: 465, series: null }).ok, false);
  assert.equal(canPlace(d, { vertical: 'reels', startMinute: 1260, series: null }).ok, false);
  assert.equal(canPlace(d, { vertical: 'reels', startMinute: 1245, series: null }).ok, true);
  assert.equal(canPlace(d, { vertical: 'reels', startMinute: 481, series: null }).ok, false);
  assert.equal(canPlace(d, { vertical: 'stories', startMinute: 510, series: null }).ok, false);
  assert.equal(canPlace(d, { vertical: 'reels', startMinute: 510, series: 'morning_download' }).ok, false);
  // The template (Standard week) has no "now".
  assert.equal(canPlace(day([], { nyDate: null, today: '2026-10-21', nowMinute: 1250 }), { vertical: 'reels', startMinute: 525, series: null }).ok, true);
});

test('canPlace: LFD on a Carousel day asks to remove the Carousels; a second LFD is refused', () => {
  const r = canPlace(day([S('carousels', 540)]), { vertical: 'last_few_days', startMinute: 540, series: null });
  assert.deepEqual(r, { ok: false, reason: LFD_CAROUSEL_CONFLICT, confirm: 'remove-carousels' });
  assert.equal(canPlace(day([S('last_few_days', 540)]), { vertical: 'last_few_days', startMinute: 600, series: null }).ok, false);
});

test('applyPlace adds a sorted slot with the adjusted minute; clearCarousels replaces them with LFD', () => {
  const r = applyPlace(day([S('explainers', 780)]), { vertical: 'reels', startMinute: 525, series: null });
  assert.ok(r.ok);
  assert.deepEqual(r.slots.map((s) => [s.vertical, s.startMinute, s.feedMode, s.origin]), [['reels', 525, 'trial', 'override'], ['explainers', 780, 'main', 'template']]);
  assert.equal(applyPlace(day([S('carousels', 540)]), { vertical: 'last_few_days', startMinute: 540, series: null }).ok, false);
  const lfd = applyPlace(day([S('carousels', 540), S('carousels', 870), S('reels', 525)]), { vertical: 'last_few_days', startMinute: 540, series: null }, { clearCarousels: true });
  assert.ok(lfd.ok);
  assert.deepEqual(lfd.slots.map((s) => s.vertical), ['reels', 'last_few_days']);
  const t = applyPlace(day([], { nyDate: null }), { vertical: 'explainers', startMinute: 720, series: null, feedMode: 'trial' });
  assert.ok(t.ok);
  assert.deepEqual([t.slots[0]!.feedMode, t.slots[0]!.origin], ['trial', 'template']);
});

test('applyMove: LFD onto a Carousel day is refused; onto its own key is a no-op; across days moves it', () => {
  const tue = day([S('last_few_days', 540)], { nyDate: '2026-10-27', weekday: 2 });
  const thu = day([S('carousels', 540)], { nyDate: '2026-10-29', weekday: 4 });
  const lfdKey = { vertical: 'last_few_days' as const, startMinute: 540, series: null };
  assert.deepEqual(applyMove(tue, thu, lfdKey, 600), { ok: false, reason: LFD_CAROUSEL_CONFLICT, confirm: 'remove-carousels' });
  const same = applyMove(tue, tue, lfdKey, 540);
  assert.ok(same.ok);
  assert.equal(same.noop, true);
  assert.deepEqual(same.from, tue.slots);
  // Within a day, the slot ignores itself.
  const within = applyMove(tue, tue, lfdKey, 555);
  assert.ok(within.ok);
  assert.deepEqual(within.to.map((s) => s.startMinute), [555]);
  assert.deepEqual(within.from, within.to);
  // Across days.
  const wed = day([S('reels', 525)]);
  const across = applyMove(tue, wed, lfdKey, 570);
  assert.ok(across.ok);
  assert.deepEqual(across.from, []);
  assert.deepEqual(across.to.map((s) => [s.vertical, s.startMinute]), [['reels', 525], ['last_few_days', 570]]);
  // A missing slot or a started one can't move.
  assert.equal(applyMove(wed, wed, { vertical: 'carousels', startMinute: 540, series: null }, 600).ok, false);
  const today = day([S('carousels', 540)], { nyDate: '2026-10-20', weekday: 2, today: '2026-10-20', nowMinute: 600 });
  assert.equal(applyMove(today, wed, { vertical: 'carousels', startMinute: 540, series: null }, 870).ok, false);
});

test('applyRemove: drops the slot; started or past slots are locked', () => {
  const wed = day([S('reels', 525), S('explainers', 780)]);
  const r = applyRemove(wed, { vertical: 'reels', startMinute: 525, series: null });
  assert.ok(r.ok);
  assert.deepEqual(r.slots.map((s) => s.vertical), ['explainers']);
  const today = day([S('reels', 525), S('explainers', 780)], { nyDate: '2026-10-20', weekday: 2, nowMinute: 600 });
  assert.equal(applyRemove(today, { vertical: 'reels', startMinute: 525, series: null }).ok, false);
  assert.equal(applyRemove(today, { vertical: 'explainers', startMinute: 780, series: null }).ok, true);
  assert.equal(applyRemove(wed, { vertical: 'carousels', startMinute: 540, series: null }).ok, false);
});

test('gapsFor: feed posts under 30 minutes apart, Trial reels exempt', () => {
  const kinds = (slots: ResolvedSlot[]) => gapsFor(day(slots), slots, DEFAULT_CAPS).map((g) => g.kind);
  assert.ok(kinds([S('explainers', 780), S('carousels', 795)]).includes('feed-gap'));
  assert.ok(!kinds([S('reels', 780), S('carousels', 795)]).includes('feed-gap'));
  assert.ok(!kinds([S('explainers', 780), S('carousels', 810)]).includes('feed-gap'));
});

test('gapsFor: over the daily cap', () => {
  const slots = [S('explainers', 780), S('explainers', 810), S('explainers', 930), S('explainers', 960)];
  const over = gapsFor(day(slots), slots, DEFAULT_CAPS).filter((g) => g.kind === 'over-cap');
  assert.deepEqual(over.map((g) => g.text), ['Wed has 4 Explainers; only 3 will be made.']);
});

test('gapsFor: outside a usual window, no Explainer, no Stories, fewer than standard', () => {
  const standard = [S('explainers', 780), S('stories', 510, { series: 'morning_download' }), S('reels', 525)];
  const gaps = gapsFor(day([S('explainers', 720)]), standard, DEFAULT_CAPS);
  const kinds = gaps.map((g) => g.kind);
  assert.ok(kinds.includes('outside-usual'));
  assert.ok(kinds.includes('no-stories'));
  assert.ok(kinds.includes('fewer-than-standard'));
  assert.ok(!kinds.includes('no-explainer'));
  const outside = gaps.find((g) => g.kind === 'outside-usual')!;
  assert.deepEqual(outside.fix, { op: 'move', key: { vertical: 'explainers', startMinute: 720, series: null }, toMinute: 780 });
  const stories = gaps.find((g) => g.kind === 'no-stories')!;
  assert.deepEqual(stories.fix, { op: 'place', vertical: 'stories', startMinute: 510, series: 'morning_download', feedMode: null });

  const empty = gapsFor(day([S('reels', 525)]), [S('reels', 525)], DEFAULT_CAPS);
  const noExp = empty.find((g) => g.kind === 'no-explainer')!;
  assert.deepEqual(noExp.fix, { op: 'place', vertical: 'explainers', startMinute: 780, series: null, feedMode: 'main' });
  // A fix is only offered when the rules would allow it: late today it moves past now, or goes away.
  const lateToday = gapsFor(day([S('reels', 525)], { nyDate: '2026-10-20', weekday: 2, nowMinute: 1250 }), [S('reels', 525)], DEFAULT_CAPS);
  assert.equal(lateToday.find((g) => g.kind === 'no-explainer')!.fix, undefined);
  const noonToday = gapsFor(day([S('reels', 525)], { nyDate: '2026-10-20', weekday: 2, nowMinute: 800 }), [S('reels', 525)], DEFAULT_CAPS);
  assert.deepEqual(noonToday.find((g) => g.kind === 'no-explainer')!.fix, { op: 'place', vertical: 'explainers', startMinute: 810, series: null, feedMode: 'main' });
});
