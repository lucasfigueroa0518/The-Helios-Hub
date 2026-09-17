/**
 * S7 acceptance — fixed fees are stored once per cycle and clocked in full
 * when the cycle overlaps the reporting window. Offline: no database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_AGENTMAIL_USD_PER_SEND,
  clockSmartleadUsd,
  allocateSmartleadByCapacity,
  cycleBounds,
  cycleOverlapsWindow,
  cycleStartFor,
  cycleTag,
  leadDeliveryCostUsd,
  type CycleAmortization,
} from '@/lib/smartlead/costs';
import { AGENTMAIL_USD_PER_SEND } from '@/lib/analytics-lead-facts';

test('legacy AgentMail pricing matches the historical $0.002 per send', () => {
  assert.equal(LEGACY_AGENTMAIL_USD_PER_SEND, AGENTMAIL_USD_PER_SEND);
  assert.equal(LEGACY_AGENTMAIL_USD_PER_SEND, 0.002);
});

test('per-lead Smartlead cost is the verifier only — the $94 month is not sliced onto the lead', () => {
  const cycles = new Map<string, CycleAmortization>([
    ['2026-09', { cycle: '2026-09', fixedUsd: 94, step1Sends: 10, perSendUsd: 0 }],
  ]);
  assert.equal(
    leadDeliveryCostUsd(cycles, { sentCycle: '2026-09', verifierUsd: 0, provider: 'smartlead' }),
    0,
  );
  assert.equal(
    leadDeliveryCostUsd(cycles, { sentCycle: '2026-09', verifierUsd: 0.05, provider: 'smartlead' }),
    0.05,
  );
});

test('a cycle with zero sends does not invent a per-lead figure', () => {
  const cycles = new Map<string, CycleAmortization>([
    ['2026-09', { cycle: '2026-09', fixedUsd: 94, step1Sends: 0, perSendUsd: 0 }],
  ]);
  assert.equal(
    leadDeliveryCostUsd(cycles, { sentCycle: '2026-09', verifierUsd: 0, provider: 'smartlead' }),
    0,
  );
});

test('legacy AgentMail rows keep the old constant and never share the Smartlead fee', () => {
  const cycles = new Map<string, CycleAmortization>([
    ['2026-09', { cycle: '2026-09', fixedUsd: 100, step1Sends: 10, perSendUsd: 10 }],
  ]);
  assert.equal(
    leadDeliveryCostUsd(cycles, { sentCycle: '2026-09', verifierUsd: 0, provider: 'agentmail' }),
    LEGACY_AGENTMAIL_USD_PER_SEND,
  );
});

test('billing cycles start on the configured day and roll back a month before it', () => {
  assert.equal(cycleStartFor('2026-09-16', 16), '2026-09-16');
  assert.equal(cycleStartFor('2026-09-15', 16), '2026-08-16');
  assert.equal(cycleTag('2026-09-16', 16), '2026-09');
  assert.equal(cycleTag('2026-09-15', 16), '2026-08');
});

test('a billing cycle on the 16th covers that day through the next 15th', () => {
  assert.deepEqual(cycleBounds('2026-09', 16), { start: '2026-09-16', endExclusive: '2026-10-16' });
  assert.equal(cycleOverlapsWindow('2026-09', 16, '2026-09-20', '2026-09-26'), true);
  assert.equal(cycleOverlapsWindow('2026-09', 16, '2026-09-01', '2026-09-15'), false);
  assert.equal(cycleOverlapsWindow('2026-08', 16, '2026-09-01', '2026-09-15'), true);
});

test('the full Smartlead month is clocked once, not incrementally', () => {
  assert.equal(clockSmartleadUsd(94, '2026-09-01', '2026-09-30'), 94);
  assert.equal(clockSmartleadUsd(94, '2026-08-18', '2026-09-16'), 94);
});

test('a week prorates Smartlead by days in that month', () => {
  assert.equal(clockSmartleadUsd(94, '2026-09-10', '2026-09-16'), 94 * (7 / 30));
});

test('a short range that straddles months prorates each month separately', () => {
  const expected = 94 * (3 / 30) + 94 * (4 / 31);
  assert.equal(clockSmartleadUsd(94, '2026-09-28', '2026-10-04'), expected);
});

test('ranges longer than a month take the full fee once per calendar month', () => {
  assert.equal(clockSmartleadUsd(94, '2026-09-01', '2026-10-31'), 188);
});

test('used send capacity peels that share of Smartlead out of unused', () => {
  const half = allocateSmartleadByCapacity({
    clockedUsd: 94,
    usedSends: 45000,
    capacitySends: 90000,
  });
  assert.equal(half.usedRatio, 0.5);
  assert.equal(half.usedUsd, 47);
  assert.equal(half.unusedUsd, 47);

  const none = allocateSmartleadByCapacity({
    clockedUsd: 21.93,
    usedSends: 0,
    capacitySends: 21000,
  });
  assert.equal(none.usedUsd, 0);
  assert.equal(none.unusedUsd, 21.93);

  const capped = allocateSmartleadByCapacity({
    clockedUsd: 94,
    usedSends: 100000,
    capacitySends: 90000,
  });
  assert.equal(capped.usedUsd, 94);
  assert.equal(capped.unusedUsd, 0);
});
