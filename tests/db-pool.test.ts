import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseDbConnection, resolvePoolMax } from '@/lib/db';

const SESSION = 'postgres://postgres.example:secret@aws-0.pooler.supabase.com:5432/postgres';
const TRANSACTION = 'postgres://postgres.example:secret@aws-0.pooler.supabase.com:6543/postgres';

test('runtime prefers the transaction pooler when both URLs are set', () => {
  const choice = chooseDbConnection({
    DATABASE_URL: TRANSACTION,
    DIRECT_DATABASE_URL: SESSION,
  });
  assert.equal(choice.mode, 'transaction');
  assert.equal(choice.hostPort, 'aws-0.pooler.supabase.com:6543');
  assert.equal(choice.connectionString, TRANSACTION);
});

test('session opt-in uses the session pooler', () => {
  const choice = chooseDbConnection({
    DATABASE_URL: TRANSACTION,
    DIRECT_DATABASE_URL: SESSION,
    OUTREACH_DB_USE_SESSION_POOLER: '1',
  });
  assert.equal(choice.mode, 'session');
  assert.equal(choice.hostPort, 'aws-0.pooler.supabase.com:5432');
});

test('a missing transaction URL falls back to session', () => {
  const choice = chooseDbConnection({ DIRECT_DATABASE_URL: SESSION });
  assert.equal(choice.mode, 'session');
});

test('missing database URLs throw without echoing a secret', () => {
  assert.throws(
    () => chooseDbConnection({}),
    /DATABASE_URL or DIRECT_DATABASE_URL is not set/,
  );
});

test('session mode clamps a worker-sized pool to 2 clients', () => {
  assert.equal(resolvePoolMax('session', { PG_POOL_MAX: '8' }), 2);
  assert.equal(resolvePoolMax('transaction', { PG_POOL_MAX: '8' }), 8);
  assert.equal(resolvePoolMax('transaction', { PG_POOL_MAX: '40' }), 8);
  assert.equal(resolvePoolMax('transaction', {}), 2);
});
