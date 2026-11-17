// The Explainers world kit, drawing (hx-5, visual system 5 "D"): the style primitives every object
// is built from. The kit is a style, not a catalog: these are the parts every new object is built
// from.
//
//   solids:   flat tones (VISUAL_SYSTEM_5 §3): a lit top, a mid front and a darker side, from the
//             ramp (lit, base, shade). No outline, gradient, gloss, rim, glow or blur on a solid;
//             one soft ink shadow (ink at 10%) under things that stand
//   shapes:   softShape(): an organic filled shape, flat, with a darker shade region
//   marks:    handwriting that writes itself, lines that draw themselves out, pulse rings,
//             shock marks, line icons (line() is their color: ink)
//   grounds:  paper (TOKENS.paper + the grain + a faint drafting grid) and white (the logo close)
//
// Every color comes from the core palette and its ramps; a tint between two palette colors is
// mixed by core mixHex. Every function returns an SVG string and is a pure function of its
// arguments, so a frame is a pure function of time. Def ids are hashed from their content, so a
// def drawn twice is the same def and ids never depend on draw order.

// perfect-freehand comes from the CDN in the browser. It is loaded lazily (4.1), so the kit also
// imports in plain Node with no network and no loader hook (a scene builder measuring
// ceilingShare / fitCeiling, a test): there the freehand marks fall back to a plain stroke outline.
// try.mjs still stubs the URL for Node, so its checks see the same output as before.
let getStroke = plainStroke;
try {
  ({ getStroke } = await import('https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.3/+esm'));
} catch {
  getStroke = plainStroke;
}
/** A stroke outline with no pressure: each point offset by half the size on both sides. */
function plainStroke(points, { size = 9 } = {}) {
  if (!points?.length) return [];
  const r = size / 2;
  const side = (k) => points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] - (k * dy * r) / l, p[1] + (k * dx * r) / l];
  });
  return [...side(1), ...side(-1).reverse()];
}
import { TOKENS as T, GROUNDS, FRAME, PALETTE, SHADOW_OPACITY, rng, isoPlane, groundOf, mixHex, resolveTone } from './core.js';
import { HERSHEY_CAP, HERSHEY_SANS } from './hershey-sans.js';

export { T };
export const W = FRAME.w;
export const H = FRAME.h;

// ── Scope: ids and the ground of the shot being drawn ─────────────────────────────────────
let PFX = '';
let DARK = false;
let GROUND_NAME = 'paper';

/** Call first in every shot draw: scopes SVG ids to the shot (several shots share one
 *  document) and sets the ground (`paper` or `white`; a retired name draws as paper). */
export function scope(prefix, ground = 'paper') {
  const gr = groundOf(ground);
  PFX = prefix;
  DARK = gr.dark;
  GROUND_NAME = gr.name;
}
export const id = (name) => PFX + name;
export const ref = (name) => `url(#${PFX}${name})`;
export const isDark = () => DARK;
/** The ground of the shot being drawn (the last scope() call), aliases resolved. */
export const groundName = () => GROUND_NAME;
/** The color for the few line marks that remain (icons, handwriting, ticks): ink. Solids never
 *  take an outline. */
export const line = () => T.ink;

const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
export const el = (tag, o = {}, inner = '') => `<${tag} ${attrs(o)}>${inner}</${tag}>`;
export const g = (o, inner) => el('g', o, Array.isArray(inner) ? inner.join('') : inner);

