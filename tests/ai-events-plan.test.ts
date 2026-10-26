/**
 * AI Events on the plan and the calendar (AE-08, AE-29): two Sunday slots, Miami 6:00–7:00 PM and
 * Boston 7:00–8:00 PM, its day's count,
 * the seeded template, the week board's rules and template mode. Pure, plus one PGlite read.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isAiEventsDay, slotsWithinCap, type SlotPlan } from '@/lib/social-hub/slots';
import { resolveDay, validateDay, AI_EVENTS_TWICE } from '@/lib/social-hub/slots/resolve';
import { AI_EVENTS_ONCE, canPlace, type DayCtx } from '@/lib/social-hub/slots/rules';
import { DEFAULT_SEED_INPUTS, readSeedInputs, seedTemplate } from '@/lib/social-hub/slots/seed';
import { asSlotId, legacyKey } from '@/lib/social-hub/slots/legacy';
import { DEFAULT_CAPS, DEFAULT_TIMES, isFeedSlot, TYPE_NAME } from '@/lib/social-hub/slots/times';
import type { ResolvedSlot } from '@/lib/social-hub/slots/types';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { slotsForDay } from '@/lib/social-hub/views/today';

import { openHubTestDb } from './fixtures/social-hub/pglite';

// Mon 2026-10-19 … Sun 2026-10-25.
const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const SUNDAY = '2026-10-25';

test('legacy plan: the evening and night windows on Sundays only', () => {
  for (const day of WEEK) assert.equal(windowsOn('ai_events', day).length, day === SUNDAY ? 2 : 0, day);
  assert.deepEqual(windowsOn('ai_events', SUNDAY).map((w) => [w.id, w.label, w.startMinute, w.endMinute]), [
    ['evening', 'Evening', 1080, 1140],
    ['night', 'Night', 1140, 1200],
  ]);
  assert.deepEqual(legacyKey('ai_events', 'evening'), { startMinute: 1080, series: null });
  assert.deepEqual(legacyKey('ai_events', 'night'), { startMinute: 1140, series: null });
  assert.equal(asSlotId('ai_events', 'evening'), 't1080');
  assert.equal(asSlotId('ai_events', 'night'), 't1140');
  assert.deepEqual([DEFAULT_TIMES.ai_events, DEFAULT_CAPS.ai_events, TYPE_NAME.ai_events.one], [[1080, 1140], 2, 'AI Events']);
  assert.equal(isFeedSlot({ vertical: 'ai_events', feedMode: null }), true, 'a feed post: spaced from the others');
});

test('a Sunday’s slots count one AI Events post while its quota is on, none while off', () => {
  const quotas = { reels: 0, carousels: 0, explainers: 0, last_few_days: 0, lfdDays: [] as number[] };
  // Sunday: Morning Download (the only Stories series that day) + AI Events.
  assert.deepEqual(slotsForDay([], SUNDAY, { ...quotas, ai_events: 1 }), { slots: 2, filled: 0 });
  assert.deepEqual(slotsForDay([], SUNDAY, { ...quotas, ai_events: 0 }), { slots: 1, filled: 0 });
  // Monday: Morning Download + Guess the Number, and no AI Events slot.
  assert.equal(slotsForDay([], '2026-10-26', { ...quotas, ai_events: 1 }).slots, 2);
});

test('the seeded template gives AI Events Sunday at 6:00 and 7:00 PM and parity with the legacy plan every day', () => {
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  assert.deepEqual(tpl.filter((r) => r.vertical === 'ai_events').map((r) => [r.weekday, r.startMinute, r.feedMode, r.series]), [[0, 1080, null, null], [0, 1140, null, null]]);
  for (const date of WEEK) {
    const day = resolveDay(tpl, [], date);
    assert.deepEqual(validateDay(day), [], date);
    assert.equal(day.filter((s) => s.vertical === 'ai_events').length, windowsOn('ai_events', date).length, date);
  }
  const custom = seedTemplate({ ...DEFAULT_SEED_INPUTS, aiEventsDays: [6] });
  assert.deepEqual(custom.filter((r) => r.vertical === 'ai_events').map((r) => r.weekday), [6, 6]);
  // Older callers without the field get Sunday.
  const legacy = seedTemplate({ lfdDays: [2, 5], storyDays: DEFAULT_SEED_INPUTS.storyDays });
  assert.deepEqual(legacy.filter((r) => r.vertical === 'ai_events').map((r) => r.weekday), [0, 0]);
});

test('readSeedInputs reads ai_events.settings days, defaulting to Sunday', async () => {
  const { query } = await openHubTestDb();
  assert.deepEqual((await readSeedInputs(query)).aiEventsDays, [0]);
  await query(`UPDATE ai_events.settings SET value = '[6, 0]'::jsonb WHERE key = 'days'`);
  assert.deepEqual((await readSeedInputs(query)).aiEventsDays, [0, 6]);
});

const slot = (startMinute: number): ResolvedSlot => ({ vertical: 'ai_events', startMinute, series: null, feedMode: null, origin: 'template' });

test('the week board: AI Events posts at most twice a day; three in a day never validate', () => {
  const ctx: DayCtx = { nyDate: null, weekday: 0, slots: [slot(1080)], today: '2026-10-21', nowMinute: 600 };
  assert.deepEqual(canPlace(ctx, { vertical: 'ai_events', startMinute: 1140, series: null }), { ok: true, minute: 1140 });
  const third = canPlace({ ...ctx, slots: [slot(1080), slot(1140)] }, { vertical: 'ai_events', startMinute: 1200, series: null });
  assert.deepEqual(third, { ok: false, reason: AI_EVENTS_ONCE });
  assert.deepEqual(canPlace({ ...ctx, slots: [] }, { vertical: 'ai_events', startMinute: 1080, series: null }), { ok: true, minute: 1080 });
  assert.deepEqual(validateDay([slot(1080), slot(1140)]), []);
  assert.deepEqual(validateDay([slot(1080), slot(1140), slot(1200)]), [AI_EVENTS_TWICE]);
});

test('template mode: the calendar says which days are AI Events days, under the daily limit', () => {
  const plan: SlotPlan = { from: SUNDAY, to: '2026-10-26', byDate: new Map([[SUNDAY, [slot(1080)]], ['2026-10-26', []]]) };
  assert.equal(isAiEventsDay(plan, SUNDAY), true);
  assert.equal(isAiEventsDay(plan, '2026-10-26'), false);
  assert.equal(slotsWithinCap(plan, 'ai_events', SUNDAY, 1).made.length, 1);
  assert.equal(slotsWithinCap(plan, 'ai_events', SUNDAY, 0).made.length, 0);
  assert.equal(windowsOn('ai_events', '2026-10-26', [], { [SUNDAY]: [slot(1080)], '2026-10-26': [{ ...slot(1080) }] }).length, 1, 'a Monday slot on the calendar wins over the legacy days');
});
