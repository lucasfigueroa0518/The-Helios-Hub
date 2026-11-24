// Marker marks, measured from the DOM boxes of the words/items they mark (D3), never hand-placed.
// Felt tip on board and newspaper (Helios orange for the key detail); dry-erase on the whiteboard
// (blue, red or black). Every mark returns { el, length, seconds, progress(u) } so a frame's render(t)
// draws it at hand speed; multi-stroke marks also expose their strokes in drawing order.
import { h, svgEl, esc } from './dom.js';
import { COLORS } from './style.js';
import {
  ellipseAround, underlineUnder, arrowBetween, crossOver, highlightBand, toPath, writeSeconds, strokeSeconds, clamp,
} from '../geometry.js';

/**
 * The ink layer for a surface (the scene's stage, or a page/sheet inside it). Marks drawn in it share
 * the surface's coordinates, so they move with it. kind: 'felt' | 'dry' (default from the scene).
 */
export function inkLayer(doc, surface, { kind } = {}) {
  const scene = surface.closest?.('[data-ground]')?.dataset.ground;
  const k = kind ?? (scene === 'whiteboard' ? 'dry' : 'felt');
  const w = surface.offsetWidth || 1080, ht = surface.offsetHeight || 1920;
  const el = svgEl(doc, 'svg', { class: `nk-ink ${k}`, width: w, height: ht });
  surface.append(el);
  return { el, kind: k, surface };
}

/**
 * A box of `target` in the ink layer's own coordinates. The surface may be rotated or scaled (a tilted
 * newspaper page, a camera push), so the target's screen centre is mapped back through the layer's
 * inverse screen matrix, and its size is its untransformed layout size.
 */
export function boxIn(layer, target) {
  const r = target.getBoundingClientRect();
  const m = layer.el.getScreenCTM().inverse();
  const p = new DOMPoint(r.left + r.width / 2, r.top + r.height / 2).matrixTransform(m);
  const w = target.offsetWidth || r.width, ht = target.offsetHeight || r.height;
  return { x: p.x - w / 2, y: p.y - ht / 2, w, h: ht };
}

const defaultColor = (layer, color) => color ?? (layer.kind === 'dry' ? COLORS.dry.blue : COLORS.marker);

function strokePath(doc, layer, shape, { color, width }) {
  const p = svgEl(doc, 'path', { d: toPath(shape.pts), stroke: color, 'stroke-width': width });
  layer.el.append(p);
  const L = shape.length;
  const progress = (u) => {
    const x = clamp(u);
    p.style.strokeDasharray = `${L} ${L + 10}`;
    p.style.strokeDashoffset = String(L * (1 - x));
    p.style.opacity = x > 0 ? '1' : '0';
  };
  progress(0);
  return { el: p, length: L, seconds: strokeSeconds(L), progress };
}

/** Run strokes in order; u is shared out by length (each flick still gets its own short slice). */
function sequence(strokes) {
  const total = strokes.reduce((a, s) => a + s.length, 0) || 1;
  const progress = (u) => {
    let acc = 0;
    for (const s of strokes) {
      const a = acc / total, b = (acc + s.length) / total;
      s.progress(clamp((u - a) / (b - a || 1)));
      acc += s.length;
    }
  };
  return { strokes, length: total, progress };
}

/** A hand-drawn circle around a target. */
export function markerCircle(doc, layer, target, { color, width = 9, pad = 18, seed = 1 } = {}) {
  const shape = ellipseAround(boxIn(layer, target), pad, seed);
  const s = strokePath(doc, layer, shape, { color: defaultColor(layer, color), width });
  return { ...s, seconds: clamp(0.45 + (shape.length - 400) / 4000, 0.45, 0.7) };
}

/** One quick stroke under a target. */
export function markerUnderline(doc, layer, target, { color, width = 8 } = {}) {
  return strokePath(doc, layer, underlineUnder(boxIn(layer, target)), { color: defaultColor(layer, color), width });
}

