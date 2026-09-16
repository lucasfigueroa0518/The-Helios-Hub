/**
 * S3 acceptance — capacity table, stage machine, domain rest clock.
 * Offline: pure functions only, no database and no Smartlead.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORECAST_NOTE,
  businessDaysBetween,
  clampGrowth,
  forecastForLane,
  identityCapacity,
  laneCapacity,
  monthlyCeiling,
  plannedPerMailbox,
  roundRobinAllocate,
  stageCap,
  totalDailyBudget,
  varianceFlag,
  type CapacityInbox,
} from '@/lib/inboxes/capacity';
import {
  autoDerateReason,
  desiredSmartleadState,
  evaluateTransition,
  isManualTransitionAllowed,
  restartWarmupTarget,
  shouldRetireOnRest,
  smartleadStateMatches,
  type LifecycleSignals,
} from '@/lib/inboxes/lifecycle';
import {
  DEFAULT_STAGE_PLAN,
  mergeStagePlan,
  resolveStagePlan,
} from '@/lib/inboxes/stage-plan';
import { domainRestSatisfied, type DomainRestClock } from '@/lib/org-settings';
import type { LifecycleStage } from '@/lib/delivery-states';

// 2026-09-14 is a Monday; 2026-09-19/20 is the following weekend.
const MONDAY = '2026-09-14';
const FRIDAY = '2026-09-18';
const SATURDAY = '2026-09-19';

function inbox(overrides: Partial<CapacityInbox> = {}): CapacityInbox {
  return {
    id: 'inbox-1',
    email: 'lucas@heliosgroup.me',
    identitySlug: 'lucas',
    stage: 'production',
    enabled: true,
    stageEnteredAt: MONDAY,
    plan: DEFAULT_STAGE_PLAN,
    ...overrides,
  };
}

function signals(overrides: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    daysInStage: 0,
    warmupInboxRate: null,
    warmupSpamRate: null,
    bounceRate: null,
    postmasterReputation: null,
    connectionHealthy: true,
    varianceFlagged: false,
    ...overrides,
  };
}

// ── Capacity table (§3.5) ───────────────────────────────────────────────────

test('stageCap reproduces the §3.5 table', () => {
  const cases: Array<[LifecycleStage, string, number]> = [
    ['provisioning', MONDAY, 0],
    ['warming', MONDAY, 0],
    ['resting', MONDAY, 0],
    ['retired', MONDAY, 0],
    ['production', MONDAY, 12],
    ['production', SATURDAY, 12],
  ];
  for (const [stage, day, expected] of cases) {
    assert.equal(stageCap(inbox({ stage }), day), expected, `${stage} on ${day}`);
  }
});

test('ramping starts at 3 and adds one per business day, capped at production', () => {
  const ramping = inbox({ stage: 'ramping', stageEnteredAt: MONDAY });
  assert.equal(stageCap(ramping, MONDAY), 3, 'day 0');
  assert.equal(stageCap(ramping, '2026-09-15'), 4, 'day 1');
  assert.equal(stageCap(ramping, FRIDAY), 7, 'four business days in');
  // The weekend adds no business days, so Monday continues from Friday.
  assert.equal(stageCap(ramping, '2026-09-21'), 8);
  assert.equal(stageCap(ramping, '2026-12-01'), DEFAULT_STAGE_PLAN.production.cap);
});

test('ramping sends nothing at the weekend while weekdays_only is set', () => {
  const ramping = inbox({ stage: 'ramping', stageEnteredAt: MONDAY });
  assert.equal(stageCap(ramping, SATURDAY), 0);
  assert.equal(stageCap(ramping, '2026-09-20'), 0);

  const everyDay = inbox({
    stage: 'ramping',
    stageEnteredAt: MONDAY,
    plan: mergeStagePlan(DEFAULT_STAGE_PLAN, { ramping: { weekdays_only: false } }),
  });
  assert.ok(stageCap(everyDay, SATURDAY) > 0);
});

test('a disabled mailbox has no capacity whatever its stage', () => {
  assert.equal(stageCap(inbox({ enabled: false }), MONDAY), 0);
});

test('businessDaysBetween skips weekends and never goes negative', () => {
  assert.equal(businessDaysBetween(MONDAY, FRIDAY), 4);
  assert.equal(businessDaysBetween(FRIDAY, '2026-09-21'), 1);
  assert.equal(businessDaysBetween(FRIDAY, MONDAY), 0);
});

test('warmup and campaign together never exceed the per-mailbox daily ceiling', () => {
  const big = inbox({
    plan: mergeStagePlan(DEFAULT_STAGE_PLAN, { production: { cap: 30 } }),
  });
  // 30 campaign + 20 warmup would be 50 against a 40 ceiling, so campaign yields.
  assert.equal(totalDailyBudget(big, MONDAY, 20), 20);
  assert.equal(totalDailyBudget(inbox(), MONDAY, 20), 12);
});

test('caps may not more than double day over day', () => {
  assert.equal(clampGrowth(3, 12, DEFAULT_STAGE_PLAN), 6);
  assert.equal(clampGrowth(6, 12, DEFAULT_STAGE_PLAN), 12);
  assert.equal(clampGrowth(0, 12, DEFAULT_STAGE_PLAN), 12, 'a cold start is not growth');
});

test('identity capacity is the sum of caps minus the follow-ups due that day', () => {
  const inboxes = [
    inbox({ id: 'a' }),
    inbox({ id: 'b' }),
    inbox({ id: 'c', stage: 'warming' }),
  ];
  assert.equal(identityCapacity({ inboxes, followupsDue: 0 }, MONDAY), 24);
  assert.equal(identityCapacity({ inboxes, followupsDue: 10 }, MONDAY), 14);
  assert.equal(identityCapacity({ inboxes, followupsDue: 99 }, MONDAY), 0, 'never negative');
});

// ── Monthly ceiling ─────────────────────────────────────────────────────────

test('the monthly ceiling spreads what is left over the days that remain', () => {
  assert.equal(
    monthlyCeiling({ limit: 1000, used: 100, warmupUsed: 100, daysLeft: 10 }),
    80,
  );
  assert.equal(monthlyCeiling({ limit: 100, used: 100, warmupUsed: 10, daysLeft: 5 }), 0);
});

test('an unconfigured plan limit never throttles sending', () => {
  assert.equal(monthlyCeiling({ limit: 0, used: 0, warmupUsed: 0, daysLeft: 10 }), Infinity);
});

// ── Lane allocation ─────────────────────────────────────────────────────────

const lane = (id: string, demand: number, extra = {}) => ({
  laneId: id,
  campaignId: `c-${id}`,
  identitySlug: 'lucas' as const,
  demand,
  maxNewLeadsPerDay: null,
  emailsPerDay: null,
  laneReady: true,
  ...extra,
});

test('laneCapacity takes the tightest of pool, lane cap and auto cap', () => {
  assert.equal(laneCapacity(lane('a', 50), 10), 10);
  assert.equal(laneCapacity(lane('a', 50, { maxNewLeadsPerDay: 4 }), 10), 4);
  assert.equal(laneCapacity(lane('a', 50, { emailsPerDay: 2 }), 10), 2);
});

test('the pool goes round robin, so a large backlog cannot starve a small one', () => {
  const allocated = roundRobinAllocate([lane('a', 100), lane('b', 3)], 10);
  assert.equal(allocated.get('a'), 7);
  assert.equal(allocated.get('b'), 3);
  assert.equal([...allocated.values()].reduce((a, b) => a + b, 0), 10);
});

test('a lane that is not ready gets nothing, and its share goes to the others', () => {
  const allocated = roundRobinAllocate([lane('a', 100), lane('b', 100, { laneReady: false })], 6);
  assert.equal(allocated.get('a'), 6);
  assert.equal(allocated.get('b'), 0);
});

test('allocation stops when demand runs out rather than looping', () => {
  const allocated = roundRobinAllocate([lane('a', 2), lane('b', 1)], 100);
  assert.equal(allocated.get('a'), 2);
  assert.equal(allocated.get('b'), 1);
});

// ── Forecast ────────────────────────────────────────────────────────────────

test('forecast is the smaller of capacity and demand, and today counts what already went', () => {
  assert.equal(forecastForLane({ laneCapacityToday: 10, demand: 4 }), 4);
  assert.equal(forecastForLane({ laneCapacityToday: 3, demand: 40 }), 3);
  assert.equal(
    forecastForLane({ laneCapacityToday: 10, demand: 40, actualToday: 6, isToday: true }),
    10,
    'six already sent plus four of remaining capacity',
  );
  assert.equal(
    forecastForLane({ laneCapacityToday: 10, demand: 1, actualToday: 6, isToday: true }),
    7,
    'demand, not capacity, is the binding constraint',
  );
});

test('per-mailbox planned splits by cap and the parts add up to the whole', () => {
  const inboxes = [
    inbox({ id: 'prod' }),
    inbox({ id: 'ramp', stage: 'ramping', stageEnteredAt: MONDAY }),
  ];
  const planned = plannedPerMailbox(inboxes, MONDAY, 10);
  assert.equal([...planned.values()].reduce((a, b) => a + b, 0), 10);
  assert.ok(planned.get('prod')! > planned.get('ramp')!, 'the bigger cap takes the bigger share');
  assert.deepEqual([...plannedPerMailbox(inboxes, MONDAY, 0).values()], [0, 0]);
});

test('the variance flag needs two consecutive bad days', () => {
  assert.equal(varianceFlag([{ planned: 10, actual: 2 }]), false);
  assert.equal(varianceFlag([{ planned: 10, actual: 2 }, { planned: 10, actual: 9 }]), false);
  assert.equal(varianceFlag([{ planned: 10, actual: 2 }, { planned: 10, actual: 1 }]), true);
  assert.equal(
    varianceFlag([{ planned: 0, actual: 0 }, { planned: 0, actual: 0 }]),
    false,
    'a zero plan cannot be missed',
  );
});

test('the forecast note names itself an estimate', () => {
  assert.match(FORECAST_NOTE, /estimate/i);
  assert.match(FORECAST_NOTE, /Smartlead decides/i);
});

// ── Stage machine ───────────────────────────────────────────────────────────

const machine = (stage: LifecycleStage, extra = {}) => ({
  stage,
  restCycles: 0,
  hasSmartleadAccount: true,
  ...extra,
});

test('provisioning waits for the Smartlead account and then warms', () => {
  assert.deepEqual(
    evaluateTransition(machine('provisioning', { hasSmartleadAccount: false }), DEFAULT_STAGE_PLAN, signals()),
    { next: null, reason: 'awaiting_smartlead_account', unmet: ['smartlead_account'] },
  );
  assert.equal(
    evaluateTransition(machine('provisioning'), DEFAULT_STAGE_PLAN, signals()).next,
    'warming',
  );
});

test('warming exits only on days, inbox rate and a healthy connection together', () => {
  const ready = signals({ daysInStage: 14, warmupInboxRate: 0.95 });
  assert.equal(evaluateTransition(machine('warming'), DEFAULT_STAGE_PLAN, ready).next, 'ramping');

  const tooSoon = evaluateTransition(
    machine('warming'),
    DEFAULT_STAGE_PLAN,
    signals({ daysInStage: 3, warmupInboxRate: 0.99 }),
  );
  assert.equal(tooSoon.next, null);
  assert.deepEqual(tooSoon.unmet, ['days_in_stage<14']);

  const coldInbox = evaluateTransition(
    machine('warming'),
    DEFAULT_STAGE_PLAN,
    signals({ daysInStage: 20, warmupInboxRate: 0.5 }),
  );
  assert.deepEqual(coldInbox.unmet, ['warmup_inbox_rate<0.92']);

  const broken = evaluateTransition(
    machine('warming'),
    DEFAULT_STAGE_PLAN,
    signals({ daysInStage: 20, warmupInboxRate: 0.99, connectionHealthy: false }),
  );
  assert.deepEqual(broken.unmet, ['connection_errors']);
});

test('warming cannot exit on missing warmup data', () => {
  const decision = evaluateTransition(
    machine('warming'),
    DEFAULT_STAGE_PLAN,
    signals({ daysInStage: 30, warmupInboxRate: null }),
  );
  assert.equal(decision.next, null);
});

test('ramping promotes on days plus a clean bounce rate', () => {
  const ready = signals({ daysInStage: 14, bounceRate: 0.005 });
  assert.equal(evaluateTransition(machine('ramping'), DEFAULT_STAGE_PLAN, ready).next, 'production');

  const bouncy = evaluateTransition(
    machine('ramping'),
    DEFAULT_STAGE_PLAN,
    signals({ daysInStage: 14, bounceRate: 0.025 }),
  );
  assert.deepEqual(bouncy.unmet, ['bounce_rate>=0.02']);
});

test('Postmaster no_data is neutral: it blocks nothing and derates nothing', () => {
  const noData = signals({ daysInStage: 14, bounceRate: 0, postmasterReputation: null });
  assert.equal(
    evaluateTransition(machine('ramping'), DEFAULT_STAGE_PLAN, noData).next,
    'production',
    'a silent Postmaster must not hold a mailbox back',
  );
  assert.equal(autoDerateReason(DEFAULT_STAGE_PLAN, noData), null);

  const high = signals({ daysInStage: 14, bounceRate: 0, postmasterReputation: 'HIGH' });
  assert.equal(evaluateTransition(machine('ramping'), DEFAULT_STAGE_PLAN, high).next, 'production');
});

test('a real Low or Bad Postmaster grade does block and does derate', () => {
  const bad = signals({ daysInStage: 14, bounceRate: 0, postmasterReputation: 'BAD' });
  assert.equal(evaluateTransition(machine('ramping'), DEFAULT_STAGE_PLAN, bad).next, 'resting');
  assert.equal(autoDerateReason(DEFAULT_STAGE_PLAN, bad), 'postmaster_reputation');
  assert.equal(
    autoDerateReason(DEFAULT_STAGE_PLAN, signals({ postmasterReputation: 'LOW' })),
    'postmaster_reputation',
  );
});

test('production rests on any of the four derate conditions', () => {
  const cases: Array<[Partial<LifecycleSignals>, string]> = [
    [{ bounceRate: 0.04 }, 'bounce_rate'],
    [{ warmupSpamRate: 0.06 }, 'warmup_spam_rate'],
    [{ postmasterReputation: 'LOW' }, 'postmaster_reputation'],
    [{ varianceFlagged: true }, 'forecast_variance'],
  ];
  for (const [override, reason] of cases) {
    const decision = evaluateTransition(machine('production'), DEFAULT_STAGE_PLAN, signals(override));
    assert.equal(decision.next, 'resting', reason);
    assert.equal(decision.restReason, reason);
  }
  assert.equal(evaluateTransition(machine('production'), DEFAULT_STAGE_PLAN, signals()).next, null);
});

test('resting and retired never move on their own', () => {
  assert.equal(evaluateTransition(machine('resting'), DEFAULT_STAGE_PLAN, signals()).next, null);
  assert.equal(evaluateTransition(machine('retired'), DEFAULT_STAGE_PLAN, signals()).next, null);
});

test('restart warmup routes by whether a Smartlead account exists', () => {
  assert.equal(restartWarmupTarget(true), 'warming');
  assert.equal(
    restartWarmupTarget(false),
    'provisioning',
    'a legacy row with no Smartlead account must be re-created and re-connected first',
  );
});

test('a third rest retires the mailbox instead', () => {
  assert.equal(shouldRetireOnRest(0), false);
  assert.equal(shouldRetireOnRest(1), false);
  assert.equal(shouldRetireOnRest(2), true);
});

test('manual transitions allow the documented moves and refuse the rest', () => {
  assert.ok(isManualTransitionAllowed('resting', 'warming'));
  assert.ok(isManualTransitionAllowed('resting', 'provisioning'));
  assert.ok(isManualTransitionAllowed('resting', 'ramping'));
  assert.ok(isManualTransitionAllowed('retired', 'provisioning'));
  assert.equal(isManualTransitionAllowed('provisioning', 'production'), false);
  assert.equal(isManualTransitionAllowed('retired', 'production'), false);
});

// ── Domain rest clock ───────────────────────────────────────────────────────

const clock: DomainRestClock = {
  'heliosgroup.email': { rested_since: '2026-09-10', min_rest_days: 60 },
  'heliosgroup.me': { rested_since: null, min_rest_days: 10 },
};

test('a burned domain stays closed until rested_since plus min_rest_days', () => {
  const blocked = domainRestSatisfied(clock, 'heliosgroup.email', '2026-10-01');
  assert.equal(blocked.ok, false);
  assert.ok(!blocked.ok && blocked.availableOn === '2026-11-09');

  assert.equal(domainRestSatisfied(clock, 'heliosgroup.email', '2026-11-09').ok, true);
  assert.equal(domainRestSatisfied(clock, 'heliosgroup.email', '2026-12-01').ok, true);
});

test('a domain that has never rested, and one we have never seen, are both open', () => {
  assert.equal(domainRestSatisfied(clock, 'heliosgroup.me', '2026-09-16').ok, true);
  assert.equal(domainRestSatisfied(clock, 'brand-new.com', '2026-09-16').ok, true);
});

test('the clock is matched case-insensitively', () => {
  assert.equal(domainRestSatisfied(clock, 'HeliosGroup.Email', '2026-10-01').ok, false);
});

// ── Desired Smartlead state ─────────────────────────────────────────────────

test('warmup stays on through resting and only stops for retired or unprovisioned', () => {
  for (const stage of ['warming', 'ramping', 'production', 'resting'] as LifecycleStage[]) {
    const desired = desiredSmartleadState(inbox({ stage }), DEFAULT_STAGE_PLAN, MONDAY, null);
    assert.equal(desired.warmup.warmup_enabled, true, stage);
  }
  for (const stage of ['retired', 'provisioning'] as LifecycleStage[]) {
    const desired = desiredSmartleadState(inbox({ stage }), DEFAULT_STAGE_PLAN, MONDAY, null);
    assert.equal(desired.warmup.warmup_enabled, false, stage);
    assert.equal(desired.maxEmailPerDay, 0);
  }
});

test('a warming mailbox is told to send zero campaign mail at full warmup volume', () => {
  const desired = desiredSmartleadState(
    inbox({ stage: 'warming' }),
    DEFAULT_STAGE_PLAN,
    MONDAY,
    null,
  );
  assert.equal(desired.maxEmailPerDay, 0);
  assert.equal(desired.warmup.total_warmup_per_day, DEFAULT_STAGE_PLAN.warming.warmup_target);
  assert.equal(desired.warmup.reply_rate_percentage, 32);
});

test('the daily pass writes only when the mirror disagrees', () => {
  const desired = desiredSmartleadState(inbox(), DEFAULT_STAGE_PLAN, MONDAY, 12);
  const mirror = {
    sl_max_email_per_day: desired.maxEmailPerDay,
    sl_warmup_enabled: desired.warmup.warmup_enabled,
    sl_warmup_total_per_day: desired.warmup.total_warmup_per_day,
    sl_warmup_reply_rate: desired.warmup.reply_rate_percentage,
  };
  assert.equal(smartleadStateMatches(mirror as never, desired), true);
  assert.equal(
    smartleadStateMatches({ ...mirror, sl_max_email_per_day: 5 } as never, desired),
    false,
  );
  assert.equal(
    smartleadStateMatches({ ...mirror, sl_warmup_enabled: null } as never, desired),
    false,
    'an unsynced mailbox must be written at least once',
  );
});

// ── Stage plan merge ────────────────────────────────────────────────────────

test('a per-inbox override merges leaf by leaf over the org default', () => {
  const merged = resolveStagePlan(
    { production: { cap: 20 } },
    { ramping: { cap_start: 1 }, production: { warmup_per_day: 5 } },
  );
  assert.equal(merged.production.cap, 20, 'org default survives');
  assert.equal(merged.production.warmup_per_day, 5, 'inbox override wins');
  assert.equal(merged.ramping.cap_start, 1);
  assert.equal(merged.ramping.cap_step, DEFAULT_STAGE_PLAN.ramping.cap_step, 'untouched leaf');
  assert.equal(merged.warming.days, 14);
});

test('merging never mutates the shared default', () => {
  resolveStagePlan({ production: { cap: 99 } }, {});
  assert.equal(DEFAULT_STAGE_PLAN.production.cap, 12);
});

test('an array override replaces rather than appends, so derating can be disabled', () => {
  const merged = resolveStagePlan({}, { auto_derate: { postmaster_rest: [] } });
  assert.deepEqual(merged.auto_derate.postmaster_rest, []);
  assert.equal(autoDerateReason(merged, signals({ postmasterReputation: 'BAD' })), null);
});

test('junk in the settings column falls back to the default plan', () => {
  assert.deepEqual(resolveStagePlan(null, undefined), DEFAULT_STAGE_PLAN);
  assert.deepEqual(resolveStagePlan('nonsense', 42), DEFAULT_STAGE_PLAN);
});
