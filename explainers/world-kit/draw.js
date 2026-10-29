// The Explainers world kit, drawing (hx-4, visual system 4.0: Soft 3D, still 08): the style
// primitives every object is built from. The kit is a style, not a catalog (X-39): these are the
// parts every new object is built from. Finished pieces built from them live in examples.js.
//
//   solids:   soft volumes lit from the top right (core LIGHT): per-face gradients, rounded edges
//             with a bright edge highlight, no ink outline, a soft contact shadow and ambient
//             occlusion where they meet the surface below, gloss on glossy things
//   shapes:   softShape(): an organic filled shape with a soft form shadow and a lit edge
//   marks:    handwriting that writes itself, lines that draw themselves out, pulse rings,
//             shock marks, line icons (line() is their color: ink on paper, light on the stage)
//   grounds:  paper (a warm studio sweep), stage (the Helios premium lit stage), white (the
//             close). No grid, no grain, no wobble, no stipple: those exports stay as no-ops or
//             smooth versions so older scene code keeps working.
//
// Every color comes from the core palette (V-T1) and its ramps; tints between two palette colors
// are mixed by core mixHex. Every function returns an SVG string and is a pure function of its
// arguments, so a frame is a pure function of time (E2-06). Def ids are hashed from their content,
// so a def drawn twice is the same def and ids never depend on draw order.

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
import { TOKENS as T, GROUNDS, FRAME, rng, isoPlane, groundOf, mixHex, resolveTone } from './core.js';
import { HERSHEY_CAP, HERSHEY_SANS } from './hershey-sans.js';

export { T };
export const W = FRAME.w;
export const H = FRAME.h;

// ── Scope: ids and the ground of the shot being drawn ─────────────────────────────────────
let PFX = '';
let DARK = false;
let GROUND_NAME = 'paper';

/** Call first in every shot draw: scopes SVG ids to the shot (several shots share one
 *  document) and sets the ground (`paper`, `stage`, `white`; `night` and `forest` draw as the
 *  stage), which picks light-on-dark marks and rim light on the stage. */
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
/** The color for the few line marks that remain (icons, handwriting, ticks): ink on paper,
 *  paper-lit on the stage (V-3). Solids never take an outline. */
export const line = () => (DARK ? T['paper-lit'] : T.ink);

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

/** A linear gradient def and its paint: stops [[offset, color, opacity?], …], in the shape's box. */
function lin(stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  const inner = stops.map(([o, c, a = 1]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a === 1 ? undefined : +a.toFixed(3) })).join('');
  const gid = hid('l', `${x1},${y1},${x2},${y2}|${inner}`);
  return { def: el('linearGradient', { id: gid, x1, y1, x2, y2 }, inner), paint: `url(#${gid})` };
}
/** A radial gradient def and its paint, in the shape's box. */
function rad(stops, cx = 0.5, cy = 0.5, r = 0.5, extra = {}) {
  const inner = stops.map(([o, c, a = 1]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a === 1 ? undefined : +a.toFixed(3) })).join('');
  const gid = hid('r', `${cx},${cy},${r},${JSON.stringify(extra)}|${inner}`);
  return { def: el('radialGradient', { id: gid, cx, cy, r, ...extra }, inner), paint: `url(#${gid})` };
}
/** A clip path def from inner SVG, and its reference. */
function clipOf(inner) {
  const cid = hid('c', inner);
  return { def: el('clipPath', { id: cid }, inner), paint: `url(#${cid})` };
}
const defsOf = (...list) => el('defs', {}, list.map((x) => x.def).join(''));

