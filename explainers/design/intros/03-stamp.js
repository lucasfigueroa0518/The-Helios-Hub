// 3 · Stamp Slam: 0.15s of black and silence, then a giant rubber stamp crashes down; the stamped
// "AI BRAIN BREAK" shakes the frame, then the camera dives through it into the room.
import { T, g, el, defs, scope, E, seg, lerp, room, title, handwrite, fill, shake, burst, VOICE } from './shared.js';

const DROP = 0.15;
const SLAM = 0.32;
const DIVE = [0.95, 1.3];
const VOICE_AT = 0.4;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: SLAM };

const rnd = (i) => { const x = Math.sin(i * 91.7 + 13.1) * 43758.5; return x - Math.floor(x); };

/** The stamped imprint: a double border, the wordmark and the term, in orange ink with gaps. */
function imprint() {
  const out = [
    el('rect', { x: -430, y: -270, width: 860, height: 540, rx: 26, fill: 'none', stroke: T.orange, 'stroke-width': 18 }),
    el('rect', { x: -398, y: -238, width: 796, height: 476, rx: 16, fill: 'none', stroke: T.orange, 'stroke-width': 6 }),
    handwrite('AI BRAIN', 0, -80, 118, 1, { color: T.orange, align: 'center', weight: 2.2 }),
    handwrite('BREAK', 0, 80, 118, 1, { color: T.orange, align: 'center', weight: 2.2 }),
    handwrite('AGENT LOOP', 0, 190, 54, 1, { color: T.orange, align: 'center', weight: 1.8 }),
  ];
  // ink gaps: paper specks where the rubber didn't take
  for (let i = 0; i < 70; i++) out.push(el('circle', { cx: (-420 + rnd(i) * 840).toFixed(1), cy: (-260 + rnd(i + 99) * 520).toFixed(1), r: (2 + rnd(i + 7) * 7).toFixed(1), fill: T['paper-lit'], opacity: 0.85 }));
  return g({ transform: 'rotate(-7)' }, out);
}

/** Ink splatter around the imprint, flung on the slam. */
function splatter(u) {
  const out = [];
  for (let i = 0; i < 22; i++) {
    const a = rnd(i + 3) * Math.PI * 2;
    const d = (480 + rnd(i + 31) * 260) * Math.min(1, u * 3);
    out.push(el('circle', { cx: (Math.cos(a) * d).toFixed(1), cy: (Math.sin(a) * d * 0.9).toFixed(1), r: (5 + rnd(i + 5) * 16).toFixed(1), fill: T.orange }));
  }
  return out.join('');
}

/** The rubber stamp: a wooden block with a round knob, its face down. */
function stamp(y) {
  return g({ transform: `translate(540 ${y.toFixed(1)})` }, [
    el('rect', { x: -60, y: -620, width: 120, height: 260, rx: 30, fill: T['orange-dark'], stroke: T.ink, 'stroke-width': 6 }),
    el('circle', { cx: 0, cy: -660, r: 110, fill: T.orange, stroke: T.ink, 'stroke-width': 6 }),
    el('rect', { x: -470, y: -380, width: 940, height: 330, rx: 22, fill: T['paper-dark'], stroke: T.ink, 'stroke-width': 6 }),
    el('rect', { x: -470, y: -60, width: 940, height: 60, rx: 8, fill: T.orange, stroke: T.ink, 'stroke-width': 6 }),
  ]);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f03-', 'paper');
    if (t < DROP) return defs() + fill(T.ink);
    if (t < DIVE[0]) {
      const [sx, sy] = shake(t, SLAM, 40, 0.4);
      const fallY = t < SLAM ? lerp(-700, 690, seg(t, DROP, SLAM, E.in)) : lerp(690, -900, seg(t, SLAM + 0.08, SLAM + 0.45, E.in));
      return defs() + g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, [
        fill(T['paper-lit']),
        t >= SLAM ? g({ transform: 'translate(540 960)' }, splatter(seg(t, SLAM, SLAM + 0.2, E.out)) + imprint()) : '',
        burst(540, 960, seg(t, SLAM, SLAM + 0.4, (x) => x), 5),
        stamp(fallY),
      ]);
    }
    // the dive: the imprint rushes past the camera and the room comes up underneath
    const u = seg(t, DIVE[0], DIVE[1], E.in);
    const sheet = g({ transform: `translate(540 960) scale(${lerp(1, 7, u).toFixed(3)})`, opacity: (1 - seg(t, DIVE[0] + 0.15, DIVE[1], (x) => x)).toFixed(3) }, [
      el('rect', { x: -700, y: -1100, width: 1400, height: 2200, fill: T['paper-lit'] }),
      splatter(1),
      imprint(),
    ]);
    const back = room(t, { local: t - DIVE[0], camera: { zoom: lerp(0.82, 1, seg(t, DIVE[0], DIVE[1] + 0.2, E.out)) } });
    return back + sheet + title(t, DIVE[1] - 0.05, VOICE_AT);
  },
};
