// The Explainers world kit, drawing (hx-3, from Explainer 2.0): the style primitives of "Cast on grid" (X-34).
// The kit is a style, not a catalog (X-39): these are the parts every new object is built from
// (VISUAL V-2 to V-4, V-15). Finished pieces built from them live in examples.js.
//
//   the hand: a boiling line wobble, riso stipple, paper grain, freehand ink (perfect-freehand)
//   solids:   isometric boxes with three flat tones and an ink outline; drawing laid flat on an
//             iso plane; contact shadows
//   marks:    handwriting that writes itself, lines that draw themselves out, pulse rings,
//             shock marks, line icons
//   grounds:  paper with a fading grid, night, forest; on dark grounds every outline and limb
//             swaps to light-on-dark by itself (V-3)
//
// Every color comes from the core palette (V-T1). Every function returns an SVG string and is a
// pure function of its arguments, so a frame is a pure function of time (E2-06).

import { getStroke } from 'https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.3/+esm';
import { TOKENS as T, GROUNDS, FRAME, rng, isoPlane } from './core.js';
import { HERSHEY_CAP, HERSHEY_SANS } from './hershey-sans.js';

export { T };
export const W = FRAME.w;
export const H = FRAME.h;

// ── Scope: ids and the ground of the shot being drawn ─────────────────────────────────────
let PFX = '';
let DARK = false;
let GROUND_NAME = 'paper';
let gradientCount = 0;

/** Call first in every shot draw: scopes SVG ids to the shot (several shots share one
 *  document) and sets the ground, which picks light-on-dark drawing on night and forest. */
export function scope(prefix, ground = 'paper') {
  if (!GROUNDS[ground]) throw new Error(`HX: ground must be ${Object.keys(GROUNDS).join(', ')} (V-14).`);
  PFX = prefix;
  DARK = GROUNDS[ground].dark;
  GROUND_NAME = ground;
  gradientCount = 0;
}
export const id = (name) => PFX + name;
export const ref = (name) => `url(#${PFX}${name})`;
export const isDark = () => DARK;
/** The ground of the shot being drawn (the last scope() call). */
export const groundName = () => GROUND_NAME;
/** The line color for the current ground: ink on paper, paper-lit on dark grounds (V-3). */
export const line = () => (DARK ? T['paper-lit'] : T.ink);

const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
export const el = (tag, o = {}, inner = '') => `<${tag} ${attrs(o)}>${inner}</${tag}>`;
export const g = (o, inner) => el('g', o, Array.isArray(inner) ? inner.join('') : inner);

// ── The hand: filters ─────────────────────────────────────────────────────────────────────
// wobble: a slight hand tremor on linework; its seed steps at 10 fps in motion, so lines boil.
// stipple: dissolves a soft gradient into grain, for riso shading on flat faces.
// grain: the ground's own fibre (dark on paper, light on dark grounds).
export function defs({ wobble = 3, wobbleSeed = 4 } = {}) {
  return el('defs', {}, [
    el('filter', { id: id('wobble'), x: '-5%', y: '-5%', width: '110%', height: '110%' }, [
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.022', numOctaves: 2, seed: wobbleSeed, result: 'n' }),
      el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: wobble, xChannelSelector: 'R', yChannelSelector: 'G' }),
    ].join('')),
    stippleFilter(id('stipple'), 1.1, 7),
    stippleFilter(id('stipple-fine'), 1.7, 9),
    el('filter', { id: id('grain'), x: 0, y: 0, width: '100%', height: '100%' }, [
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 3, seed: 11, result: 'n' }),
      DARK
        ? el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.98  0 0 0 0 0.98  0 0 0 0 0.96  0.9 0.9 0.9 0 -1.25' })
        : el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.09  0 0 0 0 0.09  0 0 0 0 0.09  0.9 0.9 0.9 0 -1.2' }),
    ].join('')),
  ].join(''));
}

function stippleFilter(fid, freq, seed) {
  return el('filter', { id: fid, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' }, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: freq, numOctaves: 2, seed, result: 'n' }),
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.3', result: 'na' }),
    el('feComposite', { in: 'SourceAlpha', in2: 'na', operator: 'arithmetic', k1: 0, k2: 1, k3: -1, k4: 0, result: 'd' }),
    el('feComponentTransfer', { in: 'd', result: 'm' }, el('feFuncA', { type: 'discrete', tableValues: '0 1' })),
    el('feComposite', { in: 'SourceGraphic', in2: 'm', operator: 'in' }),
  ].join(''));
}

/** Riso shading: `shape` filled with `color`, fading from `from` to `to` opacity along the given
 *  direction, dissolved into grain. Never a smooth gradient (V-3). */
