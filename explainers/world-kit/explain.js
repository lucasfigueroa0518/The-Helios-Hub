// The Explainers world kit, visual explanation (Explainers 4.1; 4.2 craft.md § 10): diagram
// primitives for mechanism frames, drawn in glass and gloss (glass.js), beside the real things
// (objects.js): paths, tokens that move, split, combine and change state, counts, comparisons. The
// TECHNIQUES list (process, before/after, comparison, transformation, scale, structure, timeline,
// cause and effect, product at work, match cut) is a menu of forms, not a header a frame must write.
// Cards are one option, never the default.
//
//   identity(map)                         the reel's concept identity map: one look per concept, as a
//                                          diagram marker (icon, colour, shape: reg.node …), as the
//                                          real thing (an OBJECTS id and tone: reg.object,
//                                          reg.worldObject), or both, in one colour
//   identityProblems(usage)               one concept drawn two ways (icons, colours, shapes, objects
//                                          or tones), or one look standing for two concepts
//   emptyShellProblems(svg)               a container drawn with nothing in it
//   fitToSafe(box) / safeProblems(boxes)  keep what is read inside the safe area (x 96–940, y 570–1600)
//
//   process     connector, travel, queue, fan, merge, copyOut
//   compare     versus, meter, counter, stopwatch
//   transform   tokenize, vectorize, morph
//   scale       unitGrid, sizeBars
//   structure   layers, graph, pointMap
//   timeline    timeline
//   cause       ripple, alarm
//   product     appWindow, docPage, fileList, resultsList, terminal, thread
//   match cut   matchCut
//
// Every primitive is a pure function of its arguments and a progress (0..1) or time, returns
// { svg, box } (which also stringifies to the svg), and keeps read text ≥ READ_MIN (34px). A
// container never draws before its content: give it its content, or it draws nothing.

import { T, el, g, id, isDark } from './draw.js';
import { FRAME, mixHex as CORE_MIX } from './core.js';
// a namespace import: a concept's real thing comes from objects.js when a map asks for one, and a
// map of diagram markers keeps working even beside a stand-in objects.js
import * as OBJ from './objects.js';
const toneFamily = (t) => (typeof OBJ.toneFamily === 'function' ? OBJ.toneFamily(t) : t == null ? 'own' : String(t));
const objectsKit = () => {
  if (!OBJ.OBJECTS || typeof OBJ.object !== 'function') throw new Error('HX: the identity map draws real things with objects.js, which is missing or incomplete in this kit.');
  return OBJ;
};
import {
  easeUI, ramp, glassPanel, glossPanel, glossTile, glowAt, boxShadow, roundRect, label, measure,
  wrapFit, fitSize, route, routeAt, uiIcon, chatBubble, GLASS_COLORS, MIN_DECOR,
} from './glass.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────────────
const f = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, u) => a + (b - a) * u;
/** Progress through [a, b] of u, eased (brand ease-out). */
export const span = (u, a, b) => easeUI(clamp01((u - a) / (b - a || 1)));
const boxed = (svg, box, extra = {}) => ({ svg, box, ...extra, toString: () => svg });
const svgOf = (v) => (v == null || v === false ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(svgOf).join('') : v.svg ?? String(v));
const ink = () => (isDark() ? T['paper-lit'] : T.ink);
const soft = () => (isDark() ? T['paper-shade'] ?? T['paper-lit'] : T['text-secondary']);
const hair = () => (isDark() ? T['paper-lit'] : T.ink);
/** Two hex inks mixed (t = share of b). */
const mixInk = (a, b, t) => (/^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b) ? CORE_MIX(a, b, t) : t < 0.5 ? a : b);
const WHITE = T.canvas ?? '#FFFFFF';

/** Pop in about (cx, cy): scale 0.9 → 1, rise 14px, fade. */
function pop(svg, cx, cy, appear) {
  if (appear >= 1) return svg;
  if (appear <= 0) return '';
  const e = easeUI(appear);
  const k = 0.9 + 0.1 * e;
  return g({ transform: `translate(${f(cx)} ${f(cy + (1 - e) * 14)}) scale(${f(k * 1000) / 1000}) translate(${f(-cx)} ${f(-cy)})`, opacity: f(clamp01(e * 1.4)) }, svg);
}
const scaleAbout = (svg, cx, cy, k) => (Math.abs(k - 1) < 1e-3 ? svg : g({ transform: `translate(${f(cx)} ${f(cy)}) scale(${f(k * 1000) / 1000}) translate(${f(-cx)} ${f(-cy)})` }, svg));

// ── Text floor and the safe area ──────────────────────────────────────────────────────────
/** The smallest text a viewer reads in a tech beat (labels, readouts, tracker stops). */
export const READ_MIN = 34;
/** The phone-safe area: everything read stays inside it for the whole beat. */
export const SAFE = { ...FRAME.safe };

/** A measured text line wrapped as a textbox (its shape is the text's own box). */
function text(str, x, y, size, { face = 'roboto-500', color = ink(), anchor = 'start', decor = false, opacity = 1 } = {}) {
  size = decor ? Math.max(MIN_DECOR, size) : Math.max(READ_MIN, size);
  const w = measure(str, size, face);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return g({ 'data-k': 'textbox', 'data-ui': 'label' }, [
    el('rect', { 'data-k': 'shape', x: f(x0 - 2), y: f(y - size * 0.9), width: f(w + 4), height: f(size * 1.15), fill: 'none' }),
    label(str, x, y, size, { face, color, anchor, decor, opacity }),
  ]);
}

/**
 * How to move (and, if allowed, shrink) `box` ({ x, y, w, h }) so it sits inside the safe area
 * with `pad`. Returns { dx, dy, scale, transform, fits } — apply `transform` to the group.
 */
export function fitToSafe(box, { pad = 0, safe = SAFE, allowScale = true } = {}) {
  const W0 = safe.x1 - safe.x0 - pad * 2;
  const H0 = safe.y1 - safe.y0 - pad * 2;
  const scale = allowScale ? Math.min(1, W0 / box.w, H0 / box.h) : 1;
  const w = box.w * scale;
  const h = box.h * scale;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let nx = cx - w / 2;
  let ny = cy - h / 2;
  nx = clamp(nx, safe.x0 + pad, Math.max(safe.x0 + pad, safe.x1 - pad - w));
  ny = clamp(ny, safe.y0 + pad, Math.max(safe.y0 + pad, safe.y1 - pad - h));
  const dx = nx - box.x * scale;
  const dy = ny - box.y * scale;
  const fits = w <= W0 + 0.5 && h <= H0 + 0.5;
  return { dx, dy, scale, fits, transform: `translate(${f(dx)} ${f(dy)}) scale(${f(scale * 1000) / 1000})` };
}

/** Wrap a { svg, box } so it lands inside the safe area (moved, shrunk only if it must be). */
export function placeInSafe(part, o = {}) {
  const fit = fitToSafe(part.box, o);
  const box = { x: part.box.x * fit.scale + fit.dx, y: part.box.y * fit.scale + fit.dy, w: part.box.w * fit.scale, h: part.box.h * fit.scale };
  return boxed(g({ transform: fit.transform }, svgOf(part)), box);
}

/** The boxes ({ name?, x, y, w, h }) that leave the safe area, as readable problems. */
export function safeProblems(boxes, safe = SAFE) {
  const out = [];
  for (const b of boxes) {
    const bx = b.box ?? b;
    const name = b.name ?? 'a part';
    if (bx.x < safe.x0 - 0.5 || bx.x + bx.w > safe.x1 + 0.5 || bx.y < safe.y0 - 0.5 || bx.y + bx.h > safe.y1 + 0.5) {
      out.push(`${name} at x ${Math.round(bx.x)}–${Math.round(bx.x + bx.w)}, y ${Math.round(bx.y)}–${Math.round(bx.y + bx.h)} leaves the safe area (x ${safe.x0}–${safe.x1}, y ${safe.y0}–${safe.y1})`);
    }
  }
  return out;
}

// ── Concept identity ──────────────────────────────────────────────────────────────────────
/** The shapes a concept can take: a glossy tile, a disc, a document, a chip (capsule), a pill. */
export const SHAPES = ['tile', 'disc', 'doc', 'chip'];

/** The colours a concept may wear: the glass colours but orange. Orange marks what to look at now
 *  and moves with the focus, so it is never a concept's identity (house style). */
export const CONCEPT_COLORS = GLASS_COLORS.filter((c) => c !== 'orange');
const DEFAULT_COLORS = ['teal', 'blue', 'lilac', 'green', 'yellow', 'ink'];
const ENTRY_KEYS = ['icon', 'color', 'shape', 'label', 'object', 'tone'];
const orangeName = (v) => (typeof v === 'string' && /^(orange|stage-orange|stage-red|sun-)/.test(v)) || (v && typeof v === 'object' && Array.isArray(v.mix) && v.mix.some(orangeName));

/**
 * The reel's identity map: one look per concept, learned once and kept in every frame and world
 * (minimum 6). `map` is { conceptId: entry }; an entry gives the concept's diagram marker, its real
 * thing, or both:
 *   icon, color, shape   the marker (reg.node, reg.chip, reg.icon): a UI_ICONS icon, a colour of
 *                        CONCEPT_COLORS (never orange; default: the first of teal, blue, lilac,
 *                        green, yellow, ink no other concept has), a shape of SHAPES (default tile)
 *   object, tone         the real thing (reg.object on the isometric table, reg.worldObject through
 *                        the camera): an OBJECTS id and its body tone (default: `color` when given,
 *                        else the object's own); never orange
 *   label                its name (default the id)
 * A concept with both forms wears one colour in both (a tone of another colour throws).
 * Emphasis is light (glow, ring, scale), dimming a paper wash, focus the accent; a concept is never
 * recoloured. Returns a registry: { ids, defs, get(id), color(id), node(id, x, y, o),
 * chip(id, x, y, o), icon(id, x, y, size, o), object(id, at, o), worldObject(id, at, o), usage }.
 */
