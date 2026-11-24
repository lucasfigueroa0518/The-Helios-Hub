// runSettled (2026-11-24): a render that finished its video but lingers is stopped and counts as done; a normal exit
// keeps its own status. Offline: /bin/sh stands in for HyperFrames, `finished` stands in for ffprobe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSettled } from '@/lib/content-runs/render-settle';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'settle-'));

test('a finished video with a lingering process settles as a success, and the process group is stopped', async () => {
  const d = dir();
  const out = path.join(d, 'video.mp4');
  const t0 = Date.now();
  const r = await runSettled('/bin/sh', ['-c', `printf done > ${out}; sleep 60 & sleep 60`], { cwd: d, output: out, settleMs: 300, pollMs: 100, finished: () => true });
  assert.equal(r.status, 0);
  assert.equal(r.settled, true);
  assert.ok(Date.now() - t0 < 10_000, 'did not wait for the sleeps');
});

test('an unfinished file never settles: the process exit decides', async () => {
  const d = dir();
  const out = path.join(d, 'video.mp4');
  const r = await runSettled('/bin/sh', ['-c', `printf half > ${out}; sleep 1; echo broke >&2; exit 3`], { cwd: d, output: out, settleMs: 100, pollMs: 50, finished: () => false });
  assert.equal(r.status, 3);
  assert.equal(r.settled, undefined);
  assert.match(r.stderr, /broke/);
});

test('a normal exit returns at exit, not when a child still holds the pipes', async () => {
  const d = dir();
  const t0 = Date.now();
  const r = await runSettled('/bin/sh', ['-c', 'sleep 30 & echo ok; exit 0'], { cwd: d, output: path.join(d, 'none.mp4'), finished: () => false });
  assert.equal(r.status, 0);
  assert.ok(Date.now() - t0 < 10_000);
});