/** A def id from its content (FNV-1a): the same def always gets the same id. */
function hid(kind, content) {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${PFX}${kind}${(h >>> 0).toString(36)}`;
}
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const isHex = (c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);
const lum = (c) => (isHex(c) ? [1, 3, 5].reduce((a, i, k) => a + parseInt(c.slice(i, i + 2), 16) * [0.2126, 0.7152, 0.0722][k], 0) : 0);

/** A clip path def from inner SVG, and its reference. */
function clipOf(inner) {
  const cid = hid('c', inner);
  return { def: el('clipPath', { id: cid }, inner), paint: `url(#${cid})` };
}
const defsOf = (...list) => el('defs', {}, list.map((x) => x.def).join(''));

// ── Filters ───────────────────────────────────────────────────────────────────────────────
// grain: the OG paper grain (the ground only, never on objects) · card: the soft ink shadow under
// a white card or pill · tray: the soft ink shadow under the mechanism tray. The options of the
// old signature are accepted and ignored.
export function defs(_old = {}) {
  return el('defs', {}, [
    el('filter', { id: id('grain'), x: 0, y: 0, width: '100%', height: '100%' },
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 3, seed: 11, result: 'n' }) +
      el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.09  0 0 0 0 0.09  0 0 0 0 0.09  0.9 0.9 0.9 0 -1.2' })),
    el('filter', { id: id('card'), x: '-10%', y: '-10%', width: '120%', height: '140%' }, el('feDropShadow', { dx: 0, dy: 8, stdDeviation: 12, 'flood-color': T.ink, 'flood-opacity': 0.12 })),
    el('filter', { id: id('tray'), x: '-10%', y: '-10%', width: '120%', height: '130%' }, el('feDropShadow', { dx: 0, dy: 16, stdDeviation: 18, 'flood-color': T.ink, 'flood-opacity': 0.2 })),
  ].join(''));
}

/** A flat shade: `shape` filled with `color` at one
 *  opacity, the mean of `from` and `to`. Same signature as before; the direction is ignored. */
export function stippleShade(shapeTag, shapeAttrs, color, { from = 0, to = 1 } = {}) {
  const a = Math.max(0, Math.min(1, (from + to) / 2)) * 0.6;
  return el(shapeTag, { ...shapeAttrs, fill: color, opacity: +a.toFixed(3) });
}

// ── Grounds (VISUAL_SYSTEM_5 §3) ──────────────────────────────────────────────────────────
/** The drafting grid's cell (px) and its ink opacity. */
export const GRID = { cell: 72, opacity: 0.045, width: 1.5 };
/** The paper grain: the OG feTurbulence grain at this opacity, over the paper only. */
export const GRAIN_OPACITY = 0.3;

/** The ground: `paper` is TOKENS.paper with the OG grain and a faint drafting grid (72 px cells,
 *  ink at 4.5%); `white` is the logo close only (flat white, nothing on it). Draw once, under the
 *  world; it carries its own grain filter, so it needs no defs() call. A retired name draws paper. */
export function ground(name = 'paper') {
  const gr = groundOf(name);
  if (gr.name === 'white') return el('rect', { x: 0, y: 0, width: W, height: H, fill: GROUNDS.white.fill });
  const fid = hid('grain', 'og-grain');
  const filter = el('filter', { id: fid, x: 0, y: 0, width: '100%', height: '100%' },
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 3, seed: 11, result: 'n' }) +
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.09  0 0 0 0 0.09  0 0 0 0 0.09  0.9 0.9 0.9 0 -1.2' }));
  return g({ 'data-ground': 'paper' }, [
    el('defs', {}, filter),
    el('rect', { x: 0, y: 0, width: W, height: H, fill: GROUNDS.paper.fill }),
    el('rect', { x: 0, y: 0, width: W, height: H, filter: `url(#${fid})`, opacity: GRAIN_OPACITY, 'pointer-events': 'none' }),
    grid(),
  ]);
}

/** The faint drafting grid over the paper: `cell` px squares in ink at `opacity`, across the
 *  frame (or the box x, y, w, h). ground('paper') draws it; call it alone for a panel of paper. */
