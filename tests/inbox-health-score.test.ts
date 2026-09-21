/**
 * Composite inbox health score — glanceable, missing data is not a zero.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreInboxHealth, type InboxHealthInput } from '@/lib/inboxes/health-score';

function input(overrides: Partial<InboxHealthInput> = {}): InboxHealthInput {
  return {
    warmupInboxRate: null,
    warmupSpamRate: null,
    bounceRate: null,
    postmasterReputation: null,
    connectionHealthy: true,
    warmupReputation: null,
    ...overrides,
  };
}

test('no signals at all is No data, not a failing zero', () => {
  const health = scoreInboxHealth(input());
  assert.equal(health.tone, 'unknown');
  assert.equal(health.score, null);
  assert.equal(health.label, 'No data');
});

test('strong warmup, bounce, and Postmaster read as Healthy', () => {
  const health = scoreInboxHealth(input({
    warmupInboxRate: 0.97,
    warmupSpamRate: 0,
    bounceRate: 0,
    postmasterReputation: 'HIGH',
    warmupReputation: 100,
  }));
  assert.equal(health.tone, 'good');
  assert.equal(health.label, 'Healthy');
  assert.ok((health.score ?? 0) >= 80);
});

test('Postmaster Low floors the tag to At risk even if warmup looks fine', () => {
  const health = scoreInboxHealth(input({
    warmupInboxRate: 0.98,
    bounceRate: 0,
    postmasterReputation: 'LOW',
  }));
  assert.equal(health.tone, 'poor');
  assert.equal(health.label, 'At risk');
  assert.ok((health.score ?? 100) <= 40);
});

test('a 3% bounce rate is At risk', () => {
  const health = scoreInboxHealth(input({ bounceRate: 0.03 }));
  assert.equal(health.tone, 'poor');
});

test('a connection error is At risk even with no other data', () => {
  const health = scoreInboxHealth(input({ connectionHealthy: false }));
  assert.equal(health.tone, 'poor');
  assert.match(health.detail, /connection error/);
});

test('quiet Postmaster does not drag a healthy warmup score down', () => {
  const health = scoreInboxHealth(input({
    warmupInboxRate: 0.96,
    warmupSpamRate: 0,
    bounceRate: 0.002,
  }));
  assert.equal(health.tone, 'good');
  assert.match(health.detail, /Postmaster quiet/);
});

test('mid warmup inbox rate lands on Watch', () => {
  const health = scoreInboxHealth(input({ warmupInboxRate: 0.82 }));
  assert.equal(health.tone, 'watch');
  assert.equal(health.label, 'Watch');
});
