// tests/slots-book.test.ts — template-mode booking time and caps (pure)
import assert from 'node:assert/strict';
import test from 'node:test';

import { zonedTime } from '@/lib/instagram/clock';
import { chooseSlotTime } from '@/lib/social-hub/slots/book';
import { slotsWithinCap, type SlotPlan } from '@/lib/social-hub/slots';
import { type ResolvedSlot } from '@/lib/social-hub/slots/types';

const at = (d: string, h: number, m: number) => { const [y, mo, da] = d.split('-').map(Number); return zonedTime(y, mo, da, h, m, 'America/New_York'); };
const TODAY = '2026-10-20';
const DAY = '2026-10-21';
const NOW = at('2026-10-20', 9, 0);
const slot = (vertical: ResolvedSlot['vertical'], startMinute: number, feedMode: ResolvedSlot['feedMode'] = null, series: ResolvedSlot['series'] = null): ResolvedSlot =>
  ({ vertical, startMinute, series, feedMode, origin: 'template' });

const one = (d: string, ...slots: ResolvedSlot[]) => new Map([[d, slots]]);

test('rng 0 books the slot minute, rng 15 books slot + 15', () => {
  const s = one(TODAY, slot('explainers', 780, 'main'));
  assert.equal(chooseSlotTime(s, NOW, new Set(), [], () => 0, DAY)!.publishAt.getTime(), at(TODAY, 13, 0).getTime());
  assert.equal(chooseSlotTime(s, NOW, new Set(), [], (n) => (assert.equal(n, 16), 15), DAY)!.publishAt.getTime(), at(TODAY, 13, 15).getTime());
});

test('a busy feed post at slot+5 pushes a Main explainer to busy+30; a Trial reel ignores busy', () => {
  const busy = [at(TODAY, 13, 5)];
  const m = chooseSlotTime(one(TODAY, slot('explainers', 780, 'main')), NOW, new Set(), busy, () => 0, DAY)!;
  assert.equal(m.publishAt.getTime(), at(TODAY, 13, 35).getTime());
  assert.equal(m.feedMode, 'main');
  const t = chooseSlotTime(one(TODAY, slot('reels', 780, 'trial')), NOW, new Set(), busy, () => 0, DAY)!;
  assert.equal(t.publishAt.getTime(), at(TODAY, 13, 0).getTime());
});

test('a taken date|slotId is skipped; the same slot on another date is not', () => {
  const s = new Map([[TODAY, [slot('reels', 600, 'trial'), slot('reels', 700, 'trial')]], [DAY, [slot('reels', 600, 'trial')]]]);
  assert.equal(chooseSlotTime(s, NOW, new Set([`${TODAY}|t0600`]), [], () => 0)!.slot, 't0700');
  const next = chooseSlotTime(s, NOW, new Set([`${TODAY}|t0600`, `${TODAY}|t0700`]), [], () => 0)!;
  assert.deepEqual([next.nyDate, next.slot], [DAY, 't0600']);
  assert.equal(chooseSlotTime(s, NOW, new Set([`${TODAY}|t0600`, `${TODAY}|t0700`, `${DAY}|t0600`]), [], () => 0), null);
});

test('a slot already past is skipped; one inside its drift books the remaining minutes', () => {
  const s = one(TODAY, slot('reels', 525, 'trial'), slot('reels', 1080, 'trial'));
  assert.equal(chooseSlotTime(s, at(TODAY, 9, 20), new Set(), [], () => 0, TODAY)!.slot, 't1080');
  const inside = chooseSlotTime(s, at(TODAY, 8, 50), new Set(), [], () => 0, TODAY)!;
  assert.equal(inside.slot, 't0525');
  assert.equal(inside.publishAt.getTime(), at(TODAY, 8, 51).getTime());
});

test('rolls to the next date, ignores past dates, stops after throughDate', () => {
  const s = new Map([['2026-10-19', [slot('reels', 1000, 'trial')]], [TODAY, [slot('reels', 525, 'trial')]], [DAY, [slot('reels', 525, 'trial')]]]);
  assert.equal(chooseSlotTime(s, at(TODAY, 10, 0), new Set(), [], () => 0)!.nyDate, DAY);
  assert.equal(chooseSlotTime(s, at(TODAY, 10, 0), new Set(), [], () => 0, TODAY), null);
});

test('slots differ by date: LFD on Tue only never books Wed; an override slot is found on its date only', () => {
  const s = new Map([[TODAY, [slot('last_few_days', 540)]], [DAY, []]]);
  const used = new Set([`${TODAY}|t0540`]);
  assert.equal(chooseSlotTime(s, NOW, used, [], () => 0), null);
  const o = new Map([[TODAY, [slot('reels', 1000, 'trial')]], [DAY, [slot('reels', 1000, 'trial'), slot('reels', 1100, 'trial')]]]);
  const got = chooseSlotTime(o, NOW, new Set([`${TODAY}|t1000`, `${DAY}|t1000`]), [], () => 0)!;
  assert.deepEqual([got.nyDate, got.slot], [DAY, 't1100']);
});

test('slotsWithinCap: 4 explainer slots, cap 3 -> first 3 by time made, 1 over; Stories cap is per series', () => {
  const plan: SlotPlan = { from: DAY, to: DAY, byDate: new Map([[DAY, [
    slot('explainers', 1000, 'main'), slot('explainers', 780, 'main'), slot('explainers', 900, 'main'), slot('explainers', 600, 'main'),
    slot('stories', 510, null, 'morning_download'), slot('stories', 600, null, 'morning_download'), slot('stories', 700, null, 'morning_download'), slot('stories', 520, null, 'free_vs_paid'),
  ]]]) };
  const e = slotsWithinCap(plan, 'explainers', DAY, 3);
  assert.deepEqual(e.made.map((s) => s.startMinute), [600, 780, 900]);
  assert.deepEqual(e.over.map((s) => s.startMinute), [1000]);
  const st = slotsWithinCap(plan, 'stories', DAY, 2);
  assert.equal(st.made.length, 3);
  assert.deepEqual(st.over.map((s) => s.startMinute), [700]);
});
