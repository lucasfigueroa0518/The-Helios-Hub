/** Finished jobs' folders leave the worker's disk (production/disk.ts). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sweepJobFolders } from '@/lib/reel-ai-drama/production/disk';

const NOW = new Date('2026-11-20T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

test('delivered jobs go after 1 day, failed after 5; running, recent and unknown folders stay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-jobs-'));
  const jobs: Record<string, { status: string; finished_at: string | null }> = {
    [id(1)]: { status: 'ok', finished_at: daysAgo(1.5) },
    [id(2)]: { status: 'ok', finished_at: daysAgo(0.5) },
    [id(3)]: { status: 'failed', finished_at: daysAgo(4) },
    [id(4)]: { status: 'failed', finished_at: daysAgo(6) },
    [id(5)]: { status: 'running', finished_at: null },
    [id(6)]: { status: 'killed', finished_at: daysAgo(1.5) },
  };
  for (const j of [...Object.keys(jobs), id(7)]) {
    fs.mkdirSync(path.join(root, j, 'render'), { recursive: true });
    fs.mkdirSync(path.join(root, '_harvest', j), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'not-a-job'));
  const db = { query: async (_sql: string, params?: unknown[]) => ({ rows: (params![0] as string[]).filter((x) => jobs[x]).map((x) => ({ id: x, ...jobs[x]! })) }) };
  const removed = await sweepJobFolders(db as never, root, NOW);
  assert.deepEqual(removed.sort(), [id(1), id(4), id(6)]);
  for (const gone of [id(1), id(4), id(6)]) {
    assert.ok(!fs.existsSync(path.join(root, gone)));
    assert.ok(!fs.existsSync(path.join(root, '_harvest', gone)));
  }
  for (const kept of [id(2), id(3), id(5), id(7)]) assert.ok(fs.existsSync(path.join(root, kept)));
  assert.ok(fs.existsSync(path.join(root, 'not-a-job')));
});

test('an empty or missing jobs folder asks the database nothing', async () => {
  let asked = false;
  const removed = await sweepJobFolders({ query: async () => { asked = true; return { rows: [] }; } } as never, path.join(os.tmpdir(), 'no-such-drama-dir'), NOW);
  assert.deepEqual(removed, []);
  assert.equal(asked, false);
});
