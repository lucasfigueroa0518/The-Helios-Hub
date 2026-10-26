// Shared pieces for the experimental openers (2026-10-19). Every opener is drawn over the same
// reel (the agent-loop reel of 2026-10-14: the frosty room, its world.js and its opener voice),
// so the only thing that changes between them is the opener itself.
//
// The project places this file at assets/frames/shared.js, next to the opener's module.

import { T, g, el, id, ref, defs, scope, handwrite, handwriteWidth, shock } from '../kit/draw.js';
import { frame, twos, E, seg, lerp, clamp01 } from '../kit/motion.js';
import { shotCamera } from '../kit/shots.js';
import { titleCard } from '../kit/cards.js';
import { PROJ, projection, SUBJECTS, STATES, frostWindow, thermometer, target_mark, heater, thermostat } from '../world/world.js';

export { T, g, el, id, ref, defs, scope, handwrite, handwriteWidth, shock, frame, twos, E, seg, lerp, clamp01, titleCard };

/** The opener line's length (assets/voice/01.wav, tightened, 20% faster) and its word times. */
export const VOICE = 3.802;
export const WORDS = { this: 1.36, frosty: 1.63, room: 2.09, ai: 2.97, concept: 3.46 };
export const TERM = 'agent loop';
export const W = 1080;
export const H = 1920;

/** The start of the reel's scene: frost, a low needle, the heater on, the critter shivering. */
export const START = { needle: STATES.needle.beat1, heater: 'on', frost: 1, thermostat: 'shivering' };
/** The end of the reel's story: warm, the needle on the mark, the heater off, relieved. */
export const END = { needle: 1, heater: 'off', frost: 0, thermostat: 'relieved' };

/** A state part way from `a` to `b` (u 0..1): numbers blend, the rest switch at the middle. */
export function blendState(a, b, u) {
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? lerp(a[k], b[k], u) : u < 0.5 ? a[k] : b[k];
  }
  return out;
}

/** The room's parts at time t (in the world's own coordinates). */
export function roomParts(t, { state = START, shiver = 1, focal = true, pose = {}, hide = [], wrap = {} } = {}) {
  const P = projection();
  const s = PROJ.s;
  const tc = twos(t);
  const cold = state.thermostat === 'shivering';
  const parts = {
    window: () => frostWindow(P, s, state),
    thermometer: () => thermometer(P, s, state, { focal, shake: cold ? 2 + 4 * shiver : 0, t: tc }),
    target_mark: () => target_mark(P, s, state, {}),
    heater: () => heater(P, s, state, { t: tc }),
    thermostat: () => thermostat(P, s, state, { t: tc, shiver: cold ? shiver : 0, ...pose }),
  };
  // `hide` leaves parts out; `wrap` gives a part a transform of its own (a pop-up, say)
  return Object.entries(parts).filter(([k]) => !hide.includes(k)).map(([k, f]) => (wrap[k] ? g({ transform: wrap[k] }, f()) : f())).join('');
}

/** Camera options for room() that put world point `p` at screen (sx, sy) at `zoom` (absolute). */
export function focus(local, p, zoom, [sx, sy] = [540, 960]) {
  const c = roomCamera(local);
  return { zoom: zoom / c.zoom, dx: p[0] - 540 - c.x - (sx - 540) / zoom, dy: p[1] - 960 - c.y - (sy - 960) / zoom };
}

/** Blend two camera option sets (u 0..1); the zoom blends on a log scale, the aim with it. */
export function blendCamera(local, a, b, u) {
  const ca = roomCamera(local, a);
  const cb = roomCamera(local, b);
  const z = Math.exp(lerp(Math.log(ca.zoom), Math.log(cb.zoom), u));
  // the aim moves in step with the zoom, so the shot doesn't swing past the subject
  const k = (Math.log(ca.zoom) - Math.log(z)) / (Math.log(ca.zoom) - Math.log(cb.zoom) || 1);
  const base = roomCamera(local);
  return { zoom: z / base.zoom, dx: lerp(ca.x, cb.x, k) - base.x, dy: lerp(ca.y, cb.y, k) - base.y };
}

