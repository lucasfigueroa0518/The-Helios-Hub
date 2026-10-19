// The Explainers world kit (from Explainer 2.0), motion (hx-3): timing helpers and the frame every shot draws
// into. Drawn things move on twos and the wobble boils at 10 fps (V-15); the camera, draw-on
// lines and captions stay smooth.

import { POLARITY, clamp, cam, camAt, cameraTransform, onTwos, boilSeed } from './core.js';
import { defs, ground, grid, g, scope } from './draw.js';
import { seamed } from './seams.js';

export { onTwos as twos };
export const clamp01 = (x) => clamp(x, 0, 1);

/** Curves for in-shot animation; the named polarities (V-8) plus a cubic ease-out and an
 *  undamped-end spring for quick physical settles. */
export const E = {
  ...POLARITY,
  linear: POLARITY.linear,
  inOut: POLARITY.glide,
  in: POLARITY['ramp-up'],
  out: (t) => 1 - Math.pow(1 - t, 3),
  spring: POLARITY.spring,
};

/** Progress 0..1 through [a, b], shaped by curve e. */
export const seg = (t, a, b, e = E.inOut) => e(clamp01((t - a) / (b - a)));
export const lerp = (a, b, u) => a + (b - a) * u;
export const L2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
/** 0 → 1 → 0 over [a, b]. */
export const arch = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));
export const on = (t, a, b) => t >= a && t < b;
export const blink = (t, at) => (at.some((b) => t >= b && t < b + 0.13) ? 1 : 0);

/** The ground and its grain, drawn once under a shot. */
export function underlay(prefix, groundName = 'paper') {
  scope(prefix, groundName);
  return defs() + ground(groundName);
}

/**
 * The world frame at shot time t: the boiling filters, the camera, the grid, then
 * the parts. Call scope() before drawing the parts, then pass them here.
 *   camera: { x, y, zoom, rot } now, or { start, legs } to follow V-7 legs (validated upstream)
 *   pivot:  [cx, cy], the point zoom and roll turn around
 */
export function frame(t, { camera = {}, pivot = [540, 960], cell = 72, oy = 0 }, parts, seam = null) {
  const c = camera.legs ? camAt(camera.start, camera.legs, t) : cam(camera);
  // The grid is drawn in frame space, so a pull-back below zoom 1 or a long crane never shows its
  // edge: a grid moved and scaled is the same grid with a new cell and offset. A seam (seams.js)
  // wraps only the camera group, and a whip's sweep carries the grid lines with it.
  const k = cell * c.zoom;
  const wrap = (v) => ((v % k) + k) % k;
  const gx = wrap(pivot[0] - c.zoom * (pivot[0] + c.x) + (seam?.dx ?? 0));
  const gy = wrap(pivot[1] + c.zoom * (oy - pivot[1] - c.y));
  const world = g({ transform: cameraTransform(c, pivot[0], pivot[1]) }, parts);
  return defs({ wobble: 3, wobbleSeed: boilSeed(t) }) + grid({ cell: k, ox: gx, oy: gy, rot: c.rot, pivot }) + seamed(seam, world);
}