export function identity(map) {
  if (!map || typeof map !== 'object') throw new Error('HX: identity(map) needs { conceptId: { icon, color, shape, label } or { object, tone, label } }.');
  const defs = {};
  // a default colour is the next one no concept has taken (named colours first)
  const taken = new Set(Object.values(map).map((e) => (e && typeof e === 'object' ? e.color : null)).filter(Boolean));
  const nextColor = () => {
    const free = DEFAULT_COLORS.find((c) => !taken.has(c)) ?? DEFAULT_COLORS[taken.size % DEFAULT_COLORS.length];
    taken.add(free);
    return free;
  };
  Object.entries(map).forEach(([cid, spec]) => {
    const s = typeof spec === 'string' ? { label: spec } : spec ?? {};
    const bad = Object.keys(s).filter((k) => !ENTRY_KEYS.includes(k));
    if (bad.length) throw new Error(`HX: concept "${cid}": unknown field "${bad.join('", "')}" (${ENTRY_KEYS.join(', ')}).`);
    if (!s.icon && !s.object) throw new Error(`HX: concept "${cid}" needs an icon (a diagram marker, one icon for the whole reel) or an object (the real thing, one of OBJECTS), or both.`);
    if (orangeName(s.color) || orangeName(s.tone)) throw new Error(`HX: concept "${cid}" is orange: orange marks what to look at now and moves with the focus, so it is never a concept's identity. Colours: ${CONCEPT_COLORS.join(', ')}.`);
    let icon = null;
    let shape = null;
    let color = s.color ?? null;
    if (color != null && !CONCEPT_COLORS.includes(color)) throw new Error(`HX: concept "${cid}" colour "${color}" must be one of ${CONCEPT_COLORS.join(', ')}.`);
    if (s.icon) {
      color = color ?? nextColor();
      shape = s.shape ?? 'tile';
      if (!SHAPES.includes(shape)) throw new Error(`HX: concept "${cid}" shape "${shape}" must be one of ${SHAPES.join(', ')}.`);
      uiIcon(s.icon, 0, 0, 24); // throws on an unknown icon
      icon = s.icon;
    } else if (s.shape) throw new Error(`HX: concept "${cid}": a shape is for a diagram marker (give it an icon too).`);
    let object = null;
    let tone = null;
    if (s.object) {
      const K = objectsKit();
      if (!K.OBJECTS[s.object]) throw new Error(`HX: concept "${cid}" object "${s.object}" is not one of OBJECTS (${Object.keys(K.OBJECTS).join(', ')}).`);
      tone = s.tone ?? color ?? null;
      if (color && toneFamily(tone) !== color) throw new Error(`HX: concept "${cid}" is ${color} as a marker but tone "${toneFamily(tone)}" as an object: one colour per concept.`);
      K.object(s.object, [0, 0], { tone: tone ?? undefined }); // throws on a tone the kit refuses
      object = s.object;
    } else if (s.tone != null) throw new Error(`HX: concept "${cid}": a tone is for a real thing (give it an object too).`);
    // the colour lines and chips take: the marker's, or the object's tone family when it is one
    const lineColor = color ?? (CONCEPT_COLORS.includes(toneFamily(tone)) ? toneFamily(tone) : 'ink');
    defs[cid] = Object.freeze({ id: cid, icon, color: lineColor, shape, label: s.label ?? cid, object, tone, toneName: object ? toneFamily(tone) : null });
  });
  const get = (cid) => {
    if (typeof cid === 'object' && cid) return cid;
    const d = defs[cid];
    if (!d) throw new Error(`HX: no concept "${cid}" in the identity map (${Object.keys(defs).join(', ')}).`);
    return d;
  };
  const marker = (cid) => {
    const d = get(cid);
    if (!d.icon) throw new Error(`HX: concept "${d.id}" is a real thing (object "${d.object}"): draw it with reg.object(…) or reg.worldObject(…), or give it an icon for diagram markers.`);
    return d;
  };
  const thing = (cid, o) => {
    const d = get(cid);
    if (!d.object) throw new Error(`HX: concept "${d.id}" has no object: give its identity entry { object, tone } to draw it as the real thing.`);
    if (o && (o.tone != null || o.concept != null)) throw new Error(`HX: concept "${d.id}": its tone comes from the identity map (one look per concept).`);
    return d;
  };
  const objOpts = (d, o = {}) => ({ ...o, tone: d.tone ?? undefined, label: o.label === true ? d.label : o.label ?? undefined, concept: d.id });
  const usage = [];
  const reg = {
    ids: Object.keys(defs),
    defs,
    get,
    color: (cid) => get(cid).color,
    usage,
    /** A concept's glyph alone (its icon in its colour). */
    icon: (cid, x, y, size = 48, o = {}) => {
      const d = marker(cid);
      return g({ 'data-concept': d.id, 'data-icon': d.icon, 'data-color': d.color, 'data-shape': 'icon' }, uiIcon(d.icon, x, y, size, { color: d.color, ...o }));
    },
    /** A concept as its node (its shape, icon and colour), centred on (x, y). See conceptNode. */
    node: (cid, x, y, o = {}) => conceptNode(marker(cid), x, y, o),
    /** A concept as a small travelling chip with optional text (a request, a token, a page). */
    chip: (cid, x, y, o = {}) => conceptChip(marker(cid), x, y, o),
    /** A concept as its real thing on the isometric table: objects.js object() with its object id and
     *  tone (`label: true` puts its name on it). */
    object: (cid, at, o = {}) => {
      const d = thing(cid, o);
      return objectsKit().object(d.object, at, objOpts(d, o));
    },
    /** A concept as its real thing in a world frame: objects.js worldObject(), drawn with lensObject(). */
    worldObject: (cid, at, o = {}) => {
      const d = thing(cid, o);
      return objectsKit().worldObject(d.object, at, objOpts(d, o));
    },
  };
  return reg;
}

const conceptAttrs = (d, shape) => ({ 'data-concept': d.id, 'data-icon': d.icon, 'data-color': d.color, 'data-shape': shape });

/** A glossy disc with an icon. */
function disc(x, y, size, color, iconName, lit = 1) {
  const r = size / 2;
  const R = ramp(color);
  const out = [];
  if (lit > 0 && color !== 'ink') out.push(glowAt(x, y + r * 0.2, r * 1.5, r * 1.2, R.glow, 0.35 * lit, 0.42));
  out.push(glossPanel(x - r, y - r, size, size, r, { color }));
  if (lit < 1) out.push(el('circle', { cx: f(x), cy: f(y), r: f(r), fill: T['paper-lit'], 'fill-opacity': f(0.45 * (1 - lit)) }));
  out.push(uiIcon(iconName, x, y, size * 0.46, { color: color === 'yellow' ? R.text : WHITE, sw: 2.2 }));
  return out.join('');
}

/** A document: a frosted page with a folded corner, a colour spine and the concept's icon. */
function docShape(x, y, size, color, iconName, lit = 1) {
  const w = size * 0.8;
  const h = size;
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  const R = ramp(color);
  const fold = size * 0.22;
  const d = `M ${f(x0 + 10)} ${f(y0)} H ${f(x0 + w - fold)} L ${f(x0 + w)} ${f(y0 + fold)} V ${f(y0 + h - 10)} Q ${f(x0 + w)} ${f(y0 + h)} ${f(x0 + w - 10)} ${f(y0 + h)} H ${f(x0 + 10)} Q ${f(x0)} ${f(y0 + h)} ${f(x0)} ${f(y0 + h - 10)} V ${f(y0 + 10)} Q ${f(x0)} ${f(y0)} ${f(x0 + 10)} ${f(y0)} Z`;
  const out = [glassPanel(x0, y0, w, h, 10, { path: d, tint: color, tintLevel: 0.35 + 0.4 * lit, ring: color, ringLevel: 0.25 * lit, strength: 1.15 })];
  out.push(el('path', { d: `M ${f(x0 + w - fold)} ${f(y0)} V ${f(y0 + fold)} H ${f(x0 + w)}`, fill: R.base, 'fill-opacity': 0.18, stroke: R.base, 'stroke-opacity': 0.55, 'stroke-width': 1.4 }));
  out.push(uiIcon(iconName, x, y + h * 0.04, size * 0.4, { color, sw: 2.2 }));
  return out.join('');
}

/**
 * A concept drawn as its node, centred on (x, y), `size` px. `emph` (0..1) lights it: glow, a ring
 * and up to 8% scale. `dim` (0..1) sits it back under a paper wash. `appear` pops it in. `name`
 * puts its label below (true, or 'above' / 'right' / 'left', or a string to override the text) at
 * ≥ READ_MIN. Returns { svg, box }.
 */
export function conceptNode(d, x, y, { size = 120, emph = 0, dim = 0, appear = 1, name = false, nameSize = READ_MIN, text: nameText = null } = {}) {
  const e = clamp01(emph);
  const lit = clamp01(1 - dim);
  const R = ramp(d.color);
  const out = [];
  if (e > 0) out.push(glowAt(x, y, size * 0.95, size * 0.85, R.glow, 0.45 * e, 0.4));
  if (d.shape === 'disc') out.push(disc(x, y, size, d.color, d.icon, lit));
  else if (d.shape === 'doc') out.push(docShape(x, y, size, d.color, d.icon, lit));
  else if (d.shape === 'chip') out.push(conceptChip(d, x, y, { h: size * 0.5, dim }).svg);
  else out.push(glossTile(x, y, size, { icon: d.icon, color: d.color, lit }));
  if (e > 0) {
    const pad = 12;
    const w = d.shape === 'doc' ? size * 0.8 : size;
    out.push(el('path', { d: roundRect(x - w / 2 - pad, y - size / 2 - pad, w + pad * 2, size + pad * 2, d.shape === 'disc' ? size / 2 + pad : size * 0.3 + pad), fill: 'none', stroke: R.base, 'stroke-width': 3, 'stroke-opacity': f(0.85 * e) }));
  }
  let box = { x: x - size / 2, y: y - size / 2, w: size, h: size };
  if (name) {
    const str = typeof name === 'string' && !['above', 'right', 'left', 'below'].includes(name) ? name : nameText ?? d.label;
    const pos = ['above', 'right', 'left'].includes(name) ? name : 'below';
    const sz = Math.max(READ_MIN, nameSize);
    const tw = measure(str, sz, 'roboto-700');
    const gap = 22;
    let lx = x;
    let ly = y + size / 2 + gap + sz * 0.8;
    let anchor = 'middle';
    if (pos === 'above') ly = y - size / 2 - gap - sz * 0.2;
    if (pos === 'right') { lx = x + size / 2 + gap; ly = y + sz * 0.35; anchor = 'start'; }
    if (pos === 'left') { lx = x - size / 2 - gap; ly = y + sz * 0.35; anchor = 'end'; }
    out.push(text(str, lx, ly, sz, { face: 'roboto-700', anchor, color: dim > 0.5 ? soft() : ink() }));
    const x0 = anchor === 'middle' ? lx - tw / 2 : anchor === 'end' ? lx - tw : lx;
    const bx0 = Math.min(box.x, x0);
    const by0 = Math.min(box.y, ly - sz);
    box = { x: bx0, y: by0, w: Math.max(box.x + box.w, x0 + tw) - bx0, h: Math.max(box.y + box.h, ly + sz * 0.25) - by0 };
  }
  const k = 1 + 0.08 * easeUI(e);
  const svg = pop(scaleAbout(g({ ...conceptAttrs(d, d.shape), 'data-ui': 'concept' }, out), x, y, k), x, y, appear);
  return boxed(svg, box);
}

/**
 * A concept as a capsule chip centred on (x, y): its colour, its icon and optional `text`
 * (≥ READ_MIN). The shape of anything that travels (a request, a token, a page, a vector).
 * `tone`: 'solid' (glossy, default) or 'glass' (frosted with a colour ring). Returns { svg, box }.
 */
