// The Explainers world kit, lens (hx-4.1; approved still 13 "depth & camera"): a perspective camera
// in the same centimetre world as space.js (x, y on the floor, z up), and the soft-3D solids,
// critters and light drawn through it. This is how depth is made: the camera moves through a 3D
// room, so near things sweep past and far things barely move (parallax), and each thing blurs by
// its real distance from the focus (depth of field). Never fixed-speed layers, and never on the
// isometric camera, which is orthographic and has no near or far (motion.js refuses it).
//
//   lens({ pos, target, fov, roll })         P(x, y, z) → [sx, sy, depth]; P.scaleAt, P.dist, …
//   worldAt(P, sx, sy, z)                    the world point at height z under a screen pixel
//   cameraAt(t, start, moves)                a camera keyframed over t: push, dolly, truck, crane,
//                                            pan, tilt, orbit, zoom, to (eased with E.world)
//   rig({ ground, ambient, key, dirs, points })   the lights of a shot (every one has a source)
//   box · obox · cylinder · sphere · quad · faceArt · openBox · hinge   soft solids through the lens
//   critterAt(P, x, y, z, opts, rig)         a critter billboard at its feet, true 72 cm, lit;
//                                            its hands, handsWorld and held props (insertCamera)
//   floorShadow(P, worldPoly) · contactShadow(P, footprint) · shadowsOf(P, footprint, h, rig)
//   dofBlur(dist, focus) · render(P, { env, items, focus })   distance order and depth of field
//
// A thing on screen is a pure function of the camera and the world at time t.

import * as core from './core.js';
import { T, TONES, el, g, id, isDark, roundedPath, tonesOf } from './draw.js';
import { blurDef, hashId, V3, irradiance, lightColor, untag, lit, castShadow } from './light.js';
import { E } from './motion.js';
import { critter, BODY_D, handAt, heldBoxes, gripAt } from './cast.js';

const { add, sub, mul, dot, cross, norm, len } = V3;
const n2 = (v) => Number(v.toFixed(2));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const WORLD_UP = [0, 0, 1];

export const CRITTER_CM = core.CRITTER_CM ?? 72;
export const CRITTER_PX = core.CRITTER_PX ?? 142;

// ── The lens ──────────────────────────────────────────────────────────────────────────────

/**
 * A perspective camera at `pos` looking at `target` (world cm, z up), `fov` the vertical field of
 * view in degrees, `roll` in degrees. Returns P(x, y, z) → [sx, sy, depth] (depth: cm along the
 * view axis; points closer than `near` are held at `near`). P also has scaleAt(x, y, z) (screen
 * px per cm there), dist(x, y, z) (cm from the lens), facing(point, normal), pos, target, fov,
 * focal, fwd, right, up, w, h and key (the default key light direction, toward the light: above,
 * to the camera's right and a little in front, so solids light from the top right as the kit's
 * LIGHT does). The camera never looks straight down (use the isometric kit for that).
 */
export function lens({ pos, target, fov = 37, roll = 0, w = 1080, h = 1920, cx = w / 2, cy = h / 2, near = 5 } = {}) {
  if (!pos || !target) throw new Error('lens: pos and target (world cm) are required');
  const fwd = norm(sub(target, pos));
  if (Math.abs(fwd[2]) > 0.995) throw new Error('lens: the camera looks straight up or down; tilt it');
  let right = norm(cross(fwd, WORLD_UP));
  let up = cross(right, fwd);
  if (roll) {
    const a = (roll * Math.PI) / 180;
    const r2 = add(mul(right, Math.cos(a)), mul(up, Math.sin(a)));
    up = add(mul(up, Math.cos(a)), mul(right, -Math.sin(a)));
    right = r2;
  }
  const focal = h / 2 / Math.tan((fov / 2) * (Math.PI / 180));
  const P = (x, y, z = 0) => {
    const d = [x - pos[0], y - pos[1], z - pos[2]];
    const zc = Math.max(near, dot(d, fwd));
    return [cx + (dot(d, right) * focal) / zc, cy - (dot(d, up) * focal) / zc, zc];
  };
  P.pos = pos;
  P.target = target;
  P.fov = fov;
  P.roll = roll;
  P.focal = focal;
  P.cx = cx;
  P.cy = cy;
  P.fwd = fwd;
  P.right = right;
  P.up = up;
  P.w = w;
  P.h = h;
  P.near = near;
  P.scaleAt = (x, y, z = 0) => focal / Math.max(near, dot([x - pos[0], y - pos[1], z - pos[2]], fwd));
  P.dist = (x, y, z = 0) => len([x - pos[0], y - pos[1], z - pos[2]]);
  P.facing = (p, n) => dot(n, sub(pos, p)) > 0;
  P.key = norm(add(add(mul(right, 0.5), mul(WORLD_UP, 0.72)), mul(fwd, -0.42)));
  return P;
}

/**
 * The world point on the plane at height z that the lens P shows at screen (sx, sy): the exact
 * intersection of the ray from the lens through that pixel with the plane (no solver, so it is
 * stable right up to the lens). For placing by eye: a critter's feet at a screen spot, a
 * foreground piece just inside the frame's bottom edge. Throws when the ray never meets the plane
 * in front of the lens (a point above the horizon of a floor, or below a ceiling).
 * @param {(x: number, y: number, z?: number) => number[]} P  a lens()
 * @returns {[number, number, number]}
 */
export function worldAt(P, sx, sy, z = 0) {
  const cx = P.cx ?? P.w / 2;
  const cy = P.cy ?? P.h / 2;
  const dir = add(add(P.fwd, mul(P.right, (sx - cx) / P.focal)), mul(P.up, -(sy - cy) / P.focal));
  if (Math.abs(dir[2]) < 1e-9) throw new Error(`worldAt: the ray through (${sx}, ${sy}) runs parallel to the plane z = ${z}`);
  const t = (z - P.pos[2]) / dir[2];
  if (!(t > 0)) throw new Error(`worldAt: the ray through (${sx}, ${sy}) never meets the plane z = ${z} in front of the lens (it is above that plane's horizon)`);
  return [P.pos[0] + dir[0] * t, P.pos[1] + dir[1] * t, z];
}

// ── Camera moves ──────────────────────────────────────────────────────────────────────────

/** The camera moves cameraAt understands, and what each takes. */
export const CAMERA_MOVES = {
  push: 'by (cm): the camera moves toward its target, which stays (a push-in on the subject)',
  dolly: 'by (cm): camera and target move together along the floor, forward',
  truck: 'by (cm): camera and target move together sideways (right is +)',
  crane: 'by (cm): camera and target rise (or sink)',
  pan: 'deg: the camera turns about its own vertical axis (left is +)',
  tilt: 'deg: the camera turns up (+) or down about its right axis',
  orbit: 'deg: the camera circles its target about the vertical (counter-clockwise is +)',
  zoom: 'fov (deg): the field of view changes; nothing moves, so nothing parallaxes',
  to: '{ pos, target, fov }: the camera goes to this keyframe',
};

