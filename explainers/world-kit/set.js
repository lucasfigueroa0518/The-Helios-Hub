// The Explainers world kit, set design (4.1, craft § 8; 4.2 exteriors): a place you could walk
// into, for any topic. The scene builder writes a set brief (SET, or a SETS place) in world.js and
// builds the set from these general primitives, all in world centimetres through the lens.js
// perspective camera (x right, y away from the camera, z up) and lit by its rig. Nothing here is a
// kitchen or an ER: a place is architecture (room shells, walls with openings) or an exterior
// (a street, a shopfront, a park, a road, a plaza, a rooftop, a dock: sky, far layer, ground,
// architecture, fixtures), materials (finishes with their own ramp and pattern), fixtures (runs,
// shelving, desks, beds, drapes, signs, lamps), dressing, a foreground piece, and a place beyond.
//
//   SET brief         the scene builder's plan in its own words ({ place, tells, architecture |
//                     exterior, materials, colorStory, layers, beyond, density }); setBriefProblems
//                     checks only names that would not draw (4.2)
//   setBuilder(P, R, SET)   collects { env, items } for lens.render and the set's meta
//     .room({ x, y, h, walls, floor, wall, openings, skirting, dado, cornice, ceiling, enclose })
//     .exterior(kind, { mood, seed, palette, accent, signs, lamps, far, clouds, density })  (4.2)
//     .wall(...)  .run(...)  .shelving(...)  .desk(...)  .chair(...)  .bed(...)  .drape(...)
//     .sign(...)  .lamp(...)  .beam(...)  .solid(...)  .dress(...)  .thing(...)  .foreground(...)
//     .piece(svg, at, { tell })  .beyond(svg, at, { tell, clip })
//     .done() → { env, items, meta, lights, apertures }
//   exterior(P, R, kind, o) · EXTERIOR_KINDS · EXTERIOR_VIEWS · horizonY · skyOf · groundGuard
//   ceiling 'flat' | 'beamed' | 'none' (ceilingShare measures a camera, fitCeiling(cam, room) aims
//                       it below a share: framing helpers, never checks)
//   run({ h: 'critter' }) a counter a critter's whole face shows over (CRITTER_COUNTER_CM, the
//                       chin line; runHeight) · faceCutProblems(svg) a face cut by a set piece
//   beyond { tell, volumes: [{ …, tell }], custom: (P, R, ctx) → svg | { svg, tell } }
//   surface(P, R, pts, mat)   a flat world quad finished in a material (MATERIALS); a lamp with
//                       no aperture throws a pool on it (4.2)
//   scale: 'cheat' | n  dressing (thing, dress), solids (cheatBox) and custom pieces
//                       (lens.js scaledLens) drawn bigger about their base so the action reads (4.2)
//   setProblems(metaOrSvg)   breakage only (4.2): nothing to stand on, a window onto the void,
//                       an unknown material
//
// Every color is a palette token (core TOKENS) or a mix of two. Patterns are drawn in the surface's
// own shaded color, a few percent darker or lighter, so the set reads rich up close and calm in
// value at a glance.

import { mixHex, rng, resolveTone, toneHex, propScale, CRITTER_CM, CRITTER_PX } from './core.js';
import { FACE_KEEPOUT } from './outfits.js';
import { T, el, g, id, isDark, TONES, tonesOf } from './draw.js';
import { blurDef, hashId, V3, glow, lightColor, irradiance, mood as moodOf, hazed } from './light.js';
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
/** The problem with a tone (a name that would not resolve), or null. Orange is a craft call
 *  (house style: it marks what the viewer must look at now), never an error here. */
export function toneProblem(v, where = 'tone') {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object' && Array.isArray(v.mix)) {
    const bad = v.mix.slice(0, 2).map((x) => toneProblem(x, where)).find(Boolean);
    return bad ?? null;
  }
  if (typeof v !== 'string') return `${where} must be a palette token name or { mix: [a, b, k] }`;
  if (TONES[v] || T[v] || v === 'white' || MATERIALS[v] || /^#[0-9A-Fa-f]{6}$/.test(v)) return null;
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
  // 4.2 exteriors
  asphalt: { tone: { mix: ['ink-lit', 'paper-dark', 0.42] }, pattern: 'fleck', size: [36, 36] },
  paving: { tone: { mix: ['paper-shade', 'paper-dark', 0.35] }, pattern: 'grid', size: [60, 60], joint: 1.2 },
  cobbles: { tone: { mix: ['paper-dark', 'ink-lit', 0.18] }, pattern: 'bond', size: [16, 11], joint: 1.4, vary: 0.1 },
  grass: { tone: { mix: ['green-lit', 'yellow-lit', 0.3] }, pattern: 'grass', size: [40, 40], vary: 0.08 },
  gravel: { tone: { mix: ['paper-shade', 'yellow-dark', 0.18] }, pattern: 'fleck', size: [24, 24] },
  sand: { tone: { mix: ['yellow-lit', 'paper-shade', 0.55] }, pattern: 'fleck', size: [30, 30] },
  water: { tone: { mix: ['teal-shade', 'blue', 0.45] }, pattern: 'ripple', size: [160, 70] },
  roofing: { tone: { mix: ['paper-dark', 'ink-lit', 0.3] }, pattern: 'slab', size: [110, 110], joint: 0.8 },
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
    case 'grass': {
      pw = w; ph = h;
      if (m.vary) { rect(0, 0, w / 2, h / 2, alt, 0.35); rect(w / 2, h / 2, w / 2, h / 2, alt, 0.35); }
      for (let i = 0; i < 18; i++) {
        const x = r() * w;
        const y = r() * h;
        const t = 1.6 + r() * 2.2;
        s.push(el('path', { d: `M ${n2(x)} ${n2(y)} l ${n2(-0.5 - r())} ${n2(-t)} M ${n2(x + 0.6)} ${n2(y)} l ${n2(0.4 + r())} ${n2(-t * 0.9)}`, stroke: i % 3 ? line : lite, 'stroke-width': 0.45, 'stroke-linecap': 'round', fill: 'none', opacity: 0.55 }));
      }
      break;
    }
    case 'ripple':
      for (let i = 0; i < 7; i++) {
        const y = (i + 0.5) * (h / 7);
        const x = r() * w * 0.6;
        const lw = w * (0.18 + r() * 0.3);
        s.push(el('path', { d: `M ${n2(x)} ${n2(y)} q ${n2(lw / 4)} ${n2(-1.6)} ${n2(lw / 2)} 0 t ${n2(lw / 2)} 0`, stroke: i % 2 ? lite : line, 'stroke-width': 0.9, fill: 'none', 'stroke-linecap': 'round', opacity: i % 2 ? 0.7 : 0.4 }));
      }
      break;
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
function screenPath(P, pts, guard = 0) {
  const cut = K.clipNear(P, pts, Math.max(1, guard - (P.near ?? 5)));
  if (cut.world.length < 3) return '';
  return `M ${cut.screen.map((q) => `${n1(q[0])} ${n1(q[1])}`).join(' L ')} Z`;
}

/**
 * A flat world quad (4 points, the first three give its plane; corner order: top-left, top-right,
 * bottom-right, bottom-left as seen from its front) finished in a material: its color from the
 * rig, the material's pattern laid on it in cm, a soft falloff toward its lower edge. `holes`
 * (world polygons on the face) are cut out. `n` overrides the normal. Returns an SVG string.
 */
export function surface(P, R, pts, mat, { n, holes = [], falloff = 0.12, cells = 4, origin, opacity = 1, guard = 0, pattern = true } = {}) {
  const m = material(mat);
  const nn = norm(n ?? cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
  const mid = mul(pts.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / pts.length);
  // a point light without an aperture (a lamp, a glowing sign) throws a pool on a big face, falling
  // off round its nearest point, instead of tinting the whole face one color (CRAFT § 2)
  const pooled = (R?.points ?? []).filter((L) => !L.aperture && L.level > 0.02);
  const baseR = pooled.length ? { ...R, points: (R.points ?? []).filter((L) => !pooled.includes(L)) } : R;
  const base = K.shade(m ? m.tone : 'paper', nn, mid, baseR);
  // `guard` (a depth in cm): the part nearer than it is cut away (a ground below the frame's bottom
  // edge projects to huge coordinates a renderer drops; groundGuard gives the depth)
  const outline = screenPath(P, pts, guard);
  if (!outline) return '';
  const d = [outline, ...holes.map((h) => screenPath(P, h)).filter(Boolean)].join(' ');
  const key = hashId(d);
  const cid = id(`srf-${key}`);
  // holes are cut with even-odd inside the outline only (a hole reaching past this face, a tall
  // window over a dado band, must not paint the part outside it)
  const oid = id(`srfo-${hashId(outline)}`);
  const defs = [el('clipPath', { id: cid }, el('path', { d, 'clip-rule': 'evenodd' })), el('clipPath', { id: oid }, el('path', { d: outline }))];
  const body = [el('path', { d, fill: base, 'fill-rule': 'evenodd' })];
  if (m && pattern) {
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
      const [u0, u1, v0, v1] = frontRange(P, o, U, V, guard);
      if (u1 > u0 && v1 > v0) {
        const inner = g({ transform: `translate(${n2(-u0 * w)} ${n2(-v0 * h)})` }, el('rect', { x: n2(u0 * w - 2), y: n2(v0 * h - 2), width: n2((u1 - u0) * w + 4), height: n2((v1 - v0) * h + 4), fill: `url(#${pd.pid})` }));
        body.push(K.faceArt(P, add(add(o, mul(U, u0)), mul(V, v0)), mul(U, u1 - u0), mul(V, v1 - v0), inner, { clip: false, cells }));
      }
    }
  }
  if (falloff > 0) {
    // the face sinks toward its lower (or nearer, for a floor) edge, and lifts toward the light
    const up = Math.abs(nn[2]) > 0.7;
    let a = P(...V3.lerp(pts[0], pts[1], 0.5));
    let b = P(...V3.lerp(pts[3], pts[2], 0.5));
    if (guard > 0 || b[2] <= (P.near ?? 5) + 1 || a[2] <= (P.near ?? 5) + 1) {
      // an edge behind the lens or under the guard: run the falloff over what is drawn instead
      const vis = K.clipNear(P, pts, Math.max(1, guard - (P.near ?? 5))).screen;
      if (vis.length >= 3) {
        const ys = vis.map((q) => q[1]);
        const cx = vis.reduce((m, q) => m + q[0], 0) / vis.length;
        a = [cx, Math.min(...ys)];
        b = [cx, Math.max(...ys)];
      }
    }
    const gid = id(`srfg-${hashId(`${n1(a[0])},${n1(a[1])},${n1(b[0])},${n1(b[1])}`)}`);
    const sh = isDark() ? T['ink-dark'] : T['shadow-warm'];
    defs.push(el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n1(a[0]), y1: n1(a[1]), x2: n1(b[0]), y2: n1(b[1]) }, [
      el('stop', { offset: 0, 'stop-color': up ? sh : T.canvas, 'stop-opacity': up ? n2(falloff * 0.6) : n2(falloff * 0.5) }),
      el('stop', { offset: 0.5, 'stop-color': sh, 'stop-opacity': 0 }),
      el('stop', { offset: 1, 'stop-color': sh, 'stop-opacity': n2(falloff) }),
    ].join('')));
    body.push(el('path', { d, fill: `url(#${gid})`, 'fill-rule': 'evenodd' }));
  }
  for (const L of pooled) {
    // the light's foot on the face's plane, and how much reaches it there
    const foot = sub(L.pos, mul(nn, dot(sub(L.pos, pts[0]), nn)));
    const I = irradiance(L, foot, nn);
    if (!(I > 0.015)) continue;
    const rr = (L.reach ?? 300) * 1.6;
    const ring = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const t1 = norm(Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : cross(nn, [0, 0, 1]));
      const t2 = cross(nn, t1);
      return add(foot, add(mul(t1, Math.cos(a) * rr), mul(t2, Math.sin(a) * rr)));
    });
    const fc = P(...foot);
    // the ring's projection is an ellipse: an elliptical gradient fading to nothing on it, filling
    // its box (the face's clip trims it), so the pool never shows an edge
    const whole = ring.map((q) => P(...q)).filter((q) => q[2] > (P.near ?? 5) + 1);
    if (whole.length < 3 || !(fc[2] > (P.near ?? 5) + 1)) continue;
    const rx = Math.max(...whole.map((q) => Math.abs(q[0] - fc[0])));
    const ry = Math.max(...whole.map((q) => Math.abs(q[1] - fc[1])));
    if (!(rx > 1) || !(ry > 1) || rx > 9000 || ry > 9000) continue;
    const lc = mixHex(K.rampAt(m ? m.tone : 'paper', 1.1), lightColor(L.color ?? 'warm'), 0.55);
    const pid = id(`pool-${hashId(`${n1(fc[0])},${n1(fc[1])},${n1(rx)},${n1(ry)},${lc},${n2(I)}`)}`);
    defs.push(el('radialGradient', { id: pid, gradientUnits: 'userSpaceOnUse', cx: n1(fc[0]), cy: n1(fc[1]), r: n1(rx), gradientTransform: `translate(${n1(fc[0])} ${n1(fc[1])}) scale(1 ${n2(ry / rx)}) translate(${n1(-fc[0])} ${n1(-fc[1])})` }, [[0, Math.min(0.85, I * 2.2)], [0.18, Math.min(0.6, I * 1.4)], [0.5, Math.min(0.25, I * 0.5)], [1, 0]].map(([o, a]) => el('stop', { offset: o, 'stop-color': lc, 'stop-opacity': n2(a) })).join('')));
    body.push(el('rect', { x: n1(fc[0] - rx), y: n1(fc[1] - ry), width: n1(rx * 2), height: n1(ry * 2), fill: `url(#${pid})` }));
  }
  const attrs = { 'clip-path': `url(#${cid})`, 'data-set-mat': m ? m.kind : 'none' };
  if (opacity < 1) attrs.opacity = n2(opacity);
  const out = g(attrs, body);
  return el('defs', {}, defs.join('')) + (holes.length ? g({ 'clip-path': `url(#${oid})` }, out) : out);
}

/** The parameter box [u0, u1, v0, v1] of the face o + uU + vV in front of the lens (depth is
 *  linear in u and v, so each axis is clamped where its corner depths cross the near limit). */
function frontRange(P, o, U, V, guard = 0) {
  const lim = Math.max((P.near ?? 5) + 12, guard);
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
    // the sky named, else the shot's mood's sky (4.2: rig({ mood })), else day
    const sky = B.sky === undefined && R.mood ? [R.mood.sky[0], R.mood.sky[1], R.mood.sky[2]] : (SKY[B.sky ?? 'day'] ?? SKY.day).map((t) => T[t]);
    const ts = P(...fp(0, zTop));
    const bs = P(...fp(0, 0));
    const gid = id(`sky-${hashId(sky.join('') + n1(ts[1]) + n1(bs[1]))}`);
    const moodSky = B.sky === undefined && R.mood;
    out.push(el('defs', {}, el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: 0, y1: n1(ts[1]), x2: 0, y2: n1(bs[1]) }, sky.map((col, i) => el('stop', { offset: [0, 0.8, 1][i], 'stop-color': isDark() && !moodSky ? mixHex(col, T['ink-dark'], 0.55) : col })).join(''))));
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

/** A solid's box after its `scale` ('cheat' or a number, 4.2): grown about its base centre, so it
 *  stays standing where it stood. { at, size }. */
export function cheatBox(o) {
  const k = propScale(o.scale, o.size);
  if (k === 1) return { at: o.at, size: o.size };
  const [w, d, h] = o.size;
  return { at: [o.at[0] + (w - w * k) / 2, o.at[1] + (d - d * k) / 2, o.at[2]], size: [w * k, d * k, h * k] };
}

/** A plain solid: `at` [x, y, z] (its min corner), `size` [w, d, h], `tone`, `radius`, `scale`
 *  ('cheat' or a number: drawn bigger about its base so the action reads). */
export function solid(P, R, o) {
  if (o.scale !== undefined) o = { ...o, ...cheatBox(o), scale: undefined };
  const s = [];
  if (!(o.at[2] > 0)) s.push(K.contactShadow(P, [[o.at[0], o.at[1]], [o.at[0] + o.size[0], o.at[1]], [o.at[0] + o.size[0], o.at[1] + o.size[1]], [o.at[0], o.at[1] + o.size[1]]], { level: 0.2 }));
  if (o.cyl) s.push(K.cylinder(P, [o.at[0] + o.size[0] / 2, o.at[1] + o.size[1] / 2, o.at[2]], o.size[0] / 2, o.size[2], tone(o.tone), R, { seg: 24 }));
  else s.push(K.box(P, o.at, o.size, tone(o.tone ?? 'paper-lit'), R, { radius: o.radius ?? 1.5 }).svg);
  return s.join('');
}

