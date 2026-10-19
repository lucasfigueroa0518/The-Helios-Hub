// The Explainers world kit, props (Explainers 3.2, EX3-78): a vetted library of everyday objects
// drawn once in the paper-and-ink style and approved on a contact sheet. A scene uses a prop when
// the library has the thing; it never draws its own version of one. A prop is never a reason to
// pick an analogy (V-16).
//
//   prop(name, x, y, { s, state, focal, flip })   the prop standing with its base center at
//                                                  screen (x, y), scale s (1 = library size)
//   PROPS                                          name → { states, size: [w, h], draw }
//   propNames()                                    every prop name, sorted
//
// Each prop is drawn about its own origin (base center, world z = 0) with the kit's isometric
// projection, so props share one light, one outline weight and one grain. Organic things are
// ink contours with flat fills and stipple; boxy things are iso solids (FRAME.md § objects).
// The batches live in props/*.js; this file holds the helpers they build from.

import { el, g, ref, line, TONES, T, shadow, isoDisc, P0, box, RX, top, face, accent, accentFill } from './props/kit.js';

export * from './props/kit.js';

// ── Reference props (the batches follow this style) ──────────────────────────────────────
const CORE = {
  chair: {
    states: ['default'],
    size: [230, 340],
    // The footprint sits back from the origin so the nearest leg lands near +30.
    draw: ({ focal }) => [
      shadow(0, -22, 110, 40),
      // back legs, front legs, seat, back rest (painter's order: far to near)
      box(-90, -90, 0, 16, 16, 120, TONES.paper),
      box(14, -90, 0, 16, 16, 120, TONES.paper),
      box(-90, 14, 0, 16, 16, 120, TONES.paper),
      box(14, 14, 0, 16, 16, 120, TONES.paper),
      box(-94, -94, 120, 128, 128, 18, accent(focal)),
      box(-94, -94, 138, 128, 14, 130, accent(focal)),
      face('front', -80, -80, 250, el('path', { d: 'M 0 0 L 100 0', fill: 'none', stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.5 })),
    ],
  },
  jar: {
    states: ['empty', 'full'],
    size: [170, 270],
    // A glass jar: rounded shoulders, a narrower neck, a screw lid; full of round sweets.
    draw: ({ state, focal }) => {
      const h = 170;
      const rx = RX(64);
      const ry = rx * 0.577;
      const nx = rx * 0.72;
      const ny = nx * 0.577;
      const [bx, by] = P0(0, 0, 0);
      const ys = by - h * 0.74; // where the shoulders start
      const yn = by - h; // the neck's rim
      const glass = `M ${bx - rx} ${ys} L ${bx - rx} ${by} A ${rx} ${ry} 0 0 0 ${bx + rx} ${by} L ${bx + rx} ${ys} Q ${bx + rx} ${yn + 10} ${bx + nx} ${yn} A ${nx} ${ny} 0 0 1 ${bx - nx} ${yn} Q ${bx - rx} ${yn + 10} ${bx - rx} ${ys} Z`;
      const parts = [shadow(bx, by + 6, rx + 16, ry + 8)];
      if (state === 'full') {
        const fy = ys + 14;
        parts.push(el('path', { d: `M ${bx - rx} ${fy} L ${bx - rx} ${by} A ${rx} ${ry} 0 0 0 ${bx + rx} ${by} L ${bx + rx} ${fy} A ${rx} ${ry} 0 0 1 ${bx - rx} ${fy} Z`, fill: T['paper-shade'] }));
        // round sweets packed in, seen through the glass
        const sweets = [[-44, 6], [-8, 2], [28, 8], [-30, 40], [10, 38], [44, 44], [-48, 76], [-12, 72], [26, 78], [-30, 108], [8, 106], [44, 112]];
        for (const [dx, dy] of sweets) parts.push(el('circle', { cx: bx + dx, cy: fy + dy, r: 15, fill: focal ? T['orange-lit'] : T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }));
      }
      // glass: a pale tint, the ink outline, and two highlights
      parts.push(el('path', { d: glass, fill: T['paper-lit'], opacity: state === 'full' ? 0.25 : 0.6 }));
      parts.push(el('path', { d: glass, fill: 'none', stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }));
      parts.push(el('path', { d: `M ${bx - rx + 16} ${ys} L ${bx - rx + 16} ${by - 12}`, fill: 'none', stroke: T.canvas, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.8 }));
      parts.push(el('path', { d: `M ${bx - rx + 32} ${ys + 6} L ${bx - rx + 32} ${ys + 46}`, fill: 'none', stroke: T.canvas, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.7 }));
      // the screw lid, the accent part, with its thread ridges
      parts.push(isoDisc(bx, yn - 26, nx + 8, 26, accent(focal), { rings: 0, sw: 3.5 }));
      for (let k = 1; k <= 3; k++) {
        const x = bx - nx - 8 + ((2 * (nx + 8)) / 4) * k;
        parts.push(el('path', { d: `M ${x} ${yn - 26 + ny * 0.9} L ${x} ${yn + ny * 0.7}`, fill: 'none', stroke: T.ink, 'stroke-width': 2, opacity: 0.45 }));
      }
      return parts;
    },
  },
  'light switch': {
    states: ['off', 'on'],
    size: [120, 170],
    // Mounted on a wall: the plate lies on a 'front' face. Its origin is the plate's bottom center.
    draw: ({ state, focal }) => {
      const w = 92;
      const h = 140;
      const plate = face('front', -w / 2, 0, h, [
        el('rect', { x: 4, y: 4, width: w, height: h, rx: 12, fill: T.ink, opacity: 0.18 }),
        el('rect', { x: 0, y: 0, width: w, height: h, rx: 12, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 4 }),
        el('circle', { cx: w / 2, cy: 16, r: 4, fill: 'none', stroke: T.ink, 'stroke-width': 2.5 }),
        el('circle', { cx: w / 2, cy: h - 16, r: 4, fill: 'none', stroke: T.ink, 'stroke-width': 2.5 }),
        el('rect', { x: w / 2 - 18, y: 34, width: 36, height: 72, rx: 6, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 3 }),
        // the toggle: up when on, down when off
        state === 'on'
          ? el('rect', { x: w / 2 - 12, y: 36, width: 24, height: 38, rx: 6, fill: accentFill(focal, T['paper-lit']), stroke: T.ink, 'stroke-width': 3.5 })
          : el('rect', { x: w / 2 - 12, y: 66, width: 24, height: 38, rx: 6, fill: accentFill(focal, T['paper-lit']), stroke: T.ink, 'stroke-width': 3.5 }),
      ]);
      return [plate];
    },
  },
  laptop: {
    states: ['open', 'closed'],
    size: [300, 230],
    draw: ({ state, focal }) => {
      const w = 220;
      const d = 150;
      // The footprint sits back from the origin so the nearest corner lands near +30.
      const X = -w / 2 - 62;
      const Y = -d / 2 - 62;
      const parts = [shadow(0, -40, 170, 60)];
      parts.push(box(X, Y, 0, w, d, 12, accent(focal, TONES.paper)));
      if (state === 'closed') {
        parts.push(box(X, Y, 12, w, d, 8, accent(focal, TONES.paper)));
        return parts;
      }
      // keyboard and trackpad on the base's top face
      const keys = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) keys.push(el('rect', { x: 14 + c * 19.5, y: 14 + r * 17, width: 15, height: 12, rx: 2, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 1.5 }));
      parts.push(top(X, Y, 12, [...keys, el('rect', { x: w / 2 - 34, y: 92, width: 68, height: 42, rx: 5, fill: 'none', stroke: T.ink, 'stroke-width': 2 })]));
      // the screen: a thin slab standing at the back edge, its face toward the viewer
      parts.push(box(X, Y - 8, 12, w, 10, 160, TONES.ink));
      parts.push(face('front', X + 12, Y + 2, 160, [
        el('rect', { x: 0, y: 0, width: w - 24, height: 136, rx: 4, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2 }),
        el('path', { d: 'M 16 26 L 120 26 M 16 48 L 160 48 M 16 70 L 96 70', fill: 'none', stroke: T.ink, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.45 }),
      ]));
      return parts;
    },
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────────────────
import { BATCH_A } from './props/batch-a.js';
import { BATCH_B } from './props/batch-b.js';
import { BATCH_C } from './props/batch-c.js';

export const PROPS = { ...CORE, ...BATCH_A, ...BATCH_B, ...BATCH_C };

export const propNames = () => Object.keys(PROPS).sort();

/**
 * Draw a library prop standing with its base center at screen (x, y).
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {{ s?: number, state?: string, focal?: boolean, flip?: boolean }} [o]
 */
export function prop(name, x, y, { s = 1, state, focal = false, flip = false } = {}) {
  const p = PROPS[name];
  if (!p) throw new Error(`HX: no prop "${name}" in the library; draw it as a new prop (FRAME.md § props).`);
  const st = state ?? p.states[0];
  if (!p.states.includes(st)) throw new Error(`HX: prop "${name}" has states ${p.states.join(', ')}; got "${st}".`);
  const parts = p.draw({ state: st, focal });
  return g({ 'data-prop': name, transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(flip ? -s : s).toFixed(4)} ${s.toFixed(4)})`, filter: ref('wobble') }, parts);
}
