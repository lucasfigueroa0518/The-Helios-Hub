/** The reel is re-encoded under the upload limit before delivery (render/video.ts fitForDelivery). Local ffmpeg only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fitForDelivery } from '@/lib/reel-ai-drama/render/video';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function makeReel(dir: string): string {
  const out = path.join(dir, 'renders', 'video.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-b:v', '12M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
  assert.equal(res.status, 0, String(res.stderr));
  return out;
}

test('a reel under the limit is left alone and nothing runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-fit-'));
  const video = path.join(dir, 'video.mp4');
  fs.writeFileSync(video, Buffer.alloc(1000));
  let calls = 0;
  const fit = fitForDelivery(video, { maxBytes: 2000, run: () => { calls += 1; return { status: 0, stdout: '', stderr: '' }; } });
  assert.deepEqual(fit, { changed: false, fits: true, beforeBytes: 1000, afterBytes: 1000 });
  assert.equal(calls, 0);
});

test('a reel over the limit is re-encoded in place under it, sound kept', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-fit-'));
  const video = makeReel(dir);
  const before = fs.statSync(video).size;
  const maxBytes = Math.floor(before / 3);
  const fit = fitForDelivery(video, { maxBytes });
  assert.ok(fit.changed && fit.fits, JSON.stringify(fit));
  assert.ok(fs.statSync(video).size <= maxBytes);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', video], { encoding: 'utf8' });
  assert.deepEqual(probe.stdout.trim().split('\n').sort(), ['audio', 'video']);
  assert.ok(!fs.existsSync(video.replace(/\.mp4$/, '.delivery.mp4')));
});

test('a reel that cannot fit is kept as rendered and says so', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-fit-'));
  const video = makeReel(dir);
  const before = fs.statSync(video).size;
  const fit = fitForDelivery(video, { maxBytes: 1000 });
  assert.equal(fit.fits, false);
  assert.equal(fs.statSync(video).size, before);
});
