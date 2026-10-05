import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignDayPlan,
  commitmentsByCampaign,
  unfilledCommitment,
  type CapacityClaim,
} from '@/lib/drafting/send-queue-commitments';
import { deliveryStatusFor } from '@/lib/drafting/send-queue';

function claim(id: string, identity: 'lucas' | 'tommy', pct: number | null, max: number | null = null): CapacityClaim {
  return {
    campaignId: id,
    name: id,
    identitySlug: identity,
    capacityPct: pct,
    maxNewLeadsPerDay: max,
    queueColor: null,
    laneStatus: 'ready',
  };
}

test('a live campaign at 100% takes the whole pool when it is the only one', () => {
  const commitments = commitmentsByCampaign({
    poolByIdentity: new Map([['tommy', 12]]),
    claims: [claim('real-estate', 'tommy', 100)],
  });
  assert.equal(commitments.get('real-estate'), 12);
});

test('two live campaigns at 100% split the pool', () => {
  const commitments = commitmentsByCampaign({
    poolByIdentity: new Map([['tommy', 12]]),
    claims: [claim('a', 'tommy', 100), claim('b', 'tommy', 100)],
  });
  assert.equal(commitments.get('a'), 6);
  assert.equal(commitments.get('b'), 6);
});

test('a zero-capacity day reserves nothing', () => {
  const commitments = commitmentsByCampaign({
    poolByIdentity: new Map([['lucas', 0]]),
    claims: [claim('logistics', 'lucas', 100)],
  });
  assert.equal(commitments.get('logistics'), undefined);
});

test('different identities do not share a pool', () => {
  const commitments = commitmentsByCampaign({
    poolByIdentity: new Map([['tommy', 6], ['lucas', 8]]),
    claims: [claim('a', 'tommy', 100), claim('b', 'lucas', 100)],
  });
  assert.equal(commitments.get('a'), 6);
  assert.equal(commitments.get('b'), 8);
});

test('a live campaign with no percentage takes the pool', () => {
  const commitments = commitmentsByCampaign({
    poolByIdentity: new Map([['lucas', 12]]),
    claims: [claim('logistics', 'lucas', null)],
  });
  assert.equal(commitments.get('logistics'), 12);
});

test('an absolute cap stays inside the pool', () => {
  const commitments = commitmentsByCampaign({
    poolByIdentity: new Map([['lucas', 12]]),
    claims: [claim('manual', 'lucas', null, 5)],
  });
  assert.equal(commitments.get('manual'), 5);
});

test('queued emails inside the share are not added again', () => {
  assert.equal(unfilledCommitment(6, 2), 4);
  assert.equal(unfilledCommitment(6, 8), 0);
  const plan = campaignDayPlan({
    commitment: 6,
    identityPool: 12,
    itemCount: 2,
    unsent: 2,
    sent: 0,
    isToday: false,
  });
  assert.equal(plan.planned, 6);
  assert.equal(plan.forecast, 6);
});

test('emails already past the share still count', () => {
  const plan = campaignDayPlan({
    commitment: 6,
    identityPool: 12,
    itemCount: 10,
    unsent: 10,
    sent: 0,
    isToday: false,
  });
  assert.equal(plan.planned, 10);
  assert.equal(plan.forecast, 10);
});

test('queue states follow handoff, not the provider name', () => {
  const today = '2026-10-05';
  assert.equal(deliveryStatusFor({ status: 'handed_off', handoff_date: today }, today), 'handed_off');
  assert.equal(deliveryStatusFor({ status: 'handing_off', handoff_date: today }, today), 'handed_off');
  assert.equal(deliveryStatusFor({ status: 'queued', handoff_date: today }, today), 'queued');
  assert.equal(deliveryStatusFor({ status: 'queued', handoff_date: '2026-10-06' }, today), 'held');
  assert.equal(deliveryStatusFor({ status: 'queued', handoff_date: null }, today), 'held');
  assert.equal(deliveryStatusFor({ status: 'sent', handoff_date: today }, today), 'sent');
});
