// The Explainers world kit, set design (4.1, principles §1): a place you could walk into, for any
// topic. The scene builder writes a set brief (SET) in world.js and builds the set from these
// general primitives, all in world centimetres through the lens.js perspective camera (x right,
// y away from the camera, z up) and lit by its rig. Nothing here is a kitchen or an ER: a place
// is architecture (room shells, walls with openings), materials (finishes with their own ramp and
// pattern), fixtures (runs, shelving, desks, beds, drapes, signs, lamps), dressing at a declared
// density, a foreground framing piece, and a place beyond seen through the openings.
//
//   SET brief         { place, tells[3–5], architecture, materials, colorStory[2–3], layers,
//                       beyond, density }      setBriefProblems(SET) → error strings
//   setBuilder(P, R, SET)   collects { env, items } for lens.render and the set's meta
//     .room({ x, y, h, walls, floor, wall, openings, skirting, dado, cornice, ceiling, enclose })
//     .wall(...)  .run(...)  .shelving(...)  .desk(...)  .chair(...)  .bed(...)  .drape(...)
//     .sign(...)  .lamp(...)  .beam(...)  .solid(...)  .dress(...)  .foreground(...)
//     .piece(svg, at, { tell })  .beyond(svg, at, { tell, clip })
//     .done() → { env, items, meta, lights }
//   ceiling 'flat' | 'beamed' | 'none' (CEILING_MAX_SHARE of the frame at most: ceilingShare
//                       measures a camera, fitCeiling(cam, room) lowers its aim until it fits)
//   run({ h: 'critter' }) a counter a critter's whole face shows over (CRITTER_COUNTER_CM, the
//                       chin line; runHeight) · faceCutProblems(svg) a face cut by a set piece
//   beyond { tell, volumes: [{ …, tell }], custom: (P, R, ctx) → svg | { svg, tell } }
//   surface(P, R, pts, mat)   a flat world quad finished in a material (MATERIALS)
//   setProblems(metaOrSvg, SET?)   the set check for try.mjs: walls/corner/opening, the three
//                       layers, materials on large surfaces, tells built, beyond behind openings
//
// Every color is a palette token (core TOKENS) or a mix of two; orange never appears in a set.
// Patterns are drawn in the surface's own shaded color, a few percent darker or lighter, so the
// set reads rich up close and calm in value at a glance; the read keeps orange and the light.

import { mixHex, rng, resolveTone, toneHex, CRITTER_CM, CRITTER_PX } from './core.js';
import { FACE_KEEPOUT } from './outfits.js';
import { T, el, g, id, isDark, TONES, tonesOf } from './draw.js';
import { blurDef, hashId, V3 } from './light.js';
import * as K from './lens.js';

const { add, sub, mul, dot, cross, norm, len } = V3;
const add3 = add;
const n1 = (v) => Math.round(v * 10) / 10;
const n2 = (v) => Number(v.toFixed(2));
const ptsAttr = (s) => s.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' ');

// ── Palette ───────────────────────────────────────────────────────────────────────────────

const ORANGE_RE = /^orange|^stage-orange|^sun-/;

/** A tone a set may use: a TONES ramp name, a palette token, `{ mix: [a, b, k] }` of two tokens,
 *  a material name (its base tone), or a hex already mixed from the palette. Returns what lens solids accept (ramp name or hex).
 *  It is core resolveTone (the one resolver the lens and draw solids use too), with paper for
 *  nothing given; an unknown color throws with the allowed names. A ready faces object
 *  (draw.js TONES entry) passes through. */
export function tone(v) {
  if (!v) return 'paper';
  if (typeof v === 'object' && !Array.isArray(v.mix) && (v.top || v.base)) return v;
  // a material's name stands for its base tone ('wood' is the wood ramp, not paper)
  if (typeof v === 'string' && MATERIALS[v] && !T[v] && !TONES[v]) return material(v).tone;
  return resolveTone(v);
}
const hexOf = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v.mix)) return tonesOf(v).base ?? tonesOf(v).right;
  return toneHex(v ?? 'paper');
};
/** The problem with a tone, or null. */
export function toneProblem(v, where = 'tone') {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object' && Array.isArray(v.mix)) {
    const bad = v.mix.slice(0, 2).map((x) => toneProblem(x, where)).find(Boolean);
    return bad ?? null;
  }
  if (typeof v !== 'string') return `${where} must be a palette token name or { mix: [a, b, k] }`;
  if (ORANGE_RE.test(v)) return `${where} is "${v}": orange belongs to the hero and the one focal, never the set`;
  if (TONES[v] || T[v] || v === 'white') return null;
  return `${where} "${v}" is not a palette token (FRAME.md colors: ${Object.keys(T).filter((k) => !ORANGE_RE.test(k)).slice(0, 12).join(', ')}, …)`;
}

// ── Materials ─────────────────────────────────────────────────────────────────────────────

/** Surface finishes: each a base tone, a pattern drawn in cm, and its defaults. A material spec
 *  is a name ('tile') or { kind, tone?, accent?, size?, ... } overriding them. */
export const MATERIALS = {
  plaster: { tone: 'paper', pattern: 'none' },
  paint: { tone: 'paper', pattern: 'none' },
  tile: { tone: 'paper-lit', pattern: 'grid', size: [15, 15], joint: 0.5 },
  subway: { tone: 'paper-lit', pattern: 'bond', size: [15, 7.5], joint: 0.45 },
  brick: { tone: { mix: ['paper-shade', 'yellow-dark', 0.28] }, pattern: 'bond', size: [22.5, 7.5], joint: 1, vary: 0.08 },
  wood: { tone: { mix: ['paper-shade', 'yellow-dark', 0.32] }, pattern: 'planks', size: [120, 14], joint: 0.4, vary: 0.07 },
  planks: { tone: { mix: ['paper-shade', 'yellow-dark', 0.32] }, pattern: 'planks', size: [120, 14], joint: 0.4, vary: 0.07 },
  panel: { tone: { mix: ['paper-shade', 'yellow-dark', 0.25] }, pattern: 'vgroove', size: [10, 100], joint: 0.4 },
  linoleum: { tone: { mix: ['paper-shade', 'teal-lit', 0.18] }, pattern: 'fleck', size: [40, 40] },
  carpet: { tone: { mix: ['paper-shade', 'blue-dark', 0.22] }, pattern: 'carpet', size: [50, 50], vary: 0.05 },
  steel: { tone: { mix: ['paper-shade', 'ink-lit', 0.12] }, pattern: 'brushed', size: [100, 100], joint: 0.4 },
  concrete: { tone: { mix: ['paper-shade', 'ink-lit', 0.1] }, pattern: 'slab', size: [150, 150], joint: 0.6 },
  terrazzo: { tone: 'paper-lit', pattern: 'terrazzo', size: [30, 30] },
  'raised-floor': { tone: { mix: ['paper-shade', 'ink-lit', 0.08] }, pattern: 'perforated', size: [60, 60], joint: 0.8 },
  glass: { tone: { mix: ['teal-lit', 'paper-lit', 0.6] }, pattern: 'glass', size: [120, 240], joint: 4 },
  fabric: { tone: { mix: ['paper-shade', 'blue', 0.2] }, pattern: 'none' },
};

/** A material spec as { kind, tone (lens tones), accent, size, joint, vary, pattern }. */
export function material(spec) {
  if (!spec) return null;
  const o = typeof spec === 'string' ? { kind: spec } : spec;
  const base = MATERIALS[o.kind];
  if (!base) throw new Error(`set.material: unknown kind "${o.kind}" (${Object.keys(MATERIALS).join(', ')})`);
  return { ...base, ...o, tone: tone(o.tone ?? base.tone), accent: o.accent ? hexOf(o.accent) : null };
}

/** The SVG <pattern> of a material in cm (u right, v down), drawn in shades of `base`. */
function patternDef(m, base, key) {
  const [w, h] = m.size ?? [50, 50];
  const j = m.joint ?? 0.5;
  const dark = isDark();
  const line = mixHex(base, dark ? T['ink-dark'] : T['shadow-warm'], dark ? 0.3 : 0.16);
  const lite = mixHex(base, T.canvas, dark ? 0.06 : 0.28);
  const alt = mixHex(base, m.accent ?? (dark ? T['ink-dark'] : T['shadow-warm']), m.accent ? 0.5 : m.vary ?? 0.06);
  const r = rng(hashId(key).length * 7 + w * 13 + h);
  let pw = w;
  let ph = h;
  const s = [];
  const rect = (x, y, ww, hh, fill, op = 1) => s.push(el('rect', { x: n2(x), y: n2(y), width: n2(ww), height: n2(hh), fill, opacity: op }));
  switch (m.pattern) {
    case 'grid':
      rect(0, 0, w, j, line); rect(0, 0, j, h, line); rect(j, j, w - j, j * 0.8, lite, 0.5);
      break;
    case 'bond':
      pw = w; ph = h * 2;
      if (m.vary) { rect(0, 0, w, h, alt, 0.6); rect(w / 2, h, w / 2, h, alt, 0.35); }
      rect(0, 0, w, j, line); rect(0, h, w, j, line); rect(0, 0, j, h, line); rect(w / 2, h, j, h, line);
      rect(j, j, w - j, j * 0.7, lite, 0.45); rect(j, h + j, w - j, j * 0.7, lite, 0.45);
      break;
    case 'planks': {
      pw = w; ph = h * 4;
      for (let i = 0; i < 4; i++) {
        const off = [0, 0.5, 0.25, 0.75][i] * w;
        if (i % 2) rect(0, i * h, w, h, alt, 0.5);
        rect(0, i * h, w, j, line);
        rect(off, i * h, j, h, line);
        for (let k = 1; k < 3; k++) s.push(el('path', { d: `M ${n2(off + 6)} ${n2(i * h + h * (k / 3) + (r() - 0.5) * 2)} q ${n2(w * 0.3)} ${n2((r() - 0.5) * 2)} ${n2(w * 0.6)} 0`, stroke: line, 'stroke-width': n2(j * 0.5), fill: 'none', opacity: 0.35 }));
      }
      break;
    }
    case 'vgroove':
      rect(0, 0, j, h, line); rect(j, 0, j * 0.8, h, lite, 0.4);
      break;
    case 'fleck':
      for (let i = 0; i < 14; i++) s.push(el('circle', { cx: n2(r() * w), cy: n2(r() * h), r: n2(0.35 + r() * 0.5), fill: i % 3 ? line : lite, opacity: 0.55 }));
      break;
    case 'carpet':
      pw = w * 2; ph = h * 2;
      rect(0, 0, w, h, alt, 0.5); rect(w, h, w, h, alt, 0.5);
      for (let i = 0; i < 40; i++) s.push(el('circle', { cx: n2(r() * pw), cy: n2(r() * ph), r: 0.4, fill: line, opacity: 0.3 }));
      break;
    case 'brushed':
      for (let i = 0; i < 12; i++) rect(0, (i / 12) * h, w, 0.25, i % 2 ? line : lite, 0.25);
      rect(0, 0, w, j, line); rect(0, 0, j, h, line);
      break;
    case 'slab':
      rect(0, 0, w, j, line); rect(0, 0, j, h, line);
      for (let i = 0; i < 10; i++) s.push(el('circle', { cx: n2(r() * w), cy: n2(r() * h), r: n2(0.4 + r()), fill: line, opacity: 0.25 }));
      break;
    case 'terrazzo': {
      const chips = [T['paper-shade'], T['teal-lit'], T['ink-lit'], T['yellow-lit'], T['paper-dark']];
      for (let i = 0; i < 26; i++) s.push(el('circle', { cx: n2(r() * w), cy: n2(r() * h), r: n2(0.3 + r() * 0.9), fill: mixHex(base, chips[i % chips.length], 0.55), opacity: 0.8 }));
      break;
    }
    case 'perforated':
      rect(0, 0, w, j, line); rect(0, 0, j, h, line); rect(j, j, w - j, j, lite, 0.6);
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) s.push(el('circle', { cx: n2(8 + a * 9), cy: n2(8 + b * 9), r: 1.2, fill: line, opacity: 0.35 }));
      break;
    case 'glass':
      rect(0, 0, w, j, line); rect(0, 0, j, h, line);
      s.push(el('path', { d: `M ${n2(w * 0.15)} ${n2(h)} L ${n2(w * 0.55)} 0 L ${n2(w * 0.68)} 0 L ${n2(w * 0.28)} ${n2(h)} Z`, fill: T.canvas, opacity: dark ? 0.06 : 0.22 }));
      break;
    default:
      return null;
  }
  const pid = id(`mat-${hashId(`${key}|${base}|${m.pattern}|${pw}x${ph}|${j}`)}`);
  return { pid, def: el('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: n2(pw), height: n2(ph) }, s.join('')) };
}

/** Screen path of world points, clipped at the lens's near plane. */
function screenPath(P, pts) {
  const cut = K.clipNear(P, pts);
  if (cut.world.length < 3) return '';
  return `M ${cut.screen.map((q) => `${n1(q[0])} ${n1(q[1])}`).join(' L ')} Z`;
}

/**
 * A flat world quad (4 points, the first three give its plane; corner order: top-left, top-right,
 * bottom-right, bottom-left as seen from its front) finished in a material: its color from the
 * rig, the material's pattern laid on it in cm, a soft falloff toward its lower edge. `holes`
 * (world polygons on the face) are cut out. `n` overrides the normal. Returns an SVG string.
 */
export function surface(P, R, pts, mat, { n, holes = [], falloff = 0.12, cells = 4, origin, opacity = 1 } = {}) {
  const m = material(mat);
  const nn = norm(n ?? cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
  const mid = mul(pts.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / pts.length);
  const base = K.shade(m ? m.tone : 'paper', nn, mid, R);
  const outline = screenPath(P, pts);
  if (!outline) return '';
  const d = [outline, ...holes.map((h) => screenPath(P, h)).filter(Boolean)].join(' ');
  const key = hashId(d);
  const cid = id(`srf-${key}`);
  // holes are cut with even-odd inside the outline only (a hole reaching past this face, a tall
  // window over a dado band, must not paint the part outside it)
  const oid = id(`srfo-${hashId(outline)}`);
  const defs = [el('clipPath', { id: cid }, el('path', { d, 'clip-rule': 'evenodd' })), el('clipPath', { id: oid }, el('path', { d: outline }))];
  const body = [el('path', { d, fill: base, 'fill-rule': 'evenodd' })];
  if (m) {
    const pd = patternDef(m, base, m.kind);
    if (pd) {
      defs.push(pd.def);
      const o = origin ?? pts[0];
      const U = sub(pts[1], pts[0]);
      const V = sub(pts[3], pts[0]);
      const w = len(U);
      const h = len(V);
      // only the part of the face in front of the lens carries the pattern (a floor or side wall
      // running behind the camera would map its cells through the near plane); the pattern stays
      // anchored to the face, so it never swims as the camera moves
      const [u0, u1, v0, v1] = frontRange(P, o, U, V);
      if (u1 > u0 && v1 > v0) {
        const inner = g({ transform: `translate(${n2(-u0 * w)} ${n2(-v0 * h)})` }, el('rect', { x: n2(u0 * w - 2), y: n2(v0 * h - 2), width: n2((u1 - u0) * w + 4), height: n2((v1 - v0) * h + 4), fill: `url(#${pd.pid})` }));
        body.push(K.faceArt(P, add(add(o, mul(U, u0)), mul(V, v0)), mul(U, u1 - u0), mul(V, v1 - v0), inner, { clip: false, cells }));
      }
    }
  }
  if (falloff > 0) {
    // the face sinks toward its lower (or nearer, for a floor) edge, and lifts toward the light
    const up = Math.abs(nn[2]) > 0.7;
    const a = up ? P(...V3.lerp(pts[0], pts[1], 0.5)) : P(...V3.lerp(pts[0], pts[1], 0.5));
    const b = up ? P(...V3.lerp(pts[3], pts[2], 0.5)) : P(...V3.lerp(pts[3], pts[2], 0.5));
    const gid = id(`srfg-${hashId(`${n1(a[0])},${n1(a[1])},${n1(b[0])},${n1(b[1])}`)}`);
    const sh = isDark() ? T['ink-dark'] : T['shadow-warm'];
    defs.push(el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n1(a[0]), y1: n1(a[1]), x2: n1(b[0]), y2: n1(b[1]) }, [
      el('stop', { offset: 0, 'stop-color': up ? sh : T.canvas, 'stop-opacity': up ? n2(falloff * 0.6) : n2(falloff * 0.5) }),
      el('stop', { offset: 0.5, 'stop-color': sh, 'stop-opacity': 0 }),
      el('stop', { offset: 1, 'stop-color': sh, 'stop-opacity': n2(falloff) }),
    ].join('')));
    body.push(el('path', { d, fill: `url(#${gid})`, 'fill-rule': 'evenodd' }));
  }
  const attrs = { 'clip-path': `url(#${cid})`, 'data-set-mat': m ? m.kind : 'none' };
  if (opacity < 1) attrs.opacity = n2(opacity);
  const out = g(attrs, body);
  return el('defs', {}, defs.join('')) + (holes.length ? g({ 'clip-path': `url(#${oid})` }, out) : out);
}

