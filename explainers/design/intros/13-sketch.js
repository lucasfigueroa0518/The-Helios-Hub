// 13 · Speed Sketch: a blank page; a pencil races across it in furious zig-zags and the room
// appears in grey pencil wherever it passes. On the hit, all the colour slams in.
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, title, fill, shake, burst, VOICE } from './shared.js';

const DRAW = [0.04, 0.9];
const HIT = 0.95;
const VOICE_AT = 0.12;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: HIT, drawAt: DRAW };

// the scribble: seven passes, left to right and back, top to bottom
const ZIG = [];
for (let i = 0; i < 8; i++) ZIG.push([i % 2 ? 1060 : 20, 150 + i * 235 + (i % 2 ? 70 : 0)]);
const LENS = ZIG.slice(1).map(([x, y], i) => Math.hypot(x - ZIG[i][0], y - ZIG[i][1]));
const TOTAL = LENS.reduce((a, b) => a + b, 0);
function at(u) {
  let d = u * TOTAL;
  for (let i = 0; i < LENS.length; i++) {
    if (d <= LENS[i]) return [lerp(ZIG[i][0], ZIG[i + 1][0], d / LENS[i]), lerp(ZIG[i][1], ZIG[i + 1][1], d / LENS[i])];
    d -= LENS[i];
  }
  return ZIG[ZIG.length - 1];
}

/** A pencil, tip at (x, y), lying up and to the right. */
function pencil(x, y, wob) {
  return g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(-52 + wob).toFixed(2)})`, filter: ref('wobble') }, [
    el('rect', { x: 84, y: -26, width: 470, height: 58, fill: T.ink, opacity: 0.16, transform: 'translate(10 18)' }),
    el('path', { d: 'M 0 0 L 84 -29 L 84 29 Z', fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M 0 0 L 26 -9 L 26 9 Z', fill: T.ink }),
    el('rect', { x: 84, y: -29, width: 440, height: 58, fill: T.orange, stroke: T.ink, 'stroke-width': 5 }),
    el('line', { x1: 84, y1: 0, x2: 524, y2: 0, stroke: T['orange-dark'], 'stroke-width': 5 }),
    el('rect', { x: 524, y: -31, width: 52, height: 62, fill: T['paper-dark'], stroke: T.ink, 'stroke-width': 5 }),
    el('rect', { x: 576, y: -29, width: 56, height: 58, rx: 14, fill: T['orange-lit'], stroke: T.ink, 'stroke-width': 5 }),
  ]);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f13-', 'paper');
    if (t < HIT) {
      const u = seg(t, DRAW[0], DRAW[1], E.inOut);
      const [px, py] = at(u);
      const d = `M ${ZIG.map(([x, y]) => `${x} ${y}`).join(' L ')}`;
      return [
        defs(),
        el('defs', {}, [
          el('mask', { id: id('drawn'), maskUnits: 'userSpaceOnUse', x: -60, y: -60, width: 1200, height: 2040 }, el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 330, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': (1 - u).toFixed(4) })),
          // pencil: no colour, ink turned to graphite grey
          el('filter', { id: id('graphite') }, el('feColorMatrix', { type: 'saturate', values: '0' }) + el('feComponentTransfer', {}, ['R', 'G', 'B'].map((c) => el(`feFunc${c}`, { type: 'linear', slope: 0.5, intercept: 0.48 })).join(''))),
        ].join('')),
        fill(T['paper-lit']),
        g({ mask: ref('drawn') }, g({ filter: ref('graphite') }, room(t, { local: t }))),
        u > 0 && u < 1 ? pencil(px, py, 6 * Math.sin(t * 60)) : '',
      ].join('');
    }
    const [sx, sy] = shake(t, HIT, 26, 0.35);
    return [
      g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local: t })),
      fill(T['paper-lit'], 0.9 * (1 - seg(t, HIT, HIT + 0.12, (x) => x))),
      burst(540, 960, seg(t, HIT, HIT + 0.4, (x) => x), 4),
      title(t, HIT + 0.1, VOICE_AT),
    ].join('');
  },
};