// ── Dressing at density ───────────────────────────────────────────────────────────────────

export const DENSITY = { sparse: 0.35, lived: 0.65, busy: 0.9 };
export const DRESS_KINDS = ['book', 'stack', 'mug', 'jar', 'bottle', 'box', 'paper', 'bowl', 'tray', 'binder', 'kettle', 'towel', 'clipboard', 'cup'];

/** The real size [w, d, h] (cm) of each dressing kind: what 'cheat' grows from. */
export const DRESS_SIZES = { book: [24, 14, 3], stack: [19, 14, 9], binder: [6, 28, 30], mug: [9, 9, 10], cup: [7, 7, 8], jar: [10, 10, 17], bottle: [7, 7, 24], box: [18, 14, 13], paper: [21, 30, 0.2], clipboard: [22, 32, 1], bowl: [24, 24, 7], tray: [36, 24, 3], kettle: [18, 18, 21], towel: [24, 2, 30] };

/** One small thing at world (x, y, z), cm; `scale` ('cheat' or a number) grows it about its base. */
function smallThing(P0, R, kind, [x, y, z], r, tn, scale) {
  if (!DRESS_SIZES[kind]) throw new Error(`set.dress: unknown kind "${kind}" (${DRESS_KINDS.join(', ')})`);
  const P = scale === undefined || scale === null ? P0 : K.scaledLens(P0, [x, y, z], scale, DRESS_SIZES[kind]);
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
export function dress(P, R, { area, kinds = ['book', 'mug'], density = 'lived', palette = ['paper-lit', 'teal-shade', 'blue-shade'], seed = 1, cell = 30, scale } = {}) {
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
      out.push({ svg: smallThing(P, R, kind, p, r, tn, scale), at: [p[0], p[1], p[2] + 5], kind });
    }
  }
  return out;
}

/** One dressing thing placed by hand: `kind` at world `at`, `tone`; `scale` ('cheat' or a number,
 *  4.2) draws it bigger about its base, so a prop the action depends on reads. */
export function thing(P, R, kind, at, tn = 'paper-lit', seed = 1, { scale } = {}) {
  const k = scale === undefined ? 1 : propScale(scale, DRESS_SIZES[kind]);
  return { svg: smallThing(P, R, kind, at, rng(seed), tone(tn), scale), at: [at[0], at[1], at[2] + 5 * k], kind, scale: k };
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
      const bx = o.scale !== undefined ? cheatBox(o) : o;
      const [w, d, h] = bx.size;
      const c = [];
      for (const a of [0, w]) for (const b of [0, d]) for (const z of [0, h]) c.push([bx.at[0] + a, bx.at[1] + b, bx.at[2] + z]);
      add(solid(P, R, o), [bx.at[0] + w / 2, bx.at[1] + d / 2, bx.at[2] + h / 2], o, 'item', c);
    },
    dress(o) {
      const list = dress(P, R, { palette, density: SET.density ?? 'lived', ...o });
      for (const it of list) add(it.svg, it.at, { part: 'dressing', kind: it.kind, layer: o.layer });
      meta.dressing += list.length;
      if (o.tell && list.length) meta.tells.includes(o.tell) || meta.tells.push(o.tell);
      return list.length;
    },
    thing(kind, at, tn, o = {}) { const it = thing(P, R, kind, at, tn, o.seed, { scale: o.scale }); add(it.svg, it.at, { part: 'dressing', kind, ...o }); meta.dressing += 1; },
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
    /** An exterior place (4.2, exterior()): its sky, far layer and ground filed as env (the ground
     *  is the set's floor), its fixtures as items with world bounds, its lamps as lights. Returns
     *  the exterior's result (spots, lanes, horizon, mood). */
    exterior(kind, o = {}) {
      const res = exterior(P, R, kind, o);
      for (const e of res.env) {
        env.push({ svg: tag(e.svg, { part: e.part, layer: 'bg', mat: e.mat, area: e.area, tell: e.tell }), at: e.at, sharp: e.sharp ?? true });
        if (e.mat) meta.surfaces.push({ part: e.part, mat: e.mat, area: e.area ?? 0 });
      }
      // each fixture's world box rides with it: render() paints it right against the cast, and its
      // screen hull lets faceCutProblems see a lamp post or a bench in front of a face
      const cornersOf2 = (b) => (b ? [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => [b[i][0], b[j][1], b[k][2]]))) : null);
      for (const it of res.items) add(it.svg, it.at, { part: it.part ?? 'fixture', tell: it.tell, bounds: it.bounds }, 'item', cornersOf2(it.bounds));
      lights.push(...res.lights);
      meta.layers.bg += 1;
      meta.floor = true;
      meta.exterior = kind;
      for (const t of [o.tell, ...res.tells]) if (t && !meta.tells.includes(t)) meta.tells.push(t);
      return res;
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

// ── Exteriors (4.2) ───────────────────────────────────────────────────────────────────────
//
// An exterior is a place under the sky, built from the same soft-3D solids as a room and lit by
// the shot's mood (light.js mood(); the rig carries it). Each kind is a generic place with the
// tells a stranger reads in a second, in depth layers that read in a vertical frame: the sky (sun
// glow, moon, stars, clouds), a far layer faded into the haze (a skyline, hills, a tree line, a far
// shore), the ground in its material, the near architecture, and fixtures that stand with the cast
// (lamps, trees, benches, cars) and sort with it. Lamps light at evening, night and dark: each is a
// point light with its pool on the ground, returned in `lights` so the cast can stand in it.
//
//   exterior(P, R, kind, opts) → { kind, env, items, lights, tells, spots, lanes, views, horizon, mood }
//   EXTERIOR_VIEWS[kind].wide  a wide camera that shows the place (lens() options)
//   B.exterior(kind, opts)     the same inside setBuilder (filed, tagged, meta.floor set)
//
// opts (all optional): mood (else R.mood, else day) · seed · palette [tones: the facades' or
// the place's dominant hue family] · accent (one tone: an awning, a door, a boat) · signs [text:
// a fascia, a road sign; blank when absent] · lamps (true/false; default: lit when the mood has
// lamps) · far (false: no far layer) · clouds (false) · density 'sparse' | 'lived' | 'busy' (how
// much street furniture) · x [x0, x1] (how wide the built place is) · depth (how far it runs).
// `spots` are named world points to stage the cast on (a door, the kerb, a bench); `lanes.walk`
// is a path a traveller can walk (journey() reads it), `lanes.drive` one a vehicle can.

export const EXTERIOR_KINDS = ['street', 'shopfront', 'park', 'road', 'plaza', 'rooftop', 'dock'];
/** What each exterior is (its tells), for docs and briefs. */
export const EXTERIOR_ABOUT = {
  street: 'a town street seen down its length: the road and its markings, kerbs, pavements, facades on both sides with windows and a shop, street lamps, a tree, a parked car',
  shopfront: 'a shop seen from the pavement: its display window with goods, the door, an awning, a fascia sign, the neighbours on both sides, a lamp, a planter, an A-board',
  park: 'a park: grass, a winding gravel path, round trees at several depths, bushes, a bench, a lamp, a bin, a tree line and hills far off',
  road: 'an open country road running to the horizon: lane markings, grass verges, telegraph poles and their wires, a fence, a road sign, a lone tree, rolling hills',
  plaza: 'a town square: large paving, a fountain in the middle, benches, lamps, planters, bollards, facades round it',
  rooftop: 'a flat roof above the city: roofing, the parapet, air-conditioning units, vents, a water tank, an access hut, an antenna, the skyline beyond',
  dock: 'a harbour quay: timber deck, the quay edge with bollards, water, a moored boat, crates, stacked containers, a crane and the far shore',
};

const DENS = { sparse: 0.5, lived: 1, busy: 1.5 };
/** The screen y of the horizon through the lens P (where the far ground meets the sky). */
export function horizonY(P) {
  const f = norm([P.fwd[0], P.fwd[1], 0]);
  return P(P.pos[0] + f[0] * 1e7, P.pos[1] + f[1] * 1e7, P.pos[2])[1];
}
const toneHexOf = (t) => hexOf(t);

/** The sky of a mood through the lens: a gradient to the horizon, its glow toward the key, the
 *  moon and stars at night, soft clouds by day and evening (world-placed, far, so they barely
 *  parallax). Screen-space, drawn first. */
export function skyOf(P, M, { seed = 1, clouds = true } = {}) {
  const hy = horizonY(P);
  // the whole gradient is seen: its top at the frame's top (or above a horizon set high)
  const top = Math.min(0, hy - 300);
  const [c0, c1, c2] = M.sky;
  const gid = id(`xsky-${hashId(`${c0}${c1}${c2}${n1(hy)}`)}`);
  const out = [el('defs', {}, el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: 0, y1: n1(top), x2: 0, y2: n1(hy) }, [el('stop', { offset: 0, 'stop-color': c0 }), el('stop', { offset: 0.62, 'stop-color': c1 }), el('stop', { offset: 1, 'stop-color': c2 })].join('')))];
  out.push(el('rect', { x: -80, y: -80, width: P.w + 160, height: n1(Math.max(0, hy + 400 + 80)), fill: `url(#${gid})` }));
  const r = rng(seed * 131 + 7);
  // the glow on the side the key light comes from (the sun or moon just out of frame or in it)
  if (M.key && M.name !== 'dark') {
    const kd = M.key.dir;
    const side = kd[0] * P.right[0] + kd[1] * P.right[1] >= 0 ? 1 : -1;
    const gx = side > 0 ? P.w * 0.92 : P.w * 0.08;
    const gcol = M.name === 'night' ? T['blue-lit'] : M.name === 'evening' ? T['yellow-lit'] : T.canvas;
    out.push(glow(gx, hy - 260, M.name === 'evening' ? 900 : 700, { color: gcol, level: M.name === 'night' ? 0.18 : M.name === 'evening' ? 0.55 : 0.35, core: false }));
  }
  if (M.name === 'dark') {
    // the premium stage's warm bloom, high on the key's side
    out.push(glow(P.w * 0.85, hy - 900, 1100, { color: T['stage-orange'], level: 0.14, core: false }));
    out.push(glow(P.w * 0.2, hy - 1200, 800, { color: T.canvas, level: 0.04, core: false }));
  }
  if (M.stars) {
    const dots = [];
    for (let i = 0; i < 90; i++) {
      const x = r() * P.w;
      const y = -40 + r() * Math.max(0, hy - 380);
      const big = r() < 0.12;
      dots.push(el('circle', { cx: n1(x), cy: n1(y), r: n2(big ? 2.6 : 1 + r() * 0.9), fill: T['paper-lit'], opacity: n2(big ? 0.9 : 0.35 + r() * 0.45) }));
    }
    out.push(g({ 'data-k': 'stars' }, dots));
  }
  if (M.moon && M.key) {
    // the moon is the night key's source: where the key comes from
    const far = add(P.pos, mul(M.key.dir, 1e6));
    const q = P(...far);
    if (q[2] > 10 && q[0] > -100 && q[0] < P.w + 100 && q[1] > -100 && q[1] < hy) {
      const rr = 46;
      out.push(glow(q[0], q[1], rr * 5, { color: T['blue-lit'], level: 0.35, core: false }));
      const mg = id(`moon-${hashId(`${n1(q[0])}${n1(q[1])}`)}`);
      out.push(el('defs', {}, el('radialGradient', { id: mg, cx: 0.4, cy: 0.38, r: 0.7 }, el('stop', { offset: 0, 'stop-color': T['paper-lit'] }) + el('stop', { offset: 1, 'stop-color': mixHex(T['paper-shade'], T['blue-lit'], 0.25) }))));
      out.push(el('circle', { cx: n1(q[0]), cy: n1(q[1]), r: rr, fill: `url(#${mg})` }));
      out.push(el('circle', { cx: n1(q[0] + 12), cy: n1(q[1] - 8), r: 9, fill: T['paper-shade'], opacity: 0.45 }) + el('circle', { cx: n1(q[0] - 14), cy: n1(q[1] + 12), r: 6, fill: T['paper-shade'], opacity: 0.4 }));
    }
  }
  if (clouds && (M.name === 'day' || M.name === 'evening')) {
    const lit = M.name === 'evening' ? mixHex(T['yellow-lit'], T['lilac-lit'], 0.35) : T.canvas;
    const base = M.name === 'evening' ? mixHex(T['lilac-lit'], T['blue-dark'], 0.25) : mixHex(T['paper-shade'], T['blue-lit'], 0.22);
    const f = norm([P.fwd[0], P.fwd[1], 0]);
    const side = [f[1], -f[0]];
    for (let i = 0; i < 4; i++) {
      const d = 30000 + r() * 18000;
      const s = (r() - 0.5) * d * 0.55;
      const z = 2600 + r() * 3600;
      const c = P(P.pos[0] + f[0] * d + side[0] * s, P.pos[1] + f[1] * d + side[1] * s, z);
      if (!(c[2] > 10) || c[1] > hy - 120) continue;
      const k = P.focal / c[2];
      const w = (1800 + r() * 2200) * k;
      const puffs = [];
      const n = 4 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) {
        const px = c[0] + (j / (n - 1) - 0.5) * w;
        const pr = w * (0.16 + r() * 0.12) * (1 - Math.abs(j / (n - 1) - 0.5));
        puffs.push([px, c[1] - pr * 0.4, pr]);
      }
      const cid = id(`cloud-${hashId(`${seed}${i}${n1(c[0])}${n1(c[1])}`)}`);
      const shape = puffs.map(([x, y, pr]) => el('circle', { cx: n1(x), cy: n1(y), r: n1(pr) })).join('') + el('rect', { x: n1(c[0] - w / 2), y: n1(c[1] - w * 0.06), width: n1(w), height: n1(w * 0.1), rx: n1(w * 0.05) });
      const gid2 = id(`cloudg-${hashId(`${lit}${base}${n1(c[1])}${n1(w)}`)}`);
      out.push(el('defs', {}, el('clipPath', { id: cid }, shape) + el('linearGradient', { id: gid2, gradientUnits: 'userSpaceOnUse', x1: 0, y1: n1(c[1] - w * 0.3), x2: 0, y2: n1(c[1] + w * 0.05) }, el('stop', { offset: 0, 'stop-color': lit }) + el('stop', { offset: 0.6, 'stop-color': mixHex(lit, base, 0.4) }) + el('stop', { offset: 1, 'stop-color': base }))));
      out.push(g({ 'clip-path': `url(#${cid})`, opacity: M.name === 'evening' ? 0.85 : 0.92 }, el('rect', { x: n1(c[0] - w), y: n1(c[1] - w), width: n1(w * 2), height: n1(w * 1.2), fill: `url(#${gid2})` })));
    }
  }
  return g({ 'data-set-part': 'sky' }, out);
}

/** The haze at the horizon, so the far ground melts into the sky (CRAFT § 2): a soft band, densest
 *  on the horizon line, fading above and below it. */
function horizonHaze(P, M, depth = 300) {
  const hy = horizonY(P);
  const gid = id(`xhaze-${hashId(`${M.haze}${n1(hy)}${depth}`)}`);
  const y0 = hy - depth * 0.45;
  return el('defs', {}, el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: 0, y1: n1(y0), x2: 0, y2: n1(hy + depth) }, [[0, 0], [0.31, 0.55], [0.5, 0.3], [1, 0]].map(([o, a]) => el('stop', { offset: o, 'stop-color': M.haze, 'stop-opacity': a })).join(''))) + el('rect', { x: -80, y: n1(y0), width: P.w + 160, height: n1(depth * 1.45), fill: `url(#${gid})` });
}

/**
 * The depth (cm along the lens axis) below which a horizontal plane at height z is under the
 * frame's bottom edge (with a margin), so a ground polygon can be cut there: a lens with no roll
 * sees one depth per screen row of a plane. 0 when the plane is not below the lens.
 */
export function groundGuard(P, z = 0, margin = 160) {
  const b = -((P.h + margin) - (P.cy ?? P.h / 2)) / P.focal;
  const dz = P.fwd[2] + P.up[2] * b;
  if (!(z < P.pos[2]) || !(dz < -1e-6)) return 0;
  return ((z - P.pos[2]) / dz) * 0.92;
}

/** A ground of `mat` in bands (pattern near, plain far), x [x0, x1], y [y0, y1] at height z. A
 *  slab material (paving, tile) draws its joints as exact world lines, so a large grid stays true
 *  in perspective. */