const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
function rotAxis(v, k, a) {
  // Rodrigues: v rotated by a about the unit axis k
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

/** One move applied to a camera { pos, target, fov, roll } a fraction u of the way. */
export function applyMove(c, m, u) {
  const out = { ...c };
  const f = norm(sub(c.target, c.pos));
  const flat = norm([f[0], f[1], 0]);
  const side = norm(cross(flat, WORLD_UP));
  switch (m.kind) {
    case 'push': out.pos = add(c.pos, mul(f, (m.by ?? 0) * u)); break;
    case 'dolly': { const d = mul(flat, (m.by ?? 0) * u); out.pos = add(c.pos, d); out.target = add(c.target, d); break; }
    case 'truck': { const d = mul(side, (m.by ?? 0) * u); out.pos = add(c.pos, d); out.target = add(c.target, d); break; }
    case 'crane': { const d = [0, 0, (m.by ?? 0) * u]; out.pos = add(c.pos, d); out.target = add(c.target, d); break; }
    case 'pan': out.target = add(c.pos, rotZ(sub(c.target, c.pos), ((m.deg ?? 0) * u * Math.PI) / 180)); break;
    case 'tilt': out.target = add(c.pos, rotAxis(sub(c.target, c.pos), side, ((m.deg ?? 0) * u * Math.PI) / 180)); break;
    case 'orbit': out.pos = add(c.target, rotZ(sub(c.pos, c.target), ((m.deg ?? 0) * u * Math.PI) / 180)); break;
    case 'zoom': out.fov = c.fov * Math.pow((m.fov ?? c.fov) / c.fov, u); break;
    case 'to':
      if (m.pos) out.pos = V3.lerp(c.pos, m.pos, u);
      if (m.target) out.target = V3.lerp(c.target, m.target, u);
      if (m.fov) out.fov = c.fov * Math.pow(m.fov / c.fov, u);
      break;
    default: throw new Error(`lens: unknown camera move "${m.kind}" (${Object.keys(CAMERA_MOVES).join(', ')})`);
  }
  return out;
}

/**
 * The camera at time t: `start` { pos, target, fov, roll } and `moves` [{ at, dur, kind, by | deg
 * | fov | pos/target, e? }] applied in order, each eased (E.world, the in-world ease, unless `e`
 * names another curve). Moves may overlap: each acts on the camera the ones before it left.
 */
export function cameraAt(t, start, moves = []) {
  let c = { fov: 37, roll: 0, ...start };
  for (const m of moves) {
    const raw = m.dur > 0 ? (t - m.at) / m.dur : t >= m.at ? 1 : 0;
    const u = clamp01(raw);
    if (u <= 0) continue;
    const curve = typeof m.e === 'function' ? m.e : E[m.e ?? 'world'] ?? E.world;
    c = applyMove(c, m, curve(u));
  }
  return c;
}

// ── Light rig ─────────────────────────────────────────────────────────────────────────────

/**
 * The lights of a shot. Every light has a source in the shot or stated in the storyboard (the
 * studio key, the window's moonlight, the open fridge): `dirs` are directional lights
 * { dir (toward the light), level, color? } (the key is one), `points` are point lights
 * { pos, level, reach, color, aperture? } (light.js irradiance). `ambient` is the fill a face
 * turned away from everything still gets: the studio's on paper, almost none on the stage.
 * Defaults: paper — the studio key from the top right (P.key) and ambient LIGHT.ambient; stage —
 * ambient 0.06 and no key, so only the lights you add reach anything.
 */
export function rig(P, { ground = isDark() ? 'stage' : 'paper', ambient, key, dirs = [], points = [] } = {}) {
  const dark = ground === 'stage' || ground === 'night' || ground === 'forest';
  const amb = ambient ?? (dark ? 0.06 : core.LIGHT?.ambient ?? 0.42);
  const keyLight = key === false || (dark && key === undefined) ? [] : [{ dir: norm(key?.dir ?? P.key), level: key?.level ?? 0.6, color: key?.color }];
  return { dark, ambient: amb, dirs: [...keyLight, ...dirs.map((d) => ({ ...d, dir: norm(d.dir) }))], points };
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Two hex colors mixed in display space (darkening reads truer this way than in linear light). */
function lerpHex(a, b, t) {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const k = clamp01(t);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const isHex = (c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);

/** A material's color at light amount k (0 dark … 1 fully lit … 1.3 bleaching to white). */
export function rampAt(tones, k, { dark = false } = {}) {
  const tn = tonesOf(tones);
  const night = dark ? T['ink-dark'] : tn.dark;
  const stops = [[0, night], [0.28, tn.dark], [0.48, tn.shade ?? tn.left], [0.74, tn.base ?? tn.right], [1, tn.lit ?? tn.top], [1.35, T.canvas]];
  if (k <= 0) return night;
  for (let i = 1; i < stops.length; i++) {
    if (k <= stops[i][0]) {
      const [k0, c0] = stops[i - 1];
      const [k1, c1] = stops[i];
      return lerpHex(c0, c1, (k - k0) / (k1 - k0));
    }
  }
  return T.canvas;
}

/** The color of a face of a material with normal n at the point p under the rig: the ramp at its
 *  directional light, then warmed by every point light that reaches it. */
export function shade(tones, n, p, R) {
  const tn = tonesOf(tones);
  let k = R.ambient;
  for (const d of R.dirs) k += d.level * Math.max(0, dot(n, d.dir));
  let c = rampAt(tn, k, { dark: R.dark });
  for (const d of R.dirs) {
    if (!d.color) continue;
    const a = d.level * Math.max(0, dot(n, d.dir));
    if (a > 0.003) c = lerpHex(c, lightColor(d.color), Math.min(0.5, a));
  }
  for (const L of R.points) {
    const I = irradiance(L, p, n);
    if (I > 0.003) c = core.mixHex(c, core.mixHex(tn.lit ?? tn.top, lightColor(L.color ?? 'warm'), 0.5), Math.min(0.9, I));
  }
  return c;
}

/** How much light reaches a point from all of the rig (for billboards): { k, warm, warmColor }. */
export function lightAt(R, p, n = null) {
  let k = R.ambient;
  for (const d of R.dirs) k += d.level * (n ? Math.max(0, dot(n, d.dir)) : 0.6);
  let warm = 0;
  let src = null;
  for (const L of R.points) {
    const I = irradiance(L, p, n);
    if (I > warm) {
      warm = I;
      src = L;
    }
  }
  return { k, warm, light: src };
}

// ── Solids through the lens ───────────────────────────────────────────────────────────────

/** Screen points to one decimal: a tenth of a px is plenty at 1080 × 1920, and half the bytes. */
const n1 = (v) => Math.round(v * 10) / 10;
const ptsAttr = (s) => s.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' ');

/** A soft vertical falloff for a face: lighter at its top, sinking toward its bottom, in the
 *  face's own box (so faces of one color and light share one gradient; `top` and `bottom` are
 *  accepted for older callers and only decide the direction when it runs upward). */
function faceGrad(c, top, bottom, { lift = 0.08, sink = 0.22, toward } = {}) {
  const to = toward ?? T['shadow-warm'];
  const stops = [[0, lerpHex(c, T.canvas, lift)], [0.55, c], [1, lerpHex(c, to, sink)]];
  const up = top && bottom && bottom[1] < top[1];
  const inner = stops.map(([o, col]) => el('stop', { offset: o, 'stop-color': col })).join('');
  const gid = id(`lf-${hashId(`${up ? 'u' : 'd'}|${inner}`)}`);
  return { def: el('linearGradient', { id: gid, x1: 0, y1: up ? 1 : 0, x2: 0, y2: up ? 0 : 1 }, inner), paint: `url(#${gid})` };
}

/** Convex hull of screen points ([[x, y], …], counter-clockwise on screen). */
export function screenHull(points) {
  return hull(points);
}
function hull(points) {
  const ps = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ps.length < 3) return ps;
  const cz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of ps) {
    while (lo.length >= 2 && cz(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const hi = [];
  for (let i = ps.length - 1; i >= 0; i--) {
    while (hi.length >= 2 && cz(hi[hi.length - 2], hi[hi.length - 1], ps[i]) <= 0) hi.pop();
    hi.push(ps[i]);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

const ORANGE_NAMES = ['orange', 'orange-lit', 'orange-shade', 'orange-dark'];
const ORANGE = new Set(ORANGE_NAMES.map((k) => T[k]).filter(Boolean));
/** True when a tones value is the hero's orange (by name, the TONES ramp, an orange token by
 *  name or hex, or a mix that is mostly orange). */
export function isOrange(tones) {
  if (!tones) return false;
  if (tones === TONES.orange) return true;
  if (typeof tones === 'string') return ORANGE_NAMES.includes(tones) || ORANGE.has(tones.toUpperCase());
  if (typeof tones === 'object' && Array.isArray(tones.mix)) {
    const [a, b, k = 0.5] = tones.mix;
    return (isOrange(a) && k < 0.5) || (isOrange(b) && k > 0.5);
  }
  return false;
}
/** A solid drawn in orange carries data-tone="orange", so orangeProblems can hold orange to the
 *  hero and the one focal. */
const toneTag = (svg, list) => (svg && list.some(isOrange) ? g({ 'data-tone': 'orange' }, svg) : svg);

/**
 * A world polygon clipped at the lens's near plane (Sutherland–Hodgman against depth = near): the
 * part in front of the camera, as { world, screen } points. A floor running behind an off-axis
 * camera keeps the part in front of it instead of vanishing (or folding back across the frame).
 */
export function clipNear(P, pts, eps = 1) {
  const depth = (q) => dot(sub(q, P.pos), P.fwd);
  const lim = (P.near ?? 5) + eps;
  const world = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const za = depth(a);
    const zb = depth(b);
    if (za >= lim) world.push(a);
    if ((za >= lim) !== (zb >= lim)) world.push(V3.lerp(a, b, (lim - za) / (zb - za)));
  }
  return { world, screen: world.map((q) => P(...q)) };
}

/**
 * An oriented box through the lens: corner `o`, edges U, V, N (world cm vectors, at right angles).
 * Only the faces turned to the camera are drawn (back-face culling), each in its own color from
 * the rig (shade) with a soft falloff toward its lower edge, inside a silhouette with rounded
 * corners; the edges between lit faces catch a highlight. `faces` paints a face by name
 * (u0 u1 v0 v1 n0 n1: the faces at U = 0/1, V = 0/1, N = 0/1) with its own tones, or false to
 * leave it open. Returns { svg, faces: { name: screen points }, hull }.
 */
export function obox(P, o, U, V, N, tones = 'paper', R = null, { radius = 1.2, faces = {}, gloss = false, edge = true, art = {} } = {}) {
  const Rg = R ?? rig(P);
  const c = (a, b, d) => add(add(add(o, mul(U, a)), mul(V, b)), mul(N, d));
  const F = {
    u0: { pts: [c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)], n: mul(norm(U), -1) },
    u1: { pts: [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], n: norm(U) },
    v0: { pts: [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], n: mul(norm(V), -1) },
    v1: { pts: [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)], n: norm(V) },
    n0: { pts: [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)], n: mul(norm(N), -1) },
    n1: { pts: [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], n: norm(N) },
  };
  const all = [];
  for (const a of [0, 1]) for (const b of [0, 1]) for (const d of [0, 1]) all.push(P(...c(a, b, d)));
  const H = hull(all);
  const center = c(0.5, 0.5, 0.5);
  const sc = P.scaleAt(...center);
  const r = Math.max(0, Math.min(radius * sc, 18));
  const defs = [];
  const inner = [];
  const shown = {};
  for (const [name, f] of Object.entries(F)) {
    if (faces[name] === false) continue;
    const mid = mul(f.pts.reduce((s, q) => add(s, q), [0, 0, 0]), 0.25);
    if (!P.facing(mid, f.n)) continue;
    const cut = clipNear(P, f.pts);
    if (cut.world.length < 3) continue;
    const s = cut.screen;
    shown[name] = s;
    const col = shade(faces[name] ?? tones, f.n, mid, Rg);
    // the falloff runs down the face (for a horizontal face, from its far edge to its near edge)
    const upish = Math.abs(f.n[2]) > 0.7;
    let top;
    let bottom;
    if (upish) {
      const byDepth = [...s].sort((a2, b2) => b2[2] - a2[2]);
      top = byDepth[0];
      bottom = byDepth[byDepth.length - 1];
    } else {
      const byZ = cut.world.map((q, i) => [q[2], s[i]]).sort((a2, b2) => b2[0] - a2[0]);
      top = byZ[0][1];
      bottom = byZ[byZ.length - 1][1];
    }
    // the studio's soft top-light falloff; in the dark a face is only as bright as its light
    const gr = upish ? faceGrad(col, top, bottom, { lift: Rg.dark ? 0 : 0.14, sink: 0.04 }) : faceGrad(col, top, bottom, { lift: Rg.dark ? 0 : 0.06, sink: Rg.dark ? 0.3 : 0.2, toward: Rg.dark ? T['ink-dark'] : undefined });
    const tiny = Math.max(...s.map((q) => q[0])) - Math.min(...s.map((q) => q[0])) < 6 || Math.max(...s.map((q) => q[1])) - Math.min(...s.map((q) => q[1])) < 6;
    if (!tiny) defs.push(gr.def);
    inner.push(el('polygon', { points: ptsAttr(s), fill: tiny ? col : gr.paint }));
    if (art[name]) inner.push(art[name](s));
  }
  if (!Object.keys(shown).length) return { svg: '', faces: shown, hull: H };
  // the silhouette from what is in front of the lens (a corner behind it projects nowhere useful)
  if (all.some((q) => q[2] <= (P.near ?? 5) + 1e-6)) H.splice(0, H.length, ...hull(Object.values(shown).flat()));
  // the lit edges: where the top meets a visible side
  if (edge && shown.n1) {
    const lift = core.mixHex(rampAt(tones, 1, { dark: Rg.dark }), T.canvas, 0.45);
    const w = Math.max(1, Math.min(5, 0.5 * sc));
    for (const side of ['u0', 'u1', 'v0', 'v1']) {
      if (!shown[side]) continue;
      const sp = F[side].pts.filter((q) => F.n1.pts.some((t2) => len(sub(t2, q)) < 1e-6));
      if (sp.length === 2 && sp.every((q) => dot(sub(q, P.pos), P.fwd) > (P.near ?? 5) + 1)) {
        const [a2, b2] = sp.map((q) => P(...q));
        inner.push(el('line', { x1: n2(a2[0]), y1: n2(a2[1]), x2: n2(b2[0]), y2: n2(b2[1]), stroke: lift, 'stroke-width': n2(w), 'stroke-linecap': 'round', opacity: Rg.dark ? 0.25 : 0.75 }));
      }
    }
  }
  if (gloss && shown.n1) inner.push(el('polygon', { points: ptsAttr(shown.n1), fill: T.canvas, opacity: 0.18 }));
  // rounded corners, when they are big enough to see (a clip under 1.5 px is bytes for nothing)
  let solid;
  if (r >= 1.5) {
    const clipD = roundedPath(H, r);
    const cid = id(`ob-${hashId(clipD)}`);
    defs.push(el('clipPath', { id: cid }, el('path', { d: clipD })));
    solid = el('defs', {}, defs.join('')) + g({ 'clip-path': `url(#${cid})` }, inner);
  } else solid = el('defs', {}, defs.join('')) + inner.join('');
  return { svg: toneTag(solid, [tones, ...Object.values(faces)]), faces: shown, hull: H };
}

/** An axis-aligned box: corner [x, y, z], size [w (x), d (y), h (z)] in cm. See obox. */
export function box(P, at, size, tones = 'paper', R = null, opts = {}) {
  return obox(P, at, [size[0], 0, 0], [0, size[1], 0], [0, 0, size[2]], tones, R, opts);
}

/** A slab (a shelf, a counter top, a door): a thin box. */
export const slab = box;

/**
 * A vertical cylinder (a jar, a pot, a can): base centre [x, y, z], radius r, height h (cm). The
 * side is shaded around its girth from the rig (lit side, form shadow), with the cap seen from
 * above (or below). `seg` samples per turn. A thin cylinder is a disc.
 */
export function cylinder(P, at, r, h, tones = 'paper', R = null, { seg = 32, cap = true } = {}) {
  const Rg = R ?? rig(P);
  const [x, y, z] = at;
  const ring = (zz) => Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * 2 * Math.PI;
    return [x + r * Math.cos(a), y + r * Math.sin(a), zz];
  });
  const bot = ring(z);
  const top = ring(z + h);
  const ns = Array.from({ length: seg }, (_, i) => [Math.cos((i / seg) * 2 * Math.PI), Math.sin((i / seg) * 2 * Math.PI), 0]);
  const vis = ns.map((n, i) => P.facing(bot[i], n) || P.facing(top[i], n));
  const out = [];
  const defs = [];
  if (h > 0 && vis.some(Boolean)) {
    // the visible arc as one run (rotate so it does not wrap)
    let start = vis.findIndex((v, i) => v && !vis[(i - 1 + seg) % seg]);
    if (start < 0) start = 0;
    const idx = [];
    for (let k = 0; k < seg; k++) {
      const i = (start + k) % seg;
      if (!vis[i]) break;
      idx.push(i);
    }
    const sb = idx.map((i) => P(...bot[i]));
    const st = idx.map((i) => P(...top[i]));
    const sidePts = [...sb, ...st.slice().reverse()];
    // shade sampled across the girth, as a horizontal gradient between the silhouette ends
    const left = sb.reduce((a, q) => (q[0] < a[0] ? q : a), sb[0]);
    const right = sb.reduce((a, q) => (q[0] > a[0] ? q : a), sb[0]);
    const span = right[0] - left[0] || 1;
    const stops = idx.map((i) => {
      const q = P(...bot[i]);
      return [clamp01((q[0] - left[0]) / span), shade(tones, ns[i], [bot[i][0], bot[i][1], z + h / 2], Rg)];
    }).sort((a, b) => a[0] - b[0]);
    const inner = stops.filter((_, k) => k % 3 === 0 || k === stops.length - 1).map(([o, col]) => el('stop', { offset: n2(o), 'stop-color': col })).join('');
    const gid = id(`cy-${hashId(inner + n2(left[0]) + n2(right[0]))}`);
    defs.push(el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n2(left[0]), y1: 0, x2: n2(right[0]), y2: 0 }, inner));
    out.push(el('polygon', { points: ptsAttr(sidePts), fill: `url(#${gid})` }));
  }
  if (cap) {
    const up = P.pos[2] > z + h;
    const capPts = (up ? top : bot).map((q) => P(...q));
    const n = up ? [0, 0, 1] : [0, 0, -1];
    const col = shade(tones, n, [x, y, up ? z + h : z], Rg);
    out.push(el('polygon', { points: ptsAttr(capPts), fill: col }));
    if (up) {
      const front = Math.ceil(seg / 2);
      // the cap's rim nearest the lens catches the light
      const near = top.map((q, i) => [i, P.dist(...q)]).sort((a, b) => a[1] - b[1]).slice(0, front).map(([i]) => i).sort((a, b) => a - b);
      const rimPts = near.map((i) => P(...top[i]));
      out.push(el('polyline', { points: ptsAttr(rimPts), fill: 'none', stroke: core.mixHex(col, T.canvas, 0.5), 'stroke-width': n2(Math.max(1, Math.min(4, 0.4 * P.scaleAt(x, y, z + h)))), opacity: Rg.dark ? 0.3 : 0.8, 'stroke-linecap': 'round' }));
    }
  }
  return toneTag((defs.length ? el('defs', {}, defs.join('')) : '') + out.join(''), [tones]);
}