/** The parameter box [u0, u1, v0, v1] of the face o + uU + vV in front of the lens (depth is
 *  linear in u and v, so each axis is clamped where its corner depths cross the near limit). */
function frontRange(P, o, U, V) {
  const lim = (P.near ?? 5) + 12;
  const d = (u, v) => dot(sub(add(add(o, mul(U, u)), mul(V, v)), P.pos), P.fwd);
  const d00 = d(0, 0);
  const a = d(1, 0) - d00;
  const b = d(0, 1) - d00;
  let [u0, u1, v0, v1] = [0, 1, 0, 1];
  const clampAxis = (k, base, lo, hi) => {
    // base + k·t ≥ lim on [lo, hi]
    if (Math.abs(k) < 1e-6) return base >= lim ? [lo, hi] : [1, 0];
    const t = (lim - base) / k;
    return k > 0 ? [Math.max(lo, t), hi] : [lo, Math.min(hi, t)];
  };
  if (Math.abs(b) <= Math.abs(a)) {
    [u0, u1] = clampAxis(a, Math.min(d00, d00 + b), 0, 1);
    if (Math.min(d00 + a * u0, d00 + a * u0 + b) < lim) [v0, v1] = clampAxis(b, d00 + a * u0, 0, 1);
  } else {
    [v0, v1] = clampAxis(b, Math.min(d00, d00 + a), 0, 1);
    if (Math.min(d00 + b * v0, d00 + b * v0 + a) < lim) [u0, u1] = clampAxis(a, d00 + b * v0, 0, 1);
  }
  return [u0, u1, v0, v1];
}

/** Soft occlusion along a world edge (a corner, the floor line): a blurred dark stroke. */
export function aoEdge(P, a, b, { width = 10, level = 0.14 } = {}) {
  const lim = (P.near ?? 5) + 12;
  const da = dot(sub(a, P.pos), P.fwd);
  const db = dot(sub(b, P.pos), P.fwd);
  if (da < lim && db < lim) return '';
  if (da < lim) a = V3.lerp(a, b, (lim - da) / (db - da));
  if (db < lim) b = V3.lerp(b, a, (lim - db) / (da - db));
  const s = [P(...a), P(...b)];
  const w = Math.max(3, width * P.scaleAt(...V3.lerp(a, b, 0.5)) * 0.05);
  const f = blurDef(n2(w * 0.7), { name: 'setao', box: 'frame' });
  return el('defs', {}, f.defs) + el('path', { d: `M ${n1(s[0][0])} ${n1(s[0][1])} L ${n1(s[1][0])} ${n1(s[1][1])}`, stroke: isDark() ? T['ink-dark'] : T['shadow-warm'], 'stroke-width': n2(w), opacity: n2(isDark() ? level * 2 : level), filter: f.url, fill: 'none' });
}

// ── Walls, openings and the place beyond ──────────────────────────────────────────────────

export const OPENING_KINDS = ['door', 'doorway', 'window', 'pass', 'arch', 'glazing'];
const SKY = {
  day: ['blue-lit', 'teal-lit', 'paper-lit'],
  dusk: ['blue-dark', 'lilac-lit', 'yellow-lit'],
  night: ['blue-dark', 'ink-lit', 'ink-lit'],
  overcast: ['paper-shade', 'paper', 'paper-lit'],
};

/** A wall's frame: floor points a → b (cm), height h, the room side by `n` (unit, horizontal). */
function wallFrame(a, b, h, n) {
  const A = [a[0], a[1], 0];
  const B = [b[0], b[1], 0];
  const u = norm(sub(B, A));
  const nn = n ? norm([n[0], n[1], 0]) : norm(cross([0, 0, 1], u));
  return { A, B, u, n: nn, h, length: len(sub(B, A)), at: (s, z, off = 0) => add(add(A, mul(u, s)), [nn[0] * off, nn[1] * off, z]) };
}

/** The hole of an opening on a wall, as world points on the wall plane. */
function holeOf(W, o) {
  const s0 = o.at;
  const s1 = o.at + o.w;
  const z0 = o.z0 ?? 0;
  const z1 = o.z1;
  if (o.kind === 'arch') {
    const r = o.w / 2;
    const zs = z1 - r;
    const arc = Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI - (i / 12) * Math.PI;
      return W.at(s0 + r + r * Math.cos(a), zs + r * Math.sin(a));
    });
    return [W.at(s0, z0), ...arc, W.at(s1, z0)].reverse();
  }
  return [W.at(s0, z1), W.at(s1, z1), W.at(s1, z0), W.at(s0, z0)];
}

/** Normalize an opening: kind defaults, sizes in cm along the wall. */
function openingOf(o) {
  const kind = o.kind ?? 'window';
  const dflt = {
    door: { w: 90, z0: 0, z1: 210 },
    doorway: { w: 100, z0: 0, z1: 215 },
    window: { w: 120, z0: 95, z1: 210 },
    pass: { w: 140, z0: 100, z1: 200 },
    arch: { w: 120, z0: 0, z1: 250 },
    glazing: { w: 300, z0: 0, z1: 260 },
  }[kind];
  if (!dflt) throw new Error(`set: unknown opening kind "${kind}" (${OPENING_KINDS.join(', ')})`);
  return { ...dflt, ...o, kind };
}

/**
 * The place beyond an opening, as real volumes at real distance behind the wall (so it
 * parallaxes): `{ kind: 'outdoor' | 'room', sky?, ground?, dist?, volumes: [{ at: [s, d] (along
 * the wall from the opening's centre, cm beyond it), or u (−1 … 1 across the lens's view through
 * the opening at that depth) with at: [_, d], size: [w, d, h], tone, windows? ([cols, rows] or true), sign?, awning? }], hills?, floor?,
 * wall? }`. Drawn far to near; only the opening shows it (the wall covers the rest).
 */
function beyondSvg(P, R, W, o, B) {
  const out = [];
  const far = B.dist ?? (B.kind === 'room' ? 500 : 6000);
  const c = o.at + o.w / 2;
  // what the lens can see through the opening at a depth d beyond the wall (with room for a
  // camera move): everything beyond is built inside that cone, so no piece runs off to huge
  // screen coordinates (a filter over those drops the whole group)
  const rel = sub(P.pos, W.A);
  const sc = dot(rel, W.u);
  const dc = Math.max(1, dot(rel, W.n));
  const cz = P.pos[2];
  const viewAt = (d, uu) => {
    const k = (dc + d) / dc;
    return sc + (c - sc) * k + uu * (o.w / 2) * k - c;
  };
  const zAt = (d, zo) => cz + (zo - cz) * ((dc + d) / dc);
  const M = 3;
  const sL = (d) => viewAt(d, -M);
  const sR = (d) => viewAt(d, M);
  const zTop = Math.max(zAt(far, o.z1) + 0.5 * (o.z1 - o.z0) * (dc + far) / dc, 400);
  const zBot = Math.min(zAt(far, o.z0 ?? 0) - 0.5 * (o.z1 - o.z0) * (dc + far) / dc, -50);
  // the far plane: sky or the far room's wall
  const fp = (s, z) => W.at(c + s, z, -far);
  if (B.kind === 'room') {
    const wallM = B.wall ?? 'plaster';
    out.push(surface(P, R, [fp(sL(far), 400), fp(sR(far), 400), fp(sR(far), 0), fp(sL(far), 0)], wallM, { n: W.n }));
    const fl = (s, d) => W.at(c + s, 0, -d);
    out.push(surface(P, R, [fl(sL(far), far), fl(sR(far), far), fl(sR(1), 1), fl(sL(1), 1)], B.floor ?? 'linoleum', { n: [0, 0, 1] }));
  } else {
    const sky = (SKY[B.sky ?? 'day'] ?? SKY.day).map((t) => T[t]);
    const ts = P(...fp(0, zTop));
    const bs = P(...fp(0, 0));
    const gid = id(`sky-${hashId(sky.join('') + n1(ts[1]) + n1(bs[1]))}`);
    out.push(el('defs', {}, el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: 0, y1: n1(ts[1]), x2: 0, y2: n1(bs[1]) }, sky.map((col, i) => el('stop', { offset: [0, 0.8, 1][i], 'stop-color': isDark() ? mixHex(col, T['ink-dark'], 0.55) : col })).join(''))));
    out.push(el('path', { d: screenPath(P, [fp(sL(far), zTop), fp(sR(far), zTop), fp(sR(far), zBot), fp(sL(far), zBot)]), fill: `url(#${gid})` }));
    // the ground runs from the wall to the far plane
    const gtone = tone(B.ground ?? 'green-lit');
    const gr = (s, dd) => W.at(c + s, -1, -dd);
    out.push(K.quad(P, [gr(sL(far), far), gr(sR(far), far), gr(sR(20), 20), gr(sL(20), 20)], { tones: gtone, n: [0, 0, 1], R }, { opacity: 0.85 }));
    if (B.hills !== false) {
      const hz = (B.hills ?? 0.06) * far;
      const a0 = sL(far);
      const a1 = sR(far);
      const pts = Array.from({ length: 9 }, (_, i) => fp(a0 + (i / 8) * (a1 - a0), hz * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + 0.4)))));
      const hd = `M ${pts.map((q) => P(...q)).map((q) => `${n1(q[0])} ${n1(q[1])}`).join(' L ')} L ${P(...fp(a1, zBot)).slice(0, 2).map(n1).join(' ')} L ${P(...fp(a0, zBot)).slice(0, 2).map(n1).join(' ')} Z`;
      out.push(el('path', { d: hd, fill: K.shade(gtone, [0, 0, 1], fp(0, 0), R), opacity: 0.7 }));
    }
  }
  // volumes, far to near; a volume may give `u` (−1 … 1 across the view through the opening at
  // its depth, 0 its centre) instead of an absolute `at[0]`, so it stays in view
  const vols = (B.volumes ?? []).map((v) => ({ v, d: v.at[1] })).sort((a, b) => b.d - a.d);
  for (const { v } of vols) {
    const [w, dd, h] = v.size;
    const s0 = v.u !== undefined ? viewAt(v.at[1], v.u) : v.at[0];
    const o0 = W.at(c + s0 - w / 2, v.z ?? 0, -(v.at[1] + dd));
    const U = mul(W.u, w);
    const Vv = mul(W.n, dd);
    const tn = tone(v.tone ?? 'paper-lit');
    const vol = [];
    vol.push(K.obox(P, o0, U, Vv, [0, 0, h], tn, R, { radius: Math.min(30, w * 0.02), edge: false }).svg);
    const front = W.at(c + s0 - w / 2, (v.z ?? 0) + h, -v.at[1] + 0.5);
    const art = [];
    if (v.windows) {
      const [cols, rows] = windowGrid(v.windows, w, h);
      const glass = isDark() ? T['yellow-lit'] : mixHex(T['blue-lit'], T['paper-lit'], 0.45);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) art.push(el('rect', { x: n2(((i + 0.2) / cols) * w), y: n2(((j + 0.25) / rows) * h * 0.92), width: n2((0.6 / cols) * w), height: n2((0.5 / rows) * h * 0.92), fill: glass, opacity: isDark() ? ((i * 7 + j * 3) % 4 ? 0.2 : 0.9) : 0.85 }));
    }
    if (v.awning) for (let i = 0; i < 8; i++) art.push(el('rect', { x: n2((i / 8) * w), y: n2(h * 0.55), width: n2(w / 8), height: n2(h * 0.12), fill: i % 2 ? T.canvas : hexOf(v.awning) }));
    if (v.sign) art.push(el('rect', { x: n2(w * 0.15), y: n2(h * 0.08), width: n2(w * 0.7), height: n2(h * 0.14), rx: n2(h * 0.03), fill: hexOf(v.sign) }));
    if (art.length) vol.push(K.faceArt(P, front, U, [0, 0, -h], art.join(''), { clip: false }));
    out.push(v.tell ? g({ 'data-set-part': 'beyond', 'data-set-tell': v.tell }, vol.join('')) : vol.join(''));
  }
  // a custom piece of the place beyond (4.1): custom(P, R, ctx) → svg or { svg, tell }, drawn
  // inside the opening after the volumes. ctx.at(s, d, z) is the world point s cm along the wall
  // from the opening's centre, d cm beyond the wall, z up; ctx.viewAt(d, u) the s that the lens
  // sees at u (−1 … 1) across the opening at depth d (so a piece stays in view).
  for (const fn of [].concat(B.custom ?? [])) {
    if (typeof fn !== 'function') throw new Error('set: beyond.custom must be a function (P, R, ctx) → svg | { svg, tell }');
    const r = fn(P, R, { at: (ss, d, z = 0) => W.at(c + ss, z, -d), viewAt, wall: W, opening: o });
    const svg = typeof r === 'string' ? r : r?.svg ?? '';
    const tell = typeof r === 'object' ? r?.tell : undefined;
    if (svg) out.push(tell ? g({ 'data-set-part': 'beyond', 'data-set-tell': tell }, svg) : svg);
  }
  return out.join('');
}

