// The Explainers world kit, drawn subjects (hx-5, visual system 5): anything grown, sewn, moulded or
// cooked is DRAWN, not built from solids (house-style § Built or drawn owns the rule). A drawn
// subject is path art cut into parts at its joints, so it can be posed and animated (cut-out
// animation). It is flat by default: one tone per part, a darker shade region on the side away
// from the light, marks (patches, a muzzle, a label), no outline, no stipple, no wobble. It stands
// in the world as a billboard at a world point, sized on the critter ruler like everything else.
//
//   drawnSvg(spec, o)              the drawing in its own units, base at (0, 0)
//   drawn(spec, x, y, o)           on screen, base at (x, y); s = the critter scale beside it
//   drawnAt(P, spec, wx, wy, wz, o) a lens render() item standing at a world point
//   SUBJECTS                       the library (subjects/): name → spec
//
// A spec: { kind, cm (real height in the master pose), units (drawing height; base at y 0, up is −y),
//   tones: { alias: token }, views: { <view>: { foot?: [x0, x1], parts: { name: Part },
//   poses: { rest: {}, name: Pose | (t) => Pose }, states?: { name: { part: overrides } } } } }
// A part: { d, ink?, fill, z, pivot: [x, y], parent?, far?, marks?: [{ d, fill, over?, opacity? }],
//   shade?, lines?, copy?: 'otherPart', shift?: [dx, dy], hide?, weight? }
// A pose: { partName: degrees | { r, dx, dy, sx, sy }, _root: { r, dx, dy }, _foot: false }.
// A child turns with its parent; `copy` makes a far limb from a near one, shifted and one step
// darker. `flat: false` draws the outlined study style (an ink outline and interior lines).

import * as core from './core.js';
import { tok } from './analogy.js';
import { id as scopedId } from './draw.js';
import { SUBJECTS } from './subjects/index.js';

export { SUBJECTS };

let SEQ = 0;
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (a, b, v) => Math.max(a, Math.min(b, v));
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
const el = (tag, o = {}, inner = '') => `<${tag} ${attrs(o)}>${inner}</${tag}>`;
const g = (o, inner) => el('g', o, Array.isArray(inner) ? inner.join('') : inner);
const { mixHex, PX_PER_CM, CHEAT } = core;
const SHADOW_OPACITY = core.SHADOW_OPACITY ?? 0.1;
const INK = () => tok('ink');

/** A token name ('mustard', 'leaf-shade', 'paper-lit', 'ink'), a spec alias (spec.tones) or a hex. */
function paint(spec, name) {
  if (!name) return 'none';
  const n = spec.tones?.[name] ?? name;
  if (n.startsWith('#') || n === 'none') return n;
  if (tok(n)) return tok(n);
  throw new Error(`HX: drawn ${spec.kind}: unknown tone "${name}" (a palette token, or one of its tones: ${Object.keys(spec.tones ?? {}).join(', ')})`);
}

/** One pose entry → a transform about the part's pivot. A number is degrees; an object takes
 *  { r, dx, dy, sx, sy } (rotation, nudge, squash). */
function poseTf(entry, [px, py]) {
  if (entry == null) return '';
  const o = typeof entry === 'number' ? { r: entry } : entry;
  let s = '';
  if (o.dx || o.dy) s += ` translate(${r1(o.dx || 0)} ${r1(o.dy || 0)})`;
  if (o.r) s += ` rotate(${r1(o.r)} ${r1(px)} ${r1(py)})`;
  if ((o.sx ?? 1) !== 1 || (o.sy ?? 1) !== 1) s += ` translate(${r1(px)} ${r1(py)}) scale(${o.sx ?? 1} ${o.sy ?? 1}) translate(${r1(-px)} ${r1(-py)})`;
  return s;
}

