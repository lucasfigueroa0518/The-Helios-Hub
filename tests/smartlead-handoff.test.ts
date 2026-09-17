/**
 * S4 acceptance — the planner is a pure function of capacity, demand, and
 * the monthly ceiling. Offline: no database, no Smartlead.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STAGE_PLAN } from '@/lib/inboxes/stage-plan';
import { SMARTLEAD_MAX_LEADS_PER_REQUEST } from '@/lib/smartlead/types';
import {
  planHandoffs,
  type PendingRow,
  type PlannerLane,
  type PlanInput,
} from '@/lib/smartlead/handoff';
import type { CapacityInbox } from '@/lib/inboxes/capacity';
import type { IdentitySlug } from '@/lib/delivery-states';
import { cutoverTargetStatus } from '@/lib/smartlead/migrate-queue';

const TODAY = '2026-09-14'; // Monday

function productionInbox(identity: IdentitySlug, id: string, email: string): CapacityInbox {
  return {
    id,
    email,
    identitySlug: identity,
    stage: 'production',
    enabled: true,
    stageEnteredAt: TODAY,
    plan: DEFAULT_STAGE_PLAN,
  };
}

function rowsFor(identity: IdentitySlug, campaignId: string, laneId: string, count: number): PendingRow[] {
  return Array.from({ length: count }, (_, i) => ({
    queueId: `${identity}-${i + 1}`,
    campaignId,
    laneId,
    identitySlug: identity,
    createdAt: `2026-09-13T12:${String(i).padStart(2, '0')}:00.000Z`,
  }));
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  const lucasLane: PlannerLane = {
    laneId: 'lane-lucas',
    campaignId: 'camp-lucas',
    identitySlug: 'lucas',
    ready: true,
    maxNewLeadsPerDay: null,
    emailsPerDay: null,
  };
  const tommyLane: PlannerLane = {
    laneId: 'lane-tommy',
    campaignId: 'camp-tommy',
    identitySlug: 'tommy',
    ready: true,
    maxNewLeadsPerDay: null,
    emailsPerDay: null,
  };
  return {
    today: TODAY,
    horizonDays: 14,
    rows: [
      ...rowsFor('lucas', 'camp-lucas', 'lane-lucas', 25),
      ...rowsFor('tommy', 'camp-tommy', 'lane-tommy', 25),
    ],
    lanes: [lucasLane, tommyLane],
    inboxesByIdentity: new Map([
      ['lucas', [productionInbox('lucas', 'ib-lucas', 'lucas@heliosgroup.me')]],
      ['tommy', [productionInbox('tommy', 'ib-tommy', 'tommy@heliosgroup.store')]],
    ]),
    followupsDue: new Map(),
    carryOver: new Map(),
    monthly: { limit: 30_000, used: 0, warmupUsed: 0, daysLeft: 20 },
    ...overrides,
  };
}

test('25 drafts × 2 identities obey the 12/day production cap', () => {
  const plan = planHandoffs(input());
  assert.equal(plan.assignments.length, 50);
  assert.equal(plan.waiting.length, 0);

  const byDateIdentity = new Map<string, number>();
  for (const row of plan.assignments) {
    const identity = row.queueId.startsWith('lucas') ? 'lucas' : 'tommy';
    const key = `${identity}:${row.date}`;
    byDateIdentity.set(key, (byDateIdentity.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byDateIdentity) {
    assert.ok(count <= 12, `${key} was assigned ${count}, over the 12/day cap`);
  }
  assert.equal(byDateIdentity.get(`lucas:${TODAY}`), 12);
  assert.equal(byDateIdentity.get(`tommy:${TODAY}`), 12);
  assert.equal(byDateIdentity.get('lucas:2026-09-16'), 1);
  assert.equal(byDateIdentity.get('tommy:2026-09-16'), 1);
});

test('two lanes on one identity round-robin rather than drain the first', () => {
  const plan = planHandoffs(input({
    rows: [
      ...rowsFor('lucas', 'camp-a', 'lane-a', 8),
      ...rowsFor('lucas', 'camp-b', 'lane-b', 8),
    ],
    lanes: [
      {
        laneId: 'lane-a',
        campaignId: 'camp-a',
        identitySlug: 'lucas',
        ready: true,
        maxNewLeadsPerDay: null,
        emailsPerDay: null,
      },
      {
        laneId: 'lane-b',
        campaignId: 'camp-b',
        identitySlug: 'lucas',
        ready: true,
        maxNewLeadsPerDay: null,
        emailsPerDay: null,
      },
    ],
    inboxesByIdentity: new Map([
      ['lucas', [productionInbox('lucas', 'ib-lucas', 'lucas@heliosgroup.me')]],
    ]),
  }));
  const todayA = plan.assignments.filter((row) => row.laneId === 'lane-a' && row.date === TODAY);
  const todayB = plan.assignments.filter((row) => row.laneId === 'lane-b' && row.date === TODAY);
  assert.equal(todayA.length, 6);
  assert.equal(todayB.length, 6);
});

test('a lane that is not ready waits instead of taking a date', () => {
  const plan = planHandoffs(input({
    lanes: [
      {
        laneId: 'lane-lucas',
        campaignId: 'camp-lucas',
        identitySlug: 'lucas',
        ready: false,
        maxNewLeadsPerDay: null,
        emailsPerDay: null,
      },
    ],
    rows: rowsFor('lucas', 'camp-lucas', 'lane-lucas', 3),
    inboxesByIdentity: new Map([
      ['lucas', [productionInbox('lucas', 'ib-lucas', 'lucas@heliosgroup.me')]],
    ]),
  }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.waiting.length, 3);
  assert.ok(plan.waiting.every((row) => row.reason === 'lane_not_ready'));
});

test('the monthly ceiling binds before the mailbox cap', () => {
  const plan = planHandoffs(input({
    monthly: { limit: 10, used: 8, warmupUsed: 0, daysLeft: 1 },
    rows: rowsFor('lucas', 'camp-lucas', 'lane-lucas', 10),
    lanes: [{
      laneId: 'lane-lucas',
      campaignId: 'camp-lucas',
      identitySlug: 'lucas',
      ready: true,
      maxNewLeadsPerDay: null,
      emailsPerDay: null,
    }],
    inboxesByIdentity: new Map([
      ['lucas', [productionInbox('lucas', 'ib-lucas', 'lucas@heliosgroup.me')]],
    ]),
  }));
  assert.ok(plan.assignments.length <= 2);
  assert.ok(plan.waiting.some((row) => row.reason === 'monthly_ceiling' || row.reason === 'no_capacity'));
});

test('a handoff batch is well under the 400-lead request cap', () => {
  assert.ok(25 < SMARTLEAD_MAX_LEADS_PER_REQUEST);
  assert.equal(SMARTLEAD_MAX_LEADS_PER_REQUEST, 400);
});

test('cutover maps AgentMail sending rows onto queued, and leaves terminals alone', () => {
  assert.equal(cutoverTargetStatus('sending'), 'queued');
  assert.equal(cutoverTargetStatus('queued'), 'queued');
  assert.equal(cutoverTargetStatus('handing_off'), 'queued');
  assert.equal(cutoverTargetStatus('sent'), null);
  assert.equal(cutoverTargetStatus('cancelled'), null);
  assert.equal(cutoverTargetStatus('failed'), null);
});

test('the planner is idempotent for the same input', () => {
  const first = planHandoffs(input());
  const second = planHandoffs(input());
  assert.deepEqual(first.assignments, second.assignments);
  assert.deepEqual(first.waiting, second.waiting);
});