/** The reel's opener camera: a medium shot on the heater with a slow push (as the reel had). */
export function roomCamera(local, { length = 4, zoom = 1, dx = 0, dy = 0 } = {}) {
  const c = shotCamera({ at: 0, kind: 'medium', on: SUBJECTS.heater, push: 1.1 }, local, length);
  return { ...c, zoom: c.zoom * zoom, x: c.x + dx, y: c.y + dy };
}

/** The whole room frame (grid, camera, world) at time t. */
export function room(t, o = {}) {
  const { local = t, camera = {}, ...parts } = o;
  return frame(t, { camera: roomCamera(local, camera) }, roomParts(t, parts));
}

/** The standard top-band title card, started at `from` (reel seconds) and finished with the line. */
export function title(t, from, voiceAt) {
  if (t < from) return '';
  return titleCard(t - from, { term: TERM, to: Math.max(0.6, voiceAt + VOICE - 0.1 - from) });
}

/** "AI BRAIN BREAK" (and the term) hand-lettered big, centred on (cx, cy). */
export function wordmark(cx, cy, size, progress = 1, { color = T.ink, term = true, termColor = T.orange, weight = 1.4, plate = false, tilt = 0 } = {}) {
  const lineH = size * 1.45;
  const out = [];
  if (plate) {
    // a paper plate behind the letters, so they read over the drawing
    const w = Math.max(handwriteWidth('AI BRAIN', size), term ? handwriteWidth(TERM, size * 0.62) : 0) + size * 1.1;
    const top = cy - lineH / 2 - size * 1.35;
    const h = (term ? lineH * 1.35 + size * 0.62 * 0.4 : lineH / 2 + size * 0.3) + lineH / 2 + size * 1.35 + size * 0.45;
    out.push(el('rect', { x: (cx - w / 2 + 10).toFixed(1), y: (top + 14).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 22, fill: T.ink, opacity: 0.16 }));
    out.push(g({ filter: ref('wobble') }, el('rect', { x: (cx - w / 2).toFixed(1), y: top.toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 22, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5 })));
  }
  out.push(
    handwrite('AI BRAIN', cx, cy - lineH / 2, size, clamp01(progress * 2), { color, align: 'center', weight }),
    handwrite('BREAK', cx, cy + lineH / 2, size, clamp01(progress * 2 - 1), { color, align: 'center', weight }),
  );
  if (term) out.push(handwrite(TERM, cx, cy + lineH * 1.35, size * 0.62, clamp01(progress * 1.5 - 0.5), { color: termColor, align: 'center', weight }));
  const body = out.join('');
  return tilt ? g({ transform: `rotate(${tilt} ${cx} ${cy})` }, body) : body;
}

/** A full-frame fill (black for dead air, paper for a sheet). */
export const fill = (color, opacity = 1) => el('rect', { x: -50, y: -50, width: W + 100, height: H + 100, fill: color, opacity: opacity.toFixed(3) });

/** A camera shake offset at t for a hit at `at` (decays over `dur`). */
export function shake(t, at, amp = 26, dur = 0.35) {
  if (t < at || t > at + dur) return [0, 0];
  const u = (t - at) / dur;
  const k = Math.floor(t * 30);
  const a = amp * (1 - u) * (1 - u);
  return [a * Math.sin(k * 2.9), a * Math.cos(k * 3.7)];
}

/** Shock rays all round a point (a burst). */
export function burst(x, y, u, scale = 2) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    rays.push([Math.cos(a), Math.sin(a)]);
  }
  return shock(x, y, u, scale, rays);
}

/** Where a world point lands on screen under the room camera at `local` seconds. */
export function toScreen(p, local, camera = {}) {
  const c = roomCamera(local, camera);
  return [540 + c.zoom * (p[0] - 540 - c.x), 960 + c.zoom * (p[1] - 960 - c.y)];
}

export { SUBJECTS };
