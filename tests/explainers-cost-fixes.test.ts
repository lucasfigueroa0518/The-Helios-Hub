/**
 * Cost fixes (2026-10-28), offline: the builders' self-check allowlist and budget, the picture check's
 * risk score and contact-grid layout, the grid request (cached prefix), and the per-frame fix agent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkToolCall, selfCheckBudget, SELF_CHECKS_PER_BUILDER } from '@/lib/explainers/render/policy';
import { frameRisk, GRID_MAX, gridFrames, gridLayout, pictureGridParams, renderGrids, RISKY_AT, TILE, type ManifestFrame } from '@/lib/explainers/render/picture';
import { pictureFixAgent } from '@/lib/explainers/render/job';
import { findChrome } from '@/lib/explainers/render/workspace';
import type { LintViolation } from '@/lib/explainers/types';

const JOB = '/jobs/x/project';
const warn = (frame: number, rule: string): LintViolation => ({ source: 'storyboard', rule, frame, severity: 'warning', detail: 'x' });
const frame = (number: number, look: string, shots: number): ManifestFrame => ({
  id: `0${number}-f`,
  number,
  look,
  voiceover: 'a line',
  stills: Array.from({ length: shots }, (_, i) => ({ t: i, shot: i + 1, file: `.hyperframes/sequences/0${number}-f-${i}.png` })),
});

test('builders may run try.mjs on their own work, exactly, and at most twice each', () => {
  for (const agent of ['frame-worker-scene', 'frame-worker-tech', 'scene-builder']) {
    for (const command of ['node assets/kit/try.mjs frame 04-analogy', 'node assets/kit/try.mjs world', 'node assets/kit/try.mjs props']) {
      assert.equal(checkToolCall('Bash', { command }, JOB, agent).allow, true, `${agent}: ${command}`);
    }
    for (const command of ['node assets/kit/try.mjs all', 'node assets/kit/try.mjs frame ../x', 'node assets/kit/try.mjs frame 04 && ls', 'node assets/kit/mount.mjs 04-analogy']) {
      assert.equal(checkToolCall('Bash', { command }, JOB, agent).allow, false, `${agent}: ${command}`);
    }
  }
  const counts = new Map<string, number>();
  const cmd = 'node assets/kit/try.mjs frame 04-analogy';
  for (let i = 0; i < SELF_CHECKS_PER_BUILDER; i += 1) assert.equal(selfCheckBudget(counts, 'a1', cmd).allow, true);
  assert.equal(selfCheckBudget(counts, 'a1', cmd).allow, false, 'the third run is refused');
  assert.equal(selfCheckBudget(counts, 'a2', cmd).allow, true, 'per builder');
  assert.equal(selfCheckBudget(counts, 'a1', 'node assets/kit/snap.mjs 04-analogy 1').allow, true, 'snaps are not counted here');
});

test('risk: breakage, edges, many shots and a look change raise it; risky frames get large tiles', () => {
  assert.equal(frameRisk(frame(2, 'world', 2), []), 0);
  assert.equal(frameRisk(frame(2, 'blend', 4), []), 2);
  assert.equal(frameRisk(frame(2, 'world', 1), [warn(2, 'breakage:framing')]), 3);
  assert.equal(frameRisk(frame(2, 'world', 1), [warn(3, 'breakage:framing')]), 0, 'another frame\'s breakage');
  const g = gridFrames([frame(2, 'world', 2), frame(3, 'world', 2)], [warn(3, 'breakage:jump_cut')]);
  assert.deepEqual(g.map((f) => f.size), ['small', 'large']);
  assert.ok(RISKY_AT === 2);
  assert.equal(g[0].tiles[1].label, '02-f 1.00s');
});

test('grid layout: every still placed, inside the grid, a new grid when one is full', () => {
  const frames = gridFrames([1, 2, 3, 4, 5, 6, 7].map((n) => frame(n, n % 2 ? 'blend' : 'world', 6)), []);
  const grids = gridLayout(frames);
  assert.equal(grids.flatMap((g) => g.items).length, 42, 'every still seen');
  assert.ok(grids.length >= 1 && grids.length <= 8, `${grids.length} grids`);
  for (const g of grids) {
    assert.ok(g.width <= GRID_MAX && g.height <= GRID_MAX + TILE.large.h, `${g.width}x${g.height}`);
    for (const it of g.items) assert.ok(it.x + it.w <= g.width && it.y + it.h <= g.height);
  }
  assert.equal(grids.flatMap((g) => g.heads).length, 7);
});

test('grids render with sharp; the request caches the instructions and carries the lines', async () => {
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-'));
  const f = frame(4, 'world', 2);
  fs.mkdirSync(path.join(dir, '.hyperframes', 'sequences'), { recursive: true });
  for (const s of f.stills) await sharp({ create: { width: 108, height: 192, channels: 3, background: '#3366cc' } }).png().toFile(path.join(dir, s.file));
  const jpegs = await renderGrids(dir, gridLayout(gridFrames([f], [])));
  assert.equal(jpegs.length, 1);
  assert.ok(jpegs[0].length > 500);
  const p = pictureGridParams('claude-haiku-5-5', [f], jpegs);
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.ok((p.system as { cache_control?: unknown }[])[0].cache_control, 'stable prefix cached');
  assert.match((p.system as { text: string }[])[0].text, /contact grid/);
  const content = p.messages[0].content as { type: string; text?: string }[];
  assert.equal(content.filter((c) => c.type === 'image').length, 1);
  assert.match(content.at(-1)!.text!, /- 04-f \(stills 0\.00s, 1\.00s\): "a line"/);
});

test('picture fix agent by look; findChrome reads the cache walk', () => {
  assert.equal(pictureFixAgent('mechanism'), 'frame-worker-tech');
  assert.equal(pictureFixAgent('blend'), 'frame-worker-scene');
  assert.equal(pictureFixAgent(undefined), 'frame-worker-scene');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  assert.equal(findChrome([home]), null);
  const bin = path.join(home, '.cache', 'hyperframes', 'chrome', 'v1', 'chrome-headless-shell');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '');
  fs.chmodSync(bin, 0o755);
  assert.equal(findChrome([fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')), home]), bin);
});