export function conceptChip(d, x, y, { text: str = '', h = 64, tone = 'solid', dim = 0, emph = 0, appear = 1, showIcon = true } = {}) {
  const R = ramp(d.color);
  const sz = Math.max(READ_MIN, h * 0.56);
  const iconS = showIcon ? h * 0.5 : 0;
  const padX = h * 0.36;
  const tw = str ? measure(str, sz, 'roboto-700') : 0;
  const w = Math.max(h * 1.6, padX * 2 + iconS + (str && showIcon ? h * 0.18 : 0) + tw);
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  const out = [];
  const e = clamp01(emph);
  if (e > 0) out.push(glowAt(x, y, w * 0.7, h * 1.1, R.glow, 0.5 * e, 0.4));
  if (tone === 'glass') out.push(glassPanel(x0, y0, w, h, h / 2, { tint: d.color, tintLevel: 0.5, ring: d.color, ringLevel: 0.6 + 0.4 * e, shadow: 0.5 }));
  else out.push(glossPanel(x0, y0, w, h, h / 2, { color: d.color }));
  if (dim > 0) out.push(el('path', { d: roundRect(x0, y0, w, h, h / 2), fill: T['paper-lit'], 'fill-opacity': f(0.5 * clamp01(dim)) }));
  const fg = tone === 'glass' ? R.text : d.color === 'yellow' ? R.text : WHITE;
  let cx = x0 + padX;
  if (showIcon) {
    out.push(uiIcon(d.icon, str ? cx + iconS / 2 : x, y, iconS, { color: fg, sw: 2.4 }));
    cx += iconS + h * 0.18;
  }
  out.push(el('rect', { 'data-k': 'shape', x: f(x0), y: f(y0), width: f(w), height: f(h), rx: f(h / 2), fill: 'none' }));
  if (str) out.push(label(str, cx, y + sz * 0.36, sz, { face: 'roboto-700', color: fg }));
  const svg = pop(g({ ...conceptAttrs(d, 'chip'), 'data-k': 'textbox', 'data-ui': 'chip' }, out), x, y, appear);
  return boxed(svg, { x: x0, y: y0, w, h });
}

/**
 * The identity problems in a reel: one concept drawn with two icons, two colours or two shapes
 * (the node shape and its travelling chip count as one), as two objects or in two tones, or in one
 * colour as a marker and another as an object; one icon, or one object in one tone, standing for two
 * concepts. `usage` is an SVG string, an array of SVG strings (every frame's samples), or records:
 * usages { id, icon, color, shape } / { id, form: 'object', object, tone }, or identity defs
 * (Object.values(reg.defs): each checked in every form it declares).
 */
export function identityProblems(usage) {
  const list = [];
  const take = (s) => {
    for (const m of String(s).matchAll(/<g [^>]*data-concept="([^"]+)"[^>]*>/g)) {
      const tag = m[0];
      const a = (k) => tag.match(new RegExp(`data-${k}="([^"]*)"`))?.[1];
      if (a('shape') === 'object') list.push({ id: m[1], form: 'object', object: a('object'), tone: a('color') });
      else list.push({ id: m[1], form: 'marker', icon: a('icon'), color: a('color'), shape: a('shape') });
    }
  };
  for (const u of Array.isArray(usage) ? usage : [usage]) {
    if (typeof u === 'string' || (u && u.svg)) take(svgOf(u));
    else if (u && u.id) {
      // a record: a usage, or an identity def (reg.defs), which may carry both forms
      if (u.form === 'object' || (u.object && !u.icon)) list.push({ id: u.id, form: 'object', object: u.object, tone: u.toneName ?? u.tone ?? toneFamily(null) });
      else if (u.icon || u.shape) {
        list.push({ id: u.id, form: 'marker', icon: u.icon, color: u.color, shape: u.shape });
        if (u.object) list.push({ id: u.id, form: 'object', object: u.object, tone: u.toneName ?? toneFamily(u.tone ?? null) });
      }
    }
  }
  const by = new Map();
  const slot = (id) => {
    if (!by.has(id)) by.set(id, { icon: new Set(), color: new Set(), shape: new Set(), object: new Set(), tone: new Set() });
    return by.get(id);
  };
  for (const u of list) {
    const s = slot(u.id);
    if (u.form === 'object') {
      if (u.object) s.object.add(u.object);
      if (u.tone) s.tone.add(u.tone);
      continue;
    }
    if (u.icon) s.icon.add(u.icon);
    if (u.color) s.color.add(u.color);
    if (u.shape && !['chip', 'icon'].includes(u.shape)) s.shape.add(u.shape);
  }
  const out = [];
  for (const [cid, s] of by) {
    if (s.icon.size > 1) out.push(`the concept "${cid}" is drawn with ${s.icon.size} icons (${[...s.icon].join(', ')}): one icon per concept for the whole reel`);
    if (s.color.size > 1) out.push(`the concept "${cid}" is drawn in ${s.color.size} colours (${[...s.color].join(', ')}): highlight with light or a border, never recolour`);
    if (s.shape.size > 1) out.push(`the concept "${cid}" takes ${s.shape.size} shapes (${[...s.shape].join(', ')}): one shape per concept`);
    if (s.object.size > 1) out.push(`the concept "${cid}" is drawn as ${s.object.size} objects (${[...s.object].join(', ')}): one real thing per concept`);
    if (s.tone.size > 1) out.push(`the concept "${cid}" is drawn as an object in ${s.tone.size} tones (${[...s.tone].join(', ')}): one tone per concept`);
    // both forms: one colour (an object in its own tone is not compared)
    const tones = [...s.tone].filter((x) => x !== 'own');
    if (s.color.size === 1 && tones.length === 1 && tones[0] !== [...s.color][0]) out.push(`the concept "${cid}" is ${[...s.color][0]} as a marker but ${tones[0]} as an object: one colour per concept`);
  }
  // One look standing for two concepts confuses as much as two looks for one.
  const iconOwners = new Map();
  for (const [cid, s] of by) for (const ic of s.icon) iconOwners.set(ic, [...(iconOwners.get(ic) ?? []), cid]);
  for (const [ic, owners] of iconOwners) if (owners.length > 1) out.push(`the icon "${ic}" stands for ${owners.length} concepts (${owners.join(', ')}): give each its own`);
  const thingOwners = new Map();
  for (const [cid, s] of by) for (const ob of s.object) for (const tn of s.tone.size ? s.tone : ['own']) thingOwners.set(`${ob} in ${tn}`, [...(thingOwners.get(`${ob} in ${tn}`) ?? []), cid]);
  for (const [look, owners] of thingOwners) if (owners.length > 1) out.push(`the object "${look.replace(' in ', '" in ')} stands for ${owners.length} concepts (${owners.join(', ')}): give each its own object or tone`);
  return out;
}

// ── No empty shells ───────────────────────────────────────────────────────────────────────
/** Wrap a container: it draws only when `content` is non-empty (or allowEmpty), and is tagged. */
function shellOf(drawShell, content, { allowEmpty = false, ui = 'shell', box }) {
  const inner = svgOf(content);
  const filled = inner.trim().length > 0;
  if (!filled && !allowEmpty) return boxed('', box, { filled: false });
  return boxed(g({ 'data-shell': 1, 'data-filled': filled ? 1 : 0, 'data-ui': ui }, [drawShell(), inner]), box, { filled });
}

/**
 * Containers drawn with nothing inside them, in one SVG or a frame's samples ([svg] or
 * [{ t, svg }]). Built-in containers already refuse to draw empty; this catches a frame that
 * forced allowEmpty or hand-drew a shell (data-shell="1" data-filled="0").
 */
export function emptyShellProblems(samples) {
  const list = Array.isArray(samples) ? samples : [samples];
  const out = [];
  for (const s of list) {
    const svg = svgOf(s?.svg ?? s);
    const n = (svg.match(/data-shell="1" data-filled="0"/g) ?? []).length;
    if (n) out.push(`${n} empty container${n > 1 ? 's' : ''}${s?.t != null ? ` at ${Number(s.t).toFixed(2)}s` : ''}: a container appears together with its first content`);
  }
  return out;
}

// ── Process / flow ────────────────────────────────────────────────────────────────────────
/** A connector from a to b ([x, y]) in a concept's colour (or `color`): a route, lit to progress. */
export function connector(reg, cid, a, b, { progress = 1, bend = 'h', dashed = false, color = null, via = [], width = 4, ends = false } = {}) {
  const c = color ?? (cid ? reg.get(cid).color : 'ink');
  return route([a, ...via, b], { color: routeColor(c), progress, bend, dashed, width, ends });
}
/** A route's colour: ink stays ink (4.1; it was remapped to blue, which clashed with a blue
 *  identity). Only on a dark ground, where an ink line cannot be seen, does ink light as blue. */
const routeColor = (c) => (c === 'ink' && isDark() ? 'blue' : c);

/**
 * A concept travelling a path ([[x, y], …]) at u (0..1): its chip (with `text`) rides the route
 * upright with a lit trail behind it. Before u = 0 it waits at the start; after 1 it rests at the
 * end (set `hideAfter` to let it vanish into the target). Returns { svg, box, at }.
 */
export function travel(reg, cid, points, u, { text: str = '', h = 64, bend = 'h', trail = 0.35, hideAfter = false, tone = 'solid', emph = 0 } = {}) {
  const d = reg.get(cid);
  const uu = clamp01(u);
  if (hideAfter && u >= 1) return boxed('', { x: points.at(-1)[0], y: points.at(-1)[1], w: 0, h: 0 }, { at: { x: points.at(-1)[0], y: points.at(-1)[1] } });
  const p = routeAt(points, uu, { bend });
  const out = [];
  if (trail > 0 && uu > 0 && uu < 1) out.push(route(points, { color: routeColor(d.color), bend, progress: uu, trail: Math.min(trail, uu), track: false, width: 4, ends: false }));
  const chip = conceptChip(d, p.x, p.y, { text: str, h, tone, emph });
  out.push(chip.svg);
  return boxed(g({ 'data-ui': 'travel' }, out), chip.box, { at: p });
}

/**
 * Items waiting in line: chips stacked from (x, y) along `axis`, the first in front. `arrived`
 * (0..n, fractional) slides each one in from `from` (default offset 260px back along the axis);
 * `served` (0..n) slides the front ones out the other way. items: [{ id, text }] or ids.
 */
export function queue(reg, items, x, y, { axis = 'h', gap = 18, h = 64, arrived = items.length, served = 0, from = null } = {}) {
  const out = [];
  let off = 0;
  const boxes = [];
  items.forEach((it, i) => {
    const cid = typeof it === 'string' ? it : it.id;
    const str = typeof it === 'string' ? '' : it.text ?? '';
    const d = reg.get(cid);
    const probe = conceptChip(d, 0, 0, { text: str, h });
    const len = axis === 'h' ? probe.box.w : probe.box.h;
    const slotC = off + len / 2;
    off += len + gap;
    const inU = span(arrived - i, 0, 1);
    const outU = span(served - i, 0, 1);
    if (inU <= 0 || outU >= 1) return;
    const back = from ?? 260;
    const sx = axis === 'h' ? x + slotC + (1 - inU) * back - outU * (len + 140) : x;
    const sy = axis === 'v' ? y + slotC + (1 - inU) * back - outU * (len + 140) : y;
    const ch = conceptChip(d, sx, sy, { text: str, h });
    out.push(g({ opacity: f(clamp01(inU * 1.5) * clamp01((1 - outU) * 1.5)) }, ch.svg));
    boxes.push(ch.box);
  });
  const bx = boxes.length ? boxes.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x1: Math.max(a.x1, b.x + b.w), y1: Math.max(a.y1, b.y + b.h) }), { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity }) : null;
  return boxed(g({ 'data-ui': 'queue' }, out), bx ? { x: bx.x, y: bx.y, w: bx.x1 - bx.x, h: bx.y1 - bx.y } : { x, y, w: 0, h: 0 });
}

/**
 * One item splitting into copies that travel to several targets: from `a` along each path in
 * `paths` ([[x, y], …] each, starting at a). `u` 0..1, `stagger` delays each branch. `items`
 * (optional, per branch) is the concept and text each branch carries (a router sorting requests:
 * [{ id: 'small', text: 'typo fix' }, …]).
 */
