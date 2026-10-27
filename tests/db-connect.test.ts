import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDbGate,
  dbConnectCooldownActive,
  isDbConnectTimeout,
  markDbConnectGaveUp,
  resetDbConnectCooldown,
  runInDbSlot,
  withDbConnectRetries,
} from '@/lib/db';

test('a checkout timeout is retried twice', async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await withDbConnectRetries(async () => {
    calls += 1;
    if (calls < 3) throw new Error('timeout exceeded when trying to connect');
    return 'ok';
  }, async (ms) => {
    waits.push(ms);
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [150, 300]);
});

test('the third checkout timeout still throws', async () => {
  let calls = 0;
  await assert.rejects(
    () => withDbConnectRetries(async () => {
      calls += 1;
      throw new Error('timeout exceeded when trying to connect');
    }, async () => undefined),
    /timeout exceeded when trying to connect/,
  );
  assert.equal(calls, 3);
});

test('a query error is not retried', async () => {
  let calls = 0;
  await assert.rejects(
    () => withDbConnectRetries(async () => {
      calls += 1;
      throw new Error('relation "social.runs" does not exist');
    }, async () => undefined),
    /does not exist/,
  );
  assert.equal(calls, 1);
  assert.equal(isDbConnectTimeout(new Error('relation "social.runs" does not exist')), false);
});

test('a full pooler is retried and a checkout timeout is recognized from a string', async () => {
  let calls = 0;
  const result = await withDbConnectRetries(async () => {
    calls += 1;
    if (calls === 1) throw new Error('EMAXCONNSESSION remaining connection slots');
    return 1;
  }, async () => undefined);
  assert.equal(result, 1);
  assert.equal(isDbConnectTimeout('timeout exceeded when trying to connect'), true);
});

test('a given-up checkout blocks the next ones for a second', () => {
  resetDbConnectCooldown();
  assert.equal(dbConnectCooldownActive(1_000), false);
  markDbConnectGaveUp(new Error('timeout exceeded when trying to connect'), 1_000);
  assert.equal(dbConnectCooldownActive(1_500), true);
  assert.equal(dbConnectCooldownActive(2_000), false);
  markDbConnectGaveUp(new Error('relation "social.runs" does not exist'), 5_000);
  assert.equal(dbConnectCooldownActive(5_000), false);
  resetDbConnectCooldown();
});

test('the gate runs only its max at once and then the rest', async () => {
  const gate = createDbGate(2);
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, () => gate.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
  }));
  await Promise.all(tasks);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('a nested slot does not wait behind itself', async () => {
  const gate = createDbGate(1);
  let inner = false;
  const done = runInDbSlot(gate, () => runInDbSlot(gate, async () => {
    inner = true;
  }));
  const result = await Promise.race([
    done.then(() => 'done'),
    new Promise<string>((resolve) => setTimeout(() => resolve('stuck'), 200)),
  ]);
  assert.equal(result, 'done');
  assert.equal(inner, true);
});

test('closing the gate fails work that has not started', async () => {
  const gate = createDbGate(1);
  let release: (() => void) | undefined;
  const held = gate.run(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  const waiting = gate.run(async () => 'late');
  gate.close();
  await assert.rejects(waiting, /Database gate is closed/);
  release?.();
  await held;
});
