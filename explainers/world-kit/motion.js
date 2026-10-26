// The Explainers world kit (from Explainer 2.0), motion (hx-4): timing helpers and the frame every shot draws
// into. 4.0 (approved stills 13 and 15): motion is smooth everywhere (no twos, no boil, no grid);
// world moves ease in and out and things move with weight (anticipation, volume-preserving squash
// and stretch, follow-through, arcs, one smear frame on a fast move), while titles, UI and the
// camera keep the brand ease-out with no bounce. A frame may be drawn in depth layers (bg, mid,
// fg) that move at different speeds under the camera, with depth of field.

import { POLARITY, clamp, cam, camAt, cameraTransform, onTwos } from './core.js';
import { defs, ground, el, g, id, scope } from './draw.js';
import { seamed } from './seams.js';

/** Kept for old frames: core's onTwos returns t in 4.0 (smooth motion everywhere). */
export { onTwos as twos };
export const clamp01 = (x) => clamp(x, 0, 1);

/** A CSS cubic-bezier(x1, y1, x2, y2) as a curve on 0..1 (exact at both ends). */
export function cubicBezier(x1, y1, x2, y2) {
  const coef = (a1, a2) => [1 - 3 * a2 + 3 * a1, 3 * a2 - 6 * a1, 3 * a1];
  const [ax, bx, cx] = coef(x1, x2);
  const [ay, by, cy] = coef(y1, y2);
  const X = (u) => ((ax * u + bx) * u + cx) * u;
  const Y = (u) => ((ay * u + by) * u + cy) * u;
  const dX = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = X(u) - t;
      const d = dX(u);
      if (Math.abs(err) < 1e-7) return Y(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 60; i++) {
      if (X(u) < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return Y(u);
  };
}

/** Curves for in-shot animation; the named polarities (V-8) plus a cubic ease-out and an
 *  undamped-end spring for quick physical settles. 4.0: `world` (ease in-out) for things moving
 *  in the world, `ui` (the brand ease-out, cubic-bezier(0.16, 1, 0.3, 1), no bounce) for titles,
 *  UI and the camera. */
export const E = {
  ...POLARITY,
  linear: POLARITY.linear,
  inOut: POLARITY.glide,
  in: POLARITY['ramp-up'],
  out: (t) => 1 - Math.pow(1 - t, 3),
  spring: POLARITY.spring,
  world: POLARITY.glide,
  ui: cubicBezier(0.16, 1, 0.3, 1),
};

/** Progress 0..1 through [a, b], shaped by curve e. */
export const seg = (t, a, b, e = E.inOut) => e(clamp01((t - a) / (b - a)));
export const lerp = (a, b, u) => a + (b - a) * u;
export const L2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
/** 0 → 1 → 0 over [a, b]. */
export const arch = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));
export const on = (t, a, b) => t >= a && t < b;
export const blink = (t, at) => (at.some((b) => t >= b && t < b + 0.13) ? 1 : 0);

// ── The motion principles (approved still 15) ─────────────────────────────────────────────

/**
 * Squash and stretch that keeps the volume: u > 0 squashes (wide and low: anticipation, a
 * landing), u < 0 stretches (tall and thin: take-off, a fast fall), |u| ≤ 1. `amount` is how much
 * shorter a full squash is (0.25 = a quarter). Always sx · sy = 1. Scale about the feet
 * (squashTransform) so the thing stays on the floor.
 */
export function squash(u, { amount = 0.25 } = {}) {
  const k = clamp(u, -1, 1) * amount;
  const sy = Math.max(0.2, 1 - k);
  return { sx: 1 / sy, sy };
}

/** The SVG transform that scales by { sx, sy } about the point (x, y) (a critter's feet). */
export const squashTransform = (x, y, { sx, sy }) => `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-x).toFixed(2)} ${(-y).toFixed(2)})`;

/**
 * Follow-through: the swing of a loose part (a stethoscope, an ear, a tag) after the body stops at
 * `stopAt`: it carries on past the rest point by `amp`, swings back smaller each time and settles.
 * 0 before the stop. Use it as an angle (degrees) or an offset.
 */
export function follow(t, stopAt, { amp = 1, freq = 2.2, damp = 4.5 } = {}) {
  const dt = t - stopAt;
  if (dt <= 0) return 0;
  return amp * Math.exp(-damp * dt) * Math.sin(2 * Math.PI * freq * dt);
}

/** A point on a parabolic arc from p0 to p1 whose middle is lifted `apexLift` px above the
 *  straight line (screen y up is negative), at u 0..1. Nothing travels in a straight line. */
export function arcPath(p0, p1, apexLift, u) {
  return [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u) - 4 * apexLift * u * (1 - u)];
}

/** A move this many frames long or shorter (at 30 fps) gets one smear frame. */
export const SMEAR_FRAMES = 4;