export function fan(reg, cid, paths, u, { stagger = 0.12, text: str = '', items = null, h = 60, bend = 'v', lit = true } = {}) {
  const out = [];
  paths.forEach((P, i) => {
    const it = items?.[i];
    const cc = it?.id ?? cid;
    const uu = clamp01((u - i * stagger) / (1 - stagger * (paths.length - 1) || 1));
    if (lit) out.push(route(P, { color: routeColor(reg.get(cc).color), bend, progress: uu, ends: uu >= 1, width: 4 }));
    if (uu > 0 && uu < 1) out.push(travel(reg, cc, P, uu, { text: it?.text ?? str, h, bend, trail: 0 }).svg);
  });
  return boxed(g({ 'data-ui': 'fan' }, out), boundsOfPaths(paths));
}

/** Several items travelling in to one target and landing there in a stack (the reverse of fan). */
export function merge(reg, items, paths, u, { stagger = 0.15, h = 60, bend = 'h', stackAt = null, stackGap = 12 } = {}) {
  const out = [];
  let landed = 0;
  items.forEach((it, i) => {
    const cid = typeof it === 'string' ? it : it.id;
    const str = typeof it === 'string' ? '' : it.text ?? '';
    const P = paths[i];
    const uu = clamp01((u - i * stagger) / (1 - stagger * (items.length - 1) || 1));
    out.push(route(P, { color: routeColor(reg.get(cid).color), bend, progress: uu, ends: false, width: 3 }));
    if (uu < 1) {
      if (uu > 0) out.push(travel(reg, cid, P, uu, { text: str, h, bend }).svg);
    } else if (stackAt) {
      out.push(conceptChip(reg.get(cid), stackAt[0], stackAt[1] + landed * (h + stackGap), { text: str, h }).svg);
      landed += 1;
    }
  });
  return boxed(g({ 'data-ui': 'merge' }, out), boundsOfPaths(paths), { landed });
}

/**
 * A copy peeling off and travelling while the original stays put (a cache saving a copy, a file
 * duplicated): the original stays at the path's start, a ghost outline marks it, and the copy rides
 * the path. `stampAt` (0..1) is when the copy lifts off (a flash on the original).
 */
export function copyOut(reg, cid, points, u, { text: str = '', h = 64, bend = 'h', tag = 'copy' } = {}) {
  const d = reg.get(cid);
  const [sx, sy] = points[0];
  const out = [conceptChip(d, sx, sy, { text: str, h }).svg];
  const lift = span(u, 0, 0.15);
  if (lift > 0 && lift < 1) out.push(glowAt(sx, sy, h * 1.6, h, ramp(d.color).glow, 0.6 * (1 - lift), 0.4));
  if (u > 0) {
    const t = travel(reg, cid, points, span(u, 0.05, 1), { text: str, h, bend, tone: 'glass' });
    out.push(t.svg);
    if (tag && u > 0.1) out.push(pillTag(tag, t.at.x, t.at.y - h * 0.5 - 30, d.color));
  }
  return boxed(g({ 'data-ui': 'copy' }, out), boundsOfPaths([points]));
}