/** A beyond volume's `windows`: [cols, rows] of whole numbers ≥ 1, or true for a grid that suits
 *  its size (about one window per 2.5 m across and per 3 m up). Anything else throws, saying so. */
export function windowGrid(v, w = 600, h = 500) {
  if (v === true) return [Math.max(1, Math.min(8, Math.round(w / 250))), Math.max(1, Math.min(8, Math.round(h / 300)))];
  if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 1)) return v;
  throw new Error(`set: a beyond volume's windows must be [cols, rows] (whole numbers ≥ 1) or true for a grid that suits its size (got ${JSON.stringify(v)})`);
}

/** The tells drawn into a piece of svg (data-set-tell tags), in order, once each. */
const tellsIn = (svg) => [...new Set([...String(svg).matchAll(/data-set-tell="([^"]+)"/g)].map((m) => m[1]))];

/**
 * A wall: floor points a → b, height h, the room on the side `n` (default: left of a → b seen
 * from above, i.e. cross(up, b − a)), finished in `mat`, `thick` cm deep, with `openings`
 * [{ kind, at (cm from a), w, z0, z1, beyond, frame?, mullions? }]. `dado` { h, mat, rail? }
 * finishes the lower wall in a second material; `skirting` { h, tone } runs along the floor.
 * Returns { env: [{ svg, at }], openings, apertures (world quads, for lights), frame }.
 */
export function wall(P, R, { a, b, h = 270, n, mat, thick = 14, openings = [], dado, skirting = { h: 10, tone: 'paper-lit' }, trim = 'paper-lit', cornice } = {}) {
  const W = wallFrame(a, b, h, n);
  const ops = openings.map(openingOf);
  const env = [];
  const holes = ops.map((o) => holeOf(W, o));
  const apertures = [];
  const tells = [];
  const facingCam = P.facing(W.at(W.length / 2, h / 2), W.n);
  // what lies beyond each opening, then its reveals (inside the wall thickness) and glass
  ops.forEach((o, i) => {
    const hd = screenPath(P, holes[i]);
    const hcid = id(`hole-${hashId(hd)}`);
    const inHole = (svg) => (svg && hd ? el('defs', {}, el('clipPath', { id: hcid }, el('path', { d: hd }))) + g({ 'clip-path': `url(#${hcid})` }, svg) : '');
    if (o.beyond) {
      const bsvg = beyondSvg(P, R, W, o, o.beyond);
      env.push({ svg: inHole(bsvg), at: W.at(o.at + o.w / 2, 120, -(o.beyond.dist ?? 2000)), sharp: false, part: 'beyond', tell: o.beyond.tell });
      for (const t of [o.beyond.tell, ...tellsIn(bsvg)]) if (t && !tells.includes(t)) tells.push(t);
    }
    const hole = holes[i];
    const rev = [];
    for (let k = 0; k < hole.length; k++) {
      const p0 = hole[k];
      const p1 = hole[(k + 1) % hole.length];
      const q0 = add(p0, mul(W.n, -thick));
      const q1 = add(p1, mul(W.n, -thick));
      const mid = mul(add(add(p0, p1), add(q0, q1)), 0.25);
      const fn = norm(cross(sub(p1, p0), sub(q0, p0)));
      const inward = dot(fn, sub(hole.reduce((s, q) => add(s, q), [0, 0, 0]).map((v) => v / hole.length), p0)) > 0 ? fn : mul(fn, -1);
      if (!P.facing(mid, inward)) continue;
      if (o.z0 === 0 && Math.abs(p0[2]) < 0.1 && Math.abs(p1[2]) < 0.1) continue;
      rev.push(K.quad(P, [p0, p1, q1, q0], { tones: material(mat)?.tone ?? 'paper', n: inward, R }));
    }
    if (o.kind === 'window' || o.kind === 'glazing') {
      const glassPts = hole.map((q) => add(q, mul(W.n, -thick * 0.5)));
      rev.push(surface(P, R, [glassPts[0], glassPts[1], glassPts[2], glassPts[3]], { kind: 'glass', size: [o.w / (o.mullions ?? 1), (o.z1 - o.z0) / (o.transoms ?? 1)] }, { n: W.n, falloff: 0, opacity: isDark() ? 0.3 : 0.4 }));
    }
    const leaf = [];
    if (o.kind === 'door' && o.leaf !== false) {
      // a door leaf standing open into the room, hinged at the near jamb
      const deg = o.open ?? 70;
      const hg = K.hinge(W.at(o.at, 0), { width: o.w - 4, height: o.z1 - 2, thick: 4, along: W.u, swing: W.n, deg });
      leaf.push(K.obox(P, hg.o, hg.U, hg.V, hg.N, tone(o.leafTone ?? 'paper-lit'), R, { radius: 0.8 }).svg);
    }
    if (rev.length || leaf.length) env.push({ svg: inHole(rev.join('')) + leaf.join(''), at: W.at(o.at + o.w / 2, (o.z0 + o.z1) / 2, -thick / 2), part: 'opening' });
    apertures.push(o.kind === 'arch' ? [hole[0], hole[6], hole[hole.length - 1], hole[hole.length - 2]] : hole);
  });
  // the wall face (and its dado band), holes cut out
  const face = [W.at(0, h), W.at(W.length, h), W.at(W.length, 0), W.at(0, 0)];
  const parts = [];
  if (dado) {
    const dh = dado.h ?? 100;
    const upper = [W.at(0, h), W.at(W.length, h), W.at(W.length, dh), W.at(0, dh)];
    const lower = [W.at(0, dh), W.at(W.length, dh), W.at(W.length, 0), W.at(0, 0)];
    parts.push(surface(P, R, upper, mat, { n: W.n, holes }));
    parts.push(surface(P, R, lower, dado.mat ?? 'panel', { n: W.n, holes }));
    // the rail stops at every opening it would cross (a door, a window low enough), like the skirting
    if (dado.rail !== false) for (const [s0, s1] of splitAt(W.length, ops.filter((o) => (o.z0 ?? 0) < dh + 2 && (o.z1 ?? 0) > dh - 2))) parts.push(K.obox(P, W.at(s0, dh - 2), mul(W.u, s1 - s0), [0, 0, 4], mul(W.n, 2.5), tone(dado.railTone ?? trim), R, { radius: 0.6, edge: false }).svg);
  } else {
    parts.push(surface(P, R, face, mat, { n: W.n, holes }));
  }
  if (skirting) {
    for (const [s0, s1] of splitAt(W.length, ops.filter((o) => (o.z0 ?? 0) < 1))) parts.push(K.obox(P, W.at(s0, 0), mul(W.u, s1 - s0), [0, 0, skirting.h ?? 10], mul(W.n, 1.6), tone(skirting.tone ?? trim), R, { radius: 0.4, edge: false }).svg);
  }
  if (cornice) parts.push(K.obox(P, W.at(0, h - (cornice.h ?? 8)), mul(W.u, W.length), [0, 0, cornice.h ?? 8], mul(W.n, cornice.d ?? 5), tone(cornice.tone ?? trim), R, { radius: 0.8, edge: false }).svg);
  parts.push(aoEdge(P, W.at(0, 0, 1), W.at(W.length, 0, 1), { width: 30, level: 0.12 }));
  // the openings' trim: casings, heads, sills, mullions
  for (const o of ops) {
    if (o.frame === false) continue;
    const tt = tone(o.trim ?? trim);
    const cw = o.casing ?? 7;
    const fr = [];
    const bx = (s, z, w, hh, d = 2.5) => fr.push(K.obox(P, W.at(s, z), mul(W.u, w), [0, 0, hh], mul(W.n, d), tt, R, { radius: 0.6 }).svg);
    if (o.kind === 'arch') {
      const r = o.w / 2;
      const zs = o.z1 - r;
      bx(o.at - cw, 0, cw, zs);
      bx(o.at + o.w, 0, cw, zs);
      bx(o.at + r - cw / 2, o.z1, cw, cw * 1.4, 3.5);
    } else if (o.kind === 'glazing') {
      const m = o.mullions ?? 3;
      for (let k = 0; k <= m; k++) bx(o.at + (k / m) * o.w - 3, o.z0, 6, o.z1 - o.z0, 4);
      bx(o.at - 3, o.z1 - 3, o.w + 6, 6, 4);
      bx(o.at - 3, o.z0, o.w + 6, 6, 4);
    } else {
      bx(o.at - cw, o.z0, cw, o.z1 - o.z0 + cw);
      bx(o.at + o.w, o.z0, cw, o.z1 - o.z0 + cw);
      bx(o.at - cw, o.z1, o.w + 2 * cw, cw);
      if (o.z0 > 1) bx(o.at - cw - 3, o.z0 - 4, o.w + 2 * cw + 6, 4, o.kind === 'pass' ? 30 : 9);
      if (o.kind === 'window') {
        const m = o.mullions ?? 2;
        for (let k = 1; k < m; k++) fr.push(K.obox(P, W.at(o.at + (k / m) * o.w - 1.5, o.z0, -thick * 0.5), mul(W.u, 3), [0, 0, o.z1 - o.z0], mul(W.n, 3), tt, R, { radius: 0.4 }).svg);
        if (o.transoms) for (let k = 1; k < o.transoms + 1; k++) fr.push(K.obox(P, W.at(o.at, o.z0 + (k / (o.transoms + 1)) * (o.z1 - o.z0), -thick * 0.5), mul(W.u, o.w), [0, 0, 3], mul(W.n, 3), tt, R, { radius: 0.4 }).svg);
      }
    }
    parts.push(fr.join(''));
  }
  env.push({ svg: facingCam ? parts.join('') : '', at: W.at(W.length / 2, h / 2), part: 'wall', mat: material(mat)?.kind ?? 'none', area: (W.length * h) / 1e4 });
  return { env, openings: ops, apertures, frame: W, tells };
}

/** The runs [s0, s1] of a wall `length` long left between the openings `ops` (their casings
 *  included), each longer than 1 cm: where a skirting or a dado rail is drawn. */
function splitAt(length, ops) {
  let segs = [[0, length]];
  for (const o of ops) {
    const a = o.at - (o.frame === false ? 0 : o.casing ?? 7);
    const b = o.at + o.w + (o.frame === false ? 0 : o.casing ?? 7);
    segs = segs.flatMap(([s0, s1]) => (b <= s0 || a >= s1 ? [[s0, s1]] : [[s0, Math.max(s0, a)], [Math.min(s1, b), s1]]));
  }
  return segs.filter(([s0, s1]) => s1 - s0 > 1);
}

/** Ceiling styles (4.1). `flat` a plain finished ceiling; `beamed` the same crossed by beams, so
 *  the sliver a vertical wide keeps reads as architecture; `none` no ceiling (an open set). */
export const CEILING_STYLES = ['flat', 'beamed', 'none'];
/** The most of the frame a ceiling may take (setProblems): a vertical wide spends its height on
 *  the floor, the walls and the cast, not on 20–25% of ceiling. Aim the lens a little lower or
 *  crop it; ceilingShare(P, room) measures a camera before you build. */
export const CEILING_MAX_SHARE = 0.12;
const CEILING_MAT = { kind: 'plaster', tone: 'paper-lit' };

/** A room's `ceiling` option as { style, mat, beams }: a style name, false / null (none), a
 *  material (the old form: a flat ceiling in it), or { style, mat?, beam?, every?, depth?, w?, along? }. */
export function ceilingOf(c = 'flat') {
  if (c === false || c === null || c === 'none') return { style: 'none' };
  if (c === 'flat' || c === 'beamed') return { style: c, mat: CEILING_MAT };
  if (typeof c === 'object' && c.style) {
    if (!CEILING_STYLES.includes(c.style)) throw new Error(`set: ceiling style must be ${CEILING_STYLES.join(', ')} (got "${c.style}")`);
    return { mat: CEILING_MAT, ...c };
  }
  if (typeof c === 'string' && !MATERIALS[c]) throw new Error(`set: ceiling must be ${CEILING_STYLES.join(', ')}, a material or { style, mat } (got "${c}")`);
  return { style: 'flat', mat: c };
}

/** Shoelace area of a screen polygon clipped to the frame rectangle (Sutherland–Hodgman). */
function frameArea(pts, w, h) {
  let poly = pts.map((q) => [q[0], q[1]]);
  const edges = [[(q) => q[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]], [(q) => q[0] <= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]], [(q) => q[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]], [(q) => q[1] <= h, (a, b) => [a[0] + ((b[0] - a[0]) * (h - a[1])) / (b[1] - a[1]), h]]];
  for (const [inside, cut] of edges) {
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (inside(a)) next.push(a);
      if (inside(a) !== inside(b)) next.push(cut(a, b));
    }
    poly = next;
    if (poly.length < 3) return 0;
  }
  let A = 0;
  for (let i = 0; i < poly.length; i++) A += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return Math.abs(A) / 2;
}

/** The share of the frame (0..1) a room's ceiling plane takes through the lens P, for the room
 *  { x: [x0, x1], y: [y0, y1], h }: measure a camera before building (setProblems holds it to
 *  CEILING_MAX_SHARE). 0 when the lens is above the ceiling. */
export function ceilingShare(P, { x = [-300, 300], y = [-600, 300], h = 270 } = {}) {
  if (!(P.pos[2] < h)) return 0;
  const cut = K.clipNear(P, [[x[0], y[0], h], [x[1], y[0], h], [x[1], y[1], h], [x[0], y[1], h]]);
  if (cut.world.length < 3) return 0;
  return frameArea(cut.screen, P.w, P.h) / (P.w * P.h);
}

/**
 * A framing helper: the camera `cam` ({ pos, target, fov, … } for lens()) with its target lowered
 * just enough that the room's ceiling takes at most `max` of the frame (the lens stays where it
 * is; the view tilts down a little). A camera that already fits comes back unchanged.
 */
export function fitCeiling(cam, rm, max = CEILING_MAX_SHARE) {
  const at = (z) => K.lens({ ...cam, target: [cam.target[0], cam.target[1], z] });
  if (ceilingShare(at(cam.target[2]), rm) <= max) return cam;
  let hi = cam.target[2];
  let lo = hi - 600;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    let ok = false;
    // a lens aimed too steeply to build shows no ceiling at all: it fits
    try { ok = ceilingShare(at(mid), rm) <= max; } catch { ok = true; }
    if (ok) lo = mid;
    else hi = mid;
  }
  return { ...cam, target: [cam.target[0], cam.target[1], Math.floor(lo * 10) / 10] };
}

