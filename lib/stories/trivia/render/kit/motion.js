// The Explainers world kit, motion (hx-5, visual system 5): timing helpers, the critters' hold-and-snap
// motion, and the frame every shot draws into. VISUAL_SYSTEM_5 §10.
//
// Characters hold and snap: long still holds (HOLD, 1–2.5 s), then a quick move (SNAP, about
// 0.14–0.2 s) that lands with a small overshoot (OVERSHOOT) and settles. Stillness is what makes the
// snap read; nothing bobs at a constant rate. Moves play at AMP (82%) of the reference loops, each
// character on its own clock (clockOffset), so a cast never moves in unison. A beat changes the
// eyes (lids and pupils), the arms and a squash; the drawing itself never changes. The shadow stays
// on the floor: it never tilts with the body, it shrinks and fades as the body lifts and spreads on a
// squash (shadowAt; cast.js critterShadow draws it). Titles, UI and the camera keep the brand
// ease-out (E.ui). Every frame is a pure function of its time t: no CSS animation, no randomness.
//
//   MOTIONS, motionAt(name, t, o)   a character's body pose { r, x, y, sx, sy, on } at time t
//   shadowAt(pose)                  its floor-bound shadow { dx, sx, opacity }
//   blinkAt(t, o), glanceAt(t, o)   the eyes: a blink 0..1 and a glance [x, y] at time t
//   actorAt(t, o)                   all of it for one critter: { pose, mood, blink, look, shadow }
//   clockOffset(id)                 a character's own clock offset in seconds
//   seg, lerp, arch, E, squash, follow, arcPath   general timing helpers
//   frame(t, o, parts)              the world frame

import { POLARITY, clamp, cam, camAt, cameraTransform, onTwos } from './core.js';
import { defs, ground, g, scope } from './draw.js';
import { seamed } from './seams.js';

/** Kept for old frames: core's onTwos returns t (motion is continuous). */
export { onTwos as twos };
export const clamp01 = (x) => clamp(x, 0, 1);

/** A CSS cubic-bezier(x1, y1, x2, y2) as a curve on 0..1 (exact at both ends; y may overshoot). */
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

// ── Hold and snap (VISUAL_SYSTEM_5 §10) ───────────────────────────────────────────────────
/** A still hold between moves, in seconds [min, max]. */
export const HOLD = [1, 2.5];
/** A snap's length in seconds [min, max] (a short move, SLOW already applied). */
export const SNAP = [0.14, 0.2];
/** Short moves (under 0.35 s in the reference loops) play this much longer. */
export const SLOW = 1.2;
/** Every move plays at this share of the reference loops' amplitude. */
export const AMP = 0.82;
/** The landing curve: a small overshoot, then the settle. */
export const OVERSHOOT = 'cubic-bezier(.34,1.32,.55,1)';
/** The default snap curve (fast out, no overshoot). */
export const SNAP_EASE = 'cubic-bezier(.22,.8,.3,1)';
/** A slow, even move (a droop). */
export const EASE = 'cubic-bezier(.45,0,.55,1)';

/** Curves for in-shot animation: the named polarities, the brand ease-out `ui` (titles, UI, the
 *  camera), `world` (ease in-out, things moving through the world) and the character curves
 *  `snap`, `overshoot` and `ease` (hold and snap). */
export const E = {
  ...POLARITY,
  linear: POLARITY.linear,
  inOut: POLARITY.glide,
  in: POLARITY['ramp-up'],
  out: (t) => 1 - Math.pow(1 - t, 3),
  spring: POLARITY.spring,
  world: POLARITY.glide,
  ui: cubicBezier(0.16, 1, 0.3, 1),
  snap: cubicBezier(0.22, 0.8, 0.3, 1),
  overshoot: cubicBezier(0.34, 1.32, 0.55, 1),
  ease: cubicBezier(0.45, 0, 0.55, 1),
};
const CURVE = { [SNAP_EASE]: E.snap, [OVERSHOOT]: E.overshoot, [EASE]: E.ease };

