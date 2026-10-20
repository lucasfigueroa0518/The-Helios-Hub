// 9 · Spoiler Rewind: it opens on the ending (warm room, needle on the red mark, critter relieved);
// the tape stops, "◀◀ REWIND" scrawls on, the scene runs backwards fast to the cold start, and
// "AI BRAIN BREAK" slams in as everything restarts.
import { T, g, el, defs, scope, E, seg, lerp, room, title, wordmark, handwrite, burst, blendState, START, END, VOICE } from './shared.js';

const STOP = [0.8, 1.05];
const REW = [1.05, 1.7];
const VOICE_AT = 1.75;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: STOP[0], tapeStop: STOP, rewind: REW, slamAt: VOICE_AT };
const rnd = (i) => { const x = Math.sin(i * 23.1 + 4.2) * 43758.5; return x - Math.floor(x); };

/** VHS lines rolling down the frame while it rewinds. */
function vhs(t) {
  const k = Math.floor(t * 30);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const y = ((rnd(i * 5 + k) * 1920 + t * 2400) % 1920);
    out.push(el('rect', { x: 0, y: y.toFixed(1), width: 1080, height: (6 + rnd(i + k) * 30).toFixed(1), fill: T['paper-lit'], opacity: (0.18 + rnd(i * 3 + k) * 0.25).toFixed(3) }));
  }
  return out.join('');
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f09-', 'paper');
    const parts = [defs()];
    if (t < STOP[0]) {
      parts.push(room(t, { local: t, state: END, shiver: 0 }));
    } else if (t < REW[0]) {
      // the tape slows to a stop: the picture drags, sags and dims
      const u = seg(t, STOP[0], STOP[1], E.in);
      const at = STOP[0] + 0.25 * Math.sqrt(seg(t, STOP[0], STOP[1], (x) => x));
      parts.push(g({ transform: `translate(0 ${(40 * u).toFixed(1)})`, opacity: (1 - 0.3 * u).toFixed(3) }, room(at, { local: at, state: END, shiver: 0 })));
    } else if (t < REW[1]) {
      const u = seg(t, REW[0], REW[1], E.inOut);
      const state = blendState(END, START, u);
      const at = STOP[0] + 0.25 - (t - REW[0]) * 3;
      parts.push(room(Math.max(0, at), { local: Math.max(0, at), state, shiver: u }));
      parts.push(vhs(t));
      // the label: ◀◀ REWIND, top left
      parts.push(g({ transform: 'translate(120 330)' }, [
        el('polygon', { points: '0,0 44,-30 44,30', fill: T['status-error'] }),
        el('polygon', { points: '40,0 84,-30 84,30', fill: T['status-error'] }),
        handwrite('REWIND', 110, 24, 64, seg(t, REW[0], REW[0] + 0.25, (x) => x), { color: T.ink, weight: 1.6 }),
      ]));
    } else {
      parts.push(room(t, { local: t - REW[1] }));
      const w = seg(t, VOICE_AT, VOICE_AT + 0.25, E.spring);
      const gone = seg(t, VOICE_AT + 1.0, VOICE_AT + 1.3, E.in);
      if (gone < 1) parts.push(g({ transform: `translate(540 640) scale(${(lerp(1.8, 1, w) * lerp(1, 0.3, gone)).toFixed(3)}) translate(-540 -640)`, opacity: (1 - gone).toFixed(3) }, wordmark(540, 640, 110, 1, { plate: true, tilt: -3 })));
      parts.push(burst(540, 640, seg(t, VOICE_AT, VOICE_AT + 0.4, (x) => x), 4));
      parts.push(title(t, VOICE_AT + 1.1, VOICE_AT));
    }
    return parts.join('');
  },
};
