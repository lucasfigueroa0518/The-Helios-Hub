/**
 * Delivery-settings coercion. Campaigns do not require a review.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvalRequired,
  initialDeliverySettings,
  resolveDeliverySettings,
} from '@/lib/smartlead/delivery-settings';

test('capacity share is a percent from 1 to 100', () => {
  assert.equal(resolveDeliverySettings({ capacity_pct: 40 }).capacity_pct, 40);
  assert.equal(resolveDeliverySettings({ capacity_pct: 0 }).capacity_pct, null);
  assert.equal(resolveDeliverySettings({ capacity_pct: 140 }).capacity_pct, null);
  assert.equal(resolveDeliverySettings({}).capacity_pct, null);
});

test('a partial payload keeps tracking off and does not require approval', () => {
  const settings = resolveDeliverySettings({ tracking: true, reply_fallback: 'human_only' });
  assert.equal(settings.tracking, true);
  assert.equal(settings.reply_fallback, 'human_only');
  assert.equal(settings.require_approval, false);
  assert.equal(settings.stop_on_reply, true);
  assert.deepEqual(settings.schedule.days, [1, 2, 3, 4, 5]);
});

test('empty follow-up bodies and step 1 are dropped', () => {
  const settings = resolveDeliverySettings({
    follow_ups: [
      { step: 1, delay_days: 1, body_template: 'should not land' },
      { step: 2, delay_days: 3, body_template: '   ' },
      { step: 2, delay_days: 4, body_template: 'Checking in.' },
    ],
  });
  assert.deepEqual(settings.follow_ups, [
    { step: 2, delay_days: 4, body_template: 'Checking in.' },
  ]);
});

test('create does not seed a review lock', () => {
  const seeded = initialDeliverySettings();
  assert.equal(seeded.require_approval, false);
  assert.equal(seeded.require_approval_until, null);
  assert.equal(approvalRequired(seeded), false);
  assert.equal(approvalRequired({ ...seeded, require_approval: true }), false);
});
