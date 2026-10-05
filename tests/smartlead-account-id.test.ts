import assert from 'node:assert/strict';
import test from 'node:test';

import { smartleadAccountId, smartleadAccountIds } from '@/lib/smartlead/account-id';

test('bigint strings from node-pg count as Smartlead account ids', () => {
  assert.equal(smartleadAccountId('23268451'), 23268451);
  assert.equal(smartleadAccountId(23268451), 23268451);
  assert.equal(smartleadAccountId(null), null);
  assert.equal(smartleadAccountId(''), null);
  assert.equal(smartleadAccountId('12.5'), null);
  assert.deepEqual(
    smartleadAccountIds(['23398154', 23397974, null, 'nope']),
    [23398154, 23397974],
  );
});
