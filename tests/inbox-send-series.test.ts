/**
 * Today-centered warmup + campaign send series (inbox drawer chart).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { inboxStatusHeadline, stageActionsFor } from '@/lib/inboxes/drawer-status';
import {
  actualTotals,
  buildSendSeries,
  countsByDate,
  projectWarmup,
} from '@/lib/inboxes/send-series';

test('series is 15 days with today in the middle', () => {
  const days = buildSendSeries({
    today: '2026-09-17',
    warmupByDate: { '2026-09-16': 2, '2026-09-17': 4 },
    warmupRamp: { enabled: true, currentDaily: 10, maxPerDay: 30, dailyRampup: 5 },
    campaignByDate: { '2026-09-16': 3 },
    campaignCapacityByDate: { '2026-09-18': 0, '2026-09-24': 0 },
  });
  assert.equal(days.length, 15);
  assert.equal(days[0].date, '2026-09-10');
  assert.equal(days[7].date, '2026-09-17');
  assert.equal(days[7].kind, 'today');
  assert.equal(days[14].date, '2026-09-24');
  assert.equal(days[14].kind, 'future');
  assert.equal(days[6].warmup, 2);
  assert.equal(days[7].warmup, 4);
});

test('future warmup ramps from Smartlead current daily toward max', () => {
  assert.equal(projectWarmup({ enabled: true, currentDaily: 10, maxPerDay: 30, dailyRampup: 5 }, 1), 15);
  assert.equal(projectWarmup({ enabled: true, currentDaily: 10, maxPerDay: 30, dailyRampup: 5 }, 5), 30);
  assert.equal(projectWarmup({ enabled: false, currentDaily: 10, maxPerDay: 30, dailyRampup: 5 }, 1), 0);
});

test('future campaign uses capacity, not history', () => {
  const days = buildSendSeries({
    today: '2026-09-17',
    warmupByDate: {},
    warmupRamp: { enabled: false, currentDaily: 0, maxPerDay: 0, dailyRampup: 5 },
    campaignByDate: { '2026-09-17': 9 },
    campaignCapacityByDate: { '2026-09-18': 3, '2026-09-19': 4 },
  });
  assert.equal(days[7].campaign, 9);
  assert.equal(days[8].campaign, 3);
  assert.equal(days[9].campaign, 4);
  assert.equal(days[8].warmup, 0);
});

test('warming capacity of zero stays zero on the campaign future line', () => {
  const days = buildSendSeries({
    today: '2026-09-17',
    warmupByDate: { '2026-09-17': 2 },
    warmupRamp: { enabled: true, currentDaily: 15, maxPerDay: 40, dailyRampup: 5 },
    campaignByDate: {},
    campaignCapacityByDate: {},
  });
  assert.equal(days[8].campaign, 0);
  assert.equal(days[8].warmup, 20);
});

test('actual totals ignore the planned future half', () => {
  const days = buildSendSeries({
    today: '2026-09-17',
    warmupByDate: { '2026-09-16': 2, '2026-09-17': 1 },
    warmupRamp: { enabled: true, currentDaily: 10, maxPerDay: 30, dailyRampup: 5 },
    campaignByDate: { '2026-09-16': 4 },
    campaignCapacityByDate: { '2026-09-18': 12 },
  });
  assert.deepEqual(actualTotals(days), { warmup: 3, campaign: 4 });
});

test('countsByDate reads Smartlead stats_by_date sent_count', () => {
  assert.deepEqual(
    countsByDate([{ date: '2026-09-16', sent_count: 2 }, { date: '2026-09-17', sent: 4 }]),
    { '2026-09-16': 2, '2026-09-17': 4 },
  );
});

test('drawer headline is one current-state line', () => {
  assert.equal(
    inboxStatusHeadline({ lifecycleStage: 'warming', linked: true, warmupEnabled: true }),
    'Warmup is active',
  );
  assert.equal(
    inboxStatusHeadline({ lifecycleStage: 'warming', linked: true, warmupEnabled: false }),
    'Warmup is off',
  );
  assert.equal(
    inboxStatusHeadline({ lifecycleStage: 'resting', linked: false, warmupEnabled: false }),
    'Not in Smartlead',
  );
  assert.equal(
    inboxStatusHeadline({ lifecycleStage: 'retired', linked: false, warmupEnabled: false }),
    null,
  );
});

test('Start warmup is hidden when Smartlead warmup is already on', () => {
  const warmingOn = stageActionsFor('warming', true).map((action) => action.label);
  assert.equal(warmingOn.includes('Start warmup'), false);
  assert.equal(warmingOn.includes('Start warmup now'), false);
  const warmingOff = stageActionsFor('warming', false).map((action) => action.label);
  assert.ok(warmingOff.includes('Start warmup'));
  assert.ok(stageActionsFor('provisioning').some((action) => action.label === 'Start warmup'));
  assert.ok(stageActionsFor('resting').some((action) => action.label === 'Restart warmup'));
});