/** A view's parts with a state's overrides and `copy` parts resolved. */
function partsOf(spec, view, state) {
  const V = spec.views[view];
  if (!V) throw new Error(`HX: drawn ${spec.kind} has no view "${view}" (${Object.keys(spec.views).join(', ')})`);
  const over = (state && (V.states?.[state] ?? spec.states?.[state])) || {};
  if (state && !V.states?.[state] && !spec.states?.[state]) throw new Error(`HX: drawn ${spec.kind} has no state "${state}"`);
  const out = {};
  for (const [name, p0] of Object.entries(V.parts)) {
    let p = { ...p0 };
    if (p.copy) {
      const src = V.parts[p.copy];
      if (!src) throw new Error(`HX: drawn ${spec.kind}.${name} copies unknown part ${p.copy}`);
      const [dx, dy] = p.shift || [0, 0];
      p = { ...src, ...p, d: src.d, lines: src.lines, marks: src.marks, shade: src.shade, offset: [dx, dy], pivot: [src.pivot[0] + dx, src.pivot[1] + dy], parent: p.parent ?? src.parent };
    }
    if (over[name]) p = { ...p, ...over[name] };
    if (p.hide) continue;
    out[name] = p;
  }
  return out;
}

/** The view names of a spec, its poses in a view, and its states. */
export function drawnInfo(spec) {
  return Object.fromEntries(Object.entries(spec.views).map(([v, V]) => [v, { poses: Object.keys(V.poses ?? { rest: {} }), states: Object.keys(V.states ?? spec.states ?? {}) }]));
}

/**
 * The drawing in its own units, base at (0, 0). `px` is its height on screen (it keeps the study
 * style's ink at one weight). Flat by default: no outline, no interior lines, a darker shade region;
 * a far part one step darker. Its ground shadow is one soft ink ellipse under the footprint.
 */