/** A sphere (a lemon, a ball, a bulb): centre [x, y, z], radius r (cm), shaded from the rig as a
 *  soft volume, its highlight toward the key light. */
export function sphere(P, at, r, tones = 'paper', R = null) {
  const Rg = R ?? rig(P);
  const c = P(...at);
  const rad = r * P.scaleAt(...at);
  const key = Rg.dirs[0]?.dir ?? P.key;
  const lit = shade(tones, key, at, Rg);
  const dark = shade(tones, mul(key, -1), at, Rg);
  const mid = shade(tones, norm(sub(P.pos, at)), at, Rg);
  // the highlight sits toward the key light as the lens sees it
  const kx = dot(key, P.right);
  const ky = -dot(key, P.up);
  const gid = id(`sp-${hashId(`${lit}${mid}${dark}${n2(kx)}${n2(ky)}`)}`);
  const grad = el('radialGradient', { id: gid, cx: n2(0.5 + kx * 0.28), cy: n2(0.5 + ky * 0.28), r: 0.75 }, [
    el('stop', { offset: 0, 'stop-color': lerpHex(lit, T.canvas, Rg.dark ? 0.05 : 0.35) }),
    el('stop', { offset: 0.45, 'stop-color': mid }),
    el('stop', { offset: 1, 'stop-color': dark }),
  ].join(''));
  return toneTag(el('defs', {}, grad) + el('circle', { cx: n2(c[0]), cy: n2(c[1]), r: n2(rad), fill: `url(#${gid})` }), [tones]);
}

/**
 * A flat world polygon (a floor, a wall, a rug), clipped at the lens's near plane. `fill` is a
 * color or paint, or `{ tones, n, R? }` to shade it from the rig like a solid's face (`n` its
 * normal, or [0, 0, 1] for a floor; `R` the shot's rig, else the default for the ground), so a
 * plain floor or wall darkens on the stage with everything else.
 */
export function quad(P, pts, fill, attrs = {}) {
  const cut = clipNear(P, pts);
  if (cut.world.length < 3) return '';
  let paint = fill;
  if (fill && typeof fill === 'object') {
    const n = norm(fill.n ?? cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const mid = mul(pts.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / pts.length);
    paint = shade(fill.tones ?? 'paper', n, mid, fill.R ?? rig(P));
  }
  return el('polygon', { points: ptsAttr(cut.screen), fill: paint, ...attrs });
}

/** Mark set text: a sign, a label or a poster that is part of the room, not something to read in
 *  the story. bounds.mjs lets it sit in the caption band or run off the frame edge on a close
 *  shot (it still may not cover the focal). render() marks every `env` piece (the ROOM) as set. */
export const set = (svg) => (svg ? g({ 'data-set': 1 }, svg) : '');

/**
 * Flat 2D art laid on a world face: local (0, 0) at `origin`, (w, 0) at origin + U, (0, h) at
 * origin + V (w = |U|, h = |V| in cm, so the art is drawn in cm), clipped to the face. Each of
 * `cells` × `cells` pieces of the face gets its own affine map from its corners, so a big face
 * seen at an angle stays close to perspective-correct (1 is exact only for a small or square-on
 * face; give a wide backdrop 3 or 4).
 */
export function faceArt(P, origin, U, V, inner, { clip = true, cells = 1 } = {}) {
  const w = len(U);
  const h = len(V);
  const at = (u, v) => add(add(origin, mul(U, u)), mul(V, v));
  const n = Math.max(1, Math.round(cells));
  const out = [];
  const defs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u0 = i / n;
      const v0 = j / n;
      const u1 = (i + 1) / n;
      const v1 = (j + 1) / n;
      const a = P(...at(u0, v0));
      const b = P(...at(u1, v0));
      const d = P(...at(u0, v1));
      // local art coords of this cell's corner a, and its axes
      const lu = u0 * w;
      const lv = v0 * h;
      const su = (u1 - u0) * w;
      const sv = (v1 - v0) * h;
      const m = [(b[0] - a[0]) / su, (b[1] - a[1]) / su, (d[0] - a[0]) / sv, (d[1] - a[1]) / sv];
      const e = a[0] - m[0] * lu - m[2] * lv;
      const f = a[1] - m[1] * lu - m[3] * lv;
      const body = g({ transform: `matrix(${[...m, e, f].map((x) => x.toFixed(5)).join(' ')})` }, inner);
      if (!clip && n === 1) {
        out.push(body);
        continue;
      }
      const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)].map((q) => P(...q));
      // a hair of overlap so neighbouring cells leave no seam
      const cx = corners.reduce((s2, q) => s2 + q[0], 0) / 4;
      const cy = corners.reduce((s2, q) => s2 + q[1], 0) / 4;
      const grown = n > 1 ? corners.map((q) => [q[0] + Math.sign(q[0] - cx) * 0.6, q[1] + Math.sign(q[1] - cy) * 0.6]) : corners;
      const cid = id(`fa-${hashId(ptsAttr(grown))}`);
      defs.push(el('clipPath', { id: cid }, el('polygon', { points: ptsAttr(grown) })));
      out.push(g({ 'clip-path': `url(#${cid})` }, body));
    }
  }
  return (defs.length ? el('defs', {}, defs.join('')) : '') + out.join('');
}

/** A door (or lid) on a hinge: a panel `width` × `height` × `thick` cm hinged on a vertical axis at
 *  `at` [x, y, z], closed along `along` (a floor direction), swung `deg` toward `swing` (the floor
 *  direction it opens to: the room side). Returns { o, U, V, N, edge } for obox and the free
 *  edge's bottom point. */
