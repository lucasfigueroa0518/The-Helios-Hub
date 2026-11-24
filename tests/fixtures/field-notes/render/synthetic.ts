/**
 * Synthetic test photos, generated in code with sharp (never real photos): a dark one, a bright one,
 * a mid-tone one, a busy one (stripes like a fence, noise like foliage), and a calm-left/busy-right one.
 * All are 1080x1350 JPEGs; a tiny seeded PRNG keeps them identical run to run.
 */
import sharp from 'sharp';

export const W = 1080;
export const H = 1350;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Pixel = (x: number, y: number, rand: () => number) => [number, number, number];

async function make(pixel: Pixel, seed: number, size = { w: W, h: H }): Promise<Buffer> {
  const rand = rng(seed);
  const data = Buffer.alloc(size.w * size.h * 3);
  for (let y = 0; y < size.h; y++) {
    for (let x = 0; x < size.w; x++) {
      const [r, g, b] = pixel(x, y, rand);
      const i = (y * size.w + x) * 3;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
  }
  return sharp(data, { raw: { width: size.w, height: size.h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

const grain = (rand: () => number) => (rand() - 0.5) * 6;

/** Dark, calm: deep blue-gray with a soft vertical gradient. */
export const darkPhoto = () => make((x, y, r) => { const t = y / H; const n = grain(r); return [22 + 18 * t + n, 28 + 20 * t + n, 40 + 24 * t + n]; }, 1);

/** Bright, calm: warm off-white sky with a slight gradient. */
export const brightPhoto = () => make((x, y, r) => { const t = y / H; const n = grain(r); return [242 - 14 * t + n, 240 - 12 * t + n, 232 - 10 * t + n]; }, 2);

/** Mid-tone, calm: flat gray around relative luminance 0.2, where neither white nor off-black clears 4.5:1. */
export const midPhoto = () => make((x, y, r) => { const n = grain(r); return [122 + n, 122 + n, 122 + n]; }, 3);

/** Busy everywhere: vertical bars (a fence), a checker (a screen) and noise (foliage). */
export const busyPhoto = () => make((x, y, r) => {
  const bars = Math.floor(x / 7) % 2 === 0 ? 60 : 200;
  const checker = (Math.floor(x / 11) + Math.floor(y / 11)) % 2 === 0 ? 40 : 0;
  const v = y < H / 3 ? bars : y < (2 * H) / 3 ? 70 + checker * 3 : r() * 255;
  return [v, v, v];
}, 4);

/** Calm dark on the left 55%, busy bars on the right. */
export const splitPhoto = () => make((x, y, r) => {
  if (x < W * 0.55) { const n = grain(r); return [30 + n, 36 + n, 48 + n]; }
  const v = Math.floor(x / 6) % 2 === 0 ? 50 : 210;
  return [v, v, v];
}, 5);

/** Bright left half and dark right half with a hard seam: one block cannot satisfy both sides. */
export const seamPhoto = () => make((x, y, r) => { const n = grain(r); return x < W / 2 ? [245 + n, 245 + n, 245 + n] : [10 + n, 10 + n, 10 + n]; }, 6);

/** Dark calm photo with a skin-toned ellipse standing in for a face, plus its box (canvas px). */
export const FACE_BOX = { x: 600, y: 600, w: 240, h: 300 };
export async function darkWithFace(): Promise<Buffer> {
  const base = await darkPhoto();
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${FACE_BOX.x + FACE_BOX.w / 2}" cy="${FACE_BOX.y + FACE_BOX.h / 2}" rx="${FACE_BOX.w / 2}" ry="${FACE_BOX.h / 2}" fill="#c68b6a"/></svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 95 }).toBuffer();
}

/** A rotated JPEG (EXIF orientation 6): stored landscape, displayed portrait. */
export async function exifRotatedPhoto(): Promise<Buffer> {
  const landscape = await make((x, y, r) => { const n = grain(r); return x < 800 ? [20 + n, 26 + n, 36 + n] : [200 + n, 60 + n, 40 + n]; }, 7, { w: 1350, h: 1080 });
  return sharp(landscape).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
}

/** The photo size a phone really gives: taller than the 4:5 canvas, so a crop can slide up and down 450px. */
export const SLACK_W = 1080;
export const SLACK_H = 1800;

/** Busy bars everywhere except a calm dark band from y=1000 down: only a crop that slides down puts a tall text stack on it. */
export const slackyPhoto = () => make((x, y, r) => {
  if (y >= 1000) { const n = grain(r); return [24 + n, 30 + n, 44 + n]; }
  const v = Math.floor(x / 7) % 2 === 0 ? 50 : 210;
  return [v, v, v];
}, 8, { w: SLACK_W, h: SLACK_H });

/** Like `slackyPhoto`, but the calm band starts at y=1250: the centre crop shows only a 325px sliver (under the safe margin and the stack) of it, so only a slid crop fits a text stack. */
export const slackyLowPhoto = () => make((x, y, r) => {
  if (y >= 1250) { const n = grain(r); return [24 + n, 30 + n, 44 + n]; }
  const v = Math.floor(x / 7) % 2 === 0 ? 50 : 210;
  return [v, v, v];
}, 9, { w: SLACK_W, h: SLACK_H });

/** Dark calm photo with one saturated orange-and-cyan blob: the only salient thing in it. */
export const BLOB = { cx: 800, cy: 1020, r: 90 };
export async function blobPhoto(): Promise<Buffer> {
  const base = await darkPhoto();
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><circle cx="${BLOB.cx}" cy="${BLOB.cy}" r="${BLOB.r}" fill="#ff7a00"/><circle cx="${BLOB.cx + 20}" cy="${BLOB.cy - 20}" r="40" fill="#00e0ff"/></svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 95 }).toBuffer();
}

/** The blob photo with a face-coloured ellipse in the upper right (box `BLOB_FACE`), both salient. */
export const BLOB_FACE = { x: 810, y: 150, w: 170, h: 220 };
export async function blobWithFace(): Promise<Buffer> {
  const base = await blobPhoto();
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${BLOB_FACE.x + BLOB_FACE.w / 2}" cy="${BLOB_FACE.y + BLOB_FACE.h / 2}" rx="${BLOB_FACE.w / 2}" ry="${BLOB_FACE.h / 2}" fill="#e0a07a"/></svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 95 }).toBuffer();
}

/** Soft but busy: smooth sine bands (no hard edges, so no edge density) with a big luminance swing, like a screen glow or a crowd out of focus. */
export const glowPhoto = () => make((x, y, r) => { const v = 128 + 127 * Math.sin(x / 9) * Math.cos(y / 12) + (r() - 0.5) * 4; return [v, v, v]; }, 10);

/** Two calm dark columns (x 80-450 and x 630-1000) with a busy band of bars between them: only a piece in each column can be read. */
export const COLUMN_LEFT_END = 450;
export const COLUMN_RIGHT_START = 630;
export const columnsPhoto = () => make((x, y, r) => {
  if (x >= COLUMN_LEFT_END && x < COLUMN_RIGHT_START) { const v = Math.floor(x / 6) % 2 === 0 ? 40 : 215; return [v, v, v]; }
  const n = grain(r);
  return [28 + n, 34 + n, 46 + n];
}, 11);

/** Calm grey ceiling with one small blown-out light: the light's box (canvas px) is `LIGHT_BOX`. */
export const LIGHT_BOX = { x: 200, y: 200, w: 70, h: 56 };
export const lightsPhoto = () => make((x, y, r) => {
  const inside = ((x - 235) / 35) ** 2 + ((y - 228) / 28) ** 2 <= 1;
  if (inside) return [255, 252, 240];
  const n = grain(r);
  return [112 + n, 116 + n, 122 + n];
}, 12);

/** A bright "screen": pale panel with thin dark UI rows (low edge density, but bright and contrasty). Box = `SCREEN_BOX`. */
export const SCREEN_BOX = { x: 120, y: 120, w: 840, h: 520 };
export const screenPhoto = () => make((x, y, r) => {
  const n = grain(r);
  if (x >= SCREEN_BOX.x && x < SCREEN_BOX.x + SCREEN_BOX.w && y >= SCREEN_BOX.y && y < SCREEN_BOX.y + SCREEN_BOX.h) {
    return (y - SCREEN_BOX.y) % 36 < 4 ? [30 + n, 34 + n, 40 + n] : [232 + n, 234 + n, 238 + n];
  }
  return [24 + n, 30 + n, 42 + n];
}, 13);

/** Big text in the photo: wide white bars across the middle band (y 520-760) on a calm dark photo. */
export const BIG_TEXT_BAND = { y0: 520, y1: 760 };
export const bigTextPhoto = () => make((x, y, r) => {
  const n = grain(r);
  const inBand = y >= BIG_TEXT_BAND.y0 && y < BIG_TEXT_BAND.y1;
  if (inBand && ((y - BIG_TEXT_BAND.y0) % 120) < 80 && Math.floor(x / 90) % 3 !== 2) return [245, 245, 245];
  return [26 + n, 32 + n, 44 + n];
}, 14);

/** Calm dark pockets only: A (x 80-520, y 80-330) and B (x 560-1000, y 380-640); busy bars everywhere else. Neither pocket holds a whole stack of three pieces. */
export const POCKET_A = { x: 80, y: 80, w: 440, h: 250 };
export const POCKET_B = { x: 560, y: 380, w: 440, h: 260 };
export const pocketsPhoto = () => make((x, y, r) => {
  const inA = x >= POCKET_A.x - 30 && x < POCKET_A.x + POCKET_A.w + 30 && y >= POCKET_A.y - 30 && y < POCKET_A.y + POCKET_A.h + 30;
  const inB = x >= POCKET_B.x - 30 && x < POCKET_B.x + POCKET_B.w + 30 && y >= POCKET_B.y - 30 && y < POCKET_B.y + POCKET_B.h + 30;
  if (inA || inB) { const n = grain(r); return [28 + n, 34 + n, 46 + n]; }
  const v = Math.floor(x / 6) % 2 === 0 ? 40 : 215;
  return [v, v, v];
}, 15);

/** Bright AND busy everywhere (pale fence bars and pale noise): white text needs the overlay raised step by step. */
export const brightBusyPhoto = () => make((x, y, r) => {
  const bars = Math.floor(x / 9) % 2 === 0 ? 205 : 250;
  const v = y < H / 2 ? bars + (r() - 0.5) * 20 : 215 + r() * 40;
  return [v, v, v - 4];
}, 11);

/** Pure white: unreadable for white text at any gentle overlay (the photo-swap case). */
export const whitePhoto = () => make(() => [255, 255, 255], 12);

/** Calm dark everywhere except a busy band across the vertical centre (y 600-750). */
export const CENTRE_BAND = { y0: 600, y1: 750 };
export const centreBusyPhoto = () => make((x, y, r) => {
  if (y >= CENTRE_BAND.y0 && y < CENTRE_BAND.y1) { const v = Math.floor(x / 6) % 2 === 0 ? 40 : 200; return [v, v, v]; }
  const n = grain(r); return [30 + n, 34 + n, 44 + n];
}, 13);

/**
 * A bright overcast sky that darkens smoothly toward the bottom (no edges, so the busyness rule never moves the block):
 * `top` + 0.3 per pixel above y=800, clipped. At top=220 the planner's old whole-block estimate (which ran one body
 * line past the real text into darker sky) passed the darkened body while the rendered-pixel check measured 4.27
 * (needs 4.5): the post of 2026-11-08, slide 3. Higher `top` is brighter everywhere.
 */
export const brightSkyPhoto = (top = 220) => make((x, y, r) => { const v = top + 0.3 * (800 - y) + (r() - 0.5) * 6; return [v, v, v + 4]; }, 13);