/**
 * A room shell: the floor x [x0, x1] × y [y0, y1] (y1 is the back wall), height h, and its walls
 * ('back', 'left', 'right', 'front'; each true or { mat, openings, dado, ... } for wall()).
 * `floor` and `wall` are materials (the default for every wall). Corners are where two walls meet.
 * `ceiling`: 'flat' (default) | 'beamed' | 'none', or { style, mat, beam, every, depth, w, along }
 * (beams `depth` cm deep, `w` wide, every `every` cm, running along 'x' (default) or 'y'); a
 * material alone is a flat ceiling in it. `enclose` 'auto' (default): a wall you did not list is
 * still drawn, plain in the room's wall material, when the lens inside the room looks straight at
 * it (a reverse shot), so the camera never turns round into a void; false keeps an open cutaway.
 * Returns { env, openings, apertures, walls, corners, floorArea, ceiling: { style, share }, tells }.
 */
export function room(P, R, { x = [-300, 300], y = [-600, 300], h = 270, walls = ['back', 'left'], floor = 'wood', wall: wallMat = 'plaster', ceiling = 'flat', thick = 14, skirting, trim, dado, cornice, tell, enclose = 'auto' } = {}) {
  const [x0, x1] = x;
  const [y0, y1] = y;
  const env = [];
  const fl = [[x0, y1, 0], [x1, y1, 0], [x1, y0, 0], [x0, y0, 0]];
  env.push({ svg: surface(P, R, fl, floor, { n: [0, 0, 1], cells: 6, falloff: 0.1 }), at: [(x0 + x1) / 2, (y0 + y1) / 2, 0], sharp: true, part: 'floor', mat: material(floor)?.kind ?? 'none', area: ((x1 - x0) * (y1 - y0)) / 1e4, tell });
  const C = ceilingOf(ceiling);
  const share = C.style === 'none' ? 0 : ceilingShare(P, { x, y, h });
  if (C.style !== 'none' && P.pos[2] < h) env.push({ svg: surface(P, R, [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], C.mat, { n: norm([0, -0.55, -0.45]), cells: 4, falloff: 0.1 }), at: [(x0 + x1) / 2, (y0 + y1) / 2, h], part: 'ceiling', mat: material(C.mat)?.kind ?? 'none', area: ((x1 - x0) * (y1 - y0)) / 1e4, share });
  const list = Array.isArray(walls) ? walls.map((w) => [w, true]) : Object.entries(walls);
  const geo = { back: { a: [x0, y1], b: [x1, y1], n: [0, -1] }, left: { a: [x0, y0], b: [x0, y1], n: [1, 0] }, right: { a: [x1, y1], b: [x1, y0], n: [-1, 0] }, front: { a: [x1, y0], b: [x0, y0], n: [0, 1] } };
  const built = [];
  const ops = [];
  const apertures = [];
  const tells = [];
  for (const [name, spec] of list) {
    if (!spec || !geo[name]) continue;
    const o = spec === true ? {} : spec;
    const wres = wall(P, R, { ...geo[name], h, mat: o.mat ?? wallMat, thick, skirting: o.skirting ?? skirting, trim: o.trim ?? trim, dado: o.dado ?? dado, cornice: o.cornice ?? cornice, openings: o.openings ?? [] });
    env.push(...wres.env);
    built.push(name);
    ops.push(...wres.openings.map((op) => ({ ...op, wall: name })));
    apertures.push(...wres.apertures);
    for (const t of wres.tells) if (!tells.includes(t)) tells.push(t);
  }
  // the walls not listed close the room for a lens inside it looking straight at them
  const inside = P.pos[0] > x0 && P.pos[0] < x1 && P.pos[1] > y0 && P.pos[1] < y1 && P.pos[2] < h;
  if (enclose === 'auto' && inside) {
    const fl2 = norm([P.fwd[0], P.fwd[1], 0]);
    for (const [name, gw] of Object.entries(geo)) {
      if (built.includes(name) || -(fl2[0] * gw.n[0] + fl2[1] * gw.n[1]) < 0.5) continue;
      const wres = wall(P, R, { ...gw, h, mat: wallMat, thick, skirting, trim, dado, cornice, openings: [] });
      env.push(...wres.env.map((e) => ({ ...e, part: e.part === 'wall' ? 'closing-wall' : e.part })));
    }
  }
  const corners = [];
  const has = (k) => built.includes(k);
  if (has('back') && has('left')) corners.push([x0, y1]);
  if (has('back') && has('right')) corners.push([x1, y1]);
  if (has('front') && has('left')) corners.push([x0, y0]);
  if (has('front') && has('right')) corners.push([x1, y0]);
  for (const c of corners) env.push({ svg: aoEdge(P, [c[0], c[1], 0], [c[0], c[1], h], { width: 40, level: 0.1 }), at: [c[0], c[1], h / 2], part: 'corner' });
  // beams cross under the ceiling, in front of the walls they meet
  if (C.style === 'beamed' && P.pos[2] < h) {
    const depth = C.depth ?? 18;
    const bw = C.w ?? 14;
    const every = C.every ?? 70;
    const bt = C.beam ? (material(MATERIALS[C.beam] ? C.beam : null)?.tone ?? tone(C.beam)) : tone({ mix: ['paper-shade', 'yellow-dark', 0.3] });
    const beams = [];
    if ((C.along ?? 'x') === 'x') for (let yy = y1 - every / 2; yy > y0; yy -= every) beams.push(K.box(P, [x0, yy - bw / 2, h - depth], [x1 - x0, bw, depth], bt, R, { radius: 1 }).svg);
    else for (let xx = x0 + every / 2; xx < x1; xx += every) beams.push(K.box(P, [xx - bw / 2, y0, h - depth], [bw, y1 - y0, depth], bt, R, { radius: 1 }).svg);
    env.push({ svg: beams.join(''), at: [(x0 + x1) / 2, (y0 + y1) / 2, h - depth], part: 'beams' });
  }
  return { env, openings: ops, apertures, walls: built, corners, floorArea: ((x1 - x0) * (y1 - y0)) / 1e4, ceiling: { style: C.style, share }, tells };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────

/** Floor axes of a fixture: `at` its front-left floor corner (seen from its front), `facing` the
 *  floor direction its front faces ('-y' toward the camera, '+x', '-x', '+y', or a vector). */
function axes(facing = '-y') {
  const f = typeof facing === 'string' ? { '-y': [0, -1, 0], '+y': [0, 1, 0], '+x': [1, 0, 0], '-x': [-1, 0, 0] }[facing] : norm([facing[0], facing[1], 0]);
  if (!f) throw new Error(`set: facing must be -y, +y, +x, -x or a floor vector (got ${facing})`);
  // along the run, left to right as seen from its front
  const a = [-f[1], f[0], 0];
  return { f, a };
}

/** A box in a fixture's frame: s along, d back from the front (0 = front face), z up. */
function fbox(P, R, base, ax, [s, d, z], [w, dd, h], tn, opts = {}) {
  const o = add(add(add(base, mul(ax.a, s)), mul(ax.f, -d - dd)), [0, 0, z]);
  return K.obox(P, o, mul(ax.a, w), mul(ax.f, dd), [0, 0, h], tone(tn), R, { radius: 1, ...opts }).svg;
}
const fpt = (base, ax, s, d, z) => add(add(add(base, mul(ax.a, s)), mul(ax.f, -d)), [0, 0, z]);
const footprint = (base, ax, w, d) => [fpt(base, ax, 0, 0, 0), fpt(base, ax, w, 0, 0), fpt(base, ax, w, d, 0), fpt(base, ax, 0, d, 0)];

/** The chin line of a standing critter in cm: the bottom of its mouth keep-out (outfits.js
 *  FACE_KEEPOUT). A critter is nearly all head, so its mouth sits low (about a quarter of its
 *  height): anything in front of it taller than this cuts its face for a level lens. */
export const CRITTER_CHIN_CM = (-(FACE_KEEPOUT.find((z) => z.part === 'mouth').y + FACE_KEEPOUT.find((z) => z.part === 'mouth').h) / CRITTER_PX) * CRITTER_CM;
/** A counter a critter stands behind with its whole face over it (4.1; principles §2 "faces are
 *  always whole"): the top just under the chin line (≈ 0.27 × CRITTER_CM, 19 cm), so from any lens
 *  above the counter the critter behind it shows eyes, brows and mouth, chin resting over the top
 *  like a cartoon shopkeeper. The set is built at true size, but a 72 cm critter is lost behind a
 *  true 90 cm counter, and a 40 cm one (0.55 ×, a human's proportion) still hides its mouth. */
export const CRITTER_COUNTER_CM = Math.floor(CRITTER_CHIN_CM);
/** A run's height in cm: undefined → 90 (true size), 'critter' → CRITTER_COUNTER_CM, or a number. */
export function runHeight(h) {
  if (h === undefined || h === null) return 90;
  if (h === 'critter') return CRITTER_COUNTER_CM;
  if (typeof h === 'number' && h > 0) return h;
  throw new Error(`set.run: h must be 'critter' or a height in cm (got ${JSON.stringify(h)})`);
}

/**
 * A run of cabinets with a top: a kitchen counter, a reception or triage desk, a workbench, a
 * post-office counter, lab benches. `at` [x, y] is its front-left floor corner, `len` along it,
 * `depth`, `h` (cm, or 'critter' for a counter a critter behind it still reads over: runHeight;
 * the toe kick, the tap and the upper cabinets' default height follow it); `body` tone, `top` material or tone; `doors` (count) or `drawers`; `gaps` [{ s, w }]
 * leave room for an appliance; `inserts` [{ kind: 'sink' | 'hob' | 'screen' | 'tray', s, w }] sit
 * on top; `upper` { z0, h, depth, doorW, skip: [{ s, w }] } hangs above (skip a window or a hood); `kick` toe-kick height.
 */
export function run(P, R, o) {
  const ax = axes(o.facing);
  const base = [o.at[0], o.at[1], 0];
  const L = o.len ?? 200;
  const D = o.depth ?? 60;
  const H = runHeight(o.h);
  const k = H / 90;
  const kick = o.kick ?? Math.max(4, Math.round(8 * Math.min(1, k)));
  const body = o.body ?? 'paper-lit';
  const s = [];
  s.push(K.contactShadow(P, footprint(base, ax, L, D)));
  s.push(K.shadowsOf(P, footprint(base, ax, L, D), H, R, { dirLevel: 0.12 }));
  s.push(fbox(P, R, base, ax, [0, 6, 0], [L, D - 6, kick], mixHex(hexOf(body), T.ink, 0.2), { edge: false }));
  s.push(fbox(P, R, base, ax, [0, 2, kick], [L, D - 2, H - kick - 4], body));
  const n = o.doors ?? Math.max(1, Math.round(L / 55));
  const gaps = o.gaps ?? [];
  const inGap = (x) => gaps.some((gp) => x >= gp.s && x < gp.s + gp.w);
  const handle = o.handle ?? 'paper-dark';
  for (let i = 0; i < n; i++) {
    const w = L / n;
    const x = i * w;
    if (inGap(x + w / 2)) continue;
    if (o.drawers) {
      for (let k = 0; k < 3; k++) {
        const zz = kick + 3 + k * ((H - kick - 10) / 3);
        s.push(fbox(P, R, base, ax, [x + 1.5, 0.5, zz], [w - 3, 2, (H - kick - 10) / 3 - 3], body, { radius: 0.6 }));
        s.push(fbox(P, R, base, ax, [x + w / 2 - 8, -1.2, zz + (H - kick - 10) / 3 - 9], [16, 1.6, 1.8], handle, { radius: 0.6, edge: false }));
      }
    } else {
      s.push(fbox(P, R, base, ax, [x + 1.5, 0.5, kick + 3], [w - 3, 2, H - kick - 10], body, { radius: 0.6 }));
      s.push(fbox(P, R, base, ax, [x + (i % 2 ? 5 : w - 8), -1.2, H - 24], [2, 1.6, 14], handle, { radius: 0.6, edge: false }));
    }
  }
  const topT = o.top ?? 'paper';
  const topTone = typeof topT === 'object' && topT.kind ? material(topT).tone : material(MATERIALS[topT] ? topT : null)?.tone ?? tone(topT);
  s.push(fbox(P, R, base, ax, [-1, -1.5, H - 4], [L + 2, D + 1.5, 4], topTone, { radius: 0.8 }));
  for (const ins of o.inserts ?? []) {
    const w = ins.w ?? 60;
    if (ins.kind === 'sink') {
      s.push(K.quad(P, [fpt(base, ax, ins.s, 8, H + 0.1), fpt(base, ax, ins.s + w, 8, H + 0.1), fpt(base, ax, ins.s + w, D - 10, H + 0.1), fpt(base, ax, ins.s, D - 10, H + 0.1)], { tones: tone('paper-dark'), n: [0, 0, 1], R }));
      const tap = 28 * Math.min(1, Math.max(0.5, k));
      s.push(fbox(P, R, base, ax, [ins.s + w / 2 - 2, D - 9, H], [4, 4, tap], 'paper-lit', { radius: 1.6 }));
      s.push(fbox(P, R, base, ax, [ins.s + w / 2 - 1.5, D - 26, H + tap - 4], [3, 18, 3], 'paper-lit', { radius: 1.4 }));
    } else if (ins.kind === 'hob') {
      for (const [dx, dy] of [[0.27, 0.35], [0.73, 0.35], [0.27, 0.72], [0.73, 0.72]]) s.push(K.cylinder(P, fpt(base, ax, ins.s + w * dx, D * dy, H), 7, 1, 'ink', R, { seg: 16 }));
    } else if (ins.kind === 'screen') {
      s.push(fbox(P, R, base, ax, [ins.s + w / 2 - 6, D * 0.55, H], [12, 8, 12], 'ink', { radius: 1 }));
      s.push(fbox(P, R, base, ax, [ins.s, D * 0.5, H + 12], [w, 2.5, w * 0.6], 'ink', { radius: 1 }));
      s.push(K.faceArt(P, fpt(base, ax, ins.s + 2, D * 0.5 - 0.2, H + 12 + w * 0.6 - 2), mul(ax.a, w - 4), [0, 0, -(w * 0.6 - 4)], screenArt(ins.show ?? 'lines', w - 4, w * 0.6 - 4), { clip: false }));
    } else if (ins.kind === 'tray') {
      s.push(fbox(P, R, base, ax, [ins.s, D * 0.3, H], [w, D * 0.45, 6], ins.tone ?? 'paper-shade', { radius: 1 }));
    }
  }
  if (o.upper) {
    const u = o.upper;
    const z0 = u.z0 ?? H + 55;
    const uh = u.h ?? 72;
    const ud = u.depth ?? 35;
    const off = D - ud;
    const segs = [[0, L]];
    for (const sk of u.skip ?? []) {
      const i = segs.findIndex(([a0, a1]) => sk.s < a1 && sk.s + sk.w > a0);
      if (i >= 0) segs.splice(i, 1, ...[[segs[i][0], sk.s], [sk.s + sk.w, segs[i][1]]].filter(([a0, a1]) => a1 - a0 > 10));
    }
    const doorW = u.doorW ?? 50;
    for (const [a0, a1] of segs) {
      s.push(fbox(P, R, base, ax, [a0, off, z0], [a1 - a0, ud, uh], u.body ?? body));
      const un = Math.max(1, Math.round((a1 - a0) / doorW));
      const w = (a1 - a0) / un;
      for (let i = 0; i < un; i++) {
        s.push(fbox(P, R, base, ax, [a0 + i * w + 1.5, off - 1.5, z0 + 2], [w - 3, 2, uh - 4], u.body ?? body, { radius: 0.6 }));
        s.push(fbox(P, R, base, ax, [a0 + i * w + (i % 2 ? 5 : w - 8), off - 3, z0 + 6], [2, 1.6, 12], handle, { radius: 0.6, edge: false }));
      }
    }
  }
  return s.join('');
}

/** Flat screen or board art (cm): 'lines' (vitals traces), 'chart', 'text', 'grid', 'map'. */
function screenArt(kind, w, h, { ink = T['teal-lit'], ground } = {}) {
  const bg = ground ?? mixHex(T.ink, T['blue-dark'], 0.3);
  const a = [el('rect', { x: 0, y: 0, width: n2(w), height: n2(h), fill: bg })];
  const r = rng(Math.round(w * 31 + h));
  if (kind === 'lines') {
    const cols = [T['green-lit'], T['teal-lit'], T['yellow-lit']];
    for (let k = 0; k < 3; k++) {
      const y = h * (0.22 + k * 0.28);
      let d = `M ${n2(w * 0.05)} ${n2(y)}`;
      for (let i = 1; i <= 16; i++) d += ` L ${n2(w * 0.05 + (i / 16) * w * 0.68)} ${n2(y + (i % 4 === 2 ? -h * 0.1 : (r() - 0.5) * h * 0.03))}`;
      a.push(el('path', { d, stroke: cols[k], 'stroke-width': n2(h * 0.025), fill: 'none' }));
      a.push(el('rect', { x: n2(w * 0.8), y: n2(y - h * 0.07), width: n2(w * 0.14), height: n2(h * 0.12), rx: n2(h * 0.02), fill: cols[k], opacity: 0.85 }));
    }
  } else if (kind === 'chart') {
    for (let i = 0; i < 6; i++) { const bh = h * (0.2 + r() * 0.55); a.push(el('rect', { x: n2(w * (0.1 + i * 0.14)), y: n2(h * 0.88 - bh), width: n2(w * 0.09), height: n2(bh), fill: i === 3 ? T['yellow-lit'] : ink, opacity: 0.85 })); }
  } else if (kind === 'text' || kind === 'board') {
    for (let i = 0; i < 6; i++) a.push(el('rect', { x: n2(w * 0.08), y: n2(h * (0.12 + i * 0.13)), width: n2(w * (0.4 + r() * 0.45)), height: n2(h * 0.045), rx: n2(h * 0.02), fill: kind === 'board' ? T['ink-lit'] : ink, opacity: 0.7 }));
  } else if (kind === 'grid') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) a.push(el('rect', { x: n2(w * (0.06 + i * 0.235)), y: n2(h * (0.08 + j * 0.3)), width: n2(w * 0.2), height: n2(h * 0.24), rx: n2(h * 0.02), fill: (i + j) % 3 ? ink : T['yellow-lit'], opacity: 0.55 }));
  } else if (kind === 'map') {
    a.push(el('path', { d: `M ${n2(w * 0.1)} ${n2(h * 0.7)} C ${n2(w * 0.3)} ${n2(h * 0.2)} ${n2(w * 0.6)} ${n2(h * 0.9)} ${n2(w * 0.9)} ${n2(h * 0.3)}`, stroke: ink, 'stroke-width': n2(h * 0.03), fill: 'none' }));
  }
  return a.join('');
}