const REST = Object.freeze({ r: 0, x: 0, y: 0, sx: 1, sy: 1 });
const P = (o = {}) => ({ ...REST, ...o });
const S = (s) => P({ sx: s, sy: s });

/**
 * A motion as timed steps: ['hold', s] | ['to', s, pose, curve?] | ['on'] | ['off']. A 'to' shorter
 * than 0.35 s is a snap and plays SLOW times longer; every pose is scaled to AMP. Returns
 * { kf: [{ t, pose, ease }], total, marks: { on?, off? } } (the ease of a keyframe is the curve of
 * the move that starts there).
 */
export function seq(...steps) {
  let t = 0;
  let pose = { ...REST };
  const kf = [{ t: 0, pose: { ...REST }, ease: SNAP_EASE }];
  const marks = {};
  for (const st of steps) {
    if (st[0] === 'hold') {
      t += st[1];
      kf.push({ t, pose: { ...pose }, ease: SNAP_EASE });
    } else if (st[0] === 'to') {
      const d = st[1] * (st[1] < 0.35 ? SLOW : 1);
      kf[kf.length - 1].ease = st[3] ?? SNAP_EASE;
      pose = Object.fromEntries(Object.entries(st[2]).map(([k, v]) => [k, 'rxy'.includes(k) ? v * AMP : 1 + (v - 1) * AMP]));
      t += d;
      kf.push({ t, pose: { ...pose }, ease: SNAP_EASE });
    } else marks[st[0]] = t;
  }
  return { kf, total: t, marks };
}

const idle = (h1, h2, h3) => seq(['hold', h1], ['to', 0.16, P({ r: -15 }), OVERSHOOT], ['to', 0.1, P({ r: -12 })], ['hold', h2], ['to', 0.16, P(), OVERSHOOT], ['hold', 0.9], ['on'],
  ['to', 0.12, S(0.8)], ['to', 0.08, S(0.84)], ['hold', 0.5], ['to', 0.16, P({ sx: 1.07, sy: 0.95 }), OVERSHOOT], ['to', 0.1, P()], ['off'], ['hold', h3]);
const rep = (n, ...steps) => Array.from({ length: n }, () => steps).flat();

/**
 * The body motions (the approved reference loops): idle and its three variants (so a cast idles out
 * of step), the five states (think, work, wait, done, plus idle) and one move per mood. Between a
 * motion's `on` and `off` marks the character shows its beat's mood (actorAt).
 */
