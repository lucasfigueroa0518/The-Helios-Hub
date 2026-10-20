// 7 · Knock Knock: the thermostat critter pops up huge against the screen, knocks twice on the
// glass, points up as "AI BRAIN BREAK" writes itself, then ducks away to show its room.
import { T, g, el, defs, scope, E, seg, lerp, room, wordmark, shake, shock, VOICE } from './shared.js';
import { critter } from '../kit/cast.js';

const POP = [0, 0.2];
const KNOCKS = [0.32, 0.52];
const POINT = 0.66;
const WRITE = [0.68, 1.15];
const DUCK = [1.18, 1.42];
const VOICE_AT = 0.62;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: KNOCKS[0], knocks: KNOCKS, duckAt: DUCK[0], writeAt: WRITE };
const S = 7.4;

/** A small starburst crack where a knock lands on the glass. */
function crack(x, y, u) {
  if (u <= 0 || u >= 1) return '';
  const rays = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    rays.push(`M ${x} ${y} l ${(Math.cos(a) * 60 * Math.min(1, u * 4)).toFixed(1)} ${(Math.sin(a) * 60 * Math.min(1, u * 4)).toFixed(1)}`);
  }
  return el('path', { d: rays.join(' '), stroke: T['paper-lit'], 'stroke-width': 6, 'stroke-linecap': 'round', opacity: (1 - u).toFixed(3) });
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f07-', 'paper');
    const knock = KNOCKS.find((k) => t >= k - 0.08 && t < k + 0.12);
    const [sx, sy] = KNOCKS.reduce((acc, k) => { const [a, b] = shake(t, k, 18, 0.2); return [acc[0] + a, acc[1] + b]; }, [0, 0]);
    // the critter: up from below, a lean in on each knock, then down and away
    const up = seg(t, POP[0], POP[1], E.spring);
    const down = seg(t, DUCK[0], DUCK[1], E.in);
    const y = lerp(3300, 2120, up) + lerp(0, 1400, down);
    const lean = knock !== undefined ? 1 + 0.05 * Math.sin(Math.PI * seg(t, knock - 0.08, knock + 0.12, (x) => x)) : 1;
    const arms = t >= POINT ? 'point' : knock !== undefined ? 'push' : 'hold';
    const mood = t >= POINT ? 'happy' : 'surprised';
    const parts = [defs()];
    // the room behind, dimmed until the critter leaves
    parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local: t })));
    parts.push(el('rect', { x: 0, y: 0, width: 1080, height: 1920, fill: T.ink, opacity: (0.55 * (1 - seg(t, DUCK[0], DUCK[1] + 0.1, (x) => x))).toFixed(3) }));
    if (down < 1) {
      parts.push(g({ transform: `translate(${(540 + sx).toFixed(1)} ${(y + sy).toFixed(1)}) scale(${lean.toFixed(3)}) translate(-540 0)` }, critter(540, 0, { s: S, wear: ['scarf', 'cap'], mood, arms, look: t >= POINT ? [0.2, -0.8] : [0, 0] })));
    }
    KNOCKS.forEach((k) => parts.push(crack(830, 1420, seg(t, k, k + 0.35, (x) => x))));
    if (t >= WRITE[0]) {
      const hold = 1 - seg(t, VOICE_AT + VOICE - 0.3, VOICE_AT + VOICE + 0.1, (x) => x);
      parts.push(g({ opacity: hold.toFixed(3) }, wordmark(540, 420, 92, seg(t, WRITE[0], WRITE[1], (x) => x), { color: t < DUCK[1] ? T['paper-lit'] : T.ink, plate: t >= DUCK[1] })));
    }
    parts.push(shock(760, 300, seg(t, POINT, POINT + 0.3, (x) => x), 2));
    return parts.join('');
  },
};
