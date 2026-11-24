// The caption scrim (Lucas 2026-11-17): a white gradient behind the captions only where the picture
// clashes with them. Offline: the window maths, the pixel count and the skin's hooks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CLASH_SHARE, clashShare, fillScrim, frameWindows, MIN_WINDOW, PAPER_INK, sampleTimes, STEP } from '../explainers/world-kit/caption-scrim.mjs';

const SKIN = fs.readFileSync(path.join(process.cwd(), 'explainers', 'frame-presets', 'helios', 'caption-skin.html'), 'utf8');

test('a frame is measured every STEP seconds, inside the frame', () => {
  assert.deepEqual(sampleTimes(2), [0.25, 0.75, 1.25, 1.75]);
  assert.equal(STEP, 0.5);
});

test('clashing moments become windows in reel time: near ones merge, short ones grow, all inside the frame', () => {
  // frame from 10 s, 8 s long; clashes at 1.25–2.25 and a lone one at 6.75
  const w = frameWindows([1.25, 1.75, 2.25, 6.75], 10, 8);
  assert.deepEqual(w[0], [11, 12.5]);
  assert.ok(Math.abs(w[1][1] - w[1][0] - MIN_WINDOW) < 1e-6, 'a lone moment grows to MIN_WINDOW');
  assert.ok(w[1][1] <= 18 && w[1][0] >= 10);
  // a lone moment at the frame's very end stays inside it
  const edge = frameWindows([7.75], 10, 8);
  assert.equal(edge[0][1], 18);
  assert.equal(frameWindows([], 0, 5).length, 0);
});

test('dark pixels in the band clash with ink captions; paper does not', () => {
  const w = 10;
  const h = 10;
  const paper = new Uint8Array(w * h * 4).fill(246);
  assert.equal(clashShare(paper, w, h, PAPER_INK, 1), 0);
  const busy = paper.slice();
  for (let i = 0; i < 20; i++) busy.set([30, 30, 30, 255], i * 4); // 20% dark
  assert.ok(clashShare(busy, w, h, PAPER_INK, 1) > CLASH_SHARE);
});

test('the skin has the SCRIM hole, the gradient layer, ink words under it, and seek-safe fades', () => {
  assert.match(SKIN, /^\s*var SCRIM = \[\];/m);
  assert.match(SKIN, /<div id="caption-scrim" class="caption-scrim"><\/div>\s*<div id="caption-stage"/);
  assert.match(SKIN, /\.caption-scrim \{[\s\S]*?linear-gradient\(to bottom, rgba\(251, 250, 246, 0\.96\)/);
  assert.match(SKIN, /\.caption-stage\.on-scrim \.caption-line \{\s*color: #171717;/);
  assert.ok(SKIN.indexOf('.caption-stage.on-scrim') > SKIN.indexOf('.caption-stage.on-dark'), 'ink wins over the dark-ground white');
  assert.match(SKIN, /inside\(SCRIM, t\) \? " on-scrim"/);
  assert.match(SKIN, /tl\.fromTo\(scrim/);
  assert.equal(fillScrim(SKIN, [[1, 2]]).match(/var SCRIM = \[\[1,2\]\];/)?.length, 1);
});
