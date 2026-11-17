import assert from 'node:assert/strict';
import test from 'node:test';

import { slowQueryLabel, slowQueryThresholdMs } from '@/lib/db';

test('slow-query threshold defaults to 100 ms, honors DB_SLOW_QUERY_MS, and 0 turns it off', () => {
  assert.equal(slowQueryThresholdMs({}), 100);
  assert.equal(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: '250' }), 250);
  assert.equal(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: '0' }), 0);
  assert.equal(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: 'nope' }), 100);
  assert.equal(slowQueryThresholdMs({ DB_SLOW_QUERY_MS: '-5' }), 100);
});

test('slow-query label is the statement shape only: comments dropped, whitespace collapsed, cut at 160', () => {
  const sql = `SELECT id -- the row\n   FROM outreach.leads\n  WHERE email = $1`;
  assert.equal(slowQueryLabel(sql), 'SELECT id FROM outreach.leads WHERE email = $1');
  assert.equal(slowQueryLabel(`SELECT ${'x, '.repeat(200)}1`).length, 160);
});
