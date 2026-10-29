// Pure helpers for Reel AI Drama's full-screen treatments (FRAME.md). No DOM and no imports beyond
// geometry.js, so frames use them in the browser and tests use them in Node.
//
//   cover fitting and the Ken Burns camera (push, pull, pan, hold; never a dead still) · measured page
//   marks (a key phrase's box from the harvest, image pixels → screen) · the count-up of a big number
//   · moving film grain · the safe zones the overlay words keep to

import { clamp, lerp, ellipseAround, underlineUnder, highlightBand, polyLength, FRAME } from './geometry.js';

/** Where overlay words may sit: below the caption band, above the bottom platform UI, inside the side margins. */
export const SAFE = { x0: 96, x1: 940, y0: 600, y1: 1500 };
/** The caption band (the Helios skin's: x 96–940, y 292–542; the bounds check keeps 260–560 clear). */
export const CAPTION_BAND = { top: 260, bottom: 560 };

/** Documentary moves are slow and nearly linear: a little ease at both ends, never a snap. */
export const kbEase = (u) => {
  const x = clamp(u);
  return 0.7 * x + 0.3 * (0.5 - 0.5 * Math.cos(Math.PI * x));
};

/**
 * Cover-fit an image of w×h into the frame with its focus point (fx, fy as 0–1 of the image) kept in
 * view: { scale, x, y, w, h } of the placed image in frame pixels. Unknown sizes fit the frame exactly.
 */
export function coverFit(w, h, focus = [0.5, 0.5], W = FRAME.w, H = FRAME.h) {
  if (!(w > 0 && h > 0)) return { scale: 1, x: 0, y: 0, w: W, h: H };
  const scale = Math.max(W / w, H / h);
  const dw = w * scale, dh = h * scale;
  const [fx, fy] = focus;
  // Centre the focus where possible, never leaving a gap at an edge.
  const x = clamp(W / 2 - fx * dw, W - dw, 0);
  const y = clamp(H / 2 - fy * dh, H - dh, 0);
  return { scale, x, y, w: dw, h: dh };
}

/** Image pixels → frame pixels for a cover fit. */
export const toFrame = (fit, [px, py]) => [fit.x + px * fit.scale, fit.y + py * fit.scale];

export const MOVES = ['push', 'pull', 'pan', 'hold'];
export const PAN_DIRS = ['left', 'right', 'up', 'down'];

/**
 * The Ken Burns camera at progress u (0–1 of the move's window), as a transform of the 1080×1920 layer
 * with origin 0 0: { s, tx, ty } meaning translate(tx, ty) scale(s). `at` is the frame point the move
 * goes toward (push), comes back from (pull) or holds on; `amount` is the zoom (push/pull) or the
 * overscale a pan needs (at least 0.08). The layer always covers the frame: no edge ever shows.
 *   push   1 → 1+amount toward `at` (tension, discovery)
 *   pull   1+amount → 1 away from `at` (context, release)
 *   pan    at 1+amount, across the frame in `dir` (left = the picture moves left, revealing its right)
 *   hold   a slow 1.03 → 1.06 drift on `at` (a still never sits dead, research 03 §7)
 */
export function kenBurns(move, u, { at = [FRAME.w / 2, FRAME.h / 2], amount = 0.12, dir = 'left' } = {}) {
  const k = kbEase(u);
  let s;
  let fx = at[0], fy = at[1];
  if (move === 'pull') s = 1 + amount * (1 - k);
  else if (move === 'hold') s = 1.03 + 0.03 * k;
  else if (move === 'pan') s = 1 + Math.max(0.08, amount);
  else s = 1 + amount * k;
  let tx = fx * (1 - s);
  let ty = fy * (1 - s);
  if (move === 'pan') {
    const spanX = FRAME.w * (s - 1), spanY = FRAME.h * (s - 1);
    const p = 0.1 + 0.8 * k; // 10% → 90% of the travel
    if (dir === 'left') tx = -spanX * p;
    else if (dir === 'right') tx = -spanX * (1 - p);
    else if (dir === 'up') ty = -spanY * p;
    else ty = -spanY * (1 - p);
  }
  tx = clamp(tx, FRAME.w * (1 - s), 0);
  ty = clamp(ty, FRAME.h * (1 - s), 0);
  return { s, tx, ty };
}