function groundBands(P, R, mat, { x = [-4000, 4000], y = [-1500, 12000], z = 0, M, haze = true } = {}) {
  const out = [];
  const guard = groundGuard(P, z);
  const m = material(mat);
  const exact = m.pattern === 'grid';
  const cuts = [y[0], ...[-600, 0, 450, 1000, 1700, 2700, 4200].filter((v) => v > y[0] && v < y[1]), y[1]];
  for (let i = 0; i < cuts.length - 1; i++) {
    // each band overlaps the next a little: no hairline seam between them
    const [a, b] = [cuts[i], Math.min(y[1], cuts[i + 1] + (i < cuts.length - 2 ? 3 : 0))];
    const pts = [[x[0], b, z], [x[1], b, z], [x[1], a, z], [x[0], a, z]];
    if (b > 4200) {
      const c = K.shade(m.tone, [0, 0, 1], [0, (a + b) / 2, z], R);
      const cut = K.clipNear(P, pts, Math.max(1, guard - (P.near ?? 5)));
      if (cut.world.length >= 3) out.push(K.quad(P, cut.world, hazed(c, (a + b) / 2 - P.pos[1], M)));
    } else out.push(surface(P, R, pts, mat, { n: [0, 0, 1], cells: 6, falloff: 0, guard, pattern: !exact }));
  }
  if (exact) {
    // the joints: lines along x and along y, in the joint shade, only where the lens can see
    const [w, d] = m.size ?? [60, 60];
    const j = Math.max(0.8, m.joint ?? 1);
    const base = K.shade(m.tone, [0, 0, 1], [P.target[0], P.target[1], z], R);
    const col = mixHex(base, isDark() ? T['ink-dark'] : T['shadow-warm'], isDark() ? 0.35 : 0.2);
    const y1 = Math.min(y[1], 4200);
    const lim = Math.max(1, guard - (P.near ?? 5));
    const lines = [];
    const half = (yy) => Math.max(400, Math.abs(yy - P.pos[1]) * 0.75 + 300);
    for (let yy = Math.ceil(y[0] / d) * d; yy <= y1; yy += d) {
      const hw = half(yy);
      const q = K.clipNear(P, [[Math.max(x[0], P.pos[0] - hw), yy + j / 2, z + 0.15], [Math.min(x[1], P.pos[0] + hw), yy + j / 2, z + 0.15], [Math.min(x[1], P.pos[0] + hw), yy - j / 2, z + 0.15], [Math.max(x[0], P.pos[0] - hw), yy - j / 2, z + 0.15]], lim);
      if (q.world.length >= 3) lines.push(K.quad(P, q.world, col));
    }
    const hw = half(y1);
    for (let xx = Math.ceil(Math.max(x[0], P.pos[0] - hw) / w) * w; xx <= Math.min(x[1], P.pos[0] + hw); xx += w) {
      const q = K.clipNear(P, [[xx - j / 2, y1, z + 0.15], [xx + j / 2, y1, z + 0.15], [xx + j / 2, y[0], z + 0.15], [xx - j / 2, y[0], z + 0.15]], lim);
      if (q.world.length >= 3) lines.push(K.quad(P, q.world, col));
    }
    out.push(g({ 'data-k': 'joints', opacity: 0.8 }, lines));
  }
  if (haze) out.push(horizonHaze(P, M));
  return out.join('');
}

/** A soft pool of light on the ground under a point light (concentric world discs, blurred). */
function pool(P, L, { r = 180, z = 0, level = 0.5 } = {}) {
  const c = lightColor(L.color ?? 'warm');
  const out = [];
  const disc = (rr) => Array.from({ length: 28 }, (_, i) => [L.pos[0] + rr * Math.cos((i / 28) * 2 * Math.PI), L.pos[1] + rr * Math.sin((i / 28) * 2 * Math.PI), z]);
  const q = P(L.pos[0], L.pos[1], z);
  if (!(q[2] > (P.near ?? 5) + 10)) return '';
  const px = r * P.scaleAt(L.pos[0], L.pos[1], z);
  const f = blurDef(Math.max(2, Math.min(40, px * 0.12)), { name: 'xpool', box: 'bbox' });
  for (const [k, a] of [[1, 0.22], [0.66, 0.24], [0.36, 0.3]]) out.push(K.quad(P, disc(r * k), c, { opacity: n2(a * Math.min(1, level * 1.6)) }));
  return g({ 'data-k': 'light', 'data-light': 'pool', filter: f.url }, [el('defs', {}, f.defs), ...out]);
}

/**
 * A building on a street line: its street face runs from `origin` along `u` (unit, left to right as
 * seen from the street) for L cm, facing `n` (toward the street), H tall, D deep. The face is
 * finished in `mat` (tone), with `floors` of windows in bays, a cornice, and a ground floor that is
 * a shop (fascia in `accent`, a display window with goods, a door; `awning`) or a door and windows.
 * Windows reflect the sky by day and light up at night (the mood's `windows`). Returns svg.
 */
function building(P, R, M, o) {
  const { origin, u, n, L, H, D = 900, seed = 1 } = o;
  const r = rng(seed * 977 + 13);
  const at = (s, z, off = 0) => [origin[0] + u[0] * s + n[0] * off, origin[1] + u[1] * s + n[1] * off, z];
  const tn = tone(o.tone ?? 'paper-lit');
  const trim = tone(o.trim ?? 'paper-lit');
  const out = [];
  // the volume (sides and top) and the street face in its material
  const back = [origin[0] - n[0] * D, origin[1] - n[1] * D, 0];
  out.push(K.obox(P, back, mul([u[0], u[1], 0], L), mul([n[0], n[1], 0], D), [0, 0, H], tn, R, { radius: 3, edge: true }).svg);
  if (P.facing(at(L / 2, H / 2), [n[0], n[1], 0])) {
    out.push(surface(P, R, [at(0, H, 0.2), at(L, H, 0.2), at(L, 0, 0.2), at(0, 0, 0.2)], { kind: o.mat ?? 'plaster', tone: o.tone ?? 'paper-lit' }, { n: [n[0], n[1], 0], cells: 3, falloff: 0.1 }));
  } else return out.join('');
  const nn = [n[0], n[1], 0];
  // a quad on the street face, `off` cm proud of it: shaded by the rig, or `flat` (glass, a lit window)
  const quad = (s0, s1, z0, z1, fill, off = 0.8, attrs, flat = false) => K.quad(P, [at(s0, z1, off), at(s1, z1, off), at(s1, z0, off), at(s0, z0, off)], flat ? fill : { tones: tone(fill), n: nn, R }, attrs);
  const lit = (k) => (M.windows === 'lit' ? r() < 0.5 : M.windows === 'some' ? r() < 0.3 : false) && k !== false;
  const glass = (s0, s1, z0, z1, on) => {
    if (on === 'shade') return '';
    if (on) {
      // lit rooms differ: warm lamps, a dimmer amber, now and then the cool of a screen
      const pick2 = r();
      const warm = pick2 < 0.12 ? mixHex(T['blue-lit'], T['paper-lit'], 0.45) : pick2 < 0.4 ? mixHex(T['yellow-shade'], T['yellow-lit'], 0.4) : mixHex(T['yellow-lit'], T.canvas, 0.1 + r() * 0.2);
      const q = P(...at((s0 + s1) / 2, (z0 + z1) / 2, 1));
      return quad(s0, s1, z0, z1, warm, 1.2, undefined, true) + glow(q[0], q[1], Math.max(8, (s1 - s0) * P.scaleAt(...at((s0 + s1) / 2, (z0 + z1) / 2)) * 0.9), { color: 'warm', level: 0.35, core: false });
    }
    const deep = M.dark ? mixHex(T['ink-shade'], T['ink-lit'], 0.5) : mixHex(T['ink-lit'], M.haze, 0.32);
    const sky = M.dark ? mixHex(T['ink-lit'], M.sky[1], 0.22) : mixHex(M.haze, T['paper-lit'], 0.4);
    // the interior seen through it, the sky reflected down from its top, one thin sheen streak
    const a = P(...at((s0 + s1) / 2, z1, 1.4));
    const b = P(...at((s0 + s1) / 2, z0, 1.4));
    const gid = id(`xgl-${hashId(`${sky}${n1(a[1])}${n1(b[1])}`)}`);
    const grad = el('defs', {}, el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n1(a[0]), y1: n1(a[1]), x2: n1(b[0]), y2: n1(b[1]) }, el('stop', { offset: 0, 'stop-color': sky, 'stop-opacity': M.dark ? 0.4 : 0.85 }) + el('stop', { offset: 0.7, 'stop-color': sky, 'stop-opacity': 0.08 }) + el('stop', { offset: 1, 'stop-color': sky, 'stop-opacity': 0 })));
    const w = s1 - s0;
    const h = z1 - z0;
    const streak = K.quad(P, [at(s0 + w * 0.55, z1, 1.5), at(s0 + w * 0.72, z1, 1.5), at(s0 + w * 0.22, z0 + h * 0.15, 1.5), at(s0 + w * 0.05, z0 + h * 0.15, 1.5)], T.canvas, { opacity: M.dark ? 0.06 : 0.22 });
    return quad(s0, s1, z0, z1, deep, 1.2, undefined, true) + grad + quad(s0, s1, z0, z1, `url(#${gid})`, 1.3, undefined, true) + streak;
  };
  // the reveal: the window sits back in the wall, so its head and one jamb are in shade
  const reveal = (s0, s1, z0, z1) => {
    const sh = M.dark ? T['ink-dark'] : T['shadow-warm'];
    const kd = R.dirs[0]?.dir ?? [0.5, -0.5, 0.7];
    const fromRight = kd[0] * u[0] + kd[1] * u[1] > 0;
    const j = fromRight ? [s1 - 9, s1] : [s0, s0 + 9];
    return quad(s0, s1, z1 - 11, z1, sh, 1.45, { opacity: M.dark ? 0.5 : 0.28 }, true) + quad(j[0], j[1], z0, z1, sh, 1.45, { opacity: M.dark ? 0.4 : 0.2 }, true);
  };
  const win = (sc, z0, w, h) => {
    const s0 = sc - w / 2;
    const s1 = sc + w / 2;
    out.push(quad(s0 - 7, s1 + 7, z0 - 7, z0 + h + 7, trim, 0.6));
    const on = lit();
    out.push(glass(s0, s1, z0, z0 + h, on));
    if (!on) out.push(reveal(s0, s1, z0, z0 + h));
    // the mullion and the sill
    out.push(quad(sc - 2, sc + 2, z0, z0 + h, trim, 1.6));
    out.push(K.obox(P, at(s0 - 10, z0 - 9, 8), mul([u[0], u[1], 0], w + 20), mul(nn, -12), [0, 0, 6], trim, R, { radius: 0.6, edge: false }).svg);
  };
  // upper floors
  const g0 = o.groundH ?? 330;
  const fh = o.floorH ?? 300;
  const bays = Math.max(1, Math.round(L / (o.bay ?? 230)));
  const bw = L / bays;
  for (let z = g0 + 60; z + 170 < H - 40; z += fh) for (let b = 0; b < bays; b++) win((b + 0.5) * bw, z, Math.min(130, bw * 0.55), Math.min(170, fh * 0.58));
  // the plinth (a darker stone base), the cornice and the shadow it throws on the wall
  out.push(quad(0, L, 0, 42, { mix: [o.tone ?? 'paper-lit', 'ink-lit', 0.32] }, 0.5));
  out.push(quad(0, L, H - 48, H - 26, M.dark ? T['ink-dark'] : T['shadow-warm'], 0.5, { opacity: M.dark ? 0.45 : 0.16 }, true));
  out.push(K.obox(P, at(-6, H - 26, 0), mul([u[0], u[1], 0], L + 12), mul(nn, 18), [0, 0, 26], trim, R, { radius: 1.5 }).svg);
  out.push(K.obox(P, at(0, g0 - 4, 0), mul([u[0], u[1], 0], L), mul(nn, 6), [0, 0, 8], trim, R, { radius: 0.8, edge: false }).svg);
  // the ground floor
  if (o.shop) {
    const acc = tone(o.accent ?? 'teal');
    const w0 = L * 0.07;
    const w1 = L * 0.6;
    const d0 = L * 0.68;
    const d1 = Math.min(L - 20, d0 + 105);
    // the fascia board, its sign
    out.push(K.obox(P, at(4, g0 - 70, 0), mul([u[0], u[1], 0], L - 8), mul(nn, 10), [0, 0, 56], acc, R, { radius: 1.2 }).svg);
    if (o.sign) {
      const fh2 = 40;
      const wpx = L - 60;
      const art = el('text', { x: n2(wpx / 2), y: n2(fh2 * 0.78), 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended', Roboto", 'font-weight': 700, 'font-size': n2(Math.min(fh2 * 0.8, (wpx / Math.max(4, o.sign.length)) * 1.45)), fill: T['paper-lit'], 'letter-spacing': '0.04em' }, String(o.sign).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
      out.push(K.faceArt(P, at(30, g0 - 22, 10.6), mul([u[0], u[1], 0], wpx), [0, 0, -fh2], art, { clip: false }));
    }
    // the display: a lit interior with shelves of goods, behind glass
    const inner = M.dark ? mixHex(T['yellow-lit'], T['yellow-dark'], 0.25) : mixHex(T['paper-lit'], T['yellow-lit'], 0.25);
    out.push(quad(w0 - 8, w1 + 8, 30, g0 - 76, trim, 0.6));
    const shopLit = M.dark || M.windows !== 'glass';
    out.push(quad(w0, w1, 38, g0 - 84, shopLit ? inner : mixHex(inner, T['ink-lit'], 0.08), 1, undefined, shopLit));
    // a lit display is a practical: it lights the pavement in front of it (and whoever stands there)
    if (shopLit && Array.isArray(o.lights)) o.lights.push({ pos: at((w0 + w1) / 2, 150, 60), level: M.dark ? 0.5 : 0.3, reach: 190, color: 'warm' });
    const goods = [T['teal-lit'], T['blue-lit'], T['yellow-lit'], T['red-lit'], T['green-lit'], T['lilac-lit']].map((c) => mixHex(c, T['paper-shade'], 0.3));
    for (const zz of [60, 130, 195]) {
      out.push(quad(w0 + 6, w1 - 6, zz - 3, zz, mixHex(T['paper-dark'], T['ink-lit'], 0.2), 1.1));
      for (let x = w0 + 14; x < w1 - 22; x += 22 + r() * 12) {
        const gh = 22 + r() * 30;
        out.push(quad(x, x + 14 + r() * 8, zz, zz + gh, goods[Math.floor(r() * goods.length)], 1.15, { opacity: 0.92 }));
      }
    }
    out.push(K.quad(P, [at(w0, g0 - 84, 1.6), at(w0 + (w1 - w0) * 0.35, g0 - 84, 1.6), at(w0 + (w1 - w0) * 0.1, 38, 1.6), at(w0, 38, 1.6)], T.canvas, { opacity: M.dark ? 0.08 : 0.28 }));
    // the door (glazed, a handle) and its step
    out.push(quad(d0 - 8, d1 + 8, 0, 238, trim, 0.6));
    out.push(quad(d0, d1, 0, 230, mixHex(toneHexOf(acc), T.ink, 0.35), 1));
    out.push(glass(d0 + 12, d1 - 12, 100, 215, M.windows !== 'glass' && r() < 0.6));
    out.push(K.obox(P, at(d1 - 26, 100, 2), mul([u[0], u[1], 0], 4), mul(nn, 5), [0, 0, 26], 'ink-lit', R, { radius: 1, edge: false }).svg);
    out.push(K.obox(P, at(d0 - 14, 0, 0), mul([u[0], u[1], 0], d1 - d0 + 28), mul(nn, 30), [0, 0, 9], trim, R, { radius: 1, edge: false }).svg);
    if (o.awning !== false) {
      // a striped awning over the window, sloping out to a valance
      const a0 = w0 - 14;
      const a1 = w1 + 14;
      const za = g0 - 78;
      const out1 = 105;
      const stripes = 7;
      for (let i = 0; i < stripes; i++) {
        const s0 = a0 + ((a1 - a0) * i) / stripes;
        const s1 = a0 + ((a1 - a0) * (i + 1)) / stripes;
        const c = i % 2 ? 'paper-lit' : acc;
        const nrm2 = norm([n[0] * 0.5, n[1] * 0.5, 1]);
        out.push(K.quad(P, [at(s0, za, 1), at(s1, za, 1), at(s1, za - 46, out1), at(s0, za - 46, out1)], { tones: tone(c), n: nrm2, R }));
        out.push(K.quad(P, [at(s0, za - 46, out1), at(s1, za - 46, out1), at(s1, za - 70, out1), at(s0, za - 70, out1)], { tones: tone(c), n: nn, R }));
      }
    }
  } else {
    const d0 = L * (0.15 + r() * 0.5);
    out.push(quad(d0 - 8, d0 + 108, 0, 238, trim, 0.6));
    out.push(quad(d0, d0 + 100, 0, 230, o.door ?? mixHex(toneHexOf(o.accent ?? 'blue-shade'), T.ink, 0.15), 1));
    out.push(K.obox(P, at(d0 + 80, 100, 2), mul([u[0], u[1], 0], 4), mul(nn, 5), [0, 0, 22], 'yellow-dark', R, { radius: 1, edge: false }).svg);
    for (let b = 0; b < bays; b++) {
      const sc = (b + 0.5) * bw;
      if (Math.abs(sc - (d0 + 50)) < bw * 0.5 + 40) continue;
      win(sc, 95, Math.min(120, bw * 0.5), 160);
    }
  }
  return out.join('');
}

/** A street lamp at world `at` (its foot), arm toward `dir` (a floor direction). Returns { svg,
 *  light (null when unlit), at, bounds }. */
function streetLamp(P, R, M, at, { h = 430, dir = [1, 0], lit = M.lamps, arm = 60 } = {}) {
  const [x, y, z = 0] = at;
  const d = norm([dir[0], dir[1], 0]);
  const post = tone({ mix: ['ink-lit', 'blue-dark', 0.15] });
  const head = add([x, y, z + h], mul(d, arm));
  const s = [];
  s.push(K.contactShadow(P, { x, y, r: 16 }, { level: 0.22 }));
  if (z === 0) s.push(K.shadowsOf(P, { x, y, r: 7 }, h, R, { dirLevel: 0.18, pointLevel: 0 }));
  s.push(K.cylinder(P, [x, y, z], 12, 34, post, R, { seg: 18 }));
  s.push(K.cylinder(P, [x, y, z + 34], 5.5, h - 34, post, R, { seg: 14 }));
  s.push(K.obox(P, [x - 3, y - 3, z + h - 6], [d[0] * (arm + 6), d[1] * (arm + 6), 0], [-d[1] * 6, d[0] * 6, 0], [0, 0, 6], post, R, { radius: 1, edge: false }).svg);
  s.push(K.obox(P, add(head, [-d[0] * 22 - d[1] * 14, -d[1] * 22 + d[0] * 14, -14]), [d[0] * 44, d[1] * 44, 0], [-d[1] * -28, d[0] * -28, 0], [0, 0, 14], post, R, { radius: 3 }).svg);
  let light = null;
  if (lit) {
    const lens = [add(head, [-d[0] * 18 - d[1] * 10, -d[1] * 18 + d[0] * 10, -14.5]), add(head, [d[0] * 18 - d[1] * 10, d[1] * 18 + d[0] * 10, -14.5]), add(head, [d[0] * 18 + d[1] * 10, d[1] * 18 - d[0] * 10, -14.5]), add(head, [-d[0] * 18 + d[1] * 10, -d[1] * 18 - d[0] * 10, -14.5])];
    s.push(K.quad(P, lens, mixHex(T['yellow-lit'], T.canvas, 0.45)));
    const q = P(...add(head, [0, 0, -16]));
    if (q[2] > 10) s.push(glow(q[0], q[1], 30 * P.scaleAt(...head) * 1.0 + 20, { color: 'warm', level: M.dark ? 0.8 : 0.55 }));
    light = { pos: add(head, [0, 0, -20]), level: M.dark ? 0.75 : 0.55, reach: 300, color: 'warm' };
  }
  return { svg: s.join(''), light, at: [x, y, z + h / 2], bounds: [[x - 12, y - 12, z], [x + 12, y + 12, z + h]] };
}

/**
 * A clump of foliage through the lens: a soft round mass lit from the key (no gloss: leaves are
 * matte), its lit side broken into smaller leafy clumps, its underside in shade. `tones` the leaf
 * ramp. Screen-space shapes at the clump's projected centre and size.
 */
export function foliage(P, R, c, r, tones, { seed = 1 } = {}) {
  const q = P(...c);
  if (!(q[2] > (P.near ?? 5) + 1)) return '';
  const rad = r * P.scaleAt(...c);
  const key = R.dirs[0]?.dir ?? P.key;
  const kx = dot(key, P.right);
  const ky = -dot(key, P.up);
  const kl = Math.hypot(kx, ky) || 1;
  const [ux, uy] = [kx / kl, ky / kl];
  const lit = K.shade(tones, key, c, R);
  const mid = K.shade(tones, norm(sub(P.pos, c)), c, R);
  const dark = K.shade(tones, mul(key, -1), c, R);
  const rr = rng(seed * 37 + 11);
  const gid = id(`fol-${hashId(`${lit}${mid}${dark}${n2(ux)}${n2(uy)}`)}`);
  const out = [el('defs', {}, el('radialGradient', { id: gid, cx: n2(0.5 + ux * 0.22), cy: n2(0.5 + uy * 0.22), r: 0.72 }, [el('stop', { offset: 0, 'stop-color': mixHex(lit, mid, 0.25) }), el('stop', { offset: 0.55, 'stop-color': mid }), el('stop', { offset: 1, 'stop-color': dark })].join('')))];
  out.push(el('circle', { cx: n1(q[0]), cy: n1(q[1]), r: n1(rad), fill: `url(#${gid})` }));
  // leafy clumps round the rim: lighter toward the light, darker away from it
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rr() * 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const facing = ca * ux + sa * uy;
    const cr = rad * (0.3 + rr() * 0.1);
    const d = rad * (0.74 + rr() * 0.06);
    const col = facing > 0.2 ? mixHex(lit, mid, 0.55 - facing * 0.25) : facing < -0.3 ? mixHex(dark, mid, 0.35) : mid;
    out.push(el('circle', { cx: n1(q[0] + ca * d), cy: n1(q[1] + sa * d), r: n1(cr), fill: col }));
  }
  // a few inner clumps on the lit side give it volume
  for (let i = 0; i < 4; i++) {
    const a = Math.atan2(uy, ux) + (rr() - 0.5) * 1.6;
    const d = rad * (0.25 + rr() * 0.3);
    out.push(el('circle', { cx: n1(q[0] + Math.cos(a) * d), cy: n1(q[1] + Math.sin(a) * d), r: n1(rad * (0.22 + rr() * 0.1)), fill: mixHex(lit, mid, 0.45 + rr() * 0.2), opacity: 0.9 }));
  }
  return g({ 'data-k': 'foliage' }, out);
}

