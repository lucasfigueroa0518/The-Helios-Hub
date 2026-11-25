// Captions are legible over any picture (Lucas 2026-11-17, the RAG reel at 0:17 and 0:22): the
// halo was dropped (Lucas 2026-11-17); caption-legibility.mjs still measures the ring around the
// glyphs on real pixels, the detector for a per-frame fix. Offline: pure functions.
import assert from 'node:assert/strict';
import test from 'node:test';

import { contrastRatio, legible, MIN_CONTRAST, parseColor, RING_PX, ringContrast, ringOf } from '../explainers/world-kit/caption-legibility.mjs';

test('contrast ratio follows WCAG', () => {
  assert.equal(Number(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(1)), 21);
  assert.equal(contrastRatio([23, 23, 23], [23, 23, 23]), 1);
  assert.ok(contrastRatio([23, 23, 23], [251, 250, 246]) > 15);
  assert.deepEqual(parseColor('rgb(23, 23, 23)'), [23, 23, 23]);
  assert.deepEqual(parseColor('#fbfaf6'), [251, 250, 246]);
});

/** A 40x20 frame: a 4x4 glyph at (18, 8), the picture `bg`, and an optional halo ring of `halo`. */
function frame(bg: number[], halo: number[] | null, haloR = 8) {
  const w = 40;
  const h = 20;
  const rgba = new Uint8Array(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const inGlyph = x >= 18 && x < 22 && y >= 8 && y < 12;
      const dx = Math.max(18 - x, x - 21, 0);
      const dy = Math.max(8 - y, y - 11, 0);
      const inHalo = halo && Math.max(dx, dy) <= haloR;
      const c = inGlyph ? [23, 23, 23] : inHalo ? halo : bg;
      rgba.set([...c, 255], i * 4);
      if (inGlyph) mask[i] = 255;
    }
  }
  return { rgba, mask, w, h };
}

test('ringOf is the band around the glyphs, glyphs excluded', () => {
  const { mask, w, h } = frame([255, 255, 255], null);
  const r = ringOf(mask, w, h, 2);
  assert.equal(r[10 * w + 20], 0, 'glyph pixel is not ring');
  assert.equal(r[10 * w + 23], 1, 'one px off the glyph is ring');
  assert.equal(r[10 * w + 25], 0, 'four px off is outside a 2px ring');
  assert.equal(r.reduce((n: number, v: number) => n + v, 0), 8 * 8 - 16);
});

test('dark ink on a dark picture fails; the same picture with the paper halo passes', () => {
  const ink = [23, 23, 23];
  const bare = frame([30, 30, 30], null);
  const bad = ringContrast(bare.rgba, bare.mask, bare.w, bare.h, ink);
  assert.ok(bad.contrast < MIN_CONTRAST && !legible(bad), JSON.stringify(bad));
  const haloed = frame([30, 30, 30], [251, 250, 246]);
  const good = ringContrast(haloed.rgba, haloed.mask, haloed.w, haloed.h, ink);
  assert.ok(good.contrast >= MIN_CONTRAST && good.low === 0 && legible(good), JSON.stringify(good));
  // a halo thinner than the checked ring lets the picture touch the ink: flagged
  const thin = frame([30, 30, 30], [251, 250, 246], 2);
  assert.equal(legible(ringContrast(thin.rgba, thin.mask, thin.w, thin.h, ink)), false);
  // nothing on screen is legible by definition
  assert.ok(legible(ringContrast(bare.rgba, new Uint8Array(bare.w * bare.h), bare.w, bare.h, ink)));
});
