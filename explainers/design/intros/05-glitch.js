// 5 · Paper Glitch: the room cut into horizontal paper strips, jittering out of line with an orange
// ghost; glitch stutters; the strips SNAP into line on the beat and "AI BRAIN BREAK" holds clean.
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, title, wordmark, fill, burst, VOICE } from './shared.js';

const SNAP = 0.62;
const VOICE_AT = SNAP;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: SNAP };
const BANDS = 12;
const BH = 1920 / BANDS;
const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f05-', 'paper');
    const scene = room(t, { local: t });
    const parts = [defs()];
    if (t < SNAP) {
      const k = Math.floor(t * 15); // new glitch every frame on twos
      const clips = [];
      for (let b = 0; b < BANDS; b++) clips.push(el('clipPath', { id: id(`band${b}`) }, el('rect', { x: -200, y: b * BH, width: 1480, height: BH + 1 })));
      parts.push(el('defs', {}, clips.join('') + el('filter', { id: id('ghost') }, el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 1  0 0 0 0 0.37  0 0 0 0 0.1  0 0 0 0.55 0' }))));
      parts.push(fill(T.ink));
      for (let b = 0; b < BANDS; b++) {
        const wild = rnd(b * 7 + k) > 0.45 ? 1 : 0.15;
        const dx = (rnd(b + k * 13) - 0.5) * 260 * wild * (1 - seg(t, SNAP - 0.18, SNAP, E.in));
        parts.push(g({ 'clip-path': ref(`band${b}`) }, [
          g({ transform: `translate(${dx.toFixed(1)} 0)` }, fill(T.paper)),
          g({ transform: `translate(${(dx + 22).toFixed(1)} 0)`, filter: ref('ghost') }, scene),
          g({ transform: `translate(${dx.toFixed(1)} 0)` }, scene),
        ]));
      }
      // the wordmark flickers through the noise
      if (rnd(k * 3 + 1) > 0.5) parts.push(g({ transform: `translate(${((rnd(k) - 0.5) * 60).toFixed(1)} 0)` }, wordmark(540, 900, 120, 1, { color: T['paper-lit'], termColor: T.orange })));
      return parts.join('');
    }
    parts.push(scene);
    // clean and held: the wordmark on a paper card, then it shrinks away into the title card
    const out = seg(t, SNAP + 0.75, SNAP + 1.05, E.in);
    if (out < 1) {
      parts.push(g({ transform: `translate(540 820) scale(${lerp(1, 0.2, out).toFixed(3)}) translate(-540 -820)`, opacity: (1 - out).toFixed(3) }, [
        el('rect', { x: 120, y: 560, width: 840, height: 560, rx: 24, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 6 }),
        wordmark(540, 780, 112, 1),
      ]));
    }
    parts.push(burst(540, 820, seg(t, SNAP, SNAP + 0.35, (x) => x), 4));
    parts.push(title(t, SNAP + 0.85, VOICE_AT));
    return parts.join('');
  },
};