export const kbTransform = ({ s, tx, ty }) => `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;

/** A frame point after the Ken Burns transform. */
export const kbPoint = ({ s, tx, ty }, [x, y]) => [tx + x * s, ty + y * s];

/** The box among `boxes` ({ text, x, y, w, h } in image pixels) named by index or by (part of) its text. */
export function findBox(boxes, which) {
  const list = Array.isArray(boxes) ? boxes : boxes?.boxes ?? [];
  if (typeof which === 'number') return list[which] ?? null;
  const q = String(which ?? '').trim().toLowerCase();
  if (!q) return null;
  return list.find((b) => String(b.text ?? '').trim().toLowerCase() === q)
    ?? list.find((b) => String(b.text ?? '').toLowerCase().includes(q)) ?? null;
}

/** A box in image pixels scaled to display pixels. */
export const scaleBox = (b, k) => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });

export const MARK_KINDS = ['circle', 'underline', 'highlight', 'box'];

/**
 * A marker mark measured onto a key phrase's box (MD-43): the box is the harvest's measured text box,
 * already in the mark layer's coordinates. circle: a hand loop around it; underline: under its
 * baseline; highlight: a translucent band across it; box: a hand-drawn rectangle around it.
 * Returns { pts, length, width? }.
 */
export function markShape(kind, box, { pad = 14, seed = 1 } = {}) {
  if (kind === 'underline') return underlineUnder(box, { gap: 4, over: 8, bow: 5 });
  if (kind === 'highlight') return highlightBand(box, { over: 6 });
  if (kind === 'box') {
    const l = box.x - pad, t = box.y - pad, r = box.x + box.w + pad, b = box.y + box.h + pad;
    const pts = [[l + 6, t + 2], [r - 2, t - 2], [r + 2, b - 3], [l - 2, b + 2], [l + 2, t + 10]];
    return { pts, length: polyLength(pts) };
  }
  // A page's line box is tight: the loop gets a little more air above and below than a headline's.
  return ellipseAround({ x: box.x, y: box.y - box.h * 0.18, w: box.w, h: box.h * 1.36 }, pad, seed);
}

/** A circle or box closes on its cue word: its stroke window, 0.45–0.7s, ending at `cue`. */
export function markWindow(kind, length, cue) {
  const d = kind === 'underline' ? clamp(length / 1400, 0.2, 0.45)
    : kind === 'highlight' ? clamp(length / 900, 0.35, 0.8)
      : clamp(0.45 + (length - 400) / 4000, 0.45, 0.7);
  return { start: Math.max(0, cue - d), end: cue };
}

/**
 * A big number counting up: "$12M" at u = 0.5 → "$6M". The prefix, suffix and decimals of the final
 * value are kept; a value with no number is returned as is.
 */
export function countUp(value, u) {
  const m = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(String(value));
  if (!m) return String(value);
  const [, pre, num, post] = m;
  const target = Number(num.replace(/,/g, ''));
  const decimals = (num.split('.')[1] ?? '').length;
  const v = target * kbEase(clamp(u));
  let s = v.toFixed(decimals);
  if (num.includes(',')) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${pre}${s}${post}`;
}

/** Film grain moves at 12 fps on a fixed path (deterministic in t): coarse, subtle, never static. */
export const grainOffset = (t) => {
  const n = Math.floor(Math.max(0, t) * 12);
  return [(n * 137) % 512, (n * 251) % 512];
};

/** A wipe reveal (left to right) as a clip-path inset at progress u. */
export const wipe = (u, bleed = 20) => `inset(-${bleed}px ${(100 - 100 * clamp(u)).toFixed(2)}% -${bleed}px -${bleed}px)`;

/** Linear progress through [a, b] (re-exported for frames that only import this module). */
export const prog = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
export { lerp, clamp };