// ── Filters ───────────────────────────────────────────────────────────────────────────────
// soft-shadow: a wide blur for cast shadows · ao: a tight blur for occlusion where things meet
// · glow: a lit thing's bloom over itself · blur-bg / blur-fg: depth of field for the parallax
// layers · soft-edge: the form shadow and lit edge inside a soft shape. No wobble, no grain, no
// stipple (hx-4). The options of the old signature are accepted and ignored.
export function defs(_old = {}) {
  const blur = (fid, sd, pad = '-60%', size = '220%') =>
    el('filter', { id: id(fid), x: pad, y: pad, width: size, height: size, 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: sd }));
  return el('defs', {}, [
    blur('soft-shadow', 9, '-80%', '260%'),
    blur('ao', 3.2, '-80%', '260%'),
    blur('soft-edge', 2.2, '-20%', '140%'),
    blur('blur-bg', 5),
    blur('blur-fg', 9),
    el('filter', { id: id('glow'), x: '-60%', y: '-60%', width: '220%', height: '220%', 'color-interpolation-filters': 'sRGB' }, [
      el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 10, result: 'b' }),
      el('feMerge', {}, el('feMergeNode', { in: 'b' }) + el('feMergeNode', { in: 'SourceGraphic' })),
    ].join('')),
    // shared gradients: a specular band (gloss) and a soft contact shadow, in the shape's box
    el('linearGradient', { id: id('spec'), x1: 0.95, y1: 0, x2: 0.25, y2: 0.8 }, [
      el('stop', { offset: 0, 'stop-color': T.canvas, 'stop-opacity': 0.6 }),
      el('stop', { offset: 0.34, 'stop-color': T.canvas, 'stop-opacity': 0.14 }),
      el('stop', { offset: 0.35, 'stop-color': T.canvas, 'stop-opacity': 0 }),
    ].join('')),
    el('radialGradient', { id: id('contact'), cx: 0.5, cy: 0.5, r: 0.5 }, [
      el('stop', { offset: 0, 'stop-color': T['shadow-warm'], 'stop-opacity': 0.34 }),
      el('stop', { offset: 0.5, 'stop-color': T['shadow-warm'], 'stop-opacity': 0.18 }),
      el('stop', { offset: 1, 'stop-color': T['shadow-warm'], 'stop-opacity': 0 }),
    ].join('')),
  ].join(''));
}

/** Smooth shading (hx-4; it used to be riso stipple): `shape` filled with `color`, fading from
 *  `from` to `to` opacity along the given direction. Same signature as before; `fine` is ignored. */
export function stippleShade(shapeTag, shapeAttrs, color, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, from = 0, to = 1 } = {}) {
  const k = 0.75; // a smooth gradient reads stronger than grain did
  const gr = lin([[0, color, from * k], [1, color, to * k]], x1, y1, x2, y2);
  return defsOf(gr) + el(shapeTag, { ...shapeAttrs, fill: gr.paint });
}

// ── Grounds ───────────────────────────────────────────────────────────────────────────────
/** An elliptical radial glow over the whole frame: centre (fx, fy) and radii (rx, ry) as shares
 *  of the frame, fading from `alpha` to 0 by `end`. */
function frameGlow(color, alpha, fx, fy, rx, ry, end = 0.72) {
  const gr = rad([[0, color, alpha], [end * 0.55, color, alpha * 0.45], [end, color, 0]], 0, 0, 1, { gradientTransform: `translate(${fx} ${fy}) scale(${rx} ${ry})` });
  return defsOf(gr) + el('rect', { x: 0, y: 0, width: W, height: H, fill: gr.paint });
}

/** The ground: `paper` the warm studio sweep (light top, a soft floor falloff low, a faint warm
 *  key-light bloom top right), `stage` the Helios premium lit stage (charcoal under a warm glow top
 *  right, a white lift top left, a red bloom low, a warm pool where the scene stands), `white` the
 *  close. Draw once, under the world. `night` and `forest` draw the stage. */