/** A round-canopy tree (or `kind: 'pine'`) at `at`, h tall, canopy radius r. */
function tree(P, R, M, at, { h = 520, r = 160, seed = 1, kind = 'round', far = 0 } = {}) {
  const [x, y, z = 0] = at;
  const rr = rng(seed * 61 + 3);
  const s = [];
  const bark = tone({ mix: ['yellow-dark', 'ink-lit', 0.45] });
  const leaf = [tone({ mix: ['green', 'green-lit', 0.45] }), tone({ mix: ['green-lit', 'yellow-lit', 0.2] }), tone({ mix: ['green', 'teal-shade', 0.3] })];
  s.push(K.contactShadow(P, { x, y, r: r * 0.7 }, { level: 0.2 }));
  if (z === 0) s.push(K.shadowsOf(P, { x, y, r: r * 0.75 }, h * 0.9, R, { dirLevel: 0.14, pointLevel: 0.3 }));
  s.push(K.cylinder(P, [x, y, z], 11, h * 0.55, bark, R, { seg: 14 }));
  const blobs = [];
  if (kind === 'pine') {
    for (let i = 0; i < 4; i++) blobs.push({ c: [x, y, z + h * (0.35 + i * 0.17)], r: r * (0.95 - i * 0.2), t: leaf[i % 3] });
  } else {
    blobs.push({ c: [x, y, z + h * 0.7], r: r * 0.86, t: leaf[0] });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rr() * 0.8;
      blobs.push({ c: [x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42, z + h * (0.6 + rr() * 0.2)], r: r * (0.5 + rr() * 0.14), t: leaf[(i + 1) % 3] });
    }
  }
  blobs.sort((a, b) => P.dist(...b.c) - P.dist(...a.c));
  blobs.forEach((b, i) => s.push(foliage(P, R, b.c, b.r, b.t, { seed: seed * 7 + i })));
  return { svg: s.join(''), at: [x, y, z + h * 0.5], bounds: [[x - r, y - r, z], [x + r, y + r, z + h]] };
}

/** A park bench facing `facing` ('-y' toward the camera, or a floor vector). */
function bench(P, R, M, at, { facing = '-y', tn = { mix: ['yellow-dark', 'paper-shade', 0.35] } } = {}) {
  const ax = axes(facing);
  const base = [at[0], at[1], at[2] ?? 0];
  const w = 160;
  const s = [K.contactShadow(P, footprint(base, ax, w, 50), { level: 0.2 })];
  const iron = tone({ mix: ['ink-lit', 'blue-dark', 0.12] });
  for (const sx of [10, w - 16]) {
    s.push(fbox(P, R, base, ax, [sx, 6, 0], [6, 40, 42], iron, { radius: 1 }));
    s.push(fbox(P, R, base, ax, [sx, 40, 42], [6, 6, 44], iron, { radius: 1 }));
  }
  for (let k = 0; k < 3; k++) s.push(fbox(P, R, base, ax, [0, 4 + k * 13, 42], [w, 11, 4], tn, { radius: 1 }));
  for (let k = 0; k < 2; k++) s.push(fbox(P, R, base, ax, [0, 44, 56 + k * 16], [w, 4, 11], tn, { radius: 1 }));
  const c = fpt(base, ax, w / 2, 25, 40);
  return { svg: s.join(''), at: c, bounds: boundsOfCorners(cornersOfAx(base, ax, w, 50, 90)) };
}
const cornersOfAx = (base, ax, w, d, h) => {
  const fp = footprint(base, ax, w, d);
  return [...fp, ...fp.map((q) => [q[0], q[1], base[2] + h])];
};

/** A small round thing that stands: a bin, a bollard, a planter, a mooring bollard. */
function standing(P, R, M, kind, at, o = {}) {
  const [x, y, z = 0] = at;
  const s = [K.contactShadow(P, { x, y, r: 22 }, { level: 0.24 })];
  let h = 90;
  if (kind === 'bin') {
    const t = tone(o.tone ?? { mix: ['green-shade', 'ink-lit', 0.35] });
    h = 92;
    s.push(K.cylinder(P, [x, y, z], 24, 84, t, R, { seg: 22 }));
    s.push(K.cylinder(P, [x, y, z + 84], 26, 8, t, R, { seg: 22 }));
  } else if (kind === 'bollard') {
    const t = tone(o.tone ?? { mix: ['ink-lit', 'paper-dark', 0.15] });
    h = 92;
    s.push(K.cylinder(P, [x, y, z], 10, 86, t, R, { seg: 16 }));
    s.push(K.sphere(P, [x, y, z + 86], 10.5, t, R));
    s.push(K.cylinder(P, [x, y, z + 66], 10.6, 6, 'paper-lit', R, { seg: 16 }));
  } else if (kind === 'mooring') {
    const t = tone({ mix: ['ink-lit', 'blue-dark', 0.1] });
    h = 60;
    s.push(K.cylinder(P, [x, y, z], 22, 48, t, R, { seg: 20 }));
    s.push(K.cylinder(P, [x, y, z + 48], 28, 10, t, R, { seg: 20 }));
  } else if (kind === 'planter') {
    const t = tone(o.tone ?? { mix: ['paper-shade', 'yellow-dark', 0.25] });
    h = 120;
    s.push(K.box(P, [x - 40, y - 40, z], [80, 80, 55], t, R, { radius: 3 }).svg);
    const leaf = [tone({ mix: ['green', 'green-lit', 0.4] }), tone({ mix: ['green-lit', 'yellow-lit', 0.25] })];
    const bl = [[x - 15, y - 8, z + 85, 34], [x + 18, y + 6, z + 82, 30], [x, y - 18, z + 100, 30], [x + 2, y + 14, z + 108, 26]].sort((a, b) => P.dist(b[0], b[1], b[2]) - P.dist(a[0], a[1], a[2]));
    bl.forEach((b, i) => s.push(foliage(P, R, [b[0], b[1], b[2]], b[3], leaf[i % 2], { seed: i + 3 })));
  } else if (kind === 'bush') {
    const leaf = [tone({ mix: ['green', 'green-lit', 0.35] }), tone({ mix: ['green', 'teal-shade', 0.25] })];
    h = 80;
    const bl = [[x - 30, y, z + 34, 40], [x + 28, y + 6, z + 32, 38], [x, y - 14, z + 48, 40]].sort((a, b) => P.dist(b[0], b[1], b[2]) - P.dist(a[0], a[1], a[2]));
    bl.forEach((b, i) => s.push(foliage(P, R, [b[0], b[1], b[2]], b[3], leaf[i % 2], { seed: i + 7 })));
  }
  return { svg: s.join(''), at: [x, y, z + h / 2], bounds: [[x - 30, y - 30, z], [x + 30, y + 30, z + h]] };
}

/** A small car (a soft toy-like hatchback) along `facing` (the floor direction its nose points). */
function car(P, R, M, at, { facing = [0, 1], tn = 'blue', seed = 1 } = {}) {
  const [x, y, z = 0] = at;
  const f = norm([facing[0], facing[1], 0]);
  const sd = [-f[1], f[0], 0];
  const Lc = 400;
  const Wc = 172;
  const o = add(add([x, y, z + 18], mul(f, -Lc / 2)), mul(sd, -Wc / 2));
  const body = tone(tn);
  const s = [];
  const fp = [add(o, [0, 0, -18]), add(add(o, mul(f, Lc)), [0, 0, -18]), add(add(add(o, mul(f, Lc)), mul(sd, Wc)), [0, 0, -18]), add(add(o, mul(sd, Wc)), [0, 0, -18])];
  s.push(K.contactShadow(P, fp, { level: 0.35, grow: 1.06 }));
  // wheels: dark discs on both flanks
  const wheel = (along, side) => {
    const c = add(add(add(o, mul(f, along)), mul(sd, side ? Wc + 0.6 : -0.6)), [0, 0, 14]);
    const nrm2 = side ? sd : mul(sd, -1);
    if (!P.facing(c, nrm2)) return '';
    const art = el('circle', { cx: 32, cy: 32, r: 32, fill: T['ink-shade'] }) + el('circle', { cx: 32, cy: 32, r: 15, fill: T['paper-dark'] }) + el('circle', { cx: 32, cy: 32, r: 6, fill: T['ink-lit'] });
    const U = mul(f, 64);
    return K.faceArt(P, add(add(c, mul(f, -32)), [0, 0, 32]), U, [0, 0, -64], art, { clip: false });
  };
  s.push(K.obox(P, o, mul(f, Lc), mul(sd, Wc), [0, 0, 62], body, R, { radius: 9, gloss: true }).svg);
  const cab = add(add(o, mul(f, Lc * 0.22)), mul(sd, 10));
  s.push(K.obox(P, add(cab, [0, 0, 62]), mul(f, Lc * 0.55), mul(sd, Wc - 20), [0, 0, 56], body, R, { radius: 12, gloss: true }).svg);
  // glass on the cabin's sides and ends
  const gl = M.dark ? mixHex(T.ink, T['blue-dark'], 0.4) : mixHex(T['ink-lit'], M.sky[1], 0.5);
  const sideGlass = (side) => {
    const base = add(cab, mul(sd, side ? Wc - 20 + 0.6 : -0.6));
    const nrm2 = side ? sd : mul(sd, -1);
    const pts = [add(base, add(mul(f, 18), [0, 0, 110])), add(base, add(mul(f, Lc * 0.55 - 14), [0, 0, 110])), add(base, add(mul(f, Lc * 0.55 - 6), [0, 0, 70])), add(base, add(mul(f, 8), [0, 0, 70]))];
    return P.facing(pts[0], nrm2) ? K.quad(P, pts, gl) : '';
  };
  s.push(sideGlass(0), sideGlass(1));
  for (const end of [0, 1]) {
    const e0 = add(cab, end ? mul(f, Lc * 0.55 + 0.6) : mul(f, -0.6));
    const nrm2 = end ? f : mul(f, -1);
    const pts = [add(e0, add(mul(sd, 10), [0, 0, 110])), add(e0, add(mul(sd, Wc - 30), [0, 0, 110])), add(e0, add(mul(sd, Wc - 26), [0, 0, 70])), add(e0, add(mul(sd, 6), [0, 0, 70]))];
    if (P.facing(pts[0], nrm2)) s.push(K.quad(P, pts, gl));
  }
  s.push(wheel(Lc * 0.2, 0), wheel(Lc * 0.8, 0), wheel(Lc * 0.2, 1), wheel(Lc * 0.8, 1));
  // lamps: white at the nose, red at the tail; lit after dark
  for (const [end, col] of [[1, T['yellow-lit']], [0, T['red-lit']]]) {
    const e0 = add(o, end ? mul(f, Lc + 0.8) : mul(f, -0.8));
    const nrm2 = end ? f : mul(f, -1);
    for (const sx of [22, Wc - 46]) {
      const pts = [add(e0, add(mul(sd, sx), [0, 0, 50])), add(e0, add(mul(sd, sx + 24), [0, 0, 50])), add(e0, add(mul(sd, sx + 24), [0, 0, 38])), add(e0, add(mul(sd, sx), [0, 0, 38]))];
      if (!P.facing(pts[0], nrm2)) continue;
      s.push(K.quad(P, pts, col));
      if (M.lamps) {
        const q = P(...V3.lerp(pts[0], pts[2], 0.5));
        s.push(glow(q[0], q[1], 26 * P.scaleAt(...pts[0]) + 6, { color: col, level: 0.6, core: true }));
      }
    }
  }
  return { svg: s.join(''), at: [x, y, z + 50], bounds: [[Math.min(...fp.map((q) => q[0])), Math.min(...fp.map((q) => q[1])), z], [Math.max(...fp.map((q) => q[0])), Math.max(...fp.map((q) => q[1])), z + 120]] };
}