export const MOTIONS = {
  idle: idle(1.5, 1.1, 1.6),
  idle1: idle(2.1, 0.8, 1.2),
  idle2: idle(1.0, 1.5, 2.0),
  idle3: idle(1.8, 1.2, 0.9),
  think: seq(['hold', 0.6], ['on'], ['to', 0.22, P({ r: 8 }), OVERSHOOT], ['hold', 2.6], ['to', 0.14, P({ r: 8, y: -6 })], ['to', 0.16, P({ r: 8 })], ['hold', 1.0], ['off'], ['to', 0.22, P(), OVERSHOOT], ['hold', 0.6]),
  work: seq(['on'], ...rep(4, ['to', 0.1, P({ y: -10, sx: 0.98, sy: 1.03 })], ['to', 0.1, P({ sx: 1.04, sy: 0.96 })]), ['to', 0.1, P()], ['hold', 1.6]),
  wait: seq(['hold', 1.2], ['on'], ['to', 0.12, P({ sx: 1.08, sy: 0.9 })], ['to', 0.16, P({ y: -34, sx: 0.94, sy: 1.08 })], ['to', 0.16, P({ sx: 1.1, sy: 0.88 })], ['to', 0.14, P({ y: -22, sx: 0.96, sy: 1.05 })], ['to', 0.14, P({ sx: 1.05, sy: 0.94 })], ['to', 0.12, P(), OVERSHOOT], ['hold', 2.0]),
  done: seq(['hold', 0.7], ['on'], ['to', 0.14, P({ sx: 1.14, sy: 0.84 })], ['to', 0.2, P({ y: -58, sx: 0.9, sy: 1.12 })], ['to', 0.2, P({ sx: 1.16, sy: 0.82 })], ['to', 0.12, P({ sx: 0.96, sy: 1.05 }), OVERSHOOT], ['to', 0.1, P()], ['hold', 1.8]),
  pop: seq(['hold', 1.2], ['on'], ['to', 0.06, S(0.72)], ['to', 0.14, S(1.14), OVERSHOOT], ['to', 0.1, P()], ['hold', 1.6], ['off'], ['hold', 0.4]),
  hop: seq(['hold', 1.2], ['on'], ['to', 0.12, P({ sx: 1.1, sy: 0.9 })], ['to', 0.18, P({ y: -40, sx: 0.94, sy: 1.07 })], ['to', 0.18, P({ sx: 1.1, sy: 0.9 })], ['to', 0.12, P(), OVERSHOOT], ['hold', 1.6], ['off'], ['hold', 0.4]),
  slytilt: seq(['hold', 1.2], ['on'], ['to', 0.18, P({ r: 14, x: 6 }), OVERSHOOT], ['to', 0.1, P({ r: 11, x: 4 })], ['hold', 1.7], ['off'], ['to', 0.18, P(), OVERSHOOT], ['hold', 0.8]),
  shrink: seq(['hold', 1.2], ['on'], ['to', 0.1, P({ sx: 0.8, sy: 0.86 })], ['to', 0.08, P({ sx: 0.82, sy: 0.86 })], ['to', 0.08, P({ sx: 0.82, sy: 0.86, r: -3 })], ['hold', 0.4], ['to', 0.08, P({ sx: 0.82, sy: 0.86, r: 3 })], ['hold', 0.4], ['to', 0.08, P({ sx: 0.82, sy: 0.86 })], ['hold', 0.6], ['off'], ['to', 0.14, P({ sx: 1.05, sy: 0.97 }), OVERSHOOT], ['to', 0.1, P()], ['hold', 0.8]),
  shake: seq(['hold', 1.2], ['on'], ['to', 0.08, P({ r: -7 })], ['to', 0.08, P({ r: 7 })], ['to', 0.08, P({ r: -7 })], ['to', 0.08, P({ r: 7 })], ['to', 0.08, P()], ['hold', 1.8], ['off'], ['hold', 0.4]),
  puff: seq(['hold', 1.2], ['on'], ['to', 0.12, P({ sx: 1.1, sy: 1.08, y: -6 }), OVERSHOOT], ['to', 0.1, P({ sx: 1.06, sy: 1.05, y: -4 })], ['hold', 1.7], ['off'], ['to', 0.16, P(), OVERSHOOT], ['hold', 0.8]),
  droop: seq(['hold', 0.8], ['on'], ['to', 1.0, P({ r: 7, y: 6 }), EASE], ['hold', 0.7], ['to', 0.1, P({ r: -2, y: -6 })], ['to', 0.14, P(), OVERSHOOT], ['hold', 0.9], ['off'], ['hold', 0.4]),
  curious: seq(['hold', 1.2], ['on'], ['to', 0.14, P({ r: -19 }), OVERSHOOT], ['to', 0.08, P({ r: -15 })], ['hold', 0.7], ['to', 0.14, P({ r: 9 }), OVERSHOOT], ['to', 0.08, P({ r: 6 })], ['hold', 0.8], ['off'], ['to', 0.16, P(), OVERSHOOT], ['hold', 0.8]),
  lean: seq(['hold', 1.2], ['on'], ['to', 0.12, P({ sx: 1.06, sy: 0.92, y: 2 }), OVERSHOOT], ['to', 0.1, P({ sx: 1.04, sy: 0.95 })], ['hold', 1.8], ['off'], ['to', 0.16, P(), OVERSHOOT], ['hold', 0.8]),
};
/** The move each mood's beat plays (rest → the mood, on the beat, hold, back to rest). */
export const MOOD_MOTION = { happy: 'hop', curious: 'curious', focused: 'lean', surprised: 'pop', sly: 'slytilt', worried: 'shrink', angry: 'shake', proud: 'puff', sleepy: 'droop', neutral: 'idle' };

