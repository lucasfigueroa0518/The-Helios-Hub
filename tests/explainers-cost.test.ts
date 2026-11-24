import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CacheWarmGate, repeatedLookup } from '@/lib/explainers/render/agent';

test('cache warm gate: the first session per key goes, the rest wait for its first reply', async () => {
  const gate = new CacheWarmGate();
  const order: string[] = [];
  const first = await gate.enter('opus|frame-worker-tech');
  const second = gate.enter('opus|frame-worker-tech').then((h) => { order.push('second'); return h; });
  const other = gate.enter('sonnet|frame-worker-scene').then((h) => { order.push('other'); return h; });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ['other']);
  first.onReply();
  await second;
  assert.deepEqual(order, ['other', 'second']);
  // warm now: a later session starts at once
  await gate.enter('opus|frame-worker-tech');
});

test('cache warm gate fails open when the first session ends without a reply', async () => {
  const gate = new CacheWarmGate();
  const first = await gate.enter('k');
  const waiting = gate.enter('k');
  first.onEnd();
  await waiting;
});

test('repeated lookups: the stack is not re-read and an unchanged repeat is answered', () => {
  const memory = new Map<string, Set<string>>();
  const dir = '/job/project';
  assert.match(repeatedLookup(memory, 'a', 'Read', { file_path: '/job/project/frame.md' }, dir, 'frame-worker-scene') ?? '', /already in your prompt/);
  assert.equal(repeatedLookup(memory, 'r', 'Read', { file_path: '/job/project/frame.md' }, dir, 'reader'), null);
  assert.equal(repeatedLookup(memory, 'a', 'Grep', { pattern: 'x' }, dir, 'frame-worker-scene'), null);
  assert.match(repeatedLookup(memory, 'a', 'Grep', { pattern: 'x' }, dir, 'frame-worker-scene') ?? '', /exact call/);
  assert.equal(repeatedLookup(memory, 'b', 'Grep', { pattern: 'x' }, dir, 'frame-worker-scene'), null);
  repeatedLookup(memory, 'a', 'Bash', { command: 'node assets/kit/snap.mjs 01-hook 1' }, dir, 'frame-worker-scene');
  assert.equal(repeatedLookup(memory, 'a', 'Grep', { pattern: 'x' }, dir, 'frame-worker-scene'), null);
});

test('build fix round: a frame snapshot restores the module, events and props as they were', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { snapshotFrame, restoreFrame } = await import('@/lib/explainers/render/build');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-snap-'));
  const frames = path.join(dir, 'assets', 'frames');
  fs.mkdirSync(frames, { recursive: true });
  fs.writeFileSync(path.join(frames, '07-tie.js'), 'old');
  const snap = snapshotFrame(dir, '07-tie');
  fs.writeFileSync(path.join(frames, '07-tie.js'), 'new');
  fs.writeFileSync(path.join(frames, '07-tie.props.js'), 'added');
  restoreFrame(dir, snap);
  assert.equal(fs.readFileSync(path.join(frames, '07-tie.js'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(frames, '07-tie.props.js')), false);
});

test('self-checks: a builder gets its own bounds.mjs runs beside its try.mjs runs', async () => {
  const { selfCheckBudget, checkSnapCommand } = await import('@/lib/explainers/render/policy');
  const counts = new Map<string, number>();
  const run = (c: string) => selfCheckBudget(counts, 'b', c).allow;
  assert.equal(checkSnapCommand('node assets/kit/bounds.mjs 07-tie').allow, true);
  assert.equal(checkSnapCommand('node assets/kit/bounds.mjs 07-tie | head').allow, false);
  assert.deepEqual([run('node assets/kit/try.mjs frame 07-tie'), run('node assets/kit/try.mjs frame 07-tie'), run('node assets/kit/try.mjs frame 07-tie')], [true, true, false]);
  assert.deepEqual([run('node assets/kit/bounds.mjs 07-tie'), run('node assets/kit/bounds.mjs 07-tie'), run('node assets/kit/bounds.mjs 07-tie')], [true, true, false]);
});