const CONTENT_KINDS = ['books', 'binders', 'boxes', 'jars', 'files', 'goods', 'servers', 'folded', 'none'];

/** What sits on one shelf (cm frame of the shelving), filled to `density` 0..1. */
function shelfContents(P, R, base, ax, kind, [s0, s1], d0, dd, z, hMax, palette, seed, density) {
  const r = rng(seed);
  const out = [];
  let x = s0 + 1;
  const pick = () => palette[Math.floor(r() * palette.length)];
  if (kind === 'servers') {
    // rack units: dark faces with grilles and status lights, filling the bay
    let zz = z;
    while (zz < z + hMax - 4.5) {
      const u = r() < 0.25 ? 9 : 4.5;
      if (zz + u > z + hMax) break;
      if (r() < density + 0.15) {
        const silver = r() < 0.45;
        out.push(fbox(P, R, base, ax, [s0 + 1, d0, zz], [s1 - s0 - 2, dd, u - 0.5], silver ? mixHex(T['ink-lit'], T['paper-dark'], 0.45) : 'ink', { radius: 0.3, edge: false }));
        const face = fpt(base, ax, s0 + 1, d0 - 0.15, zz + u - 0.5);
        const w = s1 - s0 - 2;
        const art = [];
        for (let i = 0; i < 10; i++) art.push(el('rect', { x: n2(w * 0.08 + i * w * 0.05), y: n2(u * 0.25), width: n2(w * 0.025), height: n2(u * 0.5), fill: silver ? T['ink-lit'] : mixHex(T['ink-lit'], T['paper-dark'], 0.3), opacity: 0.8 }));
        art.push(el('rect', { x: n2(w * 0.62), y: n2(u * 0.2), width: n2(w * 0.12), height: n2(u * 0.6), rx: 0.4, fill: T['ink-lit'], opacity: 0.9 }));
        art.push(el('circle', { cx: n2(w * 0.8), cy: n2(u * 0.5), r: n2(Math.min(1.3, u * 0.22)), fill: r() < 0.8 ? T['green-lit'] : T['teal-lit'] }));
        art.push(el('circle', { cx: n2(w * 0.87), cy: n2(u * 0.5), r: n2(Math.min(1.3, u * 0.22)), fill: r() < 0.3 ? T['yellow-lit'] : T['green-lit'], opacity: 0.9 }));
        out.push(K.faceArt(P, face, mul(ax.a, w), [0, 0, -(u - 0.5)], art.join(''), { clip: false }));
      }
      zz += u;
    }
    return out.join('');
  }
  while (x < s1 - 2) {
    if (r() > 0.4 + density * 0.6) { x += 4 + r() * 10; continue; }
    if (kind === 'books' || kind === 'binders' || kind === 'files') {
      const n = 3 + Math.floor(r() * 7);
      for (let i = 0; i < n && x < s1 - 3; i++) {
        const w = kind === 'binders' ? 6 + r() * 2 : kind === 'files' ? 1.5 + r() : 2.2 + r() * 3;
        const h = Math.min(hMax - 2, kind === 'binders' ? 30 : (kind === 'files' ? 24 : 18 + r() * 9));
        const dep = kind === 'files' ? dd * 0.8 : Math.min(dd - 2, 16 + r() * 8);
        out.push(fbox(P, R, base, ax, [x, d0 + 1, z], [w, dep, h], pick(), { radius: 0.4, edge: false }));
        x += w + 0.25;
      }
      if (r() < 0.25 && x < s1 - 20) {
        // a leaning or lying pile breaks the rhythm
        out.push(fbox(P, R, base, ax, [x + 1, d0 + 2, z], [17, Math.min(dd - 3, 22), 3], pick(), { radius: 0.4, edge: false }));
        out.push(fbox(P, R, base, ax, [x + 2, d0 + 3, z + 3], [15, Math.min(dd - 5, 20), 2.6], pick(), { radius: 0.4, edge: false }));
        x += 20;
      }
      x += 2 + r() * 6;
    } else if (kind === 'boxes' || kind === 'folded') {
      const w = kind === 'folded' ? 26 : 22 + r() * 18;
      const h = Math.min(hMax - 3, kind === 'folded' ? 4 + Math.floor(r() * 4) * 4 : 14 + r() * 16);
      if (x + w > s1 - 1) break;
      out.push(fbox(P, R, base, ax, [x, d0 + 1, z], [w, dd - 3, h], pick(), { radius: kind === 'folded' ? 1.5 : 0.6 }));
      x += w + 3 + r() * 5;
    } else if (kind === 'jars' || kind === 'goods') {
      const rr = kind === 'jars' ? 4 + r() * 2 : 3 + r() * 2.5;
      const h = Math.min(hMax - 3, kind === 'jars' ? 10 + r() * 8 : 9 + r() * 14);
      if (x + 2 * rr > s1 - 1) break;
      out.push(K.cylinder(P, fpt(base, ax, x + rr, d0 + dd / 2, z), rr, h, pick(), R, { seg: 14 }));
      x += 2 * rr + 1.5 + r() * 3;
    } else break;
  }
  return out.join('');
}

/**
 * Shelving: bays of `bay` cm between uprights, `levels` shelves up to `h`, `depth`; contents per
 * level (`contents` a kind or a list by level: books, binders, boxes, jars, files, goods, servers,
 * folded, none) in tones from `palette` (tokens; default the set's color story), at `density`
 * 0..1. `back` puts a back panel in; `rack: true` draws a closed equipment rack frame.
 */
export function shelving(P, R, o) {
  const ax = axes(o.facing);
  const base = [o.at[0], o.at[1], 0];
  const L = o.len ?? 120;
  const D = o.depth ?? 32;
  const H = o.h ?? 200;
  const bay = o.bay ?? (o.rack ? 60 : 90);
  const lv = o.levels ?? (o.rack ? 1 : 5);
  const frameT = o.tone ?? (o.rack ? 'ink' : 'paper-lit');
  const palette = (o.palette ?? ['paper-shade', 'teal-shade', 'blue-shade', 'paper-lit']).map((t) => tone(t));
  const density = Math.max(0, Math.min(1, o.density ?? 0.75));
  const contents = Array.isArray(o.contents) ? o.contents : Array.from({ length: lv }, () => o.contents ?? 'books');
  const s = [];
  s.push(K.contactShadow(P, footprint(base, ax, L, D)));
  s.push(K.shadowsOf(P, footprint(base, ax, L, D), H, R, { dirLevel: 0.12 }));
  const t = o.rack ? 4 : 2.5;
  if (o.back !== false) s.push(fbox(P, R, base, ax, [0, D - 1.5, 0], [L, 1.5, H], o.backTone ?? (o.rack ? 'ink-lit' : mixHex(hexOf(frameT), T['shadow-warm'], 0.12)), { edge: false }));
  const nb = Math.max(1, Math.round(L / bay));
  const bw = L / nb;
  const plinth = o.rack ? 6 : 8;
  for (let b = 0; b < nb; b++) {
    for (let k = 0; k < lv; k++) {
      const z0 = plinth + t + k * ((H - plinth - t) / lv);
      const hMax = (H - plinth - t) / lv - t;
      const kind = contents[k % contents.length] ?? 'none';
      if (kind !== 'none') s.push(shelfContents(P, R, base, ax, kind, [b * bw + t, (b + 1) * bw - t], 1.5, D - 3, z0, hMax, palette, (o.seed ?? 1) * 97 + b * 13 + k, density));
    }
  }
  for (let b = 0; b <= nb; b++) s.push(fbox(P, R, base, ax, [Math.min(L - t, b * bw - (b === nb ? t : 0)), 0, 0], [t, D, H], frameT, { radius: 0.5 }));
  for (let k = 0; k <= lv; k++) {
    const z = k === 0 ? plinth : plinth + k * ((H - plinth - t) / lv);
    if (!o.rack || k === 0 || k === lv) s.push(fbox(P, R, base, ax, [0, 0, z], [L, D, t], frameT, { radius: 0.5 }));
  }
  if (!o.rack) s.push(fbox(P, R, base, ax, [0, 0.5, 0], [L, D - 1, plinth], frameT, { radius: 0.5, edge: false }));
  return s.join('');
}

/** A desk or table: `size` [w, d, h] at `at` (front-left floor corner), `legs` or a `pedestal`
 *  side (drawers), `top` tone, `tone` for legs, `items` [{ kind, s, d, ...}] drawn on top by dress. */
export function desk(P, R, o) {
  const ax = axes(o.facing);
  const base = [o.at[0], o.at[1], 0];
  const [w, d, h] = o.size ?? [140, 70, 75];
  const s = [];
  s.push(K.contactShadow(P, footprint(base, ax, w, d), { level: 0.18 }));
  s.push(K.shadowsOf(P, footprint(base, ax, w, d), h, R, { dirLevel: 0.1 }));
  const lt = o.tone ?? 'ink-lit';
  if (o.pedestal) {
    const side = o.pedestal === 'left' ? 2 : w - 42;
    s.push(fbox(P, R, base, ax, [side, 3, 0], [40, d - 6, h - 4], o.body ?? 'paper-lit'));
    for (let k = 0; k < 3; k++) s.push(fbox(P, R, base, ax, [side + 1.5, 2.5, 4 + k * ((h - 10) / 3)], [37, 1.2, (h - 10) / 3 - 2.5], o.body ?? 'paper-lit', { radius: 0.5 }));
    s.push(fbox(P, R, base, ax, [o.pedestal === 'left' ? w - 6 : 3, 3, 0], [3, d - 6, h - 4], lt, { radius: 0.6 }));
  } else {
    for (const [sx, sy] of [[3, 3], [w - 7, 3], [3, d - 7], [w - 7, d - 7]]) s.push(fbox(P, R, base, ax, [sx, sy, 0], [4, 4, h - 4], lt, { radius: 1.2 }));
  }
  const tt = o.top ?? { mix: ['paper-shade', 'yellow-dark', 0.3] };
  s.push(fbox(P, R, base, ax, [0, 0, h - 4], [w, d, 4], tt, { radius: 1 }));
  return s.join('');
}

