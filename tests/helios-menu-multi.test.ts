import assert from 'node:assert/strict';
import test from 'node:test';

import { heliosSelectionLabel, toggleMultiValue } from '@/app/components/helios-menu';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

test('the first pick selects that one option', () => {
  assert.deepEqual(toggleMultiValue([], 'a'), ['a']);
});

test('another pick adds, and a second click removes', () => {
  assert.deepEqual(toggleMultiValue(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleMultiValue(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleMultiValue(['a'], 'a'), []);
});

test('the closed label names one or two picks and counts the rest', () => {
  assert.equal(heliosSelectionLabel([], options, 'All campaigns', 'campaigns'), 'All campaigns');
  assert.equal(heliosSelectionLabel(['b'], options, 'All campaigns', 'campaigns'), 'Beta');
  assert.equal(heliosSelectionLabel(['a', 'c'], options, 'All campaigns', 'campaigns'), 'Alpha, Gamma');
  assert.equal(heliosSelectionLabel(['a', 'b', 'c'], options, 'All campaigns', 'campaigns'), '3 campaigns');
});