export function hinge(at, { width, height, thick = 6, along = [1, 0, 0], swing = [0, -1, 0], deg = 0 }) {
  const a = (deg * Math.PI) / 180;
  const al = norm(along);
  const sw = norm(swing);
  const U = mul(add(mul(al, Math.cos(a)), mul(sw, Math.sin(a))), width);
  const out = norm(add(mul(sw, Math.cos(a)), mul(al, -Math.sin(a))));
  const N = mul(out, thick);
  return { o: at, U, V: [0, 0, height], N, edge: add(at, U), out };
}

/**
 * An open container (a fridge, a cupboard, a box) through the lens: an axis-aligned shell at
 * `at` of `size` [w, d, h] with walls `wall` cm thick and its opening on the side `open`
 * ('-y' | '+y' | '-x' | '+x', a vertical side) spanning z from `from` to `to`. Inside means
 * behind the frame: the inner faces the camera can see (lit by `inside`, a light inside it)
 * and `contents(P)` are clipped to the opening; the frame ring and the outer shell go over them.
 * Returns { svg, opening (world quad, bottom first: the light's aperture) }.
 */
export function openBox(P, at, size, tones = 'paper', R = null, { wall = 4, open = '-y', from, to, inner: innerTones, contents = '', inside = null } = {}) {
  const Rg = R ?? rig(P);
  const [x0, y0, z0] = at;
  const [w, d, h] = size;
  const zLo = from ?? z0 + wall;
  const zHi = to ?? z0 + h - wall;
  const axis = open[1];
  const sgn = open[0] === '-' ? -1 : 1;
  // the opening on the face plane, and the inner cavity
  const facePos = axis === 'y' ? (sgn < 0 ? y0 : y0 + d) : sgn < 0 ? x0 : x0 + w;
  const op = axis === 'y'
    ? [[x0 + wall, facePos, zLo], [x0 + w - wall, facePos, zLo], [x0 + w - wall, facePos, zHi], [x0 + wall, facePos, zHi]]
    : [[facePos, y0 + wall, zLo], [facePos, y0 + d - wall, zLo], [facePos, y0 + d - wall, zHi], [facePos, y0 + wall, zHi]];
  const cav = { x0: x0 + wall, x1: x0 + w - wall, y0: y0 + wall, y1: y0 + d - wall, z0: zLo, z1: zHi };
  if (axis === 'y') { if (sgn < 0) cav.y0 = y0; else cav.y1 = y0 + d; } else if (sgn < 0) cav.x0 = x0; else cav.x1 = x0 + w;
  // a light inside the box reaches its inside directly (its aperture is the way out, not in)
  const innerR = inside ? { ...Rg, points: [...Rg.points.filter((q) => q !== inside), { ...inside, aperture: null }] } : Rg;
  const it = innerTones ?? tones;
  // the inner faces, each facing into the cavity
  const IF = [
    { pts: [[cav.x0, cav.y0, cav.z0], [cav.x1, cav.y0, cav.z0], [cav.x1, cav.y1, cav.z0], [cav.x0, cav.y1, cav.z0]], n: [0, 0, 1] },
    { pts: [[cav.x0, cav.y0, cav.z1], [cav.x1, cav.y0, cav.z1], [cav.x1, cav.y1, cav.z1], [cav.x0, cav.y1, cav.z1]], n: [0, 0, -1] },
    { pts: [[cav.x0, cav.y0, cav.z0], [cav.x0, cav.y1, cav.z0], [cav.x0, cav.y1, cav.z1], [cav.x0, cav.y0, cav.z1]], n: [1, 0, 0] },
    { pts: [[cav.x1, cav.y0, cav.z0], [cav.x1, cav.y1, cav.z0], [cav.x1, cav.y1, cav.z1], [cav.x1, cav.y0, cav.z1]], n: [-1, 0, 0] },
    { pts: [[cav.x0, cav.y0, cav.z0], [cav.x1, cav.y0, cav.z0], [cav.x1, cav.y0, cav.z1], [cav.x0, cav.y0, cav.z1]], n: [0, 1, 0] },
    { pts: [[cav.x0, cav.y1, cav.z0], [cav.x1, cav.y1, cav.z0], [cav.x1, cav.y1, cav.z1], [cav.x0, cav.y1, cav.z1]], n: [0, -1, 0] },
  ];
  const back = [];
  const defs = [];
  for (const f of IF) {
    // the open side has no wall: it is the opening
    if (f.pts.every((q) => q[axis === 'y' ? 1 : 0] === facePos)) continue;
    const mid = mul(f.pts.reduce((s, q) => add(s, q), [0, 0, 0]), 0.25);
    if (!P.facing(mid, f.n)) continue;
    const col = shade(it, f.n, mid, innerR);
    const cut = clipNear(P, f.pts);
    if (cut.world.length < 3) continue;
    const s = cut.screen;
    const byZ = cut.world.map((q, i) => [q[2], s[i]]).sort((a, b) => b[0] - a[0]);
    const gr = faceGrad(col, byZ[0][1], byZ[byZ.length - 1][1], { lift: 0.1, sink: 0.12 });
    defs.push(gr.def);
    back.push(el('polygon', { points: ptsAttr(s), fill: gr.paint }));
  }
  const opS = op.map((q) => P(...q));
  const cid = id(`ox-${hashId(ptsAttr(opS))}`);
  defs.push(el('clipPath', { id: cid }, el('polygon', { points: ptsAttr(opS) })));
  const inner = typeof contents === 'function' ? contents(P, innerR) : contents;
  // occlusion just inside the opening's edge
  const span = Math.min(Math.abs(opS[1][0] - opS[0][0]) + Math.abs(opS[1][1] - opS[0][1]), Math.abs(opS[2][1] - opS[1][1]) + Math.abs(opS[2][0] - opS[1][0]));
  const aoF = blurDef(Math.max(2, span * 0.03), { name: 'oxao', box: 'bbox' });
  defs.push(aoF.defs);
  const ao = el('polygon', { points: ptsAttr(opS), fill: 'none', stroke: Rg.dark ? T['ink-dark'] : T['shadow-warm'], 'stroke-width': n2(Math.max(4, span * 0.07)), opacity: Rg.dark ? 0.5 : 0.18, filter: aoF.url });
  // the shell: an obox with the open face replaced by a ring
  const openName = axis === 'y' ? (sgn < 0 ? 'v0' : 'v1') : sgn < 0 ? 'u0' : 'u1';
  const shell = box(P, at, size, tones, Rg, { faces: { [openName]: false } });
  const ringPts = (() => {
    const outer = axis === 'y'
      ? [[x0, facePos, z0], [x0 + w, facePos, z0], [x0 + w, facePos, z0 + h], [x0, facePos, z0 + h]]
      : [[facePos, y0, z0], [facePos, y0 + d, z0], [facePos, y0 + d, z0 + h], [facePos, y0, z0 + h]];
    return outer;
  })();
  const nOpen = axis === 'y' ? [0, sgn, 0] : [sgn, 0, 0];
  let ring = '';
  if (P.facing(ringPts[0], nOpen) || P.facing(V3.lerp(ringPts[0], ringPts[2], 0.5), nOpen)) {
    const col = shade(tones, nOpen, V3.lerp(ringPts[0], ringPts[2], 0.5), Rg);
    const o2 = ringPts.map((q) => P(...q));
    ring = el('path', { d: `M ${o2.map((q) => `${n2(q[0])} ${n2(q[1])}`).join(' L ')} Z M ${opS.map((q) => `${n2(q[0])} ${n2(q[1])}`).join(' L ')} Z`, fill: col, 'fill-rule': 'evenodd' });
    ring += el('polygon', { points: ptsAttr(opS), fill: 'none', stroke: lerpHex(col, T['shadow-warm'], 0.2), 'stroke-width': n2(Math.max(1, 0.4 * P.scaleAt(...op[0]))) });
  }
  const svg = el('defs', {}, defs.join('')) + g({ 'clip-path': `url(#${cid})` }, [back.join(''), inner, ao]) + shell.svg + ring;
  return { svg, opening: op };
}

// ── Shadows ───────────────────────────────────────────────────────────────────────────────

/** The darkest a shadow on the floor gets: soft on paper, deeper on the stage. */
export const SHADOW_MAX = { paper: 0.32, dark: 0.6 };

/** A shadow on the floor: a world polygon (castShadow) through the lens, soft-edged and capped in
 *  darkness (SHADOW_MAX). Given `from` (the thing's foot, world), it fades out along its length,
 *  as a real shadow lightens away from what casts it. `level` 0..1. */
export function floorShadow(P, poly, { level = 0.5, color, soft = 0.03, from = null } = {}) {
  if (!poly || poly.length < 3 || !(level > 0.005)) return '';
  const s = poly.map((q) => P(...q));
  const xs = s.map((q) => q[0]);
  const ys = s.map((q) => q[1]);
  const size = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
  const big = Math.max(...xs) - Math.min(...xs) > 1400 || Math.max(...ys) - Math.min(...ys) > 2400;
  const f = blurDef(Math.min(24, Math.max(2, Math.min(size, 2400) * soft)), { name: 'fshadow', box: big ? 'frame' : 'bbox' });
  const c = color ?? (isDark() ? T['ink-dark'] : T['shadow-warm']);
  const a = n2(Math.min(isDark() ? SHADOW_MAX.dark : SHADOW_MAX.paper, clamp01(level)));
  let fill = c;
  let defs = f.defs;
  if (from) {
    const o = P(...from);
    const tip = s.reduce((b, q) => (Math.hypot(q[0] - o[0], q[1] - o[1]) > Math.hypot(b[0] - o[0], b[1] - o[1]) ? q : b), s[0]);
    const gid = id(`fs-${hashId(`${ptsAttr([o, tip])}${c}`)}`);
    defs += el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n2(o[0]), y1: n2(o[1]), x2: n2(tip[0]), y2: n2(tip[1]) }, el('stop', { offset: 0, 'stop-color': c }) + el('stop', { offset: 1, 'stop-color': c, 'stop-opacity': 0.1 }));
    fill = `url(#${gid})`;
  }
  return g({ 'data-k': 'shadow' }, [el('defs', {}, defs), el('polygon', { points: ptsAttr(s), fill, opacity: a, filter: f.url })]);
}

/** The soft occlusion right under a thing on the floor: its footprint (world points, or
 *  { x, y, r }) a little grown, blurred. */
export function contactShadow(P, footprint, { level, grow = 1.08 } = {}) {
  const pts = Array.isArray(footprint)
    ? (() => {
        const c = mul(footprint.reduce((s, q) => add(s, [q[0], q[1], q[2] ?? 0]), [0, 0, 0]), 1 / footprint.length);
        return footprint.map((q) => add(c, mul(sub([q[0], q[1], q[2] ?? 0], c), grow)));
      })()
    : Array.from({ length: 20 }, (_, i) => [footprint.x + footprint.r * grow * Math.cos((i / 20) * 2 * Math.PI), footprint.y + footprint.r * grow * Math.sin((i / 20) * 2 * Math.PI), 0]);
  return floorShadow(P, pts, { level: level ?? (isDark() ? 0.7 : 0.3), soft: 0.06 });
}