/**
 * One smear frame on a fast move: a move from `from` to `to` (screen points) that takes `frames`
 * frames at 30 fps (≤ SMEAR_FRAMES) draws its middle frame stretched along the motion so the eye
 * reads speed, not a jump. u is linear progress through the move. Returns { stretch, angle, on }:
 * scale by `stretch` along `angle` (degrees) on that frame; stretch is 1 on every other frame.
 * `size` is the moving thing's length along the motion in px.
 */
export function smear(from, to, u, { frames = SMEAR_FRAMES, size = 120 } = {}) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dist = Math.hypot(dx, dy);
  const n = Math.max(1, Math.round(frames));
  const at = Math.round(clamp01(u) * n);
  const isOn = frames <= SMEAR_FRAMES + 1e-9 && n >= 2 && at === Math.floor(n / 2) && u > 0 && u < 1;
  if (!isOn) return { stretch: 1, angle, on: false };
  // An in-out move peaks at about twice its mean speed; a smear covers about one frame of it.
  const step = (2 * dist) / n;
  return { stretch: 1 + Math.min(2, step / Math.max(1, size)), angle, on: true };
}

// ── The frame ─────────────────────────────────────────────────────────────────────────────

/** The ground, drawn once under a shot. */
export function underlay(prefix, groundName = 'paper') {
  scope(prefix, groundName);
  return defs() + ground(groundName);
}

/** How fast each depth layer moves with the camera (approved still 13). */
export const PARALLAX = { bg: 0.35, mid: 1, fg: 1.8 };
/** Depth of field: px of blur per layer step behind the focus, and in front of it. */
export const DOF = { behind: 2.4, front: 12 };
const DEPTHS = { bg: 0, mid: 1, fg: 2 };

/** The camera a layer sees: its motion (pan, and zoom geometrically) scaled by k; roll is the
 *  whole picture's, so every layer rolls alike. */
export function layerCamera(c, k) {
  return { ...c, x: c.x * k, y: c.y * k, zoom: Math.pow(c.zoom, k) };
}

/** The blur (px) of a layer at depth d (bg 0, mid 1, fg 2) with focus f (a layer name or a depth;
 *  animate a number for a rack focus). */
export function blurOf(layer, focus = 'mid') {
  const d = DEPTHS[layer];
  const f = typeof focus === 'number' ? focus : DEPTHS[focus] ?? 1;
  return d < f ? (f - d) * DOF.behind : (d - f) * DOF.front;
}

const isLayered = (parts) => typeof parts === 'object' && parts !== null && !Array.isArray(parts);
const joinParts = (p) => (Array.isArray(p) ? p.join('') : p ?? '');

/**
 * The world frame at shot time t: the camera, then the parts. Call scope() before drawing the
 * parts, then pass them here.
 *   camera: { x, y, zoom, rot } now, or { start, legs } to follow V-7 legs (validated upstream)
 *   pivot:  [cx, cy], the point zoom and roll turn around
 *   focus:  the layer in focus ('bg' | 'mid' | 'fg', or a depth 0..2), for layered parts
 * `parts` is an SVG string or a list of them (one layer), or `{ bg, mid, fg }`: depth layers that
 * move at PARALLAX × the camera's motion, the ones out of focus blurred (depth of field). `seam`
 * (seams.js) wraps the whole world. No grid, no boil (4.0); `cell` and `oy` are accepted and
 * ignored, for old frames.
 */
export function frame(t, { camera = {}, pivot = [540, 960], focus = 'mid' } = {}, parts, seam = null) {
  const c = camera.legs ? camAt(camera.start, camera.legs, t) : cam(camera);
  if (!isLayered(parts)) {
    const world = g({ transform: cameraTransform(c, pivot[0], pivot[1]) }, parts);
    return defs() + seamed(seam, world);
  }
  const unknown = Object.keys(parts).filter((k) => !(k in PARALLAX));
  if (unknown.length) throw new Error(`frame: layered parts are { bg, mid, fg }; "${unknown.join('", "')}" is not a depth layer`);
  const filters = [];
  const layers = ['bg', 'mid', 'fg'].map((name) => {
    const inner = joinParts(parts[name]);
    if (!inner) return '';
    const lc = layerCamera(c, PARALLAX[name]);
    const moved = g({ transform: cameraTransform(lc, pivot[0], pivot[1]) }, inner);
    const sd = Math.round(blurOf(name, focus) * 10) / 10;
    if (sd < 0.1) return g({ 'data-layer': name }, moved);
    // The blur sits outside the camera transform, so it is in screen px at any zoom.
    const fid = id(`dof-${name}-${String(sd).replace('.', '_')}`);
    filters.push(el('filter', { id: fid, filterUnits: 'userSpaceOnUse', x: -300, y: -300, width: 1680, height: 2520, 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: sd })));
    return g({ 'data-layer': name, 'data-blur': sd, filter: `url(#${fid})` }, moved);
  });
  return defs() + (filters.length ? el('defs', {}, filters.join('')) : '') + seamed(seam, layers.join(''));
}