/**
 * A character's body pose at time t in a motion (MOTIONS name, looping by default): { r (degrees),
 * x, y (tile units, about the feet), sx, sy, on (inside the motion's on…off marks) }. `delay` shifts
 * this character's clock (clockOffset).
 */
export function motionAt(name, t, { delay = 0, loop = true } = {}) {
  const M = MOTIONS[name];
  if (!M) throw new Error(`HX: motion "${name}" must be one of ${Object.keys(MOTIONS).join(', ')}`);
  const { kf, total, marks } = M;
  let u = t + delay;
  u = loop ? ((u % total) + total) % total : clamp(u, 0, total);
  let i = 0;
  while (i < kf.length - 1 && kf[i + 1].t <= u) i++;
  const a = kf[i];
  const b = kf[Math.min(i + 1, kf.length - 1)];
  const span = b.t - a.t;
  const k = span > 0 ? (CURVE[a.ease] ?? E.snap)((u - a.t) / span) : 1;
  const pose = Object.fromEntries(Object.keys(REST).map((key) => [key, a.pose[key] + (b.pose[key] - a.pose[key]) * k]));
  const on = 'on' in marks ? u >= marks.on && u < (marks.off ?? total + 1) : false;
  return { ...pose, on };
}

/** The shadow under a body in `pose`: it stays on the floor and never tilts. It drifts with
 *  sideways moves (dx, tile units), shrinks as the body lifts and spreads on a squash (sx), and
 *  fades with the lift (opacity, a share of the 10% shadow). */
export function shadowAt(pose = REST) {
  const lift = Math.max(0, -(pose.y ?? 0));
  return { dx: (pose.x ?? 0) * 0.7, sx: (1 + ((pose.sx ?? 1) - 1) * 0.9) * (1 - lift / 150), opacity: Math.max(0.35, 1 - lift / 110) };
}

/** A blink at time t: 0 open … 1 shut. Quick, and every other one doubled (5.3 s loop). */
export function blinkAt(t, { delay = 0, period = 5.3 } = {}) {
  const u = ((((t + delay) % period) + period) % period) / period;
  const one = (c) => {
    const d = Math.abs(u - c);
    return d < 0.013 ? 1 - d / 0.013 : 0;
  };
  return Math.max(one(0.623), one(0.673));
}

/** Where the eyes glance at time t, [x, y] in −1..1 (cast.js `look`): they jump and hold. */
export function glanceAt(t, { delay = 0, period = 6.4 } = {}) {
  const u = ((((t + delay) % period) + period) % period) / period;
  const keys = [[0, 0, 0], [0.14, 0, 0], [0.163, 1, -0.4], [0.38, 1, -0.4], [0.403, -1, 0.2], [0.58, -1, 0.2], [0.603, 0.17, 0.8], [0.8, 0.17, 0.8], [0.823, 0, 0], [1, 0, 0]];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= u) i++;
  const [ta, xa, ya] = keys[i];
  const [tb, xb, yb] = keys[i + 1];
  const k = E.snap((u - ta) / (tb - ta || 1));
  return [xa + (xb - xa) * k, ya + (yb - ya) * k];
}