/** A far layer, faded into the haze: 'skyline' (blocks, lit windows at night), 'hills', 'trees'. */
const core_mix = (a, b, k) => mixHex(a, b, k);
function farLayer(P, R, M, kind, { y = [7000, 16000], x = [-9000, 9000], z = 0, seed = 1, hmin = 900, hmax = 3800, tn, density = 1 } = {}) {
  const r = rng(seed * 433 + 9);
  const out = [];
  if (kind === 'skyline') {
    const blocks = [];
    for (let xx = x[0]; xx < x[1];) {
      const w = 500 + r() * 1100;
      const yy = y[0] + r() * (y[1] - y[0]);
      const h = hmin + r() * r() * (hmax - hmin);
      blocks.push({ x0: xx, x1: xx + w, y: yy, h });
      xx += (w * (0.55 + r() * 0.5)) / density;
    }
    blocks.sort((a, b) => b.y - a.y);
    const fam = M.dark ? [{ mix: ['ink-lit', 'blue-dark', 0.3] }, { mix: ['ink', 'blue-dark', 0.25] }, { mix: ['ink-lit', 'lilac-dark', 0.25] }] : [{ mix: ['paper-shade', 'blue-lit', 0.18] }, { mix: ['paper-dark', 'blue-shade', 0.2] }, { mix: ['paper-lit', 'teal-lit', 0.15] }, { mix: ['paper-dark', 'yellow-dark', 0.12] }];
    for (const [bi, b] of blocks.entries()) {
      const base = tn ? tone(tn) : tone(fam[bi % fam.length]);
      const dist = b.y - P.pos[1];
      const face = [[b.x0, b.y, z + b.h], [b.x1, b.y, z + b.h], [b.x1, b.y, z], [b.x0, b.y, z]];
      const c = hazed(K.shade(base, [0, -1, 0], [(b.x0 + b.x1) / 2, b.y, z + b.h / 2], R), dist, M);
      const side = b.x0 > P.pos[0] ? [[b.x0, b.y, z + b.h], [b.x0, b.y + 500, z + b.h], [b.x0, b.y + 500, z], [b.x0, b.y, z]] : [[b.x1, b.y + 500, z + b.h], [b.x1, b.y, z + b.h], [b.x1, b.y, z], [b.x1, b.y + 500, z]];
      const cs = hazed(K.shade(base, [b.x0 > P.pos[0] ? -1 : 1, 0, 0], [b.x0, b.y, z + b.h / 2], R), dist, M);
      out.push(K.quad(P, side, cs));
      out.push(K.quad(P, face, c));
      // its top edge catches the light; now and then a water tank or a mast on the roof
      out.push(K.quad(P, [[b.x0, b.y - 1, z + b.h], [b.x1, b.y - 1, z + b.h], [b.x1, b.y - 1, z + b.h - 40], [b.x0, b.y - 1, z + b.h - 40]], core_mix(c, M.dark ? T['ink-dark'] : T.canvas, M.dark ? 0.3 : 0.22)));
      if (r() < 0.3) {
        const tx = b.x0 + (b.x1 - b.x0) * (0.25 + r() * 0.5);
        out.push(K.quad(P, [[tx - 90, b.y + 100, z + b.h + 260], [tx + 90, b.y + 100, z + b.h + 260], [tx + 90, b.y + 100, z + b.h + 60], [tx - 90, b.y + 100, z + b.h + 60]], cs));
        out.push(K.quad(P, [[tx - 70, b.y + 100, z + b.h + 60], [tx - 60, b.y + 100, z + b.h + 60], [tx - 60, b.y + 100, z + b.h], [tx - 70, b.y + 100, z + b.h]], cs), K.quad(P, [[tx + 60, b.y + 100, z + b.h + 60], [tx + 70, b.y + 100, z + b.h + 60], [tx + 70, b.y + 100, z + b.h], [tx + 60, b.y + 100, z + b.h]], cs));
      } else if (r() < 0.25) {
        const tx = b.x0 + (b.x1 - b.x0) * (0.2 + r() * 0.6);
        out.push(K.quad(P, [[tx - 8, b.y + 50, z + b.h + 500], [tx + 8, b.y + 50, z + b.h + 500], [tx + 8, b.y + 50, z + b.h], [tx - 8, b.y + 50, z + b.h]], cs));
      }
      if (M.windows !== 'glass') {
        const dots = [];
        const cols = Math.max(2, Math.round((b.x1 - b.x0) / 160));
        const rows = Math.max(2, Math.round(b.h / 260));
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          if (r() > (M.windows === 'lit' ? 0.45 : 0.2)) continue;
          const wx = b.x0 + ((i + 0.3) / cols) * (b.x1 - b.x0);
          const wz = z + ((j + 0.3) / rows) * b.h;
          out.push(K.quad(P, [[wx, b.y - 1, wz + 90], [wx + 70, b.y - 1, wz + 90], [wx + 70, b.y - 1, wz], [wx, b.y - 1, wz]], mixHex(T['yellow-lit'], M.haze, 0.25), { opacity: 0.85 }));
        }
      }
    }
  } else if (kind === 'hills') {
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      const yy = y[1] - (l / (layers - 1)) * (y[1] - y[0]);
      const amp = (hmax - hmin) * (0.5 + l * 0.25) * 0.5;
      const pts = [];
      const N = 18;
      const ph = r() * 6;
      for (let i = 0; i <= N; i++) {
        const xx = x[0] + (i / N) * (x[1] - x[0]);
        const hh = hmin * (0.4 + 0.3 * l) + amp * (0.55 + 0.45 * Math.sin(ph + i * 0.7 + l)) * (0.7 + 0.3 * Math.sin(ph * 2 + i * 1.7));
        pts.push([xx, yy, z + hh]);
      }
      const base = tn ? tone(tn) : tone({ mix: ['green', 'teal-shade', 0.35] });
      const c = hazed(K.shade(base, [0, -0.4, 0.9], [0, yy, z], R), yy - P.pos[1], M);
      const poly = [...pts, [x[1], yy, z - 200], [x[0], yy, z - 200]];
      const scr = poly.map((q) => P(...q)).filter((q) => q[2] > 10);
      if (scr.length > 3) out.push(el('polygon', { points: scr.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' '), fill: c }));
    }
  } else if (kind === 'trees') {
    const base = tn ? tone(tn) : tone({ mix: ['green', 'teal-shade', 0.3] });
    const list = [];
    for (let xx = x[0]; xx < x[1]; xx += 180 + r() * 220) list.push([xx, y[0] + r() * (y[1] - y[0]), 240 + r() * 260]);
    list.sort((a, b) => b[1] - a[1]);
    for (const [xx, yy, rr] of list) {
      const q = P(xx, yy, z + rr * 1.1);
      if (!(q[2] > 10)) continue;
      const c = hazed(K.shade(base, [0, -0.5, 0.85], [xx, yy, z], R), yy - P.pos[1], M);
      out.push(el('circle', { cx: n1(q[0]), cy: n1(q[1]), r: n1(rr * P.scaleAt(xx, yy, z)), fill: c }));
    }
  }
  return g({ 'data-set-part': 'far' }, out);
}

/**
 * An exterior place (4.2): `kind` one of EXTERIOR_KINDS, built through the lens P and lit by the
 * rig R (its mood, or opts.mood). See the section head for the options. Same shape as a room's
 * result plus items: { kind, env: [{ svg, at, part, sharp, mat?, tell? }], items: [{ svg, at,
 * bounds, part, tell? }], lights (its lamps), tells, spots, lanes, horizon (screen y), mood }.
 */
export function exterior(P, R, kind, o = {}) {
  if (!EXTERIOR_KINDS.includes(kind)) throw new Error(`set.exterior: kind must be one of ${EXTERIOR_KINDS.join(', ')} (got "${kind}")`);
  const first = buildExterior(P, R, kind, o);
  // its own lamps light its own surfaces (a second pass under them); the rig of the cast takes
  // them from `lights`
  const fresh = first.lights.filter((L) => !(R.points ?? []).some((q) => q.pos && L.pos && V3.len(V3.sub(q.pos, L.pos)) < 1));
  if (!fresh.length) return first;
  return buildExterior(P, { ...R, points: [...(R.points ?? []), ...fresh] }, kind, o);
}