function boundsOfPaths(paths) {
  const xs = paths.flat().map((p) => p[0]);
  const ys = paths.flat().map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** A small tinted tag (≥ READ_MIN) centred on (x, y). */
function pillTag(str, x, y, color = 'ink', { size = READ_MIN, solid = false } = {}) {
  const R = ramp(color);
  const sz = Math.max(READ_MIN, size);
  const w = measure(str, sz, 'roboto-700') + sz * 1.1;
  const h = sz * 1.5;
  const out = [];
  if (solid) out.push(glossPanel(x - w / 2, y - h / 2, w, h, h / 2, { color }));
  else out.push(el('path', { d: roundRect(x - w / 2, y - h / 2, w, h, h / 2), fill: isDark() ? T.ink : WHITE, 'fill-opacity': 0.92, stroke: R.base, 'stroke-opacity': 0.6, 'stroke-width': 1.6 }));
  out.push(el('rect', { 'data-k': 'shape', x: f(x - w / 2), y: f(y - h / 2), width: f(w), height: f(h), rx: f(h / 2), fill: 'none' }));
  out.push(label(str, x, y + sz * 0.36, sz, { face: 'roboto-700', anchor: 'middle', color: solid ? (color === 'yellow' ? R.text : WHITE) : color === 'ink' ? ink() : mixText(color) }));
  return g({ 'data-k': 'textbox', 'data-ui': 'tag' }, out);
}
const mixText = (color) => ramp(color).text;
/** A label chip (≥ READ_MIN) centred on (x, y), outlined in `color` or `solid`. Labels belong to
 *  things: place it on the thing it names. */
export const tag = (str, x, y, o = {}) => pillTag(str, x, y, o.color ?? 'ink', o);

// ── Compare ───────────────────────────────────────────────────────────────────────────────
/**
 * Two side-by-side lanes for a before/after or an A-vs-B: a header tag on each (≥ READ_MIN) and a
 * hairline between. `left` / `right`: { title, color, draw(rect) → svg }. The lanes are the safe
 * area's halves by default. Each lane draws only with its content (no empty halves).
 */
export function versus({ left, right }, { x = SAFE.x0, y = SAFE.y0, w = SAFE.x1 - SAFE.x0, h = SAFE.y1 - SAFE.y0, gap = 40, appear = 1 } = {}) {
  const lw = (w - gap) / 2;
  const lanes = [left, right].map((L, i) => {
    const rx = x + i * (lw + gap);
    const rect = { x: rx, y: y + 70, w: lw, h: h - 70, cx: rx + lw / 2 };
    const content = svgOf(L.draw ? L.draw(rect) : L.content);
    if (!content.trim()) return '';
    return g({ 'data-ui': 'lane' }, [pillTag(L.title, rect.cx, y + 28, L.color ?? 'ink', { solid: !!L.solid }), content]);
  });
  const div = el('line', { x1: f(x + lw + gap / 2), y1: f(y + 10), x2: f(x + lw + gap / 2), y2: f(y + h), stroke: hair(), 'stroke-opacity': 0.14, 'stroke-width': 2, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' });
  const body = lanes.join('');
  return boxed(body ? pop(g({ 'data-ui': 'versus' }, [div, body]), x + w / 2, y + h / 2, appear) : '', { x, y, w, h });
}

/**
 * A measured meter: a glass track and a fill to `value` (0..1) in a colour, with a `name` above at
 * left and a `readout` (string) above at right, both ≥ READ_MIN. For time, cost, size, tokens.
 */
export function meter(x, y, w, { value = 0, color = 'teal', name = '', readout = '', h = 26, size = READ_MIN } = {}) {
  const R = ramp(color);
  const v = clamp01(value);
  const out = [];
  const ty = y + size * 0.85;
  if (name) out.push(text(name, x, ty, size, { face: 'roboto-700' }));
  if (readout) out.push(text(readout, x + w, ty, size, { face: 'roboto-700', anchor: 'end', color: mixText(color) }));
  const by = y + (name || readout ? size * 1.35 : 0);
  out.push(glassPanel(x, by, w, h, h / 2, { shadow: 0.4, strength: 1.1 }));
  out.push(el('path', { d: roundRect(x, by, w, h, h / 2), fill: 'none', stroke: hair(), 'stroke-opacity': 0.1, 'stroke-width': 1.2 }));
  if (v > 0) {
    const fw = Math.max(h, w * v);
    out.push(glossPanel(x, by, fw, h, h / 2, { color }));
    out.push(glowAt(x + fw - h / 2, by + h / 2, h * 1.2, h, R.glow, 0.45, 0.4));
  }
  return boxed(g({ 'data-ui': 'meter' }, out), { x, y, w, h: by + h - y });
}

/** A big number (Pragmatica, tabular) with an optional `unit` in Roboto after it. Counting up is
 *  the caller's: pass the animated value; `decimals` fixes its digits so it does not jitter. */
export function counter(x, y, value, { unit = '', size = 96, decimals = 0, color = null, anchor = 'start', prefix = '' } = {}) {
  const num = `${prefix}${Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  const c = color ? ramp(color).text : ink();
  const us = Math.max(READ_MIN, size * 0.42);
  const nw = measure(num, size, 'pragmatica-700');
  const uw = unit ? measure(unit, us, 'roboto-700') + us * 0.35 : 0;
  const tw = nw + uw;
  const x0 = anchor === 'middle' ? x - tw / 2 : anchor === 'end' ? x - tw : x;
  const out = [
    el('rect', { 'data-k': 'shape', x: f(x0 - 4), y: f(y - size * 0.82), width: f(tw + 8), height: f(size), fill: 'none' }),
    label(num, x0, y, size, { face: 'pragmatica-700', color: c }),
  ];
  if (unit) out.push(label(unit, x0 + nw + us * 0.35, y, us, { face: 'roboto-700', color: soft() }));
  return boxed(g({ 'data-k': 'textbox', 'data-ui': 'counter' }, out), { x: x0, y: y - size * 0.82, w: tw, h: size });
}

/**
 * A stopwatch: a glass dial of radius r, an arc that sweeps with `t` over `max` seconds in a colour,
 * and the elapsed time in the middle ("1.8 s", ≥ READ_MIN). `done` rings it with a check.
 */
export function stopwatch(cx, cy, r, { t = 0, max = 3, color = 'orange', unit = 's', decimals = 1, done = false, name = '' } = {}) {
  const R = ramp(color);
  const u = clamp01(t / max);
  const out = [glassPanel(cx - r, cy - r, r * 2, r * 2, r, { shadow: 0.7, strength: 1.15 })];
  out.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r - 16), fill: 'none', stroke: hair(), 'stroke-opacity': 0.1, 'stroke-width': 10 }));
  if (u > 0) {
    const a = u * Math.PI * 2 - 1e-4;
    const rr = r - 16;
    const ex = cx + rr * Math.sin(a);
    const ey = cy - rr * Math.cos(a);
    out.push(el('path', { d: `M ${f(cx)} ${f(cy - rr)} A ${f(rr)} ${f(rr)} 0 ${a > Math.PI ? 1 : 0} 1 ${f(ex)} ${f(ey)}`, fill: 'none', stroke: R.base, 'stroke-width': 10, 'stroke-linecap': 'round' }));
    out.push(glowAt(ex, ey, 22, 22, R.glow, 0.6, 0.4));
  }
  const val = unit === 'ms' ? Math.round(t * 1000) : t;
  out.push(counter(cx, cy + r * 0.14, val, { unit, size: Math.max(READ_MIN + 8, r * 0.42), decimals: unit === 'ms' ? 0 : decimals, anchor: 'middle', color: done ? color : null }).svg);
  if (done) out.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r + 8), fill: 'none', stroke: R.base, 'stroke-width': 3, 'stroke-opacity': 0.7 }));
  if (name) out.push(text(name, cx, cy + r + 52, READ_MIN, { face: 'roboto-700', anchor: 'middle' }));
  return boxed(g({ 'data-ui': 'stopwatch' }, out), { x: cx - r, y: cy - r, w: r * 2, h: r * 2 + (name ? 64 : 0) });
}

// ── Transform ─────────────────────────────────────────────────────────────────────────────
/**
 * A sentence splitting into tokens. `pieces` are the tokens in order (subword pieces allowed; a
 * leading space is shown as a gap). At progress 0 they sit together as one plain sentence; from 0.2
 * gaps open and each piece gets its chip (alternating two tints of `color`), lifting one after
 * another; from 0.65 each gets its index; `count` (true) shows the running token count. Wraps to
 * `w`. Returns { svg, box, chips: [{ x, y, w, h }] } so the tokens can travel on from there.
 */
export function tokenize(pieces, x, y, w, { progress = 1, color = 'blue', size = 46, count = true, countLabel = 'tokens', ids = null } = {}) {
  const R = ramp(color);
  const sz = Math.max(READ_MIN, size);
  const pad = sz * 0.3;
  const sep = span(progress, 0.15, 0.6);
  const lineH = sz * (1.25 + 0.75 * sep);
  const gapW = sz * 0.22 * sep;
  const out = [];
  const chips = [];
  let cx = x;
  let row = 0;
  const n = pieces.length;
  pieces.forEach((pc, i) => {
    const str = String(pc).replace(/^ /, '');
    const lead = /^ /.test(String(pc)) ? measure(' ', sz, 'roboto-500') : 0;
    const tw = measure(str, sz, 'roboto-500');
    const cw = tw + pad * 2 * sep;
    if (cx + lead + cw > x + w && cx > x) { row += 1; cx = x; }
    const bx = cx + lead * (1 - sep) + (i && cx > x ? gapW : 0);
    const by = y + row * lineH;
    const each = span(progress, 0.15 + (0.45 * i) / n, 0.3 + (0.45 * i) / n);
    const lift = -8 * each * (1 - span(progress, 0.75, 0.9));
    const ch = { x: bx, y: by - sz * 0.95 + lift, w: cw, h: sz * 1.3 };
    if (each > 0) {
      const tint = i % 2 ? R.lit : R.base;
      out.push(el('path', { d: roundRect(ch.x, ch.y, ch.w, ch.h, 12), fill: tint, 'fill-opacity': f(0.2 * each), stroke: R.base, 'stroke-opacity': f(0.65 * each), 'stroke-width': 2 }));
    }
    out.push(el('rect', { 'data-k': 'shape', x: f(ch.x), y: f(ch.y), width: f(ch.w), height: f(ch.h), rx: 12, fill: 'none' }));
    out.push(label(str, bx + pad * sep, by + lift, sz, { color: ink() }));
    const idx = span(progress, 0.6 + (0.25 * i) / n, 0.7 + (0.25 * i) / n);
    if (idx > 0) out.push(label(String(ids?.[i] ?? i + 1), ch.x + ch.w / 2, ch.y + ch.h + READ_MIN * 1.0, READ_MIN, { face: 'roboto-700', anchor: 'middle', color: R.text, opacity: idx }));
    chips.push(ch);
    cx = bx + cw;
  });
  const bottom = y + row * lineH + sz * 0.35 + (progress > 0.6 ? READ_MIN * 1.3 : 0);
  let box = { x, y: y - sz, w, h: bottom - (y - sz) };
  const body = [g({ 'data-k': 'textbox', 'data-ui': 'tokens' }, out)];
  if (count) {
    const shown = Math.round(n * span(progress, 0.15, 0.6));
    const c = counter(x, bottom + 110, shown, { unit: countLabel, size: 92, color });
    body.push(c.svg);
    box = { ...box, h: c.box.y + c.box.h - box.y };
  }
  return boxed(g({ 'data-ui': 'tokenize' }, body), box, { chips });
}

/**
 * Something becoming numbers: `values` (−1..1) as a column (or row) of glossy dots whose fill
 * shows the value, revealed one by one with `progress`, each with its number (≥ READ_MIN) when
 * `numbers`. The vector of an embedding, the weights of a layer.
 */
export function vectorize(x, y, values, { progress = 1, color = 'lilac', axis = 'v', step = 64, r = 20, numbers = true, bracket = true } = {}) {
  const R = ramp(color);
  const out = [];
  const n = values.length;
  values.forEach((v, i) => {
    const a = span(progress, (0.7 * i) / n, (0.7 * i) / n + 0.3);
    if (a <= 0) return;
    const cx = axis === 'v' ? x : x + i * step;
    const cy = axis === 'v' ? y + i * step : y;
    const m = Math.abs(v);
    out.push(pop([
      el('circle', { cx: f(cx), cy: f(cy), r: f(r), fill: isDark() ? T.ink : WHITE, stroke: R.base, 'stroke-opacity': 0.5, 'stroke-width': 2 }),
      el('circle', { cx: f(cx), cy: f(cy), r: f(r * (0.3 + 0.7 * m)), fill: v >= 0 ? R.base : R.shade, 'fill-opacity': f(0.35 + 0.65 * m) }),
      numbers ? label((v >= 0 ? '' : '−') + Math.abs(v).toFixed(2), axis === 'v' ? cx + r + 18 : cx, axis === 'v' ? cy + READ_MIN * 0.36 : cy + r + READ_MIN * 1.1, READ_MIN, { face: 'roboto-700', color: ink(), anchor: axis === 'v' ? 'start' : 'middle' }) : '',
    ].join(''), cx, cy, a));
  });
  const len = (n - 1) * step;
  if (bracket && progress > 0) {
    const o = clamp01(progress * 3);
    if (axis === 'v') out.push(el('path', { d: `M ${f(x - r - 8)} ${f(y - r - 10)} h -14 v ${f(len + r * 2 + 20)} h 14`, fill: 'none', stroke: hair(), 'stroke-opacity': f(0.4 * o), 'stroke-width': 3, 'stroke-linecap': 'round' }));
    else out.push(el('path', { d: `M ${f(x - r - 10)} ${f(y - r - 8)} v -14 h ${f(len + r * 2 + 20)} v 14`, fill: 'none', stroke: hair(), 'stroke-opacity': f(0.4 * o), 'stroke-width': 3, 'stroke-linecap': 'round' }));
  }
  const box = axis === 'v' ? { x: x - r - 22, y: y - r - 10, w: r * 2 + 22 + (numbers ? 110 : 0), h: len + r * 2 + 20 } : { x: x - r - 10, y: y - r - 22, w: len + r * 2 + 20, h: r * 2 + 22 + (numbers ? 50 : 0) };
  return boxed(g({ 'data-ui': 'vector' }, out), box);
}

/**
 * One drawing becoming another about (cx, cy): A shrinks and fades as B grows out of it, with a
 * flash of light at the hand-off. `a` and `b` are SVG strings (or { svg }).
 */
export function morph(a, b, u, { cx, cy, flash = 'yellow', size = 160 } = {}) {
  const e = clamp01(u);
  const out = [];
  if (e < 0.6) out.push(g({ opacity: f(1 - span(e, 0.2, 0.6)) }, scaleAbout(svgOf(a), cx, cy, 1 - 0.35 * span(e, 0, 0.6))));
  const fl = Math.sin(Math.PI * clamp01((e - 0.3) / 0.4));
  if (fl > 0) out.push(glowAt(cx, cy, size, size, ramp(flash).glow, 0.55 * fl, 0.45));
  if (e > 0.4) out.push(g({ opacity: f(span(e, 0.4, 0.75)) }, scaleAbout(svgOf(b), cx, cy, 0.7 + 0.3 * span(e, 0.4, 1))));
  return boxed(g({ 'data-ui': 'morph' }, out), { x: cx - size, y: cy - size, w: size * 2, h: size * 2 });
}

// ── Scale ─────────────────────────────────────────────────────────────────────────────────
/**
 * A count made visible: `count` unit dots in a grid `cols` wide at `step`, filling in order with
 * `progress`; the first `highlight` are in `color` (glossy), the rest a quiet ink. With a counter.
 */
export function unitGrid(x, y, count, { cols = 10, step = 56, r = 18, progress = 1, color = 'orange', highlight = count, rest = 'ink', unit = '', counterAt = 'below' } = {}) {
  const out = [];
  const shown = count * clamp01(progress);
  for (let i = 0; i < count; i++) {
    const a = clamp01(shown - i);
    if (a <= 0) break;
    const cx = x + (i % cols) * step + r;
    const cy = y + Math.floor(i / cols) * step + r;
    const c = i < highlight ? color : rest;
    if (c === 'ink') out.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r * a), fill: hair(), 'fill-opacity': 0.18 }));
    else out.push(glossPanel(cx - r * a, cy - r * a, r * 2 * a, r * 2 * a, r * a, { color: c, glow: false }));
  }
  const rows = Math.ceil(count / cols);
  const h = rows * step;
  const box = { x, y, w: Math.min(count, cols) * step, h };
  const parts = [g({ 'data-ui': 'units' }, out)];
  if (unit && counterAt) {
    const c = counter(x, y + h + 90, Math.round(shown), { unit, size: 80, color });
    parts.push(c.svg);
    box.h = c.box.y + c.box.h - y;
  }
  return boxed(g({ 'data-ui': 'unit-grid' }, parts), box);
}

/** Bars whose lengths are true to `items` ([{ name, value, color, readout }]) on one scale, growing
 *  with `progress`, the name above each bar and its readout at its end (≥ READ_MIN). */
export function sizeBars(x, y, w, items, { progress = 1, h = 40, gap = 50 } = {}) {
  const max = Math.max(...items.map((i) => i.value));
  const out = [];
  let cy = y;
  items.forEach((it, i) => {
    const v = (it.value / max) * span(progress, i * 0.1, 0.6 + i * 0.1);
    out.push(meter(x, cy, w, { value: v, color: it.color ?? 'teal', name: it.name, readout: it.readout ?? '', h }).svg);
    cy += READ_MIN * 1.35 + h + gap;
  });
  return boxed(g({ 'data-ui': 'size-bars' }, out), { x, y, w, h: cy - y - gap });
}

// ── Structure ─────────────────────────────────────────────────────────────────────────────
/**
 * A stack of layers seen at a slight angle: `items` [{ name, color }] from bottom to top, each a
 * glass slab that drops into place with `progress`; `active` (index) lights one (ring + glow).
 */
export function layers(x, y, w, items, { progress = 1, active = -1, slab = 92, gap = 26, skew = 0.32 } = {}) {
  const out = [];
  const n = items.length;
  const dy = slab * 0.55 + gap;
  items.forEach((it, i) => {
    const a = span(progress, i / (n + 1), (i + 2) / (n + 1));
    if (a <= 0) return;
    const yy = y - i * dy - (1 - a) * 60;
    const k = skew * slab;
    const pts = [[x + k, yy], [x + w, yy], [x + w - k, yy + slab * 0.55], [x, yy + slab * 0.55]];
    const d = `M ${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L ')} Z`;
    const on = i === active ? 1 : 0;
    const body = [glassPanel(x, yy, w, slab * 0.55, 10, { path: d, tint: it.color ?? 'blue', tintLevel: 0.5 + 0.5 * on, ring: it.color ?? 'blue', ringLevel: on, strength: 1.1 })];
    body.push(el('path', { d: `M ${f(pts[3][0])} ${f(pts[3][1])} L ${f(pts[2][0])} ${f(pts[2][1])} v 14 L ${f(pts[3][0])} ${f(pts[3][1] + 14)} Z`, fill: ramp(it.color ?? 'blue').shade, 'fill-opacity': 0.35 }));
    if (it.name) body.push(text(it.name, x + w / 2, yy + slab * 0.275 + READ_MIN * 0.36, READ_MIN, { face: 'roboto-700', anchor: 'middle' }));
    out.push(g({ opacity: f(clamp01(a * 1.5)) }, body));
  });
  return boxed(g({ 'data-ui': 'layers' }, out), { x, y: y - (n - 1) * dy, w, h: (n - 1) * dy + slab * 0.55 + 14 });
}

/**
 * A network: nodes [{ id, x, y, concept?, color?, name?, r? }] and edges [[a, b]]. Nodes pop in
 * then edges draw with `progress`; `active` node ids glow; `pulse` [[a, b, u]] sends a light along
 * an edge (a message passing). With `reg`, a node with `concept` takes its identity.
 */
export function graph(reg, nodes, edges, { progress = 1, active = [], pulse = [], r = 30, nameSize = READ_MIN } = {}) {
  const N = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  edges.forEach(([a, b], i) => {
    const A = N.get(a);
    const B = N.get(b);
    const u = span(progress, 0.3 + (0.5 * i) / edges.length, 0.5 + (0.5 * i) / edges.length);
    const on = active.includes(a) && active.includes(b);
    out.push(route([[A.x, A.y], [B.x, B.y]], { bend: 'line', progress: on ? u : 0, color: 'teal', glow: on, ends: false, width: 3 }));
    if (!on && u > 0) out.push(el('line', { x1: f(A.x), y1: f(A.y), x2: f(lerp(A.x, B.x, u)), y2: f(lerp(A.y, B.y, u)), stroke: hair(), 'stroke-opacity': 0.22, 'stroke-width': 2 }));
  });
  pulse.forEach(([a, b, u]) => {
    if (!(u > 0 && u < 1)) return;
    const A = N.get(a);
    const B = N.get(b);
    const px = lerp(A.x, B.x, u);
    const py = lerp(A.y, B.y, u);
    out.push(glowAt(px, py, 26, 26, ramp('yellow').glow, 0.8, 0.4), el('circle', { cx: f(px), cy: f(py), r: 9, fill: ramp('yellow').base }));
  });
  nodes.forEach((n, i) => {
    const a = span(progress, (0.3 * i) / nodes.length, (0.3 * i) / nodes.length + 0.25);
    const on = active.includes(n.id) ? 1 : 0;
    if (reg && n.concept) out.push(reg.node(n.concept, n.x, n.y, { size: (n.r ?? r) * 2, emph: on, appear: a, name: n.name ?? false, nameSize }).svg);
    else {
      const c = n.color ?? 'ink';
      const rr = n.r ?? r;
      const body = [on ? glowAt(n.x, n.y, rr * 2, rr * 2, ramp(c).glow, 0.5, 0.4) : '', glossPanel(n.x - rr, n.y - rr, rr * 2, rr * 2, rr, { color: c, glow: !!on })];
      if (n.name) body.push(text(n.name, n.x, n.y + rr + 18 + nameSize * 0.8, nameSize, { face: 'roboto-700', anchor: 'middle' }));
      out.push(pop(body.join(''), n.x, n.y, a));
    }
  });
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return boxed(g({ 'data-ui': 'graph' }, out), { x: Math.min(...xs) - r, y: Math.min(...ys) - r, w: Math.max(...xs) - Math.min(...xs) + r * 2, h: Math.max(...ys) - Math.min(...ys) + r * 2 + 60 });
}

/**
 * A map of meaning (embeddings, vector search): `points` [{ x, y (0..1 in the map), text, group }]
 * drop onto a frosted map with faint gridlines; groups take colours from `colors` ({ group: name }).
 * `query` ({ x, y, text }) lands at `queryAt` (0..1 of progress) and rings its `k` nearest
 * neighbours with distance lines that draw in. Returns { svg, box, nearest: [index…] }.
 */
export function pointMap(x, y, w, h, points, { progress = 1, colors = {}, query = null, queryAt = 0.55, k = 3, size = READ_MIN, r = 13 } = {}) {
  const P = (p) => [x + 40 + p.x * (w - 80), y + 40 + p.y * (h - 80)];
  const content = [];
  const grid = [];
  for (let i = 1; i < 4; i++) {
    grid.push(el('line', { x1: f(x + (w * i) / 4), y1: f(y + 16), x2: f(x + (w * i) / 4), y2: f(y + h - 16), stroke: hair(), 'stroke-opacity': 0.07, 'stroke-width': 1.5 }));
    grid.push(el('line', { x1: f(x + 16), y1: f(y + (h * i) / 4), x2: f(x + w - 16), y2: f(y + (h * i) / 4), stroke: hair(), 'stroke-opacity': 0.07, 'stroke-width': 1.5 }));
  }
  let nearest = [];
  const qa = query ? span(progress, queryAt, queryAt + 0.15) : 0;
  if (query) {
    const d = points.map((p, i) => [Math.hypot(p.x - query.x, p.y - query.y), i]).sort((a, b) => a[0] - b[0]);
    nearest = d.slice(0, k).map(([, i]) => i);
  }
  const lines = [];
  const dots = [];
  points.forEach((p, i) => {
    const a = span(progress, (0.4 * i) / points.length, (0.4 * i) / points.length + 0.2);
    if (a <= 0) return;
    const [px, py] = P(p);
    const c = colors[p.group] ?? 'ink';
    const near = nearest.includes(i) ? span(progress, queryAt + 0.15, queryAt + 0.35) : 0;
    const far = query && !nearest.includes(i) ? span(progress, queryAt + 0.15, queryAt + 0.35) : 0;
    const dd = [];
    if (near > 0) dd.push(glowAt(px, py, r * 3, r * 3, ramp(c === 'ink' ? 'yellow' : c).glow, 0.5 * near, 0.4));
    dd.push(c === 'ink' ? el('circle', { cx: f(px), cy: f(py), r: f(r), fill: hair(), 'fill-opacity': 0.45 }) : glossPanel(px - r, py - r, r * 2, r * 2, r, { color: c, glow: false }));
    if (near > 0) dd.push(el('circle', { cx: f(px), cy: f(py), r: f(r + 9), fill: 'none', stroke: ramp(c === 'ink' ? 'yellow' : c).base, 'stroke-width': 3, 'stroke-opacity': f(near) }));
    // a far point dims its dot; its label dims by colour to the secondary ink (still ≥ 4.5:1 on
    // its ground), never by opacity, which took it under the contrast check (2.9:1)
    const lab = [];
    if (p.text) {
      const lx = p.side === 'left' ? px - r - 12 : px + r + 12;
      lab.push(text(p.text, lx, py + size * 0.36, size, { face: 'roboto-700', anchor: p.side === 'left' ? 'end' : 'start', color: far > 0 ? mixInk(ink(), soft(), far) : ink() }));
    }
    dots.push(pop(g({ opacity: f(1 - 0.5 * far) }, dd.join('')) + lab.join(''), px, py, a));
    if (near > 0 && query) {
      const [qx, qy] = P(query);
      lines.push(el('line', { x1: f(qx), y1: f(qy), x2: f(lerp(qx, px, near)), y2: f(lerp(qy, py, near)), stroke: ramp('yellow').text, 'stroke-width': 3, 'stroke-dasharray': '3 9', 'stroke-linecap': 'round', 'stroke-opacity': 0.8 }));
    }
  });
  content.push(...lines, ...dots);
  if (query && qa > 0) {
    const [qx, qy] = P(query);
    const drop = (1 - qa) * 120;
    const q = [glowAt(qx, qy - drop, 60, 60, ramp('yellow').glow, 0.6 * qa, 0.4), glossPanel(qx - 22, qy - 22 - drop, 44, 44, 22, { color: 'orange' })];
    q.push(uiIcon('search', qx, qy - drop, 24, { color: WHITE, sw: 2.6 }));
    if (query.text) {
      const tw = measure(query.text, READ_MIN, 'roboto-700') + READ_MIN * 1.1;
      const side = query.tag === 'right';
      const tx = clamp(side ? qx + 40 + tw / 2 : qx, x + tw / 2 + 16, x + w - tw / 2 - 16);
      q.push(pillTag(query.text, tx, qy - drop + (side ? 0 : query.tag === 'below' ? 66 : -66), 'orange', { solid: true }));
    }
    content.push(g({ 'data-ui': 'query', opacity: f(qa) }, q));
  }
  const inner = content.join('');
  return { ...shellOf(() => [glassPanel(x, y, w, h, 34, { strength: 0.9 }), ...grid].join(''), inner, { ui: 'point-map', box: { x, y, w, h } }), nearest };
}

// ── Timeline ──────────────────────────────────────────────────────────────────────────────
/**
 * Events over time on an axis from (x, y), `w` wide, covering `range` [t0, t1] (seconds). events:
 * [{ at, dur?, name, color?, wait? }]: a duration draws as a bar (hatched when `wait`, the time
 * spent waiting), a point as a dot; `t` is the playhead (bars grow up to it). `lane` puts an event
 * on a row (0, 1, …). Labels above each bar ≥ READ_MIN.
 */
export function timeline(x, y, w, events, { t = Infinity, range = [0, 1], unit = 's', laneH = 120, ticks = 4 } = {}) {
  const [t0, t1] = range;
  const X = (tt) => x + ((clamp(tt, t0, t1) - t0) / (t1 - t0)) * w;
  const lanes = Math.max(1, ...events.map((e) => (e.lane ?? 0) + 1));
  const axisY = y + lanes * laneH;
  const out = [el('line', { x1: f(x), y1: f(axisY), x2: f(x + w), y2: f(axisY), stroke: hair(), 'stroke-opacity': 0.3, 'stroke-width': 2 })];
  for (let i = 0; i <= ticks; i++) {
    const tt = t0 + ((t1 - t0) * i) / ticks;
    out.push(el('line', { x1: f(X(tt)), y1: f(axisY - 8), x2: f(X(tt)), y2: f(axisY + 8), stroke: hair(), 'stroke-opacity': 0.3, 'stroke-width': 2 }));
    out.push(text(`${unit === 'ms' ? Math.round(tt * 1000) : +tt.toFixed(1)} ${unit}`, X(tt), axisY + 52, READ_MIN, { anchor: i === 0 ? 'start' : i === ticks ? 'end' : 'middle', color: soft() }));
  }
  events.forEach((ev, i) => {
    if (t < ev.at) return;
    const c = ev.color ?? 'teal';
    const R = ramp(c);
    const ly = y + (ev.lane ?? 0) * laneH + laneH * 0.62;
    if (ev.dur) {
      const end = Math.min(ev.at + ev.dur, t);
      const bw = Math.max(18, X(end) - X(ev.at));
      const bh = 34;
      if (ev.wait) {
        const hid = id(`ex-hatch-${c}`);
        out.push(el('defs', {}, el('pattern', { id: hid, width: 14, height: 14, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('rect', { width: 6, height: 14, fill: R.base, 'fill-opacity': 0.45 }))));
        out.push(el('path', { d: roundRect(X(ev.at), ly - bh / 2, bw, bh, bh / 2), fill: `url(#${hid})`, stroke: R.base, 'stroke-opacity': 0.6, 'stroke-width': 2 }));
      } else out.push(glossPanel(X(ev.at), ly - bh / 2, bw, bh, bh / 2, { color: c }));
    } else out.push(glossPanel(X(ev.at) - 14, ly - 14, 28, 28, 14, { color: c }));
    if (ev.name) out.push(text(ev.name, X(ev.at), ly - 36, READ_MIN, { face: 'roboto-700', anchor: X(ev.at) > x + w * 0.7 ? 'end' : 'start' }));
    if (ev.readout && ev.dur && t >= ev.at + ev.dur) out.push(text(ev.readout, X(ev.at + ev.dur) + 14, ly + READ_MIN * 0.36, READ_MIN, { face: 'roboto-700', color: R.text }));
    void i;
  });
  if (Number.isFinite(t) && t >= t0 && t <= t1) {
    out.push(el('line', { x1: f(X(t)), y1: f(y), x2: f(X(t)), y2: f(axisY + 10), stroke: ramp('orange').base, 'stroke-width': 3 }));
    out.push(glossPanel(X(t) - 10, y - 10, 20, 20, 10, { color: 'orange' }));
  }
  return boxed(g({ 'data-ui': 'timeline' }, out), { x, y: y - 20, w, h: axisY + 70 - y });
}

// ── Cause and effect ──────────────────────────────────────────────────────────────────────
/** Expanding rings from (cx, cy) as u runs 0..1 (an impact, a trigger landing). */
export function ripple(cx, cy, u, { color = 'orange', r = 120, rings = 3 } = {}) {
  if (!(u > 0 && u < 1)) return '';
  const R = ramp(color);
  const out = [];
  for (let i = 0; i < rings; i++) {
    const v = clamp01(u * 1.4 - i * 0.2);
    if (v <= 0 || v >= 1) continue;
    out.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r * (0.3 + 0.7 * v)), fill: 'none', stroke: R.base, 'stroke-width': f(5 * (1 - v) + 1), 'stroke-opacity': f(0.8 * (1 - v)) }));
  }
  return g({ 'data-ui': 'ripple' }, out);
}

