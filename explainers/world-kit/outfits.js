// The Explainers world kit, outfits (hx-4, Critter 2.0; approved still 03 "drawn for the role"):
// garments built for the role, drawn soft-shaded like the body (no ink outline), wrapping the
// body's sides and base, sleeves on the arms, trousers on the legs.
//
//   outfit = { top: { kind, color, trim, neck, pocket, under, print, pattern }, sleeves, pants,
//              shoes, head: { kind, color }, items: [...], custom }
//
// HARD CONSTRAINT (EX3-103, Lucas): nothing a critter wears covers or crowds its eyes or mouth.
// Every garment and item is drawn outside FACE_KEEPOUT (a top's neckline frames the face; hats sit
// above the brows; a brim never crosses the brow line). Glasses are the one exception. On top of
// the geometry, the kit clips every worn layer (and `custom`) out of the keep-out, so even a
// one-off garment can never reach the face. tests/explainers-kit-cast.test.ts measures every
// kind and item against the zones.
//
// Everything here is a pure function of its arguments; gradients and filters get ids hashed from
// their content (scoped by draw.js `id`), so the same critter always draws the same string.

import { T, el, g, id, TONES } from './draw.js';

// Every color is a palette token (V-T1); the hx-4 tokens fall back to their own values while an
// older core.js is loaded.
const FALLBACK = { canvas: '#FFFFFF', 'paper-lit': '#FEF9F3', 'paper-shade': '#DCD5C9', 'paper-dark': '#CAC1B3', ink: '#1F1915', 'ink-lit': '#322D29', 'ink-shade': '#150E08', 'ink-dark': '#0B0401', 'text-secondary': '#525252', 'text-tertiary': '#737373', 'shadow-warm': '#3B2A16' };
const tk = (name) => T?.[name] ?? FALLBACK[name];

// ── Palette ramps ─────────────────────────────────────────────────────────────────────────
/** The palette names a garment may use (hx-4 wider palette). `white` is paper at its brightest. */
export const PALETTE = ['paper', 'white', 'ink', 'orange', 'green', 'yellow', 'blue', 'teal', 'lilac'];

// The spec's hexes (VISUAL_SYSTEM_4 §core.js), used until draw.js TONES carries the 4-step ramps.
const SPEC_RAMPS = {
  paper: { lit: '#FFFFFF', base: '#FEF9F3', shade: '#DCD5C9', dark: '#CAC1B3' },
  white: { lit: '#FFFFFF', base: '#FFFFFF', shade: '#DCD5C9', dark: '#CAC1B3' },
  ink: { lit: '#525252', base: '#322D29', shade: '#1F1915', dark: '#150E08' },
  orange: { lit: '#FF9462', base: '#FF5E1A', shade: '#E24213', dark: '#A02B02' },
  green: { lit: '#5D9831', base: '#138510', shade: '#036A29', dark: '#013D1F' },
  yellow: { lit: '#FFDFB2', base: '#F1C45E', shade: '#CFAE45', dark: '#99862B' },
  blue: { lit: '#82AFDF', base: '#5A98CB', shade: '#3E81AF', dark: '#17597B' },
  teal: { lit: '#80C7BF', base: '#57AFAF', shade: '#3D959B', dark: '#1D6972' },
  lilac: { lit: '#BF9BCE', base: '#A482BE', shade: '#886BA6', dark: '#5B4778' },
};
/** Metal (stethoscope, watch, whistle, buckle, tray): a material, not a garment color. */
const STEEL = { lit: '#FFFFFF', base: '#DCD5C9', shade: '#CAC1B3', dark: '#737373' };

// While outfitColors() draws an outfit, every palette name a garment, item or head asks for.
let COLLECT = null;

/** The 4-step ramp { lit, base, shade, dark } of a palette name: draw.js TONES when it carries
 *  the hx-4 ramps, else the spec's hexes. Unknown names throw (colors come from the palette). */
export function ramp(name) {
  if (COLLECT && name !== 'steel') COLLECT.add(name);
  if (name === 'steel') return STEEL;
  if (!SPEC_RAMPS[name]) throw new Error(`HX: outfit color "${name}" must be a palette name: ${PALETTE.join(', ')}`);
  if (name === 'white') return SPEC_RAMPS.white;
  const t = TONES?.[name];
  if (t && !Array.isArray(t) && t.base) {
    const f = SPEC_RAMPS[name];
    return { lit: t.lit ?? f.lit, base: t.base, shade: t.shade ?? f.shade, dark: t.dark ?? f.dark };
  }
  return SPEC_RAMPS[name];
}
const tok = (name, fallback) => T?.[name] ?? fallback;

// ── Content-hashed defs ───────────────────────────────────────────────────────────────────
const r2 = (v) => Math.round(v * 100) / 100;
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const stopsXml = (stops) => stops.map(([o, c, a = 1]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a === 1 ? undefined : a })).join('');

/** A bag of SVG defs for one drawing: gradients, blurs and clips, each with an id hashed from its
 *  content, so repeated critters reuse identical definitions and a frame stays a pure string. */
export function defsBag() {
  const defs = new Map();
  const put = (kind, body, make) => {
    const name = id(`k${kind}${hash(body)}`);
    if (!defs.has(name)) defs.set(name, make(name));
    return `url(#${name})`;
  };
  const bag = {
    lg: (stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => put('l', JSON.stringify([stops, x1, y1, x2, y2]), (n) => el('linearGradient', { id: n, x1, y1, x2, y2 }, stopsXml(stops))),
    rg: (stops, cx = 0.5, cy = 0.5, r = 0.5) => put('r', JSON.stringify([stops, cx, cy, r]), (n) => el('radialGradient', { id: n, cx, cy, r }, stopsXml(stops))),
    /** Blur for shapes with area (region relative to the shape's box). */
    blur: (sd) => put('b', String(sd), (n) => el('filter', { id: n, x: '-80%', y: '-80%', width: '260%', height: '260%', 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: sd }))),
    /** Blur in local units, for strokes whose box can be degenerate. */
    blurU: (sd) => put('u', String(sd), (n) => el('filter', { id: n, filterUnits: 'userSpaceOnUse', x: -320, y: -460, width: 640, height: 560, 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: sd }))),
    clip: (inner, rule) => put('c', inner + (rule ?? ''), (n) => el('clipPath', { id: n }, rule ? inner.replace('<path ', `<path clip-rule="${rule}" `) : inner)),
    raw: (kind, body, make) => put(kind, body, make),
    xml: () => (defs.size ? el('defs', {}, [...defs.values()].join('')) : ''),
  };
  return bag;
}

