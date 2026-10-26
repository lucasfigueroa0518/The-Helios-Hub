// Unboxing: the top of a taped cardboard box with "AI BRAIN BREAK" on it, seen from above. A box
// cutter slices the tape, the flaps burst open, and the camera dives into the box, where the hook
// is.
import { T, g, el, id, ref, defs, seg, lerp, E, scene, title, wordmark, fill, shake, shaken, softShape, gloss, roundRect } from './common.js';

const INNER = { x: 200, y: 360, w: 680, h: 1200 };
const SC = INNER.w / 1080;

function lid(t, cut) {
  const u = seg(t, cut[0], cut[1], E.inOut);
  return [
    fill(T['paper-dark']),
    // cardboard flutes, faint
    ...Array.from({ length: 30 }, (_, i) => el('line', { x1: 0, y1: 40 + i * 64, x2: 1080, y2: 52 + i * 64, stroke: T['paper-shade'], 'stroke-width': 3, opacity: 0.5 })),
    el('line', { x1: 540, y1: 0, x2: 540, y2: 1920, stroke: T['shadow-warm'], 'stroke-width': 4, opacity: 0.3 }),
    wordmark(540, 940, 118, 1, { color: T.ink, weight: 1.6 }),
    // the tape over the seam, cut down to the blade
    el('rect', { x: 470, y: 0, width: 140, height: 1920, fill: T['paper-shade'], opacity: 0.72 }),
    el('rect', { x: 470, y: 0, width: 140, height: 1920, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 3, 'stroke-dasharray': '10 8', opacity: 0.8 }),
    u > 0 ? el('line', { x1: 540, y1: -10, x2: 540, y2: (-10 + 1960 * u).toFixed(1), stroke: T['shadow-warm'], 'stroke-width': 6, opacity: 0.7 }) : '',
  ].join('');
}

function blade(t, cut) {
  if (t < cut[0] - 0.05 || t > cut[1] + 0.08) return '';
  const y = lerp(-60, 1980, seg(t, cut[0], cut[1], E.inOut));
  return g({ transform: `translate(540 ${y.toFixed(1)}) rotate(-28)` }, [
    el('rect', { x: -52, y: -370, width: 66, height: 312, rx: 18, fill: T['shadow-warm'], opacity: 0.22, filter: ref('soft-shadow') }),
    softShape('M 0 0 L -38 -70 L 22 -70 Z', T['paper-shade'], { gloss: true, form: 0.5 }),
    softShape(roundRect(-40, -380, 66, 312, 18), T.orange, { gloss: true }),
    el('line', { x1: -24, y1: -340, x2: -24, y2: -110, stroke: T['orange-dark'], 'stroke-width': 6 }),
  ]);
}

/** A flap opening about a hinge: the x hinge (left/right flaps) or the y hinge (top/bottom). */
function flap(body, under, clip, u, axis, at) {
  const c = Math.cos(Math.PI * u);
  const tr = axis === 'x' ? `translate(${at} 0) scale(${c.toFixed(4)} 1) translate(${-at} 0)` : `translate(0 ${at}) scale(1 ${c.toFixed(4)}) translate(0 ${-at})`;
  return g({ transform: tr }, g({ 'clip-path': ref(clip) }, c >= 0 ? body : under));
}

export default function draw(t, ctx) {
  const { cut, open, short, dive } = ctx.M;
  const offset = t < dive[0] ? shake(t, open[0], 22, 0.3) : shake(t, dive[1], 22, 0.3);
  const d = seg(t, dive[0], dive[1], E.in);
  const s = lerp(1, 1 / SC, d);
  const parts = [defs(), el('defs', {}, [
    el('clipPath', { id: id('L') }, el('rect', { x: 0, y: 0, width: 540, height: 1920 })),
    el('clipPath', { id: id('R') }, el('rect', { x: 540, y: 0, width: 540, height: 1920 })),
    el('clipPath', { id: id('T') }, el('rect', { x: 0, y: 0, width: 1080, height: 600 })),
    el('clipPath', { id: id('B') }, el('rect', { x: 0, y: 1320, width: 1080, height: 600 })),
    el('clipPath', { id: id('in') }, el('rect', { x: INNER.x, y: INNER.y, width: INNER.w, height: INNER.h })),
  ].join(''))];
  if (t < open[0]) return parts.join('') + lid(t, cut) + blade(t, cut);
  const inner = scene(ctx, t - open[0]);
  if (d >= 1) parts.unshift(shaken(offset, inner));
  else {
    // inside the box: four walls in shade going down to the floor, which is the hook
    const box = [
      fill(T['paper-dark']),
      el('path', { d: `M 0 0 L ${INNER.x} ${INNER.y} L ${INNER.x} ${INNER.y + INNER.h} L 0 1920 Z`, fill: T['paper-shade'] }),
      el('path', { d: `M 1080 0 L ${INNER.x + INNER.w} ${INNER.y} L ${INNER.x + INNER.w} ${INNER.y + INNER.h} L 1080 1920 Z`, fill: T.paper }),
      el('path', { d: `M 0 0 L 1080 0 L ${INNER.x + INNER.w} ${INNER.y} L ${INNER.x} ${INNER.y} Z`, fill: T['paper-dark'] }),
      el('path', { d: `M 0 1920 L 1080 1920 L ${INNER.x + INNER.w} ${INNER.y + INNER.h} L ${INNER.x} ${INNER.y + INNER.h} Z`, fill: T['paper-shade'] }),
      g({ 'clip-path': ref('in') }, g({ transform: `translate(540 960) scale(${SC.toFixed(4)}) translate(-540 -960)` }, inner)),
      el('rect', { x: INNER.x, y: INNER.y, width: INNER.w, height: INNER.h, fill: 'none', stroke: T['shadow-warm'], 'stroke-width': 18, opacity: 0.35, filter: ref('ao') }),
    ].join('');
    parts.push(shaken(offset, g({ transform: `translate(540 960) scale(${s.toFixed(4)}) translate(-540 -960)` }, box)));
  }
  // the flaps: the short ones first underneath, then the long ones on top
  const under = fill(T['paper-shade']);
  const plain = fill(T['paper-dark']) + el('rect', { x: 0, y: 0, width: 1080, height: 1920, fill: 'none', stroke: T['shadow-warm'], 'stroke-width': 16, opacity: 0.3 });
  const su = seg(t, short[0], short[1], E.out);
  if (su < 1) parts.push(flap(plain, under, 'T', su, 'y', 0), flap(plain, under, 'B', su, 'y', 1920));
  const lu = seg(t, open[0], open[1], E.out);
  if (lu < 1) parts.push(flap(lid(t, cut), under, 'L', lu, 'x', 0), flap(lid(t, cut), under, 'R', lu, 'x', 1080));
  parts.push(title(ctx, t, ctx.M.titleAt));
  return parts.join('');
}