/**
 * A consequence landing on a thing: the thing at (cx, cy) shakes for a moment, a warning badge
 * pops on its corner and rings ripple out. `u` 0..1 from the hit. Wrap any drawing (`svg`).
 */
export function alarm(svg, cx, cy, u, { color = 'orange', badge = 'triangle-alert', r = 110, corner = [1, -1] } = {}) {
  const shake = u > 0 && u < 0.35 ? Math.sin(u * 60) * 10 * (1 - u / 0.35) : 0;
  const out = [g({ transform: shake ? `translate(${f(shake)} 0)` : undefined }, svgOf(svg)), ripple(cx, cy, u, { color, r: r * 1.6 })];
  if (u > 0.1) {
    const bx = cx + corner[0] * r * 0.75;
    const by = cy + corner[1] * r * 0.75;
    out.push(pop(glossPanel(bx - 30, by - 30, 60, 60, 30, { color }) + uiIcon(badge, bx, by - 1, 32, { color: WHITE, sw: 2.6 }), bx, by, span(u, 0.1, 0.35)));
  }
  return g({ 'data-ui': 'alarm' }, out);
}

// ── Product at work ───────────────────────────────────────────────────────────────────────
/**
 * A real app window, top-left (x, y), w × h: `kind` 'browser' (traffic lights, an address bar with
 * `url`, a loading bar at `load` 0..1), 'app' (a title bar with `title`) or 'terminal' (graphite).
 * `content` is SVG or a function of the content rect { x, y, w, h } → SVG. The window draws only
 * with its content (no empty shells); `appear` pops it in together with the content.
 */
