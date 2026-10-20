// tests/slots-book.test.ts — template-mode booking time and caps (pure)
import assert from 'node:assert/strict';
import test from 'node:test';

import { zonedTime } from '@/lib/instagram/clock';
import { chooseSlotTime } from '@/lib/social-hub/slots/book';
import { slotsWithinCap, type SlotPlan } from '@/lib/social-hub/slots';
import { slotId, type ResolvedSlot } from '@/lib/social-hub/slots/types';

const at = (d: string, h: number, m: number) => { const [y, mo, da] = d.split('-').map(Number); return zonedTime(y, mo, da, h, m, 'America/New_York'); };
const DAY = '2026-10-21';
const NOW = at('2026-10-20', 9, 0);
const slot = (vertical: ResolvedSlot['vertical'], startMinute: number, feedMode: ResolvedSlot['feedMode'] = null, series: ResolvedSlot['series'] = null): ResolvedSlot =>
  ({ vertical, startMinute, series, feedMode, origin: 'template' });

test('rng 0 books the slot minute, rng 15 books slot + 15', () => {
  const s = [slot('explainers', 780, 'main')];
  assert.equal(chooseSlotTime(s, NOW, new Set(), [], () => 0, DAY)!.publishAt.getTime(), at('2026-10-20', 13, 0).getTime());
  assert.equal(chooseSlotTime(s, NOW, new Set(), [], (n) => (assert.equal(n, 16), 15), DAY)!.publishAt.getTime(), at('2026-10-20', 13, 15).getTime());
});

test('a busy feed post at slot+5 pushes a Main explainer to busy+30; a Trial reel ignores busy', () => {
  const busy = [at('2026-10-20', 13, 5)];
  const m = chooseSlotTime([slot('explainers', 780, 'main')], NOW, new Set(), busy, () => 0, DAY)!;
  assert.equal(m.publishAt.getTime(), at('2026-10-20', 13, 35).getTime());
  assert.equal(m.feedMode, 'main');
  const t = chooseSlotTime([slot('reels', 780, 'trial')], NOW, new Set(), busy, () => 0, DAY)!;
  assert.equal(t.publishAt.getTime(), at('2026-10-20', 13, 0).getTime());
});

test('a taken slotId is skipped (this day by date key, every day by bare id)', () => {
  const s = [slot('reels', 600, 'trial'), slot('reels', 700, 'trial')];
  assert.equal(chooseSlotTime(s, NOW, new Set([slotId(600, null)]), [], () => 0, '2026-10-20')!.slot, 't0700');
  const next = chooseSlotTime(s, NOW, new Set(['2026-10-20|t0600']), [], () => 0)!;
  assert.deepEqual([next.nyDate, next.slot], ['2026-10-20', 't0700']);
});

test('a slot already past is skipped; one inside its drift books the remaining minutes', () => {
  const s = [slot('reels', 525, 'trial'), slot('reels', 1080, 'trial')];
  const past = chooseSlotTime(s, at('2026-10-20', 9, 20), new Set(), [], () => 0, '2026-10-20')!;
  assert.equal(past.slot, 't1080');
  const inside = chooseSlotTime(s, at('2026-10-20', 8, 50), new Set(), [], () => 0, '2026-10-20')!;
  assert.equal(inside.slot, 't0525');
  assert.equal(inside.publishAt.getTime(), at('2026-10-20', 8, 51).getTime());
});

test('rolls to the next day and returns null with nothing left', () => {
  const s = [slot('reels', 525, 'trial')];
  assert.equal(chooseSlotTime(s, at('2026-10-20', 10, 0), new Set(), [], () => 0)!.nyDate, '2026-10-21');
  assert.equal(chooseSlotTime(s, at('2026-10-20', 10, 0), new Set(), [], () => 0, '2026-10-20'), null);
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
