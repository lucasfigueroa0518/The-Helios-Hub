import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withHangGuard } from '@/lib/content-runs/hang-guard';

test('a long run that keeps making progress is never cut off', async () => {
  let clock = 0;
  let last = 0;
  let hangs = 0;
  const work = new Promise<string>((resolve) => {
    const tick = setInterval(() => {
      clock += 10 * 60_000; // ten "minutes" per tick, each with a log line
      last = clock;
      if (clock >= 5 * 60 * 60_000) {
        clearInterval(tick);
        resolve('done');
      }
    }, 1);
  });
  const out = await withHangGuard(work, { now: () => clock, lastProgress: () => last, checkEveryMs: 1, onHang: () => { hangs += 1; return 'hung'; } });
  assert.equal(out, 'done');
  assert.equal(hangs, 0);
});

test('a silent run is judged hung after the quiet limit', async () => {
  let clock = 0;
  const tick = setInterval(() => { clock += 60_000; }, 1);
  const out = await withHangGuard(new Promise<string>(() => undefined), { quietMs: 45 * 60_000, now: () => clock, lastProgress: () => 0, checkEveryMs: 1, onHang: (r) => r });
  clearInterval(tick);
  assert.match(out, /no progress for 45 minutes/);
});

test('the backstop catches a run that is noisy but never ends', async () => {
  let clock = 0;
  const tick = setInterval(() => { clock += 60 * 60_000; }, 1);
  const out = await withHangGuard(new Promise<string>(() => undefined), { backstopMs: 12 * 3_600_000, now: () => clock, lastProgress: () => clock, checkEveryMs: 1, onHang: (r) => r });
  clearInterval(tick);
  assert.match(out, /12 h hang backstop/);
});
