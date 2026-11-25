// The Explainers world kit, objects and motion (4.2, PLAN turns 11–15): the real things a mechanism
// frame draws, and how they act. The hand-drawn era's vocabulary (a laptop, a server, a chip, a
// parcel drawn as simple objects; 2–4 on screen; one real element travelling between them; one
// short label on the thing; one orange accent) in today's Soft 3D look: isometric soft volumes lit
// from the top right (draw.js isoBox / isoDisc), a soft contact shadow, no ink outline.
//
//   OBJECTS                                   id → { states, hinge, mass, accent, label }: the library
//   object(id, at, { size, accent, label, state, tone, facing, floor, key, concept })
//                                             a drawn thing standing with its base centre at `at`
//                                             (screen px), with puppet pins base, center, top,
//                                             front (+ hinge on lids, flaps, covers, shackles)
//   worldObject(id, [x, y, z], { size, … })   the same thing in a perspective world (cm), and
//   lensObject(P, obj, { t, segments, rig })  it through the lens as a render() item: placed and
//                                             scaled by depth, lit by the shot's rig, its shadows on
//                                             the floor; the verbs move it through world positions
//   courier(kind, from, to, { label, state, arc, at, dur, keep, arrive, bump, accent, tone, size })
//                                             the travelling element (request, packet, file, message,
//                                             or any OBJECTS id) riding an arc between objects or pins
//   verbs  hopTo · slideTo · lookAt · react · nod · shake · openHinge · closeHinge · settle · breathe
//          (+ setState, setAccent): timeline segments with CRAFT § 5 built in
//   play(t, segments, objects?)               every object posed at t, then the couriers: one SVG
//   poseAt / pinsAt(obj, t, segments)         an object's pose and pins at t (to hang other parts on)
//   soundEvents(segments)                     the segments' sound events for <frame>.events.json
//   objectProblems(samples)                   breakage: pins out of frame, an object below its floor,
//                                             a face on an object
//
// Time: a frame is a pure function of its time t (E2-06: one clock, the GSAP tween mount.mjs drives).
// A segment is a slot on that clock, { verb, at, dur, end, events }: play(t, …) evaluates every
// segment at t, so a still at any t is exact and seek-safe. seg.gsap(tl, render) places the same
// segment on a GSAP timeline when a composition drives its own.
//
// Objects never get a face (house style, Lucas: "Don't give the director of faces a tool that it can
// use for objects"). They act through motion alone: object() and every verb THROW on a face option,
// and react() takes motion reactions only.
//
// Every colour is a palette token or a mix of two (V-T1). Text on an object is ≥ READ_MIN (34px),
// measured, and wrapped as a data-k="textbox" so bounds.mjs checks it.

import { FRAME, iso, mixHex, resolveTone, propScale } from './core.js';
import { T, el, g, id, isDark, isoBox, isoDisc, softShape, shadow, tonesOf, TONES } from './draw.js';
import { label as textEl, measure, boxShadow, glowAt, roundRect, onColor } from './glass.js';
import { obox, cylinder as lensCylinder, rig as lensRig, contactShadow, shadowsOf, lightAt } from './lens.js';
import { lit, irradiance } from './light.js';

/** The smallest text read in a mechanism frame (= explain.js READ_MIN; explain.js imports this
 *  module for the identity map, so the value is restated here rather than imported). */
export const READ_MIN = 34;

// ── Small helpers ─────────────────────────────────────────────────────────────────────────
const r1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
const r3 = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, u) => a + (b - a) * u;
const ease = {
  /** slow, fast, slow (world moves) */
  inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out: (u) => 1 - Math.pow(1 - u, 3),
  in: (u) => u * u * u,
  sine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
};
/** Progress through [a, b] of u, shaped by e. */
const span = (u, a, b, e = ease.inOut) => e(clamp01((u - a) / (b - a)));
/** A damped oscillation that starts at `amp` and settles to 0 (follow-through, settles). */
const wave = (tau, amp, freq = 2, damp = 6) => (tau <= 0 ? amp : amp * Math.exp(-damp * tau) * Math.cos(2 * Math.PI * freq * tau));
const hsh = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WHITE = T.canvas;
const isHex = (c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);

/** A linear gradient def (content-hashed id) and its paint. */
function lin(stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  const body = stops.map(([o, c, a = 1]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a === 1 ? undefined : r3(a) })).join('');
  const gid = id(`ob-l${hsh(`${x1},${y1},${x2},${y2}|${body}`)}`);
  return { def: el('defs', {}, el('linearGradient', { id: gid, x1, y1, x2, y2 }, body)), paint: `url(#${gid})` };
}

// ── The library ───────────────────────────────────────────────────────────────────────────
// mass: 'heavy' things hop lower and slower and land with an impact; 'light' things are quick.
// accent: the one part orange paints when the object is what to look at now. label: where the
// label sits on it ('plate': a printed plate on its face; 'screen': words on its lit display).
const LIB = {
  laptop: { states: ['on', 'off', 'closed'], hinge: { closed: 'closed', open: 'on', sound: ['click', null] }, mass: 'light', accent: 'the display', label: 'screen' },
  phone: { states: ['on', 'off'], mass: 'light', accent: 'the display', label: 'screen' },
  tablet: { states: ['on', 'off'], mass: 'light', accent: 'the display', label: 'screen' },
  screen: { states: ['on', 'off'], mass: 'light', accent: 'the display', label: 'screen' },
  server: { states: ['on', 'off', 'busy'], mass: 'heavy', accent: 'the status light strip', label: 'plate' },
  rack: { states: ['on', 'off', 'busy'], mass: 'heavy', accent: 'the middle unit', label: 'plate' },
  chip: { states: ['on', 'off'], mass: 'light', accent: 'the die', label: 'plate' },
  database: { states: ['default'], mass: 'heavy', accent: 'the top platter', label: 'plate' },
  router: { states: ['on', 'off', 'busy'], mass: 'light', accent: 'the light row', label: 'plate' },
  cloud: { states: ['default'], mass: 'light', accent: 'its face', label: 'plate' },
  document: { states: ['full', 'empty'], mass: 'light', accent: 'one marked line', label: 'plate' },
  folder: { states: ['closed', 'open'], hinge: { closed: 'closed', open: 'open', sound: ['foley:paper slide', 'foley:paper drop'] }, mass: 'light', accent: 'the tab', label: 'plate' },
  envelope: { states: ['closed', 'open'], hinge: { closed: 'closed', open: 'open', sound: ['foley:envelope open', 'foley:paper fold'] }, mass: 'light', accent: 'the seal', label: 'plate' },
  box: { states: ['closed', 'open'], hinge: { closed: 'closed', open: 'open', sound: ['foley:cardboard box', 'foley:cardboard box'] }, mass: 'heavy', accent: 'the tape', label: 'plate' },
  key: { states: ['default'], mass: 'light', accent: 'the bow', label: 'plate' },
  lock: { states: ['locked', 'unlocked'], hinge: { closed: 'locked', open: 'unlocked', sound: ['click', 'click'] }, mass: 'light', accent: 'the body', label: 'plate' },
  card: { states: ['default'], mass: 'light', accent: 'the chip', label: 'plate' },
  speaker: { states: ['off', 'on', 'talking'], mass: 'light', accent: 'the light ring', label: 'plate' },
};

/** The object library: id → { states, hinge (true when it opens and closes), mass, accent (the part
 *  orange marks), label ('plate' | 'screen') }. Every id is a generic real-world thing, never a brand. */
export const OBJECTS = Object.freeze(Object.fromEntries(Object.entries(LIB).map(([k, v]) => [k, Object.freeze({ states: Object.freeze([...v.states]), hinge: !!v.hinge, mass: v.mass, accent: v.accent, label: v.label })])));
export const OBJECT_IDS = Object.freeze(Object.keys(LIB));
/** The puppet pins every object has (`hinge` only on the objects that open). */
export const PIN_NAMES = Object.freeze(['base', 'center', 'top', 'front', 'hinge']);
/** The travelling kinds a courier draws besides any OBJECTS id. */
export const COURIER_KINDS = Object.freeze(['request', 'packet', 'file', 'message']);
/** The motion reactions (objects act through motion alone). */
export const REACTIONS = Object.freeze(['surprised', 'proud', 'worried', 'no', 'yes']);
export const VERBS = Object.freeze(['hopTo', 'slideTo', 'lookAt', 'react', 'nod', 'shake', 'openHinge', 'closeHinge', 'settle', 'breathe', 'setState', 'setAccent']);
/** Options that would give an object a face: refused everywhere (house style). */
export const FACE_KEYS = Object.freeze(['face', 'eyes', 'eye', 'mouth', 'mood', 'brows', 'brow', 'expression', 'look', 'lid', 'lids', 'pupil', 'pupils', 'smile', 'blink', 'cheeks', 'emotion', 'gaze']);

function noFace(where, o) {
  if (!o || typeof o !== 'object') return;
  const hit = Object.keys(o).filter((k) => FACE_KEYS.includes(k));
  if (hit.length) throw new Error(`HX: ${where}: objects never get a face (house style): "${hit.join('", "')}" refused. An object acts through motion alone: hopTo, slideTo, lookAt (tilt), react, nod, shake, openHinge, closeHinge, settle, breathe.`);
}
/** Faces refused first, then any option the call does not know (a typo renders wrong silently). */
function known(where, o, allowed) {
  noFace(where, o);
  const bad = Object.keys(o ?? {}).filter((k) => !allowed.includes(k));
  if (bad.length) throw new Error(`HX: ${where}: unknown option "${bad.join('", "')}". Options: ${allowed.join(', ')}.`);
  return o ?? {};
}

// ── Tones ─────────────────────────────────────────────────────────────────────────────────
const ORANGE_RE = /^(orange|stage-orange|stage-red|sun-)/;
/** A body tone: any palette tone except orange (orange is the accent's only). */
function bodyTones(v, fallback) {
  const want = v ?? fallback;
  if (typeof want === 'string' && ORANGE_RE.test(want)) throw new Error(`HX: an object's tone is never orange: orange marks what to look at now. Use { accent: true } (its accent part) instead of tone "${want}".`);
  if (want && typeof want === 'object' && Array.isArray(want.mix) && want.mix.some((m) => typeof m === 'string' && ORANGE_RE.test(m))) throw new Error('HX: an object\'s tone is never mixed from orange: orange marks what to look at now. Use { accent: true }.');
  if (typeof want === 'string' && TONES[want]) return TONES[want];
  return tonesOf(resolveTone(want));
}
const kraft = () => tonesOf(mixHex(T['yellow-shade'], T['paper-shade'], 0.55));
const brass = () => tonesOf(mixHex(T['yellow-shade'], T['yellow'], 0.35));
const silver = () => tonesOf(mixHex(T['paper-dark'], T['paper-shade'], 0.4));
/** Each object's own body tone when none is given (an identity map may set another with `tone`). */
const DEFAULT_TONE = {
  laptop: silver,
  phone: () => TONES.ink,
  tablet: () => TONES.ink,
  screen: () => TONES.ink,
  server: () => TONES.paper,
  rack: () => TONES.ink,
  chip: () => TONES.ink,
  database: () => TONES.blue,
  router: () => TONES.paper,
  cloud: () => tonesOf(mixHex(T['paper-lit'], T['blue-lit'], 0.3)),
  document: () => TONES.paper,
  folder: () => tonesOf(mixHex(T['yellow-lit'], T['paper-shade'], 0.45)),
  envelope: () => tonesOf(mixHex(T['paper-lit'], T['blue-lit'], 0.2)),
  box: kraft,
  key: brass,
  lock: brass,
  card: () => TONES.teal,
  speaker: () => TONES.ink,
};
/** The accent paint: a body tone pulled toward orange by a (0..1). */
function accented(tn, a) {
  if (!(a > 0)) return tn;
  if (a >= 1) return TONES.orange;
  return tonesOf(mixHex(tn.base, T.orange, a));
}
const accHex = (hex, a) => (a > 0 ? mixHex(hex, T.orange, clamp01(a)) : hex);

// ── Geometry: a local frame on the isometric table ────────────────────────────────────────
// Local coordinates: u across the object's front (left → right as seen), v toward its front, z up,
// in px at size 1, origin at the base centre. facing 'left' (default) turns the front to the lower
// left, 'right' to the lower right; the light stays the kit's one light either way.
function geo(at, s, facing, lz = null) {
  const right = facing === 'right';
  // the isometric table, or (a world object) the same table turned to face the lens and carried
  // into the lens's world: model units → cm (k), the camera always in the (+x, +y) quadrant
  let P;
  if (lz) {
    const toW = (x, y, z = 0) => [lz.B[0] + (lz.X[0] * x + lz.Y[0] * y) * lz.k, lz.B[1] + (lz.X[1] * x + lz.Y[1] * y) * lz.k, lz.B[2] + z * lz.k];
    P = (x, y, z = 0) => lz.P(...toW(x, y, z));
    P.toW = toW;
  } else P = iso(at[0], at[1], s);
  const W = right ? (u, v) => [v, -u] : (u, v) => [u, v];
  const L = (u, v, z = 0) => {
    const [x, y] = W(u, v);
    return P(x, y, z);
  };
  /** A world AABB from a local one. */
  const bb = (u0, v0, z0, u1, v1, z1) => {
    const a = W(u0, v0);
    const b = W(u1, v1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), z0, Math.max(a[0], b[0]), Math.max(a[1], b[1]), z1];
  };
  /** A soft box: local min corner, extents w (u), d (v), h. Returns { svg, front, side, top } polygons. */
  const box = (u0, v0, z0, w, d, h, tones, o = {}) => {
    const [x, y] = right ? [v0, -u0 - w] : [u0, v0];
    const [ww, dd] = right ? [d, w] : [w, d];
    if (lz) {
      // through the lens: a soft box that culls its back faces and takes the studio light
      const k = lz.k;
      const res = obox(lz.P, P.toW(x, y, z0), [lz.X[0] * ww * k, lz.X[1] * ww * k, 0], [lz.Y[0] * dd * k, lz.Y[1] * dd * k, 0], [0, 0, h * k], tones, lz.R, { radius: (o.radius ?? 6) * k, gloss: !!o.gloss });
      return { svg: res.svg, bb: bb(u0, v0, z0, u0 + w, v0 + d, z0 + h) };
    }
    const res = isoBox(P, x, y, z0, ww, dd, h, tones, { shadow: false, ao: o.ao ?? z0 > 0, radius: (o.radius ?? 6) * s, gloss: !!o.gloss });
    return { svg: res.svg, front: right ? res.right : res.left, side: right ? res.left : res.right, top: res.top, bb: bb(u0, v0, z0, u0 + w, v0 + d, z0 + h) };
  };
  /** The SVG transform that lays flat 2D drawing on the plane through local point o with axes du, dv. */
  const plane = (o, du, dv, span = null) => {
    const at = (a, b) => L(o[0] + du[0] * a + dv[0] * b, o[1] + du[1] * a + dv[1] * b, o[2] + du[2] * a + dv[2] * b);
    if (span && span[2] > span[0] && span[3] > span[1]) {
      // fitted exactly through the drawing's bottom corners and its top middle (plane units
      // [a0, b0, a1, b1]): through a perspective lens the edge a part stands or hinges on lands
      // exactly where the part it meets is drawn (a laptop lid on its hinge, a phone on its foot)
      const [a0, b0, a1, b1] = span;
      const q1 = at(a0, b1);
      const q2 = at(a1, b1);
      const q3 = at((a0 + a1) / 2, b0);
      const A = [(q2[0] - q1[0]) / (a1 - a0), (q2[1] - q1[1]) / (a1 - a0)];
      const C = [(q1[0] + A[0] * (a1 - a0) / 2 - q3[0]) / (b1 - b0), (q1[1] + A[1] * (a1 - a0) / 2 - q3[1]) / (b1 - b0)];
      const E = [q1[0] - A[0] * a0 - C[0] * b1, q1[1] - A[1] * a0 - C[1] * b1];
      return `matrix(${r3(A[0])} ${r3(A[1])} ${r3(C[0])} ${r3(C[1])} ${r1(E[0])} ${r1(E[1])})`;
    }
    // fitted over a span, so through a perspective lens the drawing is a secant fit to the face
    const S = 60;
    const O = L(o[0], o[1], o[2]);
    const A = L(o[0] + du[0] * S, o[1] + du[1] * S, o[2] + du[2] * S);
    const B = L(o[0] + dv[0] * S, o[1] + dv[1] * S, o[2] + dv[2] * S);
    return `matrix(${r3((A[0] - O[0]) / S)} ${r3((A[1] - O[1]) / S)} ${r3((B[0] - O[0]) / S)} ${r3((B[1] - O[1]) / S)} ${r1(O[0])} ${r1(O[1])})`;
  };
  /** Drawing on a front-facing plane at depth v: a → right, b → down, origin at (u 0, z zRef). */
  const front = (v, zRef, inner, span = null) => g({ transform: plane([0, v, zRef], [1, 0, 0], [0, 0, -1], span) }, inner);
  /** Drawing on a top plane at height z: a → right, b → toward the front, origin at local (0, 0). */
  const top = (z, inner, span = null) => g({ transform: plane([0, 0, z], [1, 0, 0], [0, 1, 0], span) }, inner);
  // the view direction in local coordinates: what faces it is seen
  const view = right ? [-1, 1, 1] : [1, 1, 1];
  return { P, L, W, bb, box, plane, front, top, s, right, view, lz };
}

/** The face tone of a front-facing surface: the left iso face when facing left, the right when right. */
const frontTone = (G, tn) => (G.right ? tn.right : tn.left);

/**
 * A flat shape `d` (path in plane units) extruded `depth` toward the back of its plane: layers of
 * the edge tone from the back, then the face. The plane is { o, du, dv } (local), its normal du × dv
 * toward the viewer. `face` paints the face (a hex: a soft shaded volume; a paint: flat).
 */
