import assert from 'node:assert/strict';
import test from 'node:test';

import { readDayQuotas } from '@/lib/social-hub/queries/day';
import type { Vertical } from '@/lib/social-hub/types';
import { daySlots } from '@/lib/social-hub/views/calendar';
import { quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { slotsForDay } from '@/lib/social-hub/views/today';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const TUE_8 = new Date('2026-10-13T12:00:00Z');

test('carousel windows close on Last Few Days days only when asked', () => {
  assert.equal(windowsOn('carousels', '2026-10-13').length, 2);
  assert.equal(windowsOn('carousels', '2026-10-13', [2, 5]).length, 0);
  assert.equal(windowsOn('carousels', '2026-10-14', [2, 5]).length, 2);
  assert.equal(windowsOn('last_few_days', '2026-10-13').length, 1);
  assert.equal(windowsOn('last_few_days', '2026-10-14').length, 0);
});

test('a Tuesday’s slots: one Last Few Days post instead of two carousels while it is on', () => {
  const quotas = { reels: 0, carousels: 2, explainers: 0, last_few_days: 1, lfdDays: [2, 5] };
  // Tuesday: Morning Download (1) + Free vs. Paid (1) + Last Few Days (1); no carousels.
  assert.deepEqual(slotsForDay([], '2026-10-13', quotas), { slots: 3, filled: 0 });
  assert.deepEqual(slotsForDay([], '2026-10-13', { ...quotas, lfdDays: [] }), { slots: 5, filled: 0 });
  assert.deepEqual(quotaCandidates({ posts: [], ideas: [], dayQuotas: quotas }, 'carousels', TUE_8), []);
  assert.equal(quotaCandidates({ posts: [], ideas: [], dayQuotas: { ...quotas, lfdDays: [] } }, 'carousels', TUE_8).length, 2);
});

test('the calendar’s open slots on a Tuesday follow the same rule', () => {
  const types = new Set<Vertical>(['carousels', 'last_few_days']);
  const open = (off: number[]) => daySlots([], '2026-10-13', types, new Date('2026-10-13T11:00:00Z'), off)
    .map((s) => (s.kind === 'open' ? `${s.vertical}:${s.window.id}` : 'post'))
    .sort();
  assert.deepEqual(open([2, 5]), ['last_few_days:morning']);
  assert.deepEqual(open([]), ['carousels:afternoon', 'carousels:morning', 'last_few_days:morning']);
});

test('readDayQuotas carries the carousel days off from lfd.settings', async () => {
  const { query } = await openHubTestDb();
  assert.deepEqual((await readDayQuotas(query, Promise.resolve(query))).lfdDays, []);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  const q = await readDayQuotas(query, Promise.resolve(query));
  assert.deepEqual([q.lfdDays, q.last_few_days], [[2, 5], 1]);
});
