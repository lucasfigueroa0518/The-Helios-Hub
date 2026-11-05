// Marker marks, measured from the DOM boxes of the words/items they mark (D3), never hand-placed.
// Felt tip on board and newspaper (Helios orange for the key detail); dry-erase on the whiteboard
// (blue, red or black). Every mark returns { el, length, seconds, progress(u) } so a frame's render(t)
// draws it at hand speed; multi-stroke marks also expose their strokes in drawing order.
//
// Every mark is attached to its target element: the stroke carries data-ink (its kind) and data-ink-for,
// the target carries the matching data-ink-target, so the screen check can see what each mark marks
// and report a mark with no target, or around nothing ([mark_on_nothing], screen.mjs). A mark called
// without a target is skipped: it draws nothing, the frame still builds, and the screen check reports it
// (skipMark). To mark a detail inside a picture, make a target with markTarget().
//
// A stroke follows its target: every render re-reads the target's box in the layer's coordinates, so a
// stroke in a still layer stays on a target that slides, is pushed or tilts (mark_drift, screen.mjs).
import { h, svgEl, esc } from './dom.js';
import { COLORS } from './style.js';
import { behindColour, inkBounds, pickInk } from './anchor.js';
import {
  ellipseAround, ringAround, underlineUnder, arrowBetween, crossOver, highlightBand, toPath, writeSeconds, strokeSeconds, clamp,
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
 * A box of `target` in the ink layer's own coordinates, measured through every transform: the target's
 * screen box is mapped back through the layer's inverse screen matrix (a tilted page, a camera push, a
 * rotated collage layer), so its size is what the viewer sees at the layer's scale. A picture with
 * transparency (a cutout, a drawing) is measured on its ink, not its transparent padding.
 */
export function boxIn(layer, target) {
  const r = target.getBoundingClientRect();
  const ctm = layer.el.getScreenCTM?.();
  if (!ctm) return { x: 0, y: 0, w: target.offsetWidth || r.width, h: target.offsetHeight || r.height };
  const m = ctm.inverse();
  const k = Math.hypot(m.a, m.b) || 1;
  let { left, top, width, height } = r;
  const ink = target.tagName === 'IMG' ? inkBounds(target) : null;
  if (ink) {
    left += ink.x * width; top += ink.y * height;
    width *= ink.w; height *= ink.h;
  }
  const p = new DOMPoint(left + width / 2, top + height / 2).matrixTransform(m);
  return { x: p.x - (width * k) / 2, y: p.y - (height * k) / 2, w: width * k, h: height * k };
}

/** Whether a target can be measured yet (laid out, and a picture loaded). */
const measurable = (t) => {
  const r = t.getBoundingClientRect?.();
  if (!r || !(r.width > 1 && r.height > 1)) return false;
  return t.tagName !== 'IMG' || (t.complete && t.naturalWidth > 0);
};

let inkSeq = 0;

/**
 * A mark that can't be drawn: it is left out and the frame still builds, so one bad mark never kills a
 * frame in the render. The reason goes on `doc.__markSkips`, which the screen check reports as
 * [mark_on_nothing] for the fix step. Same shape as a drawn mark, drawing nothing.
 */
export function skipMark(doc, kind, why) {
  (doc.__markSkips ??= []).push(`${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} mark was skipped: ${why}`);
  const el = svgEl(doc, 'svg', { width: 0, height: 0, 'data-mark-skipped': kind });
  el.style.display = 'none';
  const none = { el, length: 0, progress() {} };
  return { el, target: null, kind, skipped: why, picture: null, length: 0, seconds: 0, end: 0, window: { start: 0, end: 0 }, strokes: [], shaft: none, flick1: none, flick2: none, box: () => null, render() {}, progress() {} };
}
const NO_TARGET = 'it needs a target element (the word, face, figure or item it marks); never place a mark by coordinates';
/** A marker's target: the element, or `el:<name>` for an element with that data-name on the layer's scene. */
function targetOf(layer, t) {
  if (typeof t !== 'string') return t;
  const m = /^\s*el\s*:\s*(.+?)\s*$/i.exec(t);
  if (!m) return null;
  const scope = layer.surface?.closest?.('.nk, .rd') ?? layer.surface;
  return scope?.querySelector?.(`[data-name="${m[1].replace(/["\\]/g, '\\$&')}"]`) ?? null;
}