function buildExterior(P, R, kind, o) {
  const M = moodOf(o.mood ?? R.mood ?? 'day');
  const seed = o.seed ?? 1;
  const r = rng(seed * 7 + EXTERIOR_KINDS.indexOf(kind) * 101);
  const dens = DENS[o.density ?? 'lived'] ?? 1;
  // the default facade family: warm stone, brick, a deep teal, cream, a dusty blue (light to mid-dark)
  const pal = (o.palette ?? [{ mix: ['paper-shade', 'yellow-lit', 0.22] }, { mix: ['red-shade', 'paper-shade', 0.45] }, { mix: ['teal-shade', 'paper-shade', 0.45] }, { mix: ['paper-lit', 'yellow-lit', 0.1] }, { mix: ['blue-shade', 'paper-shade', 0.5] }]);
  const accent = o.accent ?? 'teal';
  const lampsOn = o.lamps ?? M.lamps;
  const env = [];
  const items = [];
  const lights = [];
  const spots = {};
  const lanes = {};
  const tells = [];
  const tell = (t) => { if (t && !tells.includes(t)) tells.push(t); return t; };
  // the shot's own lamps light this place's surfaces (and are returned for the cast)
  const lampAt = (at, opts) => {
    const L = streetLamp(P, R, M, at, { ...opts, lit: lampsOn && (opts?.lit ?? true) });
    if (L.light) lights.push(L.light);
    return L;
  };
  const sky = () => env.push({ svg: skyOf(P, M, { seed, clouds: o.clouds !== false }), at: [0, 1e6, 0], part: 'sky', sharp: true });
  const far = (k, opt) => { if (o.far !== false) env.push({ svg: farLayer(P, R, M, k, { seed, ...opt }), at: [0, 9e5, 0], part: 'far', sharp: true }); };
  const ground = (mat, opt) => env.push({ svg: groundBands(P, R, mat, { M, ...opt }), at: [0, 0, 0], part: 'ground', mat: material(mat).kind, area: 999, sharp: true });
  const addItem = (it, part, t) => items.push({ svg: it.svg, at: it.at, bounds: it.bounds, part, tell: t });
  const pick = (i) => pal[i % pal.length];

  if (kind === 'street') {
    const RW = 270;
    const PW = 300;
    const xf = RW + PW;
    sky();
    far('skyline', { y: [9000, 15000], x: [-5000, 5000], hmin: 600, hmax: 2600, density: 1.6 });
    // the road (sunk a kerb's height), its markings, the kerbs and the pavements
    ground('asphalt', { x: [-RW, RW], y: [-1500, 9000], z: -14, haze: false });
    ground(o.ground ?? 'paving', { x: [-xf - 10, -RW], y: [-1500, 9000], z: 0, haze: false });
    ground(o.ground ?? 'paving', { x: [RW, xf + 10], y: [-1500, 9000], z: 0 });
    const marks = [];
    for (let yy = -700; yy < 8000; yy += 600) marks.push(K.quad(P, [[-7, yy + 300, -13.6], [7, yy + 300, -13.6], [7, yy, -13.6], [-7, yy, -13.6]], { tones: tone('paper-lit'), n: [0, 0, 1], R }, { opacity: 0.9 }));
    // a zebra crossing
    for (let i = -4; i <= 4; i++) marks.push(K.quad(P, [[i * 56 - 20, 560, -13.6], [i * 56 + 20, 560, -13.6], [i * 56 + 20, 300, -13.6], [i * 56 - 20, 300, -13.6]], { tones: tone('paper-lit'), n: [0, 0, 1], R }));
    // the wheels' wear in each lane, a manhole cover, a drain grate by the kerb
    const sh = M.dark ? T['ink-dark'] : T['ink-lit'];
    for (const lx of [-170, -70, 70, 170]) marks.push(K.quad(P, [[lx - 15, 9000, -13.8], [lx + 15, 9000, -13.8], [lx + 15, -1000, -13.8], [lx - 15, -1000, -13.8]], sh, { opacity: 0.045 }));
    const mh = Array.from({ length: 24 }, (_, k) => [120 + 36 * Math.cos((k / 24) * Math.PI * 2), 120 + 36 * Math.sin((k / 24) * Math.PI * 2), -13.7]);
    marks.push(K.quad(P, mh, { tones: tone({ mix: ['ink-lit', 'paper-dark', 0.25] }), n: [0, 0, 1], R }));
    marks.push(K.quad(P, mh.map((q) => [120 + (q[0] - 120) * 0.8, 120 + (q[1] - 120) * 0.8, -13.6]), sh, { opacity: 0.25 }));
    marks.push(K.quad(P, [[-RW + 2, 980, -13.7], [-RW + 40, 980, -13.7], [-RW + 40, 900, -13.7], [-RW + 2, 900, -13.7]], sh, { opacity: 0.4 }));
    env.push({ svg: marks.join(''), at: [0, 400, -14], part: 'markings', tell: tell('the road'), sharp: true });
    // the kerbs stand a kerb's height: items with their boxes, in lengths, so a car below them sorts right
    for (const kx of [-RW - 18, RW]) for (let yy = -1500; yy < 9000; yy += 1500) addItem({ svg: K.box(P, [kx, yy, -14], [18, 1500, 14], tone('paper-shade'), R, { radius: 1, edge: true }).svg, at: [kx + 9, yy + 750, -7], bounds: [[kx, yy, -14], [kx + 18, yy + 1500, 0]] }, 'kerb');
    tell('the crossing');
    // facades both sides, far to near
    const blocks = [];
    for (const side of [-1, 1]) {
      // the terraces run from behind the lens to the far end, so a side-on shot along the
      // pavement always has a facade behind it
      let yy = -1000;
      let i = side > 0 ? 1 : 0;
      while (yy < 7500) {
        const L = 420 + r() * 420;
        const H = 650 + Math.floor(r() * 3) * 300 + (r() < 0.2 ? 300 : 0);
        const shop = yy < 2000 && r() < 0.75;
        blocks.push({ side, y0: yy, L, H, tn: pick(i), mat: r() < 0.35 ? 'brick' : 'plaster', shop, accent: i % 2 ? accent : (o.accent2 ?? 'blue'), i, sign: shop ? o.signs?.[(i + (side > 0 ? 1 : 0)) % (o.signs.length || 1)] : undefined });
        yy += L;
        i += 1;
      }
    }
    blocks.sort((a, b) => b.y0 - a.y0);
    for (const b of blocks) {
      const origin = b.side < 0 ? [-xf, b.y0, 0] : [xf, b.y0 + b.L, 0];
      const u = b.side < 0 ? [0, 1, 0] : [0, -1, 0];
      const n = b.side < 0 ? [1, 0, 0] : [-1, 0, 0];
      env.push({ svg: building(P, R, M, { origin, u, n, L: b.L, H: b.H, D: 900, tone: b.tn, mat: b.mat, shop: b.shop, accent: b.accent, sign: b.sign, seed: seed * 17 + b.i * 3 + (b.side > 0 ? 50 : 0), lights: b.y0 < 2400 && lampsOn ? lights : null }), at: [b.side * xf, b.y0 + b.L / 2, b.H / 2], part: 'facade', tell: tell('facades with shops'), sharp: true });
    }
    // lamps along both kerbs, a tree, a bin, a parked car
    for (let yy = 150; yy < 6500; yy += 1100) {
      for (const side of [-1, 1]) {
        const L = lampAt([side * (RW + 35), yy + (side > 0 ? 550 : 0), 0], { dir: [-side, 0] });
        addItem(L, 'fixture', tell('street lamps'));
      }
    }
    addItem(tree(P, R, M, [-(RW + 120), 1150, 0], { h: 560, r: 150, seed }), 'fixture', tell('a street tree'));
    if (dens >= 1) addItem(standing(P, R, M, 'bin', [RW + 70, 380, 0]), 'fixture', 'a bin');
    addItem(car(P, R, M, [RW - 110, 1700, -14], { facing: [0, 1], tn: o.carTone ?? 'red', seed }), 'fixture', tell('a parked car'));
    if (dens > 1) addItem(car(P, R, M, [-RW + 110, 3200, -14], { facing: [0, -1], tn: 'yellow', seed: seed + 1 }), 'fixture', 'a second car');
    spots.pavementL = [-(RW + PW / 2), 300, 0];
    spots.pavementR = [RW + PW / 2, 300, 0];
    spots.road = [0, 300, -14];
    spots.crossing = [0, 430, -14];
    spots.doorL = [-xf + 40, 200 + 260, 0];
    lanes.walk = [[-(RW + PW / 2), -300, 0], [-(RW + PW / 2), 2600, 0]];
    lanes.drive = [[-130, -900, -14], [-130, 8000, -14]];
  } else if (kind === 'shopfront') {
    const yf = o.y ?? 320;
    sky();
    far('skyline', { y: [6000, 12000] });
    ground('asphalt', { x: [-4000, 4000], y: [-1600, -240], z: -14, haze: false });
    ground(o.ground ?? 'paving', { x: [-4000, 4000], y: [-240, yf + 900], z: 0 });
    for (let xx = -4000; xx < 4000; xx += 1000) addItem({ svg: K.box(P, [xx, -258, -14], [1000, 18, 14], tone('paper-shade'), R, { radius: 1 }).svg, at: [xx + 500, -249, -7], bounds: [[xx, -258, -14], [xx + 1000, -240, 0]] }, 'kerb');
    const row = [
      { x0: -1240, L: 640, H: 1050, tn: pick(1), mat: 'brick', shop: true, accent: o.accent2 ?? 'blue' },
      { x0: -600, L: 600 + (o.wide ? 200 : 0), H: 900, tn: pick(0), mat: 'plaster', shop: true, accent, sign: o.signs?.[0], main: true },
      { x0: o.wide ? 200 : 0, L: 560, H: 1200, tn: pick(2), mat: 'plaster', shop: false, accent: 'green-shade' },
      { x0: o.wide ? 760 : 560, L: 620, H: 980, tn: pick(3), mat: 'brick', shop: true, accent: 'yellow-shade' },
    ];
    row.sort((a, b) => Math.abs(b.x0 + b.L / 2 - P.pos[0]) - Math.abs(a.x0 + a.L / 2 - P.pos[0]));
    for (const [i, b] of row.entries()) env.push({ svg: building(P, R, M, { origin: [b.x0, yf, 0], u: [1, 0, 0], n: [0, -1, 0], L: b.L, H: b.H, D: 800, tone: b.tn, mat: b.mat, shop: b.shop, accent: b.accent, sign: b.sign, seed: seed * 13 + i, lights: lampsOn ? lights : null }), at: [b.x0 + b.L / 2, yf + 400, b.H / 2], part: 'facade', tell: tell(b.main ? 'the shop' : 'the neighbours'), sharp: true });
    tell('its display window');
    tell('an awning');
    // the pavement: a lamp at the kerb, a planter, an A-board, a bench
    addItem(lampAt([-460, -200, 0], { dir: [0, 1] }), 'fixture', tell('a street lamp'));
    addItem(standing(P, R, M, 'planter', [-560, yf - 80, 0]), 'fixture', 'a planter');
    if (dens >= 1) addItem(standing(P, R, M, 'planter', [180, yf - 80, 0]), 'fixture', 'a planter');
    const ab = aBoard(P, R, M, [-60, yf - 190, 0], { accent });
    addItem(ab, 'fixture', tell('an A-board'));
    if (dens > 1) addItem(bench(P, R, M, [380, -120, 0], { facing: '+y' }), 'fixture', 'a bench');
    spots.door = [-600 + (600 + (o.wide ? 200 : 0)) * 0.68 + 52, yf - 30, 0];
    spots.window = [-600 + (600 + (o.wide ? 200 : 0)) * 0.33, yf - 60, 0];
    spots.pavement = [-150, 60, 0];
    spots.kerb = [0, -200, 0];
    lanes.walk = [[-1100, 40, 0], [900, 40, 0]];
    lanes.drive = [[-3000, -700, -14], [3000, -700, -14]];
  } else if (kind === 'park') {
    sky();
    far('hills', { y: [9000, 15000], hmin: 300, hmax: 1600 });
    far('trees', { y: [5000, 7000], x: [-6000, 6000] });
    ground(o.ground ?? 'grass', { x: [-5000, 5000], y: [-1500, 9000] });
    // a winding gravel path from the near left to the far right
    const path = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      path.push([-520 + 900 * t + 260 * Math.sin(t * Math.PI * 1.6), -700 + 4200 * t * t + 300 * t, 0.4]);
    }
    const pw = 150;
    const strips = [];
    // each vertex offset along the mean of its two segments' normals (mitred), so strips share edges
    const off = path.map((p0, i) => {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      const d = norm(sub(b, a));
      return [-d[1] * pw / 2, d[0] * pw / 2, 0];
    });
    const guard = groundGuard(P, 0.4);
    const outline = [...path.map((p0, i) => add(p0, off[i])), ...path.map((p0, i) => sub(p0, off[i])).reverse()];
    const gm = material('gravel');
    const cutP = K.clipNear(P, outline, Math.max(1, guard - (P.near ?? 5)));
    if (cutP.world.length >= 3) strips.push(K.quad(P, cutP.world, { tones: gm.tone, n: [0, 0, 1], R }));
    // its edges: a slightly darker verge line where gravel meets grass
    for (const sgn of [1, -1]) {
      const edge = path.map((p0, i) => add(p0, mul(off[i], sgn)));
      const pts = edge.map((q) => P(...q)).filter((q) => q[2] > Math.max(guard, (P.near ?? 5) + 1));
      if (pts.length > 1) strips.push(el('polyline', { points: pts.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' '), fill: 'none', stroke: M.dark ? T['ink-dark'] : mixHex(T['green-dark'], T['shadow-warm'], 0.5), 'stroke-width': 2.5, opacity: 0.35, 'stroke-linejoin': 'round' }));
    }
    env.push({ svg: strips.join(''), at: [0, 1000, 0], part: 'path', mat: 'gravel', tell: tell('a gravel path'), sharp: true });
    const trees = [[-640, 900, 600, 190], [520, 1700, 700, 220], [-260, 2900, 640, 210], [900, 3600, 560, 180], [-1100, 2200, 620, 200], [200, 5200, 600, 200]];
    for (const [i, [tx, ty, th, tr]] of trees.entries()) addItem(tree(P, R, M, [tx, ty, 0], { h: th, r: tr, seed: seed + i }), 'fixture', tell('round trees'));
    addItem(standing(P, R, M, 'bush', [-420, 260, 0]), 'fixture', 'bushes');
    addItem(standing(P, R, M, 'bush', [430, 900, 0]), 'fixture', 'bushes');
    addItem(bench(P, R, M, [-60 - 80, 700, 0], { facing: [0.25, -1] }), 'fixture', tell('a bench'));
    addItem(lampAt([200, 380, 0], { dir: [-1, 0], h: 380, arm: 34 }), 'fixture', tell('a park lamp'));
    if (dens >= 1) addItem(standing(P, R, M, 'bin', [180, 640, 0], { tone: { mix: ['green-shade', 'ink-lit', 0.3] } }), 'fixture', 'a bin');
    tell('hills');
    spots.bench = [-60, 690, 0];
    spots.path = path[5].slice(0, 2).concat(0);
    spots.lawn = [380, 300, 0];
    lanes.walk = path.slice(2, 16).map((q) => [q[0], q[1], 0]);
  } else if (kind === 'road') {
    sky();
    far('hills', { y: [10000, 22000], hmin: 400, hmax: 2600 });
    ground(o.ground ?? 'grass', { x: [-6000, 6000], y: [-1500, 16000] });
    ground('asphalt', { x: [-230, 230], y: [-1500, 16000], z: 0.3, haze: false });
    const marks = [];
    for (let yy = -800; yy < 15000; yy += 700) marks.push(K.quad(P, [[-6, yy + 350, 0.8], [6, yy + 350, 0.8], [6, yy, 0.8], [-6, yy, 0.8]], { tones: tone('paper-lit'), n: [0, 0, 1], R }));
    for (const sx of [-212, 200]) marks.push(K.quad(P, [[sx, 16000, 0.8], [sx + 12, 16000, 0.8], [sx + 12, -1500, 0.8], [sx, -1500, 0.8]], { tones: tone('yellow-lit'), n: [0, 0, 1], R }));
    env.push({ svg: marks.join(''), at: [0, 3000, 0], part: 'markings', tell: tell('the open road'), sharp: true });
    // telegraph poles on the left and their wires; a fence on the right; a sign; a lone tree
    const poles = [];
    for (let yy = 200; yy < 14000; yy += 1600) poles.push([-470, yy]);
    const wires = [];
    for (let i = 0; i < poles.length - 1; i++) {
      for (const dx of [-40, 40]) {
        const a = [poles[i][0] + dx, poles[i][1], 760];
        const b = [poles[i + 1][0] + dx, poles[i + 1][1], 760];
        const pts = Array.from({ length: 9 }, (_, k) => { const t = k / 8; return P(...V3.lerp(a, b, t).map((v, j) => (j === 2 ? v - 60 * Math.sin(Math.PI * t) : v))); }).filter((q) => q[2] > 10);
        if (pts.length > 1) wires.push(el('polyline', { points: pts.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' '), fill: 'none', stroke: M.dark ? T['ink-dark'] : T['ink-lit'], 'stroke-width': n2(Math.max(0.8, 1.4 * P.scaleAt(...a) * 0.6)), opacity: 0.7 }));
      }
    }
    env.push({ svg: wires.join(''), at: [-470, 3000, 700], part: 'wires', sharp: true });
    for (const [px, py] of poles) {
      const wood = tone({ mix: ['yellow-dark', 'ink-lit', 0.4] });
      addItem({ svg: K.contactShadow(P, { x: px, y: py, r: 18 }, { level: 0.2 }) + K.cylinder(P, [px, py, 0], 11, 790, wood, R, { seg: 12 }) + K.box(P, [px - 60, py - 6, 740], [120, 12, 10], wood, R, { radius: 1 }).svg, at: [px, py, 400], bounds: [[px - 60, py - 12, 0], [px + 60, py + 12, 800]] }, 'fixture', tell('telegraph poles'));
    }
    // the fence stands: each bay (a post and its two rails) is an item with its world box, so a car
    // or a critter beyond it is painted behind it and one nearer in front (4.2 layering)
    const wood = tone({ mix: ['yellow-dark', 'paper-shade', 0.3] });
    for (let yy = -300; yy < 6000; yy += 260) {
      const bay = K.box(P, [430, yy, 0], [8, 8, 110], wood, R, { radius: 1 }).svg + K.box(P, [431, yy, 80], [6, 262, 7], wood, R, { radius: 1 }).svg + K.box(P, [431, yy, 45], [6, 262, 7], wood, R, { radius: 1 }).svg;
      addItem({ svg: bay, at: [434, yy + 130, 55], bounds: [[430, yy, 0], [438, yy + 262, 110]] }, 'fixture', tell('a fence'));
    }
    addItem(roadSign(P, R, M, [310, 1500, 0], { text: o.signs?.[0], accent: o.accent ?? 'green' }), 'fixture', tell('a road sign'));
    addItem(tree(P, R, M, [-900, 2600, 0], { h: 640, r: 230, seed }), 'fixture', tell('a lone tree'));
    tell('hills on the horizon');
    spots.verge = [-330, 300, 0];
    spots.road = [-110, 300, 0];
    spots.sign = [310, 1480, 0];
    lanes.walk = [[-330, -300, 0], [-330, 3200, 0]];
    lanes.drive = [[-110, -1200, 0], [-110, 14000, 0]];
  } else if (kind === 'plaza') {
    sky();
    ground(o.ground ?? 'paving', { x: [-3000, 3000], y: [-1500, 9000] });
    const row = [];
    for (let xx = -2400, i = 0; xx < 2400; i++) {
      const L = 520 + r() * 300;
      row.push({ origin: [xx, 2600, 0], u: [1, 0, 0], n: [0, -1, 0], L, H: 800 + Math.floor(r() * 3) * 300, i });
      xx += L;
    }
    for (const side of [-1, 1]) for (let yy = 2600, i = 0; yy > 300; i++) {
      const L = 520 + r() * 260;
      row.push(side < 0 ? { origin: [-1500, yy - L, 0], u: [0, 1, 0], n: [1, 0, 0], L, H: 750 + Math.floor(r() * 3) * 300, i: i + 20 } : { origin: [1500, yy, 0], u: [0, -1, 0], n: [-1, 0, 0], L, H: 750 + Math.floor(r() * 3) * 300, i: i + 40 });
      yy -= L;
    }
    const mid = (b) => [b.origin[0] + (b.u[0] * b.L) / 2, b.origin[1] + (b.u[1] * b.L) / 2, 0];
    row.sort((a, b) => P.dist(...mid(b)) - P.dist(...mid(a)));
    for (const b of row) env.push({ svg: building(P, R, M, { ...b, D: 900, tone: pick(b.i), mat: b.i % 3 === 1 ? 'brick' : 'plaster', shop: b.i % 2 === 0, accent: [accent, 'blue', 'yellow-shade', 'green-shade'][b.i % 4], seed: seed * 19 + b.i, lights: lampsOn && b.u[0] === 1 ? lights : null }), at: [b.origin[0], b.origin[1], b.H / 2], part: 'facade', tell: tell('facades round the square'), sharp: true });
    addItem(fountain(P, R, M, [0, 1100, 0], { seed }), 'fixture', tell('a fountain'));
    for (const [i, [bx, by, f]] of [[-640, 820, '+x'], [460, 820, '-x']].entries()) addItem(bench(P, R, M, [bx, by, 0], { facing: f }), 'fixture', i ? 'benches' : tell('benches'));
    for (const [lx, ly] of [[-900, 200], [900, 260], [-900, 1900], [900, 1900]]) addItem(lampAt([lx, ly, 0], { dir: [lx < 0 ? 1 : -1, 0], h: 400, arm: 40 }), 'fixture', tell('lamps'));
    for (const bx of [-780, -640, 640, 780]) addItem(standing(P, R, M, 'bollard', [bx, -60, 0]), 'fixture', 'bollards');
    addItem(standing(P, R, M, 'planter', [-1100, 900, 0]), 'fixture', 'planters');
    addItem(standing(P, R, M, 'planter', [1100, 900, 0]), 'fixture', 'planters');
    spots.fountain = [0, 1100, 0];
    spots.bench = [-560, 840, 0];
    spots.center = [0, 500, 0];
    lanes.walk = [[-900, 420, 0], [900, 420, 0]];
  } else if (kind === 'rooftop') {
    sky();
    far('skyline', { y: [9000, 16000], x: [-12000, 12000], z: -2400, hmin: 2200, hmax: 6800, seed: seed + 3 });
    far('skyline', { y: [3200, 8000], x: [-7000, 7000], z: -2400, hmin: 1600, hmax: 3600, seed: seed + 9, density: 1.4 });
    const yb = o.y ?? 900;
    ground(o.ground ?? 'roofing', { x: [-900, 900], y: [-1500, yb], z: 0, haze: false });
    // the parapet on the far edge and both sides
    const par = tone({ mix: ['paper-shade', 'paper-dark', 0.4] });
    const cap = tone('paper-lit');
    env.push({ svg: [K.box(P, [-900, yb, 0], [1800, 26, 105], par, R, { radius: 2 }).svg, K.box(P, [-912, yb - 4, 105], [1824, 34, 9], cap, R, { radius: 1.5 }).svg].join(''), at: [0, yb, 50], part: 'parapet', tell: tell('the parapet'), sharp: true });
    for (const sx of [-926, 900]) env.push({ svg: K.box(P, [sx, -1500, 0], [26, yb + 1526, 105], par, R, { radius: 2 }).svg + K.box(P, [sx - 4, -1500, 105], [34, yb + 1530, 9], cap, R, { radius: 1.5 }).svg, at: [sx, 0, 50], part: 'parapet', sharp: true });
    addItem(acUnit(P, R, M, [-330, 330, 0]), 'fixture', tell('air-conditioning units'));
    addItem(acUnit(P, R, M, [-330, 520, 0]), 'fixture', 'air-conditioning units');
    addItem(waterTank(P, R, M, [-560, 760, 0]), 'fixture', tell('a water tank'));
    addItem(hut(P, R, M, [330, 560, 0], { accent }), 'fixture', tell('an access hut'));
    for (const [vx, vy] of [[-60, 640], [-10, 690]]) addItem({ svg: K.cylinder(P, [vx, vy, 0], 9, 70, tone('paper-dark'), R, { seg: 14 }) + K.cylinder(P, [vx, vy, 70], 13, 10, tone('paper-dark'), R, { seg: 14 }), at: [vx, vy, 40], bounds: [[vx - 13, vy - 13, 0], [vx + 13, vy + 13, 80]] }, 'fixture', tell('vents'));
    addItem({ svg: K.cylinder(P, [620, 840, 0], 4, 600, tone('ink-lit'), R, { seg: 8 }) + K.box(P, [570, 836, 470], [100, 8, 6], tone('ink-lit'), R).svg + K.box(P, [590, 836, 540], [60, 8, 6], tone('ink-lit'), R).svg, at: [620, 840, 300], bounds: [[570, 830, 0], [670, 850, 600]] }, 'fixture', tell('an antenna'));
    // a skylight and a conduit across the roof, so the near roof is never empty
    const sk = [K.contactShadow(P, [[120, -60], [260, -60], [260, 60], [120, 60]], { level: 0.25 }), K.box(P, [120, -60, 0], [140, 120, 28], tone({ mix: ['paper-shade', 'paper-dark', 0.3] }), R, { radius: 2 }).svg, K.quad(P, [[128, 52, 28.5], [252, 52, 28.5], [252, -52, 28.5], [128, -52, 28.5]], M.dark ? mixHex(T['yellow-lit'], T['paper-lit'], 0.3) : mixHex(T['ink-lit'], M.sky[0], 0.45))];
    addItem({ svg: sk.join(''), at: [190, 0, 14], bounds: [[120, -60, 0], [260, 60, 28]] }, 'fixture', tell('a skylight'));
    env.push({ svg: K.box(P, [-900, 120, 0], [1220, 10, 8], tone('paper-dark'), R, { radius: 3, edge: false }).svg, at: [0, 120, 4], part: 'conduit', sharp: true });
    if (lampsOn) {
      const L = { pos: [330, 470, 230], level: 0.5, reach: 220, color: 'warm' };
      lights.push(L);
    }
    tell('the skyline below');
    spots.edge = [0, yb - 80, 0];
    spots.center = [-60, 260, 0];
    spots.hut = [330, 440, 0];
    lanes.walk = [[-600, 600, 0], [500, 120, 0]];
  } else if (kind === 'dock') {
    const ye = o.y ?? 420;
    const yq = o.farQuay ?? 3600;
    sky();
    far('skyline', { y: [9000, 14000], x: [-8000, 8000], z: -110, hmin: 500, hmax: 2200 });
    // the water (below the quay)
    const wz = -70;
    const water = surface(P, R, [[-6000, 12000, wz], [6000, 12000, wz], [6000, ye, wz], [-6000, ye, wz]], { kind: 'water', tone: o.water ?? { mix: ['teal-shade', 'blue', 0.45] } }, { n: [0, 0, 1], cells: 5, falloff: 0.04 });
    const sheen = [];
    const rs = rng(seed * 3 + 1);
    for (let i = 0; i < 46; i++) {
      const wy = ye + 150 + rs() * rs() * (yq - ye - 200);
      const wx = (rs() - 0.5) * 2600;
      const wl = 50 + rs() * 120;
      sheen.push(K.quad(P, [[wx, wy + 5, wz + 0.5], [wx + wl, wy + 5, wz + 0.5], [wx + wl, wy, wz + 0.5], [wx, wy, wz + 0.5]], M.dark ? mixHex(T['blue-lit'], T['yellow-lit'], 0.3) : T.canvas, { opacity: M.dark ? 0.3 : 0.5 }));
    }
    env.push({ svg: water + sheen.join('') + horizonHaze(P, M, 220), at: [0, 3000, wz], part: 'water', mat: 'water', tell: tell('the water'), sharp: true });
    // the far quay across the water: its platform, stacked containers, a crane
    const fq = [];
    fq.push(K.box(P, [-5000, yq, wz], [10000, 900, 90], tone({ mix: ['paper-dark', 'ink-lit', 0.3] }), R, { radius: 2 }).svg);
    fq.push(crane(P, R, M, [900, yq + 560, 20]));
    const stacks = [];
    const cols = ['red', 'teal', 'blue', 'yellow', 'green', 'lilac'];
    for (let k = 0; k < 6; k++) for (let lv = 0; lv < 1 + ((k * 7) % 3); lv++) stacks.push({ at: [-1300 + k * 262, yq + 150, 20 + lv * 262], c: cols[(k * 2 + lv) % cols.length] });
    stacks.sort((a, b) => P.dist(...b.at) - P.dist(...a.at));
    for (const c of stacks) fq.push(container(P, R, M, c.at, { tn: { mix: [c.c, 'paper-shade', 0.28] } }).svg);
    env.push({ svg: fq.join(''), at: [0, yq, 0], part: 'far-quay', tell: tell('stacked containers'), sharp: true });
    tell('a crane');
    env.push({ svg: boat(P, R, M, [-120, ye + 330, wz], { accent }), at: [-120, ye + 330, 0], part: 'boat', tell: tell('a moored boat'), sharp: true });
    const face = surface(P, R, [[-6000, ye, 0], [6000, ye, 0], [6000, ye, wz], [-6000, ye, wz]], { kind: 'concrete', tone: { mix: ['paper-dark', 'ink-lit', 0.25] } }, { n: [0, -1, 0], cells: 3 });
    env.push({ svg: face, at: [0, ye, -55], part: 'quay', sharp: true });
    ground(o.ground ?? 'planks', { x: [-6000, 6000], y: [-1500, ye], z: 0, haze: false });
    env.push({ svg: K.box(P, [-6000, ye - 22, 0], [12000, 22, 7], tone({ mix: ['yellow-dark', 'ink-lit', 0.4] }), R, { radius: 1 }).svg, at: [0, ye, 3], part: 'quay', tell: tell('the quay edge'), sharp: true });
    for (const bx of [-300, 230]) addItem(standing(P, R, M, 'mooring', [bx, ye - 45, 0]), 'fixture', tell('mooring bollards'));
    const cr = (at, size, i) => addItem(crate(P, R, M, at, size, i), 'fixture', tell('crates'));
    cr([200, -330, 0], [90, 80, 80], 0);
    cr([300, -300, 0], [70, 70, 70], 1);
    cr([220, -310, 80], [70, 60, 60], 2);
    addItem(lampAt([-260, ye - 130, 0], { dir: [0, 1], h: 420 }), 'fixture', 'a quay lamp');
    addItem(lifeRing(P, R, M, [-440, ye - 70, 0]), 'fixture', tell('a life ring'));
    tell('the far shore');
    spots.edge = [0, ye - 90, 0];
    spots.bollard = [-300, ye - 45, 0];
    spots.crates = [260, -380, 0];
    lanes.walk = [[-700, 60, 0], [700, 60, 0]];
  }
  // the lamps' pools, on the ground (after the ground, before the fixtures)
  if (lights.length) {
    const pools = lights.map((L) => pool(P, L, { r: 210, z: kind === 'dock' || kind === 'street' ? 0 : 0, level: L.level })).join('');
    const gi = env.findIndex((e) => e.part === 'facade' || e.part === 'markings' || e.part === 'quay' || e.part === 'path' || e.part === 'fence' || e.part === 'parapet');
    env.splice(gi < 0 ? env.length : gi, 0, { svg: pools, at: [0, 0, 0], part: 'light', sharp: true });
  }
  return { kind, env, items, lights, tells, spots, lanes, views: EXTERIOR_VIEWS[kind], horizon: horizonY(P), mood: M };
}