export function grid({ cell = GRID.cell, opacity = GRID.opacity, width = GRID.width, x = 0, y = 0, w = W, h = H } = {}) {
  let d = '';
  for (let gx = x; gx <= x + w + 0.01; gx += cell) d += `M${f1(gx)},${f1(y)}V${f1(y + h)}`;
  for (let gy = y; gy <= y + h + 0.01; gy += cell) d += `M${f1(x)},${f1(gy)}H${f1(x + w)}`;
  return el('path', { d, stroke: T.ink, 'stroke-opacity': opacity, 'stroke-width': width, fill: 'none', 'data-grid': 1 });
}

// ── Freehand ink (marks only) ─────────────────────────────────────────────────────────────
export function freehand(points, opts = {}) {
  const s = getStroke(points, {
    size: 9,
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: true,
    start: { taper: 18, cap: true },
    end: { taper: 26, cap: true },
    ...opts,
  });
  if (!s.length) return '';
  const d = s.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
      return acc;
    },
    ['M', s[0][0].toFixed(1), s[0][1].toFixed(1), 'Q'],
  );
  d.push('Z');
  return d.join(' ');
}

/** A freehand ink stroke through points, as an SVG path. */
export const stroke = (points, { color = line(), ...opts } = {}) => el('path', { d: freehand(points, opts), fill: color });

// ── Handwriting (Explainers 3.1, EX3-61; Hershey Sans in 3.2, EX3-81) ──────────────────────
/** Width of `text` in px at cap height `size`, in Hershey Sans. */
export function handwriteWidth(text, size) {
  const k = size / HERSHEY_CAP;
  return [...String(text)].reduce((w, ch) => w + (HERSHEY_SANS[ch] ?? HERSHEY_SANS[' ']).a * k, 0);
}

/**
 * Real handwriting that writes itself: Hershey Sans single strokes (plain print, never cursive)
 * drawn as an even, round-capped pen line. The baseline starts at (x, y) (or is centred on x with
 * align 'center'); `size` is the cap height in px; `progress` 0..1 reveals the strokes in writing
 * order, by length. Returns an SVG group tagged with `role` (frame 1's title uses 'title').
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} [progress]
 * @param {{ color?: string, weight?: number, align?: string, role?: string }} [opts]
 */
