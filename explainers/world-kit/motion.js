// The Explainers world kit (from Explainer 2.0), motion (hx-4): timing helpers and the frame every shot draws
// into. 4.0 (approved stills 13 and 15): motion is smooth everywhere (no twos, no boil, no grid);
// world moves ease in and out and things move with weight (anticipation, volume-preserving squash
// and stretch, follow-through, arcs, one smear frame on a fast move), while titles, UI and the
// camera keep the brand ease-out with no bounce. Depth (parallax, depth of field) comes from a
// perspective camera moving through the world (lens.js), never from layers at speeds of their own.

import { POLARITY, clamp, cam, camAt, cameraTransform, onTwos } from './core.js';
import { defs, ground, g, scope } from './draw.js';
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

/**
 * Depth (hx-4.1, after Lucas's review of the first depth demo): depth is made by a perspective
 * camera moving through a 3D world (lens.js), where parallax and depth of field come from each
 * thing's real distance. The isometric camera is orthographic: it has no near or far, so a
 * layer moving at its own speed or blurred "for depth" over an iso scene is physically
 * meaningless, and frame() refuses it (depthProblems says why). The constants and helpers below
 * are kept so older code compiles; nothing in the kit uses fixed-speed layers any more.
 */
export const PARALLAX = { bg: 0.35, mid: 1, fg: 1.8 };
/** Kept for older callers; depth of field is per object in lens.js (dofBlur). */
export const DOF = { behind: 2.4, front: 12 };
const DEPTHS = { bg: 0, mid: 1, fg: 2 };

/** Kept for older callers (fixed-speed parallax is no longer drawn). */
export function layerCamera(c, k) {
  return { ...c, x: c.x * k, y: c.y * k, zoom: Math.pow(c.zoom, k) };
}

/** Kept for older callers (layer blur is no longer drawn; see lens.js dofBlur). */
export function blurOf(layer, focus = 'mid') {
  const d = DEPTHS[layer];
  const f = typeof focus === 'number' ? focus : DEPTHS[focus] ?? 1;
  return d < f ? (f - d) * DOF.behind : (d - f) * DOF.front;
}

const LAYERS = ['bg', 'mid', 'fg'];
const isLayered = (parts) => typeof parts === 'object' && parts !== null && !Array.isArray(parts);
const joinParts = (p) => (Array.isArray(p) ? p.join('') : p ?? '');

/**
 * The depth rules for a frame, as error strings (frame() throws the first; try.mjs can report
 * them): on the isometric camera (no `lens`) there are no depth layers and no focus; in a
 * perspective shot (`lens`, a lens.js camera) the parts may come as { bg, mid, fg } only as a
 * stack (bg: a flat backdrop seen through a window or opening, drawn through the lens; mid: the
 * room; fg: anything drawn over it), never at speeds of their own.
 */
export function depthProblems({ lens = null, focus } = {}, parts) {
  const out = [];
  const lensed = !!lens || (isLayered(parts) && /data-lensed="/.test(LAYERS.map((k) => joinParts(parts[k])).join('')));
  if (!lensed) {
    if (isLayered(parts)) out.push('an isometric frame has no near or far (the iso camera is orthographic): no { bg, mid, fg } parallax layers. Draw depth with a lens.js perspective camera moving through the world');
    if (focus !== undefined && focus !== null && focus !== 'mid') out.push('an isometric frame has no depth of field (the iso camera is orthographic): no focus. Use lens.js render({ focus }) in a perspective shot');
  }
  if (isLayered(parts)) {
    const unknown = Object.keys(parts).filter((k) => !LAYERS.includes(k));
    if (unknown.length) out.push(`frame: layered parts are { bg, mid, fg }; "${unknown.join('", "')}" is not a depth layer`);
  }
  return out;
}

/**
 * The world frame at shot time t: the camera, then the parts. Call scope() before drawing the
 * parts, then pass them here.
 *   camera: { x, y, zoom, rot } now, or { start, legs } to follow V-7 legs (validated upstream):
 *           the 2D framing of the picture (on a perspective shot it only crops, like a zoom)
 *   pivot:  [cx, cy], the point zoom and roll turn around
 *   lens:   the lens.js camera when the parts were drawn through one (a perspective shot); a
 *           picture made by lens.js render() is recognised without it
 * `parts` is an SVG string or a list of them; in a perspective shot it may be { bg, mid, fg },
 * stacked in that order under the same framing. Depth comes from the lens (lens.js render:
 * distance order and depth of field), never from layers. `seam` (seams.js) wraps the whole
 * world. No grid, no boil (4.0); `cell` and `oy` are accepted and ignored, for old frames.
 */
export function frame(t, opts = {}, parts, seam = null) {
  const { camera = {}, pivot = [540, 960] } = opts;
  const problems = depthProblems(opts, parts);
  if (problems.length) throw new Error(`frame: ${problems[0]}`);
  const c = camera.legs ? camAt(camera.start, camera.legs, t) : cam(camera);
  const inner = isLayered(parts) ? LAYERS.map((name) => (parts[name] ? g({ 'data-layer': name }, joinParts(parts[name])) : '')).join('') : parts;
  // a lens shot records its 2D framing (zoom, x, y, pivot), so the framing check can map the
  // boxes its critters and focal carry to the final screen (lens.js framedBoxes)
  const lensed = !!opts.lens || /data-lensed="/.test(isLayered(parts) ? LAYERS.map((k) => joinParts(parts[k])).join('') : joinParts(parts));
  const tag = lensed ? { 'data-lens': [c.zoom, c.x, c.y, pivot[0], pivot[1]].map((v) => Number(v.toFixed(4))).join(' ') } : {};
  const world = g({ ...tag, transform: cameraTransform(c, pivot[0], pivot[1]) }, inner);
  return defs() + seamed(seam, world);
}
