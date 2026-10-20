// 16 · Pop-Up Book: a closed book with "AI BRAIN BREAK" on the cover fills the frame and twitches.
// The cover slams open and the room pops up out of the page, piece by piece, like a pop-up book.
import { T, g, el, ref, defs, scope, E, seg, lerp, room, title, wordmark, fill, shake, SUBJECTS, VOICE } from './shared.js';

const OPEN = [0.28, 0.5];
const POPS = { window: 0.42, thermometer: 0.52, target_mark: 0.52, heater: 0.62, thermostat: 0.74 };
const VOICE_AT = OPEN[0];
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: OPEN[0], pops: Object.values(POPS).filter((v, i, a) => a.indexOf(v) === i) };

// where each part stands on the page (its foot, in world y): it unfolds up from there
const FOOT = {
  window: SUBJECTS.window[1] + 175,
  thermometer: SUBJECTS.thermometer[1] + 170,
  target_mark: SUBJECTS.thermometer[1] + 170,
  heater: SUBJECTS.heater[1] + 87,
  thermostat: SUBJECTS.thermostat[1] + 90 * 1.3,
};
const HINGE = 40;

function cover(t) {
  const u = seg(t, OPEN[0], OPEN[1], E.in);
  const th = Math.PI * u;
  const c = Math.cos(th);
  const tw = t < OPEN[0] ? 1.5 * Math.sin(t * 40) * seg(t, 0.1, OPEN[0], (x) => x) : 0;
  const front = c >= 0;
  const body = front
    ? [
        el('rect', { x: HINGE + 14, y: 126, width: 1000, height: 1680, rx: 18, fill: T.ink, opacity: 0.2 }),
        el('rect', { x: HINGE, y: 110, width: 1000, height: 1680, rx: 18, fill: T.orange, stroke: T.ink, 'stroke-width': 8 }),
        el('rect', { x: HINGE, y: 110, width: 70, height: 1680, fill: T['orange-dark'], stroke: T.ink, 'stroke-width': 6 }),
        el('rect', { x: 200, y: 260, width: 760, height: 1380, rx: 10, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 5, opacity: 0.6 }),
        wordmark(580, 860, 108, 1, { color: T['paper-lit'], termColor: T.ink }),
      ]
    : [el('rect', { x: HINGE, y: 110, width: 1000, height: 1680, rx: 18, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 8 })];
  return g({ transform: `rotate(${tw.toFixed(2)} 540 960) translate(${HINGE} 960) skewY(${(-14 * Math.sin(th)).toFixed(2)}) scale(${c.toFixed(4)} 1) translate(${-HINGE} -960)`, filter: ref('wobble') }, body);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f16-', 'paper');
    const [sx, sy] = shake(t, OPEN[0] + 0.04, 18, 0.25);
    const wrap = {};
    for (const [k, at] of Object.entries(POPS)) {
      const u = seg(t, at, at + 0.26, E.spring);
      wrap[k] = `translate(0 ${FOOT[k].toFixed(1)}) scale(1 ${Math.max(0.001, u).toFixed(4)}) translate(0 ${(-FOOT[k]).toFixed(1)})`;
    }
    const parts = [defs()];
    parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local: t, wrap })));
    // the page's gutter, in shadow, down the left edge
    parts.push(el('rect', { x: 0, y: 0, width: 70, height: 1920, fill: T.ink, opacity: (0.12 * (1 - seg(t, 1.1, 1.5, (x) => x))).toFixed(3) }));
    if (t < OPEN[1]) parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, cover(t)));
    parts.push(title(t, 0.95, VOICE_AT));
    return parts.join('');
  },
};
