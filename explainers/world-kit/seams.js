// The Explainers world kit (from Explainer 2.0), seams (hx-3): how a shot leaves and how the next one arrives
// (VISUAL V-11). Shots join only by camera seams, cut at peak velocity with matched direction,
// never by crossfades, dissolves, wipes, slides or fades: nothing here ever touches opacity.
//
//   continuity    cut on action to a new framing; the world and its state continue. No animation:
//                 the action itself carries the cut.
//   match         a shape or position matches across framings or scales. No animation: the two
//                 compositions do the work.
//   smash         a hard cut into a changed state, only into the pattern interruption (S-9). No
//                 animation: the change is the point.
//   whip          a blurred sideways sweep, only into the pattern interruption. whipOut sweeps the
//                 last WHIP seconds of the outgoing shot, accelerating, so its peak velocity sits on
//                 the cut; whipIn sweeps the first WHIP seconds of the incoming shot in the SAME
//                 direction, starting at that peak and settling. The blur is horizontal only.
//   zoom-through  the camera pushes through a point into the next framing. zoomThrough pushes the
//                 end of the outgoing shot past the 1.2× limit (V-7 allows it for zoom-through
//                 only), accelerating into the cut; zoomThroughIn lets the incoming shot finish the
//                 push, decelerating to rest.
//
// Seams are camera moves, so they stay smooth (V-15): no twos. Every function is a pure function
// of shot time, deterministic, and draws no color (V-T1). A seam returns { u, attrs, defs } (a
// whip also gives its sweep `dx` and `blur`): wrap the world with seamed(seam, svg). Wrap only the
// camera group and move the grid by `dx` instead when the grid and vignette are drawn in frame
// space, so the sweep never shows their edge. The blur filter id goes through id(), so shots can
// share one document (E2-03).

import { FRAME, POLARITY, clamp } from './core.js';
import { el, g, id, ref } from './draw.js';

/** The seam kinds (V-11). */
export const SEAM_KINDS = ['continuity', 'whip', 'match', 'zoom-through', 'smash'];

/** The whip: window (s), sweep (px of frame width at the cut), peak blur (horizontal stdDev). */
export const WHIP = { window: 0.18, sweep: 0.55 * FRAME.w, blur: 46 };
/** The zoom-through: outgoing window, how far it pushes, incoming window and its start zoom. */
export const ZOOM_THROUGH = { window: 0.35, to: 2.6, inWindow: 0.25, from: 0.8 };

/** Seconds of each seam on either side of the cut, for the worker's timing: `out` is the tail of
 *  the outgoing shot, `in` the head of the incoming one. The cut itself sits between them. */
export function seamWindow(kind) {
  if (!SEAM_KINDS.includes(kind)) throw new Error(`HX: unknown seam "${kind}". Use one of: ${SEAM_KINDS.join(', ')} (V-11).`);
  if (kind === 'whip') return { kind, out: WHIP.window, in: WHIP.window, animated: true };
  if (kind === 'zoom-through') return { kind, out: ZOOM_THROUGH.window, in: ZOOM_THROUGH.inWindow, animated: true };
  return { kind, out: 0, in: 0, animated: false };
}

const IDLE = Object.freeze({ u: 0, attrs: Object.freeze({}), defs: '' });
const n3 = (v) => (Math.abs(v) < 5e-4 ? '0' : v.toFixed(3));

function dirOf(dir) {
  if (dir !== 1 && dir !== -1) throw new Error('HX: a whip sweeps left (dir -1) or right (dir 1) (V-11).');
  return dir;
}

function blurDefs(sx) {
  return el('defs', {}, el('filter', { id: id('whip'), filterUnits: 'userSpaceOnUse', x: -FRAME.w, y: 0, width: 3 * FRAME.w, height: FRAME.h },
    el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: `${n3(sx)} 0` })));
}

function whipAt(x, sx, u) {
  const attrs = sx > 0.05 ? { transform: `translate(${n3(x)} 0)`, filter: ref('whip') } : { transform: `translate(${n3(x)} 0)` };
  return { u, dx: x, blur: sx, attrs, defs: sx > 0.05 ? blurDefs(sx) : '' };
}

/** The last WHIP.window seconds of a shot of length `dur`: the world sweeps toward `dir`
 *  (-1 left, 1 right), accelerating (ramp-up), with its fastest frame and widest blur on the cut. */
export function whipOut(t, dur, { dir = -1 } = {}) {
  const d = dirOf(dir);
  const u = clamp((t - (dur - WHIP.window)) / WHIP.window, 0, 1);
  if (u <= 0) return IDLE;
  return whipAt(d * WHIP.sweep * POLARITY['ramp-up'](u), WHIP.blur * u * u, u);
}

/** The first WHIP.window seconds of the next shot: the world arrives from the opposite side,
 *  still moving toward `dir` at the outgoing whip's peak speed, and settles (matched direction). */
export function whipIn(t, dur, { dir = -1 } = {}) {
  const d = dirOf(dir);
  const u = clamp(t / WHIP.window, 0, 1);
  if (u >= 1 || t > dur) return IDLE;
  const r = 1 - u;
  return whipAt(-d * WHIP.sweep * r * r * r, WHIP.blur * r * r, u);
}

function zoomAbout(px, py, z, x, y) {
  return `translate(${n3(px)} ${n3(py)}) scale(${z.toFixed(5)}) translate(${n3(-x)} ${n3(-y)})`;
}

/** The end of a shot pushes through the point `at` (frame px): the zoom grows geometrically to
 *  ZOOM_THROUGH.to, accelerating into the cut, and the point travels to the frame center so the
 *  camera goes through it. The next shot starts on the cut, never a fade. */
export function zoomThrough(t, dur, { at = [FRAME.w / 2, FRAME.h / 2], to = ZOOM_THROUGH.to, window = ZOOM_THROUGH.window } = {}) {
  const u = clamp((t - (dur - window)) / window, 0, 1);
  if (u <= 0) return IDLE;
  const e = POLARITY['ramp-up'](u);
  const z = Math.pow(to, e);
  const px = at[0] + (FRAME.w / 2 - at[0]) * e;
  const py = at[1] + (FRAME.h / 2 - at[1]) * e;
  return { u, attrs: { transform: zoomAbout(px, py, z, at[0], at[1]) }, defs: '' };
}

/** The head of the shot after a zoom-through: the push finishes, from ZOOM_THROUGH.from to 1 about
 *  `at`, fastest on the cut and easing out (matched direction: still pushing in). */
export function zoomThroughIn(t, { at = [FRAME.w / 2, FRAME.h / 2], from = ZOOM_THROUGH.from, window = ZOOM_THROUGH.inWindow } = {}) {
  const u = clamp(t / window, 0, 1);
  if (u >= 1) return IDLE;
  const e = 1 - Math.pow(1 - u, 3);
  const z = from * Math.pow(1 / from, e);
  return { u, attrs: { transform: zoomAbout(at[0], at[1], z, at[0], at[1]) }, defs: '' };
}

/** The frame wrapped in a seam: the seam's filter, then the frame inside its transform. An idle
 *  seam returns the frame untouched. */
export function seamed(seam, frameSvg) {
  if (!seam || !seam.attrs || !Object.keys(seam.attrs).length) return frameSvg;
  return seam.defs + g(seam.attrs, frameSvg);
}
