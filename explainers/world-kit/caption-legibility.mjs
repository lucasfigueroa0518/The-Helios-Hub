// The caption legibility check (Lucas 2026-11-17: "captions must be legible over any background,
// always"). Deterministic, no model. The caption skin's halo is the design fix (every letter is cut
// out of the picture by a ring of the opposite tone); this is the net that measures it on real
// pixels: the caption composited over a still of the frame, and the colour right around each
// glyph compared with the caption ink.
//
//   node assets/kit/caption-legibility.mjs <captions.html> <reel-t> <background.png> <out.png>
//
// <captions.html> is the built compositions/captions.html (it must sit in the project root's
// compositions/ so its font urls resolve), <reel-t> the reel time in seconds, <background.png> a
// 1080x1920 still of the picture at that moment without captions (snap.mjs writes them). Writes
// the composite to <out.png> and prints JSON { ok, contrast, low, ringPx, ink, skipped? }; exits 1
// when the caption fails (MIN_CONTRAST). Without a driver, a Chrome or pngjs it prints
// { ok: true, skipped } and exits 0: a guard, never a blocker.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The weakest ring contrast (5th percentile) a caption may have: WCAG AA for large text is 3. */
export const MIN_CONTRAST = 4.5;
/** At most this share of the ring may fall under 3:1 (a glyph's edge meeting the picture). */
export const MAX_LOW = 0.02;
/** How far from a glyph edge the ring is sampled, in px: inside the skin's solid halo (HALO_R 10). */
export const RING_PX = 6;

/** WCAG relative luminance of an sRGB colour [r, g, b] (0–255). */
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colours (1–21). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The ring around the glyphs: pixels within `ring` px (square neighbourhood) of a glyph pixel and
 * not glyph themselves. `mask` is one alpha byte per pixel (glyph where >= 128).
 * @param {Uint8Array | number[]} mask @param {number} w @param {number} h @param {number} ring
 * @returns {Uint8Array} 1 where a pixel is in the ring
 */
export function ringOf(mask, w, h, ring) {
  // separable dilation: rows, then columns
  const glyph = (i) => mask[i] >= 128;
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (glyph(y * w + x)) last = x;
      if (x - last <= ring) rows[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (glyph(y * w + x)) last = x;
      if (last - x <= ring) rows[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (rows[y * w + x]) last = y;
      if (y - last <= ring) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (rows[y * w + x]) last = y;
      if (last - y <= ring) out[y * w + x] = 1;
    }
  }
  for (let i = 0; i < w * h; i++) if (glyph(i)) out[i] = 0;
  return out;
}

/**
 * How well the caption ink stands off what touches it. `rgba`: the composited frame (4 bytes a
 * pixel), `mask`: the glyph alpha (one byte a pixel), `ink`: the caption colour. Returns the 5th
 * percentile contrast over the ring, the share of ring pixels under 3:1, and the ring size; a
 * caption with no glyphs on screen returns { contrast: 21, low: 0, ringPx: 0 }.
 */
export function ringContrast(rgba, mask, w, h, ink, ring = RING_PX) {
  const r = ringOf(mask, w, h, ring);
  const vals = [];
  for (let i = 0; i < w * h; i++) {
    if (!r[i]) continue;
    vals.push(contrastRatio(ink, [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]));
  }
  if (!vals.length) return { contrast: 21, low: 0, ringPx: 0 };
  vals.sort((a, b) => a - b);
  const low = vals.filter((v) => v < 3).length / vals.length;
  return { contrast: Number(vals[Math.floor(vals.length * 0.05)].toFixed(2)), low: Number(low.toFixed(4)), ringPx: vals.length };
}

/** The verdict for a ringContrast result. */
export function legible({ contrast, low, ringPx }) {
  return ringPx === 0 || (contrast >= MIN_CONTRAST && low <= MAX_LOW);
}

/** Parse a hex or rgb() CSS colour to [r, g, b]. */
export function parseColor(css) {
  const s = String(css).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) return [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16));
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [23, 23, 23];
}

/**
 * Composite the built captions over a background still at reel time `t` and measure it.
 * Returns { ok, contrast, low, ringPx, ink } or { ok: true, skipped }.
 */
export async function checkCaptionAt(captionsHtml, t, backgroundPng, outPng) {
  const req = createRequire(join(process.cwd(), 'noop.js'));
  const reqHere = createRequire(import.meta.url);
  let PNG;
  try { ({ PNG } = req('pngjs')); } catch { try { ({ PNG } = reqHere('pngjs')); } catch { return { ok: true, skipped: 'no pngjs' }; } }
  const { driver, findChrome } = await import('./bounds.mjs');
  const drv = await driver();
  const chrome = findChrome();
  if (!drv || !chrome) return { ok: true, skipped: !drv ? 'no browser driver' : 'no headless Chrome' };

  const built = readFileSync(captionsHtml, 'utf8').replace(/^<template[^>]*>/, '').replace(/<\/template>\s*$/, '');
  const root = resolve(dirname(captionsHtml), '..');
  const bg = readFileSync(backgroundPng).toString('base64');
  const page = `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(root + '/').href}">
<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:transparent}
#bg{position:absolute;inset:0;width:1080px;height:1920px}
#wrap{position:absolute;inset:0;width:1080px;height:1920px}</style></head>
<body><img id="bg" src="data:image/png;base64,${bg}"><div id="wrap">${built}</div></body></html>`;
  const tmp = join(root, '.caption-legibility.html');
  writeFileSync(tmp, page);

  const browser = await drv.launch(chrome);
  try {
    const pg = await browser.page();
    await pg.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await pg.evaluate(async (time) => {
      await document.fonts.ready;
      window.__timelines.captions.seek(time);
    }, t);
    const full = await pg.screenshot({ type: 'png' });
    writeFileSync(outPng, full);
    const ink = await pg.evaluate(() => {
      const c = document.querySelector('.caption-line.cap-ink') || document.querySelector('.caption-line');
      return c ? getComputedStyle(c).color : '#171717';
    });
    // the glyph mask: the ink copy alone on nothing
    await pg.evaluate(() => {
      document.getElementById('bg').style.display = 'none';
      for (const el of document.querySelectorAll('.caption-line.cap-halo')) el.style.visibility = 'hidden';
      for (const el of document.querySelectorAll('.caption-line')) el.style.color = '#000';
    });
    const maskShot = await pg.screenshot({ type: 'png', omitBackground: true });
    const a = PNG.sync.read(full);
    const m = PNG.sync.read(maskShot);
    const mask = new Uint8Array(m.width * m.height);
    for (let i = 0; i < mask.length; i++) mask[i] = m.data[i * 4 + 3];
    const inkRgb = parseColor(ink);
    const res = ringContrast(a.data, mask, a.width, a.height, inkRgb);
    return { ok: legible(res), ...res, ink: inkRgb };
  } finally {
    await browser.close();
    try { (await import('node:fs')).unlinkSync(tmp); } catch { /* gone */ }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [html, t, bg, out] = process.argv.slice(2);
  if (!html || !t || !bg || !out) {
    console.error('usage: node caption-legibility.mjs <captions.html> <reel-t> <background.png> <out.png>');
    process.exit(2);
  }
  // no top-level await: tests load this module through a CJS transform
  checkCaptionAt(resolve(html), Number(t), resolve(bg), resolve(out)).then((res) => {
    console.log(JSON.stringify(res, null, 1));
    process.exit(res.ok ? 0 : 1);
  });
}