/** A character's own clock offset in seconds, from its id (a stable hash), within [0, span). */
export function clockOffset(id, span = 6) {
  let h = 2166136261;
  for (const ch of String(id ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000 * span;
}

/**
 * One critter's motion at time t: `motion` (a MOTIONS name; default an idle variant picked by id),
 * `rest` and `mood` (the mood shown between the motion's on and off marks; rest elsewhere),
 * `id` (its own clock). Returns { pose, mood, blink, look, shadow }: pass pose, mood, blink and look
 * to cast.js critter() and pose to critterShadow().
 */
export function actorAt(t, { motion = null, rest = 'neutral', mood = null, id = '', eyes = true } = {}) {
  const delay = clockOffset(id);
  const name = motion ?? ['idle', 'idle1', 'idle2', 'idle3'][Math.floor(clockOffset(id, 4))];
  const pose = motionAt(name, t, { delay });
  const shown = pose.on && mood ? mood : rest;
  return { pose, mood: shown, blink: eyes ? blinkAt(t, { delay }) : 0, look: eyes ? glanceAt(t, { delay: delay * 1.7 }) : [0, 0], shadow: shadowAt(pose) };
}

// ── General timing helpers ────────────────────────────────────────────────────────────────
/** Progress 0..1 through [a, b], shaped by curve e. */
export const seg = (t, a, b, e = E.inOut) => e(clamp01((t - a) / (b - a)));
export const lerp = (a, b, u) => a + (b - a) * u;
export const L2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
/** 0 → 1 → 0 over [a, b]. */
export const arch = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));
export const on = (t, a, b) => t >= a && t < b;
export const blink = (t, at) => (at.some((b) => t >= b && t < b + 0.13) ? 1 : 0);

/**
 * Squash and stretch that keeps the volume: u > 0 squashes (wide and low: anticipation, a
 * landing), u < 0 stretches (tall and thin: take-off), |u| ≤ 1. `amount` is how much shorter a full
 * squash is. Always sx · sy = 1. Scale about the feet (squashTransform) so the thing stays down.
 */
export function squash(u, { amount = 0.25 } = {}) {
  const k = clamp(u, -1, 1) * amount;
  const sy = Math.max(0.2, 1 - k);
  return { sx: 1 / sy, sy };
}

/** The SVG transform that scales by { sx, sy } about the point (x, y) (a critter's feet). */
export const squashTransform = (x, y, { sx, sy }) => `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-x).toFixed(2)} ${(-y).toFixed(2)})`;

/**
 * Follow-through: the swing of a loose part after the body stops at `stopAt`: it carries on past
 * the rest point by `amp`, swings back smaller each time and settles. 0 before the stop.
 */
export function follow(t, stopAt, { amp = 1, freq = 2.2, damp = 4.5 } = {}) {
  const dt = t - stopAt;
  if (dt <= 0) return 0;
  return amp * Math.exp(-damp * dt) * Math.sin(2 * Math.PI * freq * dt);
}

/** A point on a parabolic arc from p0 to p1 whose middle is lifted `apexLift` px above the
 *  straight line (screen y up is negative), at u 0..1. */
export function arcPath(p0, p1, apexLift, u) {
  return [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u) - 4 * apexLift * u * (1 - u)];
}

// ── The frame ─────────────────────────────────────────────────────────────────────────────

/** The ground, drawn once under a shot. */
export function underlay(prefix, groundName = 'paper') {
  scope(prefix, groundName);
  return defs() + ground(groundName);
}

const LAYERS = ['bg', 'mid', 'fg'];
const isLayered = (parts) => typeof parts === 'object' && parts !== null && !Array.isArray(parts);
const joinParts = (p) => (Array.isArray(p) ? p.join('') : p ?? '');

/**
 * The layering rules for a frame, as error strings (frame() throws the first): on the isometric
 * camera (no `lens`) there are no { bg, mid, fg } layers; in a perspective shot (`lens`, a lens.js
 * camera) the parts may come as { bg, mid, fg } only as a stack, never at speeds of their own.
 * There is no depth of field: no `focus`.
 */
export function depthProblems({ lens = null, focus } = {}, parts) {
  const out = [];
  const lensed = !!lens || (isLayered(parts) && /data-lensed="/.test(LAYERS.map((k) => joinParts(parts[k])).join('')));
  if (!lensed && isLayered(parts)) out.push('an isometric frame has no near or far (the iso camera is orthographic): no { bg, mid, fg } parallax layers. Draw depth with a lens.js perspective camera moving through the world');
  if (focus !== undefined && focus !== null && focus !== 'mid') out.push('a frame has no depth of field: everything is in focus, so no focus');
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
 * stacked in that order under the same framing. `seam` (seams.js) wraps the whole world.
 * `cell` and `oy` are accepted and ignored, for old frames.
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
