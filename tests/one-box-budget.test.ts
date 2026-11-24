/** One-box seeding: the per-type spend ledger (offline, pure). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LIMIT_USD, Ledger, limitText, RESERVE_USD, SEARCH_INPUT_ALLOWANCE_TOKENS, SEARCH_MAX_USES, searchWorstCaseUsd, verifyWorstCaseUsd } from '@/lib/seed/one-box/budget';

test('limits: 35 cents for the v1 types, 50 for reel_ai_drama, 60 for real_or_ai', () => {
  assert.equal(LIMIT_USD.reels, 0.35);
  assert.equal(LIMIT_USD.reel_ai_drama, 0.5);
  assert.equal(LIMIT_USD.real_or_ai, 0.6);
});

test('real_or_ai usable is 0.52', () => assert.equal(new Ledger('real_or_ai').usable.toFixed(2), '0.52'));
test('reel_ai_drama usable is 0.50', () => assert.equal(new Ledger('reel_ai_drama').usable.toFixed(2), '0.50'));

test('remaining never goes negative after a huge add', () => {
  const l = new Ledger('reels');
  assert.equal(l.remaining(), 0.33);
  l.add(5);
  assert.equal(l.remaining(), 0);
});

test('limitText names 35, 50 and 60 cents', () => {
  assert.equal(limitText('reels'), 'Stopped at the 35-cent limit; nothing was added.');
  assert.match(limitText('reel_ai_drama'), /50-cent limit/);
  assert.match(limitText('real_or_ai'), /60-cent limit/);
});

test('one search call can cost at most 25 cents, with at most 3 searches and 60k tokens of input assumed', () => {
  assert.ok(searchWorstCaseUsd() <= 0.25, String(searchWorstCaseUsd()));
  assert.equal(SEARCH_MAX_USES, 3);
  assert.equal(SEARCH_INPUT_ALLOWANCE_TOKENS, 60_000);
});

test('a search plus three verifier calls fit the Explainers budget after its 8-cent reserve', () => {
  assert.ok(searchWorstCaseUsd() + verifyWorstCaseUsd() * 3 <= LIMIT_USD.explainers - RESERVE_USD.explainers);
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
