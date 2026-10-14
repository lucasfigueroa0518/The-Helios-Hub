import assert from 'node:assert/strict';
import test from 'node:test';

import { extendWindow, shiftDate, windowFor } from '@/lib/lfd/window';

test('Tuesday after a Friday post covers Sat..Tue', () => {
  assert.deepEqual(windowFor('2026-10-13', '2026-10-09'), { after: '2026-10-09', through: '2026-10-13' });
});

test('the first run looks back 4 batches', () => {
  assert.deepEqual(windowFor('2026-10-13', null), { after: '2026-10-09', through: '2026-10-13' });
});

test('the safety net reaches 3 batches further back', () => {
  assert.deepEqual(extendWindow({ after: '2026-10-09', through: '2026-10-13' }), { after: '2026-10-06', through: '2026-10-13' });
});

test('shiftDate crosses month ends', () => {
  assert.equal(shiftDate('2026-11-01', -1), '2026-10-31');
});