// ── Geometry (local critter units: feet at 0,0; body x ±66, y −142…−30) ───────────────────
/** Points along a path from `start` through segments ['L', p] | ['Q', c, p] | ['C', c1, c2, p]. */
export function trace(start, segs, n = 10) {
  const pts = [start];
  let p = start;
  for (const s of segs) {
    if (s[0] === 'L') pts.push(s[1]);
    else if (s[0] === 'Q') {
      const [, c, q] = s;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const a = (1 - t) ** 2;
        const b = 2 * t * (1 - t);
        pts.push([a * p[0] + b * c[0] + t * t * q[0], a * p[1] + b * c[1] + t * t * q[1]]);
      }
    } else if (s[0] === 'C') {
      const [, c1, c2, q] = s;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const a = (1 - t) ** 3;
        const b = 3 * (1 - t) ** 2 * t;
        const c = 3 * (1 - t) * t * t;
        const d = t ** 3;
        pts.push([a * p[0] + b * c1[0] + c * c2[0] + d * q[0], a * p[1] + b * c1[1] + c * c2[1] + d * q[1]]);
      }
    }
    p = pts[pts.length - 1];
  }
  return pts;
}
export const mirrorX = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
/** A left half (ending on x = 0) and its mirror, as one symmetric run. */
const sym = (left) => left.concat(mirrorX(left).slice(1));
const r1 = (v) => Math.round(v * 10) / 10;
export const dOf = (pts, close = true) => `M ${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L ')}${close ? ' Z' : ''}`;
const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
export function arcPts(cx, cy, rx, ry, a0, a1, n = 18) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** A band `w` wide beside a polyline (side +1 = left of the direction of travel). */
function band(pts, w, side = 1) {
  const off = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + (side * dy * w) / l, p[1] - (side * dx * w) / l];
  });
  return pts.concat(off.reverse());
}
export function boxOf(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ── The face keep-out (EX3-103) ───────────────────────────────────────────────────────────
// The face, relative to the feet at scale 1 (body top BY): eyes r 16 at (±25, BY + 44), brows
// about BY + 9…19, the mouth within ±24 (with the look shift) and BY + 76…95.
export const BY = -142;
/** The keep-outs around the face, relative to the feet at scale 1: the eyes and their brows with
 *  about 10px clear around them, and the mouth (every shape, any look) with 8px. */
export const FACE_KEEPOUT = [
  { part: 'eyes', x: -51, y: BY + 8, w: 102, h: 62 },
  { part: 'mouth', x: -32, y: BY + 68, w: 64, h: 35 },
];
/** The two zones as one outline (they overlap by 2px), for the kit's clip. */
const KEEPOUT_D = 'M -51 -134 L 51 -134 L 51 -72 L 32 -72 L 32 -39 L -32 -39 L -32 -72 L -51 -72 Z';
/** The clip every worn layer is drawn through: everything except the face keep-out. */
export const keepoutClip = (D) => D.clip(el('path', { d: `M -600 -700 L 600 -700 L 600 400 L -600 400 Z ${KEEPOUT_D}` }), 'evenodd');

// ── Soft shading: fabric, items, tubes ────────────────────────────────────────────────────
/**
 * A soft-shaded filled shape (no outline): a gradient lit from the top right, an edge falloff,
 * a form shadow low on the side away from the light, a sheen near the light. `C` is the drawing
 * context { D, L, dark, bodyClip } (L = 1, or −1 when the critter is flipped, so the light stays
 * top right on screen). `drop` casts a soft shadow on the body under it.
 */
export function softShape(C, pts, color, { drop = true, edge = 0.34, form = 0.42, sheen = 0.32, gloss = 0, flat = false } = {}) {
  const R = typeof color === 'string' ? ramp(color) : color;
  const { D, L } = C;
  const d = dOf(pts);
  const b = boxOf(pts);
  const m = Math.max(4, Math.min(b.w, b.h));
  const out = [];
  if (drop && C.bodyClip) out.push(g({ 'clip-path': C.bodyClip }, el('path', { d, fill: C.dark ? tk('ink-dark') : tk('shadow-warm'), opacity: C.dark ? 0.4 : 0.26, transform: `translate(${r2(-1.6 * L)} 2.6)`, filter: D.blur(2.4) })));
  const x1 = L > 0 ? 0.88 : 0.12;
  out.push(el('path', { d, fill: flat ? R.base : D.lg([[0, R.lit], [0.48, R.base], [1, R.shade]], x1, 0, 1 - x1, 1) }));
  const inner = [];
  if (edge) inner.push(el('path', { d, fill: 'none', stroke: R.dark, 'stroke-width': r2(Math.min(14, m * 0.34)), opacity: edge, filter: D.blur(r2(Math.max(1.2, m * 0.12))) }));
  if (form) inner.push(el('ellipse', { cx: r2(b.x + b.w * (L > 0 ? 0.18 : 0.82)), cy: r2(b.y + b.h * 0.86), rx: r2(b.w * 0.5), ry: r2(b.h * 0.42), fill: R.dark, opacity: form, filter: D.blur(r2(Math.max(1.5, m * 0.22))) }));
  if (sheen) inner.push(el('ellipse', { cx: r2(b.x + b.w * (L > 0 ? 0.8 : 0.2)), cy: r2(b.y + b.h * 0.16), rx: r2(b.w * 0.28), ry: r2(b.h * 0.2), fill: R.lit, opacity: sheen, filter: D.blur(r2(Math.max(1.2, m * 0.16))) }));
  if (gloss) inner.push(el('ellipse', { cx: r2(b.x + b.w * (L > 0 ? 0.74 : 0.26)), cy: r2(b.y + b.h * 0.2), rx: r2(b.w * 0.16), ry: r2(b.h * 0.08), fill: '#FFFFFF', opacity: gloss, filter: D.blur(r2(Math.max(0.6, m * 0.05))) }));
  if (inner.length) out.push(g({ 'clip-path': D.clip(el('path', { d })) }, inner));
  return out.join('');
}
/** A soft round tube (cord, strap, tubing) along a polyline. */
export function softLine(C, pts, w, color, { shadow = true, hi = true } = {}) {
  const R = typeof color === 'string' ? ramp(color) : color;
  const { D, L } = C;
  const d = dOf(pts, false);
  const cap = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const out = [];
  if (shadow) out.push(el('path', { d, ...cap, stroke: C.dark ? tk('ink-dark') : tk('shadow-warm'), 'stroke-width': w, opacity: C.dark ? 0.45 : 0.28, transform: `translate(${r2(-1.2 * L)} 2)`, filter: D.blurU(r2(Math.max(0.8, w * 0.3))) }));
  out.push(el('path', { d, ...cap, stroke: R.base, 'stroke-width': w }));
  out.push(el('path', { d, ...cap, stroke: R.shade, 'stroke-width': r2(w * 0.5), opacity: 0.6, transform: `translate(${r2(-0.22 * w * L)} ${r2(0.22 * w)})` }));
  if (hi) out.push(el('path', { d, ...cap, stroke: R.lit, 'stroke-width': r2(Math.max(1, w * 0.32)), opacity: 0.85, transform: `translate(${r2(0.2 * w * L)} ${r2(-0.22 * w)})` }));
  return out.join('');
}
/** A small glossy disc (button, rivet, bead, pin head). */
function stud(C, x, y, r, color) {
  const R = typeof color === 'string' ? ramp(color) : color;
  const { D, L } = C;
  return el('circle', { cx: r2(x), cy: r2(y), r, fill: D.rg([[0, R.lit], [0.5, R.base], [1, R.dark]], L > 0 ? 0.68 : 0.32, 0.3, 0.75) })
    + el('circle', { cx: r2(x + r * 0.32 * L), cy: r2(y - r * 0.34), r: r2(r * 0.3), fill: '#FFFFFF', opacity: 0.8 });
}

// ── Garments: the kinds ───────────────────────────────────────────────────────────────────
export const TOP_KINDS = ['scrubs', 'coat', 'vest', 'waistcoat', 'tee', 'cardigan', 'apron', 'jacket', 'overalls', 'uniform', 'sweater', 'dress', 'hoodie', 'none'];
export const NECKS = ['v', 'crew', 'collar', 'lapel'];
export const HEAD_KINDS = ['scrub-cap', 'chef', 'hard-hat', 'beanie', 'bandana', 'headband', 'crown', 'peaked', 'headphones', 'none'];
export const ITEMS = ['stethoscope', 'badge', 'lanyard', 'fob-watch', 'pen', 'heart-pin', 'bowtie', 'tie', 'towel', 'tray', 'earpiece', 'wristband', 'glasses', 'glasses-chain', 'clipboard', 'name-tag', 'whistle', 'tool-belt', 'apron-pocket', 'scarf'];
/** Items that sit on the eyes, by design (EX3-103's one exception). */
export const ON_EYES = ['glasses'];

// Per kind: neckline, whether the front is open, hem, flare, default sleeves (short/long/none),
// whether trousers default to the top's color.
const KIND = {
  scrubs: { neck: 'v', open: false, hem: -16, flare: 3, sleeve: 'short', pants: true, pocket: true },
  coat: { neck: 'lapel', open: true, hem: -2, flare: 7, sleeve: 'long' },
  vest: { neck: 'crew', open: true, hem: -17, flare: 3, sleeve: 'none' },
  waistcoat: { neck: 'crew', open: true, hem: -16, flare: 2, sleeve: 'none', points: true },
  tee: { neck: 'crew', open: false, hem: -17, flare: 4, sleeve: 'short' },
  cardigan: { neck: 'crew', open: true, hem: -14, flare: 5, sleeve: 'long' },
  apron: { neck: 'crew', open: false, hem: -2, flare: 0, sleeve: 'none', bib: true, pocket: true },
  jacket: { neck: 'lapel', open: true, hem: -17, flare: 4, sleeve: 'long' },
  overalls: { neck: 'crew', open: false, hem: -16, flare: 2, sleeve: 'none', bib: true, pants: true },
  uniform: { neck: 'collar', open: false, hem: -17, flare: 3, sleeve: 'long' },
  sweater: { neck: 'crew', open: false, hem: -15, flare: 5, sleeve: 'long' },
  dress: { neck: 'crew', open: false, hem: -5, flare: 12, sleeve: 'short' },
  hoodie: { neck: 'crew', open: false, hem: -15, flare: 5, sleeve: 'long' },
  none: { neck: 'crew', open: false, hem: -16, flare: 0, sleeve: 'none' },
};
// A top's color when the storyboard names none: a white coat and a white apron read as their job;
// the apron must not default into the scrubs palette.
const DEFAULT_COLOR = { coat: 'white', apron: 'white' };

// ── Role clarity: what a costume reads as (principles §2 "Costume says the job") ──────────
/** The colors a stranger reads as medical scrubs when they are a top or long sleeves. */
export const SCRUB_COLORS = ['teal', 'green', 'blue', 'lilac'];
/** What each top kind reads as on its own, and what it collides with. */
export const TOP_READS = {
  scrubs: { reads: 'medical: nurse, surgeon, vet', avoid: 'anything non-medical' },
  coat: { reads: 'doctor, scientist, pharmacist (white); else an overcoat', avoid: 'non-white for a lab or clinic role' },
  vest: { reads: 'a worker on site (hi-vis yellow) or a waiter', avoid: '' },
  waistcoat: { reads: 'waiter, bartender, a formal host', avoid: '' },
  tee: { reads: 'everyday: a student, a customer, a user', avoid: '' },
  cardigan: { reads: 'teacher, librarian, grandparent', avoid: '' },
  apron: { reads: 'kitchen: cook, baker, barista, shop clerk', avoid: 'scrub-colored sleeves or under-top (reads as medical scrubs)' },
  jacket: { reads: 'office, manager, salesperson', avoid: '' },
  overalls: { reads: 'mechanic, farmer, painter, builder', avoid: '' },
  uniform: { reads: 'pilot, guard, officer, conductor', avoid: '' },
  sweater: { reads: 'everyday at home, a parent', avoid: '' },
  dress: { reads: 'everyday, a host, a singer', avoid: '' },
  hoodie: { reads: 'a developer, a student, a gamer', avoid: '' },
  none: { reads: 'a plain critter: no role', avoid: '' },
};
/**
 * A starting outfit per common role: the one or two garments a stranger links to the job. Copy
 * and adjust; `reads` is the hint the outfit should pass, `avoid` the costume it must not become.
 */
export const ROLE_GUIDE = {
  cook: { outfit: { top: { kind: 'apron', color: 'white', trim: 'ink' }, head: { kind: 'chef' } }, reads: 'kitchen', avoid: 'scrubs (no teal/green/blue sleeves under the apron); a full white under-top reads as a lab coat' },
  barista: { outfit: { top: { kind: 'apron', color: 'ink', trim: 'yellow', under: 'white' } }, reads: 'café', avoid: 'scrubs' },
  baker: { outfit: { top: { kind: 'apron', color: 'paper', trim: 'yellow', under: 'white' }, head: { kind: 'bandana', color: 'yellow' } }, reads: 'bakery', avoid: 'scrubs' },
  doctor: { outfit: { top: { kind: 'coat', color: 'white', under: 'blue' }, items: ['stethoscope'] }, reads: 'clinic', avoid: 'a kitchen apron' },
  nurse: { outfit: { top: { kind: 'scrubs', color: 'teal' }, items: ['fob-watch'] }, reads: 'hospital', avoid: 'an apron' },
  scientist: { outfit: { top: { kind: 'coat', color: 'white', under: 'ink' }, items: ['glasses', 'badge'] }, reads: 'lab', avoid: '' },
  builder: { outfit: { top: { kind: 'vest', color: 'yellow', under: 'blue' }, head: { kind: 'hard-hat' }, items: ['tool-belt'] }, reads: 'site', avoid: '' },
  mechanic: { outfit: { top: { kind: 'overalls', color: 'blue', under: 'white' }, items: ['towel'] }, reads: 'garage', avoid: '' },
  waiter: { outfit: { top: { kind: 'waistcoat', color: 'ink', under: 'white' }, items: ['bowtie', 'tray'] }, reads: 'restaurant', avoid: '' },
  teacher: { outfit: { top: { kind: 'cardigan', color: 'green', under: 'white' }, items: ['glasses'] }, reads: 'school', avoid: '' },
  office: { outfit: { top: { kind: 'jacket', color: 'blue', under: 'white' }, items: ['lanyard'] }, reads: 'office', avoid: '' },
  developer: { outfit: { top: { kind: 'hoodie', color: 'lilac' }, head: { kind: 'headphones' } }, reads: 'tech', avoid: '' },
};

/**
 * What an outfit reads as, and the role collisions in it (principles §2). Pure; for storyboard
 * checks: `clashes` lists the readings a stranger would get that the top's own role does not want.
 * @param {object | null | 'none'} outfit
 * @returns {{ kind: string, reads: string, clashes: string[] }}
 */
export function outfitReads(outfit) {
  const o = normalizeOutfit(outfit);
  if (!o) return { kind: 'none', reads: TOP_READS.none.reads, clashes: [] };
  const t = o.top;
  const clashes = [];
  const arms = [o.sleeves, t.under].filter(Boolean);
  if (t.kind === 'apron' && arms.some((c) => SCRUB_COLORS.includes(c))) clashes.push(`an apron over ${arms.find((c) => SCRUB_COLORS.includes(c))} sleeves reads as medical scrubs, not a kitchen`);
  if (t.kind === 'apron' && SCRUB_COLORS.includes(t.color) && t.color === o.pants) clashes.push('an apron matching its trousers in a scrubs color reads as scrubs');
  if (t.kind === 'scrubs' && ['chef', 'hard-hat'].includes(o.head.kind)) clashes.push(`scrubs under a ${o.head.kind} hat mixes two jobs`);
  if (t.kind === 'coat' && t.color !== 'white' && o.items.includes('stethoscope')) clashes.push('a doctor reads from a white coat; a colored coat with a stethoscope reads as a costume');
  return { kind: t.kind, reads: TOP_READS[t.kind].reads, clashes };
}

// Orange is only ever the hero's body (EX3-139): no head, item or default detail is orange.
const HEAD_COLOR = { 'scrub-cap': null, chef: 'white', 'hard-hat': 'yellow', beanie: 'teal', bandana: 'blue', headband: 'paper', crown: 'yellow', peaked: 'ink', headphones: 'teal', none: null };

/**
 * An outfit with every default filled in and every name checked: unknown kinds, necks, items or
 * colors throw with the allowed list (a storyboard typo is caught, never drawn as nothing).
 */
export const isNoOutfit = (outfit) => outfit === null || outfit === undefined || outfit === false || outfit === 'none';
export function normalizeOutfit(outfit) {
  if (isNoOutfit(outfit)) return null;
  if (typeof outfit !== 'object') throw new Error('HX: outfit must be { top, sleeves, pants, shoes, head, items, custom }');
  const top0 = outfit.top ?? { kind: 'none' };
  const kind = top0.kind ?? 'none';
  if (!KIND[kind]) throw new Error(`HX: outfit top.kind "${kind}" must be one of ${TOP_KINDS.join(', ')}`);
  const K = KIND[kind];
  const color = top0.color ?? DEFAULT_COLOR[kind] ?? 'blue';
  const neck = top0.neck ?? K.neck;
  if (!NECKS.includes(neck)) throw new Error(`HX: outfit top.neck "${neck}" must be one of ${NECKS.join(', ')}`);
  for (const v of [color, top0.trim, top0.under]) if (v) ramp(v);
  const top = { kind, color, trim: top0.trim ?? null, neck, pocket: top0.pocket ?? K.pocket ?? false, under: top0.under ?? null, print: top0.print ?? null, pattern: top0.pattern ?? null };
  if (top.pocket && top.pocket !== true) ramp(top.pocket);
  if (top.pattern && top.pattern !== 'stripes') throw new Error(`HX: outfit top.pattern "${top.pattern}" must be "stripes"`);
  if (top.print && (typeof top.print !== 'string' || top.print.length > 10)) throw new Error('HX: outfit top.print is a short word (10 letters at most)');
  // 4.2: a top always sleeves its arms in the outfit's colour, so an arm over the torso reads as
  // part of the outfit (a sleeveless top: its under-layer's colour, else short sleeves of its own)
  const capSleeve = K.sleeve === 'none' && !top.under && outfit.sleeves === undefined;
  const sleeveDefault = kind === 'none' ? false : K.sleeve === 'none' ? top.under ?? color : color;
  const sleeves = outfit.sleeves === undefined ? sleeveDefault : outfit.sleeves;
  const pants = outfit.pants === undefined ? (K.pants ? color : false) : outfit.pants;
  const shoes = outfit.shoes === undefined ? false : outfit.shoes;
  for (const [k, v] of [['sleeves', sleeves], ['pants', pants], ['shoes', shoes]]) {
    if (v !== false && v !== null) try { ramp(v); } catch { throw new Error(`HX: outfit ${k} "${v}" must be a palette name (${PALETTE.join(', ')}) or false`); }
  }
  const h0 = outfit.head ?? { kind: 'none' };
  const hk = typeof h0 === 'string' ? h0 : h0.kind ?? 'none';
  if (!HEAD_KINDS.includes(hk)) throw new Error(`HX: outfit head.kind "${hk}" must be one of ${HEAD_KINDS.join(', ')}`);
  const head = { kind: hk, color: (typeof h0 === 'object' ? h0.color : null) ?? HEAD_COLOR[hk] ?? color };
  if (hk !== 'none') ramp(head.color);
  const items = [...new Set([].concat(outfit.items ?? []))];
  for (const it of items) if (!ITEMS.includes(it)) throw new Error(`HX: outfit item "${it}" must be one of ${ITEMS.join(', ')}`);
  if (outfit.custom !== undefined && outfit.custom !== null && typeof outfit.custom !== 'function') throw new Error('HX: outfit.custom must be a function ({ by, fill, tones, keepout }) => SVG');
  return { top, sleeves: sleeves || false, sleeveLen: K.sleeve === 'short' || capSleeve ? 'short' : 'long', pants: pants || false, shoes: shoes || false, head, items, custom: outfit.custom ?? null };
}

/** A short, stable, quote-free key for an outfit (for lookKey / data-look). */
export function outfitKey(outfit) {
  const o = normalizeOutfit(outfit);
  if (!o) return '';
  const t = o.top;
  const top = [t.kind, t.color, t.trim && `trim-${t.trim}`, t.neck, t.pocket && `pocket${t.pocket === true ? '' : `-${t.pocket}`}`, t.under && `under-${t.under}`, t.print && `print-${t.print.replace(/[^A-Za-z0-9]/g, '')}`, t.pattern].filter(Boolean).join('.');
  const parts = [`top=${top}`, `sleeves=${o.sleeves || 'no'}`, `pants=${o.pants || 'no'}`, `shoes=${o.shoes || 'no'}`, `head=${o.head.kind}${o.head.kind !== 'none' ? `.${o.head.color}` : ''}`, `items=${[...o.items].sort().join('+')}`];
  if (o.custom) parts.push(`custom=${hash(String(o.custom))}`);
  return parts.join(';');
}

// ── Necklines and silhouettes ─────────────────────────────────────────────────────────────
// The left half of each neckline, from the inner shoulder down round the face to x = 0. Every one
// stays outside FACE_KEEPOUT: above y −72 it keeps |x| > 53; from −72 to −39 it keeps |x| > 34.
const NECK_SIDE = [['C', [-55, -74], [-50, -56], [-42, -44]]];
const NECK_L = {
  crew: trace([-58, -93], [...NECK_SIDE, ['C', [-34, -35], [-20, -31], [0, -31]]]),
  collar: trace([-58, -93], [...NECK_SIDE, ['C', [-34, -35], [-20, -31], [0, -31]]]),
  v: trace([-58, -93], [...NECK_SIDE, ['C', [-35, -36], [-16, -29], [0, -22]]]),
  lapel: trace([-58, -93], [...NECK_SIDE, ['C', [-35, -36], [-16, -29], [0, -22]]]),
};
const NECK_SIDE_ONLY = trace([-58, -93], NECK_SIDE);
/** Left side, outer edge, from the outer shoulder down to the hem corner. */
const sideL = (hem, flare) => trace([-67.5, -99], [['C', [-69.6, -82], [-70.2, -54], [-69.6 - flare * 0.35, -40]], ['C', [-69.2 - flare * 0.8, -28], [-68 - flare, hem + 1], [-59 - flare, hem]]]);
/** A closed top: shoulders, the neckline round the face, the sides, the hem. */
function topOutline(neck, hem, flare) {
  const n = sym(NECK_L[neck] ?? NECK_L.crew);
  const left = sideL(hem, flare); // outer shoulder → hem corner (left)
  const right = left.map(([x, y]) => [-x, y]); // outer shoulder → hem corner (right)
  return [[-67.5, -99], ...n, ...right, ...left.slice().reverse().slice(0, -1)];
}
/** An open-front panel (left), from the outer shoulder round the neck and down the front edge. */
function panelL(hem, flare, { points = false } = {}) {
  const front = points
    ? [[-24, -34], [-9, -25], [-8, hem + 4], [-34, hem - 1], [-58 - flare, hem]]
    : [[-31, -33], [-12, hem]];
  const side = sideL(hem, flare).slice().reverse();
  return [[-67.5, -99], ...NECK_SIDE_ONLY, ...front, ...side.slice(points ? 1 : 0, -1)];
}
const mirrorPanel = (pts) => pts.map(([x, y]) => [-x, y]);

// ── Tops ──────────────────────────────────────────────────────────────────────────────────
/** A top: { shapes, svg } — shapes are the silhouettes (for the keep-out test), svg the drawing. */
function drawTop(C, o) {
  const t = o.top;
  const K = KIND[t.kind];
  const shapes = [];
  const out = [];
  if (t.kind === 'none') return { shapes, svg: '' };
  const R = ramp(t.color);
  const trim = t.trim ? ramp(t.trim) : null;
  const add = (part, pts, color, opts) => {
    shapes.push({ part, pts });
    out.push(softShape(C, pts, color, opts));
  };
  const stripes = (pts) => {
    if (t.pattern !== 'stripes') return;
    const b = boxOf(pts);
    const lines = [];
    for (let x = -84; x <= 84; x += 14) lines.push(el('rect', { x, y: b.y - 4, width: 7, height: b.h + 8, fill: (trim ?? ramp('ink')).base, opacity: 0.92 }));
    out.push(g({ 'clip-path': C.D.clip(el('path', { d: dOf(pts) })) }, lines.join('') + el('path', { d: dOf(pts), fill: 'none', stroke: tk('shadow-warm'), 'stroke-width': 10, opacity: 0.2, filter: C.D.blur(4) })));
  };
  const hem = K.hem;
  const flare = K.flare;
  // A shirt or tee under an open front, an apron or overalls.
  if (t.under && (K.open || K.bib)) add('under', topOutline('crew', -16, 3), t.under, { form: 0.3 });
  if (K.bib) {
    // apron or overalls: a bib below the mouth, straps up the body's sides
    const long = t.kind === 'apron';
    const bib = long
      ? [[-27, -31], [27, -31], [31, -24], [47, -21], [50, -2], [-50, -2], [-47, -21], [-31, -24]]
      : [[-29, -31], [29, -31], [31, -24], [62, -24], [64, -16], [-64, -16], [-62, -24], [-31, -24]];
    if (long) {
      // A kitchen apron: a small bib under the mouth, a waist band tied in a bow at the hip with
      // two tails, a skirt over the legs and a front pocket. No shoulder straps: on a critter they
      // run up the body's sides and read as tubing (a hospital line), not as an apron.
      const tie = trim ? t.trim : t.color;
      const top = [[-24, -37], [24, -37], [27, -27], [-27, -27]];
      const skirt = [[-50, -27], [50, -27], [53, -2], [0, 1], [-53, -2]];
      add('bib', top, t.color, { form: 0.3 });
      add('bib', skirt, t.color, { form: 0.36 });
      out.push(el('path', { d: 'M -20 -34.5 L 20 -34.5', stroke: R.dark, 'stroke-width': 1.2, 'stroke-dasharray': '2.5 2.5', opacity: 0.55 }));
      const band = [[-62, -31], [62, -31], [62, -24], [-62, -24]];
      shapes.push({ part: 'apron-tie', pts: band });
      out.push(softShape(C, band, tie, { drop: true, form: 0.25, sheen: 0.4 }));
      // the bow at the right hip and its two tails
      const bow = [[[46, -28], [36, -36], [36, -20]], [[46, -28], [58, -36], [58, -20]]];
      for (const loop of bow) out.push(softShape(C, loop, tie, { drop: false, form: 0.2 }));
      shapes.push({ part: 'apron-tie', line: [[46, -27], [42, -6], [52, -4]], w: 4 });
      out.push(softLine(C, [[46, -27], [42, -8]], 4, tie), softLine(C, [[47, -27], [53, -6]], 4, tie));
      out.push(stud(C, 46, -28, 3.4, tie));
      if (t.pocket) {
        const pk = [[-20, -20], [20, -20], [19, -6], [-19, -6]];
        shapes.push({ part: 'pocket', pts: pk });
        out.push(softShape(C, pk, t.pocket === true ? t.color : t.pocket, { drop: true, form: 0.32 }));
        out.push(el('path', { d: 'M 0 -20 L 0 -6', stroke: R.dark, 'stroke-width': 1.2, opacity: 0.5 }));
      }
      return { shapes, svg: out.join('') };
    }
    const strapL = trace([-26, -30], [['L', [-46, -40]], ['C', [-58, -54], [-62, -76], [-65, -98]]]);
    for (const s of [strapL, strapL.map(([x, y]) => [-x, y])]) {
      shapes.push({ part: 'strap', line: s, w: 7 });
      out.push(softLine(C, s, 7, trim ? t.trim : t.color));
    }
    add('bib', bib, t.color, { form: 0.36 });
    out.push(stud(C, -22, -26.5, 2.8, 'steel'), stud(C, 22, -26.5, 2.8, 'steel'));
    out.push(el('path', { d: 'M -22 -21 L 22 -21', stroke: R.dark, 'stroke-width': 1.2, 'stroke-dasharray': '2.5 2.5', opacity: 0.6 }));
    if (t.pocket) out.push(softShape(C, [[-14, -16], [14, -16], [13, -6], [-13, -6]], t.pocket === true ? t.color : t.pocket, { drop: false, form: 0.3 }));
    return { shapes, svg: out.join('') };
  }
  if (K.open) {
    const pl = panelL(hem, flare, { points: K.points });
    const pr = mirrorPanel(pl);
    add('panel-l', pl, t.color);
    add('panel-r', pr, t.color);
    stripes(pl);
    stripes(pr);
    // lapels: the folded-back front edge, a shade darker, with a notch
    if (t.neck === 'lapel') {
      // a band along the front edge, on the panel, widening toward the notch
      const edge = [...NECK_SIDE_ONLY.slice(2), [-31, -33]];
      const lap = band(edge, 9, -1);
      for (const p of [lap, lap.map(([x, y]) => [-x, y])]) {
        shapes.push({ part: 'lapel', pts: p });
        out.push(softShape(C, p, trim ? t.trim : { lit: R.base, base: R.shade, shade: R.dark, dark: R.dark }, { drop: false, form: 0.2, sheen: 0.4 }));
      }
    }
    if (t.neck === 'collar') {
      const col = [[-58, -95], [-55.5, -78], [-51, -62], [-61, -68], [-67, -86]];
      for (const p of [col, col.map(([x, y]) => [-x, y])]) {
        shapes.push({ part: 'collar', pts: p });
        out.push(softShape(C, p, trim ? t.trim : t.color, { form: 0.2, sheen: 0.45 }));
      }
    }
    if (t.kind === 'vest') {
      // reflective bands across both panels
      for (const y of [-58, -38]) {
        const bandL = [[-71, y], [-38, y], [-36, y + 6], [-71, y + 6]];
        const clipL = C.D.clip(el('path', { d: dOf(pl) }) + el('path', { d: dOf(pr) }));
        out.push(g({ 'clip-path': clipL }, [bandL, bandL.map(([x, yy]) => [-x, yy])].map((b) => el('path', { d: dOf(b), fill: (trim ?? ramp('paper')).base }) + el('path', { d: dOf(b), fill: '#FFFFFF', opacity: 0.35, transform: 'translate(0 -1.5)' })).join('')));
      }
    }
    if (t.kind === 'cardigan' || t.kind === 'jacket' && t.neck !== 'lapel') {
      // a button band down each front edge
      const bandPts = [[-42, -45], [-31, -33], [-12, hem]];
      for (const side of [1, -1]) {
        const p = band(bandPts.map(([x, y]) => [x * side, y]), 4, -side);
        shapes.push({ part: 'button-band', pts: p });
        out.push(el('path', { d: dOf(p), fill: (trim ?? R).shade ?? R.shade, opacity: 0.9 }));
      }
      if (t.kind === 'cardigan') for (const [x, y] of [[-30, -28], [-22, -20]]) out.push(stud(C, x, y, 2.6, t.trim ?? 'ink'), stud(C, -x, y, 2.6, t.trim ?? 'ink'));
    }
    if (t.kind === 'waistcoat') for (const [x, y] of [[-20, -30], [-14, -22]]) out.push(stud(C, x, y, 2.4, t.trim ?? 'paper'));
    if (t.kind === 'coat') {
      // hip pockets
      for (const s of [1, -1]) out.push(el('path', { d: `M ${s * -62} -20 L ${s * -40} -20`, stroke: R.dark, 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.55 }));
    }
    if (t.kind === 'jacket' || t.kind === 'cardigan') {
      // a ribbed hem band
      const rib = [[-72, hem - 6], [72, hem - 6], [72, hem], [-72, hem]];
      out.push(g({ 'clip-path': C.D.clip(el('path', { d: dOf(pl) }) + el('path', { d: dOf(pr) })) }, el('path', { d: dOf(rib), fill: (trim ?? R).shade ?? R.shade, opacity: 0.85 }) + Array.from({ length: 15 }, (_, i) => el('path', { d: `M ${-70 + i * 10} ${hem - 6} L ${-70 + i * 10} ${hem}`, stroke: R.dark, 'stroke-width': 1.2, opacity: 0.35 })).join('')));
    }
  } else {
    const pts = topOutline(t.neck, hem, flare);
    add('top', pts, t.color);
    stripes(pts);
    const n = sym(NECK_L[t.neck] ?? NECK_L.crew);
    if (trim && ['scrubs', 'tee', 'sweater', 'dress', 'hoodie'].includes(t.kind)) {
      // neckline trim: a band just inside the neckline, on the garment
      const tb = band(n, 5.5, -1);
      shapes.push({ part: 'trim', pts: tb });
      out.push(el('path', { d: dOf(tb), fill: trim.base }) + el('path', { d: dOf(n, false), fill: 'none', stroke: '#FFFFFF', 'stroke-width': 1.4, opacity: 0.45, transform: 'translate(0 1.4)' }));
    } else {
      // the fabric's lip catching the light along the neckline
      out.push(el('path', { d: dOf(n, false), fill: 'none', stroke: R.dark, 'stroke-width': 2.4, opacity: 0.45, transform: 'translate(0 2.2)' }));
      out.push(el('path', { d: dOf(n, false), fill: 'none', stroke: R.lit, 'stroke-width': 1.4, opacity: 0.8, transform: 'translate(0 0.8)' }));
    }
    if (t.neck === 'collar') {
      const col = [[-44, -46], [-34, -36], [-22, -32], [-6, -31], [-22, -24], [-36, -28]];
      for (const p of [col, col.map(([x, y]) => [-x, y])]) {
        shapes.push({ part: 'collar', pts: p });
        out.push(softShape(C, p, trim ? t.trim : t.color, { form: 0.22, sheen: 0.5 }));
      }
    }
    if (t.neck === 'lapel') {
      // lapels along the V, on the garment
      const lap = band(NECK_L.v.filter(([x, y]) => y > -66 && x < -6), 8, -1);
      for (const p of [lap, lap.map(([x, y]) => [-x, y])]) {
        shapes.push({ part: 'lapel', pts: p });
        out.push(softShape(C, p, trim ? t.trim : { lit: R.base, base: R.shade, shade: R.dark, dark: R.dark }, { drop: false, form: 0.2 }));
      }
    }
    if (t.kind === 'uniform') {
      // placket and buttons, epaulettes
      out.push(el('path', { d: `M 0 -30 L 0 ${hem}`, stroke: R.dark, 'stroke-width': 1.6, opacity: 0.5 }));
      out.push(stud(C, 0, -24, 2.3, t.trim ?? 'paper'));
      for (const s of t.trim ? [1, -1] : []) {
        const ep = [[s * -58, -96], [s * -68, -100], [s * -69, -92], [s * -59, -89]];
        shapes.push({ part: 'epaulette', pts: ep });
        out.push(softShape(C, s > 0 ? ep : ep.slice().reverse(), t.trim ?? 'yellow', { drop: false, form: 0.2 }));
      }
    }
    if (t.kind === 'sweater' || t.kind === 'hoodie') {
      const rib = [[-76, hem - 7], [76, hem - 7], [76, hem], [-76, hem]];
      out.push(g({ 'clip-path': C.D.clip(el('path', { d: dOf(pts) })) }, el('path', { d: dOf(rib), fill: (trim ?? R).shade ?? R.shade, opacity: 0.8 }) + Array.from({ length: 16 }, (_, i) => el('path', { d: `M ${-75 + i * 10} ${hem - 7} L ${-75 + i * 10} ${hem}`, stroke: R.dark, 'stroke-width': 1.3, opacity: 0.4 })).join('')));
    }
    if (t.kind === 'hoodie') {
      // drawstrings and the kangaroo pocket
      for (const s of [1, -1]) {
        shapes.push({ part: 'drawstring', line: [[s * 14, -31], [s * 15, -20]], w: 2.6 });
        out.push(softLine(C, [[s * 14, -31], [s * 15, -20]], 2.6, t.trim ?? 'paper'));
      }
      const kp = [[-30, -28], [30, -28], [36, hem - 7], [-36, hem - 7]];
      shapes.push({ part: 'kangaroo-pocket', pts: kp });
      out.push(softShape(C, kp, t.color, { form: 0.25, sheen: 0.2 }));
    }
    if (t.kind === 'dress') out.push(el('path', { d: 'M -70 -26 Q 0 -20 70 -26', fill: 'none', stroke: (trim ?? R).dark ?? R.dark, 'stroke-width': 2.4, opacity: 0.55 }));
    if (t.print && ['crew', 'collar'].includes(t.neck)) {
      out.push(el('text', { x: 0, y: -19.5, 'text-anchor': 'middle', 'font-family': 'Pragmatica, Roboto, sans-serif', 'font-weight': 700, 'font-size': 9.5, 'letter-spacing': 1.4, fill: (trim ?? (R === ramp('ink') ? ramp('paper') : ramp('paper'))).base }, t.print.toUpperCase()));
    }
  }
  if (t.pocket) {
    // a chest pocket on the right side, on the garment
    const pk = [[47, -51], [63, -53], [64, -38], [48, -37]];
    shapes.push({ part: 'pocket', pts: pk });
    out.push(softShape(C, pk, t.pocket === true ? t.color : t.pocket, { form: 0.3, sheen: 0.25 }));
    out.push(el('path', { d: 'M 47.5 -48 L 63.3 -50', stroke: R.dark, 'stroke-width': 1.3, opacity: 0.5 }));
  }
  return { shapes, svg: out.join('') };
}

/** The hood, drawn behind the body: a soft rim round the crown and shoulders. */
function drawBehind(C, o) {
  if (o.top.kind !== 'hoodie') return '';
  const ring = [...arcPts(0, -92, 78, 62, 180, 360, 30)].concat([[78, -64], [-78, -64]]);
  return softShape(C, ring, { ...ramp(o.top.color), lit: ramp(o.top.color).base }, { drop: false, form: 0.5, sheen: 0.18 });
}

// ── Sleeves, trousers, shoes ──────────────────────────────────────────────────────────────
/** The keep-out as polygons, for the sleeve test below. */
function nearKeepout(p, r) {
  return FACE_KEEPOUT.some((z) => p[0] > z.x - r && p[0] < z.x + z.w + r && p[1] > z.y - r && p[1] < z.y + z.h + r);
}
/**
 * A sleeve along an arm (quadratic shoulder → hand). Short or long; on an arm drawn over the body
 * it leaves out only the stretch near the face (EX3-103). Returns { shape, svg }.
 */
export function drawSleeve(C, o, [x0, y0, cx, cy, x1, y1], { front = false } = {}) {
  if (!o.sleeves) return { shape: null, svg: '' };
  const want = o.sleeveLen === 'short' ? 0.36 : 0.84;
  const w = 25;
  // the sleeve runs the arm's whole length in every pose; on an arm drawn over the body it skips only
  // the stretch near the face (EX3-103), so a pose change never strips the sleeve (a sleeve that comes
  // and goes reads as a glitch)
  const runs = [[]];
  for (let k = 0; k <= 40; k++) {
    const t = (k / 40) * want;
    const p = [(1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1];
    if (front && nearKeepout(p, w / 2 + 1.5)) {
      if (runs[runs.length - 1].length) runs.push([]);
      continue;
    }
    runs[runs.length - 1].push(p);
  }
  const kept = runs.filter((r) => r.length >= 3);
  if (!kept.length) return { shape: null, svg: '' };
  const R = ramp(o.sleeves);
  const { D, L } = C;
  const cap = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const piece = (pts) => {
    const d = dOf(pts, false);
    const e = pts[pts.length - 1];
    const p = pts[pts.length - 3];
    const len = Math.hypot(e[0] - p[0], e[1] - p[1]) || 1;
    const nx = (-(e[1] - p[1]) / len) * (w / 2);
    const ny = ((e[0] - p[0]) / len) * (w / 2);
    return [
      el('path', { d, ...cap, stroke: R.shade, 'stroke-width': w }),
      el('path', { d, ...cap, stroke: R.base, 'stroke-width': w - 6, transform: `translate(${r2(0.8 * L)} -1.5)` }),
      el('path', { d, ...cap, stroke: R.lit, 'stroke-width': 8, opacity: 0.85, transform: `translate(${r2(1.4 * L)} -5)`, filter: D.blurU(2) }),
      el('path', { d, ...cap, stroke: R.dark, 'stroke-width': 6, opacity: 0.35, transform: `translate(${r2(-1 * L)} 6)`, filter: D.blurU(2) }),
      // the cuff: a soft seam where the sleeve ends
      el('path', { d: `M ${r2(e[0] - nx)} ${r2(e[1] - ny)} L ${r2(e[0] + nx)} ${r2(e[1] + ny)}`, stroke: R.dark, 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.45 }),
    ].join('');
  };
  const longest = kept.reduce((m, r) => (r.length > m.length ? r : m), kept[0]);
  return { shape: { part: 'sleeve', line: longest, w, lines: kept }, svg: kept.map(piece).join('') };
}
/** Trousers and shoes on one leg, in the leg's own frame (x = leg left, legLen). */
export function drawLeg(C, o, x, legLen) {
  const { D, L } = C;
  const out = [];
  if (o.pants) {
    const R = ramp(o.pants);
    const h = legLen - (o.shoes ? 6 : 2);
    out.push(el('rect', { x: r2(x - 1.5), y: -37, width: 24, height: h + 1, rx: 8, fill: D.lg(L > 0 ? [[0, R.dark], [0.5, R.base], [1, R.lit]] : [[0, R.lit], [0.5, R.base], [1, R.dark]], 0, 0, 1, 0) }));
    out.push(el('rect', { x: r2(x + (L > 0 ? 13 : 3)), y: -32, width: 5, height: r2(h - 8), rx: 2.5, fill: '#FFFFFF', opacity: 0.25, filter: D.blur(1.4) }));
  }
  if (o.shoes) {
    const R = ramp(o.shoes);
    const y = legLen - 34;
    const d = `M ${x - 3} ${y + 3} L ${x - 3} ${y - 3} Q ${x - 3} ${y - 10} ${x + 5} ${y - 10} L ${x + 17} ${y - 10} Q ${x + 25} ${y - 10} ${x + 25} ${y - 2} L ${x + 25} ${y + 3} Z`;
    out.push(el('path', { d, fill: D.lg([[0, R.lit], [0.55, R.base], [1, R.shade]], L > 0 ? 0.8 : 0.2, 0, L > 0 ? 0.2 : 0.8, 1) }));
    out.push(el('path', { d: `M ${x - 2} ${y + 1.5} L ${x + 24} ${y + 1.5}`, stroke: R.dark, 'stroke-width': 2.5, opacity: 0.5 }));
    out.push(el('ellipse', { cx: x + (L > 0 ? 15 : 7), cy: y - 7, rx: 5, ry: 1.8, fill: '#FFFFFF', opacity: 0.7 }));
  }
  return out.join('');
}

// ── Head kinds (hats sit on the crown, above the brows) ───────────────────────────────────
// The hat line: hugs the crown and stays above the brow keep-out (y ≤ −136 while |x| < 51).
const HAT_LINE = [[-63, -122], [-59, -129], [-55, -133], [-51, -136.5], [-40, -139.5], [-20, -141], [0, -141.5], [20, -141], [40, -139.5], [51, -136.5], [55, -133], [59, -129], [63, -122]];
const up = (pts, dy) => pts.map(([x, y]) => [x, y - dy]);
function drawHead(C, o) {
  const h = o.head;
  const shapes = [];
  const out = [];
  if (h.kind === 'none') return { shapes, svg: '' };
  const R = ramp(h.color);
  const add = (part, pts, color, opts) => {
    shapes.push({ part, pts });
    out.push(softShape(C, pts, color, { drop: false, ...opts }));
  };
  const dome = (top, wide = 1) => [...HAT_LINE, ...trace([63, -122], [['C', [70 * wide, -160], [40, top], [0, top]], ['C', [-40, top], [-70 * wide, -160], [-63, -122]]]).slice(1, -1)];
  switch (h.kind) {
    case 'scrub-cap': {
      add('cap', dome(-188), h.color, { form: 0.3, sheen: 0.35 });
      const cuff = [...HAT_LINE, ...up(HAT_LINE, 10).reverse()];
      add('cap-band', cuff, { ...R, base: R.shade, lit: R.base }, { form: 0.15, sheen: 0.25 });
      out.push(softLine(C, [[-62, -128], [-76, -118], [-80, -104]], 4, h.color), softLine(C, [[-62, -128], [-74, -132], [-84, -124]], 4, h.color));
      break;
    }
    case 'chef': {
      const bandP = [...HAT_LINE.slice(2, -2), ...up(HAT_LINE.slice(2, -2), 30).reverse()];
      const puffs = [...arcPts(-30, -192, 30, 28, 140, 300, 14), ...arcPts(0, -206, 34, 30, 200, 340, 14), ...arcPts(30, -192, 30, 28, 240, 400, 14), [50, -168], [-50, -168]];
      add('chef-top', puffs, h.color, { form: 0.28, sheen: 0.5, edge: 0.25 });
      for (const [cx, cy] of [[-30, -190], [30, -190]]) out.push(el('path', { d: `M ${cx - 2} ${cy + 22} Q ${cx + 4} ${cy} ${cx - 2} ${cy - 14}`, fill: 'none', stroke: R.dark, 'stroke-width': 3, opacity: 0.25, filter: C.D.blurU(1.5) }));
      add('chef-band', bandP, h.color, { form: 0.25, sheen: 0.3 });
      out.push(el('path', { d: dOf(up(HAT_LINE.slice(2, -2), 30), false), fill: 'none', stroke: R.dark, 'stroke-width': 3, opacity: 0.3 }));
      break;
    }
    case 'hard-hat': {
      add('hat', dome(-190, 1.05), h.color, { form: 0.3, sheen: 0.45, gloss: 0.8 });
      out.push(el('path', { d: 'M -8 -186 Q 0 -190 8 -186 L 8 -146 Q 0 -144 -8 -146 Z', fill: R.lit, opacity: 0.7 }));
      const brim = [[-84, -129], [-63, -131], ...HAT_LINE.slice(2, -2).map(([x, y]) => [x, y - 2]), [63, -131], [84, -129], [84, -124], [62, -125], ...HAT_LINE.slice(2, -2).reverse().map(([x, y]) => [x, y + 3]).map(([x, y]) => [x, Math.min(y, Math.abs(x) <= 53 ? -136.5 : y)]), [-62, -125], [-84, -124]];
      add('brim', brim, { ...R, base: R.shade }, { form: 0.25, sheen: 0.4 });
      break;
    }
    case 'beanie': {
      add('beanie', dome(-186), h.color, { form: 0.3, sheen: 0.25 });
      const ribs = [];
      for (let x = -48; x <= 48; x += 9) ribs.push(el('path', { d: `M ${x} -150 Q ${x * 0.9} -168 ${x * 0.6} -180`, fill: 'none', stroke: R.dark, 'stroke-width': 1.6, opacity: 0.3 }));
      out.push(g({ 'clip-path': C.D.clip(el('path', { d: dOf(dome(-186)) })) }, ribs));
      const cuff = [...HAT_LINE, ...up(HAT_LINE, 13).reverse()];
      add('cuff', cuff, { ...R, base: R.shade, lit: R.base }, { form: 0.2, sheen: 0.3 });
      const pom = arcPts(0, -192, 13, 13, 0, 360, 24);
      add('pompom', pom, h.color, { form: 0.35, sheen: 0.4 });
      break;
    }
    case 'bandana': {
      add('bandana', dome(-172, 0.98), h.color, { form: 0.3, sheen: 0.3 });
      for (const [cx, cy] of [[-24, -158], [8, -164], [34, -152], [-4, -150]]) out.push(el('circle', { cx, cy, r: 2.6, fill: '#FFFFFF', opacity: 0.8 }));
      const tails = [[60, -130], [74, -138], [90, -128], [80, -122], [68, -126], [80, -110], [70, -106], [62, -124]];
      add('knot', tails, h.color, { form: 0.3 });
      break;
    }
    case 'headband': {
      const b = [...HAT_LINE.map(([x, y]) => [x, y - 1]), ...up(HAT_LINE, 11).reverse()];
      add('headband', b, h.color, { form: 0.25, sheen: 0.35 });
      break;
    }
    case 'crown': {
      const base = [[-36, -140], [36, -140], [36, -152], [-36, -152]];
      const pts = [[-38, -152], [-44, -186], [-22, -166], [0, -194], [22, -166], [44, -186], [38, -152], [-38, -152]];
      add('crown', [...pts.slice(0, -1), [38, -140], [-38, -140]], h.color, { form: 0.3, sheen: 0.4, gloss: 0.8, edge: 0.3 });
      out.push(el('path', { d: dOf(base), fill: R.shade, opacity: 0.5 }));
      out.push(stud(C, 0, -146, 3.6, 'blue'), stud(C, -22, -146, 3, 'teal'), stud(C, 22, -146, 3, 'teal'));
      for (const [x, y] of [[-44, -186], [0, -194], [44, -186]]) out.push(stud(C, x, y, 3.2, h.color));
      break;
    }
    case 'peaked': {
      // a peaked cap (pilot, mail carrier, security, police, conductor): a flared crown on a dark
      // band, a glossy visor that stays above the brows (y ≤ −137 across the face), a badge
      const crown = [[-56, -140], [-66, -160], [-60, -177], [-30, -185], [0, -187], [30, -185], [60, -177], [66, -160], [56, -140]];
      add('peaked-crown', crown, h.color, { form: 0.35, sheen: 0.35 });
      const band = [[-56, -139], [56, -139], [58, -153], [-58, -153]];
      add('peaked-band', band, h.color === 'ink' ? { ...ramp('ink'), base: ramp('ink').shade } : 'ink', { form: 0.2, sheen: 0.3 });
      const visor = [[-52, -137], [52, -137], [59, -141], [32, -148], [0, -150], [-32, -148], [-59, -141]];
      add('peaked-visor', visor, 'ink', { form: 0.2, sheen: 0.2, gloss: 0.9 });
      add('peaked-badge', [[-7, -172], [7, -172], [8, -160], [0, -155], [-8, -160]], 'yellow', { gloss: 0.9, edge: 0.25 });
      break;
    }
    case 'headphones': {
      // headphones (DJ, call centre, gamer): a band over the crown, cups on the body's sides,
      // clear of the eyes (the cups sit at |x| ≥ 59)
      const arc = arcPts(0, -112, 68, 62, 180, 360, 28);
      shapes.push({ part: 'headphones-band', line: arc, w: 8 });
      out.push(softLine(C, arc, 8, 'ink'));
      for (const s of [-1, 1]) {
        const cup = arcPts(s * 70, -106, 11, 18, 0, 360, 22);
        add('headphones-cup', cup, h.color, { form: 0.35, sheen: 0.4, gloss: 0.7 });
        const pad = arcPts(s * 62, -106, 5, 15, 0, 360, 16);
        add('headphones-pad', pad, 'ink', { form: 0.2, sheen: 0.2 });
      }
      break;
    }
    default:
      break;
  }
  return { shapes, svg: out.join('') };
}

// ── Items: the tools of the trade, in place ───────────────────────────────────────────────
/**
 * Items worn on the body (front layer). Each returns { shapes, svg }. Placement keeps them on the
 * garment's sides and base: the left strip carries the badge and heart pin, the right strip the
 * pocket, pen, fob watch and name tag; the stethoscope frames the face from below.
 */
function drawItems(C, o, face) {
  const has = (k) => o.items.includes(k);
  const shapes = [];
  const out = [];
  const L = C.L;
  const line = (part, pts, w, color, opts) => {
    shapes.push({ part, line: pts, w, item: true });
    out.push(softLine(C, pts, w, color, opts));
  };
  const fill = (part, pts, color, opts) => {
    shapes.push({ part, pts, item: true });
    out.push(softShape(C, pts, color, opts));
  };
  if (has('scarf')) {
    const sc = trace([-70, -42], [['Q', [0, -26], [70, -42]], ['L', [71, -27]], ['Q', [0, -10], [-71, -27]]]);
    fill('scarf', sc, o.top.trim ?? 'teal', { form: 0.3 });
    fill('scarf-tail', [[40, -32], [56, -34], [60, -4], [44, -2]], o.top.trim ?? 'teal', { form: 0.3 });
    out.push(el('path', { d: 'M 44 -10 L 59 -12 M 45 -6 L 59 -8', stroke: '#FFFFFF', 'stroke-width': 1.4, opacity: 0.5 }));
  }
  if (has('tool-belt')) {
    fill('belt', [[-72, -28], [72, -28], [72, -20], [-72, -20]], 'ink', { form: 0.2, sheen: 0.3, drop: false });
    fill('buckle', [[-7, -30], [7, -30], [7, -18], [-7, -18]], 'yellow', { gloss: 0.6, drop: false });
    out.push(el('rect', { x: -3.5, y: -26.5, width: 7, height: 5, rx: 1, fill: ramp('ink').base }));
    fill('pouch-l', [[-70, -20], [-42, -20], [-44, 0], [-68, 0]], 'yellow', { form: 0.3 });
    fill('pouch-r', [[42, -20], [70, -20], [68, 0], [44, 0]], 'yellow', { form: 0.3 });
    // a hammer in the right pouch, a screwdriver in the left
    line('hammer', [[58, -20], [62, -40]], 4.5, 'ink');
    fill('hammer-head', [[54, -46], [70, -42], [69, -37], [53, -41]], 'steel', { gloss: 0.6, drop: false });
    line('driver', [[-52, -20], [-55, -32]], 3, 'steel');
    fill('driver-grip', [[-58, -20], [-50, -20], [-51, -10], [-57, -10]], 'teal', { drop: false });
  }
  if (has('apron-pocket')) {
    fill('apron-pocket', [[-18, -24], [18, -24], [17, -10], [-17, -10]], o.top.kind === 'apron' ? o.top.color : 'paper', { form: 0.3 });
    out.push(el('path', { d: 'M 0 -24 L 0 -10', stroke: tk('shadow-warm'), 'stroke-width': 1.2, opacity: 0.3 }));
  }
  if (has('stethoscope')) {
    const tube = trace([-61, -97], [['C', [-58, -72], [-50, -52], [-38, -38]], ['C', [-24, -28], [24, -28], [38, -38]], ['C', [50, -52], [58, -72], [61, -97]]]);
    line('stethoscope', tube, 4.6, 'ink');
    const drop = trace([-26, -31.5], [['Q', [-31, -24], [-30, -14]]]);
    line('stethoscope-drop', drop, 3.6, 'ink');
    const disc = arcPts(-30, -9, 7.5, 7.5, 0, 360, 20);
    fill('chest-piece', disc, 'steel', { gloss: 0.9, edge: 0.4, drop: false });
    out.push(el('circle', { cx: -30, cy: -9, r: 3.4, fill: C.D.rg([[0, tk('canvas')], [1, tk('text-tertiary')]], 0.4, 0.3, 0.8) }));
  }
  if (has('lanyard')) {
    const cordL = trace([-61, -97], [['C', [-57, -70], [-50, -48], [-36, -37]], ['L', [-7, -28]]]);
    line('lanyard', cordL, 3.4, o.top.trim ?? 'blue', { hi: false });
    line('lanyard', mirrorX(cordL).reverse(), 3.4, o.top.trim ?? 'blue', { hi: false });
    fill('lanyard-card', rectPts(-10, -29, 20, 25), 'white', { gloss: 0.4, form: 0.2 });
    out.push(el('rect', { x: -10, y: -29, width: 20, height: 6, rx: 1.5, fill: ramp(o.top.trim ?? 'blue').base }));
    out.push(el('rect', { x: -6, y: -20, width: 6, height: 7, rx: 1, fill: ramp('paper').dark }), el('path', { d: 'M 2 -18 L 7 -18 M 2 -14 L 7 -14', stroke: ramp('ink').base, 'stroke-width': 1.4 }));
  }
  if (has('badge')) {
    out.push(softLine(C, [[-55, -64], [-55, -58]], 2.2, 'steel', { shadow: false }));
    fill('badge-clip', rectPts(-60, -67, 10, 5), 'steel', { drop: false, gloss: 0.6 });
    fill('badge', rectPts(-64, -58, 18, 24), 'white', { gloss: 0.5, form: 0.18 });
    out.push(el('rect', { x: -64, y: -58, width: 18, height: 6, rx: 1.5, fill: ramp(o.top.trim ?? 'blue').base }));
    out.push(el('rect', { x: -61, y: -49, width: 7, height: 8, rx: 1.2, fill: ramp('paper').dark }), el('path', { d: 'M -61 -38 L -49 -38', stroke: ramp('ink').base, 'stroke-width': 1.5 }));
  }
  if (has('name-tag')) {
    fill('name-tag', rectPts(50, -64, 15, 10), 'white', { gloss: 0.5, form: 0.15 });
    out.push(el('rect', { x: 50, y: -64, width: 15, height: 3.5, rx: 1, fill: ramp(o.top.trim ?? 'blue').base }), el('path', { d: 'M 53 -57 L 62 -57', stroke: ramp('ink').base, 'stroke-width': 1.4 }));
  }
  if (has('pen')) {
    fill('pen', [[50, -62], [54, -62], [54, -42], [50, -42]], 'blue', { drop: false, sheen: 0.5 });
    out.push(el('rect', { x: 50, y: -62, width: 4, height: 5, rx: 1.5, fill: ramp('ink').base }));
    out.push(el('path', { d: 'M 55 -61 L 55 -53', stroke: ramp('steel').shade, 'stroke-width': 1.2 }));
  }
  if (has('fob-watch')) {
    out.push(stud(C, 59, -78, 3.2, 'yellow'));
    out.push(softLine(C, [[59, -75], [60, -71]], 1.8, 'steel', { shadow: false }));
    const w = arcPts(60, -62, 8.5, 8.5, 0, 360, 22);
    fill('fob-watch', w, 'steel', { gloss: 0.8, edge: 0.4, drop: true });
    out.push(el('circle', { cx: 60, cy: -62, r: 6.2, fill: '#FFFFFF' }), el('path', { d: 'M 60 -62 L 60 -66.5 M 60 -62 L 63.2 -60.4', stroke: ramp('ink').base, 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
  }
  if (has('heart-pin')) {
    const hp = trace([-60, -64], [['C', [-60, -68], [-56, -70], [-55, -66]], ['C', [-54, -70], [-49, -68], [-50, -64]], ['C', [-51, -60], [-55, -58], [-55, -57]], ['C', [-55, -58], [-59, -60], [-60, -64]]], 8);
    fill('heart-pin', hp, 'lilac', { gloss: 0.8, drop: true, edge: 0.2 });
  }
  if (has('bowtie')) {
    const wing = [[0, -29], [-17, -36], [-18, -22]];
    fill('bowtie-l', wing, o.top.trim ?? 'ink', { drop: true, sheen: 0.4 });
    fill('bowtie-r', wing.map(([x, y]) => [-x, y]), o.top.trim ?? 'ink', { drop: true, sheen: 0.4 });
    fill('bowtie-knot', arcPts(0, -29, 4.6, 4.6, 0, 360, 14), o.top.trim ?? 'ink', { drop: false, sheen: 0.6 });
  }
  if (has('tie')) {
    fill('tie-knot', [[-5, -34], [5, -34], [3.5, -27], [-3.5, -27]], o.top.trim ?? 'blue', { drop: true });
    fill('tie', [[-3.5, -27], [3.5, -27], [7, -8], [0, -2], [-7, -8]], o.top.trim ?? 'blue', { drop: true, sheen: 0.35 });
  }
  if (has('whistle')) {
    const cord = trace([62, -97], [['C', [60, -72], [52, -50], [38, -36]]]);
    line('whistle-cord', cord, 2.2, 'ink', { hi: false });
    fill('whistle', [[20, -34], [37, -36], [39, -28], [22, -24]], 'steel', { gloss: 0.9, edge: 0.35 });
    out.push(el('circle', { cx: 24, cy: -29, r: 4.6, fill: C.D.rg([[0, ramp('steel').lit], [1, ramp('steel').shade]], 0.6, 0.3, 0.8) }));
  }
  if (has('earpiece')) {
    fill('earpiece', [[64, -118], [72, -122], [76, -112], [70, -106], [64, -108]], 'ink', { gloss: 0.7, drop: true });
    const coil = [];
    for (let k = 0; k <= 32; k++) coil.push([70 + Math.sin(k * 0.9) * 3.5, -106 + k * 0.9]);
    line('earpiece-cord', coil, 1.8, 'steel', { shadow: false, hi: false });
  }
  if (has('glasses-chain')) {
    const hang = !has('glasses');
    const end = hang ? [-13, -27] : [-58, -60];
    const chain = hang ? trace([-62, -96], [['C', [-60, -70], [-50, -46], [-36, -36]], ['L', end]]) : trace([-56, -97], [['C', [-62, -86], [-62, -72], end]]);
    for (const c of [chain, mirrorX(chain).reverse()]) {
      shapes.push({ part: 'glasses-chain', line: c, w: 4, item: true });
      out.push(el('path', { d: dOf(c, false), fill: 'none', stroke: ramp(o.top.trim ?? 'yellow').base, 'stroke-width': 4, 'stroke-dasharray': '0.1 6', 'stroke-linecap': 'round' }));
    }
    if (hang) {
      // the reading glasses hang on the chain at the base, below the mouth
      for (const s of [-1, 1]) {
        const lens = arcPts(s * 8, -24, 7.5, 6, 0, 360, 18);
        shapes.push({ part: 'hung-lens', pts: lens, item: true });
        out.push(el('ellipse', { cx: s * 8, cy: -24, rx: 7.5, ry: 6, fill: '#FFFFFF', 'fill-opacity': 0.35, stroke: ramp('ink').base, 'stroke-width': 2.4 }));
      }
    }
  }
  return { shapes, svg: out.join('') };
}

/** Glasses over the eyes: the one item allowed in the eye keep-out. Rims in the face's ink. */
export function drawGlasses(C, o, face) {
  if (!o || !(o.items.includes('glasses'))) return '';
  const rim = face === tk('paper-lit') || face === tk('canvas') ? tk('paper-lit') : ramp('ink').base;
  const out = [];
  for (const s of [-1, 1]) {
    out.push(el('circle', { cx: s * 25, cy: -98, r: 20.5, fill: '#FFFFFF', 'fill-opacity': 0.12, stroke: rim, 'stroke-width': 4.2 }));
    out.push(el('path', { d: `M ${s * 25 - 12} -108 Q ${s * 25 - 2} -114 ${s * 25 + 8} -111`, fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.6 }));
  }
  out.push(el('path', { d: 'M -5 -100 Q 0 -104 5 -100', fill: 'none', stroke: rim, 'stroke-width': 3.6 }));
  if (o.items.includes('glasses-chain')) out.push(el('path', { d: 'M -45.5 -99 L -56 -97 M 45.5 -99 L 56 -97', stroke: rim, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  return out.join('');
}

/** Items on an arm: the towel over the left forearm, the wristband at the left wrist. */
export function drawArmItems(C, o, side, [x0, y0, cx, cy, x1, y1]) {
  if (!o) return '';
  const at = (t) => [(1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1];
  const out = [];
  if (side === 'l' && o.items.includes('wristband')) {
    const a = at(0.74);
    const b = at(0.84);
    out.push(el('path', { d: `M ${r2(a[0])} ${r2(a[1])} L ${r2(b[0])} ${r2(b[1])}`, stroke: ramp(o.top.trim ?? 'yellow').base, 'stroke-width': 21, 'stroke-linecap': 'butt' }));
    out.push(el('path', { d: `M ${r2(a[0])} ${r2(a[1] - 3)} L ${r2(b[0])} ${r2(b[1] - 3)}`, stroke: '#FFFFFF', 'stroke-width': 4, opacity: 0.45 }));
  }
  if (side === 'l' && o.items.includes('towel')) {
    const [x, y] = at(0.68);
    const tw = [[x - 13, y - 8], [x + 13, y - 9], [x + 15, y + 30], [x + 4, y + 26], [x - 3, y + 33], [x - 15, y + 29]];
    out.push(softShape(C, tw, 'white', { form: 0.25, sheen: 0.4, drop: true }));
    out.push(el('path', { d: `M ${r2(x - 14)} ${r2(y + 21)} L ${r2(x + 14)} ${r2(y + 20)}`, stroke: ramp(o.top.trim ?? 'blue').base, 'stroke-width': 2.6 }));
    out.push(el('path', { d: `M ${r2(x + 2)} ${r2(y - 8)} L ${r2(x + 4)} ${r2(y + 25)}`, stroke: ramp('paper').dark, 'stroke-width': 1.5, opacity: 0.8 }));
  }
  return out.join('');
}

/** Items held in a hand: the tray on the right hand, the clipboard in the left. */
export function drawHeld(C, o, hands) {
  if (!o) return '';
  const out = [];
  if (o.items.includes('tray')) {
    const [hx, hy] = hands.r;
    const ty = hy - 11;
    out.push(softShape(C, arcPts(hx, ty + 3, 42, 9, 0, 360, 30), 'steel', { drop: false, gloss: 0.5 }));
    out.push(softShape(C, arcPts(hx, ty, 40, 8, 0, 360, 30), { ...ramp('steel'), base: tk('paper-lit') }, { drop: false, gloss: 0.9, edge: 0.3 }));
    // two drinks: a juice and a water
    for (const [dx, col, h] of [[-14, 'yellow', 26], [12, 'white', 30]]) {
      const gx = hx + dx;
      out.push(el('path', { d: `M ${gx - 7} ${ty - h} L ${gx + 7} ${ty - h} L ${gx + 6} ${ty - 1} L ${gx - 6} ${ty - 1} Z`, fill: '#FFFFFF', 'fill-opacity': 0.55, stroke: '#FFFFFF', 'stroke-width': 1.2 }));
      if (col === 'yellow') out.push(el('path', { d: `M ${gx - 6.5} ${ty - h * 0.62} L ${gx + 6.5} ${ty - h * 0.62} L ${gx + 6} ${ty - 1} L ${gx - 6} ${ty - 1} Z`, fill: ramp('yellow').lit }));
      out.push(el('path', { d: `M ${gx + 3.5} ${ty - h + 3} L ${gx + 3} ${ty - 4}`, stroke: '#FFFFFF', 'stroke-width': 1.6, opacity: 0.9 }));
    }
  }
  if (o.items.includes('clipboard')) {
    const [hx, hy] = hands.l;
    const board = [[hx - 16, hy - 30], [hx + 14, hy - 33], [hx + 18, hy + 8], [hx - 12, hy + 11]];
    out.push(softShape(C, board, 'blue', { drop: false, form: 0.3, sheen: 0.3 }));
    out.push(el('path', { d: dOf([[hx - 12, hy - 25], [hx + 11, hy - 28], [hx + 14, hy + 4], [hx - 9, hy + 7]]), fill: '#FFFFFF' }));
    for (let k = 0; k < 4; k++) out.push(el('path', { d: `M ${r2(hx - 8)} ${r2(hy - 17 + k * 7)} L ${r2(hx + 9)} ${r2(hy - 19 + k * 7)}`, stroke: ramp('ink').shade, 'stroke-width': 1.5, opacity: 0.55 }));
    out.push(softShape(C, [[hx - 6, hy - 36], [hx + 6, hy - 37], [hx + 7, hy - 29], [hx - 5, hy - 28]], 'steel', { drop: false, gloss: 0.8 }));
  }
  return out.join('');
}

/** The right side of a back panel, top (the shoulder, y −99) to the centre of the hem: the
 *  body's squircle outline (cast.js BODY_D: centre −86, half sizes 66 × 56, n 3.3) pushed out
 *  1.5 px for the cloth, down to where the body starts to round under (y −60); from there the
 *  cloth hangs free, easing out by the top's flare to a rounded hem corner, and the hem curves to
 *  the centre (the left half mirrors it). No straight box edges. */
function backSide(hem, flare) {
  const a = 67.5;
  const b = 57.5;
  const n = 3.3;
  const pts = [];
  for (let k = 0; k <= 48; k++) {
    const t = -Math.PI / 2 + (k / 48) * Math.PI;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const p = [a * Math.abs(c) ** (2 / n), -86 + b * Math.sign(sn) * Math.abs(sn) ** (2 / n)];
    if (p[1] >= -99 && p[1] <= -60) pts.push(p);
  }
  const last = pts[pts.length - 1];
  const hx = last[0] + flare * 0.7;
  const r = 7;
  // hangs from the body's side, easing out, into a rounded corner, then the hem to the centre
  pts.push(...trace(last, [['Q', [last[0] + flare * 0.2, (last[1] + hem) / 2], [hx, hem - r]], ['Q', [hx, hem], [hx - r, hem]], ['Q', [hx * 0.5, hem + 2.5], [0, hem + 2.5]]], 8).slice(1));
  return pts;
}

/**
 * The back of an outfit (4.1), for a critter seen from behind (cast.js view 'back'): the top's
 * back panel from the shoulders down (no neckline round a face, no front details), a coat's
 * centre seam and vent, a collar band, a hoodie's hood lying on the back, an apron's waist band
 * tied in a bow at the small of the back, overall straps crossing; then the head as worn (a hat
 * reads the same from behind). Front items (badges, a stethoscope, glasses) are not seen.
 * Drawn at the origin at scale 1, like outfitLayers. Returns an SVG string ('' for no outfit).
 */
export function outfitBack(C, outfit) {
  const o = typeof outfit?.top === 'object' && outfit.sleeveLen ? outfit : normalizeOutfit(outfit);
  if (!o) return '';
  const t = o.top;
  const KD = KIND[t.kind];
  const out = [];
  if (t.kind !== 'none') {
    const R = ramp(t.color);
    const tie = t.trim ?? t.color;
    if (KD.bib && t.kind === 'apron') {
      out.push(softShape(C, [[-63, -31], [63, -31], [63, -24], [-63, -24]], tie, { drop: true, form: 0.25, sheen: 0.4 }));
      for (const loop of [[[0, -28], [-13, -37], [-13, -19]], [[0, -28], [13, -37], [13, -19]]]) out.push(softShape(C, loop, tie, { drop: false, form: 0.2 }));
      out.push(softLine(C, [[-1, -27], [-6, -6]], 4, tie), softLine(C, [[1, -27], [7, -6]], 4, tie));
      out.push(stud(C, 0, -28, 3.6, tie));
    } else if (KD.bib) {
      out.push(softShape(C, [[-64, -31], [64, -31], [65, -16], [-65, -16]], t.color, { form: 0.36 }));
      for (const sx of [-1, 1]) out.push(softLine(C, [[sx * 60, -96], [sx * 30, -62], [-sx * 22, -31]], 7, tie));
      out.push(stud(C, -22, -30, 2.8, 'steel'), stud(C, 22, -30, 2.8, 'steel'));
    } else {
      // the back panel hugs the body: its sides follow the body's own rounded outline (a hair
      // outside it, the cloth's thickness) from the shoulders down, then ease out over the legs
      // to the hem; the top is the back neckline, a soft curve across the shoulders
      const right = backSide(KD.hem, KD.flare);
      const neck = trace(mirrorX([right[0]])[0], [['C', [-40, -90], [-18, -88], [0, -88]]]);
      const panel = [...sym(neck), ...right.slice(1), ...mirrorX(right).slice(0, -1)];
      out.push(softShape(C, panel, t.color, { form: 0.42, sheen: 0.28, edge: 0.3 }));
      if (t.kind === 'coat' || t.kind === 'dress') {
        out.push(el('path', { d: `M 0 -88 L 0 ${KD.hem}`, stroke: R.dark, 'stroke-width': 1.6, opacity: 0.45 }));
        if (t.kind === 'coat') out.push(el('path', { d: `M 0 ${KD.hem - 18} L 0 ${KD.hem}`, stroke: R.dark, 'stroke-width': 3, opacity: 0.5 }));
      }
      if (t.neck === 'collar' || t.neck === 'lapel') out.push(softLine(C, sym(neck).slice(2, -2), 6, { ...R, base: R.shade, lit: R.base }, { shadow: true }));
      if (t.kind === 'hoodie') out.push(softShape(C, [[-46, -95], ...trace([-46, -95], [['C', [-44, -60], [44, -60], [46, -95]]]).slice(1), [0, -90]], { ...R, base: R.shade, lit: R.base }, { drop: true, form: 0.45, sheen: 0.2 }));
    }
  }
  return out.join('') + drawHead(C, o).svg;
}

/**
 * Everything worn on the front of the body, at the origin at scale 1: the top, the head, the items
 * and the custom garment. Returns { behind, front, glasses, shapes } with shapes = the silhouettes
 * ({ part, pts } fills and { part, line, w } strokes) for the keep-out test.
 */
export function outfitLayers(C, outfit, { face = '#1F1915' } = {}) {
  const o = typeof outfit?.top === 'object' && outfit.sleeveLen ? outfit : normalizeOutfit(outfit);
  if (!o) return { behind: '', front: '', head: '', glasses: '', shapes: [], o: null };
  const top = drawTop(C, o);
  const head = drawHead(C, o);
  const items = drawItems(C, o, face);
  let custom = '';
  if (o.custom) {
    const saved = COLLECT;
    COLLECT = null;
    const tones = Object.fromEntries(PALETTE.map((n) => [n, ramp(n)]));
    COLLECT = saved;
    custom = String(o.custom({ by: BY, fill: C.fill, tones, keepout: FACE_KEEPOUT, soft: (pts, color, opts) => softShape(C, pts, color, opts), line: (pts, w, color, opts) => softLine(C, pts, w, color, opts), el, g }) ?? '');
  }
  const keep = keepoutClip(C.D);
  return {
    o,
    behind: drawBehind(C, o),
    front: g({ 'clip-path': keep, 'data-outfit': 'front' }, top.svg + items.svg + (custom ? g({ 'data-outfit': 'custom' }, custom) : '')),
    head: head.svg ? g({ 'clip-path': keep, 'data-outfit': 'head' }, head.svg) : '',
    glasses: drawGlasses(C, o, face),
    shapes: [...top.shapes, ...head.shapes, ...items.shapes],
  };
}

/**
 * The palette colors an outfit actually draws (garments, sleeves, trousers, shoes, head, items,
 * held items and its custom garment), as a Set of palette names; metal is not a palette color.
 * For try.mjs: orange is only ever the hero's body (EX3-139), so a CAST outfit drawing orange is
 * an error there. No outfit → an empty set.
 * @param {object | null | 'none'} outfit
 * @param {{ draw?: (C: object, o: object) => void }} [o]  the drawing to run (cast.js passes one
 *        that also draws the sleeves, trousers and held items)
 * @returns {Set<string>}
 */
export function outfitColors(outfit, { draw = null } = {}) {
  const o = normalizeOutfit(outfit);
  const seen = new Set();
  if (!o) return seen;
  const saved = COLLECT;
  COLLECT = seen;
  try {
    const C = { D: defsBag(), L: 1, dark: false, bodyClip: null, fill: SPEC_RAMPS.ink.base };
    outfitLayers(C, o);
    if (draw) draw(C, o);
  } finally {
    COLLECT = saved;
  }
  return seen;
}