export function stippleShade(shapeTag, shapeAttrs, color, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, from = 0, to = 1, fine = false } = {}) {
  const gid = `${PFX}sg${++gradientCount}`;
  return [
    el('linearGradient', { id: gid, x1, y1, x2, y2 }, [
      el('stop', { offset: 0, 'stop-color': color, 'stop-opacity': from }),
      el('stop', { offset: 1, 'stop-color': color, 'stop-opacity': to }),
    ].join('')),
    el(shapeTag, { ...shapeAttrs, fill: `url(#${gid})`, filter: ref(fine ? 'stipple-fine' : 'stipple') }),
  ].join('');
}

// ── Grounds (V-14) ────────────────────────────────────────────────────────────────────────
/** The ground fill and its grain. Draw once, under the world. */
export function ground(name = 'paper') {
  if (name === 'white') return el('rect', { x: 0, y: 0, width: W, height: H, fill: GROUNDS.white.fill });
  return [
    el('rect', { x: 0, y: 0, width: W, height: H, fill: GROUNDS[name].fill }),
    el('rect', { x: 0, y: 0, width: W, height: H, filter: ref('grain'), opacity: GROUNDS[name].dark ? 0.22 : 0.3 }),
  ].join('');
}

/** The drafting table's grid, fading out toward the top and bottom. Scale `cell` with the
 *  camera distance so distance reads (V-2). `rot` rolls the lines about `pivot` (a camera roll);
 *  they then run past the frame edge so the roll never shows a corner. The fade and vignette stay
 *  on the frame. */
export function grid({ cell = 72, top = 560, bottom = 1560, ox = 0, oy = 0, rot = 0, pivot = [W / 2, H / 2] } = {}) {
  const pad = rot ? Math.ceil(240 / cell) * cell : 0;
  const lines = [];
  for (let x = (ox % cell) - pad; x <= W + pad; x += cell) lines.push(el('line', { x1: x, y1: -pad, x2: x, y2: H + pad }));
  for (let y = (oy % cell) - pad; y <= H + pad; y += cell) lines.push(el('line', { x1: -pad, y1: y, x2: W + pad, y2: y }));
  const rolled = rot ? [g({ transform: `rotate(${(-rot).toFixed(4)} ${pivot[0]} ${pivot[1]})` }, lines)] : lines;
  const edge = DARK ? T.night : T['paper-shade'];
  return [
    el('linearGradient', { id: id('gridfade'), x1: 0, y1: 0, x2: 0, y2: 1 }, [
      el('stop', { offset: 0, 'stop-color': T.canvas, 'stop-opacity': 0 }),
      el('stop', { offset: (top / H).toFixed(3), 'stop-color': T.canvas, 'stop-opacity': 1 }),
      el('stop', { offset: (bottom / H).toFixed(3), 'stop-color': T.canvas, 'stop-opacity': 1 }),
      el('stop', { offset: 1, 'stop-color': T.canvas, 'stop-opacity': 0 }),
    ].join('')),
    el('mask', { id: id('gridmask') }, el('rect', { x: 0, y: 0, width: W, height: H, fill: ref('gridfade') })),
    el('linearGradient', { id: id('vignette'), x1: 0, y1: 0, x2: 0, y2: 1 }, [
      el('stop', { offset: 0, 'stop-color': edge, 'stop-opacity': DARK ? 0.6 : 1 }),
      el('stop', { offset: 0.2, 'stop-color': edge, 'stop-opacity': 0 }),
      el('stop', { offset: 0.8, 'stop-color': edge, 'stop-opacity': 0 }),
      el('stop', { offset: 1, 'stop-color': edge, 'stop-opacity': DARK ? 0.6 : 1 }),
    ].join('')),
    el('rect', { x: 0, y: 0, width: W, height: H, fill: ref('vignette') }),
    g({ mask: ref('gridmask'), stroke: DARK ? T.paper : T.ink, 'stroke-width': 1.6, opacity: DARK ? 0.07 : 0.085 }, rolled),
  ].join('');
}

// ── Freehand ink ──────────────────────────────────────────────────────────────────────────
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

// ── Handwriting (Explainers 3.1, EX3-61; Hershey Sans in 3.2, EX3-81) ──────────────────────────────────────────────────
/** Width of `text` in px at cap height `size`, in Hershey Sans. */
export function handwriteWidth(text, size) {
  const k = size / HERSHEY_CAP;
  return [...String(text)].reduce((w, ch) => w + (HERSHEY_SANS[ch] ?? HERSHEY_SANS[' ']).a * k, 0);
}