/** A wide establishing camera per exterior (lens() options): the place's tells in a vertical
 *  frame, a critter on its main spot reading at a medium size. A starting point, never a rule. */
export const EXTERIOR_VIEWS = {
  street: { wide: { pos: [-230, -700, 150], target: [-140, 1300, 175], fov: 50 } },
  shopfront: { wide: { pos: [-170, -1400, 145], target: [-180, 320, 330], fov: 46 } },
  park: { wide: { pos: [-80, -760, 150], target: [40, 1500, 120], fov: 50 } },
  road: { wide: { pos: [-150, -700, 150], target: [-80, 2600, 150], fov: 50 } },
  plaza: { wide: { pos: [-150, -1150, 170], target: [-20, 1300, 210], fov: 52 } },
  rooftop: { wide: { pos: [-180, -640, 165], target: [120, 1600, 110], fov: 54 } },
  dock: { wide: { pos: [-60, -900, 175], target: [0, 2200, 30], fov: 50 } },
};

/** An A-board (a sandwich sign) on the pavement: two leaning boards, a chalk face. */
function aBoard(P, R, M, at, { accent = 'teal' } = {}) {
  const [x, y, z = 0] = at;
  const wood = tone({ mix: ['yellow-dark', 'paper-shade', 0.35] });
  const s = [K.contactShadow(P, [[x - 32, y - 30], [x + 32, y - 30], [x + 32, y + 30], [x - 32, y + 30]], { level: 0.22 })];
  const lean = 22;
  s.push(K.obox(P, [x - 30, y + 2, z], [60, 0, 0], [0, lean, 0], [0, -lean * 0.05, 92], wood, R, { radius: 1 }).svg);
  s.push(K.obox(P, [x - 30, y - 4, z], [60, 0, 0], [0, -4, 0], [0, lean, 92], wood, R, { radius: 1 }).svg);
  const face = [[x - 24, y - 6 + lean * 0.9, z + 86], [x + 24, y - 6 + lean * 0.9, z + 86], [x + 24, y - 5.5 + lean * 0.12, z + 12], [x - 24, y - 5.5 + lean * 0.12, z + 12]];
  s.push(K.quad(P, face, { tones: tone({ mix: ['ink-lit', 'green-dark', 0.2] }), n: norm([0, -1, 0.24]), R }));
  const c = (u, v) => V3.lerp(V3.lerp(face[0], face[1], u), V3.lerp(face[3], face[2], u), v);
  for (const [v, w] of [[0.18, 0.7], [0.36, 0.5], [0.52, 0.62]]) s.push(K.quad(P, [c(0.15, v), c(0.15 + w, v), c(0.15 + w, v + 0.05), c(0.15, v + 0.05)], T['paper-lit'], { opacity: 0.8 }));
  s.push(K.quad(P, [c(0.15, 0.68), c(0.5, 0.68), c(0.5, 0.8), c(0.15, 0.8)], hexOf(accent)));
  return { svg: s.join(''), at: [x, y, z + 45], bounds: [[x - 32, y - 30, z], [x + 32, y + 30, z + 95]] };
}