/** A curved arrow edge to edge from one target to another: shaft tail→head, then two flicks. */
export function markerArrow(doc, layer, from, to, { color, width = 9, bend = null } = {}) {
  const a = arrowBetween(boxIn(layer, from), boxIn(layer, to), { bend });
  const c = defaultColor(layer, color);
  const shaft = strokePath(doc, layer, a.shaft, { color: c, width });
  const flick1 = strokePath(doc, layer, a.flick1, { color: c, width });
  const flick2 = strokePath(doc, layer, a.flick2, { color: c, width });
  return { ...sequence([shaft, flick1, flick2]), shaft, flick1, flick2, seconds: shaft.seconds + 0.26 };
}

/** Two fast diagonal strokes over a target. */
export function markerCross(doc, layer, target, { color, width = 12, pad = 10 } = {}) {
  const [s1, s2] = crossOver(boxIn(layer, target), pad).map((sh) => strokePath(doc, layer, sh, { color: color ?? (layer.kind === 'dry' ? COLORS.dry.red : COLORS.marker), width }));
  return { ...sequence([s1, s2]), seconds: s1.seconds + s2.seconds + 0.06 };
}

/** A wide translucent highlighter pass over a target (a quote). */
export function highlight(doc, layer, target, { color = '#FFB23A' } = {}) {
  const band = highlightBand(boxIn(layer, target));
  const s = strokePath(doc, layer, band, { color, width: band.width });
  s.el.classList.add('hl');
  s.el.setAttribute('stroke-opacity', '0.42');
  return { ...s, seconds: Math.max(0.35, s.length / 900) };
}

/**
 * A handwritten note: Gochi Hand through the dry-erase streak filter on the whiteboard, a felt-tip look
 * elsewhere. Revealed left to right at ~10 letters a second. Placed in the surface's coordinates.
 */
export function markerNote(doc, layer, text, { x = 0, y = 0, size = 68, color, rot = 0 } = {}) {
  const el = h(doc, 'div', { class: `nk-note ${layer.kind}`, style: { left: `${x}px`, top: `${y}px`, fontSize: `${size}px`, color: defaultColor(layer, color), transform: rot ? `rotate(${rot}deg)` : '' } }, esc(text));
  layer.surface.append(el);
  const progress = (u) => {
    const v = clamp(u);
    el.style.clipPath = `inset(-30px ${(100 - 100 * v).toFixed(2)}% -30px -30px)`;
    el.style.opacity = v > 0 ? '1' : '0';
  };
  progress(0);
  return { el, length: String(text).length, seconds: writeSeconds(text), progress };
}

/**
 * A banked whiteboard drawing (assets/objects/drawing/<slug>.strokes.json: { width, height, strokes }),
 * drawn stroke by stroke in its traced hand order, fitted to `w` px wide at (x, y) in the surface.
 * Line weight stays `width` px on screen whatever the scale.
 */
export function markerDrawing(doc, layer, data, { x = 0, y = 0, w = 420, color, width = 7 } = {}) {
  const k = w / data.width;
  const g = svgEl(doc, 'g', { transform: `translate(${x} ${y}) scale(${k})` });
  layer.el.append(g);
  const c = defaultColor(layer, color);
  const strokes = data.strokes.map((d) => {
    const p = svgEl(doc, 'path', { d, stroke: c, 'stroke-width': width / k, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    g.append(p);
    const L = p.getTotalLength?.() || 1;
    const progress = (u) => {
      const v = clamp(u);
      p.style.strokeDasharray = `${L} ${L + 10}`;
      p.style.strokeDashoffset = String(L * (1 - v));
      p.style.opacity = v > 0 ? '1' : '0';
    };
    progress(0);
    return { el: p, length: L * k, progress };
  });
  const run = sequence(strokes);
  return { ...run, el: g, box: { x, y, w, h: data.height * k }, seconds: clamp(run.length / 1400, 1.2, 3.5) };
}

/** Draw a mark fully (stills, gallery). */
export const done = (...marks) => marks.forEach((m) => m.progress(1));
