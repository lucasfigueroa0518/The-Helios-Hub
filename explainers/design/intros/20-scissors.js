// 20 · Scissors Cut-Out: a plain page with the critter printed on it and a dashed cut line around
// it. Scissors snip round it in rhythm; the cut-out lifts off, the page falls away to show the
// room, and the critter drops into its place there.
import { T, g, el, ref, defs, scope, E, seg, lerp, room, roomCamera, title, fill, shake, burst, toScreen, SUBJECTS, VOICE } from './shared.js';
import { critter } from '../kit/cast.js';

const VOICE_AT = 0.08;
const SNIPS = Array.from({ length: 8 }, (_, i) => +(0.1 + i * 0.095).toFixed(3));
const LIFT = [0.86, 1.0];
const FALL = [0.92, 1.3];
const DROP = [1.02, 1.42];
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: LIFT[0], snips: SNIPS, dropAt: DROP };

const S = 4.2;
const FEET = [540, 1250];
// the cut line: a rounded box round the critter (a superellipse), from the top, clockwise
const CUT = { cx: 540, cy: 850, a: 420, b: 530 };
const N = 160;
const PTS = Array.from({ length: N + 1 }, (_, i) => {
  const th = -Math.PI / 2 + (i / N) * Math.PI * 2;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [CUT.cx + CUT.a * Math.sign(c) * Math.pow(Math.abs(c), 0.5), CUT.cy + CUT.b * Math.sign(s) * Math.pow(Math.abs(s), 0.5)];
});
const D = `M ${PTS.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;

/** How far round the cut is at t: a bite per snip. */
function cutAt(t) {
  let u = 0;
  SNIPS.forEach((s) => { u += seg(t, s - 0.05, s, E.out) / SNIPS.length; });
  return u;
}

function scissors(x, y, ang, open) {
  const o = 4 + 20 * open;
  const blade = (sgn) => g({ transform: `rotate(${(sgn * o).toFixed(2)})` }, [
    el('path', { d: `M 0 0 L 230 ${sgn * -6} L 0 ${sgn * 22} Z`, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
    el('path', { d: `M 0 0 L -120 ${sgn * 30}`, stroke: T.ink, 'stroke-width': 14, 'stroke-linecap': 'round' }),
    el('ellipse', { cx: -170, cy: sgn * 52, rx: 62, ry: 42, fill: 'none', stroke: T.orange, 'stroke-width': 24 }),
    el('ellipse', { cx: -170, cy: sgn * 52, rx: 62, ry: 42, fill: 'none', stroke: T.ink, 'stroke-width': 4 }),
  ]);
  // blades point along the cut: (x, y) is where they meet the paper
  return g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)}) translate(-150 0)`, filter: ref('wobble') }, [blade(1), blade(-1), el('circle', { cx: 0, cy: 0, r: 10, fill: T.ink })]);
}

function cutout(lift) {
  return [
    el('path', { d: D, fill: T.ink, opacity: (0.08 + 0.14 * lift).toFixed(3), transform: `translate(${(10 + 26 * lift).toFixed(1)} ${(14 + 36 * lift).toFixed(1)})` }),
    el('path', { d: D, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5 }),
    critter(FEET[0], FEET[1], { s: S, wear: ['scarf', 'cap'], mood: lift > 0 ? 'happy' : 'worried', arms: 'down' }),
  ].join('');
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f20-', 'paper');
    const local = t;
    const landed = t >= DROP[1];
    const [sx, sy] = landed ? shake(t, DROP[1], 18, 0.3) : [0, 0];
    const parts = [defs()];
    parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local, hide: landed ? [] : ['thermostat'] })));
    const u = cutAt(t);
    if (t < FALL[1]) {
      // the page, with a hole where the cut-out was once it lifts, falling away
      const f = seg(t, FALL[0], FALL[1], E.in);
      const hole = t >= LIFT[0];
      const page = [
        el('path', { d: `M -60 -60 H 1140 V 1980 H -60 Z ${hole ? D : ''}`, fill: T['paper-lit'], 'fill-rule': 'evenodd', stroke: hole ? T.ink : 'none', 'stroke-width': 5 }),
        hole ? '' : critter(FEET[0], FEET[1], { s: S, wear: ['scarf', 'cap'], mood: 'worried' }),
        hole ? '' : el('path', { d: D, fill: 'none', stroke: T.ink, 'stroke-width': 5, 'stroke-dasharray': '22 16', opacity: 0.55 }),
        !hole && u > 0 ? el('path', { d: D, fill: 'none', stroke: T.ink, 'stroke-width': 7, pathLength: 1, 'stroke-dasharray': `${u.toFixed(4)} 1` }) : '',
      ];
      parts.push(g({ transform: `translate(${(-120 * f).toFixed(1)} ${(2100 * f * f).toFixed(1)}) rotate(${(-12 * f).toFixed(2)} 540 1900)` }, page));
    }
    if (t >= LIFT[0] && !landed) {
      // the cut-out lifts, then flies down into the critter's spot in the room
      const lift = seg(t, LIFT[0], LIFT[1], E.out);
      const d = seg(t, DROP[0], DROP[1], E.inOut);
      const zoom = roomCamera(local).zoom;
      const [fx, fy] = toScreen([SUBJECTS.thermostat[0], SUBJECTS.thermostat[1] + 90 * 1.3], local);
      const k = lerp(1 + 0.06 * lift, (1.3 * zoom) / S, d);
      const x = lerp(FEET[0], fx, d);
      const y = lerp(FEET[1], fy, d) - 120 * Math.sin(Math.PI * d);
      parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)}) translate(${-FEET[0]} ${-FEET[1]})`, opacity: (1 - seg(t, DROP[1] - 0.05, DROP[1], (q) => q)).toFixed(3) }, cutout(lift)));
    }
    if (t < LIFT[0]) {
      // the scissors, at the end of the cut, snapping shut on each snip
      const i = Math.min(N, Math.round(u * N));
      const [x, y] = PTS[i];
      const [x2, y2] = PTS[Math.min(N, i + 1)];
      const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
      const near = SNIPS.find((s) => t >= s - 0.07 && t < s + 0.03);
      const open = near === undefined ? 1 : seg(t, near - 0.07, near, E.in) < 1 ? 1 - seg(t, near - 0.07, near, E.in) : seg(t, near, near + 0.03, (q) => q);
      parts.push(scissors(x, y, ang, open));
    }
    if (landed) {
      const [fx, fy] = toScreen(SUBJECTS.thermostat, local);
      parts.push(burst(fx, fy, seg(t, DROP[1], DROP[1] + 0.35, (q) => q), 2.4));
    }
    parts.push(title(t, DROP[1] - 0.1, VOICE_AT));
    return parts.join('');
  },
};