/**
 * The shadows a thing standing on the floor casts from every light of the rig that reaches it:
 * `footprint` (world points or { x, y, r }), `height` cm. A directional light (the key, the
 * moon) throws a soft shadow by its level; a point light only where it reaches the thing, by how
 * much. Each points away from its light.
 */
export function shadowsOf(P, footprint, height, R, { dirLevel = 0.22, pointLevel = 0.6 } = {}) {
  const c = Array.isArray(footprint) ? mul(footprint.reduce((a, q) => add(a, [q[0], q[1], 0]), [0, 0, 0]), 1 / footprint.length) : [footprint.x, footprint.y, 0];
  const out = [];
  for (const d of R.dirs) {
    if (!(d.level > 0.05) || !(d.dir[2] > 0.05)) continue;
    out.push(floorShadow(P, castShadow(footprint, { dir: d.dir }, { height }), { level: d.level * dirLevel, from: c }));
  }
  // the footprint's extent, so a light inside the thing (a fridge's own lamp) casts no shadow of it
  const fx = Array.isArray(footprint) ? footprint.map((q) => q[0]) : [footprint.x - footprint.r, footprint.x + footprint.r];
  const fy = Array.isArray(footprint) ? footprint.map((q) => q[1]) : [footprint.y - footprint.r, footprint.y + footprint.r];
  const inside = (p) => p[0] >= Math.min(...fx) && p[0] <= Math.max(...fx) && p[1] >= Math.min(...fy) && p[1] <= Math.max(...fy) && p[2] <= height;
  for (const pl of R.points) {
    if (inside(pl.pos)) continue;
    const I = Math.max(irradiance(pl, [c[0], c[1], 1], [0, 0, 1]), irradiance(pl, [c[0], c[1], height * 0.6]));
    if (I < 0.02) continue;
    out.push(floorShadow(P, castShadow(footprint, pl, { height }), { level: I * pointLevel, from: c }));
  }
  return out.join('');
}

// ── Critters through the lens ─────────────────────────────────────────────────────────────

/**
 * A rim of light on a critter's body as geometry, not a filter: the body outline (cast.js
 * BODY_D) in the critter's own transform, stroked with a gradient that rises toward the light's
 * side (screen direction `side`) and clipped inside the body. Costs a path, where a filter rim
 * over a close-up critter costs tens of ms a frame.
 */
export function critterRim(x, y, opts, { side, color = 'warm', level = 0.8, width = 6 } = {}) {
  if (!(level > 0.005) || !side) return '';
  const s = opts.s ?? 1;
  const sq = opts.sq ?? 0;
  const L = opts.flip ? -1 : 1;
  const sx = s * (1 + sq) * (opts.squash?.sx ?? 1) * L;
  const sy = s * (1 - sq) * (opts.squash?.sy ?? 1);
  const tilt = opts.tilt ?? 0;
  // the light's side in the critter's own coordinates (undo the tilt, the flip and the scale)
  const a = (-tilt * Math.PI) / 180;
  const l = Math.hypot(side[0], side[1]) || 1;
  const rx = (side[0] / l) * Math.cos(a) - (side[1] / l) * Math.sin(a);
  const ry = (side[0] / l) * Math.sin(a) + (side[1] / l) * Math.cos(a);
  const dx = rx * Math.sign(sx);
  const dy = ry * Math.sign(sy);
  const c = [0, -86];
  const col = lightColor(color);
  const gid = id(`crim-${hashId(`${n2(dx)}${n2(dy)}${col}${n2(level)}`)}`);
  const defs = el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n2(c[0] - dx * 66), y1: n2(c[1] - dy * 56), x2: n2(c[0] + dx * 66), y2: n2(c[1] + dy * 56) }, [
    el('stop', { offset: 0, 'stop-color': col, 'stop-opacity': 0 }),
    el('stop', { offset: 0.55, 'stop-color': col, 'stop-opacity': 0 }),
    el('stop', { offset: 0.85, 'stop-color': col, 'stop-opacity': n2(clamp01(level) * 0.55) }),
    el('stop', { offset: 1, 'stop-color': col, 'stop-opacity': n2(clamp01(level)) }),
  ].join(''));
  // the band straddles the outline: half inside the body, half a thin halo of light past it
  const w = width / Math.abs(s);
  return g({ 'data-k': 'light', 'data-light': 'rim', transform: `translate(${n2(x)} ${n2(y)}) rotate(${n2(tilt)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})` }, [
    el('defs', {}, defs),
    el('path', { d: BODY_D, fill: 'none', stroke: `url(#${gid})`, 'stroke-width': n2(w) }),
  ]);
}

/**
 * A critter standing at world (x, y, z) (its feet): a billboard drawn by cast.js at the
 * projected feet, its scale from the lens so it is CRITTER_CM tall at that distance, lit by the
 * rig: veiled where little light reaches it, washed and rimmed by a point light that does (on the
 * side facing it), with its contact shadow and the shadow that light casts away from it.
 * Returns { svg, s, feet, box, at, dist, hands: { l, r } (screen), handsWorld: { l, r } (world cm,
 * on the critter's plane), held: { l?, r?, both?: { box, at, kind, world, grip } } }. `opts.heldIds`
 * ({ r: 'carton' }) makes a held prop an entity of its own (data-frame-kind="entity"), so an insert
 * can take it as its subject and a label can sit on it.
 */
export function critterAt(P, x, y, z = 0, opts = {}, R = null) {
  const Rg = R ?? rig(P);
  const feet = P(x, y, z);
  const s = (P.scaleAt(x, y, z) * CRITTER_CM) / CRITTER_PX;
  const body = critter(feet[0], feet[1], { ...opts, s });
  const chest = [x, y, z + CRITTER_CM * 0.6];
  const toCam = norm([P.pos[0] - x, P.pos[1] - y, 0]);
  const L = lightAt(Rg, chest, toCam);
  // a point light from the side or behind still reaches its silhouette: the strongest one (by
  // what reaches the chest at all) gives the side light and the rim
  let side = 0;
  let src = null;
  for (const pl of Rg.points) {
    const I = irradiance(pl, chest);
    if (I > side) {
      side = I;
      src = pl;
    }
  }
  const out = [];
  // shadows first: the contact shadow, then the ones the rig's lights cast away from it
  // (cast.js draws the critter's own contact shadow; only the lights' cast shadows are added here)
  out.push(shadowsOf(P, { x, y, r: CRITTER_CM * 0.38 }, CRITTER_CM * 0.95, Rg));
  // lit with ONE filter on the one critter (light.js lit): how much light reaches it (the rig's
  // ambient and directional light, plus the point lights, in full on the side turned to the lens
  // and partly wrapping round from the side), colored by the strongest light, with a rim on the
  // side facing it and a faint one toward a colored directional light (the moon in the window)
  const gain = (L.k + L.warm * 1.6 + Math.min(0.4, side * 0.5)) / ((core.LIGHT?.ambient ?? 0.42) + 0.4);
  const rims = [];
  let tint = null;
  let tintLevel = 0;
  if (side > 0.01 && src) {
    const towards = src.aperture ? mul(src.aperture.reduce((a, q) => add(a, q), [0, 0, 0]), 0.25) : src.pos;
    const sp = P(...towards);
    const sc = P(...chest);
    tint = src.color ?? 'warm';
    tintLevel = Math.min(0.6, L.warm * 0.6 + side * 0.35);
    rims.push({ side: [sp[0] - sc[0], sp[1] - sc[1]], color: tint, width: Math.max(3, 6 * s), soft: 0.5, level: Math.min(0.9, side * 1.3) });
  }
  for (const d of Rg.dirs) {
    if (!d.color || !(d.level > 0.02)) continue;
    const a = P(...chest);
    const b = P(...add(chest, mul([d.dir[0], d.dir[1], 0], 100)));
    const level = Math.min(0.8, d.level * 5) * (1 - Math.min(1, side * 2));
    if (level > 0.01) rims.push({ side: [b[0] - a[0], b[1] - a[1]], color: d.color, width: Math.max(2, 5 * s), soft: 0.4, level });
    if (!tint) {
      tint = d.color;
      tintLevel = Math.min(0.3, d.level * 2);
    }
  }
  out.push(lit(body, { gain: Rg.dark ? gain : Math.max(gain, 0.9), tint, tintLevel }));
  for (const r of rims) out.push(critterRim(feet[0], feet[1], { ...opts, s }, r));
  // its screen box (the body, arms down or out, a hat), for the framing check
  const box = [feet[0] - 84 * s, feet[1] - 160 * s, feet[0] + 84 * s, feet[1] + 6 * s];
  const dist = P.dist(x, y, z + CRITTER_CM / 2);
  const view = opts.view && opts.view !== 'front' ? opts.view : undefined;
  // its hands and what they hold (4.1): screen points, and world points on the critter's plane, so
  // a shot can frame a held prop (an insert) and a label can sit on it
  const o2 = { ...opts, s };
  const hs = handAt(feet[0], feet[1], o2);
  // the critter is a billboard standing upright at its feet, turned to the lens: a screen point on
  // it is the ray through that pixel meeting that vertical plane
  const nb = norm([P.pos[0] - x, P.pos[1] - y, 0]);
  const toWorld = ([sx, sy]) => {
    const dir = add(add(P.fwd, mul(P.right, (sx - (P.cx ?? P.w / 2)) / P.focal)), mul(P.up, -(sy - (P.cy ?? P.h / 2)) / P.focal));
    const den = dot(dir, nb);
    const t = Math.abs(den) < 1e-9 ? 0 : dot(sub([x, y, z], P.pos), nb) / den;
    return add(P.pos, mul(dir, t));
  };
  const hands = { l: hs.l, r: hs.r };
  const handsWorld = { l: toWorld(hs.l), r: toWorld(hs.r) };
  const held = {};
  const tags = [];
  for (const [side, hb] of Object.entries(heldBoxes(feet[0], feet[1], o2))) {
    const grip = gripAt(feet[0], feet[1], o2, side);
    held[side] = { ...hb, world: toWorld(hb.at), grip: { ...grip, world: toWorld([grip.x, grip.y]) } };
    // a held prop named in heldIds is an entity of its own: a shot's subject, a label's anchor
    const pid = opts.heldIds?.[side];
    if (pid) tags.push(g({ 'data-frame-kind': 'entity', 'data-frame-who': pid, 'data-frame-box': hb.box.map((v) => n2(v)).join(' '), 'data-frame-depth': n2(dist - 1) }, ''));
  }
  const svg = g({ 'data-frame-kind': 'critter', 'data-frame-who': opts.who ?? 'critter', 'data-frame-box': box.map((v) => n2(v)).join(' '), 'data-frame-depth': n2(dist), 'data-frame-view': view }, out) + tags.join('');
  return { svg, s, feet, box, at: [x, y, z], dist, hands, handsWorld, held };
}