/** Tie a mark's strokes to its target (data-ink / data-ink-for → data-ink-target). No target ties nothing. */
export function linkInk(target, kind, ...els) {
  if (!target?.getBoundingClientRect) return null;
  const id = target.getAttribute?.('data-ink-target') || `ink-${++inkSeq}`;
  target.setAttribute('data-ink-target', id);
  for (const el of els) {
    el.setAttribute('data-ink', kind);
    el.setAttribute('data-ink-for', id);
  }
  return id;
}

/**
 * A target for a mark on a detail inside a picture (a logo on a building, a figure in a crowd): an
 * invisible box over `holder` (the element that shows the picture), at `box` given in 0–1 of the holder
 * ({ x, y, w, h }, like media.face). It moves with the holder. The screen check reads the picture under
 * it, so a ring around blank paper or empty sky is found.
 */
export function markTarget(doc, holder, box) {
  const b = box ?? {};
  const el = h(doc, 'div', { class: 'abs', 'data-ink-region': '', style: { left: `${(b.x ?? 0) * 100}%`, top: `${(b.y ?? 0) * 100}%`, width: `${(b.w ?? 0) * 100}%`, height: `${(b.h ?? 0) * 100}%`, pointerEvents: 'none' } });
  if (doc.defaultView?.getComputedStyle?.(holder)?.position === 'static') holder.style.position = 'relative';
  holder.append(el);
  return el;
}

const defaultColor = (layer, color) => color ?? (layer.kind === 'dry' ? COLORS.dry.blue : COLORS.marker);

/**
 * Strokes measured lazily: drawn from the targets' boxes on the first render where every target is laid
 * out (build() runs before pictures load; a box measured then is empty), then re-read on every render so
 * they stay on their targets through any move. Their ink is settled once, from what is behind the target.
 * build(boxes) → [{ pts, length }]. Returns { strokes: [{ el, length, progress }], measure() }.
 */
