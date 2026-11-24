// The opening's one low hit (Lucas 2026-11-17: "THE SYNTH BOOM CANNOT HAPPEN TWICE IN A ROW").
// Every opener score has no sub-bass synth; once placed, only the palette break keeps its bass, every
// other stem sound is high-passed, and the cut's sweep is high-passed again when it is prepared.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BREAK } from '../explainers/world-kit/openers/palette.mjs';
import { CUT_SWEEP_HZ, SCORES, SUB_CUT_HZ, SYNTH } from '../explainers/world-kit/openers/sound.mjs';
import { openerTiming } from '../explainers/world-kit/openers/bank.js';

const OPENERS = Object.keys(SCORES);

test('no opener score layers a sub-bass synth, and the kit has none to layer', () => {
  // the only synth left is the balloon's rubber stretch (140 Hz and up, high-passed like the rest)
  assert.deepEqual(Object.keys(SYNTH), ['stretch']);
  const scores = SCORES as unknown as Record<string, (M: unknown) => { src?: string; synth?: { expr: string } }[]>;
  for (const key of OPENERS) {
    const clips = scores[key](openerTiming(key, 3, [], { silent: true }));
    assert.ok(clips.filter((c) => c.src === BREAK).length <= 1, `${key}: one break at most`);
    assert.ok(clips.every((c) => !c.synth || /\*sin\(2\*PI\*24\*t\)/.test(c.synth.expr)), `${key}: a synth other than the stretch`);
  }
});

test('the cut sweep is cut above the sub band', () => {
  assert.ok(CUT_SWEEP_HZ >= 200 && SUB_CUT_HZ >= 100);
});

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('a placed opening: only the break plays sub-bass (the stem and the cut sweep are high-passed)', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  const src = fs.readFileSync(path.join('explainers', 'world-kit', 'openers', 'sound.mjs'), 'utf8');
  // the placement maps every clip but the break and the bed to a high-pass of at least SUB_CUT_HZ
  assert.match(src, /c\.src === 'music' \|\| \(palette\.break && c\.src === palette\.break\.file\) \? c : \{ \.\.\.c, highpass: Math\.max\(c\.highpass \?\? 0, SUB_CUT_HZ\) \}/);
  const cut = fs.readFileSync(path.join('explainers', 'world-kit', 'opener-sfx.mjs'), 'utf8');
  assert.match(cut, /highpass=f=\$\{CUT_SWEEP_HZ\}/);
  // and the filter really removes a 46 Hz boom: render one, high-pass it, measure
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-bass-'));
  const out = path.join(dir, 'b.wav');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=46:duration=1', '-af', `highpass=f=${SUB_CUT_HZ},volumedetect`, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const vd = spawnSync('ffmpeg', ['-v', 'info', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(vd.stderr)?.[1]);
  assert.ok(max < -12, `a 46 Hz boom after the high-pass peaks at ${max} dB`);
});
