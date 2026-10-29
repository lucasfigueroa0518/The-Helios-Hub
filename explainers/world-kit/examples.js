// The Explainers world kit (from Explainer 2.0), examples (hx-4, soft 3D): finished objects built from the primitives in
// draw.js. They are WORKED EXAMPLES of the style, not a catalog (X-39, VISUAL V-4): read them to
// see how a new object is constructed, and use one only when the reel's metaphor genuinely needs
// that thing. Never choose a metaphor because a piece already exists here.

import { T, el, g, line, isoBox, isoDisc, icon, TONES, softShape, shadow } from './draw.js';

/** A sheet of paper lying on the table: a thin isometric slab. */
export function sheet(P, x, y, w, d, { z = 0 } = {}) {
  return isoBox(P, x, y, z, w, d, 5, TONES.paper, { radius: 4 }).svg;
}

/** A stack of n coins on screen (bx, by), bottom first. `drop(i)` lifts coin i (a falling coin);
 *  `ghost` draws dashed outlines (what something used to cost). */
export function coinStack(bx, by, n, rx, h, { drop = () => 0, ghost = false } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const cy = by - i * h - drop(i);
    out.push(ghost
      ? el('ellipse', { cx: bx, cy, rx, ry: rx * 0.577, fill: 'none', stroke: line(), 'stroke-width': 2.5, 'stroke-dasharray': '2 9', 'stroke-linecap': 'round', opacity: 0.5 })
      : isoDisc(bx, cy, rx, h, TONES.paper));
  }
  return g({}, out);
}

/** A rubber stamp: an orange block with a short ink post and a round knob. */
export function stamp(P, s, x, y, z, w, d, h, { squash = 0, handle = 1 } = {}) {
  const hh = h * (1 - squash);
  const parts = [isoBox(P, x, y, z, w, d, hh, TONES.orange, { radius: 10, gloss: true }).svg];
  if (handle > 0) {
    const cx = x + w / 2;
    const cy = y + d / 2;
    const ph = 70 * handle;
    parts.push(isoBox(P, cx - 26, cy - 26, z + hh, 52, 52, ph, TONES.ink, { radius: 6, shadow: false }).svg);
    const [kx, ky] = P(cx, cy, z + hh + ph);
    parts.push(isoDisc(kx, ky - 22 * s * handle, 62 * s * handle, 22 * s * handle, TONES.ink, { gloss: true }));
  }
  return g({}, parts);
}

/** A pen, nib at (x, y), leaning up and to the right: a glossy soft tube with a steel nib. */
export function pen(x, y, { lift = 0 } = {}) {
  const ty = y - lift;
  return g({}, [
    softShape(`M ${x} ${ty} L ${x + 6} ${ty - 30} L ${x + 22} ${ty - 24} Z`, T['paper-shade'], { form: 0.4 }),
    el('path', { d: `M ${x + 16} ${ty - 36} L ${x + 78} ${ty - 200}`, stroke: T['ink-lit'], 'stroke-width': 24, 'stroke-linecap': 'round' }),
    el('path', { d: `M ${x + 13} ${ty - 40} L ${x + 74} ${ty - 198}`, stroke: T['ink-dark'], 'stroke-width': 8, 'stroke-linecap': 'round', opacity: 0.5 }),
    el('path', { d: `M ${x + 24} ${ty - 46} L ${x + 76} ${ty - 180}`, stroke: T['paper-lit'], 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.45 }),
  ]);
}

/** A round tag with a line icon: a label a critter or object carries. */
export function tag(x, y, r, rot, { name = 'user', opacity = 1, squashY = 1 } = {}) {
  const disc = `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
  return g({ opacity, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(1 ${squashY})` }, [
    shadow(-r * 0.12, r * 0.18, r * 0.92, r * 0.92, 0.14),
    softShape(disc, T['paper-lit']),
    icon(name, 0, 0, r * 1.15, { color: T.ink, sw: 2.1 }),
  ]);
}

/** A bench (any long slab things stand on): length runs along world y. */
export function bench(P, { w = 250, d = 1180, h = 66 } = {}) {
  return isoBox(P, 0, 0, 0, w, d, h, TONES.paper, { radius: 10 }).svg;
}
