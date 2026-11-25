// Unboxing: the top of a taped cardboard box, seen from above, lands with "AI 101" and its books
// printed across the lid under clear tape. A box cutter runs down the seam while the card holds, the
// flaps burst open, and the camera dives into the box: frame 2, the definition beat, is its floor,
// and fills the screen as the camera lands on it.
// Sound: the box lands, a knife, the tape tearing, the flaps opening on the hit, a swish on the dive.
import { T, g, el, id, ref, defs, seg, lerp, E, fill, shake, shaken, softShape, roundRect, nextBeat } from './common.js';
import { lessonTitle, lessonIconAt } from './lesson.js';

// the box's floor, deep inside: frame 2's shape, so the dive ends with it filling the screen
const INNER = { x: 200, y: 360, w: 680, h: 1200 };
const SC = INNER.w / 1080;

/** The lid, flaps shut: cardboard, the AI 101 card's row printed across the seam, clear tape over the seam, cut down to `u`. */
function lid(key, u) {
  return [
    fill(T['paper-dark']),
    // cardboard flutes, faint
    ...Array.from({ length: 30 }, (_, i) => el('line', { x1: 0, y1: 40 + i * 64, x2: 1080, y2: 52 + i * 64, stroke: T['paper-shade'], 'stroke-width': 3, opacity: 0.5 })),
    el('line', { x1: 540, y1: 0, x2: 540, y2: 1920, stroke: T['shadow-warm'], 'stroke-width': 4, opacity: 0.3 }),
    lessonTitle(key, 1, { color: T.ink }),
    lessonIconAt(key),
    // clear packing tape over the seam: the print reads through it
    el('rect', { x: 470, y: 0, width: 140, height: 1920, fill: T['paper-lit'], opacity: 0.28 }),
    el('rect', { x: 470, y: 0, width: 140, height: 1920, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 3, 'stroke-dasharray': '10 8', opacity: 0.8 }),
    u > 0 ? el('line', { x1: 540, y1: -10, x2: 540, y2: (-10 + 1960 * u).toFixed(1), stroke: T['shadow-warm'], 'stroke-width': 6, opacity: 0.7 }) : '',
  ].join('');
}

/** The box cutter, running down the seam over `cut`. */
function blade(t, cut) {
  if (t < cut[0] - 0.05 || t > cut[1] + 0.03) return '';
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
  const { land, cardIn, exitAt, open, dive, end } = ctx.M;
  // the cut runs while the card holds; the short flaps follow the long ones open
  const cut = [cardIn + 0.1, exitAt - 0.02];
  const short = [open[0] + 0.04, open[1] + 0.04];
  const out = end - 0.034;
  const cutU = seg(t, cut[0], cut[1], E.inOut);
  const parts = [defs(), el('defs', {}, [
    el('clipPath', { id: id('L') }, el('rect', { x: 0, y: 0, width: 540, height: 1920 })),
    el('clipPath', { id: id('R') }, el('rect', { x: 540, y: 0, width: 540, height: 1920 })),
    el('clipPath', { id: id('T') }, el('rect', { x: 0, y: 0, width: 1080, height: 600 })),
    el('clipPath', { id: id('B') }, el('rect', { x: 0, y: 1320, width: 1080, height: 600 })),
    el('clipPath', { id: id('in') }, el('rect', { x: INNER.x, y: INNER.y, width: INNER.w, height: INNER.h })),
  ].join(''))];
  if (t < open[0]) {
    // the box drops onto the table: the lid comes down from just above the camera and thuds
    const z = lerp(1.14, 1, seg(t, land[0], land[1], E.in));
    const offset = shake(t, land[1], 16, 0.18);
    return parts.join('') + shaken(offset, g({ transform: `translate(540 960) scale(${z.toFixed(4)}) translate(-540 -960)` }, lid(ctx.key, cutU))) + blade(t, cut);
  }
  const d = seg(t, dive[0], out, E.in);
  if (d >= 1) return nextBeat(ctx);
  const s = lerp(1, 1 / SC, d);
  const offset = shake(t, open[0], 22, 0.2);
  // inside the box: four walls in shade going down to the floor, which is frame 2
  const box = [
    fill(T['paper-dark']),
    el('path', { d: `M 0 0 L ${INNER.x} ${INNER.y} L ${INNER.x} ${INNER.y + INNER.h} L 0 1920 Z`, fill: T['paper-shade'] }),
    el('path', { d: `M 1080 0 L ${INNER.x + INNER.w} ${INNER.y} L ${INNER.x + INNER.w} ${INNER.y + INNER.h} L 1080 1920 Z`, fill: T.paper }),
    el('path', { d: `M 0 0 L 1080 0 L ${INNER.x + INNER.w} ${INNER.y} L ${INNER.x} ${INNER.y} Z`, fill: T['paper-dark'] }),
    el('path', { d: `M 0 1920 L 1080 1920 L ${INNER.x + INNER.w} ${INNER.y + INNER.h} L ${INNER.x} ${INNER.y + INNER.h} Z`, fill: T['paper-shade'] }),
    g({ 'clip-path': ref('in') }, g({ transform: `translate(540 960) scale(${SC.toFixed(4)}) translate(-540 -960)` }, nextBeat(ctx))),
    el('rect', { x: INNER.x, y: INNER.y, width: INNER.w, height: INNER.h, fill: 'none', stroke: T['shadow-warm'], 'stroke-width': 18, opacity: 0.35 * (1 - d), filter: ref('ao') }),
  ].join('');
  parts.push(shaken(offset, g({ transform: `translate(540 960) scale(${s.toFixed(4)}) translate(-540 -960)` }, box)));
  // the flaps: the short ones underneath, then the long ones (the lid, split down the cut seam) on top
  const under = fill(T['paper-shade']);
  const plain = fill(T['paper-dark']) + el('rect', { x: 0, y: 0, width: 1080, height: 1920, fill: 'none', stroke: T['shadow-warm'], 'stroke-width': 16, opacity: 0.3 });
  const su = seg(t, short[0], short[1], E.out);
  if (su < 1) parts.push(flap(plain, under, 'T', su, 'y', 0), flap(plain, under, 'B', su, 'y', 1920));
  const lu = seg(t, open[0], open[1], E.out);
  if (lu < 1) parts.push(flap(lid(ctx.key, 1), under, 'L', lu, 'x', 0), flap(lid(ctx.key, 1), under, 'R', lu, 'x', 1080));
  return parts.join('');
}