export function drawnSvg(spec, { view = Object.keys(spec.views)[0], pose = 'rest', state = null, flip = false, t = 0, px = 200, flat = true, shadow = true } = {}) {
  const V = spec.views[view];
  const parts = partsOf(spec, view, state);
  const P0 = typeof pose === 'string' ? (V.poses?.[pose] ?? (pose === 'rest' ? {} : null)) : pose;
  if (!P0) throw new Error(`HX: drawn ${spec.kind}.${view} has no pose "${pose}" (${Object.keys(V.poses || {}).join(', ')})`);
  const P = typeof P0 === 'function' ? P0(t) : P0;
  const k = px / spec.units;
  const sw = clamp(1.8, 3.6, 1.3 + px / 85) / k;
  const swl = sw * 0.6;
  const tf = {};
  const chain = (name, guard = 0) => {
    if (tf[name] != null) return tf[name];
    if (guard > 20) throw new Error(`HX: drawn ${spec.kind} has a parent loop at ${name}`);
    const p = parts[name];
    const up = p.parent ? (parts[p.parent] ? chain(p.parent, guard + 1) : '') : '';
    return (tf[name] = (up + poseTf(P[name], p.pivot)).trim());
  };
  const order = Object.keys(parts).sort((a, b) => (parts[a].z ?? 0) - (parts[b].z ?? 0));
  const body = order.map((name) => {
    const p = parts[name];
    const base = paint(spec, p.fill);
    const fill = p.far && base.startsWith('#') ? mixHex(base, INK(), 0.22) : base;
    const cid = `${scopedId('dw')}${SEQ++}`;
    const off = p.offset ? `translate(${p.offset[0]} ${p.offset[1]})` : '';
    const inner = [];
    if (p.d) {
      const clipped = [];
      for (const m of p.marks || []) if (!m.over) clipped.push(el('path', { d: m.d, fill: paint(spec, m.fill), opacity: m.opacity }));
      if (p.shade && fill.startsWith('#')) clipped.push(el('path', { d: p.shade, fill: mixHex(fill, INK(), flat ? 0.16 : 0.3) }));
      if (clipped.length) inner.push(el('defs', {}, el('clipPath', { id: cid }, el('path', { d: p.d }))));
      if (fill !== 'none') inner.push(el('path', { d: p.d, fill }));
      if (clipped.length) inner.push(g({ 'clip-path': `url(#${cid})` }, clipped));
      for (const m of p.marks || []) if (m.over) inner.push(el('path', { d: m.d, fill: paint(spec, m.fill), stroke: m.line === false || flat ? undefined : INK(), 'stroke-width': m.line === false || flat ? undefined : r1(swl), 'stroke-linejoin': 'round' }));
      // the study style: an outline (lost edges: `ink`, an open path, replaces the closed one)
      if (!flat && p.outline !== false) inner.push(el('path', { d: p.ink ?? p.d, fill: 'none', stroke: INK(), 'stroke-width': r1(p.weight ? sw * p.weight : sw), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    for (const L of flat ? (p.lines || []).filter((x) => typeof x === 'object' && x.flat) : p.lines || []) {
      const d = typeof L === 'string' ? L : L.d;
      const w = typeof L === 'string' ? swl : swl * (L.w ?? 1);
      inner.push(el('path', { d, fill: 'none', stroke: L.color ? paint(spec, L.color) : INK(), 'stroke-width': r1(w), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': L.dash }));
    }
    return g({ transform: `${chain(name)} ${off}`.trim() || undefined, 'data-part': name }, inner);
  });
  const root = poseTf(P._root, [0, 0]);
  const foot = !shadow || P._foot === false || !V.foot ? '' : el('ellipse', { cx: r1((V.foot[0] + V.foot[1]) / 2), cy: 0, rx: r1((V.foot[1] - V.foot[0]) / 2 + 8 / k), ry: r1(Math.max(5 / k, (V.foot[1] - V.foot[0]) * 0.07)), fill: INK(), 'fill-opacity': SHADOW_OPACITY ?? 0.1 });
  return g({ transform: flip ? 'scale(-1 1)' : undefined }, [foot, g({ transform: root || undefined }, body)]);
}

/** A subject by name from the library, or a spec as given. Unknown names throw with the list. */
export function subject(spec) {
  if (typeof spec !== 'string') return spec;
  const s = SUBJECTS[spec];
  if (!s) throw new Error(`HX: no drawn subject "${spec}" (the library: ${Object.keys(SUBJECTS).join(', ')}); draw it as a spec`);
  return s;
}

/** The height a subject is drawn at in cm: its true height, a small one cheated up to read
 *  (core CHEAT) unless `cheat` is false. */
export function drawnCm(spec, cheat = true) {
  const S = subject(spec);
  return cheat && S.cm < CHEAT.readCm ? Math.min(CHEAT.readCm, S.cm * CHEAT.max) : S.cm;
}

/** On screen, base at (x, y). `s` is the critter scale beside it (s 1 = a CRITTER_PX critter);
 *  `spec` is a spec or a library name. */
export function drawn(spec, x, y, { s = 1, cheat = true, ...o } = {}) {
  const S = subject(spec);
  const cm = drawnCm(S, cheat);
  const px = cm * PX_PER_CM * s;
  const k = px / S.units;
  return g({ transform: `translate(${r1(x)} ${r1(y)}) scale(${k.toFixed(4)})`, 'data-drawn': S.kind, 'data-drawn-cm': r1(cm) }, drawnSvg(S, { ...o, px }));
}

/** A lens render() item: the drawing stands at world point (wx, wy, wz), sized by the lens at
 *  that depth (P.scaleAt is px per cm there); `scale` an extra cheat. */
export function drawnAt(P, spec, wx, wy, wz = 0, { id = null, scale = 1, ...o } = {}) {
  const S = subject(spec);
  const [sx, sy] = P(wx, wy, wz);
  const s = (scale * P.scaleAt(wx, wy, wz)) / PX_PER_CM;
  return { id: id ?? S.kind, at: [wx, wy, wz + S.cm / 2], svg: drawn(S, sx, sy, { s, ...o }) };
}
