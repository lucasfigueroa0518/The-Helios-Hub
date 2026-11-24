import assert from 'node:assert/strict';
import test from 'node:test';

import { smartleadScheduleCap } from '@/lib/smartlead/lanes';

test('a zero capacity share still sends Smartlead a valid daily cap', () => {
  assert.equal(smartleadScheduleCap(0), 1);
  assert.equal(smartleadScheduleCap(-3), 1);
  assert.equal(smartleadScheduleCap(0.4), 1);
});

test('real caps pass through and no cap stays unset', () => {
  assert.equal(smartleadScheduleCap(25), 25);
  assert.equal(smartleadScheduleCap(7.9), 7);
  assert.equal(smartleadScheduleCap(null), undefined);
  assert.equal(smartleadScheduleCap(undefined), undefined);
  assert.equal(smartleadScheduleCap(Number.NaN), undefined);
});