/**
 * A camera for an insert or a close (4.1): it looks at the world point `target` from `dist` cm
 * away (or the distance at which a thing `size` cm across fills `fill` of the frame's height),
 * `deg` around it (0 = looking +y) and `elev` degrees above it. Use a held prop's
 * critterAt(…).held.r.world (or a hand's handsWorld) as the target: a 10 cm carton then reads,
 * instead of the 40 px it is in a medium shot. Returns { pos, target, fov } for lens().
 */
export function insertCamera(target, { size = 20, fill = 0.3, dist = null, deg = 0, elev = 12, fov = 40, h = 1920 } = {}) {
  const focal = h / 2 / Math.tan((fov / 2) * (Math.PI / 180));
  const d = dist ?? (focal * size) / (fill * h);
  const a = (deg * Math.PI) / 180;
  const e = (elev * Math.PI) / 180;
  const pos = [target[0] - d * Math.cos(e) * Math.sin(a), target[1] - d * Math.cos(e) * Math.cos(a), target[2] + d * Math.sin(e)];
  return { pos, target: [...target], fov };
}

// ── Depth: distance order and depth of field ──────────────────────────────────────────────

/** Depth of field: the blur (screen px) of a thing `dist` cm from the lens when the lens is
 *  focused at `focus` cm. aperture × |dist − focus| / dist (the circle of confusion), capped:
 *  sharp at the focus, more and more blurred as things come nearer the lens, and toward
 *  `aperture` px for things far behind. */
export function dofBlur(dist, focus, { aperture = 7, max = 26 } = {}) {
  if (!(focus > 0) || !(dist > 0)) return 0;
  return Math.min(max, (aperture * Math.abs(dist - focus)) / dist);
}

/**
 * Draw a shot through the lens P: `env` first, in the order given (the room: floor, walls, a
 * backdrop seen through a window, light on the floor), then `items` back to front by their real
 * distance from the lens (`at`: the world point that stands for the thing, e.g. the centre of
 * its footprint at mid-height), corrected by `bounds` (an item's world box) where things have
 * extent (paintOrder). Each thing blurs by its distance from `focus` (cm; animate it
 * for a rack focus); an env piece or item may give its own `blur` (px) or `sharp: true`.
 * Returns the SVG string.
 */
export function render(P, { env = [], items: given = [], focus: rawFocus = null, aperture = 7, max = 26, shot = null, local = 0 } = {}) {
  // 4.1: given a camera shot (shots.js), only its cast is drawn and depth of field is by intent:
  // sharp unless shot.focus { reason, on, to? } names it, and the entity in focus is never blurred
  const camShot = !!shot?.camera;
  const items = camShot && Array.isArray(shot.cast) ? given.filter((it) => !it || typeof it !== 'object' || !it.id || shot.cast.includes(it.id)) : given;
  let focus = camShot ? null : rawFocus;
  let keep = null;
  if (camShot && shot.focus?.on) {
    const find = (id) => items.find((it) => it && it.id === id && it.at);
    const a = find(shot.focus.on);
    const b = shot.focus.reason === 'rack' && shot.focus.to ? find(shot.focus.to) : null;
    const u = b ? E.world(clamp01((local - (shot.focus.at ?? 0.4)) / (shot.focus.dur ?? 0.7))) : 0;
    if (a) focus = b ? P.dist(...a.at) + (P.dist(...b.at) - P.dist(...a.at)) * u : P.dist(...a.at);
    keep = b && u >= 0.5 ? shot.focus.to : shot.focus.on;
  }
  const filters = new Map();
  const blurred = (svg, sd, who) => {
    const q = Math.round(sd * 2) / 2;
    if (q < 0.5) return svg;
    if (!filters.has(q)) filters.set(q, blurDef(q, { name: 'dof', box: 'bbox' }));
    return g({ 'data-blur': q, ...(who ? { 'data-blur-who': who } : {}), filter: filters.get(q).url }, svg);
  };
  // a piece is { svg, at?, blur?, sharp? } or a plain SVG string (quad, faceArt, cylinder,
  // floorShadow, … return strings): a string is drawn where it stands, sharp
  const norm2 = (it) => (typeof it === 'string' ? { svg: it, sharp: true } : it);
  const piece = (raw) => {
    const it = norm2(raw);
    const svg = typeof it.svg === 'function' ? it.svg(P) : it.svg ?? '';
    if (!svg) return '';
    if (it.sharp || focus === null || (keep && it.id === keep)) return svg;
    const sd = it.blur ?? (it.at ? dofBlur(P.dist(...it.at), focus, { aperture, max }) : 0);
    return blurred(svg, sd, it.id);
  };
  // the room is set: its signs may sit in the caption band or run off the frame (bounds.mjs)
  const back = env.filter(Boolean).map((it) => set(piece(it)));
  // items far to near; a plain string keeps its place in the list (after the item before it)
  let last = Infinity;
  const listed = items
    .filter(Boolean)
    .map((raw, i) => {
      const it = norm2(raw);
      const d = it.at ? P.dist(...it.at) : last;
      if (it.at) last = d;
      return { it, i, d };
    })
    .filter(({ it }) => it.svg);
  const sorted = paintOrder(P, listed).map(({ it }) => piece(it));
  const defs = [...filters.values()].map((f) => f.defs).join('');
  // marked as a lens picture, so frame() (and the try's framing check) know it was drawn
  // through a lens even when the frame passes no { lens }
  const camKey = [...P.pos, ...P.target, P.fov].map((v) => Math.round(v)).join(' ');
  return g({ 'data-lensed': '1' }, dedupeDefs(el('g', { 'data-cam': camKey }) + (defs ? el('defs', {}, defs) : '') + back.join('') + sorted.join('')));
}

/** Ids here are named from their content, so a gradient, clip or filter drawn by many solids is
 *  the same element many times: keep the first of each id, drop the copies (bytes, not looks). */
export function dedupeDefs(svg) {
  const seen = new Set();
  return String(svg).replace(/<(linearGradient|radialGradient|clipPath|filter) id="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g, (m, _tag, key) => {
    if (seen.has(key)) return '';
    seen.add(key);
    return m;
  });
}

/** Items in draw order (farthest first), for tests and tools: the same order render() paints. */
export function byDistance(P, items) {
  return paintOrder(P, items.map((it, i) => ({ it, i, d: P.dist(...it.at) }))).map(({ it }) => it);
}

/** Half the floor footprint a critter's body stands in for the paint order (cm): its body's
 *  depth, front to back (the billboard is drawn wider, but turned to the lens; a wider box would
 *  overlap a counter it stands right behind and lose the order). */
const CRITTER_HALF_CM = 14;
/** A thing's world box for the paint order: its `bounds` [[x0, y0, z0], [x1, y1, z1]] (cm); a
 *  critter (critterAt's svg; `at` its mid-height) the box its body stands in; else the point
 *  `at` (a box of no size), or null. */
function boundsOf(it) {
  const b = it.bounds;
  if (Array.isArray(b) && b.length === 2 && b.every((q) => Array.isArray(q) && q.length === 3)) {
    return [[Math.min(b[0][0], b[1][0]), Math.min(b[0][1], b[1][1]), Math.min(b[0][2], b[1][2])], [Math.max(b[0][0], b[1][0]), Math.max(b[0][1], b[1][1]), Math.max(b[0][2], b[1][2])]];
  }
  if (!it.at) return null;
  if (typeof it.svg === 'string' && /<g [^>]*data-frame-kind="critter"/.test(it.svg.slice(0, 600))) {
    const [x, y, z] = it.at;
    const h = CRITTER_CM / 2;
    return [[x - CRITTER_HALF_CM, y - CRITTER_HALF_CM, z - h], [x + CRITTER_HALF_CM, y + CRITTER_HALF_CM, z + h]];
  }
  return [it.at, it.at];
}
/** Must A be painted before B (B is in front of it)? +1 yes, −1 the other way, 0 undecided. Two
 *  world boxes that a plane along one axis separates: the one on the lens's side of the gap is
 *  in front (a counter in front of a critter, a pin on a table's top). */
function behind(P, A, B) {
  for (let k = 0; k < 3; k++) {
    if (A[1][k] <= B[0][k] + 1e-6) {
      if (P.pos[k] >= B[0][k]) return 1; // the lens is on B's side: A is behind B
      if (P.pos[k] <= A[1][k]) return -1;
    } else if (B[1][k] <= A[0][k] + 1e-6) {
      if (P.pos[k] >= A[0][k]) return -1;
      if (P.pos[k] <= B[1][k]) return 1;
    }
  }
  return 0;
}
/**
 * The paint order of render()'s items (4.1): farthest first by each item's `at`, corrected for
 * things with extent. An item may give `bounds` (its world box; setBuilder gives its fixtures
 * theirs); two items whose boxes a plane separates are painted back to front across that plane,
 * so a long counter no longer paints over the critter in front of it, and a pin on a table's top
 * is never covered by the table. A topological sort over those pairs, ties by distance.
 * @param {any} P  @param {Array<{ it: any, i: number, d: number }>} list
 */
export function paintOrder(P, list) {
  const base = [...list].sort((a, b) => b.d - a.d || a.i - b.i);
  const n = base.length;
  const bx = base.map(({ it }) => boundsOf(it));
  // only pairs where at least one thing has extent need more than their distance
  const sized = bx.map((b) => !!b && (b[0][0] !== b[1][0] || b[0][1] !== b[1][1] || b[0][2] !== b[1][2]));
  if (!sized.some(Boolean)) return base;
  const after = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    if (!bx[a]) continue;
    for (let b = a + 1; b < n; b++) {
      if (!bx[b] || !(sized[a] || sized[b])) continue;
      const r = behind(P, bx[a], bx[b]);
      if (r === 1) { after[a].push(b); indeg[b] += 1; }
      else if (r === -1) { after[b].push(a); indeg[a] += 1; }
    }
  }
  // Kahn's sort; among the ready ones, the farthest (the base order) first; a cycle (rare: three
  // boxes overlapping round each other) falls back to the base order for what is left
  const out = [];
  const done = new Array(n).fill(false);
  for (let step = 0; step < n; step++) {
    let pick = -1;
    for (let k = 0; k < n; k++) if (!done[k] && indeg[k] === 0) { pick = k; break; }
    if (pick < 0) pick = done.indexOf(false);
    done[pick] = true;
    out.push(base[pick]);
    for (const m of after[pick]) indeg[m] -= 1;
  }
  return out;
}

