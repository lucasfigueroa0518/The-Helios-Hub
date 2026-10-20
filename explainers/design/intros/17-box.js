// 17 · Unboxing: the top of a taped cardboard box with "AI BRAIN BREAK" on it, seen from above. A
// box cutter slices the tape, the flaps burst open, and the camera dives into the box, where the
// room is.
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, title, wordmark, fill, shake, VOICE } from './shared.js';

const CUT = [0.1, 0.42];
const OPEN = [0.48, 0.66];
const SHORT = [0.56, 0.76];
const DIVE = [0.82, 1.22];
const VOICE_AT = OPEN[0];
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: OPEN[0], cutAt: CUT, diveAt: DIVE };

const INNER = { x: 200, y: 360, w: 680, h: 1200 };
const SC = INNER.w / 1080;

function lid(t) {
  const u = seg(t, CUT[0], CUT[1], E.inOut);
  return [
    fill(T['paper-dark']),
    // cardboard flutes, faint
    ...Array.from({ length: 30 }, (_, i) => el('line', { x1: 0, y1: 40 + i * 64, x2: 1080, y2: 52 + i * 64, stroke: T['paper-shade'], 'stroke-width': 3, opacity: 0.5 })),
    el('line', { x1: 540, y1: 0, x2: 540, y2: 1920, stroke: T.ink, 'stroke-width': 4, opacity: 0.5 }),
    wordmark(540, 900, 112, 1, { color: T.ink, termColor: T['orange-dark'], weight: 1.6 }),
    // the tape over the seam, cut down to the blade
    el('rect', { x: 470, y: 0, width: 140, height: 1920, fill: T['paper-shade'], opacity: 0.72 }),
    el('rect', { x: 470, y: 0, width: 140, height: 1920, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 3, 'stroke-dasharray': '10 8', opacity: 0.8 }),
    u > 0 ? el('line', { x1: 540, y1: -10, x2: 540, y2: (-10 + 1960 * u).toFixed(1), stroke: T.ink, 'stroke-width': 7 }) : '',
  ].join('');
}

function blade(t) {
  if (t < CUT[0] - 0.05 || t > CUT[1] + 0.08) return '';
  const y = lerp(-60, 1980, seg(t, CUT[0], CUT[1], E.inOut));
  return g({ transform: `translate(540 ${y.toFixed(1)}) rotate(-28)`, filter: ref('wobble') }, [
    el('path', { d: 'M 0 0 L -38 -70 L 22 -70 Z', fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
    el('rect', { x: -40, y: -380, width: 66, height: 312, rx: 14, fill: T.orange, stroke: T.ink, 'stroke-width': 6 }),
    el('line', { x1: -24, y1: -340, x2: -24, y2: -110, stroke: T['orange-dark'], 'stroke-width': 6 }),
  ]);
}

/** A flap opening about a hinge: the x hinge (left/right flaps) or the y hinge (top/bottom). */
function flap(body, under, clip, u, axis, at) {
  const c = Math.cos(Math.PI * u);
  const tr = axis === 'x' ? `translate(${at} 0) scale(${c.toFixed(4)} 1) translate(${-at} 0)` : `translate(0 ${at}) scale(1 ${c.toFixed(4)}) translate(0 ${-at})`;
  return g({ transform: tr }, g({ 'clip-path': ref(clip) }, c >= 0 ? body : under));
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f17-', 'paper');
    const [sx, sy] = t < DIVE[0] ? shake(t, OPEN[0], 22, 0.3) : shake(t, DIVE[1], 22, 0.3);
    const d = seg(t, DIVE[0], DIVE[1], E.in);
    const s = lerp(1, 1 / SC, d);
    const inner = room(t, { local: t });
    const parts = [defs(), el('defs', {}, [
      el('clipPath', { id: id('L') }, el('rect', { x: 0, y: 0, width: 540, height: 1920 })),
      el('clipPath', { id: id('R') }, el('rect', { x: 540, y: 0, width: 540, height: 1920 })),
      el('clipPath', { id: id('T') }, el('rect', { x: 0, y: 0, width: 1080, height: 600 })),
      el('clipPath', { id: id('B') }, el('rect', { x: 0, y: 1320, width: 1080, height: 600 })),
      el('clipPath', { id: id('in') }, el('rect', { x: INNER.x, y: INNER.y, width: INNER.w, height: INNER.h })),
    ].join(''))];
    if (t < OPEN[0]) return parts.join('') + lid(t) + blade(t);
    // inside the box: four walls in shade going down to the floor, which is the room
    const box = [
      fill(T['paper-dark']),
      el('path', { d: `M 0 0 L ${INNER.x} ${INNER.y} L ${INNER.x} ${INNER.y + INNER.h} L 0 1920 Z`, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 5 }),
      el('path', { d: `M 1080 0 L ${INNER.x + INNER.w} ${INNER.y} L ${INNER.x + INNER.w} ${INNER.y + INNER.h} L 1080 1920 Z`, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 5 }),
      el('path', { d: `M 0 0 L 1080 0 L ${INNER.x + INNER.w} ${INNER.y} L ${INNER.x} ${INNER.y} Z`, fill: T['paper-dark'], stroke: T.ink, 'stroke-width': 5 }),
      el('path', { d: `M 0 1920 L 1080 1920 L ${INNER.x + INNER.w} ${INNER.y + INNER.h} L ${INNER.x} ${INNER.y + INNER.h} Z`, fill: T['paper-dark'], stroke: T.ink, 'stroke-width': 5 }),
      g({ 'clip-path': ref('in') }, g({ transform: `translate(540 960) scale(${SC.toFixed(4)}) translate(-540 -960)` }, inner)),
      el('rect', { x: INNER.x, y: INNER.y, width: INNER.w, height: INNER.h, fill: 'none', stroke: T.ink, 'stroke-width': 6 }),
    ].join('');
    if (d >= 1) parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, inner));
    else parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)}) translate(540 960) scale(${s.toFixed(4)}) translate(-540 -960)` }, box));
    // the flaps: the short ones first underneath, then the long ones on top
    const under = fill(T['paper-shade']);
    const plain = fill(T['paper-dark']) + el('rect', { x: 0, y: 0, width: 1080, height: 1920, fill: 'none', stroke: T.ink, 'stroke-width': 10 });
    const su = seg(t, SHORT[0], SHORT[1], E.out);
    if (su < 1) parts.push(flap(plain, under, 'T', su, 'y', 0), flap(plain, under, 'B', su, 'y', 1920));
    const lu = seg(t, OPEN[0], OPEN[1], E.out);
    if (lu < 1) parts.push(flap(lid(t), under, 'L', lu, 'x', 0), flap(lid(t), under, 'R', lu, 'x', 1080));
    parts.push(title(t, DIVE[1], VOICE_AT));
    return parts.join('');
  },
};