/** A chair: seat `h` 45, back, legs; `facing` its front. `tone` frame, `seat` tone. */
export function chair(P, R, o) {
  const ax = axes(o.facing);
  const base = [o.at[0], o.at[1], 0];
  const w = o.w ?? 44;
  const h = o.h ?? 45;
  const ft = o.tone ?? 'ink-lit';
  const s = [K.contactShadow(P, footprint(base, ax, w, w), { level: 0.16 })];
  for (const [sx, sy] of [[2, 2], [w - 5, 2], [2, w - 5], [w - 5, w - 5]]) s.push(fbox(P, R, base, ax, [sx, sy, 0], [3, 3, h - 3], ft, { radius: 1 }));
  s.push(fbox(P, R, base, ax, [0, 0, h - 4], [w, w, 4], o.seat ?? 'blue-shade', { radius: 1.5 }));
  s.push(fbox(P, R, base, ax, [2, w - 5, h], [3, 3, 40], ft, { radius: 1 }));
  s.push(fbox(P, R, base, ax, [w - 5, w - 5, h], [3, 3, 40], ft, { radius: 1 }));
  s.push(fbox(P, R, base, ax, [0, w - 5, h + 22], [w, 4, 18], o.seat ?? 'blue-shade', { radius: 1.5 }));
  return s.join('');
}

/** A bed on legs or wheels: a hospital gurney, a bed, a cot, a bench. `size` [w, d, h],
 *  `mattress` tone, `frame` tone, `wheels`, `rails`, `pillow`. */
export function bed(P, R, o) {
  const ax = axes(o.facing);
  const base = [o.at[0], o.at[1], 0];
  const [w, d, h] = o.size ?? [200, 80, 70];
  const ft = o.frame ?? 'paper-dark';
  const s = [K.contactShadow(P, footprint(base, ax, w, d), { level: 0.2 }), K.shadowsOf(P, footprint(base, ax, w, d), h, R, { dirLevel: 0.1 })];
  for (const [sx, sy] of [[6, 6], [w - 10, 6], [6, d - 10], [w - 10, d - 10]]) {
    s.push(fbox(P, R, base, ax, [sx, sy, o.wheels ? 8 : 0], [4, 4, h - 22 - (o.wheels ? 8 : 0)], ft, { radius: 1 }));
    if (o.wheels) s.push(K.cylinder(P, fpt(base, ax, sx + 2, sy + 2, 0), 4, 7, 'ink', R, { seg: 10 }));
  }
  s.push(fbox(P, R, base, ax, [0, 0, h - 22], [w, d, 6], ft, { radius: 1 }));
  s.push(fbox(P, R, base, ax, [2, 2, h - 16], [w - 4, d - 4, 14], o.mattress ?? 'paper-lit', { radius: 4 }));
  if (o.pillow !== false) s.push(fbox(P, R, base, ax, [6, 8, h - 2], [40, d - 16, 9], 'canvas', { radius: 4 }));
  if (o.sheet) s.push(fbox(P, R, base, ax, [w * 0.45, 1, h - 3], [w * 0.55 - 1, d - 2, 2.5], o.sheet, { radius: 1.5 }));
  if (o.rails) s.push(fbox(P, R, base, ax, [w * 0.3, -1, h], [w * 0.45, 2, 22], ft, { radius: 1 }));
  return s.join('');
}

/**
 * A drape: a curtain, a cubicle partition or a hanging divider from floor point a to b, hanging
 * from `top` down to `bottom` cm, `folds` pleats, `tone`, with a ceiling `track` (true) and an
 * opening fraction `open` (0..1, gathered toward a).
 */
export function drape(P, R, o) {
  const a = [o.a[0], o.a[1], 0];
  const b = [o.b[0], o.b[1], 0];
  const top = o.top ?? 230;
  const bot = o.bottom ?? 30;
  const span = sub(b, a);
  const L = len(span);
  const u = norm(span);
  const nrm = norm(cross([0, 0, 1], u));
  const open = o.open ?? 0;
  const fl = Math.max(4, o.folds ?? Math.round(L / 18));
  const depth = o.depth ?? 6;
  const tn = tone(o.tone ?? { mix: ['teal-lit', 'paper-lit', 0.55] });
  const s = [];
  const L1 = L * (1 - open);
  const pts = Array.from({ length: fl * 2 + 1 }, (_, i) => add(add(a, mul(u, (i / (fl * 2)) * L1)), mul(nrm, i % 2 ? depth : 0)));
  const quads = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const q = [add(p0, [0, 0, top]), add(p1, [0, 0, top]), add(p1, [0, 0, bot]), add(p0, [0, 0, bot])];
    let nn = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    const mid = mul(add(q[0], q[2]), 0.5);
    if (!P.facing(mid, nn)) nn = mul(nn, -1);
    quads.push({ d: P.dist(...mid), svg: K.quad(P, q, { tones: tn, n: nn, R }) });
  }
  quads.sort((x, y) => y.d - x.d);
  s.push(...quads.map((q) => q.svg));
  // a hem shade at the bottom, and the track
  s.push(aoEdge(P, add(a, [0, 0, bot + 2]), add(add(a, mul(u, L1)), [0, 0, bot + 2]), { width: 8, level: 0.1 }));
  if (o.track !== false) s.push(K.obox(P, add(a, [0, -1.5, top + 2]), mul(u, L), [0, 3, 0], [0, 0, 3], tone('paper-dark'), R, { radius: 0.5, edge: false }).svg);
  return s.join('');
}

/**
 * A sign, frame, board or screen on a wall: the wall's floor line a → b (as wall()), `s` cm along
 * it, `z` bottom, `w` × `h`, `kind` 'panel' (a plain sign), 'frame' (picture/notice frame),
 * 'screen' (a monitor or display), 'board' (white/cork board), `show` the content (lines, chart,
 * text, grid, map), `tone` the panel. Text in a set is set dressing, never the read.
 */
