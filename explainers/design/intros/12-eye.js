// 12 · Eye Zoom-Out: one giant eye fills the screen. It looks left, right, then straight at you,
// and blinks. Whoosh: a crash zoom out (eye → face → critter → room) lands on a bass hit, and
// "AI BRAIN BREAK" slams in as it lands.
import { T, g, el, defs, scope, E, seg, lerp, room, title, wordmark, shake, burst, focus, blendCamera, SUBJECTS, VOICE } from './shared.js';

const BLINK = [0.34, 0.46];
const ZOOM = [0.5, 0.92];
const VOICE_AT = 0.5;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: ZOOM[0], blinkAt: BLINK[0], landAt: ZOOM[1] };

const EYE = [SUBJECTS.thermostatFace[0] - 25 * 1.3, SUBJECTS.thermostatFace[1]];
const CLOSE = 24;

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f12-', 'paper');
    const close = focus(t, EYE, CLOSE);
    const camera = t < ZOOM[0] ? close : blendCamera(t, close, {}, seg(t, ZOOM[0], ZOOM[1], E.out));
    // the eye darts left, right, then locks on the viewer
    const look = t < 0.12 ? [-0.8, 0] : t < 0.26 ? [0.8, 0] : [0, 0];
    const still = t < ZOOM[1];
    const [sx, sy] = shake(t, ZOOM[1], 28, 0.4);
    const parts = [defs(), g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local: t, camera, shiver: still ? 0 : 1, pose: still ? { look } : {} }))];
    // the blink: the ink lid sweeps down over the whole frame and back up
    const b = t >= BLINK[0] && t < BLINK[1] ? Math.sin(Math.PI * seg(t, BLINK[0], BLINK[1], (x) => x)) : 0;
    if (b > 0) {
      parts.push(el('rect', { x: -50, y: -50, width: 1180, height: (-50 + 1100 * b).toFixed(1), fill: T.ink }));
      parts.push(el('rect', { x: -50, y: (1970 - 1100 * b).toFixed(1), width: 1180, height: 1100, fill: T.ink }));
    }
    // speed lines on the zoom
    const z = seg(t, ZOOM[0], ZOOM[1], (x) => x);
    if (z > 0 && z < 1) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + 0.1;
        const r0 = lerp(120, 700, z);
        const r1 = r0 + 520 * (1 - z);
        parts.push(el('line', { x1: (540 + Math.cos(a) * r0).toFixed(1), y1: (960 + Math.sin(a) * r0).toFixed(1), x2: (540 + Math.cos(a) * r1).toFixed(1), y2: (960 + Math.sin(a) * r1).toFixed(1), stroke: T.ink, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: (0.7 * (1 - z)).toFixed(3) }));
      }
    }
    // the wordmark slams in as the zoom lands, holds, then shrinks into the title band
    if (t >= ZOOM[1] - 0.04) {
      const w = seg(t, ZOOM[1] - 0.04, ZOOM[1] + 0.22, E.spring);
      const gone = seg(t, ZOOM[1] + 1.05, ZOOM[1] + 1.35, E.in);
      if (gone < 1) parts.push(g({ transform: `translate(540 600) scale(${(lerp(2.4, 1, w) * lerp(1, 0.3, gone)).toFixed(3)}) translate(-540 -600)`, opacity: ((1 - gone) * Math.min(1, w * 3)).toFixed(3) }, wordmark(540, 600, 112, 1, { plate: true, tilt: 3 })));
    }
    parts.push(burst(540, 960, seg(t, ZOOM[1], ZOOM[1] + 0.4, (x) => x), 4.5));
    parts.push(title(t, ZOOM[1] + 1.15, VOICE_AT));
    return parts.join('');
  },
};
