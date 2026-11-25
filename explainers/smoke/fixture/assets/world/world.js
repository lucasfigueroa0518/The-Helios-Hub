// Smoke fixture world (Explainers 3.2): "why prompt caching saves money", adapted from Explainer
// 2.0's stamp smoke reel. One drawing function per entity, the layout, and the states, so every
// frame that uses the scene draws it with the same code (EX3-51). The one who writes is a critter
// holding the pen, never a hand (EX3-77).

import { T, el, g, ref, inkLines } from '../kit/draw.js';
import { isoPlane } from '../kit/core.js';
import { sheet as paperSheet, coinStack, pen as inkPen } from '../kit/examples.js';
import { critter } from '../kit/cast.js';

/** What each entity stands for (the mapping beat reads this). */
export const ENTITIES = {
  sheet: 'the prompt',
  ink: 'tokens processed from scratch',
  coins: 'input tokens billed',
  writer: 'the model reading the prompt (a critter writing with a pen)',
};

/**
 * Every critter's look for the whole reel (EX3-107): try.mjs holds each frame to it. The hook's
 * hero (the opener tests' stub) is the one orange critter; the writer keeps its ink body.
 */
export const CAST = {
  writer: { body: 'ink', wear: [] },
  hero: { body: 'orange', wear: ['cap'] },
};

/**
 * Every entity's real size in cm (hx-4 scale ledger): a critter is 72 cm, the ruler. The writer is
 * a critter, so it has no entry.
 */
export const SIZES = {
  sheet: { w: 21, d: 29.7, h: 0.1 },
  ink: { w: 18, d: 24, h: 0.1 },
  coins: { w: 2.4, d: 2.4, h: 2, exaggerate: 1.5 },
};

/**
 * The scene at rest as drawn, for the try's scale check. This smoke scene is a tabletop close-up
 * that only exercises the pipeline, so it measures nothing but the critter.
 */
export const DRAWN = { critterS: 0.8 };

export const LAYOUT = {
  sheet: { w: 380, d: 520 },
  coins: { x: 687, y: 1338, rx: 64, h: 13 },
};

/** The states, and their value at the end of each beat that uses the scene. */
export const STATES = {
  lines: { start: 3, end: 10 },
  coins: { start: 3, end: 10 },
};

export const INSTRUCTIONS = [300, 320, 280, 310, 262, 330, 288, 250, 306, 276].map((w, i) => ({ u: 34, v: 48 + i * 38, w, seed: 300 + i }));

export function sheet(P) {
  return paperSheet(P, 0, 0, LAYOUT.sheet.w, LAYOUT.sheet.d);
}

/** The handwriting, `written` lines in (fractional while a line is being written). */
export function ink(P, s, written) {
  const out = inkLines(INSTRUCTIONS, written, { color: T.ink }); // ink on the paper sheet, on any ground
  return { svg: g({ transform: isoPlane(P, s, 0, 0, 5) }, g({ filter: ref('wobble') }, out.svg)), tip: out.tip && P(out.tip[0], out.tip[1], 5) };
}

/** The coin stack: `n` coins, `drop(i)` lifts coin i while it falls. */
export function coins(n, drop = () => 0) {
  const { x, y, rx, h } = LAYOUT.coins;
  return [el('ellipse', { cx: x, cy: y + 16, rx: rx + 14, ry: 30, fill: T.ink, opacity: 0.12 }), coinStack(x, y, n, rx, h, { drop })].join('');
}

export function pen(x, y, lift = 0) {
  return inkPen(x, y, { lift });
}

/** The writer: a critter right of the pen, holding it mid-shaft; the nib is at (x, y) (EX3-77). */
export function writer(x, y, { lift = 0, mood = 'focused', s = 0.8 } = {}) {
  const o = { s, flip: true, arms: { l: [-80, -54], r: [120, -60] }, mood, look: [0.7, 0.5], who: 'writer' };
  // The pen's shaft runs from the nib up and right; the hand grips it 40% of the way up.
  const grip = [x + 34, y - 92 - lift];
  const feet = [grip[0] + 120 * s, grip[1] + 60 * s];
  return inkPen(x, y, { lift }) + critter(feet[0], feet[1], o);
}