// ── Framing (hx-4.1): the subject and the cast stay in the safe area through a move ──────

/** The safe area (FRAME.safe): x 96–940, y 570–1600. The caption band above it (y 250–570)
 *  holds only background. */
export const SAFE = core.FRAME?.safe ?? { x0: 96, x1: 940, y0: 570, y1: 1600 };

/** The screen box of a world box (corner `at`, `size` [w, d, h] cm) through the lens. */
export function screenBox(P, at, size) {
  const xs = [];
  const ys = [];
  for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) {
    const q = P(at[0] + a * size[0], at[1] + b * size[1], at[2] + c * size[2]);
    xs.push(q[0]);
    ys.push(q[1]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Mark the beat's focal thing (the subject the eye and the focus go to): its drawing wrapped
 *  with its screen box, so framingProblems keeps it in the safe area and orangeProblems allows
 *  it the orange. `at`, `size`: its world box in cm. */
export function focal(P, at, size, svg, { name = 'focal' } = {}) {
  const box = screenBox(P, at, size);
  return g({ 'data-k': 'focus', 'data-frame-kind': 'focus', 'data-frame-who': name, 'data-frame-box': box.map((v) => n2(v)).join(' ') }, svg);
}

/** Mark a non-critter entity (a router box, a fridge) by id with its screen box, so a shot's
 *  subject, its labels and its cast checks can find it. `at`, `size`: its world box in cm. */
export function entity(P, id, at, size, svg) {
  const box = screenBox(P, at, size);
  return g({ 'data-frame-kind': 'entity', 'data-frame-who': id, 'data-frame-box': box.map((v) => n2(v)).join(' '), 'data-frame-depth': n2(P.dist(at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2)) }, svg);
}

/** How far a label may slide sideways off its anchor (or half its width, so the anchor stays under it). */
export const LABEL_REACH = 150;

/**
 * A label that belongs to entity `id`: anchored in world space at its top (`at` its feet or base
 * [x, y, z], `height` cm above it), projected through the shot's lens P. Hidden ('') when the
 * entity is out of the shot's cast or out of frame. It sits just above the anchor, slid along
 * its leader (never detached) to stay inside the safe area; a short leader joins it to the anchor
 * when it has slid. The label box is always clamped into `safe` (x 96–940, y 570–1600). `u` 0..1 pops it in. Carries data-label / -box / -anchor for labelProblems.
 */
export function labelFor(id, text, { P, shot = null, at, height = CRITTER_CM, lift = 14, size = 34, color = T.green, ink = T.canvas, u = 1, safe = SAFE } = {}) {
  if (!P || !at) throw new Error('labelFor: P (the shot lens) and at (the entity, world cm) are required');
  if (Array.isArray(shot?.cast) && !shot.cast.includes(id)) return '';
  const [ax, ay, depth] = P(at[0], at[1], (at[2] ?? 0) + height);
  if (depth <= (P.near ?? 5) + 1 || ax < 0 || ax > P.w || ay < 0 || ay > P.h) return '';
  const str = String(text);
  const w = Math.round(str.length * size * 0.56 + 44);
  const h = Math.round(size * 1.5);
  // above the anchor; slid along it (sideways, then down past it) into the safe area
  let cx = Math.min(safe.x1 - w / 2, Math.max(safe.x0 + w / 2, ax));
  let bottom = ay - lift;
  // slid down along its anchor into the safe area, as far as it still reads as attached;
  // an anchor far above the safe area (a head cropped into the caption band) takes no label
  if (bottom - h < safe.y0) {
    if (safe.y0 + h - bottom > LABEL_REACH) return '';
    bottom = safe.y0 + h;
  }
  bottom = Math.min(bottom, safe.y1);
  const reach = Math.max(LABEL_REACH, w / 2);
  cx = Math.max(ax - reach, Math.min(ax + reach, cx));
  // 4.1: whatever the anchor's offset, the label itself ends inside the safe area (the leader
  // still joins it to its anchor); a label wider than the safe area is centred in it
  cx = w >= safe.x1 - safe.x0 ? (safe.x0 + safe.x1) / 2 : Math.min(safe.x1 - w / 2, Math.max(safe.x0 + w / 2, cx));
  bottom = Math.min(safe.y1, Math.max(safe.y0 + h, bottom));
  const box = [cx - w / 2, bottom - h, cx + w / 2, bottom];
  const slid = Math.hypot(cx - ax, (bottom > ay ? box[1] : bottom) - ay) > lift + 6;
  const k = clamp01(u);
  const s = 0.8 + 0.2 * k;
  const body = [
    slid ? el('line', { x1: n2(ax), y1: n2(ay), x2: n2(cx), y2: n2(bottom > ay ? box[1] : bottom), stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round' }) : '',
    el('rect', { x: n2(box[0]), y: n2(box[1]), width: w, height: h, rx: n2(h / 2), fill: color }),
    el('text', { x: n2(cx), y: n2(box[1] + h / 2 + size * 0.35), 'text-anchor': 'middle', 'font-family': 'Roboto, Helvetica, Arial, sans-serif', 'font-weight': 500, 'font-size': size, fill: ink }, str.replace(/&/g, '&amp;').replace(/</g, '&lt;')),
  ].join('');
  return g({ 'data-label': id, 'data-label-text': str.replace(/"/g, ''), 'data-label-box': box.map(n2).join(' '), 'data-label-anchor': `${n2(ax)} ${n2(ay)}`, opacity: n2(Math.min(1, k * 2)), transform: k < 1 ? `translate(${n2(cx * (1 - s))} ${n2(bottom * (1 - s))}) scale(${n2(s)})` : undefined }, body);
}

/** The labels a lens frame's SVG carries ([{ who, text, box, anchor }], final screen px). */
export function framedLabels(svg) {
  const m = String(svg).match(/data-lens="([^"]+)"/);
  const [zoom, cx, cy, px, py] = m ? m[1].split(' ').map(Number) : [1, 0, 0, 540, 960];
  const map = ([x, y]) => [px + zoom * (x - px - cx), py + zoom * (y - py - cy)];
  const out = [];
  for (const t of String(svg).matchAll(/<g [^>]*data-label="[^"]+"[^>]*>/g)) {
    const attr = (k) => t[0].match(new RegExp(`data-label${k}="([^"]*)"`))?.[1];
    const raw = (attr('-box') ?? '').split(' ').map(Number);
    const an = (attr('-anchor') ?? '').split(' ').map(Number);
    if (raw.length !== 4 || !raw.every(Number.isFinite)) continue;
    const a = map([raw[0], raw[1]]);
    const b = map([raw[2], raw[3]]);
    out.push({ who: attr(''), text: attr('-text') ?? '', box: [a[0], a[1], b[0], b[1]], anchor: an.length === 2 ? map(an) : null });
  }
  return out;
}

/** The boxes a lens frame's SVG carries ([{ kind, who, box, raw }]: `box` in final screen px,
 *  after the frame's own 2D framing; `raw` as the lens drew it, where a shot's `on` point lives),
 *  or null for a frame drawn without a lens. */
export function framedBoxes(svg) {
  const m = String(svg).match(/data-lens="([^"]+)"/);
  if (!m) return null;
  const [zoom, cx, cy, px, py] = m[1].split(' ').map(Number);
  const map = ([x, y]) => [px + zoom * (x - px - cx), py + zoom * (y - py - cy)];
  const out = [];
  for (const t of String(svg).matchAll(/<g [^>]*data-frame-kind="[^"]+"[^>]*>/g)) {
    const attr = (k) => t[0].match(new RegExp(`data-frame-${k}="([^"]+)"`))?.[1];
    const raw = (attr('box') ?? '').split(' ').map(Number);
    if (raw.length !== 4 || !raw.every(Number.isFinite)) continue;
    const a = map([raw[0], raw[1]]);
    const b = map([raw[2], raw[3]]);
    const depth = Number(attr('depth'));
    const view = attr('view');
    out.push({ kind: attr('kind'), who: attr('who'), box: [a[0], a[1], b[0], b[1]], raw, ...(Number.isFinite(depth) ? { depth } : {}), ...(view ? { view } : {}) });
  }
  return out;
}

const sampleBoxes = (smp) => smp.boxes ?? (smp.svg !== undefined ? framedBoxes(smp.svg) : null);
const onScreen = ([x0, y0, x1, y1], w, h) => x1 > 0 && x0 < w && y1 > 0 && y0 < h;

/** The subject of a shot among a sample's boxes: the marked focal under the shot's `on` point
 *  (as drawn), else the nearest focal within `near` px of it; with no shot, every focal. */
function subjectsOf(boxes, shot, near = 260) {
  if (shot?.camera) return shot.subject ? boxes.filter((b) => b.who === shot.subject) : boxes.filter((b) => b.kind === 'focus');
  const focals = boxes.filter((b) => b.kind === 'focus');
  if (!shot?.on) return focals;
  const [ox, oy] = shot.on;
  const raw = (b) => b.raw ?? b.box;
  const inside = focals.filter((b) => ox >= raw(b)[0] && ox <= raw(b)[2] && oy >= raw(b)[1] && oy <= raw(b)[3]);
  if (inside.length) return inside;
  const d = (b) => Math.hypot((raw(b)[0] + raw(b)[2]) / 2 - ox, (raw(b)[1] + raw(b)[3]) / 2 - oy);
  const best = focals.sort((a, b2) => d(a) - d(b2))[0];
  return best && d(best) <= near ? [best] : [];
}

/**
 * The framing check for a lens frame's samples ([{ t, svg }] or [{ t, boxes }]), in time order:
 * the SUBJECT of each shot (the focal marked with focal(), under the shot's `on` point) is whole
 * and inside the safe area at the shot's rest poses (its first and last sample). Close, reaction
 * and insert shots crop the rest of the scene by design, and every critter is drawn in every shot
 * (EX3-90), so other critters are never flagged, and anything wholly off screen is ignored.
 * `shots`: the frame's shot list (shots.js); without it the whole frame is one shot and every
 * focal is a subject. Samples of a frame drawn without a lens are skipped. Each problem is
 * reported once, at its first time.
 */
export function framingProblems(samples, { safe = SAFE, w = 1080, h = 1920, slack = 2, shots = null } = {}) {
  const list = (samples ?? []).map((smp) => ({ smp, boxes: sampleBoxes(smp) })).filter((x) => x.boxes);
  if (!list.length) return [];
  // the shot of each sample, and each shot's first and last sample (its rest poses)
  const shotOf = (t) => {
    if (!Array.isArray(shots) || !shots.length || typeof t !== 'number') return { i: 0, shot: null };
    let i = 0;
    for (let k = 0; k < shots.length; k++) if (t >= shots[k].at) i = k;
    return { i, shot: shots[i] };
  };
  const rest = new Set();
  list.forEach((x, k) => {
    const cur = shotOf(x.smp.t).i;
    const prev = k > 0 ? shotOf(list[k - 1].smp.t).i : -1;
    const next = k < list.length - 1 ? shotOf(list[k + 1].smp.t).i : -1;
    if (cur !== prev || cur !== next) rest.add(k);
  });
  const seen = new Set();
  const out = [];
  list.forEach(({ smp, boxes }, k) => {
    if (!rest.has(k)) return;
    const { i, shot } = shotOf(smp.t);
    const at = typeof smp.t === 'number' ? ` at ${smp.t.toFixed(2)}s` : '';
    const inShot = shot ? ` (shot ${i + 1}, ${shot.kind})` : '';
    for (const { who, box } of subjectsOf(boxes, shot)) {
      if (!onScreen(box, w, h)) continue;
      const [x0, y0, x1, y1] = box;
      const name = `the subject "${who}"`;
      const cut = [x0 < -slack && 'left', x1 > w + slack && 'right', y0 < -slack && 'top', y1 > h + slack && 'bottom'].filter(Boolean);
      if (cut.length) {
        const key = `cut:${who}:${i}`;
        if (!seen.has(key)) out.push(`${name} is cut by the ${cut.join(' and ')} edge of the frame${at}${inShot}: frame the shot's subject whole`);
        seen.add(key);
        continue;
      }
      const off = [x0 < safe.x0 - slack && `left of x ${safe.x0}`, x1 > safe.x1 + slack && `right of x ${safe.x1}`, y0 < safe.y0 - slack && `above y ${safe.y0} (the caption band holds only background)`, y1 > safe.y1 + slack && `below y ${safe.y1}`].filter(Boolean);
      if (off.length) {
        const key = `safe:${who}:${i}`;
        if (!seen.has(key)) out.push(`${name} leaves the safe area${at}${inShot}: ${off.join(', ')} (box ${box.map((v) => Math.round(v)).join(' ')}); keep it inside x ${safe.x0}–${safe.x1}, y ${safe.y0}–${safe.y1}`);
        seen.add(key);
      }
    }
  });
  return out;
}

/** The samples at each shot's rest poses (its first and last), with their shot: [{ smp, boxes,
 *  i, shot }] (the whole frame is one shot without a list). */
function restPoses(samples, shots) {
  const list = (samples ?? []).map((smp) => ({ smp, boxes: sampleBoxes(smp) })).filter((x) => x.boxes);
  const shotOf = (t) => {
    if (!Array.isArray(shots) || !shots.length || typeof t !== 'number') return { i: 0, shot: null };
    let i = 0;
    for (let k = 0; k < shots.length; k++) if (t >= shots[k].at) i = k;
    return { i, shot: shots[i] };
  };
  return list
    .map((x, k) => ({ ...x, ...shotOf(x.smp.t), k }))
    .filter((x, k, all) => k === 0 || k === all.length - 1 || all[k - 1].i !== x.i || all[k + 1].i !== x.i);
}

/** Of a critter's box, the share of its body that is its face width (the box spans the arms). */
const BODY_OF_BOX = 132 / 168;
/** A critter hidden behind a nearer one past this share is lost to the viewer. */
export const MAX_HIDDEN = 0.4;
/** In a 4.1 camera shot (shot.camera) the bar is this: never overlap to fit (principles §3). */
export const MAX_HIDDEN_SHOT = 0.15;
/** Outside a close, insert or reaction shot, no critter's face fills more than this share of the
 *  frame's width. */
export const MAX_FACE = 0.45;
/** The shot kinds that may frame a critter big (principles §3: an insert framed from the side with
 *  the critter in the picture, a close for how they feel). */
export const BIG_OK = ['close', 'insert', 'reaction'];
/** The face zone of a critter's box (critterAt's box: feet ± 84 s, −160 s … +6 s; the face is the
 *  eye and mouth keep-out, x ±51, y −134 … −39 at s = 1): [x0, y0, x1, y1] on screen. */
export function faceBoxOf(box) {
  const s = (box[3] - box[1]) / 166;
  const fx = (box[0] + box[2]) / 2;
  const fy = box[3] - 6 * s;
  return [fx - 51 * s, fy - 134 * s, fx + 51 * s, fy - 39 * s];
}
/** Which frame edge cuts a critter's face ('left', 'top'…), or null when the face is whole on
 *  screen or wholly off it. A critter turned away (view back) has no face to cut. */
function faceEdgeCut(b, w, h) {
  if (b.view === 'back') return null;
  const [x0, y0, x1, y1] = faceBoxOf(b.box);
  if (x1 <= 0 || x0 >= w || y1 <= 0 || y0 >= h) return null;
  const e = [x0 < 0 && 'left', x1 > w && 'right', y0 < 0 && 'top', y1 > h && 'bottom'].filter(Boolean);
  return e.length ? e.join(' and ') : null;
}

/**
 * The occlusion check for a lens frame's samples (in time order), at each shot's rest poses: a
 * critter more than MAX_HIDDEN covered by a nearer critter's box (critterAt carries both box and
 * depth), a critter's face (its body) wider than MAX_FACE of the frame outside a close, insert or
 * reaction shot (BIG_OK, a "giant face"), and a face cut by the frame's edge (in any shot: a face
 * is whole on screen or wholly off it). Off-screen critters are ignored; frames without a lens
 * are skipped.
 */
export function occlusionProblems(samples, { shots = null, w = 1080, h = 1920 } = {}) {
  const seen = new Set();
  const out = [];
  for (const { smp, boxes, i, shot } of restPoses(samples, shots)) {
    const at = typeof smp.t === 'number' ? ` at ${smp.t.toFixed(2)}s` : '';
    const inShot = shot ? ` (shot ${i + 1}, ${shot.kind})` : '';
    const cr = boxes.filter((b) => b.kind === 'critter' && onScreen(b.box, w, h));
    for (const a of cr) {
      const [x0, y0, x1, y1] = a.box;
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      // the share of it the nearer critters cover (their union, approximated by the largest)
      let hidden = 0;
      let by = null;
      for (const b of cr) {
        if (b === a || !(b.depth < a.depth)) continue;
        const ix = Math.max(0, Math.min(x1, b.box[2]) - Math.max(x0, b.box[0]));
        const iy = Math.max(0, Math.min(y1, b.box[3]) - Math.max(y0, b.box[1]));
        if ((ix * iy) / area > hidden) {
          hidden = (ix * iy) / area;
          by = b.who;
        }
      }
      const key = `hid:${a.who}:${i}`;
      if (hidden > (shot?.camera ? MAX_HIDDEN_SHOT : MAX_HIDDEN) && !seen.has(key)) {
        seen.add(key);
        out.push(`the critter "${a.who}" is ${Math.round(hidden * 100)}% hidden behind "${by}"${at}${inShot}: move one of them, or the camera, so each reads`);
      }
      // the part of the frame it fills: its body's width, as much of it as is on screen
      const bodyPad = ((x1 - x0) * (1 - BODY_OF_BOX)) / 2;
      const face = Math.max(0, Math.min(x1 - bodyPad, w) - Math.max(x0 + bodyPad, 0)) / w;
      const fkey = `face:${a.who}:${i}`;
      // a critter turned away (an over-the-shoulder foreground) shows no face to be giant; a close,
      // an insert and a reaction frame a critter big on purpose (principles §3, §4)
      if (face > MAX_FACE && !BIG_OK.includes(shot?.kind) && a.view !== 'back' && !seen.has(fkey)) {
        seen.add(fkey);
        out.push(`the critter "${a.who}" fills ${Math.round(face * 100)}% of the frame's width${at}${inShot}: a giant face belongs to a close, an insert or a reaction shot; pull the camera back`);
      }
      // a face is whole or out of the frame entirely: never cut by the frame's edge (any shot)
      const cutBy = faceEdgeCut(a, w, h);
      const ckey = `edge:${a.who}:${i}`;
      if (cutBy && !seen.has(ckey)) {
        seen.add(ckey);
        out.push(`the face of "${a.who}" is cut by the ${cutBy} edge of the frame${at}${inShot}: a face in the frame stays whole; frame it in, or crop the head out entirely (an insert on the hands)`);
      }
    }
  }
  return out;
}

/** The critters a lens frame's sample shows (their boxes meet the visible frame), or null for a
 *  frame drawn without a lens (try's crowd check counts only what is on screen). */
export function visibleCritters(svg, { w = 1080, h = 1920 } = {}) {
  const boxes = framedBoxes(svg);
  if (!boxes) return null;
  return [...new Set(boxes.filter((b) => b.kind === 'critter' && onScreen(b.box, w, h)).map((b) => b.who))];
}

/**
 * The orange check for a lens frame's samples ([{ t, svg }]): orange is the hero's and the one
 * focal's (EX3-139, FRAME.md's focal). A kit solid drawn in orange (data-tone="orange") that is
 * neither part of a critter nor inside the marked focal is an error, and so are two orange
 * focals at once. Only the kit's solids are checked (certain, not guessed from colors); critters
 * are CAST's check. Frames drawn without a lens are skipped.
 */
export function orangeProblems(samples) {
  const seen = new Set();
  const out = [];
  for (const smp of samples ?? []) {
    const svg = smp.svg === undefined ? '' : String(smp.svg);
    if (!/data-lens="/.test(svg)) continue;
    const at = typeof smp.t === 'number' ? ` at ${smp.t.toFixed(2)}s` : '';
    const stack = [];
    let strays = 0;
    const focals = new Set();
    let focusSeq = 0;
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
      const [, close, , attrs, self] = m;
      if (close) {
        stack.pop();
        continue;
      }
      const isFocus = /data-k="focus"/.test(attrs);
      const frame = { who: /data-who="/.test(attrs), focus: isFocus ? ++focusSeq : 0 };
      if (/data-tone="orange"/.test(attrs)) {
        if (stack.some((f) => f.who) || frame.who) {
          // a critter's own orange: CAST holds it to the hero
        } else {
          const f = [...stack].reverse().find((x) => x.focus);
          if (f) focals.add(f.focus);
          else strays += 1;
        }
      }
      if (!self) stack.push(frame);
    }
    if (strays && !seen.has('stray')) {
      out.push(`${strays} orange solid${strays > 1 ? 's are' : ' is'} drawn${at} that ${strays > 1 ? 'are' : 'is'} neither the hero nor the focal: orange is only ever the hero's and the one focal's (EX3-139); give ${strays > 1 ? 'them' : 'it'} another palette color`);
      seen.add('stray');
    }
    if (focals.size > 1 && !seen.has('focals')) {
      out.push(`${focals.size} orange focals${at}: exactly one focal per beat carries the orange`);
      seen.add('focals');
    }
  }
  return out;
}

export { untag };
