// The Explainers world kit, prop helpers (Explainers 3.2, EX3-78; soft 3D in hx-4): what every
// library prop is built from. Shared by ../props.js and the batches beside this file. hx-4 keeps
// every helper's signature and redraws it in the soft style (still 08): boxes and cylinders are
// soft volumes, shapes are soft-shaded with no ink stroke, marks are soft grooves, shading is a
// smooth gradient. So the library and the asset bank restyle without edits.

import { T, el, g, id, ref, line, isoBox, isoDisc, stippleShade, freehand, shadow, TONES, softShape, isDark } from '../draw.js';
import { iso, ISO_COS, ISO_SIN, mixHex } from '../core.js';

export { T, el, g, ref, line, isoBox, isoDisc, stippleShade, freehand, shadow, TONES };

// ── Helpers every prop builds from ────────────────────────────────────────────────────────
/** The projection a prop draws with: world origin at the prop's base center. */
export const P0 = iso(0, 0, 1);

/** An iso box's SVG (see draw.js isoBox): a soft volume. */
export const box = (x, y, z, w, d, h, tones = TONES.paper, opts = {}) => isoBox(P0, x, y, z, w, d, h, tones, opts).svg;

/** A box centered on world (cx, cy). */
export const cbox = (cx, cy, z, w, d, h, tones = TONES.paper, opts = {}) => box(cx - w / 2, cy - d / 2, z, w, d, h, tones, opts);

/** Screen radius of a world circle of radius r on a horizontal plane. */
export const RX = (r) => r * Math.SQRT2 * ISO_COS;

/** An upright cylinder of world radius r, height h, base at world (x, y, z): a soft volume. */
export function cyl(x, y, z, r, h, tones = TONES.paper, opts = {}) {
  const [cx, cy] = P0(x, y, z + h);
  return isoDisc(cx, cy, RX(r), h, tones, { rings: 0, ...opts });
}

/** Flat drawing on the horizontal plane z (u along world x, v along world y). */
export const top = (x, y, z, inner) => g({ transform: plane(x, y, z, 'top') }, inner);

/** Flat drawing on a vertical face, u running right on screen and v running down.
 *  'front' is the plane y = const (the lower-left face of a box), 'side' the plane x = const
 *  (the lower-right face). Use it for anything printed, mounted or cut into a face. */
export const face = (which, x, y, z, inner) => g({ transform: plane(x, y, z, which) }, inner);

function plane(x, y, z, which) {
  const [X, Y] = P0(x, y, z);
  const c = ISO_COS;
  const m = which === 'top' ? [c, ISO_SIN, -c, ISO_SIN] : which === 'front' ? [c, ISO_SIN, 0, 1] : [c, -ISO_SIN, 0, 1];
  return `matrix(${m.map((v) => v.toFixed(5)).join(' ')} ${X.toFixed(2)} ${Y.toFixed(2)})`;
}

/** An organic thing's shape (path d) in a fill: soft-shaded, lit from the top right, no ink
 *  stroke (hx-4). `sw` is accepted and ignored. */
export const shape = (d, fill = T['paper-lit'], _sw = 3.5) => softShape(d, fill);

/** A detail mark (seams, slots, ticks): a soft groove, a darker line with a lit lip below it,
 *  never an ink outline (hx-4). */
export const mark = (d, sw = 3, opacity = 1) => {
  const groove = { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  return [
    el('path', { ...groove, stroke: isDark() ? T['ink-dark'] : T['shadow-warm'], 'stroke-width': (sw * 0.75).toFixed(2), opacity: (0.42 * opacity).toFixed(3) }),
    el('path', { ...groove, stroke: T.canvas, 'stroke-width': (sw * 0.45).toFixed(2), opacity: ((isDark() ? 0.12 : 0.55) * opacity).toFixed(3), transform: `translate(0 ${(sw * 0.45).toFixed(2)})` }),
  ].join('');
};

/** Smooth shading over a path (the side of an organic thing). The props were drawn for a light
 *  from the top left; hx-4's light comes from the top right, so the direction is mirrored. Across
 *  a round body (a horizontal shade) a soft specular stripe runs down its lit side. */
export const shade = (d, { color = T.ink, from = 0.05, to = 0.3, x1 = 1, y1 = 0, x2 = 0, y2 = 1 } = {}) => {
  const out = [stippleShade('path', { d }, color === T.ink ? T['shadow-warm'] : color, { x1: 1 - x1, y1, x2: 1 - x2, y2, from, to, fine: true })];
  if (y1 === y2 && x1 !== x2) {
    const k = isDark() ? 0.18 : 0.42;
    const gid = id('spec-stripe');
    out.push(el('defs', {}, el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 }, [[0.5, 0], [0.7, k], [0.8, k * 0.5], [0.9, 0]].map(([o, a]) => el('stop', { offset: o, 'stop-color': T.canvas, 'stop-opacity': a })).join(''))));
    out.push(el('path', { d, fill: `url(#${gid})` }));
  }
  return out.join('');
};

/** The tones of a prop's accent part: orange when the prop is the focal, else paper or ink. */
export const accent = (focal, base = TONES.paper) => (focal ? TONES.orange : base);

/** Fill of a flat accent shape. */
export const accentFill = (focal, base = T['paper-lit']) => (focal ? T.orange : base);

