// 6 · Big Bang: empty paper, one tiny orange dot pulsing faster on a rising sub-bass; BOOM, the dot
// bursts with shock rings and the room springs out from it; the wordmark bursts out with the boom.
import { T, g, el, defs, scope, E, seg, lerp, room, title, wordmark, fill, shake, burst, VOICE } from './shared.js';

const BOOM = 0.6;
const VOICE_AT = BOOM;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: BOOM };

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f06-', 'paper');
    if (t < BOOM) {
      // the pulse quickens and the dot swells as the bass rises
      const u = seg(t, 0, BOOM, E.in);
      const phase = 2 * Math.PI * (3 * t + 9 * t * t);
      const r = lerp(10, 40, u) * (1 + 0.25 * Math.sin(phase));
      const halo = lerp(0, 0.25, u);
      return defs() + fill(T['paper-lit']) + el('circle', { cx: 540, cy: 960, r: (r * 3).toFixed(1), fill: T.orange, opacity: halo.toFixed(3) }) + el('circle', { cx: 540, cy: 960, r: r.toFixed(1), fill: T.orange, stroke: T.ink, 'stroke-width': 3 });
    }
    const [sx, sy] = shake(t, BOOM, 30, 0.45);
    // the room springs out from the dot
    const sp = seg(t, BOOM, BOOM + 0.55, E.spring);
    const sc = lerp(0.02, 1, sp);
    const scene = g({ transform: `translate(${(540 + sx).toFixed(1)} ${(960 + sy).toFixed(1)}) scale(${sc.toFixed(4)}) translate(-540 -960)` }, room(t, { local: t - BOOM }));
    const rings = [0, 0.08, 0.16].map((d) => {
      const u = seg(t, BOOM + d, BOOM + d + 0.6, E.out);
      return u > 0 && u < 1 ? el('circle', { cx: 540, cy: 960, r: (40 + 1100 * u).toFixed(1), fill: 'none', stroke: d ? T.ink : T.orange, 'stroke-width': (22 * (1 - u)).toFixed(1), opacity: (1 - u).toFixed(3) }) : '';
    }).join('');
    // the wordmark bursts out big, holds, then shrinks away as the title card writes in
    const w = seg(t, BOOM, BOOM + 0.35, E.spring);
    const gone = seg(t, BOOM + 1.0, BOOM + 1.3, E.in);
    const mark = gone < 1 ? g({ transform: `translate(540 640) scale(${(lerp(2.2, 1, w) * lerp(1, 0.3, gone)).toFixed(3)}) translate(-540 -640)`, opacity: (1 - gone).toFixed(3) }, wordmark(540, 640, 116, 1, { plate: true, tilt: -3 })) : '';
    return defs() + fill(T['paper-lit']) + scene + rings + burst(540, 960, seg(t, BOOM, BOOM + 0.45, (x) => x), 5) + mark + title(t, BOOM + 1.1, VOICE_AT);
  },
};