/** A road sign on a post: a panel (blank, or `text`) in `accent`. */
function roadSign(P, R, M, at, { text, accent = 'green' } = {}) {
  const [x, y, z = 0] = at;
  const post = tone('paper-dark');
  const s = [K.contactShadow(P, { x, y, r: 10 }, { level: 0.2 })];
  s.push(K.cylinder(P, [x - 40, y, z], 5, 250, post, R, { seg: 10 }) + K.cylinder(P, [x + 40, y, z], 5, 250, post, R, { seg: 10 }));
  s.push(K.box(P, [x - 70, y - 4, z + 170], [140, 4, 90], tone(accent), R, { radius: 2 }).svg);
  const art = el('rect', { x: 4, y: 4, width: 132, height: 82, rx: 6, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 3 }) + (text ? el('text', { x: 70, y: 56, 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended', Roboto", 'font-weight': 700, 'font-size': n2(Math.min(34, (126 / Math.max(3, String(text).length)) * 1.5)), fill: T['paper-lit'] }, String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')) : el('path', { d: 'M 30 45 L 100 45 M 84 30 L 100 45 L 84 60', stroke: T['paper-lit'], 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  s.push(K.faceArt(P, [x - 70, y - 4.3, z + 260], [140, 0, 0], [0, 0, -90], art, { clip: false }));
  return { svg: s.join(''), at: [x, y, z + 130], bounds: [[x - 70, y - 6, z], [x + 70, y + 6, z + 260]] };
}

/** A round stone fountain: basin, water, a column, a bowl and its jets. */
function fountain(P, R, M, at, { seed = 1 } = {}) {
  const [x, y, z = 0] = at;
  const stone = tone({ mix: ['paper-shade', 'paper-dark', 0.3] });
  const water = tone({ mix: ['teal-lit', 'blue-lit', 0.35] });
  const s = [K.contactShadow(P, { x, y, r: 210 }, { level: 0.25 })];
  s.push(K.cylinder(P, [x, y, z], 200, 50, stone, R, { seg: 48 }));
  s.push(K.cylinder(P, [x, y, z + 50], 182, 0.5, water, R, { seg: 48 }));
  s.push(K.cylinder(P, [x, y, z + 40], 26, 120, stone, R, { seg: 20 }));
  s.push(K.cylinder(P, [x, y, z + 150], 70, 16, stone, R, { seg: 32 }));
  s.push(K.cylinder(P, [x, y, z + 166], 62, 0.5, water, R, { seg: 32 }));
  s.push(K.cylinder(P, [x, y, z + 166], 10, 40, stone, R, { seg: 12 }));
  const top = P(x, y, z + 230);
  const jets = [];
  const rr = rng(seed + 5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const end = P(x + Math.cos(a) * 66, y + Math.sin(a) * 66, z + 150);
    const ctrl = P(x + Math.cos(a) * 40, y + Math.sin(a) * 40, z + 255 + rr() * 10);
    jets.push(el('path', { d: `M ${n1(top[0])} ${n1(top[1])} Q ${n1(ctrl[0])} ${n1(ctrl[1])} ${n1(end[0])} ${n1(end[1])}`, stroke: T.canvas, 'stroke-width': n2(Math.max(1.5, 3 * P.scaleAt(x, y, z + 200))), fill: 'none', opacity: 0.75, 'stroke-linecap': 'round' }));
  }
  s.push(g({ 'data-k': 'water' }, jets));
  return { svg: s.join(''), at: [x, y, z + 80], bounds: [[x - 200, y - 200, z], [x + 200, y + 200, z + 240]] };
}

/** An air-conditioning unit on a roof: a box, a fan grille on top. */
function acUnit(P, R, M, at) {
  const [x, y, z = 0] = at;
  const t = tone({ mix: ['paper-lit', 'paper-shade', 0.4] });
  const s = [K.contactShadow(P, [[x - 60, y - 45], [x + 60, y - 45], [x + 60, y + 45], [x - 60, y + 45]], { level: 0.28 })];
  if (z === 0) s.push(K.shadowsOf(P, [[x - 60, y - 45], [x + 60, y - 45], [x + 60, y + 45], [x - 60, y + 45]], 90, R, { dirLevel: 0.16 }));
  s.push(K.box(P, [x - 60, y - 45, z], [120, 90, 90], t, R, { radius: 3 }).svg);
  s.push(K.cylinder(P, [x, y, z + 90], 34, 3, tone('ink-lit'), R, { seg: 28 }));
  for (let i = 0; i < 4; i++) s.push(K.box(P, [x - 56, y - 45.6, z + 14 + i * 16], [112, 1, 6], tone('paper-dark'), R, { radius: 0.5, edge: false }).svg);
  return { svg: s.join(''), at: [x, y, z + 45], bounds: [[x - 60, y - 45, z], [x + 60, y + 45, z + 93]] };
}
/** A water tank on legs. */
function waterTank(P, R, M, at) {
  const [x, y, z = 0] = at;
  const wood = tone({ mix: ['yellow-dark', 'paper-shade', 0.3] });
  const steel = tone({ mix: ['ink-lit', 'paper-dark', 0.3] });
  const s = [K.contactShadow(P, { x, y, r: 120 }, { level: 0.25 })];
  if (z === 0) s.push(K.shadowsOf(P, { x, y, r: 100 }, 500, R, { dirLevel: 0.14 }));
  for (const [dx, dy] of [[-70, -70], [70, -70], [-70, 70], [70, 70]]) s.push(K.box(P, [x + dx - 5, y + dy - 5, z], [10, 10, 220], steel, R, { radius: 1 }).svg);
  s.push(K.cylinder(P, [x, y, z + 220], 110, 220, wood, R, { seg: 32 }));
  for (const hh of [260, 340, 410]) s.push(K.cylinder(P, [x, y, z + hh], 111, 5, steel, R, { seg: 32, cap: false }));
  s.push(K.cylinder(P, [x, y, z + 440], 96, 22, wood, R, { seg: 32 }));
  s.push(K.cylinder(P, [x, y, z + 462], 50, 22, wood, R, { seg: 24 }));
  return { svg: s.join(''), at: [x, y, z + 240], bounds: [[x - 110, y - 110, z], [x + 110, y + 110, z + 490]] };
}
/** A roof access hut with a door in `accent`. */
function hut(P, R, M, at, { accent = 'teal' } = {}) {
  const [x, y, z = 0] = at;
  const t = tone({ mix: ['paper-shade', 'paper-lit', 0.4] });
  const s = [K.contactShadow(P, [[x - 110, y - 80], [x + 110, y - 80], [x + 110, y + 80], [x - 110, y + 80]], { level: 0.3 })];
  if (z === 0) s.push(K.shadowsOf(P, [[x - 110, y - 80], [x + 110, y - 80], [x + 110, y + 80], [x - 110, y + 80]], 250, R, { dirLevel: 0.16 }));
  s.push(K.box(P, [x - 110, y - 80, z], [220, 160, 250], t, R, { radius: 3 }).svg);
  s.push(K.box(P, [x - 118, y - 88, z + 250], [236, 176, 12], tone('paper-lit'), R, { radius: 2 }).svg);
  s.push(K.quad(P, [[x - 45, y - 80.8, z + 215], [x + 45, y - 80.8, z + 215], [x + 45, y - 80.8, z], [x - 45, y - 80.8, z]], { tones: tone(accent), n: [0, -1, 0], R }));
  s.push(K.box(P, [x + 26, y - 84, z + 100], [5, 4, 22], tone('ink-lit'), R, { radius: 1, edge: false }).svg);
  if (M.lamps) {
    const q = P(x, y - 84, z + 232);
    s.push(K.box(P, [x - 12, y - 88, z + 226], [24, 8, 10], tone('paper-lit'), R, { radius: 2 }).svg + glow(q[0], q[1], 40 * P.scaleAt(x, y, z + 232) + 10, { color: 'warm', level: 0.7 }));
  }
  return { svg: s.join(''), at: [x, y, z + 120], bounds: [[x - 118, y - 88, z], [x + 118, y + 88, z + 262]] };
}
/** A wooden crate. */
function crate(P, R, M, at, size, i = 0) {
  const [x, y, z = 0] = at;
  const [w, d, h] = size;
  const t = tone({ mix: ['yellow-dark', 'paper-shade', 0.3 + (i % 3) * 0.08] });
  const s = [];
  if (z === 0) s.push(K.contactShadow(P, [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], { level: 0.28 }));
  s.push(K.box(P, [x, y, z], [w, d, h], t, R, { radius: 1.5 }).svg);
  const dark = mixHex(hexOf(t), T['shadow-warm'], 0.35);
  for (const zz of [h * 0.33, h * 0.66]) s.push(K.quad(P, [[x, y - 0.4, z + zz + 1.5], [x + w, y - 0.4, z + zz + 1.5], [x + w, y - 0.4, z + zz - 1.5], [x, y - 0.4, z + zz - 1.5]], dark, { opacity: 0.6 }));
  s.push(K.quad(P, [[x + 4, y - 0.6, z + h - 4], [x + 10, y - 0.6, z + h - 4], [x + w - 4, y - 0.6, z + 4], [x + w - 10, y - 0.6, z + 4]], dark, { opacity: 0.45 }));
  return { svg: s.join(''), at: [x + w / 2, y + d / 2, z + h / 2], bounds: [[x, y, z], [x + w, y + d, z + h]] };
}
/** A shipping container, ribbed, `tn`. */
function container(P, R, M, at, { tn = 'red' } = {}) {
  const [x, y, z = 0] = at;
  const [w, d, h] = [244, 600, 259];
  const t = tone(tn);
  const s = [];
  if (z === 0) s.push(K.contactShadow(P, [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], { level: 0.3 }));
  s.push(K.box(P, [x, y, z], [w, d, h], t, R, { radius: 2 }).svg);
  const rib = mixHex(hexOf(t), T['shadow-warm'], 0.22);
  for (let k = 1; k < 20; k++) s.push(K.quad(P, [[x + w + 0.5, y + k * 30 - 3, z + h - 8], [x + w + 0.5, y + k * 30 + 3, z + h - 8], [x + w + 0.5, y + k * 30 + 3, z + 8], [x + w + 0.5, y + k * 30 - 3, z + 8]], rib, { opacity: 0.55 }));
  for (let k = 1; k < 8; k++) s.push(K.quad(P, [[x + k * 30 - 3, y - 0.5, z + h - 8], [x + k * 30 + 3, y - 0.5, z + h - 8], [x + k * 30 + 3, y - 0.5, z + 8], [x + k * 30 - 3, y - 0.5, z + 8]], rib, { opacity: 0.55 }));
  return { svg: s.join(''), at: [x + w / 2, y + d / 2, z + h / 2], bounds: [[x, y, z], [x + w, y + d, z + h]] };
}
/** A small moored boat: a hull with a tapered bow, a cabin, a mast. */
function boat(P, R, M, at, { accent = 'teal' } = {}) {
  const [x, y, z] = at;
  const hullT = tone({ mix: ['paper-lit', 'paper-shade', 0.3] });
  const band = tone(accent);
  const s = [];
  const Lb = 760;
  const Wb = 230;
  const pts = (zz, k = 1) => [[x - Lb / 2, y - Wb / 2 * k, zz], [x + Lb / 2 - 160, y - Wb / 2 * k, zz], [x + Lb / 2, y, zz], [x + Lb / 2 - 160, y + Wb / 2 * k, zz], [x - Lb / 2, y + Wb / 2 * k, zz]];
  const bot = pts(z - 6, 0.82);
  const top = pts(z + 120, 1);
  const faces = [];
  for (let i = 0; i < bot.length; i++) {
    const j = (i + 1) % bot.length;
    const q = [top[i], top[j], bot[j], bot[i]];
    const n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    const mid = mul(add(add(q[0], q[1]), add(q[2], q[3])), 0.25);
    if (!P.facing(mid, n)) continue;
    faces.push({ d: P.dist(...mid), svg: K.quad(P, q, { tones: hullT, n, R }) + K.quad(P, [V3.lerp(q[0], q[3], 0.1), V3.lerp(q[1], q[2], 0.1), V3.lerp(q[1], q[2], 0.26), V3.lerp(q[0], q[3], 0.26)], { tones: band, n, R }) });
  }
  faces.sort((a, b) => b.d - a.d);
  s.push(K.quad(P, top, { tones: tone({ mix: ['yellow-dark', 'paper-shade', 0.3] }), n: [0, 0, 1], R }));
  s.push(...faces.map((f) => f.svg));
  s.push(K.box(P, [x - 220, y - 80, z + 120], [240, 160, 120], tone('paper-lit'), R, { radius: 6 }).svg);
  for (let k = 0; k < 3; k++) s.push(K.quad(P, [[x - 200 + k * 76, y - 80.6, z + 215], [x - 150 + k * 76, y - 80.6, z + 215], [x - 150 + k * 76, y - 80.6, z + 175], [x - 200 + k * 76, y - 80.6, z + 175]], M.dark && M.lamps ? mixHex(T['yellow-lit'], T.canvas, 0.2) : mixHex(T['ink-lit'], M.sky[1], 0.4)));
  s.push(K.box(P, [x - 230, y - 90, z + 240], [260, 180, 12], band, R, { radius: 3 }).svg);
  s.push(K.cylinder(P, [x + 120, y, z + 120], 5, 420, tone('paper-dark'), R, { seg: 10 }));
  return s.join('');
}
/** A dockside crane, far: two lattice legs, a truss jib and its counterweight, hazed. */
function crane(P, R, M, at) {
  const [x, y, z] = at;
  const t = tone({ mix: ['yellow-shade', 'paper-shade', 0.15] });
  const d = y - P.pos[1];
  const col = hazed(K.shade(t, [0, -1, 0], [x, y, z + 800], R), d, M);
  const s = [];
  const H = 1500;
  const seg = (a, b, w = 1.6) => {
    const A = P(...a);
    const B = P(...b);
    return A[2] > 10 && B[2] > 10 ? el('line', { x1: n1(A[0]), y1: n1(A[1]), x2: n1(B[0]), y2: n1(B[1]), stroke: col, 'stroke-width': n2(w), 'stroke-linecap': 'round' }) : '';
  };
  // two legs with their bracing
  for (const lx of [x - 120, x + 120]) {
    s.push(K.quad(P, [[lx - 16, y, z + H], [lx + 16, y, z + H], [lx + 16, y, z], [lx - 16, y, z]], col));
  }
  for (let k = 0; k < 5; k++) {
    const z0 = z + (k * H) / 5;
    const z1 = z + ((k + 1) * H) / 5;
    s.push(seg([x - 120, y, z0], [x + 120, y, z1]), seg([x + 120, y, z0], [x - 120, y, z1]), seg([x - 120, y, z1], [x + 120, y, z1], 2.4));
  }
  // the machine house, the jib out over the water and the counterweight behind
  s.push(K.quad(P, [[x - 170, y, z + H + 190], [x + 170, y, z + H + 190], [x + 170, y, z + H], [x - 170, y, z + H]], col));
  const j0 = [x + 150, y, z + H + 120];
  const j1 = [x - 1500, y, z + H + 120];
  const j2 = [x - 1500, y, z + H + 50];
  s.push(seg(j0, j1, 3), seg([x + 150, y, z + H + 50], j2, 3));
  for (let k = 0; k < 9; k++) s.push(seg([x + 150 - k * 183, y, z + H + 120], [x + 150 - (k + 1) * 183, y, z + H + 50], 1.4));
  s.push(K.quad(P, [[x + 160, y, z + H + 210], [x + 420, y, z + H + 210], [x + 420, y, z + H + 60], [x + 160, y, z + H + 60]], col));
  const top = [x, y, z + H + 420];
  s.push(seg([x, y, z + H + 190], top, 4), seg(top, j1, 1.2), seg(top, [x + 400, y, z + H + 210], 1.2));
  s.push(seg([x - 1100, y, z + H + 50], [x - 1100, y, z + H - 600], 1.1));
  s.push(K.quad(P, [[x - 1125, y, z + H - 600], [x - 1075, y, z + H - 600], [x - 1075, y, z + H - 650], [x - 1125, y, z + H - 650]], col));
  return s.join('');
}

/** A life ring on a post at the quay's edge. */
function lifeRing(P, R, M, at) {
  const [x, y, z = 0] = at;
  const post = tone({ mix: ['paper-dark', 'ink-lit', 0.2] });
  const s = [K.contactShadow(P, { x, y, r: 12 }, { level: 0.2 }), K.box(P, [x - 6, y - 6, z], [12, 12, 150], post, R, { radius: 1.5 }).svg];
  const art = el('circle', { cx: 40, cy: 40, r: 33, fill: 'none', stroke: T['red-lit'], 'stroke-width': 13 }) + [0, 1, 2, 3].map((k) => { const a = (k / 4) * Math.PI * 2 + 0.4; return el('path', { d: `M ${n2(40 + Math.cos(a) * 26)} ${n2(40 + Math.sin(a) * 26)} L ${n2(40 + Math.cos(a) * 40)} ${n2(40 + Math.sin(a) * 40)}`, stroke: T['paper-lit'], 'stroke-width': 12 }); }).join('') + el('circle', { cx: 40, cy: 40, r: 33, fill: 'none', stroke: T['shadow-warm'], 'stroke-width': 1.5, opacity: 0.3 });
  s.push(K.faceArt(P, [x - 40, y - 7, z + 145], [80, 0, 0], [0, 0, -80], art, { clip: false }));
  return { svg: s.join(''), at: [x, y, z + 80], bounds: [[x - 40, y - 8, z], [x + 40, y + 8, z + 150]] };
}

// ── Checks ────────────────────────────────────────────────────────────────────────────────

export const BRIEF_KEYS = ['place', 'tells', 'architecture', 'materials', 'colorStory', 'layers', 'beyond', 'density', 'exterior'];

/**
 * The problems with a set brief (world.js SET or a SETS place), 4.2: names only, the things that
 * would break the build. The brief is the scene builder's plan, written in its own words; how many
 * tells, walls, layers or colors it has is craft (craft.md § 8), never checked. Errors: SET is not
 * an object; a material that is not a kit material; a color that is not a palette name; an opening
 * kind or an exterior kind the kit does not draw; an unknown density.
 */
export function setBriefProblems(SET) {
  if (!SET || typeof SET !== 'object' || Array.isArray(SET)) return ['SET must be an object (the set brief: { place, tells, architecture | exterior, materials, colorStory, … })'];
  const out = [];
  const A = SET.architecture;
  if (A && typeof A === 'object') {
    for (const [i, op] of (Array.isArray(A.openings) ? A.openings : []).entries()) {
      if (op?.kind !== undefined && !OPENING_KINDS.includes(op.kind)) out.push(`SET.architecture.openings[${i}].kind "${op.kind}" is not an opening the kit draws (${OPENING_KINDS.join(', ')})`);
    }
  }
  const ext = SET.exterior ?? (typeof A === 'string' ? A : A?.exterior);
  if (ext !== undefined) {
    const kind = typeof ext === 'string' ? ext : ext?.kind;
    if (!EXTERIOR_KINDS.includes(kind)) out.push(`SET.exterior "${kind}" is not an exterior the kit draws (${EXTERIOR_KINDS.join(', ')})`);
  }
  const M = SET.materials;
  if (M && typeof M === 'object') {
    for (const [key, v] of Object.entries(M)) {
      const kind = typeof v === 'string' ? v : v?.kind;
      if (kind && !MATERIALS[kind]) out.push(`SET.materials.${key} "${kind}" is not a kit material (${Object.keys(MATERIALS).join(', ')})`);
      if (v && typeof v === 'object' && v.tone) { const p = toneProblem(v.tone, `SET.materials.${key}.tone`); if (p) out.push(p); }
    }
  }
  if (Array.isArray(SET.colorStory)) for (const [i, c] of SET.colorStory.entries()) { const p = toneProblem(c, `SET.colorStory[${i}]`); if (p) out.push(p); }
  if (SET.density !== undefined && !(SET.density in DENSITY)) out.push(`SET.density "${SET.density}" must be one of ${Object.keys(DENSITY).join(', ')}`);
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
    if (a.part === 'floor' || a.part === 'ground' || a.part === 'water') meta.floor = true;
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

/**
 * The set check (try.mjs), 4.2: breakage only. `input` is setBuilder().done().meta or a drawn SVG.
 * Errors: nothing to stand on (no floor or ground: the cast and props would float in a void); an
 * opening (other than a door) that shows nothing beyond it (a hole into the void); a surface in a
 * material the kit does not have. How many walls, layers, tells or dressing things a set has, its
 * ceiling share and its colors are craft (craft.md § 8; fitCeiling stays as a framing helper).
 * `SET` and `{ cast }` are accepted for older callers and not needed.
 */
export function setProblems(input, _SET = null, _o = {}) {
  const meta = typeof input === 'string' ? setMetaFromSvg(input) : input?.meta ?? input;
  if (!meta || typeof meta !== 'object') return ['setProblems needs setBuilder().done() (or its meta) or a drawn SVG'];
  const out = [];
  if (!meta.floor) out.push('the set has nothing to stand on: build a room() floor or an exterior() ground, so nothing floats in a void');
  for (const op of meta.openings ?? []) if (!op.beyond && op.kind !== 'door') out.push(`a ${op.kind}${op.wall ? ` in the ${op.wall} wall` : ''} shows nothing beyond: give it a beyond (a street, a skyline, another room)`);
  for (const sf of meta.surfaces ?? []) if (sf.mat && sf.mat !== 'none' && !MATERIALS[sf.mat]) out.push(`a ${sf.part} is in "${sf.mat}", which is not a kit material (${Object.keys(MATERIALS).join(', ')})`);
  return out;
}

/**
 * Faces cut by the set (principles §2, "faces are always whole"): in a drawn lens frame (or
 * samples [{ t, svg }]), each critter facing the lens (view front) whose eyes or mouth
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