export function appWindow(x, y, w, h, { kind = 'browser', url = '', title = '', load = null, content = '', appear = 1, allowEmpty = false } = {}) {
  const barH = kind === 'browser' ? 92 : 72;
  const rect = { x: x + 28, y: y + barH + 24, w: w - 56, h: h - barH - 48 };
  const inner = svgOf(typeof content === 'function' ? content(rect) : content);
  const dark = kind === 'terminal';
  const shell = () => {
    const out = [];
    if (dark) {
      out.push(boxShadow(x, y, w, h, 30, { dy: 30, blur: 60, spread: -24, opacity: 0.5 }));
      out.push(glossPanel(x, y, w, h, 30, { color: 'ink' }));
    } else out.push(glassPanel(x, y, w, h, 30, { strength: 1.25 }));
    out.push(el('rect', { 'data-k': 'shape', x: f(x), y: f(y), width: f(w), height: f(h), rx: 30, fill: 'none' }));
    ['orange', 'yellow', 'green'].forEach((c, i) => out.push(el('circle', { cx: f(x + 34 + i * 28), cy: f(y + 34), r: 8, fill: ramp(c).base, 'fill-opacity': dark ? 0.9 : 0.75 })));
    if (kind === 'browser') {
      const ax = x + 130;
      const aw = w - 160;
      out.push(el('path', { d: roundRect(ax, y + 14, aw, 44, 22), fill: hair(), 'fill-opacity': 0.06 }));
      out.push(uiIcon('lock', ax + 26, y + 36, 20, { color: soft(), sw: 2.4 }));
      if (url) out.push(label(fitURL(url, aw - 70), ax + 46, y + 36 + 11, 30, { color: soft(), decor: false }));
      if (load != null && load < 1) {
        out.push(el('rect', { x: f(x + 2), y: f(y + barH - 6), width: f((w - 4) * clamp01(load)), height: 5, rx: 2.5, fill: ramp('blue').base }));
        out.push(glowAt(x + (w - 4) * clamp01(load), y + barH - 4, 30, 10, ramp('blue').glow, 0.6, 0.4));
      }
    } else if (title) out.push(label(title, x + w / 2, y + 34 + 11, 30, { face: 'roboto-700', anchor: 'middle', color: dark ? T['paper-lit'] : ink() }));
    out.push(el('line', { x1: f(x), y1: f(y + barH), x2: f(x + w), y2: f(y + barH), stroke: dark ? WHITE : hair(), 'stroke-opacity': dark ? 0.12 : 0.08, 'stroke-width': 1.5 }));
    return g({ 'data-k': 'textbox' }, out);
  };
  const s = shellOf(shell, inner, { allowEmpty, ui: `window-${kind}`, box: { x, y, w, h } });
  return boxed(pop(s.svg, x + w / 2, y + h / 2, appear), { x, y, w, h }, { rect, filled: s.filled });
}
const fitURL = (url, w) => {
  let s = String(url);
  while (s.length > 4 && measure(s, 30, 'roboto-500') > w) s = `${s.slice(0, -2)}`;
  return s.length < String(url).length ? `${s.slice(0, -1)}…` : s;
};

/**
 * A document page with real text: a title and `lines` [{ text, kind?: 'text' | 'hl' | 'hidden' |
 * 'strike' }] typed in with `progress`. 'hl' marks a passage (a retrieved chunk) in `color`;
 * 'hidden' is text the reader does not see (white-on-white made visible: dashed, a faint red
 * wash, an eye-off tag) — the injected instruction. Wraps at `w`; grows to its text.
 */
export function docPage(x, y, w, { title = '', lines = [], progress = 1, size = READ_MIN, color = 'yellow', reveal = 1, appear = 1, icon = 'file-text', iconColor = 'blue' } = {}) {
  const sz = Math.max(READ_MIN, size);
  const pad = 34;
  const inner = w - pad * 2;
  const rows = [];
  lines.forEach((ln, li) => {
    const L = typeof ln === 'string' ? { text: ln } : ln;
    const fit = wrapFit(L.text, sz, inner - (L.kind ? 24 : 0), 'roboto-500', 99, READ_MIN);
    fit.rows.forEach((r, ri) => rows.push({ text: r, kind: L.kind ?? 'text', li, first: ri === 0, last: ri === fit.rows.length - 1 }));
  });
  const lineH = sz * 1.42;
  const titleH = title ? sz * 1.9 : 0;
  const h = pad + titleH + rows.length * lineH + pad * 0.7;
  const shown = rows.length * clamp01(progress);
  const content = [];
  if (title) {
    content.push(glossTile(x + pad + 22, y + pad + 20, 44, { icon, color: iconColor, glow: false }));
    content.push(label(title, x + pad + 62, y + pad + 20 + sz * 0.36, sz, { face: 'roboto-700', color: ink() }));
  }
  // Group consecutive rows of a marked line into one block.
  const blocks = [];
  rows.forEach((r, i) => {
    const top = y + pad + titleH + i * lineH;
    if (r.kind !== 'text') {
      const last = blocks.at(-1);
      if (last && last.li === r.li) last.y1 = top + lineH;
      else blocks.push({ li: r.li, kind: r.kind, y0: top, y1: top + lineH });
    }
  });
  blocks.forEach((b) => {
    if (b.kind === 'hl') {
      const R = ramp(color);
      content.push(el('path', { d: roundRect(x + pad - 12, b.y0 + 2, inner + 24, b.y1 - b.y0 - 4, 12), fill: R.base, 'fill-opacity': 0.24, stroke: R.base, 'stroke-opacity': 0.6, 'stroke-width': 2 }));
    } else if (b.kind === 'hidden' && reveal > 0) {
      const R = ramp('orange');
      content.push(el('path', { d: roundRect(x + pad - 12, b.y0 + 2, inner + 24, b.y1 - b.y0 - 4, 12), fill: R.base, 'fill-opacity': f(0.12 * reveal), stroke: R.base, 'stroke-opacity': f(0.8 * reveal), 'stroke-width': 2.5, 'stroke-dasharray': '8 8' }));
    }
  });
  rows.forEach((r, i) => {
    const a = clamp01(shown - i);
    if (a <= 0) return;
    const by = y + pad + titleH + i * lineH + sz * 1.02;
    let c = ink();
    let op = a;
    if (r.kind === 'hidden') { c = ramp('orange').text; op = a * (0.12 + 0.88 * clamp01(reveal)); }
    if (r.kind === 'strike') c = soft();
    content.push(label(r.text, x + pad, by, sz, { color: c, opacity: op }));
    if (r.kind === 'strike') content.push(el('line', { x1: f(x + pad), y1: f(by - sz * 0.3), x2: f(x + pad + measure(r.text, sz)), y2: f(by - sz * 0.3), stroke: soft(), 'stroke-width': 3 }));
  });
  const s = shellOf(() => [glassPanel(x, y, w, h, 26, { strength: 1.25 }), el('rect', { 'data-k': 'shape', x: f(x), y: f(y), width: f(w), height: f(h), rx: 26, fill: 'none' })].join(''), g({ 'data-k': 'textbox' }, [el('rect', { 'data-k': 'shape', x: f(x), y: f(y), width: f(w), height: f(h), rx: 26, fill: 'none' }), ...content]), { ui: 'doc-page', box: { x, y, w, h } });
  const hiddenRows = rows.map((r, i) => (r.kind === 'hidden' ? y + pad + titleH + i * lineH + lineH / 2 : null)).filter((v) => v != null);
  return boxed(pop(s.svg, x + w / 2, y + h / 2, appear), { x, y, w, h }, { hiddenY: hiddenRows.length ? hiddenRows.reduce((a, b) => a + b, 0) / hiddenRows.length : null });
}

/** A file list: rows [{ name, meta?, concept? | icon? }] that land one by one with `progress`;
 *  `active` (index) is lit; `size` ≥ READ_MIN. */
