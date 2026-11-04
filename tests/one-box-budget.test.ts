/** One-box seeding: the 35-cent spend ledger (offline, pure). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Ledger, ONE_BOX_MAX_USD, RESERVE_USD, searchWorstCaseUsd, verifyWorstCaseUsd } from '@/lib/seed/one-box/budget';

test('the cap is 35 cents', () => assert.equal(ONE_BOX_MAX_USD, 0.35));

test('one search call can cost at most 20 cents', () => assert.ok(searchWorstCaseUsd() <= 0.2, String(searchWorstCaseUsd())));

test('a search plus three verifier calls fit the Explainers budget after its 8-cent reserve', () => {
  assert.ok(searchWorstCaseUsd() + verifyWorstCaseUsd() * 3 <= ONE_BOX_MAX_USD - RESERVE_USD.explainers);
});

test('Explainers usable budget is 27 cents, the others 33', () => {
  assert.equal(new Ledger('explainers').usable.toFixed(2), '0.27');
  assert.equal(new Ledger('reels').usable.toFixed(2), '0.33');
});

test('canAfford is false once spent plus the worst case would pass the usable budget', () => {
  const l = new Ledger('reels');
  assert.equal(l.canAfford(0.2), true);
  l.add(0.2);
  assert.equal(l.canAfford(0.2), false);
  assert.equal(l.canAfford(0.1), true);
});

test('exhausted once spent reaches the usable budget; a huge add is recorded, not capped', () => {
  const l = new Ledger('stories');
  assert.equal(l.exhausted, false);
  l.add(5);
  assert.equal(l.exhausted, true);
  assert.equal(l.spent, 5);
});