function lazyStrokes(doc, layer, targets, build, { color, width, n }) {
  const strokes = Array.from({ length: n }, () => {
    const el = svgEl(doc, 'path', { d: 'M0 0', stroke: color, 'stroke-width': width });
    layer.el.append(el);
    const s = { el, length: 0, u: 0 };
    s.progress = (u) => {
      s.u = clamp(u);
      if (!ready && !measure()) { el.style.opacity = '0'; return; }
      track();
      el.style.strokeDasharray = `${s.length} ${s.length + 10}`;
      el.style.strokeDashoffset = String(s.length * (1 - s.u));
      el.style.opacity = s.u > 0 ? '1' : '0';
    };
    return s;
  });
  let ready = false;
  const apply = (shapes) => shapes.forEach((sh, i) => {
    strokes[i].el.setAttribute('d', toPath(sh.pts));
    strokes[i].length = sh.length;
    if (sh.width) strokes[i].el.setAttribute('stroke-width', String(sh.width));
  });
  let drawnFor = '';
  const keyOf = (boxes) => boxes.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.w.toFixed(1)},${b.h.toFixed(1)}`).join('|');
  /** The strokes redrawn from where their targets are now (a hidden target keeps its last place). */
  function track() {
    if (!targets.every((t) => t.getBoundingClientRect().width > 1)) return;
    const boxes = targets.map((t) => boxIn(layer, t));
    const key = keyOf(boxes);
    if (key === drawnFor) return;
    drawnFor = key;
    apply(build(boxes));
  }
  function settleInk() {
    if (inked || !layer.el.isConnected) return;
    inked = true;
    const ink = pickInk(color, behindColour(doc, targets.at(-1).getBoundingClientRect(), layer.el));
    if (ink !== color) for (const s of strokes) s.el.setAttribute('stroke', ink);
  }
  let inked = false;
  function measure() {
    if (ready) return true;
    const ok = targets.every(measurable);
    const boxes = targets.map((t) => boxIn(layer, t));
    apply(build(boxes));
    if (ok) drawnFor = keyOf(boxes);
    if (ok) settleInk();
    ready = ok;
    return ok;
  }
  measure();
  return { strokes, measure };
}

/** Run strokes in order; u is shared out by length (each flick still gets its own short slice). */
function sequence(strokes, measure) {
  const progress = (u) => {
    measure?.();
    const total = strokes.reduce((a, s) => a + s.length, 0) || 1;
    let acc = 0;
    for (const s of strokes) {
      const a = acc / total, b = (acc + s.length) / total;
      s.progress(clamp((u - a) / (b - a || 1)));
      acc += s.length;
    }
  };
  return { strokes, get length() { return strokes.reduce((a, s) => a + s.length, 0); }, progress };
}

/** A hand-drawn circle around a target (sized to it: a picture's ink, a word's box). */
export function markerCircle(doc, layer, targetIn, { color, width = 9, pad = 18, seed = 1 } = {}) {
  const target = targetOf(layer, targetIn);
  if (!target?.getBoundingClientRect) return skipMark(doc, 'circle', NO_TARGET);
  linkInk(target, 'circle');
  const ring = (b) => (target.tagName === 'IMG' || !target.textContent?.trim() ? ringAround(b, Math.min(pad, 0.08 * Math.max(b.w, b.h) + 6), seed) : ellipseAround(b, pad, seed));
  const run = lazyStrokes(doc, layer, [target], ([b]) => [ring(b)], { color: defaultColor(layer, color), width, n: 1 });
  const [s] = run.strokes;
  linkInk(target, 'circle', s.el);
  return { el: s.el, get length() { return s.length; }, get seconds() { return clamp(0.45 + (s.length - 400) / 4000, 0.45, 0.7); }, progress: (u) => s.progress(u) };
}

/** One quick stroke under a target. */
export function markerUnderline(doc, layer, targetIn, { color, width = 8 } = {}) {
  const target = targetOf(layer, targetIn);
  if (!target?.getBoundingClientRect) return skipMark(doc, 'underline', NO_TARGET);
  linkInk(target, 'underline');
  const run = lazyStrokes(doc, layer, [target], ([b]) => [underlineUnder(b)], { color: defaultColor(layer, color), width, n: 1 });
  const [s] = run.strokes;
  linkInk(target, 'underline', s.el);
  return { el: s.el, get length() { return s.length; }, get seconds() { return strokeSeconds(s.length); }, progress: (u) => s.progress(u) };
}

/** A curved arrow edge to edge from one target to another: shaft tail→head, then two flicks. */
export function markerArrow(doc, layer, fromIn, toIn, { color, width = 9, bend = null } = {}) {
  const from = targetOf(layer, fromIn), to = targetOf(layer, toIn);
  if (!to?.getBoundingClientRect) return skipMark(doc, 'arrow', NO_TARGET);
  if (!from?.getBoundingClientRect) return skipMark(doc, 'arrow', 'it needs the element it starts from');
  linkInk(to, 'arrow');
  const run = lazyStrokes(doc, layer, [from, to], ([a, b]) => {
    const x = arrowBetween(a, b, { bend });
    return [x.shaft, x.flick1, x.flick2];
  }, { color: defaultColor(layer, color), width, n: 3 });
  const [shaft, flick1, flick2] = run.strokes;
  linkInk(to, 'arrow', shaft.el, flick1.el, flick2.el);
  return { ...sequence(run.strokes, run.measure), el: shaft.el, shaft, flick1, flick2, get seconds() { return strokeSeconds(shaft.length) + 0.26; } };
}

/** Two fast diagonal strokes over a target. */
export function markerCross(doc, layer, targetIn, { color, width = 12, pad = 10 } = {}) {
  const target = targetOf(layer, targetIn);
  if (!target?.getBoundingClientRect) return skipMark(doc, 'cross', NO_TARGET);
  linkInk(target, 'cross');
  const run = lazyStrokes(doc, layer, [target], ([b]) => crossOver(b, pad), { color: color ?? (layer.kind === 'dry' ? COLORS.dry.red : COLORS.marker), width, n: 2 });
  const [s1, s2] = run.strokes;
  linkInk(target, 'cross', s1.el, s2.el);
  return { ...sequence(run.strokes, run.measure), el: s1.el, get seconds() { return strokeSeconds(s1.length) + strokeSeconds(s2.length) + 0.06; } };
}

/** A wide translucent highlighter pass over a target (a quote). */
export function highlight(doc, layer, targetIn, { color = '#FFB23A' } = {}) {
  const target = targetOf(layer, targetIn);
  if (!target?.getBoundingClientRect) return skipMark(doc, 'highlight', NO_TARGET);
  linkInk(target, 'highlight');
  const run = lazyStrokes(doc, layer, [target], ([b]) => [highlightBand(b)], { color, width: 10, n: 1 });
  const [s] = run.strokes;
  linkInk(target, 'highlight', s.el);
  s.el.classList.add('hl');
  s.el.setAttribute('stroke-opacity', '0.42');
  return { el: s.el, get length() { return s.length; }, get seconds() { return Math.max(0.35, s.length / 900); }, progress: (u) => s.progress(u) };
}

/**
 * A handwritten note: the kit's hand (--hand) through the dry-erase streak filter on the whiteboard, a felt-tip look
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