export function handwrite(text, x, y, size, progress = 1, { color = line(), weight = 1, align = 'left', role } = {}) {
  const k = size / HERSHEY_CAP;
  let cursor = align === 'center' ? x - handwriteWidth(text, size) / 2 : x;
  const strokes = [];
  for (const ch of String(text)) {
    const glyph = HERSHEY_SANS[ch] ?? HERSHEY_SANS[' '];
    for (const s of glyph.s) strokes.push(s.map(([gx, gy]) => [cursor + gx * k, y - gy * k]));
    cursor += glyph.a * k;
  }
  const lengthOf = (pts) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const total = strokes.reduce((n, s) => n + lengthOf(s), 0);
  let budget = Math.max(0, Math.min(1, progress)) * total;
  // A pen's even, round-capped line (EX3-81): readable at any size.
  const pen = { fill: 'none', stroke: color, 'stroke-width': Math.max(2, size * 0.08 * weight).toFixed(2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const path = (pts) => el('path', { ...pen, d: `M ${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L ')}` });
  const out = [];
  for (const s of strokes) {
    if (budget <= 0) break;
    const len = lengthOf(s);
    if (len <= budget) {
      out.push(path(s));
      budget -= len;
      continue;
    }
    // The stroke being written: cut it where the pen is now.
    const part = [s[0]];
    let left = budget;
    for (let i = 1; i < s.length && left > 0; i++) {
      const seg = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      if (seg <= left) {
        part.push(s[i]);
        left -= seg;
      } else {
        const u = left / seg;
        part.push([s[i - 1][0] + (s[i][0] - s[i - 1][0]) * u, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * u]);
        left = 0;
      }
    }
    if (part.length > 1) out.push(path(part));
    budget = 0;
  }
  // data-k/data-text let bounds.mjs find and name every piece of handwriting (EX3-92).
  return g({ 'data-role': role, 'data-k': 'text', 'data-text': String(text).replace(/[<>&"]/g, '') }, out);
}

/** A line between points with a little bow. */
export function handLine(pts, bow = 6, seed = 3) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const nx = -(y1 - y0);
    const ny = x1 - x0;
    const len = Math.hypot(nx, ny) || 1;
    const b = (r() - 0.5) * 2 * bow;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = Math.sin(Math.PI * t) * b;
      out.push([x0 + (x1 - x0) * t + (nx / len) * s, y0 + (y1 - y0) * t + (ny / len) * s]);
    }
  }
  return out;
}

/** Cursive "handwriting": words of slim loops with the odd tall ascender, slanted. Returns one
 *  point list per word. */
export function scribble(x, y, width, { height = 22, seed = 1, slant = 0.22, word = [3, 7], gap = 18 } = {}) {
  const r = rng(seed);
  const words = [];
  const adv = height * 0.6;
  let cx = x;
  while (cx < x + width - adv * 2) {
    const n = Math.floor(word[0] + r() * (word[1] - word[0] + 1));
    const pts = [];
    for (let i = 0; i < n && cx < x + width - adv; i++) {
      const tall = r() < 0.2 ? 1.75 : 0.72 + r() * 0.3;
      const h = height * tall;
      const b = adv * 0.34;
      for (let th = 0; th < 2 * Math.PI; th += 0.2) {
        const px = cx + (th / (2 * Math.PI)) * adv - b * Math.sin(th);
        const py = y - (h * (1 - Math.cos(th))) / 2;
        pts.push([px + (y - py) * slant, py]);
      }
      cx += adv;
    }
    pts.push([cx + adv * 0.4, y + 1]);
    words.push(pts);
    cx += gap;
  }
  return words;
}

/** Handwritten lines that write themselves. spec: [{ u, v, w, seed }]; p: lines written so far
 *  (fractional). Returns the ink and the pen tip, in the same local units as the spec. */
export function inkLines(spec, p, { color = line(), size = 3.8, height = 20 } = {}) {
  const out = [];
  let tip = null;
  spec.forEach((L, i) => {
    const f = Math.max(0, Math.min(1, p - i));
    if (f <= 0) return;
    const words = scribble(L.u, L.v, L.w, { seed: L.seed, height });
    const total = words.reduce((a, w) => a + w.length, 0);
    let budget = Math.max(2, Math.round(total * f));
    for (const w of words) {
      if (budget <= 1) break;
      const pts = w.slice(0, Math.min(w.length, budget));
      budget -= pts.length;
      if (pts.length > 1) out.push(el('path', { d: freehand(pts, { size, thinning: 0.55, smoothing: 0.5, streamline: 0.3, start: { taper: 4 }, end: { taper: f < 1 ? 0 : 10 } }), fill: color }));
      tip = pts[pts.length - 1];
    }
  });
  return { svg: out.join(''), tip };
}

// ── Tones: every palette color as the faces of a flat solid ───────────────────────────────
// Each entry is an array [top, left, right] (so `tones[0]`, `tones[1]`, `tones[2]` keep working
// in older props) carrying the named keys too: top (the lit top face), left (the front face, +y,
// lower left on screen: the mid tone), right (the side face, +x, lower right: the darker tone), and
// the ramp: lit, base, shade, dark. VISUAL_SYSTEM_5 §3: a lit top, a mid front, a darker side.
function tonesFrom({ top, left, right, lit, base, shade, dark }) {
  return Object.assign([top, left, right], { top, left, right, lit, base, shade, dark });
}
function rampTones(name) {
  const lit = T[`${name}-lit`];
  const base = T[name];
  const shade = T[`${name}-shade`];
  const dark = T[`${name}-dark`];
  return tonesFrom({ top: lit, left: base, right: shade, lit, base, shade, dark });
}
/** Faces from one hex: the lit top and the shade mixed toward white and ink. */
function hexTones(t) {
  const lit = mixHex(t, T.white, 0.22);
  const shade = mixHex(t, T.ink, 0.16);
  return tonesFrom({ top: lit, left: t, right: shade, lit, base: t, shade, dark: mixHex(t, T.ink, 0.4) });
}
export const TONES = Object.fromEntries(PALETTE.map((name) => [name, rampTones(name)]));
TONES.white = tonesFrom({ top: T.white, left: T['paper-lit'], right: T['paper-shade'], lit: T.white, base: T['paper-lit'], shade: T['paper-shade'], dark: T['paper-dark'] });

/**
 * Any tones value as named faces: a TONES entry, a palette name ('teal'), a palette token
 * ('ink-lit', 'wall'), `{ mix: [a, b, k] }`, one hex (lit and shade are mixed from it), a
 * { lit, base, shade, dark } ramp, or a [lit, mid, dark] triple (the lightest goes on the top, the
 * lighter of the other two on the front, the darker on the side). Names go through core
 * resolveTone, the one resolver set.js tone() uses too: an unknown color THROWS with the allowed
 * names. Nothing given (undefined, null) is paper.
 */
export function tonesOf(tones) {
  if (tones === undefined || tones === null) return TONES.paper;
  if (tones && typeof tones === 'object' && tones.top && tones.left && tones.right) return tones;
  if (typeof tones === 'string' && TONES[tones]) return TONES[tones];
  if (Array.isArray(tones) && tones.length >= 3) {
    const [top, a, b] = tones;
    const [left, right] = lum(a) >= lum(b) ? [a, b] : [b, a];
    const dark = isHex(right) ? mixHex(right, T.ink, 0.3) : right;
    return tonesFrom({ top, left, right, lit: top, base: left, shade: right, dark });
  }
  if (tones && typeof tones === 'object' && !Array.isArray(tones) && isHex(tones.base)) {
    const h = hexTones(tones.base);
    const lit = tones.lit ?? h.lit;
    const shade = tones.shade ?? h.shade;
    return tonesFrom({ top: lit, left: tones.base, right: shade, lit, base: tones.base, shade, dark: tones.dark ?? h.dark });
  }
  const t = resolveTone(tones);
  if (TONES[t]) return TONES[t];
  return hexTones(t);
}

// ── Solids (flat) ─────────────────────────────────────────────────────────────────────────
const poly = (pts) => pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');

/** A closed path through screen points with every corner rounded by r px (clamped per corner). */
export function roundedPath(pts, r) {
  const n = pts.length;
  if (!(r > 0) || n < 3) return `M ${pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join(' L ')} Z`;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1;
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const k = Math.min(r, la * 0.45, lb * 0.45);
    const p0 = [p[0] + ((a[0] - p[0]) / la) * k, p[1] + ((a[1] - p[1]) / la) * k];
    const p1 = [p[0] + ((b[0] - p[0]) / lb) * k, p[1] + ((b[1] - p[1]) / lb) * k];
    out.push(`${i ? 'L' : 'M'} ${f1(p0[0])} ${f1(p0[1])} Q ${f1(p[0])} ${f1(p[1])} ${f1(p1[0])} ${f1(p1[1])}`);
  }
  return out.join(' ') + ' Z';
}

/**
 * An isometric box in flat tones: the lit top (tones.top), the front face at +y (tones.left, the
 * mid tone) and the side face at +x (tones.right, the darker tone). No outline, gradient or
 * highlight. Standing on the floor (z = 0) it has one soft ink shadow (ink at 10%) just past its
 * footprint, away from the light; `shadow: false` skips it.
 * Returns the SVG and the screen corners of its top face, front (left) face and side (right) face.
 * The options of the old soft-volume signature (radius, gloss, outline, sw, ao) are ignored.
 */
export function isoBox(P, x, y, z, w, d, h, tones = TONES.paper, { shadow: cast = z === 0 } = {}) {
  const tn = tonesOf(tones);
  const A = P(x, y, z + h);
  const B = P(x + w, y, z + h);
  const Cc = P(x + w, y + d, z + h);
  const D = P(x, y + d, z + h);
  const B0 = P(x + w, y, z);
  const C0 = P(x + w, y + d, z);
  const D0 = P(x, y + d, z);
  const top = [A, B, Cc, D];
  const right = [B, Cc, C0, B0];
  const left = [D, Cc, C0, D0];
  const parts = [];
  if (cast && h > 0 && w > 0 && d > 0) {
    const reach = Math.min(Math.min(w, d) * 0.18, 12);
    const sh = [P(x - reach, y + d + reach, z), P(x + w + reach * 0.4, y + d + reach, z), P(x + w + reach * 0.4, y, z), P(x - reach, y, z)];
    parts.push(el('polygon', { points: poly(sh), fill: T.ink, 'fill-opacity': SHADOW_OPACITY }));
  }
  if (h > 0) {
    parts.push(el('polygon', { points: poly(left), fill: tn.left }));
    parts.push(el('polygon', { points: poly(right), fill: tn.right }));
  }
  parts.push(el('polygon', { points: poly(top), fill: tn.top }));
  return { svg: parts.join(''), top, left, right };
}

/**
 * An isometric disc or cylinder (any round thing, lying flat or standing), centered at screen
 * (cx, cy) on its top face; rx in screen px, h its height in screen px. Flat tones: the lit top,
 * the side in the mid tone with its right half in the darker tone. With `ao` (default) a thing
 * standing on something gets its soft ink shadow. `rings`, `gloss`, `outline` and `sw` are ignored.
 */
export function isoDisc(cx, cy, rx, h, tones = TONES.paper, { ao = true } = {}) {
  const tn = tonesOf(tones);
  const ry = rx * 0.577;
  const parts = [];
  if (ao && h > 0) parts.push(el('ellipse', { cx: f1(cx - rx * 0.05), cy: f1(cy + h + ry * 0.1), rx: f1(rx * 1.08), ry: f1(ry * 1.08), fill: T.ink, 'fill-opacity': SHADOW_OPACITY }));
  if (h > 0) {
    parts.push(el('path', { d: `M ${f1(cx - rx)} ${f1(cy)} L ${f1(cx - rx)} ${f1(cy + h)} A ${f1(rx)} ${f1(ry)} 0 0 0 ${f1(cx + rx)} ${f1(cy + h)} L ${f1(cx + rx)} ${f1(cy)} Z`, fill: tn.left }));
    parts.push(el('path', { d: `M ${f1(cx)} ${f1(cy)} L ${f1(cx + rx)} ${f1(cy)} L ${f1(cx + rx)} ${f1(cy + h)} A ${f1(rx)} ${f1(ry)} 0 0 1 ${f1(cx)} ${f1(cy + h + ry)} Z`, fill: tn.right }));
  }
  parts.push(el('ellipse', { cx: f1(cx), cy: f1(cy), rx: f1(rx), ry: f1(ry), fill: tn.top }));
  return parts.join('');
}

/** Retired: the finish is flat, so there is no gloss. Draws nothing (kept so older imports load). */
export function gloss(_shapeD, _o = {}) {
  return '';
}

/** The box of a path of absolute coordinates (the kit's paths: M L Q C A Z with numbers). */
function pathBox(d) {
  const nums = (String(d).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const xs = [];
  const ys = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push(nums[i]);
    ys.push(nums[i + 1]);
  }
  if (!xs.length) return null;
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * An organic filled shape (path d), flat: filled with `fill`, with a darker shade region along its
 * lower-left edge (away from the light). No outline, gradient or highlight. `form` 0 draws it
 * single-tone. A fill that is not a palette hex (a pattern, 'none') is drawn plain.
 */
export function softShape(d, fill = T['paper-lit'], { form = 1 } = {}) {
  if (!isHex(fill)) return el('path', { d, fill });
  if (!(form > 0)) return el('path', { d, fill });
  const b = pathBox(d);
  if (!b || !(b.w > 0 && b.h > 0)) return el('path', { d, fill });
  const k = Math.max(1.5, Math.min(10, Math.min(b.w, b.h) * 0.08 * form));
  const clip = clipOf(el('path', { d }));
  const shade = mixHex(fill, T.ink, lum(fill) < 70 ? 0.3 : 0.14);
  return defsOf(clip) + g({ 'clip-path': clip.paint }, [
    el('path', { d, fill: shade }),
    el('path', { d, fill, transform: `translate(${f1(k)} ${f1(-k)})` }),
  ]);
}

/** Lay flat 2D drawing on an iso plane (see core isoPlane). */
export const onPlane = (P, s, x, y, z, inner) => g({ transform: isoPlane(P, s, x, y, z) }, inner);

/** The one soft shadow under a thing that stands: a flat ink ellipse at `opacity` (ink at 10% by
 *  default; VISUAL_SYSTEM_5 §3). */
export function shadow(cx, cy, rx, ry, opacity = SHADOW_OPACITY) {
  return el('ellipse', { cx: f1(cx), cy: f1(cy), rx: f1(rx), ry: f1(ry), fill: T.ink, 'fill-opacity': +Math.min(0.3, opacity).toFixed(3) });
}

// ── Marks ─────────────────────────────────────────────────────────────────────────────────
/** A line that draws itself out (reference 1), optionally with a dot at its tip; p 0..1. */
export function drawLine(d, p, { color = T.green, width = 4, dotAt = null } = {}) {
  if (p <= 0) return '';
  const parts = [el('path', { d, pathLength: 1, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': `${p.toFixed(4)} 2` })];
  if (dotAt) parts.push(el('circle', { cx: dotAt[0], cy: dotAt[1], r: width * 2, fill: color }));
  return parts.join('');
}

/** A pulse ring lying flat on an iso plane, at a point of contact (u: 0..1 through it). */
export function ring(P, s, x, y, z, r0, r1, u, { color = line() } = {}) {
  if (u <= 0 || u >= 1) return '';
  const r = r0 + (r1 - r0) * Math.sqrt(u);
  return g({ transform: isoPlane(P, s, x, y, z), opacity: (1 - u) * 0.8 }, el('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: color, 'stroke-width': 6 / s }));
}

/** Cartoon shock marks: three short tapered strokes that pop out and fade (u: 0..1). */
export function shock(x, y, u, scale = 1, rays = [[-0.95, -0.55], [-0.35, -1], [0.35, -1.05]]) {
  if (u <= 0 || u >= 1) return '';
  const grow = Math.min(1, u / 0.25);
  const fade = 1 - Math.max(0, (u - 0.7) / 0.3);
  return g({ opacity: fade }, rays.map(([dx, dy]) => {
    const x0 = x + dx * 26 * scale;
    const y0 = y + dy * 26 * scale;
    return stroke([[x0, y0], [x0 + dx * 34 * scale * grow, y0 + dy * 34 * scale * grow]], { size: 7 * scale, thinning: 0.5, start: { taper: 2 }, end: { taper: 8 } });
  }));
}

/** A 24-unit line icon (Lucide style), centered at (x, y), size px wide. Markings only (V-17). */
export function icon(name, x, y, size = 64, { color = line(), sw = 2 } = {}) {
  const paths = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    code: '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5-9 8.5"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h4"/>',
    chat: '<path d="M20.5 12a8 8 0 0 1-11.8 7L3.5 20.5 5 15.6A8 8 0 1 1 20.5 12z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  }[name];
  if (!paths) throw new Error(`HX: no icon "${name}"; draw the marking instead (V-4).`);
  const k = size / 24;
  return g({ transform: `translate(${x - size / 2} ${y - size / 2}) scale(${k})`, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, paths);
}