/**
 * Real handwriting that writes itself: Hershey Sans single strokes (plain print, never cursive)
 * drawn as an even, round-capped pen line under the kit's wobble. The baseline starts at (x, y) (or is centred on x with align 'center'); `size`
 * is the cap height in px; `progress` 0..1 reveals the strokes in writing order, by length.
 * Returns an SVG group tagged with `role` (frame 1's title uses 'title').
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
  // A pen's even, round-capped line (EX3-81): readable at any size, and a stroke can never cancel
  // its own ink the way a filled freehand outline did. The wobble filter keeps it hand-drawn.
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
  return g({ 'data-role': role, 'data-k': 'text', 'data-text': String(text).replace(/[<>&"]/g, ''), filter: ref('wobble') }, out);
}

/** A hand-drawn line between points with a little bow. */
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

// ── Solids (V-2, V-3) ─────────────────────────────────────────────────────────────────────
/** The three flat tones of each material: lit top, mid left face, dark right face. */
export const TONES = {
  paper: [T['paper-lit'], T['paper-shade'], T['paper-dark']],
  orange: [T['orange-lit'], T['orange-shade'], T['orange-dark']],
  ink: [T['ink-lit'], T.ink, T.ink],
};

const poly = (pts) => pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');

/** An isometric box: three flat tones, riso grain on the side faces, an outline in the
 *  ground's line color. Returns the SVG and the screen corners of its top face. */
export function isoBox(P, x, y, z, w, d, h, tones = TONES.paper, { sw = 3.5, grain = true, outline = true } = {}) {
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
  const parts = [
    el('polygon', { points: poly(top), fill: tones[0] }),
    el('polygon', { points: poly(left), fill: tones[1] }),
    el('polygon', { points: poly(right), fill: tones[2] }),
  ];
  if (grain && h > 0) {
    parts.push(stippleShade('polygon', { points: poly(left) }, T.ink, { from: 0, to: 0.22, fine: true }));
    parts.push(stippleShade('polygon', { points: poly(right) }, T.ink, { x1: 1, y1: 0, x2: 0, y2: 1, from: 0.05, to: 0.32, fine: true }));
  }
  if (outline) {
    const o = { fill: 'none', stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' };
    parts.push(el('polygon', { ...o, points: poly([A, B, B0, C0, D0, D]) }));
    parts.push(el('polyline', { ...o, points: poly([D, Cc, B]) }));
    parts.push(el('line', { ...o, x1: Cc[0], y1: Cc[1], x2: C0[0], y2: C0[1] }));
  }
  return { svg: parts.join(''), top, left, right };
}

/** An isometric disc or cylinder (a coin, a knob, a pot, a wheel lying flat), centered at
 *  screen (cx, cy) on its top face; rx in screen px, h its height in screen px. */
export function isoDisc(cx, cy, rx, h, tones = TONES.paper, { sw = 2.5, rings = 1 } = {}) {
  const ry = rx * 0.577;
  const parts = [];
  if (h > 0) parts.push(el('path', { d: `M ${cx - rx} ${cy} L ${cx - rx} ${cy + h} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy + h} L ${cx + rx} ${cy} Z`, fill: tones[2], stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' }));
  parts.push(el('ellipse', { cx, cy, rx, ry, fill: tones[0], stroke: line(), 'stroke-width': sw }));
  for (let i = 1; i <= rings; i++) {
    const k = 1 - i * 0.32;
    parts.push(el('ellipse', { cx, cy, rx: rx * k, ry: ry * k, fill: 'none', stroke: line(), 'stroke-width': sw * 0.7, opacity: 0.55 }));
  }
  return parts.join('');
}

/** Lay flat 2D drawing on an iso plane (see core isoPlane). */
export const onPlane = (P, s, x, y, z, inner) => g({ transform: isoPlane(P, s, x, y, z) }, inner);

/** A flat contact shadow: an ink ellipse under a thing (V-3). */
export const shadow = (cx, cy, rx, ry, opacity = 0.12) => el('ellipse', { cx, cy, rx, ry, fill: DARK ? T.canvas : T.ink, opacity: DARK ? opacity * 0.5 : opacity });

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

/** Cartoon shock marks: three short ink strokes that pop out and fade (u: 0..1). */
export function shock(x, y, u, scale = 1, rays = [[-0.95, -0.55], [-0.35, -1], [0.35, -1.05]]) {
  if (u <= 0 || u >= 1) return '';
  const grow = Math.min(1, u / 0.25);
  const fade = 1 - Math.max(0, (u - 0.7) / 0.3);
  return g({ filter: ref('wobble'), opacity: fade }, rays.map(([dx, dy]) => {
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
