// 15 · Block Drop: wooden letter blocks drop from the top and land with heavy thuds, in rhythm,
// building BREAK, then BRAIN on it, then AI on top. The stack wobbles, creaks, and topples
// off-screen, and the room is behind it. The voice runs over the drops.
import { T, g, el, ref, defs, scope, E, seg, lerp, room, title, fill, shake, VOICE } from './shared.js';

const VOICE_AT = 0;
const SZ = 190;
const GAP = 10;
const FLOOR = 1260;
const FIRST = 0.1;
const EVERY = 0.085;
const FALL = 0.13;
const ROWS = [
  { word: 'BREAK', fill: T.orange, ink: T['paper-lit'] },
  { word: 'BRAIN', fill: T['paper-lit'], ink: T.ink },
  { word: 'AI', fill: T.ink, ink: T.orange },
];
const BLOCKS = [];
ROWS.forEach((r, ri) => {
  const n = r.word.length;
  const x0 = 540 - (n * SZ + (n - 1) * GAP) / 2;
  [...r.word].forEach((ch, i) => BLOCKS.push({ ch, x: x0 + i * (SZ + GAP), y: FLOOR - (ri + 1) * SZ - ri * GAP, fill: r.fill, ink: r.ink, at: 0 }));
});
BLOCKS.forEach((b, i) => { b.at = FIRST + i * EVERY; });
const LAST = BLOCKS[BLOCKS.length - 1].at;
const WOBBLE = [LAST + 0.12, LAST + 0.42];
const TOPPLE = WOBBLE[1];
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: TOPPLE, lands: BLOCKS.map((b) => +b.at.toFixed(3)), wobbleAt: WOBBLE[0] };

function block(b, sq = 0) {
  const cx = b.x + SZ / 2;
  return g({ transform: `translate(${cx} ${b.y + SZ}) scale(${(1 + sq).toFixed(3)} ${(1 - sq).toFixed(3)}) translate(${-cx} ${-(b.y + SZ)})`, filter: ref('wobble') }, [
    el('rect', { x: b.x + 8, y: b.y + 12, width: SZ, height: SZ, rx: 16, fill: T.ink, opacity: 0.18 }),
    el('rect', { x: b.x, y: b.y, width: SZ, height: SZ, rx: 16, fill: b.fill, stroke: T.ink, 'stroke-width': 6 }),
    el('rect', { x: b.x + 16, y: b.y + 16, width: SZ - 32, height: SZ - 32, rx: 8, fill: 'none', stroke: b.ink === T.ink ? T['paper-shade'] : b.ink, 'stroke-width': 4, opacity: 0.6 }),
    el('text', { x: cx, y: b.y + SZ / 2 + 44, 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': 134, fill: b.ink }, b.ch),
  ]);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f15-', 'paper');
    const land = BLOCKS.findLast((b) => t >= b.at);
    const [sx, sy] = t < TOPPLE ? (land ? shake(t, land.at, 10, 0.12) : [0, 0]) : shake(t, TOPPLE, 26, 0.4);
    const parts = [defs()];
    if (t < TOPPLE) {
      parts.push(fill(T['paper-lit']));
      parts.push(el('line', { x1: 0, y1: FLOOR + 4, x2: 1080, y2: FLOOR + 4, stroke: T.ink, 'stroke-width': 6, filter: ref('wobble') }));
      const rock = 5 * Math.sin(seg(t, WOBBLE[0], WOBBLE[1], (x) => x) * Math.PI * 3) * seg(t, WOBBLE[0], WOBBLE[1], E.in);
      const stack = BLOCKS.filter((b) => t >= b.at - FALL).map((b) => {
        const u = seg(t, b.at - FALL, b.at, E.in);
        const dy = lerp(-1500, 0, u);
        const sq = t >= b.at ? 0.14 * Math.sin(Math.PI * seg(t, b.at, b.at + 0.1, (x) => x)) : 0;
        return g({ transform: `translate(0 ${dy.toFixed(1)})` }, block(b, sq));
      });
      parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)}) rotate(${rock.toFixed(2)} 540 ${FLOOR})` }, stack));
      return parts.join('');
    }
    // the topple: the stack goes over to the right, blocks tumbling out of the frame
    const k = t - TOPPLE;
    parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local: k })));
    if (k < 0.9) {
      BLOCKS.forEach((b, i) => {
        const h = (FLOOR - b.y) / SZ;
        const vx = 520 + h * 260 + (i % 3) * 90;
        const x = vx * k;
        const y = -380 * k + 3600 * k * k * (0.6 + 0.15 * h);
        const rot = (60 + h * 70 + (i % 4) * 25) * k * 4;
        const cx = b.x + SZ / 2;
        const cy = b.y + SZ / 2;
        parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)} ${cx} ${cy})` }, block(b)));
      });
    }
    parts.push(title(t, TOPPLE + 0.3, VOICE_AT));
    return parts.join('');
  },
};