/** The plane-unit box [a0, b0, a1, b1] of an absolute path (M L H V Q C Z), or null. */
function pathBox(d) {
  const tok = String(d).match(/[MLHVQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const xs = [];
  const ys = [];
  let cmd = 'M';
  let i = 0;
  let cx = 0;
  let cy = 0;
  while (i < tok.length) {
    if (/^[a-z]$/i.test(tok[i])) {
      cmd = tok[i++].toUpperCase();
      if (cmd === 'Z') continue;
    }
    const n = Number(tok[i]);
    if (!Number.isFinite(n)) { i++; continue; }
    if (cmd === 'H') { cx = n; i++; }
    else if (cmd === 'V') { cy = n; i++; }
    else { cx = n; cy = Number(tok[i + 1]); i += 2; }
    if (Number.isFinite(cx) && Number.isFinite(cy)) { xs.push(cx); ys.push(cy); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}

function extrude(G, d, { o, du = [1, 0, 0], dv = [0, 0, -1], depth = 10, tn, face = null, backFace = null, edge = null, rule = null, form = 0.8 }) {
  const span = pathBox(d);
  const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
  const nl = Math.hypot(...n) || 1;
  const N = n.map((c) => c / nl);
  const seen = N[0] * G.view[0] + N[1] * G.view[1] + N[2] * G.view[2] >= 0 ? 1 : -1;
  const steps = clamp(Math.ceil((depth * G.s) / 2.5), 2, 12);
  const out = [];
  const fillRule = rule ? { 'fill-rule': rule } : {};
  const edgeLit = edge ?? tn.top;
  // from the far side to the near side: the face is on the side that is seen
  for (let k = steps; k >= 1; k--) {
    const off = seen > 0 ? -depth * (k / steps) : depth * (1 - k / steps);
    const O = [o[0] + N[0] * off, o[1] + N[1] * off, o[2] + N[2] * off];
    const col = mixHex(edgeLit, tn.dark, 0.18 + 0.32 * (k / steps));
    out.push(g({ transform: G.plane(O, du, dv, span) }, el('path', { d, fill: col, ...fillRule })));
  }
  const Of = seen > 0 ? o : [o[0] - N[0] * depth, o[1] - N[1] * depth, o[2] - N[2] * depth];
  const fc = (seen < 0 && backFace) || face || frontTone(G, tn);
  const faceSvg = isHex(fc) ? (rule ? el('path', { d, fill: fc, ...fillRule }) : softShape(d, fc, { form })) : el('path', { d, fill: fc, ...fillRule });
  const pl = G.plane(Of, du, dv, span);
  out.push(g({ transform: pl }, faceSvg));
  return { svg: out.join(''), plane: pl, seen };
}

/** A tube through local points (a shackle, an antenna): a soft stroked volume. */
function tube(G, pts3, width, tn) {
  const pts = pts3.map((p) => G.L(p[0], p[1], p[2]));
  const d = `M ${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L ')}`;
  const w = width * G.s;
  return [
    el('path', { d, fill: 'none', stroke: tn.dark, 'stroke-width': r1(w), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    el('path', { d, fill: 'none', stroke: tn.base, 'stroke-width': r1(w * 0.78), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: `translate(${r1(w * 0.08)} ${r1(-w * 0.08)})` }),
    el('path', { d, fill: 'none', stroke: tn.top, 'stroke-width': r1(Math.max(1.5, w * 0.22)), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85, transform: `translate(${r1(w * 0.2)} ${r1(-w * 0.22)})` }),
  ].join('');
}

/** A cylinder standing at local (u, v) from z0 to z1, radius r (local px). */
function cyl(G, u, v, z0, z1, r, tn, o = {}) {
  if (G.lz) {
    const [x, y] = G.W(u, v);
    return { svg: lensCylinder(G.lz.P, G.P.toW(x, y, z0), r * G.lz.k, (z1 - z0) * G.lz.k, tn, G.lz.R, { seg: 40 }), bb: G.bb(u - r, v - r, z0, u + r, v + r, z1) };
  }
  const c = G.L(u, v, z1);
  return { svg: isoDisc(c[0], c[1], 1.2247 * r * G.s, (z1 - z0) * G.s, tn, { rings: o.rings ?? 0, gloss: !!o.gloss, ao: o.ao ?? z0 > 0 }), bb: G.bb(u - r, v - r, z0, u + r, v + r, z1) };
}

/** A lit display in plane units (a0, b0, w, h, r): off (dark glass), on (lit), pulled to orange by acc. */
function display(a0, b0, w, h, r, { on, acc, bars = true }) {
  const out = [];
  const d = roundRect(a0, b0, w, h, r);
  if (on) {
    const gr = lin([[0, WHITE], [0.55, T['paper-lit']], [1, mixHex(T['paper-lit'], T['blue-lit'], 0.22)]], 0.2, 0, 0.8, 1);
    out.push(gr.def, el('path', { d, fill: gr.paint }));
    if (bars) {
      const bw = [0.62, 0.8, 0.46];
      bw.forEach((k, i) => out.push(el('rect', { x: r1(a0 + w * 0.12), y: r1(b0 + h * (0.26 + i * 0.2)), width: r1(w * 0.76 * k), height: r1(Math.max(4, h * 0.07)), rx: r1(Math.max(2, h * 0.035)), fill: T.ink, opacity: i === 0 ? 0.22 : 0.12 })));
    }
  } else {
    const gr = lin([[0, mixHex(T['ink-lit'], T['text-tertiary'], 0.25)], [0.6, T.ink], [1, T['ink-shade']]], 0.15, 0, 0.85, 1);
    out.push(gr.def, el('path', { d, fill: gr.paint }));
  }
  if (acc > 0) {
    const ag = lin([[0, T['orange-lit']], [0.6, T.orange], [1, mixHex(T.orange, T['stage-red'], 0.45)]], 0.2, 0, 0.8, 1);
    out.push(ag.def, el('path', { d, fill: ag.paint, opacity: r3(clamp01(acc)) }));
  }
  // a glass sheen across the display
  const sh = lin([[0, WHITE, on && !(acc > 0.5) ? 0.5 : 0.16], [0.42, WHITE, 0], [1, WHITE, 0]], 0, 0, 1, 1);
  out.push(sh.def, el('path', { d: `M ${r1(a0 + r)} ${r1(b0)} H ${r1(a0 + w * 0.62)} L ${r1(a0 + w * 0.28)} ${r1(b0 + h)} H ${r1(a0 + r)} Q ${r1(a0)} ${r1(b0 + h)} ${r1(a0)} ${r1(b0 + h - r)} V ${r1(b0 + r)} Q ${r1(a0)} ${r1(b0)} ${r1(a0 + r)} ${r1(b0)} Z`, fill: sh.paint }));
  return out.join('');
}

/** The status lights of a machine in plane units: on (green), off (dark), busy (blinking by t), or
 *  orange when it is the accent. */
function lights(points, rr, { st, acc, t }) {
  return points.map(([a, b], i) => {
    const blink = st === 'busy' ? (Math.sin(t * 9 + i * 2.1) > 0.1 ? 1 : 0.25) : 1;
    const base = st === 'off' ? T['ink-lit'] : T['status-success'];
    const col = acc > 0 ? accHex(st === 'off' ? T['paper-dark'] : T['status-success'], acc) : base;
    const glow = st !== 'off' || acc > 0;
    return [
      glow ? el('circle', { cx: r1(a), cy: r1(b), r: r1(rr * 2.1), fill: col, opacity: r3(0.28 * blink) }) : '',
      el('circle', { cx: r1(a), cy: r1(b), r: r1(rr), fill: col, opacity: r3(st === 'off' && !(acc > 0) ? 1 : 0.35 + 0.65 * blink) }),
      el('circle', { cx: r1(a - rr * 0.3), cy: r1(b - rr * 0.35), r: r1(rr * 0.35), fill: WHITE, opacity: r3((glow ? 0.7 : 0.25) * blink) }),
    ].join('');
  }).join('');
}

// ── The models: each draws its parts in local units and names its pins ───────────────────
// A model returns { parts: [{ bb, svg }], under: [svg] (glows under the body), pins: { name: [u, v, z] },
// label: { at: [u, v, z], w } (the label's anchor and the face width it sits on), foot: [w, d] }.

const M = {
  laptop(G, o) {
    const tn = o.tone ?? silver();
    const ink = TONES.ink;
    const W0 = 236;
    const D0 = 160;
    const H0 = 14;
    const LID = 156;
    const parts = [];
    const base = G.box(-W0 / 2, -D0 / 2, 0, W0, D0, H0, tn, { radius: 8 });
    // the keyboard well and the trackpad on the base's top
    const keys = [];
    keys.push(el('rect', { x: -W0 / 2 + 14, y: -D0 / 2 + 12, width: W0 - 28, height: 84, rx: 8, fill: mixHex(tn.top, tn.dark, 0.32) }));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 11; c++) keys.push(el('rect', { x: r1(-W0 / 2 + 20 + c * 18.4), y: r1(-D0 / 2 + 17 + r * 19), width: 14.5, height: 14, rx: 3, fill: mixHex(tn.top, WHITE, 0.25) }));
    keys.push(el('rect', { x: -38, y: D0 / 2 - 52, width: 76, height: 40, rx: 7, fill: mixHex(tn.top, tn.dark, 0.14) }));
    // the lid, hinged at the back edge: θ 0 lies closed on the base, 1 stands open (≈ 104°)
    const th = (clamp(o.hinge, -0.1, 1.15) * 104 * Math.PI) / 180;
    const a = [0, Math.cos(th), Math.sin(th)];
    const hz = H0;
    const hv = -D0 / 2 + 2;
    // one object: the hinge barrel joins the base's back edge to the lid's foot (the lid is fitted
    // through this edge, extrude's span fit), so base and lid never part through any lens
    const hingeBar = tube(G, [[-W0 / 2 + 22, hv + 1, hz - 1], [W0 / 2 - 22, hv + 1, hz - 1]], 9, { dark: tn.dark, base: mixHex(tn.base, tn.dark, 0.35), top: tn.base });
    parts.push({ bb: base.bb, svg: base.svg + G.top(H0, keys, [-W0 / 2, -D0 / 2, W0 / 2, D0 / 2]) + hingeBar });
    const innerSeen = Math.sin(th) - Math.cos(th) > 0;
    // the lid's plane: origin at its top-left far corner, du along u, dv from the far edge toward the hinge
    const far = [-W0 / 2 + 2, hv + a[1] * LID, hz + a[2] * LID];
    const du = [1, 0, 0];
    const dv = [0, -a[1], -a[2]];
    const lidW = W0 - 4;
    const shape = roundRect(0, 0, lidW, LID, 10);
    const lid = extrude(G, shape, { o: far, du, dv, depth: 8, tn: innerSeen ? ink : tn, face: innerSeen ? mixHex(ink.top, ink.base, 0.5) : mixHex(tn.top, tn.base, 0.4), edge: tn.base });
    let lidSvg = lid.svg;
    if (innerSeen) {
      const on = o.st === 'on';
      lidSvg += g({ transform: lid.plane }, display(11, 10, lidW - 22, LID - 26, 6, { on, acc: o.acc, bars: !o.hasLabel }));
    }
    const lidTop = Math.max(hz + a[2] * LID, hz + 8);
    parts.push({ bb: G.bb(-W0 / 2, Math.min(hv, hv + a[1] * LID) - 4, hz, W0 / 2, Math.max(hv, hv + a[1] * LID) + 4, lidTop), svg: lidSvg });
    const mid = [0, hv + (a[1] * LID) / 2, hz + (a[2] * LID) / 2];
    const open = o.hinge > 0.55;
    return {
      parts,
      under: o.acc > 0 && open ? [{ at: mid, rx: 150, ry: 110 }] : [],
      pins: { base: [0, 0, 0], center: [0, open ? hv + (a[1] * LID) * 0.35 : 0, open ? hz + (a[2] * LID) * 0.35 : H0], top: [0, hv + a[1] * LID, lidTop], front: open ? mid : [0, 0, H0 + 8], hinge: [0, hv, hz] },
      label: { at: open ? mid : [0, 10, H0 + 8], w: lidW - 22, h: (LID - 26) * Math.max(0.3, Math.sin(th)), screen: open && innerSeen },
      foot: [W0, D0],
    };
  },

  phone(G, o) {
    return M._slate(G, o, { w: 108, h: 212, depth: 14, r: 20, bezel: 8, lean: 0, stand: false });
  },
  tablet(G, o) {
    return M._slate(G, o, { w: 206, h: 160, depth: 12, r: 16, bezel: 10, lean: 13, stand: true });
  },
  /** A device slab standing on its edge (phone, tablet), optionally leaning back on a stand. */
  _slate(G, o, { w, h, depth, r, bezel, lean, stand }) {
    const tn = o.tone ?? TONES.ink;
    const b = (lean * Math.PI) / 180;
    const dv = [0, Math.sin(b), -Math.cos(b)]; // down the face
    const o3 = [-w / 2, -Math.sin(b) * h * 0.5 + 6, h * Math.cos(b)];
    const parts = [];
    if (stand) {
      const st = G.box(-w * 0.18, -h * 0.42, 0, w * 0.36, h * 0.34, 8, silver(), { radius: 4 });
      parts.push({ bb: st.bb, svg: st.svg + tube(G, [[0, -h * 0.3, 6], [0, -h * 0.12, h * 0.4]], 10, silver()) });
    }
    const body = extrude(G, roundRect(0, 0, w, h, r), { o: o3, dv, depth, tn, face: mixHex(tn.top, tn.base, 0.55), edge: tn.top });
    const scr = g({ transform: body.plane }, display(bezel, bezel * 1.4, w - bezel * 2, h - bezel * 2.8, Math.max(4, r - bezel), { on: o.st === 'on', acc: o.acc, bars: !o.hasLabel }));
    parts.push({ bb: G.bb(-w / 2, o3[1] - depth, 0, w / 2, o3[1] + Math.sin(b) * h, h), svg: body.svg + scr });
    const mid = [0, o3[1] + Math.sin(b) * h * 0.5, h * Math.cos(b) * 0.5];
    return {
      parts,
      under: o.acc > 0 ? [{ at: mid, rx: w * 0.75, ry: h * 0.55 }] : [],
      pins: { base: [0, 0, 0], center: mid, top: [0, o3[1], o3[2]], front: mid },
      label: { at: mid, w: w - bezel * 2, h: (h - bezel * 2.8) * Math.cos(b), screen: true },
      foot: [w, 30],
    };
  },

  screen(G, o) {
    const tn = o.tone ?? TONES.ink;
    const w = 270;
    const h = 168;
    const z0 = 70;
    const parts = [];
    const foot = G.box(-60, -46, 0, 120, 80, 9, silver(), { radius: 6 });
    const neck = G.box(-14, -30, 9, 28, 14, z0 - 4, silver(), { radius: 4 });
    parts.push({ bb: foot.bb, svg: foot.svg }, { bb: neck.bb, svg: neck.svg });
    const body = extrude(G, roundRect(0, 0, w, h, 12), { o: [-w / 2, -6, z0 + h], depth: 16, tn, face: mixHex(tn.top, tn.base, 0.55), edge: tn.top });
    const scr = g({ transform: body.plane }, display(10, 10, w - 20, h - 26, 5, { on: o.st === 'on', acc: o.acc, bars: !o.hasLabel }));
    parts.push({ bb: G.bb(-w / 2, -22, z0, w / 2, -6, z0 + h), svg: body.svg + scr });
    const mid = [0, -6, z0 + h / 2 + 6];
    return {
      parts,
      under: o.acc > 0 ? [{ at: mid, rx: 190, ry: 130 }] : [],
      pins: { base: [0, 0, 0], center: mid, top: [0, -6, z0 + h], front: mid },
      label: { at: mid, w: w - 20, h: h - 26, screen: true },
      foot: [120, 80],
    };
  },

  server(G, o) {
    const tn = o.tone ?? TONES.paper;
    const w = 136;
    const d = 150;
    const h = 262;
    const body = G.box(-w / 2, -d / 2, 0, w, d, h, tn, { radius: 12 });
    const ink = TONES.ink;
    const pw = w - 22;
    const panel = [];
    const pg = lin([[0, ink.top], [1, ink.base]]);
    panel.push(pg.def, el('rect', { x: -pw / 2, y: 11, width: pw, height: h - 22, rx: 9, fill: pg.paint }));
    // drive bays
    for (let i = 0; i < 4; i++) {
      const y = 26 + i * 40;
      panel.push(el('rect', { x: -pw / 2 + 12, y, width: pw - 44, height: 28, rx: 5, fill: mixHex(ink.top, T['paper-dark'], 0.18) }));
      panel.push(el('rect', { x: -pw / 2 + 20, y: y + 12, width: pw - 64, height: 4, rx: 2, fill: ink.dark, opacity: 0.8 }));
    }
    // the status light strip (the accent part)
    const strip = [];
    for (let i = 0; i < 4; i++) strip.push([pw / 2 - 16, 40 + i * 40]);
    panel.push(el('rect', { x: pw / 2 - 26, y: 22, width: 20, height: 156, rx: 10, fill: o.acc > 0 ? accHex(ink.dark, o.acc * 0.55) : ink.dark }));
    panel.push(lights(strip, 5.5, o));
    // vents low
    for (let i = 0; i < 3; i++) panel.push(el('rect', { x: -pw / 2 + 14, y: h - 60 + i * 12, width: pw - 28, height: 4, rx: 2, fill: ink.dark, opacity: 0.7 }));
    const parts = [{ bb: body.bb, svg: body.svg + G.front(d / 2, h, panel) }];
    return {
      parts,
      under: o.acc > 0 ? [{ at: [pw / 2 - 16, d / 2, h - 100], rx: 70, ry: 120 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, h / 2], top: [0, 0, h], front: [0, d / 2, h * 0.36] },
      label: { at: [0, d / 2, h * 0.3], w: pw },
      foot: [w, d],
    };
  },

  rack(G, o) {
    const tn = o.tone ?? TONES.ink;
    const w = 180;
    const d = 150;
    const h = 350;
    const body = G.box(-w / 2, -d / 2, 0, w, d, h, tn, { radius: 12 });
    const inner = [];
    inner.push(el('rect', { x: -w / 2 + 12, y: 12, width: w - 24, height: h - 24, rx: 8, fill: tn.dark }));
    const unitH = 44;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y = 22 + i * (unitH + 9);
      const isAcc = i === 2 && o.acc > 0;
      const face = isAcc ? accHex(T['paper-shade'], o.acc) : mixHex(T['paper-shade'], T['paper-dark'], 0.4);
      const ug = lin([[0, mixHex(face, WHITE, 0.25)], [1, face]]);
      inner.push(ug.def, el('rect', { x: -w / 2 + 20, y, width: w - 40, height: unitH, rx: 6, fill: ug.paint }));
      inner.push(el('rect', { x: -w / 2 + 32, y: y + unitH / 2 - 3, width: w - 110, height: 6, rx: 3, fill: T.ink, opacity: 0.35 }));
      inner.push(lights([[w / 2 - 50, y + unitH / 2], [w / 2 - 34, y + unitH / 2]], 4.5, { st: o.st, acc: isAcc ? o.acc : 0, t: o.t + i * 0.37 }));
    }
    return {
      parts: [{ bb: body.bb, svg: body.svg + G.front(d / 2, h, inner) }],
      under: o.acc > 0 ? [{ at: [0, d / 2, h - 22 - 2 * (unitH + 9) - unitH / 2], rx: 140, ry: 60 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, h / 2], top: [0, 0, h], front: [0, d / 2, h * 0.5] },
      label: { at: [0, d / 2, h * 0.16], w: w - 40 },
      foot: [w, d],
    };
  },

  chip(G, o) {
    const tn = o.tone ?? TONES.ink;
    const S = 176;
    const z0 = 12;
    const H = 28;
    const legs = silver();
    const parts = [];
    const n = 5;
    const step = (S - 56) / (n - 1);
    // the legs along all four sides, short and low (the back ones draw first: the painter sorts them)
    for (let i = 0; i < n; i++) {
      const c = -S / 2 + 28 + i * step;
      parts.push(G.box(c - 6, -S / 2 - 14, 0, 12, 18, z0 + 4, legs, { radius: 3, ao: false }));
      parts.push(G.box(c - 6, S / 2 - 4, 0, 12, 18, z0 + 4, legs, { radius: 3, ao: false }));
      parts.push(G.box(-S / 2 - 14, c - 6, 0, 18, 12, z0 + 4, legs, { radius: 3, ao: false }));
      parts.push(G.box(S / 2 - 4, c - 6, 0, 18, 12, z0 + 4, legs, { radius: 3, ao: false }));
    }
    const pkg = G.box(-S / 2, -S / 2, z0, S, S, H, tn, { radius: 10, ao: false });
    // traces from the die to the edge on the package top
    const tr = [];
    for (let i = 0; i < 5; i++) {
      const k = -36 + i * 18;
      tr.push(el('path', { d: `M ${k} -44 V -70 M ${k} 44 V 70 M -44 ${k} H -70 M 44 ${k} H 70`, stroke: mixHex(tn.top, T['paper-dark'], 0.3), 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none', opacity: 0.8 }));
    }
    parts.push({ bb: pkg.bb, svg: pkg.svg + G.top(z0 + H, tr) });
    const dieT = o.acc > 0 ? accented(tonesOf(o.st === 'on' ? T['teal-lit'] : T['paper-dark']), o.acc) : tonesOf(o.st === 'on' ? T['teal-lit'] : T['paper-dark']);
    const die = G.box(-40, -46, z0 + H, 80, 80, 10, dieT, { radius: 6, gloss: true });
    parts.push(die);
    return {
      parts,
      under: o.acc > 0 ? [{ at: [0, 0, z0 + H + 10], rx: 120, ry: 70 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, z0 + H / 2], top: [0, 0, z0 + H + 10], front: [0, S / 2, z0 + H] },
      label: { at: [0, S / 2 - 8, z0 + H], w: S },
      foot: [S + 30, S + 30],
    };
  },

  database(G, o) {
    const tn = o.tone ?? TONES.blue;
    const r = 96;
    const hh = 52;
    const gap = 11;
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const z0 = i * (hh + gap);
      const isTop = i === 2;
      parts.push(cyl(G, 0, 0, z0, z0 + hh, r, isTop ? accented(tn, o.acc) : tn, { rings: isTop ? 2 : 0, gloss: isTop }));
    }
    const H = 3 * hh + 2 * gap;
    return {
      parts,
      under: o.acc > 0 ? [{ at: [0, 0, H], rx: 150, ry: 70 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, H / 2], top: [0, 0, H], front: [r * 0.707, r * 0.707, hh + gap + hh / 2] },
      // the label sits on the front of the middle platter: its screen point is set below
      label: { at: [r * 0.707, r * 0.707, hh + gap + hh / 2], w: 2.2 * r },
      foot: [2 * r, 2 * r],
      round: r,
    };
  },

  router(G, o) {
    const tn = o.tone ?? TONES.paper;
    const w = 210;
    const d = 140;
    const h = 48;
    const ant = TONES.ink;
    const parts = [];
    parts.push({ bb: G.bb(-w / 2 + 14, -d / 2 + 6, h, -w / 2 + 34, -d / 2 + 26, h + 150), svg: tube(G, [[-w / 2 + 24, -d / 2 + 16, h - 4], [-w / 2 + 16, -d / 2 + 8, h + 140]], 15, ant) });
    parts.push({ bb: G.bb(w / 2 - 34, -d / 2 + 6, h, w / 2 - 14, -d / 2 + 26, h + 150), svg: tube(G, [[w / 2 - 24, -d / 2 + 16, h - 4], [w / 2 - 16, -d / 2 + 8, h + 140]], 15, ant) });
    const body = G.box(-w / 2, -d / 2, 0, w, d, h, tn, { radius: 12 });
    const led = [];
    const strip = [];
    for (let i = 0; i < 5; i++) strip.push([-56 + i * 28, h / 2]);
    led.push(el('rect', { x: -76, y: h / 2 - 11, width: 152, height: 22, rx: 11, fill: o.acc > 0 ? accHex(T['ink-lit'], o.acc * 0.5) : T['ink-lit'] }));
    led.push(lights(strip, 5, o));
    parts.push({ bb: body.bb, svg: body.svg + G.front(d / 2, h, led) });
    return {
      parts,
      under: o.acc > 0 ? [{ at: [0, d / 2, h / 2], rx: 120, ry: 50 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, h / 2], top: [0, 0, h + 140], front: [0, d / 2, h / 2] },
      label: { at: [0, 0, h], w: w * 0.8 },
      foot: [w, d],
    };
  },

  cloud(G, o) {
    const tn = o.tone ?? tonesOf(mixHex(T['paper-lit'], T['blue-lit'], 0.3));
    const hover = 34;
    const d = 'M -128 0 C -158 0 -164 -52 -128 -62 C -134 -104 -84 -124 -56 -100 C -40 -148 34 -152 52 -104 C 84 -126 132 -100 120 -60 C 160 -54 156 0 122 0 Z';
    const face = o.acc > 0 ? accHex(tn.top, o.acc) : tn.top;
    const body = extrude(G, d, { o: [0, 20, hover], depth: 44, tn, face, edge: mixHex(tn.top, WHITE, 0.3), form: 1 });
    const parts = [{ bb: G.bb(-150, -24, hover, 150, 20, hover + 150), svg: body.svg }];
    return {
      parts,
      under: o.acc > 0 ? [{ at: [0, 20, hover + 70], rx: 180, ry: 110 }] : [],
      pins: { base: [0, 0, 0], center: [0, 20, hover + 70], top: [0, 0, hover + 150], front: [0, 20, hover + 62] },
      label: { at: [0, 20, hover + 52], w: 220 },
      foot: [220, 60],
      shadowK: 0.55,
    };
  },

  document(G, o) {
    const tn = o.tone ?? TONES.paper;
    const w = 160;
    const h = 212;
    const fold = 34;
    const shape = `M 10 0 H ${w - fold} L ${w} ${fold} V ${h - 10} Q ${w} ${h} ${w - 10} ${h} H 10 Q 0 ${h} 0 ${h - 10} V 10 Q 0 0 10 0 Z`;
    const body = extrude(G, shape, { o: [-w / 2, 4, h], depth: 6, tn, face: tn.top, edge: tn.base, form: 0.5 });
    const marks = [];
    marks.push(el('path', { d: `M ${w - fold} 0 V ${fold - 6} Q ${w - fold} ${fold} ${w - fold + 6} ${fold} H ${w} Z`, fill: mixHex(tn.base, tn.shade, 0.5) }));
    if (o.st !== 'empty') {
      marks.push(el('rect', { x: 18, y: 22, width: 76, height: 12, rx: 6, fill: T.ink, opacity: 0.55 }));
      const rows = [0.86, 0.72, 0.9, 0.64, 0.8, 0.5];
      rows.forEach((k, i) => {
        const y = 58 + i * 22;
        if (i === 2 && o.acc > 0) marks.push(el('rect', { x: 12, y: y - 6, width: (w - 24) * k + 12, height: 18, rx: 6, fill: T.orange, opacity: r3(0.85 * o.acc) }));
        marks.push(el('rect', { x: 18, y, width: r1((w - 36) * k), height: 7, rx: 3.5, fill: T.ink, opacity: i === 2 && o.acc > 0 ? 0.5 : 0.2 }));
      });
    }
    return {
      parts: [{ bb: G.bb(-w / 2, -2, 0, w / 2, 4, h), svg: body.svg + g({ transform: body.plane }, marks) }],
      under: o.acc > 0 ? [{ at: [0, 4, 120], rx: 110, ry: 110 }] : [],
      pins: { base: [0, 0, 0], center: [0, 4, h / 2], top: [0, 4, h], front: [0, 4, h * 0.42] },
      label: { at: [0, 4, 34], w: w - 20 },
      foot: [w, 24],
    };
  },

  folder(G, o) {
    const tn = o.tone ?? tonesOf(mixHex(T['yellow-lit'], T['paper-shade'], 0.45));
    const w = 196;
    const h = 150;
    const parts = [];
    // the back cover with its tab (the accent part)
    const tabT = o.acc > 0 ? accHex(mixHex(tn.top, tn.base, 0.5), o.acc) : mixHex(tn.top, tn.base, 0.5);
    const back = extrude(G, `M 8 0 H ${w - 8} Q ${w} 0 ${w} 8 V ${h} H 0 V 8 Q 0 0 8 0 Z`, { o: [-w / 2, -10, h], depth: 6, tn, face: mixHex(tn.base, tn.shade, 0.35), edge: tn.base, form: 0.4 });
    const tab = extrude(G, 'M 0 26 L 10 4 Q 12 0 18 0 H 66 Q 72 0 74 4 L 84 26 Z', { o: [-w / 2 + 12, -10, h + 24], depth: 6, tn, face: tabT, edge: tn.base, form: 0.4 });
    parts.push({ bb: G.bb(-w / 2, -16, 0, w / 2, -10, h + 24), svg: tab.svg + back.svg });
    // the pages inside, peeking out
    const pages = extrude(G, roundRect(0, 0, w - 26, h - 6, 4), { o: [-w / 2 + 13, -4, h + 10], depth: 4, tn: TONES.paper, face: T['paper-lit'], edge: T.paper, form: 0.3 });
    const lines = [];
    for (let i = 0; i < 3; i++) lines.push(el('rect', { x: 16, y: 16 + i * 16, width: (w - 60) * [0.8, 0.6, 0.7][i], height: 6, rx: 3, fill: T.ink, opacity: 0.18 }));
    parts.push({ bb: G.bb(-w / 2 + 13, -8, 0, w / 2 - 13, -4, h + 10), svg: pages.svg + g({ transform: pages.plane }, lines) });
    // the front cover, hinged on its left edge: 0 closed, 1 swung open toward the viewer
    const al = (clamp(o.hinge, -0.1, 1.1) * 72 * Math.PI) / 180;
    const fh = h - 18;
    const cover = extrude(G, roundRect(0, 0, w, fh, 8), { o: [-w / 2, 2, fh], du: [Math.cos(al), Math.sin(al), 0], dv: [0, 0, -1], depth: 6, tn, face: mixHex(tn.top, tn.base, 0.45), edge: tn.top, form: 0.5 });
    const fu = -w / 2 + w * Math.cos(al);
    const fv = 2 + w * Math.sin(al);
    parts.push({ bb: G.bb(Math.min(-w / 2, fu), -2, 0, Math.max(-w / 2, fu), Math.max(2, fv), fh), svg: cover.svg });
    return {
      parts,
      under: o.acc > 0 ? [{ at: [-w / 2 + 54, -10, h + 12], rx: 70, ry: 40 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, h / 2], top: [0, -10, h + 24], front: [0, 2, fh * 0.5], hinge: [-w / 2, 2, fh / 2] },
      label: { at: [0, 2, fh * 0.26], w: w - 30 },
      foot: [w, 30],
    };
  },

  envelope(G, o) {
    const tn = o.tone ?? TONES.paper;
    const w = 220;
    const h = 142;
    const parts = [];
    const back = extrude(G, roundRect(0, 0, w, h, 8), { o: [-w / 2, -2, h], depth: 4, tn, face: mixHex(tn.base, tn.shade, 0.5), edge: tn.shade, form: 0.3 });
    parts.push({ bb: G.bb(-w / 2, -6, 0, w / 2, -2, h), svg: back.svg });
    // the letter inside: it rises out as the flap opens
    const rise = 72 * clamp01((o.hinge - 0.55) / 0.45);
    if (rise > 0.5) {
      const letter = extrude(G, roundRect(0, 0, w - 36, h, 4), { o: [-w / 2 + 18, 0, h - 8 + rise], depth: 2, tn: TONES.paper, face: T['paper-lit'], edge: T.paper, form: 0.2 });
      const lines = [0.7, 0.85, 0.55, 0.75].map((k, i) => el('rect', { x: 18, y: 18 + i * 16, width: r1((w - 72) * k), height: 7, rx: 3.5, fill: T.ink, opacity: i ? 0.2 : 0.4 })).join('');
      parts.push({ bb: G.bb(-w / 2 + 18, -1, 0, w / 2 - 18, 0, h + rise), svg: letter.svg + g({ transform: letter.plane }, lines) });
    }
    // the front pocket with its folds
    const front = extrude(G, `M 0 ${h * 0.34} L ${w / 2} ${h * 0.62} L ${w} ${h * 0.34} V ${h - 8} Q ${w} ${h} ${w - 8} ${h} H 8 Q 0 ${h} 0 ${h - 8} Z`, { o: [-w / 2, 4, h], depth: 3, tn, face: mixHex(tn.top, tn.base, 0.3), edge: tn.shade, form: 0.6 });
    const folds = el('path', { d: `M 6 ${h - 6} L ${w / 2} ${h * 0.62} L ${w - 6} ${h - 6}`, fill: 'none', stroke: tn.dark, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.45 });
    parts.push({ bb: G.bb(-w / 2, 1, 0, w / 2, 4, h), svg: front.svg + g({ transform: front.plane }, folds) });
    // the flap, hinged at the top edge: 0 folded down over the front, 1 open, pointing up
    const ps = clamp(o.hinge, -0.1, 1.08) * Math.PI;
    const flapL = h * 0.6;
    const dv = [0, Math.sin(ps), -Math.cos(ps)];
    // the fold runs over the top edge: in front of the pocket when closed, behind the letter when open
    const hv = lerp(5, -4, clamp01(ps / Math.PI));
    const flap = extrude(G, `M 0 0 H ${w} L ${w / 2 + 14} ${flapL - 8} Q ${w / 2} ${flapL + 2} ${w / 2 - 14} ${flapL - 8} Z`, { o: [-w / 2, hv, h], du: [1, 0, 0], dv, depth: 3, tn, face: mixHex(tn.base, tn.shade, 0.55), backFace: mixHex(tn.shade, tn.dark, 0.3), edge: tn.dark, form: 0.8 });
    // the seal at the flap's tip (the accent part)
    const tip = [0, hv + dv[1] * (flapL - 6), h + dv[2] * (flapL - 6)];
    const tp = G.L(...tip);
    const sealC = o.acc > 0 ? accHex(T['red-shade'], o.acc) : T['red-shade'];
    const sr = 22 * G.s;
    const seal = softShape(`M ${r1(tp[0] - sr)} ${r1(tp[1])} a ${r1(sr)} ${r1(sr)} 0 1 0 ${r1(2 * sr)} 0 a ${r1(sr)} ${r1(sr)} 0 1 0 ${r1(-2 * sr)} 0 Z`, sealC, { gloss: true });
    const fv = [hv, hv + dv[1] * flapL];
    parts.push({ bb: G.bb(-w / 2, Math.min(...fv) - 3, h + Math.min(0, dv[2]) * flapL, w / 2, Math.max(...fv) + 0.5, h + Math.max(0, dv[2]) * flapL), svg: flap.svg + seal });
    return {
      parts,
      under: o.acc > 0 ? [{ at: tip, rx: 60, ry: 60 }] : [],
      pins: { base: [0, 0, 0], center: [0, 4, h / 2], top: [0, 4, h + (o.hinge > 0.5 ? flapL * 0.9 : 0)], front: [0, 4, h * 0.3], hinge: [0, 5, h] },
      label: { at: [0, 4, h * 0.14], w: w - 40 },
      foot: [w, 20],
    };
  },

  box(G, o) {
    const tn = o.tone ?? kraft();
    const S = 168;
    const H = 132;
    const parts = [];
    const body = G.box(-S / 2, -S / 2, 0, S, S, H, tn, { radius: 8 });
    const tape = o.acc > 0 ? accHex(mixHex(tn.top, T['paper-lit'], 0.4), o.acc) : mixHex(tn.top, T['paper-lit'], 0.4);
    const hg = clamp(o.hinge, -0.1, 1.1);
    let topDecal = '';
    if (hg < 0.02) {
      // closed: the tape runs over the top and down the front
      topDecal = G.top(H, el('rect', { x: -16, y: -S / 2, width: 32, height: S, fill: tape, opacity: 0.95 }));
    } else {
      // open: the dark inside, seen through the top
      const ins = lin([[0, mixHex(tn.dark, T['shadow-warm'], 0.5)], [1, mixHex(tn.shade, tn.dark, 0.5)]], 0, 0, 1, 1);
      topDecal = G.top(H, [ins.def, el('rect', { x: -S / 2 + 4, y: -S / 2 + 4, width: S - 8, height: S - 8, rx: 4, fill: ins.paint })]);
    }
    const tapeFront = G.front(S / 2, H, el('rect', { x: -16, y: 0, width: 32, height: hg < 0.02 ? 44 : 0, fill: tape, opacity: 0.95 }));
    parts.push({ bb: body.bb, svg: body.svg + topDecal + tapeFront });
    // the four flaps, hinged on the top edges: closed they lie flat, open they lean out (≈ 125°)
    const ph = (hg * 125 * Math.PI) / 180;
    const c = Math.cos(ph);
    const sn = Math.sin(ph);
    const fl = S / 2 - 2;
    const flapFace = mixHex(tn.top, tn.base, 0.3);
    const flapIn = mixHex(tn.shade, tn.base, 0.4);
    const flaps = [
      // [hinge origin (top-left of the flap in plane coordinates), du (along the hinge), dv (out from the hinge)]
      { o: [-S / 2, -S / 2, H], du: [1, 0, 0], dv: [0, c, sn], w: S },
      { o: [S / 2, S / 2, H], du: [-1, 0, 0], dv: [0, -c, sn], w: S },
      { o: [-S / 2, S / 2, H], du: [0, -1, 0], dv: [c, 0, sn], w: S },
      { o: [S / 2, -S / 2, H], du: [0, 1, 0], dv: [-c, 0, sn], w: S },
    ];
    if (hg >= 0.02) {
      for (const f of flaps) {
        const far = f.o.map((v, i) => v + f.dv[i] * fl);
        const lo = f.o.map((v, i) => Math.min(v, f.o[i] + f.du[i] * f.w, far[i]));
        const hi = f.o.map((v, i) => Math.max(v, f.o[i] + f.du[i] * f.w, far[i]));
        const ex = extrude(G, `M 0 0 H ${f.w} V ${fl - 4} Q ${f.w} ${fl} ${f.w - 4} ${fl} H 4 Q 0 ${fl} 0 ${fl - 4} Z`, { o: f.o, du: f.du, dv: f.dv, depth: 3, tn, face: flapFace, backFace: flapIn, edge: tn.base, form: 0.4 });
        parts.push({ bb: G.bb(lo[0], lo[1], H, hi[0], hi[1], hi[2] + 2), svg: ex.svg });
      }
    }
    return {
      parts,
      under: o.acc > 0 ? [{ at: [0, 0, H], rx: 120, ry: 80 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, H / 2], top: [0, 0, H], front: [0, S / 2, H * 0.45], hinge: [0, 0, H] },
      label: { at: [0, S / 2, H * 0.42], w: S - 20 },
      foot: [S, S],
    };
  },

  key(G, o) {
    const tn = o.tone ?? brass();
    const bowC = o.acc > 0 ? accHex(tn.top, o.acc) : tn.top;
    const d = 12;
    // lying on its edge, teeth down: the bow (a ring) on the left, a long shaft, the bit on the right
    const bow = 'M -214 -50 a 50 50 0 1 0 100 0 a 50 50 0 1 0 -100 0 Z M -186 -50 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0 Z';
    const shaft = 'M -122 -62 H 160 Q 172 -62 172 -50 V -42 Q 172 -36 166 -36 H 160 V -6 Q 160 0 154 0 H 142 Q 136 0 136 -6 V -20 H 124 V -10 Q 124 -4 118 -4 H 108 Q 102 -4 102 -10 V -36 H -122 Z';
    const s1 = extrude(G, shaft, { o: [0, 6, 0], dv: [0, 0, -1], depth: d, tn, face: tn.top, edge: tn.base, form: 0.7 });
    const s2 = extrude(G, bow, { o: [0, 6, 0], dv: [0, 0, -1], depth: d, tn: o.acc > 0 ? accented(tn, o.acc) : tn, face: bowC, edge: tn.base, rule: 'evenodd' });
    return {
      parts: [{ bb: G.bb(-214, -8, 0, 172, 6, 100), svg: s1.svg + s2.svg }],
      under: o.acc > 0 ? [{ at: [-164, 6, 50], rx: 85, ry: 85 }] : [],
      pins: { base: [0, 0, 0], center: [-20, 6, 49], top: [-164, 6, 100], front: [0, 6, 49] },
      label: { at: [-2, 6, 49], w: 200 },
      foot: [330, 20],
    };
  },

  lock(G, o) {
    const tn = o.tone ?? brass();
    const bodyT = accented(tn, o.acc);
    const w = 140;
    const d = 64;
    const h = 120;
    const parts = [];
    // the shackle: up 0 → 1 lifts, then swings out about its left leg
    const hg = clamp(o.hinge, 0, 1.08);
    const lift = 38 * clamp01(hg * 2);
    const sw = ((100 * clamp01((hg - 0.5) * 2)) * Math.PI) / 180;
    const R = 44;
    const pts = [];
    const legL = -R;
    const P3 = (u, z) => [legL + (u - legL) * Math.cos(sw), (u - legL) * Math.sin(sw), z + lift];
    pts.push(P3(-R, h - 30));
    pts.push(P3(-R, h + 50));
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI - (Math.PI * k) / 12;
      pts.push(P3(R * Math.cos(a), h + 50 + R * Math.sin(a)));
    }
    pts.push(P3(R, h + 50));
    pts.push(P3(R, h - (hg > 0.02 ? -6 : 30)));
    parts.push({ bb: G.bb(-R - 10, -10, h - 30, R + 10, R * 2 * Math.sin(sw) + 10, h + 50 + R + lift + 10), svg: tube(G, pts, 20, silver()) });
    const body = G.box(-w / 2, -d / 2, 0, w, d, h, bodyT, { radius: 18, gloss: true });
    const hole = [
      el('circle', { cx: 0, cy: 38, r: 13, fill: T['ink-dark'] }),
      el('path', { d: 'M -6 42 L -9 70 Q -9 74 -5 74 H 5 Q 9 74 9 70 L 6 42 Z', fill: T['ink-dark'] }),
    ];
    parts.push({ bb: G.bb(-w / 2, -d / 2, 0, w / 2, d / 2, h), svg: body.svg + G.front(d / 2, h, hole) });
    return {
      parts,
      under: o.acc > 0 ? [{ at: [0, d / 2, h / 2], rx: 110, ry: 100 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, h / 2], top: [0, 0, h + 50 + R + lift], front: [0, d / 2, h * 0.5], hinge: [-R, 0, h + 50 + lift] },
      label: { at: [0, d / 2, 22], w: w - 10 },
      foot: [w, d],
    };
  },

  card(G, o) {
    const tn = o.tone ?? TONES.teal;
    const w = 220;
    const h = 140;
    const body = extrude(G, roundRect(0, 0, w, h, 14), { o: [-w / 2, 4, h], depth: 6, tn, face: mixHex(tn.top, tn.base, 0.4), edge: tn.top, form: 0.6 });
    const chipC = o.acc > 0 ? accHex(T['yellow-lit'], o.acc) : T['yellow-lit'];
    const cg = lin([[0, mixHex(chipC, WHITE, 0.35)], [1, mixHex(chipC, T['yellow-shade'], o.acc > 0 ? 0.2 : 0.6)]], 0, 0, 1, 1);
    const marks = [
      cg.def,
      el('rect', { x: 24, y: 30, width: 46, height: 36, rx: 7, fill: cg.paint }),
      el('path', { d: 'M 24 48 H 70 M 47 30 V 66 M 36 30 V 40 M 58 56 V 66', stroke: mixHex(chipC, T['yellow-dark'], 0.4), 'stroke-width': 2, fill: 'none', opacity: 0.7 }),
      el('rect', { x: 24, y: 84, width: 150, height: 10, rx: 5, fill: WHITE, opacity: 0.55 }),
      el('rect', { x: 24, y: 104, width: 88, height: 8, rx: 4, fill: WHITE, opacity: 0.4 }),
    ];
    return {
      parts: [{ bb: G.bb(-w / 2, -2, 0, w / 2, 4, h), svg: body.svg + g({ transform: body.plane }, marks) }],
      under: o.acc > 0 ? [{ at: [-w / 2 + 47, 4, h - 48], rx: 60, ry: 50 }] : [],
      pins: { base: [0, 0, 0], center: [0, 4, h / 2], top: [0, 4, h], front: [0, 4, h / 2] },
      label: { at: [20, 4, 26], w: w - 40 },
      foot: [w, 20],
    };
  },

  speaker(G, o) {
    const tn = o.tone ?? TONES.ink;
    const r = 74;
    const h = 196;
    const body = cyl(G, 0, 0, 0, h, r, tn, { rings: 0, gloss: true });
    // the fabric grille: rows of holes across the side that faces the viewer
    const dots = [];
    const mid = G.right ? (3 * Math.PI) / 4 : Math.PI / 4; // the side's angle toward the viewer
    for (let row = 0; row < 8; row++) {
      const z = 28 + row * 18;
      for (let k = -4; k <= 4; k++) {
        const a = mid + (k * Math.PI) / 11;
        const facing = Math.cos(a - mid);
        const [x, y] = G.L(r * Math.cos(a) * 0.985, r * Math.sin(a) * 0.985, z);
        dots.push(el('ellipse', { cx: r1(x), cy: r1(y), rx: r1(3.4 * G.s * facing), ry: r1(3.4 * G.s), fill: tn.dark, opacity: r3(0.75 * facing) }));
      }
    }
    // the light ring on top (the accent part)
    const c = G.P(0, 0, h);
    const circ = Array.from({ length: 36 }, (_, i) => G.P(r * 0.72 * Math.cos((i / 36) * 2 * Math.PI), r * 0.72 * Math.sin((i / 36) * 2 * Math.PI), h));
    const rx = (Math.max(...circ.map((q) => q[0])) - Math.min(...circ.map((q) => q[0]))) / 2;
    const ry = (Math.max(...circ.map((q) => q[1])) - Math.min(...circ.map((q) => q[1]))) / 2;
    const on = o.st !== 'off';
    const pulse = o.st === 'talking' ? 0.6 + 0.4 * Math.abs(Math.sin(o.t * 6)) : 1;
    const ringC = o.acc > 0 ? accHex(T['teal-lit'], o.acc) : on ? T['teal-lit'] : T['ink-lit'];
    const ring = [
      on || o.acc > 0 ? glowAt(c[0], c[1], rx * 1.15, Math.max(ry, rx * 0.4) * 1.15, ringC, 0.45 * pulse, 0.3) : '',
      el('path', { d: `M ${circ.map((q) => `${r1(q[0])} ${r1(q[1])}`).join(' L ')} Z`, fill: 'none', stroke: ringC, 'stroke-width': r1(7 * G.s), 'stroke-linejoin': 'round', opacity: r3(on || o.acc > 0 ? pulse : 0.9) }),
    ];
    // sound waves beside it while it talks (a mark, not a face)
    const waves = [];
    if (o.st === 'talking') {
      const side = G.L(r + 20, -r * 0.2, h * 0.62);
      for (let i = 0; i < 3; i++) {
        const ph = (o.t * 1.6 + i / 3) % 1;
        const rad = (26 + 70 * ph) * G.s;
        waves.push(el('path', { d: `M ${r1(side[0] + rad * 0.5)} ${r1(side[1] - rad * 0.85)} A ${r1(rad)} ${r1(rad)} 0 0 1 ${r1(side[0] + rad * 0.5)} ${r1(side[1] + rad * 0.85)}`, fill: 'none', stroke: isDark() ? T['paper-lit'] : T.ink, 'stroke-width': r1(5 * G.s), 'stroke-linecap': 'round', opacity: r3(0.5 * (1 - ph)) }));
      }
    }
    return {
      parts: [{ bb: body.bb, svg: body.svg + dots.join('') + ring.join('') }, { bb: G.bb(r, -r, h * 0.3, r + 120, r, h), svg: waves.join(''), decor: true }],
      under: o.acc > 0 ? [{ at: [0, 0, h], rx: 130, ry: 70 }] : [],
      pins: { base: [0, 0, 0], center: [0, 0, h / 2], top: [0, 0, h], front: [r * 0.707, r * 0.707, h * 0.42] },
      label: { at: [r * 0.707, r * 0.707, h * 0.36], w: 2 * r },
      foot: [2 * r, 2 * r],
      round: r,
    };
  },
};

/** Paint parts back to front: a part below, behind (smaller x or y) another draws first. */
function paint(parts) {
  const eps = 0.5;
  const before = (A, B) => {
    const a = A.bb;
    const b = B.bb;
    if (a[2] >= b[5] - eps && a[5] > b[5]) return false;
    if (b[2] >= a[5] - eps && b[5] > a[5]) return true;
    if (a[3] <= b[0] + eps) return true;
    if (b[3] <= a[0] + eps) return false;
    if (a[4] <= b[1] + eps) return true;
    if (b[4] <= a[1] + eps) return false;
    return a[0] + a[1] + a[3] + a[4] + (a[2] + a[5]) * 0.5 < b[0] + b[1] + b[3] + b[4] + (b[2] + b[5]) * 0.5;
  };
  const rest = parts.filter((p) => p && p.svg);
  const out = [];
  while (rest.length) {
    let pick = rest.findIndex((c) => !rest.some((r) => r !== c && before(r, c)));
    if (pick < 0) pick = 0;
    out.push(rest[pick].svg);
    rest.splice(pick, 1);
  }
  return out.join('');
}

// ── Labels on things ──────────────────────────────────────────────────────────────────────
/** A label on an object at screen (x, y): words on its lit display when they fit there, else a
 *  printed plate (ink on white, a soft shadow), ≥ READ_MIN, measured, a data-k="textbox". */
function labelOn(text, x, y, { size, screen, screenOn, acc, fit }) {
  const str = String(text);
  const sz = Math.max(READ_MIN, size);
  const tw = measure(str, sz, 'roboto-700');
  const out = [];
  // words fit a display seen in isometric when the line stays inside its parallelogram (vertical
  // sides, edges sloping 30°): within the width, and its corners within the height
  const fits = fit && tw <= fit.w * 0.86 && tw <= (fit.h * 0.95 - sz * 0.75) / 0.577;
  if (screen && fits) {
    const bg = acc > 0.5 ? T.orange : screenOn ? T['paper-lit'] : T.ink;
    const col = acc > 0.5 ? onColor(bg) : screenOn ? T.ink : T['paper-lit'];
    out.push(el('rect', { 'data-k': 'shape', x: r1(x - tw / 2 - 4), y: r1(y - sz * 0.62), width: r1(tw + 8), height: r1(sz * 1.24), fill: 'none' }));
    out.push(textEl(str, x, y + sz * 0.36, sz, { face: 'roboto-700', color: col, anchor: 'middle' }));
    return g({ 'data-k': 'textbox', 'data-ui': 'object-label' }, out);
  }
  const h = sz * 1.56;
  const w = tw + sz * 0.95;
  const bx = x - w / 2;
  const by = y - h / 2;
  const rr = h * 0.3;
  out.push(boxShadow(bx, by, w, h, rr, { dy: 6, blur: 14, spread: -2, color: T['shadow-warm'], opacity: isDark() ? 0.6 : 0.26 }));
  const pg = lin([[0, WHITE], [1, mixHex(T['paper-lit'], T.paper, 0.35)]]);
  out.push(pg.def, el('path', { d: roundRect(bx, by, w, h, rr), fill: pg.paint }));
  out.push(el('path', { d: roundRect(bx, by, w, h, rr), fill: 'none', stroke: T.ink, 'stroke-opacity': 0.1, 'stroke-width': 1.2 }));
  out.push(el('rect', { 'data-k': 'shape', x: r1(bx), y: r1(by), width: r1(w), height: r1(h), rx: r1(rr), fill: 'none' }));
  out.push(textEl(str, x, y + sz * 0.36, sz, { face: 'roboto-700', color: T.ink, anchor: 'middle' }));
  return g({ 'data-k': 'textbox', 'data-ui': 'object-label' }, out);
}

// ── Objects ───────────────────────────────────────────────────────────────────────────────
const isPt = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Each object's true size in cm and the model length (units) it measures, for world objects. */
const TRUE_CM = {
  laptop: [34, 236], phone: [15, 212], tablet: [25, 206], screen: [60, 270], server: [45, 262], rack: [200, 350],
  chip: [4, 176], database: [70, 178], router: [25, 210], cloud: [70, 300], document: [30, 212], folder: [32, 196],
  envelope: [22, 220], box: [40, 168], key: [6, 386], lock: [7, 214], card: [8.6, 220], speaker: [18, 196],
};
/** An object's real size in cm (its longest side), for world objects and the cheat. */
/**
 * Every device's named ports, in its model units: { at: [u, v, z], dir: outward [du, dv, dz] }. A
 * cable (connect.js) plugs into one by name, so both its ends are always seated in a socket.
 */
const PORTS = {
  laptop: { usb: { at: [118, 22, 7], dir: [1, 0, 0] }, usb2: { at: [118, 48, 7], dir: [1, 0, 0] }, usb_l: { at: [-118, 22, 7], dir: [-1, 0, 0] }, power: { at: [-118, 48, 7], dir: [-1, 0, 0] } },
  phone: { usb: { at: [0, 12, 5], dir: [0, 1, 0] } },
  tablet: { usb: { at: [103, -8, 60], dir: [1, 0, 0] } },
  screen: { hdmi: { at: [135, -14, 110], dir: [1, 0, 0] }, usb: { at: [135, -14, 150], dir: [1, 0, 0] }, power: { at: [-135, -14, 110], dir: [-1, 0, 0] } },
  server: { eth: { at: [0, 75, 40], dir: [0, 1, 0] }, eth2: { at: [30, 75, 40], dir: [0, 1, 0] }, power: { at: [-68, 0, 30], dir: [-1, 0, 0] } },
  rack: { eth: { at: [0, 75, 40], dir: [0, 1, 0] }, power: { at: [-90, 0, 30], dir: [-1, 0, 0] } },
  router: { eth: { at: [105, 0, 24], dir: [1, 0, 0] }, eth2: { at: [105, 30, 24], dir: [1, 0, 0] }, power: { at: [-105, 0, 24], dir: [-1, 0, 0] } },
  speaker: { usb: { at: [52, 52, 18], dir: [0.707, 0.707, 0] }, power: { at: [-52, -52, 18], dir: [-0.707, -0.707, 0] } },
  database: { eth: { at: [68, 68, 20], dir: [0.707, 0.707, 0] } },
  chip: { pcie: { at: [88, 0, 14], dir: [1, 0, 0] } },
};
/** Each device's port names (connect.js plugs cables into them). */
export const OBJECT_PORTS = Object.freeze(Object.fromEntries(Object.entries(PORTS).map(([k, v]) => [k, Object.freeze(Object.keys(v))])));
const portSize = (id) => (id === 'phone' || id === 'tablet' ? [10, 5] : [16, 7]);

export const OBJECT_CM = Object.freeze(Object.fromEntries(Object.entries(TRUE_CM).map(([k, v]) => [k, v[0]])));

const TONE_STEP = /-(lit|shade|dark)$/;
/** A body tone as the colour name an identity check compares: 'blue' for 'blue' or 'blue-shade',
 *  `mix(a,b)` for a mix, 'own' for the object's own tone. */
export function toneFamily(tone) {
  if (tone == null) return 'own';
  if (typeof tone === 'string') return tone.replace(TONE_STEP, '');
  if (tone && typeof tone === 'object' && Array.isArray(tone.mix)) return `mix(${tone.mix.slice(0, 2).map((m) => (typeof m === 'string' ? m.replace(TONE_STEP, '') : 'hex')).join(',')})`;
  return 'custom';
}

/** The options both kinds of object share, checked; returns the handle's common fields. */
function common(where, objId, opts, extra) {
  known(where, opts, ['size', 'accent', 'label', 'state', 'tone', 'facing', 'key', 'labelSize', 'concept', ...extra]);
  if (!LIB[objId]) throw new Error(`HX: no object "${objId}". Objects: ${OBJECT_IDS.join(', ')}.`);
  const spec = LIB[objId];
  const { accent = false, label = null, state = spec.states[0], tone = null, facing = 'left', concept = null } = opts;
  if (!(accent === true || accent === false || accent == null || (typeof accent === 'number' && accent >= 0 && accent <= 1))) throw new Error(`HX: ${where} accent is true, false or 0..1 (orange is the only accent colour).`);
  if (!spec.states.includes(state)) throw new Error(`HX: object "${objId}" has states ${spec.states.join(', ')}; got "${state}".`);
  if (!['left', 'right'].includes(facing)) throw new Error(`HX: object facing is 'left' or 'right' (got "${facing}").`);
  if (label != null && String(label).trim().split(/\s+/).length > 3) throw new Error(`HX: an object's label is 1–3 words ("${label}"): label directly on the thing, never a sentence.`);
  if (concept != null && !(typeof concept === 'string' && concept)) throw new Error(`HX: ${where} concept is an identity-map concept id.`);
  const acc = accent === true ? 1 : accent === false || accent == null ? 0 : clamp01(Number(accent));
  return {
    kind: 'object',
    id: objId,
    facing,
    label: label == null ? null : String(label),
    tone: tone == null ? null : bodyTones(tone),
    toneName: toneFamily(tone),
    concept,
    state,
    accent: acc,
    hinge0: spec.hinge ? (state === spec.hinge.closed ? 0 : 1) : 0,
  };
}
function addPin(obj) {
  obj.pin = (name) => {
    if (!PIN_NAMES.includes(name)) throw new Error(`HX: no pin "${name}". Pins: ${PIN_NAMES.join(', ')}.`);
    return { obj, pin: name };
  };
  obj.pose = (t = 0, segments = []) => poseAt(obj, t, segments);
  return obj;
}

/**
 * A real-world thing, standing with its base centre at screen `at` ([x, y]): for mechanism frames,
 * blend frames and flat overlays (the isometric table).
 *   size     scale (1 ≈ 240–340 px wide; cheat what the action depends on bigger)
 *   accent   true / 0..1: its accent part in orange (what to look at now); default off
 *   label    a short label on the thing (1–3 words), ≥ READ_MIN
 *   state    one of OBJECTS[id].states (default the first)
 *   tone     its body colour: a palette tone, never orange (default per object)
 *   facing   'left' (front to the lower left, default) or 'right'
 *   floor    the screen y of the surface it stands on (default at[1]): objectProblems flags it below
 *   key      its identity on the timeline (default `${id}@x,y`)
 *   labelSize  the label's size (default clamp(40 × size, 34, 52))
 *   concept  the identity-map concept it stands for (explain.js identity(); reg.object() sets it)
 * Returns a handle { id, key, at, size, pins (rest), box (rest), pin(name), draw(t, segments),
 * pose(t, segments), pinsAt(t, segments) } that also stringifies to its SVG at rest.
 */
export function object(objId, at, opts = {}) {
  const c = common('object()', objId, opts, ['floor']);
  if (!isPt(at)) throw new Error(`HX: object("${objId}", at): at is a screen point [x, y].`);
  const { size = 1, floor = null, key = null, labelSize = null } = opts;
  if (!(size > 0)) throw new Error(`HX: object("${objId}") size must be positive.`);
  const obj = addPin({
    ...c,
    space: 'screen',
    key: key ?? `${objId}@${Math.round(at[0])},${Math.round(at[1])}`,
    at: [at[0], at[1]],
    size,
    u: size,
    labelSize: Math.max(READ_MIN, labelSize ?? clamp(Math.round(40 * size), READ_MIN, 52)),
    floor: floor ?? at[1],
    rest: { x: at[0], y: at[1], lift: 0, rot: 0, sq: 0, dx: 0, hinge: c.hinge0, state: c.state, accent: c.accent, alpha: 1, scale: 1 },
  });
  obj.pinsAt = (t = 0, segments = []) => pinsAt(obj, t, segments);
  obj.draw = (t = 0, segments = []) => drawPosed(obj, poseAt(obj, t, segments)).svg;
  const restDrawn = drawPosed(obj, obj.rest);
  obj.pins = restDrawn.pins;
  obj.box = restDrawn.box;
  obj.toString = () => drawPosed(obj, obj.rest).svg;
  return obj;
}

/**
 * The same thing standing in a perspective world (lens.js, cm, z up) at `at` ([x, y] or [x, y, z],
 * its base centre on the floor or on a surface at height z): for world frames, an object hero in a
 * room. Drawn with lensObject(P, obj, { t, segments, rig }) as one of render()'s items: placed and
 * scaled by depth, turned three-quarters to the lens like a critter (`facing` picks which side shows),
 * lit by the shot's rig (night included) with its contact shadow and the shadows its lights cast.
 * `size` is its scale against its true size (OBJECT_CM; 1 = true, 'cheat' = cheated bigger so it
 * reads, or a number). Other options as object() (no `floor`: the world has its own). The verbs move
 * it through world positions (cm): hopTo(obj, [x, y]), slideTo, lookAt(obj, [x, y, z]), …
 */
export function worldObject(objId, at, opts = {}) {
  const c = common('worldObject()', objId, opts, []);
  if (!isPt(at)) throw new Error(`HX: worldObject("${objId}", at): at is a world point [x, y] or [x, y, z] in cm.`);
  const { size = 1, key = null, labelSize = null } = opts;
  const [cm, units] = TRUE_CM[objId];
  const f = propScale(size, cm);
  const obj = addPin({
    ...c,
    space: 'world',
    key: key ?? `${objId}@${Math.round(at[0])},${Math.round(at[1])},${Math.round(at[2] ?? 0)}`,
    at: [at[0], at[1], at[2] ?? 0],
    size: f,
    u: (cm / units) * f,
    cm: cm * f,
    labelSize: Math.max(READ_MIN, labelSize ?? 40),
    rest: { x: at[0], y: at[1], lift: 0, rot: 0, sq: 0, dx: 0, hinge: c.hinge0, state: c.state, accent: c.accent, alpha: 1, scale: 1 },
  });
  obj.lens = (P, o = {}) => lensObject(P, obj, o);
  obj.toString = () => {
    throw new Error('HX: a world object is drawn through the camera: lensObject(P, obj, { t, segments, rig }).');
  };
  return obj;
}

/**
 * A world object at t through the lens P, as a render() item: { id, at, bounds, svg, pins, box, dist }.
 * `id` is its key (a shot's cast names it), `at` its mid-height (cm), `bounds` its world box for the
 * paint order, `pins` its screen pins at t (hang a label, a courier or a camera target on them), `box`
 * its screen box. Options: t (frame time), segments (its moves), rig (the shot's lens.js rig; its
 * light, colour and shadows; a plain day studio when absent).
 */
export function lensObject(P, obj, o = {}) {
  const { t = 0, segments = [], rig = null } = known('lensObject()', o, ['t', 'segments', 'rig']);
  if (!isObj(obj) || obj.space !== 'world') throw new Error('HX: lensObject(P, obj): obj is a worldObject() (a screen object() is drawn as it is, or with play()).');
  if (typeof P !== 'function' || !Array.isArray(P.pos) || typeof P.scaleAt !== 'function') throw new Error('HX: lensObject(P, …): P is a lens.js lens().');
  const segs = flat(segments);
  const pose = poseAt(obj, t, segs);
  const d = drawPosed(obj, pose, { lens: { P, R: rig ?? lensRig(P) }, segments: segs, t });
  return { id: obj.key, at: d.at, bounds: d.bounds, svg: d.svg, pins: d.pins, box: d.box, dist: d.dist, ports: d.ports };
}

/** The puppet transform of a pose about the object's rest base (`at`). */
function poseMatrix(obj, pose) {
  const bx = pose.x + (pose.dx ?? 0);
  const by = pose.y - pose.lift;
  return pivotMatrix([obj.at[0], obj.at[1]], [bx, by], pose);
}
/** Squash (volume kept), scale and turn a drawing about the point `from`, then carry it to `to`:
 *  p' = to + R · S · (p − from). */
function pivotMatrix(from, to, pose) {
  const sq = clamp(pose.sq, -0.3, 0.26);
  const sy = (1 - sq) * (pose.scale ?? 1);
  const sx = (1 / (1 - sq)) * (pose.scale ?? 1);
  const th = (pose.rot * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const a = c * sx;
  const b = s * sx;
  const cc = -s * sy;
  const d = c * sy;
  return [a, b, cc, d, to[0] - a * from[0] - cc * from[1], to[1] - b * from[0] - d * from[1]];
}
const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/** A world object's frame on the floor at its pose: where it stands, how it is turned to the lens,
 *  and the screen scale there. */
function worldFrame(obj, pose, P) {
  const F = [pose.x, pose.y, obj.at[2]];
  let cx = P.pos[0] - F[0];
  let cy = P.pos[1] - F[1];
  if (Math.hypot(cx, cy) < 1e-6) [cx, cy] = [-P.fwd[0], -P.fwd[1]];
  const th = Math.atan2(cy, cx);
  // the iso table's +x shows to the screen right, +y to the left: the lens sees it as the kit does
  const X = [Math.cos(th + Math.PI / 4), Math.sin(th + Math.PI / 4)];
  const Y = [Math.cos(th - Math.PI / 4), Math.sin(th - Math.PI / 4)];
  const rh = Math.hypot(P.right[0], P.right[1]) || 1;
  const dx = pose.dx ?? 0;
  const B = [F[0] + (P.right[0] / rh) * dx, F[1] + (P.right[1] / rh) * dx, F[2] + Math.max(-1e9, pose.lift)];
  return { F, B, X, Y };
}

/** Draw an object in a pose. Returns { svg, pins, box } (and, through a lens, at, bounds, dist). */
function drawPosed(obj, pose, { courier = false, lens = null, segments = [], t = 0 } = {}) {
  const spec = LIB[obj.id];
  let G;
  let m;
  let wf = null;
  let ps = pose;
  if (lens) {
    const { P } = lens;
    wf = worldFrame(obj, pose, P);
    G = geo(null, P.scaleAt(...wf.B) * obj.u, obj.facing, { P, B: wf.B, X: wf.X, Y: wf.Y, k: obj.u, R: lensRig(P, { ground: 'paper' }) });
    // a look through the lens: the tilt toward where the target shows on screen, resolved now
    if (pose.lookK != null) {
      const cz = obj.at[2] + obj.cm * 0.5;
      const C = P(wf.F[0], wf.F[1], cz);
      const tiltOf = (tg) => {
        if (!tg) return [0, 0];
        const q = P(tg[0], tg[1], tg[2] ?? cz);
        const ddx = q[0] - C[0];
        const ddy = q[1] - C[1];
        const l = Math.hypot(ddx, ddy) || 1;
        return [clamp((ddx / l) * 11, -11, 11) * pose.lookAmt, clamp(ddy / l, -1, 1) * 0.045 * pose.lookAmt];
      };
      const [r0, q0] = tiltOf(pose.lookFrom);
      const [r1x, q1] = tiltOf(pose.lookTo);
      ps = { ...pose, rot: pose.rot + r0 + (r1x - r0) * pose.lookK, sq: pose.sq + q0 + (q1 - q0) * clamp01(pose.lookK) };
    }
    const bs = P(...wf.B);
    m = pivotMatrix([bs[0], bs[1]], [bs[0], bs[1]], ps);
  } else {
    G = geo(obj.at, obj.size, obj.facing);
    m = poseMatrix(obj, pose);
  }
  const st = spec.hinge && ps.hinge < 0.5 && ps.state !== spec.hinge.closed && obj.id === 'laptop' ? 'off' : ps.state;
  const model = M[obj.id](G, { st, hinge: ps.hinge, acc: clamp01(ps.accent), tone: obj.tone ?? DEFAULT_TONE[obj.id](), t: ps.t ?? 0, hasLabel: !!obj.label });
  const pins = {};
  for (const [name, p] of Object.entries(model.pins)) {
    const q = apply(m, G.L(p[0], p[1], p[2]));
    pins[name] = [r1(q[0]), r1(q[1])];
  }
  // a cylinder's front and label sit on its side nearest the viewer (the table's (+x, +y) side)
  if (model.round) {
    const r = model.round * 0.707;
    pins.front = apply(m, G.P(r, r, model.pins.front[2])).map(r1);
    model.label.screenAt = G.P(r, r, model.label.at[2]);
  }
  let body = paint(model.parts);
  // its ports: a dark socket on every face that is seen, and where each is (screen, and world through a lens)
  const ports = {};
  for (const [name, pt] of Object.entries(PORTS[obj.id] ?? {})) {
    const [u, v, z] = pt.at;
    const [du, dv, dz] = pt.dir;
    const q = apply(m, G.L(u, v, z));
    const q2 = apply(m, G.L(u + du * 20, v + dv * 20, z + dz * 20));
    const sl = Math.hypot(q2[0] - q[0], q2[1] - q[1]) || 1;
    const port = { screen: [r1(q[0]), r1(q[1])], sdir: [r3((q2[0] - q[0]) / sl), r3((q2[1] - q[1]) / sl)], scale: G.s };
    if (G.lz) {
      const [x, y] = G.W(u, v);
      const [wx, wy] = G.W(du, dv);
      port.at = G.P.toW(x, y, z).map(r1);
      const dw = [G.lz.X[0] * wx + G.lz.Y[0] * wy, G.lz.X[1] * wx + G.lz.Y[1] * wy, dz];
      const dl = Math.hypot(...dw) || 1;
      port.dir = dw.map((c) => r3(c / dl));
      port.k = G.lz.k;
    }
    ports[name] = port;
    const seen = du * G.view[0] + dv * G.view[1] + dz * G.view[2] > 0.05;
    if (seen && Math.abs(dz) < 0.5) {
      const [pw, ph] = portSize(obj.id);
      const n = Math.hypot(du, dv) || 1;
      body += g({ transform: G.plane([u, v, z], [dv / n, -du / n, 0], [0, 0, -1], [-pw / 2, -ph / 2, pw / 2, ph / 2]) }, el('path', { d: roundRect(-pw / 2, -ph / 2, pw, ph, 2), fill: TONES.ink.dark, opacity: 0.85, 'data-port': name }));
    }
  }
  const glows = (model.under ?? []).map((u) => {
    const c = G.L(...u.at);
    return glowAt(c[0], c[1], u.rx * G.s, u.ry * G.s, T['stage-orange'], 0.42 * clamp01(ps.accent), 0.42);
  });
  let lab = '';
  if (obj.label) {
    const la = model.label.screenAt ?? G.L(...model.label.at);
    const screen = !!model.label.screen;
    const fit = screen ? { w: model.label.w * 0.866 * G.s, h: (model.label.h ?? 0) * G.s } : null;
    lab = labelOn(obj.label, la[0], la[1], { size: obj.labelSize, screen, screenOn: st === 'on', acc: clamp01(ps.accent), fit });
  }
  // the drawing's extent (the parts' screen box), for layout and the frame checks
  const solid = model.parts.filter((p) => !p.decor).map((p) => p.bb);
  const ext = solid.reduce((acc, b) => {
    const pts = [[b[0], b[1], b[2]], [b[3], b[1], b[2]], [b[0], b[4], b[2]], [b[3], b[4], b[2]], [b[0], b[1], b[5]], [b[3], b[1], b[5]], [b[0], b[4], b[5]], [b[3], b[4], b[5]]].map((q) => G.P(q[0], q[1], q[2]));
    for (const q of pts) {
      acc[0] = Math.min(acc[0], q[0]);
      acc[1] = Math.min(acc[1], q[1]);
      acc[2] = Math.max(acc[2], q[0]);
      acc[3] = Math.max(acc[3], q[1]);
    }
    return acc;
  }, [Infinity, Infinity, -Infinity, -Infinity]);
  const box = { x: r1(ext[0]), y: r1(ext[1]), w: r1(ext[2] - ext[0]), h: r1(ext[3] - ext[1]) };
  const tf = `matrix(${m.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : r1(v))).join(' ')})`;
  const pinAttr = Object.entries(pins).filter(([n]) => n !== 'hinge' || spec.hinge).map(([n, p]) => `${n}:${p[0]},${p[1]}`).join(';');
  const attrs = {
    'data-object': obj.id,
    'data-key': obj.key,
    'data-state': ps.state,
    'data-facing': obj.facing,
    'data-accent': clamp01(ps.accent) > 0 ? r3(clamp01(ps.accent)) : undefined,
    'data-label': obj.label ? esc(obj.label) : undefined,
    'data-pins': pinAttr,
    'data-floor': undefined,
    'data-ports': Object.keys(ports).length ? Object.entries(ports).map(([n, p]) => `${n}:${p.screen[0]},${p.screen[1]}`).join(';') : undefined,
    'data-concept': obj.concept ?? undefined,
    'data-shape': obj.concept ? 'object' : undefined,
    'data-color': obj.concept ? obj.toneName : undefined,
    opacity: ps.alpha < 1 ? r3(clamp01(ps.alpha)) : undefined,
  };
  const outPins = Object.fromEntries(Object.entries(pins).filter(([n]) => n !== 'hinge' || spec.hinge));
  if (!lens) {
    // the contact shadow stays on the floor and shrinks as the object lifts
    const footW = (model.foot[0] + model.foot[1]) * 0.866 * obj.size * 0.5;
    const k = 1 / (1 + Math.max(0, pose.lift) / (150 * obj.size));
    const sk = (model.shadowK ?? 1) * k * (pose.scale ?? 1);
    const gx = pose.x + (pose.dx ?? 0);
    const shadowSvg = courier
      ? ''
      : shadow(gx - footW * 0.06, pose.y + footW * 0.06, footW * 0.92 * k, footW * 0.36 * k, 0.11 * sk * sk) + shadow(gx - footW * 0.02, pose.y + footW * 0.02, footW * 0.62 * k, footW * 0.2 * k, 0.16 * Math.pow(k, 4) * (model.shadowK ?? 1));
    attrs['data-floor'] = r1(obj.floor + (pose.y - obj.at[1]));
    const svg = g(attrs, [shadowSvg, g({ transform: tf }, [...glows, body, lab])]);
    return { svg, pins: outPins, box, matrix: m, ports };
  }
  // ── through the lens: shadows on the world's floor, lit by the shot's rig like a critter ──
  const { P, R } = lens;
  const k = obj.u;
  const height = Math.max(...solid.map((b) => b[5])) * k;
  const [fw, fd] = G.right ? [model.foot[1], model.foot[0]] : [model.foot[0], model.foot[1]];
  const corner = (a, b) => [wf.F[0] + (wf.X[0] * a * fw + wf.Y[0] * b * fd) * 0.5 * k, wf.F[1] + (wf.X[1] * a * fw + wf.Y[1] * b * fd) * 0.5 * k, wf.F[2]];
  const foot = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const kl = 1 / (1 + Math.max(0, pose.lift) / Math.max(20, height * 0.6));
  const shadows = contactShadow(P, foot, { level: (R.dark ? 0.7 : 0.3) * kl * kl * (model.shadowK ?? 1) }) + shadowsOf(P, foot, height, R, { dirLevel: 0.22 * kl, pointLevel: 0.6 * kl });
  const chest = [wf.F[0], wf.F[1], wf.F[2] + height * 0.55];
  const toCam = [P.pos[0] - chest[0], P.pos[1] - chest[1], 0];
  const tl = Math.hypot(toCam[0], toCam[1]) || 1;
  const L = lightAt(R, chest, [toCam[0] / tl, toCam[1] / tl, 0]);
  let side = 0;
  let src = null;
  for (const pl of R.points ?? []) {
    const I = irradiance(pl, chest);
    if (I > side) {
      side = I;
      src = pl;
    }
  }
  let tint = src ? src.color ?? 'warm' : null;
  let tintLevel = src ? Math.min(0.6, L.warm * 0.6 + side * 0.35) : 0;
  if (!tint) {
    const colored = (R.dirs ?? []).find((dd) => dd.color && dd.level > 0.02);
    if (colored) {
      tint = colored.color;
      tintLevel = Math.min(0.3, colored.level * 2);
    }
  }
  const gain = (L.k + L.warm * 1.6 + Math.min(0.4, side * 0.5)) / (0.42 + 0.4);
  body = lit(body, { gain: R.dark ? Math.max(gain, R.critterFill ?? 0.42) : Math.max(gain, 0.9), tint, tintLevel });
  // overlays of its own moves (shock marks, sparkles), in its screen space
  const marks = flat(segments)
    .filter((sg) => sg.overlay && sg.objRef && sg.objRef.key === obj.key)
    .map((sg) => sg.overlay(t, { segments, pinsAt: () => outPins, scaleOf: () => G.s }))
    .join('');
  attrs['data-floor'] = r1(P(...wf.F)[1]);
  const posed = [[ext[0], ext[1]], [ext[2], ext[1]], [ext[2], ext[3]], [ext[0], ext[3]]].map((q) => apply(m, q));
  const pbox = [Math.min(...posed.map((q) => q[0])), Math.min(...posed.map((q) => q[1])), Math.max(...posed.map((q) => q[0])), Math.max(...posed.map((q) => q[1]))];
  const at = [wf.F[0], wf.F[1], wf.F[2] + height / 2];
  const dist = P.dist(...at);
  const inner = g(attrs, [shadows, g({ transform: tf }, [...glows, body, lab]), marks]);
  const svg = g({ 'data-frame-kind': 'entity', 'data-frame-who': obj.key, 'data-frame-box': pbox.map((v) => r1(v)).join(' '), 'data-frame-depth': r1(dist) }, inner);
  const xs = foot.map((q) => q[0]);
  const ys = foot.map((q) => q[1]);
  const bounds = [[Math.min(...xs), Math.min(...ys), wf.F[2]], [Math.max(...xs), Math.max(...ys), wf.F[2] + height]];
  return { svg, pins: outPins, box: { x: r1(pbox[0]), y: r1(pbox[1]), w: r1(pbox[2] - pbox[0]), h: r1(pbox[3] - pbox[1]) }, matrix: m, at, bounds, dist, ports };
}

// ── Segments and the timeline ─────────────────────────────────────────────────────────────
const isObj = (o) => o && o.kind === 'object' && typeof o.key === 'string';
function needObj(verb, obj) {
  if (!isObj(obj)) throw new Error(`HX: ${verb}(obj, …) needs an object made by object().`);
}
/** A segment: a slot on the frame's clock. */
function segment(verb, at, dur, fields) {
  if (!(dur > 0)) throw new Error(`HX: ${verb}: dur must be positive.`);
  if (!(at >= 0)) throw new Error(`HX: ${verb}: at must be ≥ 0 (seconds into the frame).`);
  const seg = {
    kind: 'segment',
    verb,
    at,
    dur,
    end: at + dur,
    persistent: false,
    targets: [],
    events: [],
    apply: null,
    overlay: null,
    ...fields,
  };
  seg.gsap = (tl, render) => {
    const clock = { t: seg.at };
    tl.fromTo(clock, { t: seg.at }, { t: seg.end, duration: seg.end - seg.at, ease: 'none', onUpdate: () => render(clock.t) }, seg.at);
    return tl;
  };
  return seg;
}
const flat = (segs) => (Array.isArray(segs) ? segs.flat(Infinity) : segs ? [segs] : []).filter((s) => s && s.kind === 'segment');
const heavy = (obj) => LIB[obj.id].mass === 'heavy';

/** An object's pose at t under the segments (persistent ones first, then the transient deltas). */
export function poseAt(obj, t, segments = []) {
  needObj('poseAt', obj);
  const list = flat(segments).filter((s) => s.targets.includes(obj.key) && s.apply);
  const ordered = [...list.filter((s) => s.persistent), ...list.filter((s) => !s.persistent)].sort((a, b) => (a.persistent === b.persistent ? a.at - b.at : a.persistent ? -1 : 1));
  let pose = { ...obj.rest, t };
  for (const s of ordered) if (t >= s.at) pose = s.apply(obj, t, pose) ?? pose;
  return pose;
}
/** An object's pins ({ base, center, top, front, hinge? }, screen px) at t under the segments. */
/** A screen object's ports at t: { name: { screen, sdir } }, for connect.js screenCable. */
export function portsAt(obj, t, segments = []) {
  if (obj?.space === 'world') throw new Error('HX: a world object\'s ports depend on the camera: lensObject(P, obj, { t, segments }).ports.');
  return drawPosed(obj, poseAt(obj, t, segments)).ports;
}
export function pinsAt(obj, t, segments = []) {
  if (obj?.space === 'world') throw new Error('HX: a world object\'s pins depend on the camera: lensObject(P, obj, { t, segments }).pins.');
  return drawPosed(obj, poseAt(obj, t, segments)).pins;
}
const isWorld = (o) => o?.space === 'world';
/** A distance in pose units as the screen px it reads like at size 1 (for durations by distance). */
const pxEq = (obj, d) => (isWorld(obj) ? d / obj.u : d);

/** A target as a screen point at t: a point, an object (its pin `fallback`), or obj.pin(name). */
function pointOf(target, t, segments, fallback = 'front') {
  if (isPt(target)) return [target[0], target[1]];
  if (isWorld(target) || isWorld(target?.obj)) throw new Error('HX: a world object is a target only for a world object\'s move (in cm); a courier travels on screen: give it lensObject(P, obj).pins.');
  if (isObj(target)) return pinsAt(target, t, segments)[fallback] ?? pinsAt(target, t, segments).center;
  if (target && isObj(target.obj)) return pinsAt(target.obj, t, segments)[target.pin] ?? pinsAt(target.obj, t, segments).center;
  throw new Error('HX: a target is a screen point [x, y], an object, or obj.pin(name).');
}

/** Where a move goes: a screen object's [x, y] (or another object's base pin); a world object's
 *  [x, y] in cm (or another world object's spot). */
function floorTarget(obj, to) {
  if (isWorld(obj)) {
    if (isPt(to)) return [to[0], to[1]];
    if (isWorld(to)) return [to.at[0], to.at[1]];
    throw new Error('HX: a world object moves to a world point [x, y] (cm) or another world object.');
  }
  return pointOf(to, 0, [], 'base');
}

/**
 * hopTo(obj, to, { at, dur, height }): a hop to a new floor point `to` ([x, y] or a pin): anticipation
 * (a crouch and a lean back), take-off stretch, a parabolic arc leaning into the travel, a landing
 * squash and a settle (follow-through); the contact shadow shrinks while it is in the air. Heavy
 * things hop lower and slower and land with an impact. Volume is kept (sx · sy = 1).
 */
export function hopTo(obj, to, o = {}) {
  needObj('hopTo', obj);
  const { at = 0, dur = null, height = null } = known('hopTo', o, ['at', 'dur', 'height']);
  const end = floorTarget(obj, to);
  const k = heavy(obj) ? 0.75 : 1;
  const est = pxEq(obj, Math.hypot(end[0] - obj.at[0], end[1] - obj.at[1]));
  const D = dur ?? clamp((0.5 + est / 900) * (heavy(obj) ? 1.15 : 1), 0.55, 1.3);
  const land = at + D * 0.78;
  const seg = segment('hopTo', at, D, {
    persistent: true,
    targets: [obj.key],
    objRef: obj,
    to: end,
    events: [
      ...(est > 160 ? [{ t: r3(at + D * 0.22), kind: 'whoosh' }] : []),
      heavy(obj) ? { t: r3(land), kind: 'impact' } : { t: r3(land), kind: 'foley', what: 'drop' },
    ],
    apply(_o, t, p) {
      const u = clamp01((t - at) / D);
      const x0 = p.x;
      const y0 = p.y;
      const dist = Math.hypot(end[0] - x0, end[1] - y0);
      const dir = Math.abs(end[0] - x0) < 1 ? 0 : Math.sign(end[0] - x0);
      const H = height ?? (isWorld(obj) ? clamp(dist * 0.4, 60 * obj.u, 220 * obj.u) * k : clamp(dist * 0.4, 60, 220) * k * obj.size);
      const q = { ...p };
      if (u >= 1) {
        q.x = end[0];
        q.y = end[1];
        return q;
      }
      let sq = 0;
      let rot = 0;
      let lift = 0;
      let pos = 0;
      if (u < 0.2) {
        sq = 0.18 * k * span(u, 0, 0.17, ease.out);
        rot = -dir * 4 * span(u, 0, 0.2, ease.out);
      } else if (u < 0.78) {
        const pf = (u - 0.2) / 0.58;
        pos = 0.6 * pf + 0.4 * ease.inOut(pf);
        lift = 4 * H * pf * (1 - pf);
        const launch = span(u, 0.2, 0.27, ease.out);
        const stretch = -0.14 * Math.pow(Math.abs(2 * pf - 1), 0.7);
        sq = lerp(0.18 * k, stretch, launch);
        rot = lerp(-dir * 4, dir * 7 * Math.sin(Math.PI * pf), launch);
      } else {
        pos = 1;
        const tau = (u - 0.78) * D;
        const peak = 0.22 * k;
        sq = tau < 0.06 ? peak * span(tau, 0, 0.06, ease.out) : wave(tau - 0.06, peak, 1.9, 7.5);
        rot = wave(tau, dir * 5, 1.6, 6);
      }
      q.x = lerp(x0, end[0], pos);
      q.y = lerp(y0, end[1], pos);
      q.lift = p.lift + lift;
      q.sq = p.sq + sq;
      q.rot = p.rot + rot;
      return q;
    },
  });
  return seg;
}

/**
 * slideTo(obj, to, { at, dur }): pushed along the floor to `to`: a small counter-lean first, the top
 * lags as it accelerates and runs on as it brakes (follow-through), then settles. Eased in and out.
 */
export function slideTo(obj, to, o = {}) {
  needObj('slideTo', obj);
  const { at = 0, dur = null } = known('slideTo', o, ['at', 'dur']);
  const end = floorTarget(obj, to);
  const est = pxEq(obj, Math.hypot(end[0] - obj.at[0], end[1] - obj.at[1]));
  const D = dur ?? clamp((0.45 + est / 800) * (heavy(obj) ? 1.2 : 1), 0.5, 1.5);
  const acc = (u) => {
    const h = 0.002;
    return (ease.inOut(clamp01(u + h)) - 2 * ease.inOut(u) + ease.inOut(clamp01(u - h))) / (h * h);
  };
  return segment('slideTo', at, D, {
    persistent: true,
    targets: [obj.key],
    objRef: obj,
    to: end,
    events: [{ t: r3(at + D * 0.15), kind: 'foley', what: heavy(obj) ? 'shove' : 'slide', dur: r3(D * 0.7) }],
    apply(_o, t, p) {
      const u = clamp01((t - at) / D);
      const dir = Math.abs(end[0] - p.x) < 1 ? 0 : Math.sign(end[0] - p.x);
      const q = { ...p };
      if (u >= 1) {
        q.x = end[0];
        q.y = end[1];
        return q;
      }
      let pos = 0;
      let rot = 0;
      let sq = 0;
      if (u < 0.15) {
        rot = -dir * 3.5 * span(u, 0, 0.15, ease.out);
        sq = 0.06 * span(u, 0, 0.15, ease.out);
      } else if (u < 0.85) {
        const pf = (u - 0.15) / 0.7;
        pos = ease.inOut(pf);
        rot = -dir * 3.5 * (1 - span(u, 0.15, 0.3)) - dir * 7 * (acc(pf) / 12);
        sq = 0.06 * (1 - span(u, 0.15, 0.3));
      } else {
        pos = 1;
        const tau = (u - 0.85) * D;
        rot = dir * 8 * Math.exp(-5 * tau) * Math.sin(2 * Math.PI * 1.4 * tau);
        sq = wave(tau, 0.04, 2, 8) * (1 - Math.exp(-40 * tau));
      }
      q.x = lerp(p.x, end[0], pos);
      q.y = lerp(p.y, end[1], pos);
      q.rot = p.rot + rot;
      q.sq = p.sq + sq;
      return q;
    },
  });
}

/**
 * lookAt(obj, target, { at, dur, amount }): the object tilts toward `target` (a point, an object or a
 * pin; null turns it back upright) and holds there: a beat of thought (a small counter-tilt) before
 * it turns, an overshoot and a settle. It rises a touch toward something above it and dips toward
 * something below. Never a face: the tilt is the look.
 */
export function lookAt(obj, target, o = {}) {
  needObj('lookAt', obj);
  const { at = 0, dur = 0.6, amount = 1 } = known('lookAt', o, ['at', 'dur', 'amount']);
  if (isWorld(obj)) {
    let tw = null;
    if (target != null) {
      if (isPt(target)) tw = [target[0], target[1], target[2] ?? obj.at[2] + obj.cm * 0.5];
      else if (isWorld(target)) tw = [target.at[0], target.at[1], target.at[2] + target.cm * 0.5];
      else throw new Error('HX: a world object looks at a world point [x, y, z] (cm), another world object, or null.');
    }
    return segment('lookAt', at, dur, {
      persistent: true,
      targets: [obj.key],
      objRef: obj,
      target,
      events: [],
      apply(_o, t, p) {
        const u = clamp01((t - at) / dur);
        let kk;
        if (u < 0.25) kk = -0.2 * span(u, 0, 0.25, ease.out);
        else if (u < 0.8) kk = lerp(-0.2, 1.15, span(u, 0.25, 0.8, ease.inOut));
        else kk = 1 + wave((u - 0.8) * dur, 0.15, 1.3, 9);
        if (u >= 1) kk = 1;
        // the tilt is resolved where the lens shows the target (lensObject)
        return { ...p, lookFrom: p.lookTo ?? null, lookTo: tw, lookK: kk, lookAmt: amount };
      },
    });
  }
  let tilt = 0;
  let lean = 0;
  if (target != null) {
    const tp = pointOf(target, at, [], 'center');
    const c = obj.pins.center;
    const dx = tp[0] - c[0];
    const dy = tp[1] - c[1];
    const len = Math.hypot(dx, dy) || 1;
    tilt = clamp((dx / len) * 11, -11, 11) * amount;
    lean = clamp(dy / len, -1, 1) * 0.045 * amount;
  }
  return segment('lookAt', at, dur, {
    persistent: true,
    targets: [obj.key],
    objRef: obj,
    target,
    events: [],
    apply(_o, t, p) {
      const u = clamp01((t - at) / dur);
      const q = { ...p };
      const from = p.look ?? 0;
      const fromSq = p.lookSq ?? 0;
      let k;
      if (u < 0.25) k = -0.2 * span(u, 0, 0.25, ease.out);
      else if (u < 0.8) k = lerp(-0.2, 1.15, span(u, 0.25, 0.8, ease.inOut));
      else k = 1 + wave((u - 0.8) * dur, 0.15, 1.3, 9);
      if (u >= 1) k = 1;
      const look = from + (tilt - from) * k;
      const lsq = fromSq + (lean - fromSq) * clamp01(k);
      q.rot = p.rot - from + look;
      q.sq = p.sq - fromSq + lsq;
      q.look = look;
      q.lookSq = lsq;
      return q;
    },
  });
}

/** The front direction's screen sign: a nod tips the top toward the front. */
const frontSign = (obj) => (obj.facing === 'right' ? 1 : -1);

/**
 * react(obj, kind, { at, dur }): a motion reaction, never a face. 'surprised' (a startle: a jump
 * with shock marks), 'proud' (rises tall, a glint, settles), 'worried' (cowers and trembles), 'no'
 * (a firm shake), 'yes' (two happy bounces). Each has anticipation, squash and stretch with the
 * volume kept, easing, follow-through and a settle.
 */
export function react(obj, kind, o = {}) {
  needObj('react', obj);
  if (!REACTIONS.includes(kind)) throw new Error(`HX: react(obj, "${kind}"): an object reacts through motion alone: ${REACTIONS.join(', ')}. Objects never get a face.`);
  const { at = 0, dur = null } = known('react', o, ['at', 'dur']);
  const z = obj.u;
  const D = dur ?? { surprised: 0.8, proud: 1.1, worried: 1.2, no: 0.9, yes: 0.9 }[kind];
  const lean = obj.facing === 'right' ? -1 : 1;
  const ev = {
    surprised: [{ t: r3(at + D * 0.12), kind: 'pop' }, { t: r3(at + D * 0.68), kind: 'foley', what: 'drop' }],
    proud: [{ t: r3(at + D * 0.36), kind: 'pop' }],
    worried: [{ t: r3(at + D * 0.15), kind: 'foley', what: 'creak', dur: r3(D * 0.7) }],
    no: [{ t: r3(at + D * 0.14), kind: 'whoosh' }],
    yes: [{ t: r3(at + D * 0.1), kind: 'pop' }, { t: r3(at + D * 0.44), kind: 'tick' }, { t: r3(at + D * 0.78), kind: 'tick' }],
  }[kind];
  const bounce = (u, a, b, hgt, sqPeak) => {
    // one bounce in [a, b]: crouch, rise stretched, fall, land squashed
    const w = b - a;
    const v = (u - a) / w;
    if (v < 0 || v > 1) return { lift: 0, sq: 0 };
    if (v < 0.2) return { lift: 0, sq: sqPeak * span(v, 0, 0.2, ease.out) };
    if (v < 0.82) {
      const pf = (v - 0.2) / 0.62;
      return { lift: 4 * hgt * pf * (1 - pf), sq: lerp(sqPeak, -0.13 * Math.pow(Math.abs(2 * pf - 1), 0.7), span(v, 0.2, 0.28, ease.out)) };
    }
    return { lift: 0, sq: sqPeak * 1.1 * Math.sin(Math.PI * span(v, 0.82, 1, ease.sine)) };
  };
  return segment('react', at, D, {
    targets: [obj.key],
    objRef: obj,
    reaction: kind,
    events: ev,
    apply(_o, t, p) {
      const u = (t - at) / D;
      if (u < 0 || u > 1) return p;
      const q = { ...p };
      let sq = 0;
      let lift = 0;
      let rot = 0;
      let dx = 0;
      if (kind === 'surprised') {
        if (u < 0.12) sq = 0.14 * span(u, 0, 0.12, ease.out);
        else if (u < 0.68) {
          const up = span(u, 0.12, 0.36, ease.out);
          const down = span(u, 0.55, 0.68, ease.in);
          lift = 48 * z * (up - down);
          sq = lerp(0.14, -0.17, span(u, 0.12, 0.2, ease.out)) * (1 - span(u, 0.3, 0.5)) + -0.05 * span(u, 0.3, 0.5) * (1 - down) + -0.12 * down;
        } else {
          const tau = (u - 0.68) * D;
          sq = lerp(-0.12, wave(tau, 0.16, 2, 7), Math.min(1, tau * 25)) * (1 - span(u, 0.86, 1));
        }
      } else if (kind === 'proud') {
        if (u < 0.12) sq = 0.06 * span(u, 0, 0.12, ease.out);
        else if (u < 0.78) {
          const rise = span(u, 0.12, 0.4, ease.out);
          sq = lerp(0.06, -0.14, rise) + 0.01 * Math.sin((u - 0.4) * 14) * span(u, 0.4, 0.5);
          rot = 1.5 * lean * rise;
        } else {
          const rel = span(u, 0.78, 0.9, ease.inOut);
          sq = lerp(-0.13, 0.04, rel) * (u < 0.9 ? 1 : 0) + (u >= 0.9 ? wave((u - 0.9) * D, 0.04, 2, 8) : 0);
          rot = 1.5 * lean * (1 - rel);
        }
      } else if (kind === 'worried') {
        const env = span(u, 0, 0.18, ease.out) * (1 - span(u, 0.85, 1, ease.inOut));
        sq = 0.13 * env;
        rot = 4 * lean * env + 1.4 * Math.sin((t - at) * 2 * Math.PI * 11 + 1) * span(u, 0.15, 0.3) * (1 - span(u, 0.8, 0.9));
        dx = 3 * z * Math.sin((t - at) * 2 * Math.PI * 14) * span(u, 0.15, 0.3) * (1 - span(u, 0.8, 0.9));
      } else if (kind === 'no') {
        if (u < 0.12) sq = 0.06 * span(u, 0, 0.12, ease.out);
        else if (u < 0.88) {
          const pf = (u - 0.12) / 0.76;
          rot = 10 * Math.exp(-1.6 * pf) * Math.sin(2 * Math.PI * 2.5 * pf) * span(pf, 0, 0.12, ease.out);
          sq = 0.06 * (1 - span(u, 0.12, 0.3)) + 0.03 * span(u, 0.12, 0.3);
        } else {
          rot = 0;
          sq = 0.03 * (1 - span(u, 0.88, 1, ease.out));
        }
      } else if (kind === 'yes') {
        const b1 = bounce(u, 0, 0.48, 34 * z, 0.12);
        const b2 = bounce(u, 0.48, 0.86, 18 * z, 0.09);
        lift = b1.lift + b2.lift;
        sq = b1.sq + b2.sq;
        if (u > 0.86) sq = wave((u - 0.86) * D, 0.05, 2, 9) * Math.min(1, (u - 0.86) * D * 30);
      }
      q.sq = p.sq + sq;
      q.lift = p.lift + lift;
      q.rot = p.rot + rot;
      q.dx = (p.dx ?? 0) + dx;
      return q;
    },
    overlay(t, ctx) {
      const u = (t - at) / D;
      if (u <= 0 || u >= 1) return '';
      const pins = ctx.pinsAt(obj, t);
      const z = ctx.scaleOf ? ctx.scaleOf(obj) : obj.size;
      if (kind === 'surprised' && u > 0.12 && u < 0.7) {
        const v = (u - 0.12) / 0.58;
        const [x, y] = pins.top;
        // startle marks: short strokes that shoot out above it and fade (a mark, never a face)
        const grow = Math.min(1, v / 0.25);
        const fade = 1 - Math.max(0, (v - 0.65) / 0.35);
        const k = Math.max(0.8, z);
        const rays = [[-0.95, -0.45], [-0.45, -1], [0.45, -1], [0.95, -0.45]];
        return g({ 'data-mark': 'shock', opacity: r3(fade) }, rays.map(([dx, dy]) => {
          const x0 = x + dx * 34 * k;
          const y0 = y - 10 * k + dy * 30 * k;
          const len = 30 * k * grow;
          return el('path', { d: `M ${r1(x0)} ${r1(y0)} L ${r1(x0 + dx * len)} ${r1(y0 + dy * len)}`, stroke: isDark() ? T['paper-lit'] : T.ink, 'stroke-width': r1(7 * k), 'stroke-linecap': 'round', fill: 'none' });
        }));
      }
      if (kind === 'proud' && u > 0.3 && u < 0.9) {
        const [x, y] = pins.top;
        const star = (cx, cy, rr, ph) => {
          const v = clamp01((u - ph) / 0.12) * (1 - span(u, 0.72, 0.9));
          if (v <= 0) return '';
          const R = rr * v * Math.max(0.8, z);
          return g({ 'data-mark': 'sparkle' }, [
            glowAt(cx, cy, R * 1.8, R * 1.8, T.yellow, 0.55 * v, 0.4),
            el('path', { d: `M ${r1(cx)} ${r1(cy - R)} Q ${r1(cx)} ${r1(cy)} ${r1(cx + R)} ${r1(cy)} Q ${r1(cx)} ${r1(cy)} ${r1(cx)} ${r1(cy + R)} Q ${r1(cx)} ${r1(cy)} ${r1(cx - R)} ${r1(cy)} Q ${r1(cx)} ${r1(cy)} ${r1(cx)} ${r1(cy - R)} Z`, fill: T.yellow }),
            el('path', { d: `M ${r1(cx)} ${r1(cy - R * 0.55)} Q ${r1(cx)} ${r1(cy)} ${r1(cx + R * 0.55)} ${r1(cy)} Q ${r1(cx)} ${r1(cy)} ${r1(cx)} ${r1(cy + R * 0.55)} Q ${r1(cx)} ${r1(cy)} ${r1(cx - R * 0.55)} ${r1(cy)} Q ${r1(cx)} ${r1(cy)} ${r1(cx)} ${r1(cy - R * 0.55)} Z`, fill: WHITE, opacity: 0.85 }),
          ]);
        };
        return star(x + 74 * z, y - 6 * z, 36, 0.34) + star(x + 26 * z, y - 62 * z, 24, 0.46) + star(x - 62 * z, y - 24 * z, 18, 0.56);
      }
      return '';
    },
  });
}

/** nod(obj, { at, times, dur }): the top tips toward the front and back, smaller each time, settling. */
export function nod(obj, o = {}) {
  needObj('nod', obj);
  const { at = 0, times = 2, dur = null } = known('nod', o, ['at', 'times', 'dur']);
  const n = clamp(Math.round(times), 1, 4);
  const D = dur ?? 0.36 * n + 0.25;
  const fs = frontSign(obj);
  return segment('nod', at, D, {
    targets: [obj.key],
    objRef: obj,
    events: Array.from({ length: n }, (_, i) => ({ t: r3(at + (i + 0.5) * ((D - 0.25) / n)), kind: 'tick' })),
    apply(_o, t, p) {
      const u = (t - at) / D;
      if (u < 0 || u > 1) return p;
      const q = { ...p };
      const body = (D - 0.25) / D;
      let sq = 0;
      let rot = 0;
      if (u < body) {
        const pf = u / body;
        const i = Math.min(n - 1, Math.floor(pf * n));
        const v = pf * n - i;
        const amp = Math.pow(0.6, i);
        const dip = Math.sin(Math.PI * ease.sine(v));
        sq = 0.1 * amp * dip;
        rot = fs * 6 * amp * dip;
      } else {
        const tau = (u - body) * D;
        rot = wave(tau, fs * -1.2, 2, 9) * Math.min(1, tau * 30);
      }
      q.sq = p.sq + sq;
      q.rot = p.rot + rot;
      return q;
    },
  });
}

/** shake(obj, { at, times, dur }): side to side about its base, smaller each swing, then settles. */
export function shake(obj, o = {}) {
  needObj('shake', obj);
  const { at = 0, times = 3, dur = null } = known('shake', o, ['at', 'times', 'dur']);
  const n = clamp(Math.round(times), 2, 5);
  const D = dur ?? 0.2 * n + 0.3;
  return segment('shake', at, D, {
    targets: [obj.key],
    objRef: obj,
    events: [{ t: r3(at + 0.1), kind: 'whoosh' }],
    apply(_o, t, p) {
      const u = (t - at) / D;
      if (u < 0 || u > 1) return p;
      const q = { ...p };
      let rot = 0;
      let sq = 0;
      if (u < 0.1) sq = 0.05 * span(u, 0, 0.1, ease.out);
      else {
        const pf = (u - 0.1) / 0.9;
        rot = 9 * Math.exp(-2.2 * pf) * Math.sin(2 * Math.PI * (n / 2) * pf) * (1 - span(pf, 0.85, 1));
        sq = 0.05 * (1 - span(u, 0.1, 0.3));
      }
      q.rot = p.rot + rot;
      q.sq = p.sq + sq;
      return q;
    },
  });
}

function hingeVerb(name, obj, open, o) {
  needObj(name, obj);
  const spec = LIB[obj.id];
  if (!spec.hinge) throw new Error(`HX: ${name}: "${obj.id}" has no hinge. Hinged objects: ${OBJECT_IDS.filter((k) => LIB[k].hinge).join(', ')}.`);
  const { at = 0, dur = open ? 0.6 : 0.45, state = open ? spec.hinge.open : spec.hinge.closed } = known(name, o, ['at', 'dur', 'state']);
  if (!spec.states.includes(state)) throw new Error(`HX: ${name}: "${obj.id}" has states ${spec.states.join(', ')}; got "${state}".`);
  const snd = spec.hinge.sound[open ? 0 : 1];
  const ev = snd ? [snd.startsWith('foley:') ? { t: r3(at + dur * (open ? 0.2 : 0.6)), kind: 'foley', what: snd.slice(6) } : { t: r3(at + dur * (open ? 0.2 : 0.6)), kind: snd }] : [];
  return segment(name, at, dur, {
    persistent: true,
    targets: [obj.key],
    objRef: obj,
    events: ev,
    apply(_o, t, p) {
      const u = clamp01((t - at) / dur);
      const q = { ...p };
      const from = p.hinge;
      const to = open ? 1 : 0;
      let h;
      let sq = 0;
      if (open) {
        if (u < 0.15) {
          h = from - 0.05 * span(u, 0, 0.15, ease.out);
          sq = 0.04 * span(u, 0, 0.15, ease.out);
        } else if (u < 0.72) {
          h = lerp(from - 0.05, to + 0.07, span(u, 0.15, 0.72, ease.out));
          sq = 0.04 * (1 - span(u, 0.15, 0.3));
        } else {
          const tau = (u - 0.72) * dur;
          h = to + wave(tau, 0.07, 1.8, 8);
          sq = wave(tau, -0.03, 2, 9);
        }
      } else if (u < 0.15) {
        h = from + 0.05 * span(u, 0, 0.15, ease.out);
      } else if (u < 0.6) {
        h = lerp(from + 0.05, to, span(u, 0.15, 0.6, ease.in));
      } else {
        const tau = (u - 0.6) * dur;
        h = to;
        sq = wave(tau, 0.1, 2.2, 9) * Math.min(1, tau * 40);
      }
      if (u >= 1) {
        h = to;
        sq = 0;
      }
      q.hinge = h;
      q.sq = p.sq + sq;
      if (u >= 1 || (open ? u >= 0.3 : u >= 0.6)) q.state = state;
      return q;
    },
  });
}
/** openHinge(obj, { at, dur, state }): lid, flap, cover or shackle opens: a tiny press first, an
 *  ease-out swing past open, a settle back (follow-through), a small recoil of the body. */
export const openHinge = (obj, o = {}) => hingeVerb('openHinge', obj, true, o);
/** closeHinge(obj, { at, dur, state }): a lift first, then it swings shut accelerating, and the body
 *  takes the impact and settles. */
export const closeHinge = (obj, o = {}) => hingeVerb('closeHinge', obj, false, o);

/** settle(obj, { at, amount }): the object takes a hit (something lands on or in it) and settles:
 *  a quick squash, a smaller stretch back, still. */
export function settle(obj, o = {}) {
  needObj('settle', obj);
  const { at = 0, amount = 1, dur = 0.55 } = known('settle', o, ['at', 'amount', 'dur']);
  return segment('settle', at, dur, {
    targets: [obj.key],
    objRef: obj,
    events: [],
    apply(_o, t, p) {
      const tau = t - at;
      if (tau < 0 || tau > dur) return p;
      const q = { ...p };
      q.sq = p.sq + wave(tau, 0.14 * amount, 2.3, 7.5) * Math.min(1, tau * 30) * (1 - span(tau, dur * 0.8, dur));
      return q;
    },
  });
}

/** breathe(obj, { at, dur, amount, period }): a moving hold: the faintest rise and fall (volume kept)
 *  and sway, so a held object never looks dead. Eases in and out over 0.4s. */
export function breathe(obj, o = {}) {
  needObj('breathe', obj);
  const { at = 0, dur = 6, amount = 1, period = 2.6 } = known('breathe', o, ['at', 'dur', 'amount', 'period']);
  return segment('breathe', at, dur, {
    targets: [obj.key],
    objRef: obj,
    events: [],
    apply(_o, t, p) {
      const tau = t - at;
      if (tau < 0 || tau > dur) return p;
      const env = Math.min(1, tau / 0.4, (dur - tau) / 0.4);
      const q = { ...p };
      q.sq = p.sq - 0.018 * amount * env * Math.sin((2 * Math.PI * tau) / period);
      q.rot = p.rot + 0.35 * amount * env * Math.sin((Math.PI * tau) / period + 0.7);
      return q;
    },
  });
}

/** setState(obj, state, { at, sound }): the object switches state at `at` (a screen lights, a box
 *  shows open); a click by default (every state flip gets a sound). */
export function setState(obj, state, o = {}) {
  needObj('setState', obj);
  const { at = 0, sound = 'click' } = known('setState', o, ['at', 'sound']);
  if (!LIB[obj.id].states.includes(state)) throw new Error(`HX: setState: "${obj.id}" has states ${LIB[obj.id].states.join(', ')}; got "${state}".`);
  return segment('setState', at, 0.05, {
    persistent: true,
    targets: [obj.key],
    objRef: obj,
    state,
    events: sound ? [{ t: r3(at), kind: sound }] : [],
    apply(_o, t, p) {
      if (t < at) return p;
      const q = { ...p, state };
      const sp = LIB[obj.id].hinge;
      if (sp) q.hinge = state === sp.closed ? 0 : 1;
      return q;
    },
  });
}

/** setAccent(obj, level, { at, dur }): its accent part eases to orange (1) or back (0): orange marks
 *  what to look at now, so it moves with the voice. */
export function setAccent(obj, level = 1, o = {}) {
  needObj('setAccent', obj);
  const { at = 0, dur = 0.3 } = known('setAccent', o, ['at', 'dur']);
  const to = level === true ? 1 : level === false ? 0 : clamp01(Number(level));
  return segment('setAccent', at, dur, {
    persistent: true,
    targets: [obj.key],
    objRef: obj,
    events: [],
    apply(_o, t, p) {
      const u = clamp01((t - at) / dur);
      return { ...p, accent: lerp(p.accent, to, ease.out(u)) };
    },
  });
}

// ── The courier ───────────────────────────────────────────────────────────────────────────
/** Arc-length samples of a quadratic arc from a to b bowed by `arc` × distance (positive bows up). */
function arcOf(a, b, arc) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.hypot(dx, dy) || 1;
  // the bow goes up the screen: the perpendicular with the negative y (or to the right when level)
  let nx = -dy / dist;
  let ny = dx / dist;
  if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const c = [(a[0] + b[0]) / 2 + nx * 2 * arc * dist, (a[1] + b[1]) / 2 + ny * 2 * arc * dist];
  const q = (s) => [(1 - s) * (1 - s) * a[0] + 2 * (1 - s) * s * c[0] + s * s * b[0], (1 - s) * (1 - s) * a[1] + 2 * (1 - s) * s * c[1] + s * s * b[1]];
  const N = 48;
  const pts = [];
  const len = [0];
  for (let i = 0; i <= N; i++) pts.push(q(i / N));
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[N] || 1;
  const at = (u) => {
    const L = clamp01(u) * total;
    let i = 1;
    while (i < N && len[i] < L) i++;
    const k = (L - len[i - 1]) / (len[i] - len[i - 1] || 1);
    const p = [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
    return { p, tan: [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]] };
  };
  const path = (u0, u1) => {
    const n = Math.max(2, Math.ceil(Math.abs(u1 - u0) * 40));
    const list = [];
    for (let i = 0; i <= n; i++) list.push(at(lerp(u0, u1, i / n)).p);
    return `M ${list.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L ')}`;
  };
  return { at, path, total };
}

/** The request tag: a glossy orange (or paper) ticket with an arrow and its label. */
function requestTag(label, { acc, st }) {
  const size = 38;
  const str = label ? String(label) : '';
  const tw = str ? measure(str, size, 'roboto-700') : 0;
  const h = 70;
  const w = Math.max(96, tw + 96);
  const x0 = -w / 2;
  const y0 = -h;
  const bodyC = acc ? T.orange : T['paper-lit'];
  const out = [];
  out.push(boxShadow(x0, y0, w, h, 22, { dy: 10, blur: 18, spread: -4, color: acc ? T['orange-shade'] : T['shadow-warm'], opacity: acc ? 0.45 : 0.25 }));
  const body = acc ? lin([[0, T['orange-lit']], [0.6, T.orange], [1, mixHex(T.orange, T['stage-red'], 0.4)]], 0.3, 0, 0.7, 1) : lin([[0, WHITE], [1, T['paper-lit']]]);
  out.push(body.def, el('path', { d: roundRect(x0, y0, w, h, 22), fill: body.paint }));
  const hl = lin([[0, WHITE, acc ? 0.55 : 0.9], [0.4, WHITE, 0], [1, WHITE, 0]]);
  out.push(hl.def, el('path', { d: roundRect(x0 + 1, y0 + 1, w - 2, h - 2, 21), fill: 'none', stroke: hl.paint, 'stroke-width': 1.6 }));
  const ink = acc ? T.ink : T.ink;
  // the arrow: where it is going
  const ax = x0 + 34;
  out.push(el('path', { d: `M ${ax - 12} ${y0 + h / 2} H ${ax + 10} M ${ax + 1} ${y0 + h / 2 - 10} L ${ax + 11} ${y0 + h / 2} L ${ax + 1} ${y0 + h / 2 + 10}`, fill: 'none', stroke: ink, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (str) {
    out.push(g({ 'data-k': 'textbox', 'data-ui': 'courier-label' }, [
      el('rect', { 'data-k': 'shape', x: r1(ax + 18), y: r1(y0 + h / 2 - size * 0.62), width: r1(tw + 8), height: r1(size * 1.24), fill: 'none' }),
      textEl(str, ax + 22, y0 + h / 2 + size * 0.36, size, { face: 'roboto-700', color: ink }),
    ]));
  }
  return { svg: out.join('') + badge(st, w / 2 - 10, y0 + 8), w, h };
}

/** The universal arrival states: a ✓ (status success) or an ✕ (status error) badge. */
function badge(st, x, y) {
  if (st !== 'ok' && st !== 'error') return '';
  const c = st === 'ok' ? T['status-success'] : T['status-error'];
  const glyph = st === 'ok' ? `M ${x - 9} ${y} L ${x - 2} ${y + 7} L ${x + 10} ${y - 7}` : `M ${x - 7} ${y - 7} L ${x + 7} ${y + 7} M ${x + 7} ${y - 7} L ${x - 7} ${y + 7}`;
  return g({ 'data-mark': `badge-${st}` }, [
    boxShadow(x - 20, y - 20, 40, 40, 20, { dy: 4, blur: 8, color: c, opacity: 0.4 }),
    el('circle', { cx: r1(x), cy: r1(y), r: 20, fill: c }),
    el('circle', { cx: r1(x), cy: r1(y), r: 19, fill: 'none', stroke: WHITE, 'stroke-opacity': 0.5, 'stroke-width': 1.5 }),
    el('path', { d: glyph, fill: 'none', stroke: WHITE, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ]);
}

const COURIER_OBJECT = { file: 'document', message: 'envelope', packet: 'box' };
const ARRIVE_SOUND = { request: { kind: 'pop' }, packet: { kind: 'foley', what: 'cardboard box' }, file: { kind: 'foley', what: 'paper drop' }, message: { kind: 'foley', what: 'envelope' } };

/**
 * courier(kind, from, to, { at, dur, label, state, startState, arc, keep, arrive, bump, accent,
 * tone, size, trail }): the travelling element. `kind` is 'request' (a tag), 'packet' (a small parcel),
 * 'file' (a page), 'message' (an envelope), or any OBJECTS id drawn small (a key, a card…).
 * `from`/`to`: points, objects (their top pin) or obj.pin(name), followed as they move; it rides
 * with its bottom centre on the path, so it sits on what it lands on. It pops in
 * at `at`, pulls back (anticipation), rides an arc (`arc` × the distance bows it up; 0 a straight
 * track) eased in and out, stretching along its path with speed and leaning into it, lands with a
 * squash and settle in `state` (an arrival state: 'ok' / 'error' badges, or the object's own state),
 * nudges what it lands on (`bump`), switches it to `arrive` (a state of the destination), and is
 * absorbed, or stays parked there with `keep`. It wears its own tone (a paper tag; a carried object
 * in its own or the given `tone`); `accent: true` makes it orange, only when it is what to look at
 * now and nothing else in the shot is orange.
 */
export function courier(kind, from, to, o = {}) {
  const { at = 0, dur = 1.1, label = null, state = null, startState = null, arc = 0.22, keep = false, arrive = null, bump = true, accent = false, tone = null, size = null, trail = true } = known('courier', o, ['at', 'dur', 'label', 'state', 'startState', 'arc', 'keep', 'arrive', 'bump', 'accent', 'tone', 'size', 'trail']);
  for (const end of [from, to]) if (isWorld(end) || isWorld(end?.obj)) throw new Error('HX: a courier travels on screen; in a world frame give it screen points (lensObject(P, obj).pins).');
  const objId = kind === 'request' ? null : COURIER_OBJECT[kind] ?? (LIB[kind] ? kind : undefined);
  if (tone != null && !objId) throw new Error('HX: courier tone: a request tag is paper (or orange with accent: true); tone is for a carried object.');
  if (objId === undefined) throw new Error(`HX: courier kind "${kind}": ${COURIER_KINDS.join(', ')} or an object id (${OBJECT_IDS.join(', ')}).`);
  if (!(dur >= 0.4)) throw new Error('HX: courier dur must be ≥ 0.4s (it needs time to read).');
  if (label != null && String(label).trim().split(/\s+/).length > 3) throw new Error(`HX: a courier's label is 1–3 words ("${label}").`);
  const universal = ['ok', 'error'];
  const objStates = objId ? LIB[objId].states : ['out'];
  for (const s of [state, startState]) if (s != null && !universal.includes(s) && !objStates.includes(s)) throw new Error(`HX: courier "${kind}" states: ${[...objStates, ...universal].join(', ')} (got "${s}").`);
  const toObj = isObj(to) ? to : to && isObj(to.obj) ? to.obj : null;
  if (arrive != null) {
    if (!toObj) throw new Error('HX: courier arrive: needs `to` to be an object (its state switches on arrival).');
    if (!LIB[toObj.id].states.includes(arrive)) throw new Error(`HX: courier arrive: "${toObj.id}" has states ${LIB[toObj.id].states.join(', ')}; got "${arrive}".`);
  }
  const T0 = at;
  const tFly = at + 0.24;
  const tLand = at + dur;
  const end = tLand + (keep ? 0.22 : 0.44);
  const csize = size ?? (objId === 'box' ? 0.45 : objId ? 0.6 : 1);
  const carried = objId ? object(objId, [0, 0], { size: csize, label, tone, state: startState && !universal.includes(startState) ? startState : LIB[objId].states[0], accent: accent ? 1 : 0, key: `courier:${kind}@${at}` }) : null;
  const arrivedObjState = state && !universal.includes(state) ? state : null;
  const badgeState = state && universal.includes(state) ? state : null;
  const startBadge = startState && universal.includes(startState) ? startState : null;
  const snd = ARRIVE_SOUND[kind] ?? { kind: 'foley', what: 'place' };
  const seg = segment('courier', at, end - at, {
    targets: [...(toObj && (bump || arrive) ? [toObj.key] : [])],
    courier: kind,
    from,
    to,
    events: [{ t: r3(T0), kind: 'pop' }, ...(dur > 0.7 ? [{ t: r3(tFly), kind: 'whoosh' }] : []), { t: r3(tLand), ...snd }],
    apply(obj, t, p) {
      if (!toObj || obj.key !== toObj.key || t < tLand) return p;
      const q = { ...p };
      if (arrive) q.state = arrive;
      if (bump) {
        const tau = t - tLand;
        if (tau < 0.55) q.sq = p.sq + wave(tau, 0.1 * (heavy(obj) ? 0.65 : 1), 2.3, 7.5) * Math.min(1, tau * 30);
      }
      return q;
    },
    overlay(t, ctx) {
      if (t < T0 || (!keep && t > end)) return '';
      // the ends are followed while they move: the start until launch, the end until landing
      // (and after it, when the courier stays parked there)
      const a = pointOf(from, Math.min(t, tFly), ctx.segments, 'top');
      const b = pointOf(to, t < tLand ? clamp(t, tFly, tLand) : keep ? t : tLand, ctx.segments, 'top');
      const A = arcOf(a, b, arc);
      let pos;
      let rot = 0;
      let sx = 1;
      let sy = 1;
      let scale = 1;
      let alpha = 1;
      const landed = t >= tLand;
      const st = landed ? badgeState ?? startBadge : startBadge;
      const objState = carried ? (landed && arrivedObjState ? arrivedObjState : carried.rest.state) : null;
      let u = 0;
      if (t < tFly) {
        // it pops in (a small overshoot), then pulls back against the way it will go (anticipation)
        const pin = clamp01((t - T0) / 0.14);
        const x = pin - 1;
        scale = pin >= 1 ? 1 : Math.max(0, 1 + 2.7 * x * x * x + 1.7 * x * x);
        const back = span(t, T0 + 0.14, tFly, ease.out);
        const tan = A.at(0).tan;
        const tl = Math.hypot(tan[0], tan[1]) || 1;
        pos = [a[0] - (tan[0] / tl) * 14 * back, a[1] - (tan[1] / tl) * 14 * back];
        sy = 1 - 0.1 * back;
        sx = 1 / sy;
      } else if (!landed) {
        const pf = (t - tFly) / (tLand - tFly);
        u = ease.inOut(pf);
        const q = A.at(u);
        pos = q.p;
        // it leans into the arc (half the path's slope, never upside down) and stretches with speed
        const deg = (Math.atan(q.tan[1] / (Math.abs(q.tan[0]) < 1e-6 ? 1e-6 : q.tan[0])) * 180) / Math.PI;
        rot = clamp(deg * 0.35, -12, 12);
        const h = 0.01;
        const speed = ((ease.inOut(clamp01(pf + h)) - ease.inOut(clamp01(pf - h))) / (2 * h)) * (A.total / (tLand - tFly));
        const k = 1 + Math.min(0.15, Math.abs(speed) / 6000);
        sx = k;
        sy = 1 / k;
      } else {
        pos = b;
        const tau = t - tLand;
        const k = wave(tau, 0.16, 2.2, 9) * Math.min(1, tau * 40);
        sy = 1 - k;
        sx = 1 / sy;
        if (!keep && tau > 0.22) {
          const v = span(tau, 0.22, 0.44, ease.in);
          scale = 1 - 0.45 * v;
          alpha = 1 - v;
        }
      }
      const parts = [];
      if (trail && t >= tFly && t <= tLand + 0.4) {
        const fade = landed ? 1 - span(t, tLand, tLand + 0.4) : 1;
        const u1 = landed ? 1 : u;
        if (u1 > 0.02 && fade > 0) {
          parts.push(el('path', { 'data-mark': 'trail', d: A.path(0, u1), fill: 'none', stroke: isDark() ? T['paper-lit'] : T.ink, 'stroke-opacity': r3(0.3 * fade), 'stroke-width': 5, 'stroke-dasharray': '0.5 14', 'stroke-linecap': 'round' }));
        }
      }
      // the courier rides with its bottom centre on the path: it sits on what it lands on
      let body;
      if (carried) {
        const d = drawPosed(carried, { ...carried.rest, state: objState, accent: accent ? 1 : 0, t }, { courier: true });
        body = d.svg + badge(st, d.box.x + d.box.w - 6, d.box.y + 10);
      } else body = requestTag(label, { acc: accent, st }).svg;
      const tf = `translate(${r1(pos[0])} ${r1(pos[1])}) rotate(${r1(rot)}) scale(${r3(sx * scale)} ${r3(sy * scale)})`;
      parts.push(g({ transform: tf, opacity: alpha < 1 ? r3(clamp01(alpha)) : undefined }, body));
      return g({ 'data-courier': kind, 'data-state': st ?? objState ?? 'out' }, parts);
    },
  });
  return seg;
}

// ── Play: one frame's objects and couriers at t ──────────────────────────────────────────
/** Every object posed at t (back to front by their floor line), then the couriers and marks.
 *  `objects` lists objects with no segment of their own (they draw at rest); the rest are found in
 *  the segments. Returns one SVG string. */
export function play(t, segments = [], objects = []) {
  const segs = flat(segments);
  const seen = new Map();
  for (const o of [...objects].flat()) if (isObj(o)) seen.set(o.key, o);
  for (const s of segs) for (const k of ['obj', 'to', 'from', 'target']) {
    const v = s[k];
    if (isObj(v)) seen.set(v.key, v);
    else if (v && isObj(v.obj)) seen.set(v.obj.key, v.obj);
  }
  // the verbs keep their object: find it through the segment's targets
  for (const s of segs) if (s.objRef) seen.set(s.objRef.key, s.objRef);
  // world objects are drawn through the camera (lensObject), not here
  const list = [...seen.values()].filter((o) => !o.key.startsWith('courier:') && !isWorld(o));
  const posed = list.map((o) => ({ o, pose: poseAt(o, t, segs) })).sort((a, b) => a.pose.y - b.pose.y);
  const ctx = { segments: segs, pinsAt: (o, tt) => pinsAt(o, tt, segs) };
  const out = posed.map(({ o, pose }) => drawPosed(o, pose).svg);
  for (const s of segs) if (s.overlay && !isWorld(s.objRef)) out.push(s.overlay(t, ctx));
  return out.join('');
}

/** The sound events of the segments, sorted, for the frame's events.json ({ t, kind, what?, dur? }). */
export function soundEvents(segments) {
  return flat(segments).flatMap((s) => s.events).filter(Boolean).sort((a, b) => a.t - b.t).map((e) => ({ ...e }));
}

// ── The breakage check ────────────────────────────────────────────────────────────────────
const ID = [1, 0, 0, 1, 0, 0];
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
/** An SVG transform attribute as a matrix. */
export function parseTransform(s) {
  let m = ID;
  if (!s) return m;
  for (const f of String(s).matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = f[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let n = ID;
    if (f[1] === 'matrix' && a.length === 6) n = a;
    else if (f[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (f[1] === 'scale') n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
    else if (f[1] === 'rotate') {
      const th = ((a[0] || 0) * Math.PI) / 180;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      n = [c, sn, -sn, c, 0, 0];
      if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (f[1] === 'skewX') n = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (f[1] === 'skewY') n = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

/**
 * The breakage check for objects (try.mjs, F): in a frame's samples ([{ t, svg }], or SVG strings),
 * every drawn object (data-object) is checked, mapped through the transforms around it (a camera
 * push included):
 *   - a pin out of frame (base, center, top, front, hinge outside 0–1080 × 0–1920) while it is
 *     held still; one moving across the edge (its pins change from the next or previous sample) is fine;
 *   - an object below its floor line (its base under the surface it stands on);
 *   - a face on an object (anything with data-face, data-who, data-eyes or data-mood inside it).
 * Returns problem strings (empty when clean). Breakage only: taste is the picture check's.
 */
export function objectProblems(samples) {
  const list = Array.isArray(samples) ? samples : [samples];
  const out = new Set();
  const parsed = [];
  for (const s of list) {
    const svg = typeof s === 'string' ? s : String(s?.svg ?? '');
    const when = s && typeof s === 'object' && s.t != null ? `t=${Number(s.t).toFixed(2)}s: ` : '';
    const stack = [ID];
    const objs = [];
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
      const [, close, , attrs, self] = m;
      if (close) {
        if (stack.length > 1) stack.pop();
        for (const o of objs) if (o.open && o.depth > stack.length) o.open = false;
        continue;
      }
      const parent = stack[stack.length - 1];
      const tf = attrs.match(/\btransform="([^"]*)"/);
      const here = tf ? mul(parent, parseTransform(tf[1])) : parent;
      const isFace = /\bdata-(face|who|eyes|mood)="/.test(attrs);
      if (isFace) for (const o of objs) if (o.open) o.face = true;
      if (/\bdata-object="/.test(attrs)) {
        const get = (k) => attrs.match(new RegExp(`\\bdata-${k}="([^"]*)"`))?.[1];
        const pins = {};
        let baseX = null;
        for (const part of (get('pins') ?? '').split(';').filter(Boolean)) {
          const [name, xy] = part.split(':');
          const [x, y] = xy.split(',').map(Number);
          pins[name] = apply(parent, [x, y]);
          if (name === 'base') baseX = x;
        }
        const floorY = Number(get('floor'));
        const floorPt = baseX != null && Number.isFinite(floorY) ? apply(parent, [baseX, floorY]) : null;
        // its pins and floor are in its parent's space; anything inside it is "on" it
        objs.push({ id: get('object'), key: get('key'), zoom: Math.sqrt(Math.abs(parent[0] * parent[3] - parent[1] * parent[2])), label: get('label'), pins, floorPt, open: !self, depth: stack.length + 1, face: isFace });
      }
      if (!self) stack.push(here);
    }
    parsed.push({ when, objs });
  }
  // an object in motion (its pins change from the sample before or after: a slide, a hop, a
  // courier entering or leaving) may cross the frame edge on purpose; a held one may not
  const keyed = parsed.map(({ objs }) => new Map(objs.filter((o) => o.key).map((o) => [o.key, o])));
  const moved = (a, b) => !!a && !!b && Object.keys(a.pins).some((n) => b.pins[n] && Math.hypot(a.pins[n][0] - b.pins[n][0], a.pins[n][1] - b.pins[n][1]) > 1);
  parsed.forEach(({ when, objs }, i) => {
    for (const o of objs) {
      // a camera pushed in (a crop shot) frames something else and cuts the rest on purpose
      const cropped = o.zoom > 1.05;
      const moving = cropped || !!o.key && (moved(o, keyed[i - 1]?.get(o.key)) || moved(o, keyed[i + 1]?.get(o.key)));
      const name = `${o.id}${o.label ? ` "${o.label}"` : ''}`;
      for (const [pin, p] of Object.entries(o.pins)) {
        if (!moving && !(p[0] >= 0 && p[0] <= FRAME.w && p[1] >= 0 && p[1] <= FRAME.h)) out.add(`${when}${name}: its ${pin} pin (${Math.round(p[0])}, ${Math.round(p[1])}) is out of frame`);
      }
      if (o.floorPt && o.pins.base && o.pins.base[1] > o.floorPt[1] + 2) out.add(`${when}${name}: sinks ${Math.round(o.pins.base[1] - o.floorPt[1])}px below its floor line`);
      if (o.face) out.add(`${when}${name}: has a face (objects never get a face; they act through motion alone)`);
    }
  });
  return [...out];
}