export function ground(name = 'paper') {
  const gr = groundOf(name);
  if (gr.name === 'white') return el('rect', { x: 0, y: 0, width: W, height: H, fill: GROUNDS.white.fill });
  if (gr.name === 'stage') {
    const base = lin([[0, T['stage-top']], [1, T['stage-bottom']]]);
    return [
      defsOf(base),
      el('rect', { x: 0, y: 0, width: W, height: H, fill: base.paint }),
      frameGlow(T['stage-orange'], 0.17, 1, 0, 0.66, 0.44),
      frameGlow(T.canvas, 0.05, 0, 0, 0.55, 0.38, 0.7),
      frameGlow(T['stage-red'], 0.1, 0.15, 1, 0.7, 0.3),
      frameGlow(T['stage-orange'], 0.07, 0.5, 0.64, 0.62, 0.2, 0.9),
    ].join('');
  }
  const sweep = lin([[0, T['paper-lit']], [0.42, mixHex(T['paper-lit'], T.paper, 0.55)], [0.74, T.paper], [1, T['paper-sweep']]]);
  return [
    defsOf(sweep),
    el('rect', { x: 0, y: 0, width: W, height: H, fill: sweep.paint }),
    frameGlow(T.canvas, 0.7, 0.98, 0.02, 0.75, 0.42, 0.85),
    frameGlow(T['yellow-lit'], 0.06, 1, 0, 0.6, 0.34),
    // the floor falls off toward the bottom corners
    frameGlow(T['shadow-warm'], 0.05, 0, 1, 0.55, 0.3, 0.9),
    frameGlow(T['shadow-warm'], 0.035, 1, 1, 0.5, 0.26, 0.9),
  ].join('');
}

