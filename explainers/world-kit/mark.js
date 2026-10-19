// The Explainers world kit (from Explainer 2.0), the mark (hx-3): the Helios logo landing after the payoff
// (VISUAL V-19) under logo protection (V-T4).
//
//   V-19  the mark lands in the world over 0.8 to 1.2s and holds to the end, motivated by the
//         payoff, in open space (V-20), 40 to 55% of the frame wide, inside the safe area (V-T3),
//         with no voice and nothing over it.
//   V-T4  the logo is the file itself (assets/Helios-logo.png): whole, unobscured, never cropped,
//         recolored, distorted or rotated, with clear space at least the height of its "H" on
//         every side. The logo's own gradient belongs to the logo; the palette rule (V-T1) governs
//         only what we draw around it: the contact shadow.
//
// The landing has weight (V-8): the mark drops in from above the frame and hangs, lifts a touch
// (the anticipation before the slam), slams onto the table, and settles with a small uniform
// spring (POLARITY.spring) about its base, so its proportions never change. Its contact shadow
// grows as it nears the table. It moves on twos like everything drawn in the world (V-15). At rest
// it is the bare image, with no transform and no filter.
//
// Draw it last, outside the camera group (after frame()), so nothing ever covers it. No DOM, no
// imports beyond core, so the boxes and checks run in Node tests.

import { TOKENS as T, FRAME, POLARITY, FPS_CAST, clamp, onTwos } from './core.js';

export const MARK = {
  src: 'assets/Helios-logo.png',
  /** The wordmark's cap height ("H") as a share of the logo width: the clear space (V-T4). */
  capHeight: 0.14,
  /** V-19: width 40 to 55% of the frame; the landing takes 0.8 to 1.2s. */
  width: [0.4, 0.55],
  dur: [0.8, 1.2],
  /** Where in the landing (0..1) the mark touches the table. */
  contact: 0.7,
};

const DEFAULT_WIDTH = 0.48 * FRAME.w;

/** The logo's box at rest (square, the file is 1200×1200) and its clear space in px. */
export function markBox({ cx, cy, width = DEFAULT_WIDTH }) {
  const half = width / 2;
  return { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half, w: width, h: width, clear: MARK.capHeight * width };
}

/** True when the box, grown by its clear space on every side, sits inside the safe area (V-T3),
 *  and its width is within V-19's 40 to 55% of the frame. */
export function markOk(box) {
  const { x0, x1, y0, y1 } = FRAME.safe;
  const c = box.clear;
  const share = box.w / FRAME.w;
  return box.x0 - c >= x0 - 1e-9 && box.x1 + c <= x1 + 1e-9 && box.y0 - c >= y0 - 1e-9 && box.y1 + c <= y1 + 1e-9
    && share >= MARK.width[0] - 1e-9 && share <= MARK.width[1] + 1e-9;
}

/** Shot time of the frame where the mark touches the table, for a landing that starts at `at`:
 *  the first on-twos frame at or after contact. Put the landing cue here (A-5). */
export const markContact = (at, dur = 1.0) => Math.ceil((at + MARK.contact * dur) * FPS_CAST - 1e-6) / FPS_CAST;

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
const f2 = (v) => v.toFixed(2);

/** How far above its resting place the mark is at landing progress u (px), and its uniform
 *  settle scale. */
function pose(u, width, cy) {
  const top = cy + width / 2 + 40;
  // It hangs, and lifts, inside its own clear space (one cap height above its rest), so once it
  // has arrived it never crosses what sits around it (V-T4, V-20).
  const hover = 0.11 * width;
  const lift = 0.135 * width;
  if (u < 0.45) return { h: top + (hover - top) * POLARITY.slam(u / 0.45), k: 1 };
  if (u < 0.55) return { h: hover + (lift - hover) * POLARITY.glide((u - 0.45) / 0.1), k: 1 };
  if (u < MARK.contact) return { h: lift * (1 - POLARITY['ramp-up']((u - 0.55) / (MARK.contact - 0.55))), k: 1 };
  if (u < 1) return { h: 0, k: 0.94 + 0.06 * POLARITY.spring((u - MARK.contact) / (1 - MARK.contact)) };
  return { h: 0, k: 1 };
}

/**
 * The mark landing at shot time `at`, centered at rest on (cx, cy), `width` px wide, over `dur`
 * seconds. Returns '' before it starts. `dark`: the shadow on a night or forest ground.
 */
export function markLanding(t, at, { cx, cy, width = DEFAULT_WIDTH, dark = false, dur = 1.0 }) {
  if (!(dur >= MARK.dur[0] - 1e-9 && dur <= MARK.dur[1] + 1e-9)) throw new Error(`HX: the mark lands over ${MARK.dur[0]} to ${MARK.dur[1]}s (V-19).`);
  const share = width / FRAME.w;
  if (share < MARK.width[0] - 1e-9 || share > MARK.width[1] + 1e-9) throw new Error('HX: the mark is 40 to 55% of the frame wide (V-19).');
  const tc = onTwos(t);
  if (tc < at) return '';
  const u = clamp((tc - at) / dur, 0, 1);
  const { h, k } = pose(u, width, cy);
  const half = width / 2;
  const base = cy + half;

  // The contact shadow on the table, under the mark: it gathers as the mark comes down (V-3).
  const near = 1 - clamp(h / (0.6 * width), 0, 1);
  const parts = [];
  if (near > 0) {
    const fill = dark ? T.canvas : T.ink;
    const opacity = (dark ? 0.07 : 0.14) * near;
    parts.push(`<ellipse ${attrs({ cx: f2(cx), cy: f2(base - 0.012 * width), rx: f2(0.36 * width * (0.55 + 0.45 * near) * k), ry: f2(0.045 * width * (0.55 + 0.45 * near)), fill, opacity: opacity.toFixed(3) })}></ellipse>`);
  }

  const image = `<image ${attrs({ href: MARK.src, x: f2(cx - half), y: f2(cy - half), width: f2(width), height: f2(width), preserveAspectRatio: 'xMidYMid meet' })}></image>`;
  if (h === 0 && k === 1) parts.push(image);
  else parts.push(`<g transform="translate(0 ${f2(-h)}) translate(${f2(cx)} ${f2(base)}) scale(${k.toFixed(4)}) translate(${f2(-cx)} ${f2(-base)})">${image}</g>`);
  return parts.join('');
}