export function fileList(reg, x, y, w, files, { progress = 1, active = -1, size = READ_MIN, rowH = 92, appear = 1 } = {}) {
  const rows = [];
  files.forEach((fi, i) => {
    const a = clamp01(files.length * progress - i);
    if (a <= 0) return;
    const ry = y + 18 + i * rowH;
    const on = i === active;
    const r = [];
    if (on) r.push(el('path', { d: roundRect(x + 10, ry, w - 20, rowH - 12, 18), fill: ramp('yellow').base, 'fill-opacity': 0.16, stroke: ramp('yellow').base, 'stroke-opacity': 0.6, 'stroke-width': 2 }));
    if (fi.concept && reg) r.push(reg.node(fi.concept, x + 56, ry + (rowH - 12) / 2, { size: 52 }).svg);
    else r.push(glossTile(x + 56, ry + (rowH - 12) / 2, 52, { icon: fi.icon ?? 'file-text', color: fi.color ?? 'blue', glow: false }));
    const fs = fitSize(fi.name, size, w - 130 - (fi.meta ? measure(fi.meta, READ_MIN) + 20 : 0), 'roboto-700', READ_MIN);
    r.push(label(fi.name, x + 100, ry + (rowH - 12) / 2 + fs * 0.36, fs, { face: 'roboto-700', color: ink() }));
    if (fi.meta) r.push(label(fi.meta, x + w - 28, ry + (rowH - 12) / 2 + READ_MIN * 0.36, READ_MIN, { color: soft(), anchor: 'end' }));
    rows.push(g({ opacity: f(clamp01(a * 1.4)), transform: a < 1 ? `translate(${f((1 - easeUI(a)) * 30)} 0)` : undefined }, r));
  });
  const h = files.length * rowH + 30;
  const s = shellOf(() => glassPanel(x, y, w, h, 28, { strength: 1.2 }) + el('rect', { 'data-k': 'shape', x: f(x), y: f(y), width: f(w), height: f(h), rx: 28, fill: 'none' }), rows.join(''), { ui: 'file-list', box: { x, y, w, h } });
  return boxed(s.filled ? pop(g({ 'data-k': 'textbox' }, s.svg), x + w / 2, y + h / 2, appear) : '', { x, y, w, h });
}

/** Search results: [{ title, snippet?, url? }] landing in order with `progress`; `active` lit. */
export function resultsList(x, y, w, results, { progress = 1, active = -1, size = READ_MIN, gap = 20 } = {}) {
  const out = [];
  let cy = y;
  results.forEach((r, i) => {
    const a = clamp01(results.length * progress - i);
    const T1 = wrapFit(r.title, size + 4, w - 60, 'roboto-700', 2, READ_MIN);
    const S1 = r.snippet ? wrapFit(r.snippet, size, w - 60, 'roboto-500', 2, READ_MIN) : { rows: [], size };
    const h = 30 + (r.url ? READ_MIN * 1.2 : 0) + T1.rows.length * T1.size * 1.15 + S1.rows.length * S1.size * 1.25 + 26;
    if (a > 0) {
      const on = i === active ? 1 : 0;
      const b = [glassPanel(x, cy, w, h, 24, { strength: 1.15, ring: 'yellow', ringLevel: on, tint: on ? 'yellow' : null, tintLevel: 0.6 * on, shadow: 0.6 }), el('rect', { 'data-k': 'shape', x: f(x), y: f(cy), width: f(w), height: f(h), rx: 24, fill: 'none' })];
      let ty = cy + 30;
      if (r.url) { ty += READ_MIN * 0.9; b.push(label(r.url, x + 30, ty, READ_MIN, { color: ramp('green').text })); ty += READ_MIN * 0.3; }
      T1.rows.forEach((row) => { ty += T1.size * 1.1; b.push(label(row, x + 30, ty, T1.size, { face: 'roboto-700', color: ramp('blue').text })); });
      S1.rows.forEach((row) => { ty += S1.size * 1.25; b.push(label(row, x + 30, ty, S1.size, { color: soft() })); });
      out.push(pop(g({ 'data-k': 'textbox' }, b), x + w / 2, cy + h / 2, a));
    }
    cy += h + gap;
  });
  return boxed(g({ 'data-ui': 'results' }, out), { x, y, w, h: cy - y - gap });
}

/** A terminal's lines typing in with `progress` (each line in turn, letters across its slot).
 *  Lines starting with '$ ' are commands (orange prompt), others output. Use inside appWindow
 *  kind 'terminal'. */
export function terminal(x, y, w, lines, { progress = 1, size = READ_MIN, cursor = true } = {}) {
  const sz = Math.max(READ_MIN, size);
  const out = [];
  const n = lines.length;
  let cy = y + sz;
  let caret = null;
  lines.forEach((ln, i) => {
    const a = clamp01(n * progress - i);
    if (a <= 0) return;
    const cmd = ln.startsWith('$ ');
    const body = cmd ? ln.slice(2) : ln;
    const chars = Math.round([...body].length * a);
    const shown = [...body].slice(0, chars).join('');
    let tx = x;
    if (cmd) { out.push(label('$', x, cy, sz, { face: 'roboto-700', color: ramp('orange').lit })); tx += sz * 0.9; }
    const fit = fitSize(shown || ' ', sz, w - (tx - x), 'roboto-500', READ_MIN);
    if (shown) out.push(label(shown, tx, cy, fit, { color: cmd ? T['paper-lit'] : mixPaper() }));
    caret = [tx + measure(shown, fit), cy];
    cy += sz * 1.45;
  });
  if (cursor && caret) out.push(el('rect', { x: f(caret[0] + 6), y: f(caret[1] - sz * 0.8), width: f(sz * 0.5), height: f(sz), fill: ramp('orange').lit, 'fill-opacity': 0.85 }));
  return boxed(g({ 'data-ui': 'terminal' }, out), { x, y, w, h: cy - y });
}
const mixPaper = () => T['paper-shade'] ?? T['paper-lit'];

/** A message thread inside a rect: messages [{ from, text, progress, typing }] stacked from the top,
 *  each bubble kept inside the rect (never clipped at an edge). Returns { svg, box, next }. */
export function thread(rect, messages, { size = READ_MIN, gap = 22, surface = 'glass' } = {}) {
  const out = [];
  let cy = rect.y;
  const maxW = Math.min(rect.w, rect.w * 0.86);
  messages.forEach((m) => {
    const from = m.from ?? 'user';
    const b = chatBubble(m.text ?? '', from === 'user' ? rect.x + rect.w : rect.x, cy, { from, maxW, size: Math.max(READ_MIN, m.size ?? size), progress: m.progress ?? 1, typing: m.typing ?? false, surface });
    out.push(b.svg);
    cy += b.box.h + gap;
  });
  return boxed(g({ 'data-ui': 'thread' }, out), { x: rect.x, y: rect.y, w: rect.w, h: cy - rect.y }, { next: cy });
}

// ── Match cut ─────────────────────────────────────────────────────────────────────────────
/**
 * The analogy object becoming its tech twin, about (cx, cy) within radius r. 0–0.4: A holds, then
 * darkens to its silhouette (ink); 0.4–0.6: the silhouette contracts into a glowing disc in the
 * twin's colour; 0.6–1: the twin opens out of that disc (clipped by a growing circle). `a`, `b`:
 * SVG strings (or functions of nothing). Same position, same size: the eye stays put across the cut.
 */
export function matchCut(a, b, u, { cx, cy, r = 220, color = 'orange' } = {}) {
  const A = svgOf(typeof a === 'function' ? a() : a);
  const B = svgOf(typeof b === 'function' ? b() : b);
  const e = clamp01(u);
  const R = ramp(color);
  const out = [];
  const sil = span(e, 0.15, 0.4);
  if (e < 0.6) {
    const k = 1 - 0.75 * span(e, 0.4, 0.6);
    const fid = id(`ex-sil-${Math.round(sil * 20)}`);
    const flt = sil > 0 ? el('filter', { id: fid, x: '-20%', y: '-20%', width: '140%', height: '140%' }, el('feColorMatrix', { type: 'matrix', values: `${f(1 - sil)} 0 0 0 ${f(0.09 * sil)} 0 ${f(1 - sil)} 0 0 ${f(0.09 * sil)} 0 0 ${f(1 - sil)} 0 ${f(0.09 * sil)} 0 0 0 1 0` })) : '';
    out.push(flt, g({ filter: sil > 0 ? `url(#${fid})` : undefined, opacity: f(1 - span(e, 0.5, 0.6)) }, scaleAbout(A, cx, cy, k)));
  }
  const fl = Math.sin(Math.PI * clamp01((e - 0.4) / 0.35));
  if (fl > 0) out.push(glowAt(cx, cy, r * 0.8, r * 0.8, R.glow, 0.6 * fl, 0.4), el('circle', { cx: f(cx), cy: f(cy), r: f(r * 0.18 * fl), fill: R.base, 'fill-opacity': f(0.9 * fl) }));
  if (e > 0.55) {
    const open = span(e, 0.55, 0.95);
    const cid = id(`ex-mc-${Math.round(open * 50)}-${Math.round(cx)}-${Math.round(cy)}`);
    out.push(el('clipPath', { id: cid }, el('circle', { cx: f(cx), cy: f(cy), r: f(r * 1.6 * open + 1) })));
    out.push(g({ 'clip-path': open < 1 ? `url(#${cid})` : undefined }, scaleAbout(B, cx, cy, 0.85 + 0.15 * open)));
  }
  return boxed(g({ 'data-ui': 'match-cut' }, out), { x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
}

// ── Techniques ────────────────────────────────────────────────────────────────────────────
/**
 * The diagram forms a mechanism frame may pick from (craft.md § 10: choose the form from the
 * question the beat answers). A menu, not a required header.
 */
export const TECHNIQUES = Object.freeze([
  { id: 'process', use: 'a thing moving through steps: a request, a packet, a token, a page', primitives: ['connector', 'travel', 'queue', 'fan', 'merge', 'copyOut'] },
  { id: 'before-after', use: 'a change in speed, cost, size or quality, shown on the same task twice', primitives: ['versus', 'stopwatch', 'meter', 'counter', 'appWindow'] },
  { id: 'comparison', use: 'two options or paths with different outcomes, side by side', primitives: ['versus', 'meter', 'sizeBars', 'fan'] },
  { id: 'transformation', use: 'one thing becoming another: text into tokens, a word into a vector, a file into chunks', primitives: ['tokenize', 'vectorize', 'morph', 'travel'] },
  { id: 'scale', use: 'a size, count or cost that is surprising', primitives: ['unitGrid', 'sizeBars', 'counter'] },
  { id: 'structure', use: 'parts arranged in a system: layers, a network, a stack, a map of meaning', primitives: ['layers', 'graph', 'pointMap'] },
  { id: 'timeline', use: 'order and waiting over time: latency, retries, a queue draining', primitives: ['timeline', 'stopwatch', 'queue'] },
  { id: 'cause-effect', use: 'an input that triggers a consequence: an injected line, a cache miss, a failed call', primitives: ['travel', 'docPage', 'alarm', 'ripple'] },
  { id: 'product', use: 'the real app or screen doing the job with real content', primitives: ['appWindow', 'thread', 'docPage', 'fileList', 'resultsList', 'terminal'] },
  { id: 'match-cut', use: 'bridging the analogy object to its tech twin in one continuous move', primitives: ['matchCut', 'morph'] },
]);
export const TECHNIQUE_IDS = TECHNIQUES.map((t) => t.id);

/** The technique a frame module declares (`// technique: <id> — <reason>` in its first lines),
 *  or problems when it is missing or unknown. Returns { id, reason, problems }. */
export function techniqueOf(source) {
  const head = String(source).split('\n').slice(0, 12).join('\n');
  const m = head.match(/^\s*\/\/\s*technique:\s*([a-z-]+)\s*[—–-]+\s*(.+)$/m);
  if (!m) return { id: null, reason: '', problems: ['the frame does not start with `// technique: <id> — <reason>`'] };
  if (!TECHNIQUE_IDS.includes(m[1])) return { id: m[1], reason: m[2], problems: [`unknown technique "${m[1]}" (use one of ${TECHNIQUE_IDS.join(', ')})`] };
  return { id: m[1], reason: m[2].trim(), problems: [] };
}