export function sign(P, R, o) {
  const W = wallFrame(o.a, o.b, 300, o.n);
  const w = o.w ?? 60;
  const h = o.h ?? 40;
  const z = o.z ?? 150;
  const kind = o.kind ?? 'panel';
  const depth = kind === 'screen' ? 5 : 2;
  const frameT = tone(o.tone ?? (kind === 'screen' ? 'ink' : kind === 'frame' ? 'ink-lit' : 'teal'));
  const s = [];
  s.push(K.obox(P, W.at(o.s, z, 0.2), mul(W.u, w), [0, 0, h], mul(W.n, depth), frameT, R, { radius: 0.8 }).svg);
  const inset = kind === 'panel' ? 0 : kind === 'screen' ? 2 : 3;
  const iw = w - 2 * inset;
  const ih = h - 2 * inset;
  const face = W.at(o.s + inset, z + h - inset, depth + 0.3);
  let art;
  if (kind === 'screen') art = screenArt(o.show ?? 'lines', iw, ih);
  else if (kind === 'board') art = screenArt(o.show ?? 'board', iw, ih, { ground: T['paper-lit'], ink: T['ink-lit'] });
  else if (kind === 'frame') art = screenArt(o.show ?? 'chart', iw, ih, { ground: T['paper-lit'], ink: hexOf(o.ink ?? 'teal-shade') });
  else {
    art = el('rect', { x: 0, y: 0, width: n2(iw), height: n2(ih), fill: 'none' });
    if (o.text) art += el('text', { x: n2(iw / 2), y: n2(ih * 0.66), 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended', Roboto", 'font-weight': 700, 'font-size': n2(Math.min(ih * 0.5, (iw / Math.max(3, o.text.length)) * 1.5)), fill: hexOf(o.ink ?? 'canvas'), 'letter-spacing': '0.04em' }, o.text);
  }
  s.push(K.faceArt(P, face, mul(W.u, iw), [0, 0, -ih], art, { clip: false }));
  return K.set(s.join(''));
}

/** A lamp: 'desk' (a reading lamp on a surface at `at` [x, y, z]), 'pendant' (hangs from `ceiling`
 *  to `at[2]`), 'tube' (a ceiling light strip from `at` along `along` cm). `shade` tone. Returns
 *  { svg, light } where light is a point light the shot may add to its rig (the lamp's source). */
export function lamp(P, R, o) {
  const [x, y, z] = o.at;
  const kind = o.kind ?? 'desk';
  const sh = tone(o.shade ?? 'green-shade');
  const s = [];
  let light;
  if (kind === 'desk') {
    s.push(K.cylinder(P, [x, y, z], 8, 2.5, tone('ink-lit'), R, { seg: 18 }));
    s.push(K.box(P, [x - 0.8, y - 0.8, z + 2.5], [1.6, 1.6, 34], tone('ink-lit'), R, { radius: 0.6 }).svg);
    s.push(K.obox(P, [x - 18, y - 9, z + 34], [36, 0, 0], [0, 12, 0], [0, 0, 8], sh, R, { radius: 3 }).svg);
    light = { pos: [x, y - 3, z + 33], level: o.level ?? 0.35, reach: o.reach ?? 110, color: 'warm' };
  } else if (kind === 'pendant') {
    const top = o.ceiling ?? 270;
    s.push(el('path', { d: `M ${P(x, y, top).slice(0, 2).map(n1).join(' ')} L ${P(x, y, z + 18).slice(0, 2).map(n1).join(' ')}`, stroke: isDark() ? T['ink-lit'] : T['ink-lit'], 'stroke-width': n2(Math.max(1, 0.8 * P.scaleAt(x, y, z) * 0.05)) }));
    s.push(K.cylinder(P, [x, y, z], o.r ?? 18, 18, sh, R, { seg: 24 }));
    light = { pos: [x, y, z - 2], level: o.level ?? 0.4, reach: o.reach ?? 220, color: 'warm' };
  } else {
    const al = o.along ?? [120, 0, 0];
    const L = len(al);
    const u = norm(al);
    s.push(K.obox(P, [x, y - 7, z], mul(u, L), [0, 14, 0], [0, 0, -5], tone('paper-lit'), R, { radius: 1, edge: false }).svg);
    s.push(K.quad(P, [[x, y - 5, z - 5.2], add([x, y - 5, z - 5.2], al), add([x, y + 5, z - 5.2], al), [x, y + 5, z - 5.2]], T.canvas));
    light = { pos: add([x, y, z - 10], mul(al, 0.5)), level: o.level ?? 0.3, reach: o.reach ?? 300, color: o.color ?? 'cool' };
  }
  return { svg: s.join(''), light };
}

/** An overhead run: a cable tray, a pipe, a duct, a beam, a curtain rail, from world a to b,
 *  `size` [w, h] cm, `kind` 'tray' (with cables), 'pipe', 'beam'. */
export function beam(P, R, o) {
  const a = o.a;
  const b = o.b;
  const [w, h] = o.size ?? [30, 10];
  const u = norm(sub(b, a));
  const side = norm(cross([0, 0, 1], u));
  const tn = tone(o.tone ?? 'paper-dark');
  if (o.kind === 'pipe') {
    const L = len(sub(b, a));
    const steps = Math.max(2, Math.round(L / 40));
    const s = [];
    for (let i = 0; i < steps; i++) s.push(K.obox(P, add(add(a, mul(u, (i / steps) * L)), add(mul(side, -w / 2), [0, 0, -w / 2])), mul(u, L / steps + 0.5), mul(side, w), [0, 0, w], tn, R, { radius: w / 2 - 0.5, edge: false }).svg);
    return s.join('');
  }
  const o0 = add(a, mul(side, -w / 2));
  const s = [K.obox(P, o0, sub(b, a), mul(side, w), [0, 0, h], tn, R, { radius: 0.6, faces: o.kind === 'tray' ? { n1: false } : {} }).svg];
  if (o.kind === 'tray') {
    const cables = [T['blue-shade'], T['ink-lit'], T['yellow-shade'], T['teal-shade']];
    cables.forEach((c, i) => s.push(K.obox(P, add(add(o0, mul(side, 3 + i * ((w - 8) / cables.length))), [0, 0, h - 2]), sub(b, a), mul(side, (w - 8) / cables.length - 0.5), [0, 0, 3], c, R, { radius: 1.2, edge: false }).svg));
  }
  return s.join('');
}

/** A plain solid: `at` [x, y, z] (its min corner), `size` [w, d, h], `tone`, `radius`. */
export function solid(P, R, o) {
  const s = [];
  if (!(o.at[2] > 0)) s.push(K.contactShadow(P, [[o.at[0], o.at[1]], [o.at[0] + o.size[0], o.at[1]], [o.at[0] + o.size[0], o.at[1] + o.size[1]], [o.at[0], o.at[1] + o.size[1]]], { level: 0.2 }));
  if (o.cyl) s.push(K.cylinder(P, [o.at[0] + o.size[0] / 2, o.at[1] + o.size[1] / 2, o.at[2]], o.size[0] / 2, o.size[2], tone(o.tone), R, { seg: 24 }));
  else s.push(K.box(P, o.at, o.size, tone(o.tone ?? 'paper-lit'), R, { radius: o.radius ?? 1.5 }).svg);
  return s.join('');
}

// ── Dressing at density ───────────────────────────────────────────────────────────────────

export const DENSITY = { sparse: 0.35, lived: 0.65, busy: 0.9 };
export const DRESS_KINDS = ['book', 'stack', 'mug', 'jar', 'bottle', 'box', 'paper', 'bowl', 'tray', 'binder', 'kettle', 'towel', 'clipboard', 'cup'];

/** One small thing at world (x, y, z), cm. */
function smallThing(P, R, kind, [x, y, z], r, tn) {
  switch (kind) {
    case 'book': return K.box(P, [x - 10, y - 7, z], [20 + r() * 4, 14, 3], tn, R, { radius: 0.4 }).svg;
    case 'stack': return [0, 1, 2].map((i) => K.box(P, [x - 10 + r() * 2, y - 7, z + i * 3], [19, 14, 2.8], i % 2 ? tone('paper-lit') : tn, R, { radius: 0.4 }).svg).join('');
    case 'binder': return K.box(P, [x - 4, y - 14, z], [6, 28, 30], tn, R, { radius: 0.5 }).svg;
    case 'mug': case 'cup': return K.cylinder(P, [x, y, z], kind === 'cup' ? 3.5 : 4.5, kind === 'cup' ? 8 : 10, tn, R, { seg: 14 });
    case 'jar': return K.cylinder(P, [x, y, z], 5, 14, tn, R, { seg: 14 }) + K.cylinder(P, [x, y, z + 14], 5.3, 2.5, tone('paper-dark'), R, { seg: 14 });
    case 'bottle': return K.cylinder(P, [x, y, z], 3.5, 18, tn, R, { seg: 12 }) + K.cylinder(P, [x, y, z + 18], 1.4, 6, tn, R, { seg: 10 });
    case 'box': return K.box(P, [x - 9, y - 7, z], [18, 14, 10 + r() * 6], tn, R, { radius: 0.6 }).svg;
    case 'paper': return K.quad(P, [[x - 10.5, y - 15, z + 0.2], [x + 10.5, y - 15, z + 0.2], [x + 10.5, y + 15, z + 0.2], [x - 10.5, y + 15, z + 0.2]], { tones: tone('canvas'), n: [0, 0, 1], R });
    case 'clipboard': return K.box(P, [x - 11, y - 16, z], [22, 32, 1], tone('ink-lit'), R, { radius: 0.5 }).svg + K.quad(P, [[x - 10, y - 14, z + 1.1], [x + 10, y - 14, z + 1.1], [x + 10, y + 14, z + 1.1], [x - 10, y + 14, z + 1.1]], { tones: tone('canvas'), n: [0, 0, 1], R });
    case 'bowl': return K.cylinder(P, [x, y, z], 12, 7, tn, R, { seg: 24 });
    case 'tray': return K.box(P, [x - 18, y - 12, z], [36, 24, 3], tn, R, { radius: 1 }).svg;
    case 'kettle': return K.cylinder(P, [x, y, z], 9, 18, tn, R, { seg: 20 }) + K.cylinder(P, [x, y, z + 18], 3, 3, tone('ink-lit'), R, { seg: 10 });
    case 'towel': return K.box(P, [x - 12, y - 1, z - 30], [24, 2, 30], tn, R, { radius: 1 }).svg;
    default: throw new Error(`set.dress: unknown kind "${kind}" (${DRESS_KINDS.join(', ')})`);
  }
}

/**
 * Inhabit a surface: small things of `kinds` laid out on `area` { x: [x0, x1], y: [y0, y1], z }
 * at `density` (a number 0..1 or 'sparse' | 'lived' | 'busy'), in `palette` tones, deterministic
 * by `seed`. Returns [{ svg, at }] items (drawn in distance order with the rest of the shot).
 */
export function dress(P, R, { area, kinds = ['book', 'mug'], density = 'lived', palette = ['paper-lit', 'teal-shade', 'blue-shade'], seed = 1, cell = 30 } = {}) {
  const k = typeof density === 'number' ? density : DENSITY[density] ?? DENSITY.lived;
  const r = rng(seed * 7919);
  const [x0, x1] = area.x;
  const [y0, y1] = area.y;
  const out = [];
  for (let x = x0 + cell / 2; x < x1; x += cell) {
    for (let y = y0 + cell / 2; y < y1; y += cell) {
      if (r() > k * 0.7) continue;
      const kind = kinds[Math.floor(r() * kinds.length)];
      const tn = tone(palette[Math.floor(r() * palette.length)]);
      const p = [x + (r() - 0.5) * cell * 0.3, y + (r() - 0.5) * cell * 0.3, area.z ?? 0];
      out.push({ svg: smallThing(P, R, kind, p, r, tn), at: [p[0], p[1], p[2] + 5], kind });
    }
  }
  return out;
}

/** One dressing thing placed by hand: `kind` at world `at`, `tone`. */
export function thing(P, R, kind, at, tn = 'paper-lit', seed = 1) {
  return { svg: smallThing(P, R, kind, at, rng(seed), tone(tn)), at: [at[0], at[1], at[2] + 5], kind };
}

// ── The builder: collects the set and its meta ────────────────────────────────────────────

const LAYERS = ['fg', 'mid', 'bg'];
const tag = (svg, meta) => (svg ? g(Object.fromEntries(Object.entries({ 'data-set-part': meta.part, 'data-set-layer': meta.layer, 'data-set-mat': meta.mat, 'data-set-tell': meta.tell, 'data-set-area': meta.area !== undefined ? n2(meta.area) : undefined, 'data-set-kind': meta.kind, 'data-set-orange': meta.orange ? 1 : undefined, 'data-set-dress': meta.dress || undefined, 'data-set-share': meta.share !== undefined ? n2(meta.share) : undefined, 'data-set-hull': meta.hull, 'data-set-depth': meta.depth !== undefined ? n1(meta.depth) : undefined }).filter(([, v]) => v !== undefined && v !== null)), svg) : '');

/**
 * The set builder for one shot: `setBuilder(P, R, SET)`. Every method draws a primitive, tags it
 * (part, layer, material, the tell it builds) and files it as `env` (architecture, beyond) or as
 * an `item` (fixtures and dressing, drawn by distance and blurred by depth of field). Pass
 * `tell: '<one of SET.tells>'` to mark what a piece makes recognizable, `layer` to override the
 * guess (fg nearer than 55% of the camera-to-target distance, bg the architecture, mid the rest).
 * done() → { env, items, meta, lights, apertures } for lens.render and setProblems.
 */
export function setBuilder(P, R, SET = {}) {
  const env = [];
  const items = [];
  const lights = [];
  const apertures = [];
  const meta = { walls: 0, corners: 0, openings: [], floor: false, surfaces: [], layers: { fg: 0, mid: 0, bg: 0 }, tells: [], dressing: 0, density: SET.density ?? null };
  const d0 = P.dist(...P.target);
  const palette = (SET.colorStory ?? ['paper-shade', 'teal-shade', 'blue-shade']).map((t) => t);
  const layerOf = (at, given) => given ?? (at && P.dist(...at) < d0 * 0.55 ? 'fg' : 'mid');
  // a solid fixture's screen outline (the hull of its 8 corners) and distance: what can stand
  // between the lens and a critter's face (faceCutProblems)
  const hullOfBox = (corners) => {
    if (!corners || corners.some((q) => P(...q)[2] <= (P.near ?? 5) + 1)) return {};
    const hp = K.screenHull(corners.map((q) => P(...q)));
    const c = mul(corners.reduce((a, q) => add3(a, q), [0, 0, 0]), 1 / corners.length);
    return { hull: hp.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' '), depth: P.dist(...c) };
  };
  const add = (svg, at, o = {}, kind = 'item', corners = null) => {
    if (!svg) return;
    const layer = kind === 'env' ? o.layer ?? 'bg' : layerOf(at, o.layer);
    meta.layers[layer] += 1;
    if (o.tell && !meta.tells.includes(o.tell)) meta.tells.push(o.tell);
    const orange = /data-tone="orange"/.test(svg);
    if (orange) meta.orange = true;
    const t = tag(svg, { part: o.part ?? 'fixture', layer, tell: o.tell, kind: o.kind, orange, dress: o.dress, ...hullOfBox(corners) });
    // a fixture's world box rides with it, so render() paints it in the right order against the
    // cast and against what stands on it (lens.js paintOrder); `bounds` given by hand wins
    const bounds = o.bounds ?? (corners ? [corners.reduce((m, q) => m.map((v, i) => Math.min(v, q[i])), [Infinity, Infinity, Infinity]), corners.reduce((m, q) => m.map((v, i) => Math.max(v, q[i])), [-Infinity, -Infinity, -Infinity])] : undefined);
    if (kind === 'env') env.push({ svg: t, at, sharp: o.sharp ?? false });
    else items.push(bounds ? { svg: t, at, bounds } : { svg: t, at });
  };
  const B = {
    P,
    R,
    palette,
    room(o) {
      const res = room(P, R, o);
      for (const e of res.env) {
        env.push({ svg: tag(e.svg, { part: e.part, layer: 'bg', mat: e.mat, area: e.area, tell: e.tell, share: e.share }), at: e.at, sharp: e.sharp ?? e.part === 'floor' });
        if (e.mat !== undefined) meta.surfaces.push({ part: e.part, mat: e.mat, area: e.area });
      }
      meta.layers.bg += 1;
      meta.floor = true;
      meta.walls += res.walls.length;
      meta.corners += res.corners.length;
      meta.openings.push(...res.openings.map((op) => ({ kind: op.kind, wall: op.wall, beyond: !!op.beyond })));
      apertures.push(...res.apertures);
      meta.ceiling = res.ceiling;
      for (const t of [o.tell, ...res.tells]) if (t && !meta.tells.includes(t)) meta.tells.push(t);
      return res;
    },
    wall(o) {
      const res = wall(P, R, o);
      for (const e of res.env) {
        env.push({ svg: tag(e.svg, { part: e.part, layer: 'bg', mat: e.mat, area: e.area, tell: e.tell }), at: e.at });
        if (e.mat !== undefined) meta.surfaces.push({ part: e.part, mat: e.mat, area: e.area });
      }
      meta.walls += 1;
      meta.layers.bg += 1;
      meta.openings.push(...res.openings.map((op) => ({ kind: op.kind, beyond: !!op.beyond })));
      apertures.push(...res.apertures);
      for (const t of [o.tell, ...res.tells]) if (t && !meta.tells.includes(t)) meta.tells.push(t);
      return res;
    },
    surface(pts, mat, o = {}) {
      const area = len(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0]))) / 1e4;
      env.push({ svg: tag(surface(P, R, pts, mat, o), { part: o.part ?? 'surface', layer: 'bg', mat: material(mat)?.kind ?? 'none', area }), at: mul(pts.reduce((a, q) => V3.add(a, q), [0, 0, 0]), 0.25) });
      meta.surfaces.push({ part: o.part ?? 'surface', mat: material(mat)?.kind ?? 'none', area });
    },
    run(o) { add(run(P, R, o), centerOf(o, o.len ?? 200, o.depth ?? 60, runHeight(o.h) / 2), o, 'item', cornersOf(o, o.len ?? 200, o.depth ?? 60, runHeight(o.h))); },
    shelving(o) {
      // filled shelves are the place's dressing too (a library's books, a rack's servers)
      const kinds = Array.isArray(o.contents) ? o.contents : [o.contents ?? 'books'];
      const filled = kinds.filter((k) => k !== 'none').length / kinds.length;
      const dressN = Math.round(((o.len ?? 120) / (o.bay ?? (o.rack ? 60 : 90))) * (o.levels ?? (o.rack ? 1 : 5)) * filled * (o.density ?? 0.75));
      add(shelving(P, R, { palette, ...o }), centerOf(o, o.len ?? 120, o.depth ?? 32, (o.h ?? 200) / 2), { ...o, dress: dressN, bounds: o.bounds ?? boundsOfCorners(cornersOf(o, o.len ?? 120, o.depth ?? 32, o.h ?? 200)) });
      meta.dressing += dressN;
    },
    desk(o) { add(desk(P, R, o), centerOf(o, (o.size ?? [140])[0], (o.size ?? [0, 70])[1], 40), o, 'item', cornersOf(o, (o.size ?? [140])[0], (o.size ?? [0, 70])[1], (o.size ?? [0, 0, 75])[2] ?? 75)); },
    chair(o) { add(chair(P, R, o), centerOf(o, o.w ?? 44, o.w ?? 44, 40), o); },
    bed(o) { add(bed(P, R, o), centerOf(o, (o.size ?? [200])[0], (o.size ?? [0, 80])[1], 50), { ...o, bounds: o.bounds ?? boundsOfCorners(cornersOf(o, (o.size ?? [200])[0], (o.size ?? [0, 80])[1], (o.size ?? [0, 0, 70])[2] ?? 70)) }); },
    drape(o) { add(drape(P, R, o), [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2, 120], { part: 'fixture', ...o }); },
    sign(o) { const W = wallFrame(o.a, o.b, 300, o.n); add(sign(P, R, o), W.at(o.s + (o.w ?? 60) / 2, (o.z ?? 150) + (o.h ?? 40) / 2, -1), { part: 'sign', ...o }, o.env ? 'env' : 'item'); },
    lamp(o) { const l = lamp(P, R, o); add(l.svg, o.at, { part: 'lamp', ...o }); lights.push(l.light); return l.light; },
    beam(o) { add(beam(P, R, o), V3.lerp(o.a, o.b, 0.5), { part: 'fixture', ...o }); },
    solid(o) {
      const [w, d, h] = o.size;
      const c = [];
      for (const a of [0, w]) for (const b of [0, d]) for (const z of [0, h]) c.push([o.at[0] + a, o.at[1] + b, o.at[2] + z]);
      add(solid(P, R, o), [o.at[0] + w / 2, o.at[1] + d / 2, o.at[2] + h / 2], o, 'item', c);
    },
    dress(o) {
      const list = dress(P, R, { palette, density: SET.density ?? 'lived', ...o });
      for (const it of list) add(it.svg, it.at, { part: 'dressing', kind: it.kind, layer: o.layer });
      meta.dressing += list.length;
      if (o.tell && list.length) meta.tells.includes(o.tell) || meta.tells.push(o.tell);
      return list.length;
    },
    thing(kind, at, tn, o = {}) { const it = thing(P, R, kind, at, tn, o.seed); add(it.svg, it.at, { part: 'dressing', kind, ...o }); meta.dressing += 1; },
    /** The foreground framing piece: any svg (a primitive's output) or a builder call, near the
     *  lens and partly cropped. `at` is its centre. Always filed as fg. */
    foreground(svg, at, o = {}) { add(typeof svg === 'function' ? svg(P, R) : svg, at, { part: 'foreground', ...o, layer: 'fg' }); },
    /** Raw svg in the set (a custom piece built from lens solids): filed as an item; `tell`
     *  marks what it makes recognizable, `bounds` [[x0, y0, z0], [x1, y1, z1]] its world box
     *  (a table, a long bench: so render() paints it right against what stands on or by it). */
    piece(svg, at, o = {}) { add(svg, at, o); },
    /** A custom piece of the place beyond (seen through an opening, drawn by you from lens
     *  solids): filed as background env, tagged part "beyond" with its `tell` (pushed into
     *  meta.tells). `clip` (world points on the opening, e.g. its hole) keeps it inside the
     *  opening. Call it after the wall or room so it draws over that opening's beyond. */
    beyond(svg, at, o = {}) {
      if (!svg) return;
      const hd = o.clip ? screenPath(P, o.clip) : '';
      const cid = hd ? id(`bclip-${hashId(hd)}`) : null;
      const inner = cid ? el('defs', {}, el('clipPath', { id: cid }, el('path', { d: hd }))) + g({ 'clip-path': `url(#${cid})` }, svg) : svg;
      env.push({ svg: tag(inner, { part: 'beyond', layer: 'bg', tell: o.tell }), at, sharp: o.sharp ?? false });
      meta.layers.bg += 1;
      if (meta.openings.length) meta.openings[meta.openings.length - 1].beyond = true;
      if (o.tell && !meta.tells.includes(o.tell)) meta.tells.push(o.tell);
    },
    done() { return { env, items, meta, lights, apertures }; },
  };
  return B;
}
/** The 8 world corners of a fixture's box (its footprint `w` × `d` from `at`, facing, `h` tall). */
const boundsOfCorners = (c) => [c.reduce((m, q) => m.map((v, i) => Math.min(v, q[i])), [Infinity, Infinity, Infinity]), c.reduce((m, q) => m.map((v, i) => Math.max(v, q[i])), [-Infinity, -Infinity, -Infinity])];
const cornersOf = (o, w, d, h) => {
  const ax = axes(o.facing);
  const fp = footprint([o.at[0], o.at[1], 0], ax, w, d);
  return [...fp, ...fp.map((q) => [q[0], q[1], h])];
};
const centerOf = (o, w, d, z) => {
  const ax = axes(o.facing);
  return fpt([o.at[0], o.at[1], 0], ax, w / 2, d / 2, z);
};

