/**
 * Delivery-settings coercion and the 30-day approval lock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvalLockExpired,
  approvalRequired,
  initialDeliverySettings,
  resolveDeliverySettings,
} from '@/lib/smartlead/delivery-settings';

test('a partial payload keeps tracking off and approval on', () => {
  const settings = resolveDeliverySettings({ tracking: true, reply_fallback: 'human_only' });
  assert.equal(settings.tracking, true);
  assert.equal(settings.reply_fallback, 'human_only');
  assert.equal(settings.require_approval, true);
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

test('create seeds a 30-day approval lock the user may later switch off', () => {
  const seeded = initialDeliverySettings(new Date('2026-09-16T12:00:00.000Z'));
  assert.equal(seeded.require_approval, true);
  assert.equal(seeded.require_approval_until, '2026-10-16');
  assert.equal(approvalRequired(seeded), true);
  assert.equal(approvalLockExpired(seeded, '2026-10-15'), false);
  assert.equal(approvalLockExpired(seeded, '2026-10-16'), true);
});