// ── The soft pass (hx-4) ──────────────────────────────────────────────────────────────────
// The library's props were drawn for the ink style: many of their parts are plain elements with
// an ink outline and a flat fill. soften() restyles a prop's finished SVG without touching its
// code: an outlined solid loses the ink and gets a soft edge in a darker tint of its own color,
// a flat palette fill becomes a soft gradient lit from the top right, an ink detail line becomes
// a soft warm groove, an old flat ink shadow becomes a blurred warm one. Clip paths, masks and
// defs are left alone, and so is anything already soft (a gradient fill, a filter).
const SKIP_IN = new Set(['clipPath', 'mask', 'defs', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'symbol']);
const SHAPES = new Set(['path', 'polygon', 'polyline', 'ellipse', 'circle', 'rect', 'line']);
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A prop's SVG in the soft style (see above). Pure: the same input always gives the same output. */
export function soften(svg) {
  const ink = new Set([T.ink.toUpperCase(), T['ink-lit'].toUpperCase()]);
  if (isDark()) ink.add(T['paper-lit'].toUpperCase());
  const made = new Map();
  let skip = 0;
  // groups that keep their own look: handwriting and text (data-k="text"), and anything marked
  // data-hard (a critter, or a mark meant to stay a line)
  const groups = [];
  return String(svg).replace(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g, (all, close, tag, rest, selfClose) => {
    if (tag === 'g') {
      if (close) groups.pop();
      else if (!selfClose) groups.push(/data-k="text"|data-hard|data-who=/.test(rest) || (groups.length > 0 && groups[groups.length - 1]));
      return all;
    }
    if (groups.length && groups[groups.length - 1]) return all;
    if (SKIP_IN.has(tag)) {
      if (close) skip = Math.max(0, skip - 1);
      else if (!selfClose) skip += 1;
      return all;
    }
    if (close || skip || !SHAPES.has(tag)) return all;
    const a = {};
    for (const m of rest.matchAll(/([\w:-]+)="([^"]*)"/g)) a[m[1]] = m[2];
    if (a.filter || a['clip-path'] || a.mask) return all;
    const fill = a.fill ?? (tag === 'line' || tag === 'polyline' ? 'none' : T.ink);
    const filled = fill !== 'none' && fill !== 'transparent';
    const strokeInk = a.stroke && ink.has(a.stroke.toUpperCase());
    const op = a.opacity == null ? 1 : Number(a.opacity);
    let pre = '';
    if (filled && HEX.test(fill) && !a.stroke && ink.has(fill.toUpperCase()) && op < 0.4) {
      // an old flat ink shadow: a soft warm one
      a.fill = T['shadow-warm'];
      a.opacity = Math.min(0.5, op * 1.9).toFixed(3);
      a.filter = ref('ao');
    } else if (filled && HEX.test(fill)) {
      const dark = ink.has(fill.toUpperCase()) || fill.toUpperCase() === T['ink-dark'].toUpperCase();
      const key = fill.toUpperCase();
      if (!made.has(key)) {
        const gid = id(`sf${key.slice(1).toLowerCase()}`);
        const hi = mixHex(fill, T.canvas, dark ? 0.16 : 0.22);
        const lo = isDark() ? mixHex(fill, T['stage-bottom'], dark ? 0.3 : 0.32) : mixHex(fill, dark ? T['ink-dark'] : T['shadow-warm'], dark ? 0.2 : 0.1);
        made.set(key, gid);
        pre = el('defs', {}, el('linearGradient', { id: gid, x1: 0.9, y1: 0, x2: 0.1, y2: 1 }, el('stop', { offset: 0, 'stop-color': hi }) + el('stop', { offset: 0.55, 'stop-color': fill }) + el('stop', { offset: 1, 'stop-color': lo })));
      }
      a.fill = `url(#${made.get(key)})`;
      if (strokeInk) {
        const sw = Number(a['stroke-width'] ?? 1) || 1;
        a.stroke = mixHex(fill, dark ? T['ink-dark'] : T['shadow-warm'], 0.42);
        a['stroke-width'] = Math.min(2, Math.max(0.8, sw * 0.45)).toFixed(2);
        a['stroke-opacity'] = '0.38';
      }
    } else if (filled && strokeInk) {
      const sw = Number(a['stroke-width'] ?? 1) || 1;
      a.stroke = T['shadow-warm'];
      a['stroke-width'] = Math.min(2.2, Math.max(0.8, sw * 0.5)).toFixed(2);
      a['stroke-opacity'] = '0.4';
    } else if (!filled && strokeInk) {
      // an ink line (a seam, a print, a silhouette line): a soft warm groove
      const sw = Number(a['stroke-width'] ?? 1) || 1;
      // silhouette lines (the 3.5 px outline weight) all but vanish; detail lines stay readable
      const k = sw >= 3.4 ? 0.2 : 0.42;
      a.stroke = isDark() ? T['paper-shade'] : mixHex(T.ink, T['shadow-warm'], 0.5);
      a['stroke-width'] = (sw * 0.8).toFixed(2);
      a.opacity = (op * (isDark() ? k * 1.1 : k)).toFixed(3);
    } else return all;
    const out = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `${pre}<${tag} ${out}${selfClose ? '/' : ''}>`;
  });
}
