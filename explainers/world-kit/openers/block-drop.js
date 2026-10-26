// Block Drop: wooden letter blocks drop from the top and land with heavy thuds, in rhythm,
// building BREAK, then BRAIN on it, then AI on top. The stack wobbles, creaks, and topples
// off-screen, and the hook is behind it. The voice runs over the drops.
import { shadow } from '../draw.js';
import { T, g, el, ref, defs, seg, lerp, E, scene, title, fill, shake, shaken, softShape, gloss, roundRect } from './common.js';

const SZ = 190;
const GAP = 10;
const FLOOR = 1260;
const ROWS = [
  { word: 'BREAK', fill: T.orange, ink: T['paper-lit'] },
  { word: 'BRAIN', fill: T['paper-lit'], ink: T.ink },
  { word: 'AI', fill: T.ink, ink: T.orange },
];
const BLOCKS = [];
ROWS.forEach((r, ri) => {
  const n = r.word.length;
  const x0 = 540 - (n * SZ + (n - 1) * GAP) / 2;
  [...r.word].forEach((ch, i) => BLOCKS.push({ ch, x: x0 + i * (SZ + GAP), y: FLOOR - (ri + 1) * SZ - ri * GAP, fill: r.fill, ink: r.ink }));
});

function block(b, sq = 0) {
  const cx = b.x + SZ / 2;
  const face = roundRect(b.x, b.y, SZ, SZ, 22);
  return g({ transform: `translate(${cx} ${b.y + SZ}) scale(${(1 + sq).toFixed(3)} ${(1 - sq).toFixed(3)}) translate(${-cx} ${-(b.y + SZ)})` }, [
    // a soft toy block: its shadow thrown to the lower left, a lit volume, a glossy top
    el('rect', { x: b.x - 8, y: b.y + 14, width: SZ, height: SZ, rx: 22, fill: T['shadow-warm'], opacity: 0.26, filter: ref('soft-shadow') }),
    softShape(face, b.fill),
    gloss(face, { strength: 0.55 }),
    el('rect', { x: b.x + 18, y: b.y + 18, width: SZ - 36, height: SZ - 36, rx: 10, fill: 'none', stroke: b.ink === T.ink ? T['paper-shade'] : b.ink, 'stroke-width': 3, opacity: 0.45 }),
    el('text', { x: cx, y: b.y + SZ / 2 + 47, 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': 134, fill: b.ink }, b.ch),
  ]);
}

export default function draw(t, ctx) {
  const { lands, fall, wobble, breakAt: TOPPLE } = ctx.M;
  const at = (i) => lands[i] ?? lands[lands.length - 1];
  const landed = lands.findLast((x) => t >= x);
  const parts = [defs()];
  if (t < TOPPLE) {
    const offset = landed !== undefined ? shake(t, landed, 10, 0.12) : [0, 0];
    parts.push(fill(T['paper-lit']));
    // the floor the blocks land on: a soft contact shadow under the stack, no ink line
    parts.push(shadow(540, FLOOR + 6, 520, 26, 0.16));
    const rock = 5 * Math.sin(seg(t, wobble[0], wobble[1], (x) => x) * Math.PI * 3) * seg(t, wobble[0], wobble[1], E.in);
    const stack = BLOCKS.map((b, i) => {
      if (t < at(i) - fall) return '';
      const dy = lerp(-1500, 0, seg(t, at(i) - fall, at(i), E.in));
      const sq = t >= at(i) ? 0.14 * Math.sin(Math.PI * seg(t, at(i), at(i) + 0.1, (x) => x)) : 0;
      return g({ transform: `translate(0 ${dy.toFixed(1)})` }, block(b, sq));
    });
    parts.push(shaken(offset, g({ transform: `rotate(${rock.toFixed(2)} 540 ${FLOOR})` }, stack)));
    return parts.join('');
  }
  // the topple: the stack goes over to the right, blocks tumbling out of the frame
  const k = t - TOPPLE;
  parts.unshift(shaken(shake(t, TOPPLE, 26, 0.4), scene(ctx, k)));
  if (k < 0.9) {
    BLOCKS.forEach((b, i) => {
      const h = (FLOOR - b.y) / SZ;
      const x = (520 + h * 260 + (i % 3) * 90) * k;
      const y = -380 * k + 3600 * k * k * (0.6 + 0.15 * h);
      const rot = (60 + h * 70 + (i % 4) * 25) * k * 4;
      parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)} ${b.x + SZ / 2} ${b.y + SZ / 2})` }, block(b)));
    });
  }
  parts.push(title(ctx, t, ctx.M.titleAt));
  return parts.join('');
}