// ── Checks ────────────────────────────────────────────────────────────────────────────────

export const BRIEF_KEYS = ['place', 'tells', 'architecture', 'materials', 'colorStory', 'layers', 'beyond', 'density'];

/**
 * The problems with a set brief (world.js SET): the place named, 3–5 tells, architecture with two
 * walls meeting at a corner or a wall with an opening (each opening a known kind), a material for
 * the floor and the walls, a color story of 2–3 palette tokens (no orange), all three layers
 * described, a place beyond when there is an opening, and a density.
 */
export function setBriefProblems(SET) {
  if (!SET || typeof SET !== 'object' || Array.isArray(SET)) return ['SET must be an object { place, tells, architecture, materials, colorStory, layers, beyond, density }'];
  const out = [];
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!str(SET.place)) out.push('SET.place must name the place (e.g. "a hospital ER triage area at night")');
  if (!Array.isArray(SET.tells) || SET.tells.length < 3 || SET.tells.length > 5 || !SET.tells.every(str)) out.push('SET.tells must list 3–5 things that make this place recognizable to a stranger in one second (build them first, at true size)');
  const A = SET.architecture;
  if (!A || typeof A !== 'object') out.push('SET.architecture must describe the shell: { walls: ["back", "left"], openings: [{ wall, kind, beyond }] }');
  else {
    const walls = Array.isArray(A.walls) ? A.walls.length : Number(A.walls) || 0;
    const ops = Array.isArray(A.openings) ? A.openings : [];
    if (walls < 2 && ops.length === 0) out.push('SET.architecture needs at least two walls meeting at a corner, or a wall with an opening (a floor in a void is not a place)');
    for (const [i, op] of ops.entries()) {
      if (!OPENING_KINDS.includes(op?.kind)) out.push(`SET.architecture.openings[${i}].kind must be one of ${OPENING_KINDS.join(', ')}`);
    }
    if (ops.length && !(SET.beyond && (str(SET.beyond) || str(SET.beyond.place) || str(SET.beyond.kind)))) out.push('SET.beyond must say what lies past the openings (a street, a skyline, another room) when the set has an opening');
  }
  const M = SET.materials;
  if (!M || typeof M !== 'object') out.push('SET.materials must give each large surface a material: { floor, walls, ... }');
  else {
    for (const key of ['floor', 'walls']) if (!M[key]) out.push(`SET.materials.${key} is missing: every large surface has a material (${Object.keys(MATERIALS).join(', ')})`);
    for (const [key, v] of Object.entries(M)) {
      const kind = typeof v === 'string' ? v : v?.kind;
      if (kind && !MATERIALS[kind]) out.push(`SET.materials.${key} "${kind}" is not a kit material (${Object.keys(MATERIALS).join(', ')})`);
      if (v && typeof v === 'object' && v.tone) { const p = toneProblem(v.tone, `SET.materials.${key}.tone`); if (p) out.push(p); }
    }
  }
  if (!Array.isArray(SET.colorStory) || SET.colorStory.length < 2 || SET.colorStory.length > 3) out.push('SET.colorStory must pick 2–3 palette tokens the real place has, in quiet values');
  else for (const [i, c] of SET.colorStory.entries()) { const p = toneProblem(c, `SET.colorStory[${i}]`); if (p) out.push(p); }
  const L = SET.layers;
  if (!L || typeof L !== 'object') out.push('SET.layers must describe { fg, mid, bg }: a near framing piece, where the action stands, the walls and what is seen beyond');
  else for (const k of LAYERS) if (!str(L[k])) out.push(`SET.layers.${k} is missing (${k === 'fg' ? 'one piece close to the lens, partly cropped' : k === 'mid' ? 'where the action stands' : 'walls, openings and what is seen through them'})`);
  if (!(SET.density in DENSITY)) out.push(`SET.density must be one of ${Object.keys(DENSITY).join(', ')} (how inhabited the place really is)`);
  return out;
}

/** A critter counts as the foreground layer (principles §1: one piece close to the lens, partly
 *  cropped) when its screen box is at least this share of the frame's height, or half of it with
 *  its feet below the frame: the shoulder of an over-the-shoulder shot, a critter by the lens. */
export const FG_CRITTER_SHARE = 0.3;
/** Is a critter's screen box [x0, y0, x1, y1] near enough the lens to be a foreground piece? */
export function nearCritter(box, { w = 1080, h = 1920 } = {}) {
  const [x0, y0, x1, y1] = box;
  if (!(x1 > 0 && x0 < w && y1 > 0 && y0 < h)) return false;
  const tall = (y1 - y0) / h;
  // feet below the frame's bottom edge: the lens is right over it
  return tall >= FG_CRITTER_SHARE || (tall >= FG_CRITTER_SHARE / 2 && y1 > h);
}
/** Critter boxes from a drawn frame (lens.js critterAt tags), mapped by its 2D framing when it has
 *  one: [{ who, box, depth, view }]. */
function critterBoxes(svg) {
  const boxes = K.framedBoxes(svg);
  if (boxes) return boxes.filter((b) => b.kind === 'critter');
  return [...String(svg).matchAll(/<g [^>]*data-frame-kind="critter"[^>]*>/g)].map((m) => {
    const at = (k) => m[0].match(new RegExp(`data-frame-${k}="([^"]+)"`))?.[1];
    return { who: at('who'), box: (at('box') ?? '').split(' ').map(Number), depth: Number(at('depth')), view: at('view') };
  }).filter((b) => b.box.length === 4 && b.box.every(Number.isFinite));
}

/** The set's meta from a drawn SVG (tags setBuilder leaves), so try.mjs can check a frame. A
 *  critter near the lens (nearCritter) counts as a foreground piece. */
export function setMetaFromSvg(svg) {
  const s = String(svg);
  const meta = { walls: 0, corners: 0, openings: [], floor: false, surfaces: [], layers: { fg: 0, mid: 0, bg: 0 }, tells: [], dressing: 0 };
  const re = /<g ([^>]*data-set-(?:part|layer)[^>]*)>/g;
  let m;
  while ((m = re.exec(s))) {
    const a = Object.fromEntries([...m[1].matchAll(/data-set-([a-z]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (a.layer && meta.layers[a.layer] !== undefined) meta.layers[a.layer] += 1;
    if (a.part === 'wall') meta.walls += 1;
    if (a.part === 'corner') meta.corners += 1;
    if (a.part === 'floor') meta.floor = true;
    if (a.part === 'opening') meta.openings.push({ kind: a.kind ?? 'opening', beyond: false });
    if (a.part === 'beyond' && meta.openings.length) meta.openings[meta.openings.length - 1].beyond = true;
    if (a.part === 'beyond') meta.beyond = (meta.beyond ?? 0) + 1;
    if (a.part === 'dressing') meta.dressing += 1;
    if (a.dress) meta.dressing += Number(a.dress);
    if (a.mat !== undefined && a.area !== undefined) meta.surfaces.push({ part: a.part, mat: a.mat, area: Number(a.area) });
    if (a.tell && !meta.tells.includes(a.tell)) meta.tells.push(a.tell);
    if (a.part === 'ceiling' && a.share !== undefined) meta.ceiling = { share: Number(a.share) };
  }
  if (meta.beyond) for (const op of meta.openings) op.beyond = true;
  meta.orange = /<g [^>]*data-set-orange="1"/.test(s);
  for (const c of critterBoxes(s)) if (nearCritter(c.box)) meta.layers.fg += 1;
  return meta;
}

/** Large surfaces (m²) must carry a material. */
export const LARGE_SURFACE_M2 = 2;
export const MIN_TELLS = 3;
export const MIN_DRESSING = { sparse: 3, lived: 8, busy: 16 };

/**
 * The set check (try.mjs): `input` is setBuilder().done().meta or a drawn SVG; `SET` the brief;
 * `cast` (optional) the critters drawn with it (critterAt results or svg), for a builder's meta: a
 * critter near the lens counts as the foreground (nearCritter; a drawn SVG counts it itself).
 * Errors: no floor; fewer than two walls with no corner and no opening; an opening with nothing
 * beyond; no foreground, midground or background; a large surface with no material; fewer than
 * MIN_TELLS tells built (or a tell of the brief never built); too little dressing for the
 * brief's density; a ceiling over CEILING_MAX_SHARE of the frame; orange in the set.
 */
export function setProblems(input, SET = null, { cast = [] } = {}) {
  let meta = typeof input === 'string' ? setMetaFromSvg(input) : input?.meta ?? input;
  if (!meta || typeof meta !== 'object') return ['setProblems needs setBuilder().done() (or its meta) or a drawn SVG'];
  // the cast drawn with the set (critterAt results or their svg): a critter near the lens is the
  // foreground piece (an over-the-shoulder shoulder)
  const near = cast.filter((c) => {
    if (c?.box && c.box.length === 4) return nearCritter(c.box);
    return critterBoxes(typeof c === 'string' ? c : c?.svg ?? '').some((b) => nearCritter(b.box));
  }).length;
  if (near) meta = { ...meta, layers: { ...meta.layers, fg: (meta.layers?.fg ?? 0) + near } };
  const out = [];
  if (!meta.floor) out.push('the set has no floor: build room() (a floor and walls), not things in a void');
  if (!((meta.walls >= 2 && meta.corners >= 1) || (meta.walls >= 1 && meta.openings.length >= 1))) out.push(`the set has ${meta.walls} wall(s), ${meta.corners} corner(s) and ${meta.openings.length} opening(s): it needs two walls meeting at a corner, or a wall with an opening`);
  for (const op of meta.openings) if (!op.beyond && op.kind !== 'door') out.push(`a ${op.kind}${op.wall ? ` in the ${op.wall} wall` : ''} shows nothing beyond: give it a beyond (a street, a skyline, another room)`);
  for (const k of LAYERS) if (!(meta.layers?.[k] > 0)) out.push(k === 'fg' ? 'no foreground layer: put one piece close to the lens, partly cropped (B.foreground)' : k === 'mid' ? 'no midground: the place where the action stands has nothing in it' : 'no background: walls, openings and what is seen through them');
  for (const s of meta.surfaces ?? []) if (s.area >= LARGE_SURFACE_M2 && (!s.mat || s.mat === 'none')) out.push(`a large ${s.part} (${n2(s.area)} m²) has no material: give it one (${Object.keys(MATERIALS).slice(0, 8).join(', ')}, …)`);
  const tells = meta.tells ?? [];
  if (tells.length < MIN_TELLS) out.push(`only ${tells.length} tell(s) built (${tells.join(', ') || 'none'}): build at least ${MIN_TELLS} of the things that make this place recognizable, tagged { tell }`);
  if (SET?.tells) for (const t of SET.tells) if (!tells.includes(t)) out.push(`the brief's tell "${t}" is never built`);
  const dens = SET?.density ?? meta.density;
  if (dens && MIN_DRESSING[dens] !== undefined && (meta.dressing ?? 0) < MIN_DRESSING[dens]) out.push(`the set is ${dens} but has ${meta.dressing ?? 0} dressing thing(s) (at least ${MIN_DRESSING[dens]}): inhabit it with what this place really holds`);
  if (meta.ceiling?.share > CEILING_MAX_SHARE) out.push(`the ceiling takes ${Math.round(meta.ceiling.share * 100)}% of the frame (at most ${Math.round(CEILING_MAX_SHARE * 100)}% in a vertical shot): aim the lens a little lower (fitCeiling(cam, room) does it) or bring it down. Every ceiling style counts the same: 'beamed' only makes the sliver that is left read as architecture, and 'none' is for an open set`);
  if (meta.orange) out.push('orange is drawn in the set: it belongs to the hero and the one focal');
  return out;
}

/**
 * Faces cut by the set (principles §2, "faces are always whole"): in a drawn lens frame (or
 * samples [{ t, svg }]), each critter facing the lens (front or three-quarter) whose eyes or mouth
 * fall inside the screen outline of a set fixture NEARER the lens (a counter, a desk, a solid:
 * setBuilder tags them with data-set-hull and data-set-depth). Fix it by moving the critter or the
 * lens, or a lower piece (run({ h: 'critter' }) keeps a face whole over it). Error strings.
 */
export function faceCutProblems(samples) {
  const list = Array.isArray(samples) ? samples : [{ svg: samples }];
  const out = [];
  const seen = new Set();
  // the face's test points, local units (feet 0, 0; scale 1): eye centres, mouth line, chin
  const FACE_PTS = [[-25, -98], [25, -98], [0, -60], [-20, -44], [20, -44]];
  for (const smp of list) {
    const svg = String(smp?.svg ?? smp ?? '');
    const pieces = [...svg.matchAll(/<g [^>]*data-set-hull="([^"]+)"[^>]*>/g)].map((m) => ({
      hull: m[1].split(' ').map((p) => p.split(',').map(Number)),
      depth: Number(m[0].match(/data-set-depth="([^"]+)"/)?.[1]),
      what: m[0].match(/data-set-tell="([^"]+)"/)?.[1] ?? m[0].match(/data-set-part="([^"]+)"/)?.[1] ?? 'a set piece',
    })).filter((q) => q.hull.length >= 3 && Number.isFinite(q.depth));
    if (!pieces.length) continue;
    // raw (as drawn) critter boxes: the hulls are in the same, pre-framing coordinates
    const cast = [...svg.matchAll(/<g [^>]*data-frame-kind="critter"[^>]*>/g)].map((m) => {
      const at = (k) => m[0].match(new RegExp(`data-frame-${k}="([^"]+)"`))?.[1];
      return { who: at('who'), box: (at('box') ?? '').split(' ').map(Number), depth: Number(at('depth')), view: at('view') };
    });
    for (const c of cast) {
      if (c.view === 'back' || c.box.length !== 4 || !Number.isFinite(c.depth)) continue;
      const k = (c.box[3] - c.box[1]) / 166;
      const feet = [(c.box[0] + c.box[2]) / 2, c.box[3] - 6 * k];
      const pts = FACE_PTS.map(([x, y]) => [feet[0] + x * k, feet[1] + y * k]);
      for (const q of pieces) {
        if (!(q.depth < c.depth)) continue;
        const cut = pts.filter((p) => inConvex(p, q.hull)).length;
        const key = `${c.who}|${q.what}`;
        if (cut && !seen.has(key)) {
          seen.add(key);
          out.push(`the face of "${c.who}" is cut by ${q.what === 'fixture' ? 'a fixture' : `"${q.what}"`} in front of it${typeof smp?.t === 'number' ? ` at ${smp.t.toFixed(2)}s` : ''}: faces stay whole; move the critter or the lens, or lower the piece (run({ h: 'critter' }) keeps a face whole over it)`);
        }
      }
    }
  }
  return out;
}
/** Is point p inside the convex polygon `poly` (either winding)? */
function inConvex(p, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

export { CONTENT_KINDS };