/** hx-4 has no drafting grid: always ''. The signature stays for older callers. */
export function grid(_o = {}) {
  return '';
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

// ── Tones: every palette color as the faces of a soft volume ──────────────────────────────
// Each entry is an array [top, left, right] (so `tones[0]`, `tones[1]`, `tones[2]` keep working
// in older props) carrying the named keys too: top (the lit top face), left (the face turned away
// from the light, lower left), right (the face toward it, lower right), and the ramp: lit, base,
// shade, dark. The light comes from the top right (core LIGHT), so right is lighter than left.
function tonesFrom({ top, left, right, lit, base, shade, dark }) {
  return Object.assign([top, left, right], { top, left, right, lit, base, shade, dark });
}
function rampTones(name) {
  const lit = T[`${name}-lit`];
  const base = T[name];
  const shade = T[`${name}-shade`];
  const dark = T[`${name}-dark`];
  return tonesFrom({ top: lit, left: shade, right: base, lit, base, shade, dark });
}
const INK_TOP = mixHex(T['ink-lit'], T['paper-lit'], 0.12);
export const TONES = {
  paper: rampTones('paper'),
  // ink volumes are lifted a touch so their faces read as a volume, not a hole
  ink: tonesFrom({ top: INK_TOP, left: T.ink, right: mixHex(T['ink-lit'], T['paper-lit'], 0.05), lit: INK_TOP, base: T['ink-lit'], shade: T.ink, dark: T['ink-dark'] }),
  orange: rampTones('orange'),
  green: rampTones('green'),
  yellow: rampTones('yellow'),
  blue: rampTones('blue'),
  teal: rampTones('teal'),
  lilac: rampTones('lilac'),
  red: rampTones('red'),
};

/**
 * Any tones value as named faces: a TONES entry, a palette name ('teal'), a palette token
 * ('ink-lit', 'green-shade'), `{ mix: [a, b, k] }`, one hex (a ramp is mixed from it), a
 * { lit, base, shade, dark } ramp, or an older [top, mid, dark] array (its lighter side tone goes
 * on the lit right face, so every box takes the one light). Names go through core resolveTone,
 * the one resolver set.js tone() uses too: an unknown color THROWS with the allowed names (it
 * used to fall back to paper and render white). Nothing given (undefined, null) is paper.
 */
export function tonesOf(tones) {
  if (tones === undefined || tones === null) return TONES.paper;
  if (tones && typeof tones === 'object' && tones.top && tones.left && tones.right) return tones;
  if (typeof tones === 'string' && TONES[tones]) return TONES[tones];
  if (Array.isArray(tones) && tones.length >= 3) {
    const [top, a, b] = tones;
    const [right, left] = lum(a) >= lum(b) ? [a, b] : [b, a];
    const dark = isHex(left) ? mixHex(left, T.ink, 0.3) : left;
    return tonesFrom({ top, left, right, lit: top, base: right, shade: left, dark });
  }
  if (tones && typeof tones === 'object' && !Array.isArray(tones) && isHex(tones.base)) {
    const { base } = tones;
    const lit = tones.lit ?? mixHex(base, T.canvas, 0.22);
    const shade = tones.shade ?? mixHex(base, T.ink, 0.16);
    return tonesFrom({ top: lit, left: shade, right: base, lit, base, shade, dark: tones.dark ?? mixHex(base, T.ink, 0.4) });
  }
  const t = resolveTone(tones);
  if (TONES[t]) return TONES[t];
  const lit = mixHex(t, T.canvas, 0.22);
  const shade = mixHex(t, T.ink, 0.16);
  return tonesFrom({ top: lit, left: shade, right: t, lit, base: t, shade, dark: mixHex(t, T.ink, 0.4) });
}

/** A tint toward white (k 0..1), for hex colors; other paints pass through. */
const lift = (c, k) => (isHex(c) ? mixHex(c, T.canvas, k) : c);
/** A tint toward a darker color (k 0..1), for hex colors. */
const sink = (c, to, k) => (isHex(c) && isHex(to) ? mixHex(c, to, k) : c);

// ── Solids (soft volumes) ─────────────────────────────────────────────────────────────────
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
 * An isometric box as a soft volume: per-face gradients from the one light (top brightest, the
 * right face lit, the left face in shade, each falling off toward the floor), rounded silhouette
 * corners, a bright highlight on the lit edges, soft occlusion where it meets the surface below
 * and, standing on the floor (z = 0), a soft cast shadow thrown to the lower left. On the stage a
 * warm rim light runs along its lit edges.
 * Returns the SVG and the screen corners of its top face, left face and right face (as before).
 * Options: radius (px), gloss (a specular band on the top and a sheen on the lit face), outline
 * (an ink outline, off by default), ao and shadow (set false to skip them). `sw` and `grain` are
 * accepted and ignored.
 */
export function isoBox(P, x, y, z, w, d, h, tones = TONES.paper, { radius = 6, gloss: glossy = false, outline = false, sw = 3.5, ao = true, shadow: cast = z === 0 } = {}) {
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
  const edge = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const minEdge = Math.min(edge(A, B), edge(B, Cc), h > 0 ? edge(Cc, C0) : Infinity);
  const r = Math.max(0, Math.min(radius, minEdge * 0.3));
  const hw = Math.max(1.4, Math.min(5, r * 0.55, minEdge * 0.08));
  // under it: the cast shadow on the floor (to the lower left, away from the light), then occlusion
  if (cast && h > 0 && w > 0 && d > 0) {
    const reach = Math.min(h * 0.55, 60);
    const sh = [P(x, y, z), P(x + w, y, z), P(x + w, y + d + reach, z), P(x - reach * 0.15, y + d + reach, z)];
    parts.push(el('polygon', { points: poly(sh), fill: DARK ? T.ink : T['shadow-warm'], opacity: DARK ? 0.55 : 0.16, filter: ref('soft-shadow') }));
  }
  if (ao && h > 0) {
    const wAO = Math.max(4, Math.min(16, minEdge * 0.16));
    parts.push(el('polyline', { points: poly([D0, C0, B0]), fill: 'none', stroke: DARK ? T.ink : T['shadow-warm'], 'stroke-width': wAO.toFixed(1), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: DARK ? 0.7 : 0.3, transform: `translate(0 ${(wAO * 0.25).toFixed(1)})`, filter: ref('ao') }));
  }
  const silhouette = h > 0 ? [A, B, B0, C0, D0, D] : top;
  const clip = clipOf(el('path', { d: roundedPath(silhouette, r) }));
  // the face paints: the top lit toward the back right, the sides falling off toward the floor
  // the top: lit toward the back right; on the stage the warm key catches it and the front sinks
  const topG = DARK
    ? lin([[0, sink(tn.top, T['stage-orange'], 0.05)], [1, sink(tn.top, T['stage-bottom'], 0.22)]], 1, 0, 0.1, 1)
    : lin([[0, lift(tn.top, 0.3)], [1, tn.top]], 1, 0, 0.1, 1);
  // on the stage the ambient is low: the face turned away sinks toward the charcoal, and the lit
  // face takes a little of the warm key
  const leftBase = DARK ? sink(tn.left, T['stage-bottom'], 0.45) : tn.left;
  const rightBase = DARK ? sink(sink(tn.right, T['stage-bottom'], 0.14), T['stage-orange'], 0.06) : tn.right;
  const leftG = lin([[0, leftBase], [1, sink(leftBase, tn.dark, 0.55)]]);
  const rightG = lin([[0, lift(rightBase, 0.08)], [0.55, rightBase], [1, sink(rightBase, tn.shade, 0.6)]]);
  const inner = [];
  const extra = [];
  if (h > 0) {
    inner.push(el('path', { d: roundedPath(silhouette, r), fill: tn.left }));
    inner.push(el('polygon', { points: poly(left), fill: leftG.paint }));
    inner.push(el('polygon', { points: poly(right), fill: rightG.paint }));
  }
  inner.push(el('polygon', { points: poly(top), fill: topG.paint }));
  if (glossy) {
    inner.push(gloss(`M ${poly(top).replace(/ /g, ' L ').replace(/,/g, ' ')} Z`, { strength: 1 }));
    if (h > 0) inner.push(el('polygon', { points: poly(right), fill: lin([[0, T.canvas, 0], [0.62, T.canvas, 0], [0.74, T.canvas, 0.22], [0.86, T.canvas, 0]], 0, 0, 1, 0).paint }));
  }
  // the rounded edges catch the light: the top's front rim, and the vertical edge between sides
  if (h > 0) {
    inner.push(el('polyline', { points: poly([D, Cc, B]), fill: 'none', stroke: lift(tn.top, 0.5), 'stroke-width': hw.toFixed(1), 'stroke-linejoin': 'round', opacity: DARK ? 0.45 : 0.7 }));
    inner.push(el('line', { x1: f1(Cc[0]), y1: f1(Cc[1]), x2: f1(C0[0]), y2: f1(C0[1]), stroke: lift(tn.right, 0.4), 'stroke-width': (hw * 0.7).toFixed(1), opacity: DARK ? 0.25 : 0.45 }));
    // the side faces darken where they meet the floor (occlusion inside the volume)
    const foot = lin([[0, T['shadow-warm'], 0], [0.7, T['shadow-warm'], 0], [1, T['shadow-warm'], DARK ? 0.35 : 0.14]]);
    inner.push(el('polygon', { points: poly([D, Cc, B, B0, C0, D0]), fill: foot.paint }));
    extra.push(foot);
  }
  if (DARK) {
    // the warm key light rims the lit edges on the stage
    inner.push(el('polyline', { points: poly(h > 0 ? [A, B, B0] : [A, B, Cc]), fill: 'none', stroke: T['stage-orange'], 'stroke-width': Math.max(1.6, hw * 0.9).toFixed(1), 'stroke-linejoin': 'round', opacity: 0.45 }));
  }
  parts.push(defsOf(clip, topG, leftG, rightG, ...extra), g({ 'clip-path': clip.paint }, inner));
  if (outline) {
    const o = { fill: 'none', stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' };
    parts.push(el('polygon', { ...o, points: poly(silhouette) }));
    if (h > 0) {
      parts.push(el('polyline', { ...o, points: poly([D, Cc, B]) }));
      parts.push(el('line', { ...o, x1: Cc[0], y1: Cc[1], x2: C0[0], y2: C0[1] }));
    }
  }
  return { svg: parts.join(''), top, left, right };
}

/**
 * An isometric disc or cylinder (a coin, a knob, a pot, a wheel lying flat), centered at screen
 * (cx, cy) on its top face; rx in screen px, h its height in screen px. A soft volume: the side
 * lit from the right with a specular stripe, the top lit toward the back right with a bright front
 * rim, `rings` soft grooves on the top, occlusion under it. Options: rings, gloss, outline;
 * `sw` is the outline weight when outline is on.
 */
export function isoDisc(cx, cy, rx, h, tones = TONES.paper, { sw = 2.5, rings = 1, gloss: glossy = false, outline = false, ao = true } = {}) {
  const tn = tonesOf(tones);
  const ry = rx * 0.577;
  const parts = [];
  const list = [];
  if (ao) {
    const by = cy + Math.max(0, h);
    parts.push(el('ellipse', { cx: f1(cx - rx * 0.06), cy: f1(by + ry * 0.12), rx: f1(rx * 1.04), ry: f1(ry * 1.1), fill: DARK ? T.ink : T['shadow-warm'], opacity: DARK ? 0.6 : h > 0 ? 0.26 : 0.18, filter: ref('ao') }));
  }
  if (h > 0) {
    const sideBase = DARK ? sink(tn.left, T['stage-bottom'], 0.25) : tn.left;
    const side = lin([[0, sink(sideBase, tn.dark, 0.45)], [0.32, sideBase], [0.68, tn.right], [0.84, lift(tn.right, glossy ? 0.4 : 0.18)], [1, sink(tn.right, tn.shade, 0.5)]], 0, 0, 1, 0);
    list.push(side);
    const d = `M ${f1(cx - rx)} ${f1(cy)} L ${f1(cx - rx)} ${f1(cy + h)} A ${f1(rx)} ${f1(ry)} 0 0 0 ${f1(cx + rx)} ${f1(cy + h)} L ${f1(cx + rx)} ${f1(cy)} Z`;
    parts.push(el('path', { d, fill: side.paint }));
    // the side darkens toward the floor
    const foot = lin([[0, T['shadow-warm'], 0], [0.6, T['shadow-warm'], 0], [1, T['shadow-warm'], DARK ? 0.3 : 0.12]]);
    list.push(foot);
    parts.push(el('path', { d, fill: foot.paint }));
  }
  const topG = rad([[0, lift(tn.top, DARK ? 0.12 : 0.32)], [0.7, tn.top], [1, sink(tn.top, tn.right, 0.5)]], 0.66, 0.28, 0.8);
  list.push(topG);
  parts.push(el('ellipse', { cx: f1(cx), cy: f1(cy), rx: f1(rx), ry: f1(ry), fill: topG.paint }));
  for (let i = 1; i <= rings; i++) {
    const k = 1 - i * 0.32;
    if (k <= 0.05) break;
    parts.push(el('ellipse', { cx: f1(cx), cy: f1(cy), rx: f1(rx * k), ry: f1(ry * k), fill: 'none', stroke: sink(tn.top, tn.shade, 0.7), 'stroke-width': Math.max(1.2, rx * 0.03).toFixed(1), opacity: 0.7 }));
    parts.push(el('path', { d: `M ${f1(cx - rx * k)} ${f1(cy + 1.4)} A ${f1(rx * k)} ${f1(ry * k)} 0 0 0 ${f1(cx + rx * k)} ${f1(cy + 1.4)}`, fill: 'none', stroke: lift(tn.top, 0.7), 'stroke-width': Math.max(1, rx * 0.022).toFixed(1), opacity: 0.8 }));
  }
  if (glossy) parts.push(gloss(`M ${f1(cx - rx)} ${f1(cy)} A ${f1(rx)} ${f1(ry)} 0 1 0 ${f1(cx + rx)} ${f1(cy)} A ${f1(rx)} ${f1(ry)} 0 1 0 ${f1(cx - rx)} ${f1(cy)} Z`, { strength: 0.9 }));
  if (h > 0) {
    // the rounded front rim of the top catches the light
    parts.push(el('path', { d: `M ${f1(cx - rx * 0.97)} ${f1(cy + ry * 0.08)} A ${f1(rx)} ${f1(ry)} 0 0 0 ${f1(cx + rx * 0.97)} ${f1(cy + ry * 0.08)}`, fill: 'none', stroke: lift(tn.top, 0.62), 'stroke-width': Math.max(1.4, Math.min(4, rx * 0.045)).toFixed(1), 'stroke-linecap': 'round', opacity: DARK ? 0.5 : 0.9 }));
  }
  if (DARK) parts.push(el('path', { d: `M ${f1(cx + rx * 0.2)} ${f1(cy - ry)} A ${f1(rx)} ${f1(ry)} 0 0 1 ${f1(cx + rx)} ${f1(cy)}${h > 0 ? ` L ${f1(cx + rx)} ${f1(cy + h)}` : ''}`, fill: 'none', stroke: T['stage-orange'], 'stroke-width': 2, opacity: 0.55 }));
  if (outline) {
    if (h > 0) parts.push(el('path', { d: `M ${cx - rx} ${cy} L ${cx - rx} ${cy + h} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy + h} L ${cx + rx} ${cy}`, fill: 'none', stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' }));
    parts.push(el('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: line(), 'stroke-width': sw }));
  }
  return defsOf(...list) + parts.join('');
}

/**
 * A specular highlight over a shape (path d): a soft-edged band of light across its top-right
 * part, in the shape's own box. strength 0..1.
 */
export function gloss(shapeD, { strength = 1 } = {}) {
  const s = Math.max(0, Math.min(1, strength));
  const gr = lin([[0, T.canvas, 0.62 * s], [0.3, T.canvas, 0.2 * s], [0.31, T.canvas, 0.06 * s], [0.5, T.canvas, 0]], 0.95, 0, 0.3, 0.75);
  return defsOf(gr) + el('path', { d: shapeD, fill: gr.paint });
}

/**
 * An organic filled shape (path d) as a soft volume: the fill as a gradient lit from the top
 * right, a soft form shadow inside its lower-left edge and a lit rim inside its top-right edge.
 * No ink stroke. A fill that is not a palette hex (a gradient, 'none') is drawn flat.
 */
export function softShape(d, fill = T['paper-lit'], { gloss: glossy = false, form = 1 } = {}) {
  if (!isHex(fill)) return el('path', { d, fill });
  const dark = lum(fill) < 70;
  const hi = mixHex(fill, T.canvas, dark ? 0.16 : 0.3);
  const lo = mixHex(fill, dark ? T['ink-dark'] : T['shadow-warm'], dark ? 0.35 : 0.2);
  const body = lin([[0, hi], [0.5, fill], [1, lo]], 0.85, 0.05, 0.15, 0.95);
  const clip = clipOf(el('path', { d }));
  const out = [defsOf(body, clip), el('path', { d, fill: body.paint })];
  if (form > 0) {
    out.push(g({ 'clip-path': clip.paint }, [
      el('path', { d, fill: 'none', stroke: mixHex(fill, dark ? T['ink-dark'] : T['shadow-warm'], 0.55), 'stroke-width': 7, opacity: (0.42 * form).toFixed(2), transform: 'translate(2.5 -3)', filter: ref('soft-edge') }),
      el('path', { d, fill: 'none', stroke: mixHex(fill, T.canvas, 0.7), 'stroke-width': 4, opacity: ((dark ? 0.35 : 0.75) * form).toFixed(2), transform: 'translate(-1.8 2.2)', filter: ref('soft-edge') }),
    ]));
  }
  if (glossy) out.push(gloss(d, { strength: 0.8 }));
  if (DARK) out.push(g({ 'clip-path': clip.paint }, el('path', { d, fill: 'none', stroke: T['stage-orange'], 'stroke-width': 4, opacity: 0.55, transform: 'translate(-3.5 3.5)', filter: ref('soft-edge') })));
  return out.join('');
}

/** Lay flat 2D drawing on an iso plane (see core isoPlane). */
export const onPlane = (P, s, x, y, z, inner) => g({ transform: isoPlane(P, s, x, y, z) }, inner);

/** A soft contact shadow under a thing: a warm, blurred-edge ellipse (a radial falloff, no
 *  filter needed). `opacity` is the old flat shadow's; the soft one peaks a little darker. */
export function shadow(cx, cy, rx, ry, opacity = 0.12) {
  const a = Math.min(0.9, opacity * (DARK ? 4.5 : 2.4));
  const color = DARK ? T['ink-dark'] : T['shadow-warm'];
  const gr = rad([[0, color, a], [0.45, color, a * 0.62], [0.78, color, a * 0.18], [1, color, 0]]);
  return defsOf(gr) + el('ellipse', { cx: f1(cx), cy: f1(cy), rx: f1(rx * 1.18), ry: f1(ry * 1.28), fill: gr.paint });
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
