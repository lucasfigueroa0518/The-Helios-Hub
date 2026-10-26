// The Explainers world kit, prop helpers (Explainers 3.2, EX3-78; soft 3D in hx-4): what every
// library prop is built from. Shared by ../props.js and the batches beside this file. hx-4 keeps
// every helper's signature and redraws it in the soft style (still 08): boxes and cylinders are
// soft volumes, shapes are soft-shaded with no ink stroke, marks are soft grooves, shading is a
// smooth gradient. So the library and the asset bank restyle without edits.

import { T, el, g, ref, line, isoBox, isoDisc, stippleShade, freehand, shadow, TONES, softShape, isDark } from '../draw.js';
import { iso, ISO_COS, ISO_SIN } from '../core.js';

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

/** Smooth shading over a path (the side of an organic thing). */
export const shade = (d, { color = T.ink, from = 0.05, to = 0.3, x1 = 1, y1 = 0, x2 = 0, y2 = 1 } = {}) =>
  stippleShade('path', { d }, color === T.ink ? T['shadow-warm'] : color, { x1, y1, x2, y2, from, to, fine: true });

/** The tones of a prop's accent part: orange when the prop is the focal, else paper or ink. */
export const accent = (focal, base = TONES.paper) => (focal ? TONES.orange : base);

/** Fill of a flat accent shape. */
export const accentFill = (focal, base = T['paper-lit']) => (focal ? T.orange : base);
