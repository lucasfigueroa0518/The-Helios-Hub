// Block Drop: soft toy blocks drop onto a wooden shelf in rhythm and spell "AI 101", the apple
// block last. The shelf creaks, then snaps in the middle: its halves swing down, the blocks tumble
// out of the frame and the sheet behind them drops away, uncovering frame 2, the definition beat.
// Sound: a wood knock per block, a creak, then the break as the shelf gives.
import { shadow } from '../draw.js';
import { T, g, el, ref, defs, seg, lerp, E, fill, shake, shaken, softShape, gloss, roundRect, nextBeat } from './common.js';
import { lessonIcon } from './lesson.js';

const SZ = 132;
const GAP = 10;
// the space between AI and 101, and before the apple block
const WORD_GAP = 44;
const ICON_GAP = 34;
const FLOOR = 1030;
const FALL = 0.09;
const SHELF = { x: 40, w: 1000, h: 46 };
const SNAP = 545;

const APPLE = lessonIcon('apple');
const ROW = [
  { ch: 'A', fill: T.ink, ink: T.orange },
  { ch: 'I', fill: T.ink, ink: T.orange, gap: WORD_GAP },
  { ch: '1', fill: T.orange, ink: T['paper-lit'] },
  { ch: '0', fill: T.orange, ink: T['paper-lit'] },
  { ch: '1', fill: T.orange, ink: T['paper-lit'], gap: ICON_GAP },
  { apple: true, fill: T['paper-lit'], ink: T['paper-shade'] },
];
const BLOCKS = [];
{
  const width = ROW.length * SZ + ROW.reduce((w, b, i) => w + (i < ROW.length - 1 ? b.gap ?? GAP : 0), 0);
  let x = 540 - width / 2;
  for (const b of ROW) {
    BLOCKS.push({ ...b, x, y: FLOOR - SZ });
    x += SZ + (b.gap ?? GAP);
  }
}

function block(b, sq = 0) {
  const cx = b.x + SZ / 2;
  const face = roundRect(b.x, b.y, SZ, SZ, 18);
  const k = (SZ * 0.66) / APPLE.w;
  return g({ transform: `translate(${cx} ${b.y + SZ}) scale(${(1 + sq).toFixed(3)} ${(1 - sq).toFixed(3)}) translate(${-cx} ${-(b.y + SZ)})` }, [
    // a soft toy block: its shadow thrown to the lower left, a lit volume, a glossy top
    el('rect', { x: b.x - 6, y: b.y + 10, width: SZ, height: SZ, rx: 18, fill: T['shadow-warm'], opacity: 0.26, filter: ref('soft-shadow') }),
    softShape(face, b.fill),
    gloss(face, { strength: 0.55 }),
    el('rect', { x: b.x + 13, y: b.y + 13, width: SZ - 26, height: SZ - 26, rx: 8, fill: 'none', stroke: b.ink === T.orange ? T['paper-shade'] : b.ink, 'stroke-width': 3, opacity: 0.45 }),
    b.apple
      ? g({ transform: `translate(${(cx - (APPLE.w * k) / 2).toFixed(1)} ${(b.y + SZ / 2 - (APPLE.h * k) / 2).toFixed(1)}) scale(${k.toFixed(4)})` }, APPLE.svg)
      : el('text', { x: cx, y: b.y + SZ / 2 + 33, 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': 94, fill: b.ink }, b.ch),
  ]);
}

/** The shelf, one plank per side of the snap; `sag` bows it a little as it starts to give. */
function plank(x0, x1, sag = 0) {
  const d = `M ${x0} ${FLOOR} L ${x1} ${FLOOR + sag} L ${x1} ${FLOOR + SHELF.h + sag} L ${x0} ${FLOOR + SHELF.h} Z`;
  return [
    el('path', { d, fill: T['shadow-warm'], opacity: 0.22, transform: 'translate(-8 22)', filter: ref('soft-shadow') }),
    softShape(d, T.wood),
    el('path', { d: `M ${x0} ${FLOOR + 3} L ${x1} ${FLOOR + 3 + sag}`, stroke: T['wood-lit'], 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.8 }),
    el('path', { d: `M ${x0 + 30} ${FLOOR + 26} L ${x1 - 30} ${FLOOR + 26 + sag}`, stroke: T['wood-shade'], 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.5 }),
  ].join('');
}

export default function draw(t, ctx) {
  const { lands, exitAt, end } = ctx.M;
  const at = (i) => lands[i] ?? lands[lands.length - 1];
  const parts = [];
  if (t < exitAt) {
    // the blocks drop in, a thud and a small jolt on each landing
    const landed = lands.findLast((x) => t >= x);
    const offset = landed !== undefined ? shake(t, landed, 8, 0.1) : [0, 0];
    // the creak before the snap: the shelf bows under the stack
    const sag = 10 * seg(t, exitAt - 0.12, exitAt, E.in);
    const stack = BLOCKS.map((b, i) => {
      if (t < at(i) - FALL) return '';
      const dy = lerp(-1200, 0, seg(t, at(i) - FALL, at(i), E.in));
      const sq = t >= at(i) ? 0.14 * Math.sin(Math.PI * seg(t, at(i), at(i) + 0.08, (x) => x)) : 0;
      const bow = b.x + SZ / 2 < SNAP ? sag * ((b.x + SZ / 2 - SHELF.x) / (SNAP - SHELF.x)) : sag * ((SHELF.x + SHELF.w - b.x - SZ / 2) / (SHELF.x + SHELF.w - SNAP));
      return g({ transform: `translate(0 ${(dy + bow).toFixed(1)})` }, block(b, sq));
    });
    parts.push(defs(), fill(T['paper-lit']), fill(T['paper-shade'], 0.08));
    // once every block has landed, the stack is the title (the checks find it by data-text)
    const whole = t >= lands[lands.length - 1];
    const blocks = g(whole ? { 'data-role': 'lesson-title', 'data-k': 'text', 'data-text': 'AI 101' } : {}, stack.join(''));
    parts.push(shaken(offset, [plank(SHELF.x, SNAP, sag), plank(SHELF.x + SHELF.w, SNAP, sag), shadow(540, FLOOR - 2, 470, 10, 0.12), blocks].join('')));
    return parts.join('');
  }
  // the shelf snaps: its halves swing down about their ends, the blocks tumble out of the frame,
  // and the sheet behind them drops away; all of it is gone by the cut
  const out = end - 0.034;
  const u = seg(t, exitAt, out, (x) => x);
  const swing = 80 * seg(t, exitAt, exitAt + 0.08, E.out);
  const drop = 2150 * seg(t, exitAt + 0.02, out, (x) => x * x);
  parts.push(shaken(shake(t, exitAt, 22, 0.2), nextBeat(ctx)), defs());
  if (u < 1) {
    const world = [
      // the sheet's top edge throws a soft shadow onto frame 2 as it drops
      el('rect', { x: -50, y: -78, width: 1180, height: 40, fill: T['shadow-warm'], opacity: 0.3, filter: ref('soft-shadow') }),
      fill(T['paper-lit']),
      fill(T['paper-shade'], 0.08),
      g({ transform: `rotate(${swing.toFixed(2)} ${SHELF.x} ${FLOOR})` }, plank(SHELF.x, SNAP, 10)),
      g({ transform: `rotate(${(-swing).toFixed(2)} ${SHELF.x + SHELF.w} ${FLOOR})` }, plank(SHELF.x + SHELF.w, SNAP, 10)),
    ];
    parts.push(g({ transform: `translate(0 ${drop.toFixed(1)})` }, world));
    // the blocks fall on their own, spinning away from the snap, and leave the frame last
    BLOCKS.forEach((b, i) => {
      const cx = b.x + SZ / 2;
      const side = cx < SNAP ? -1 : 1;
      const k = seg(t, exitAt + 0.008 * Math.abs(i - 2.5), out, (x) => x * x);
      const x = side * (60 + 40 * (i % 3)) * k;
      const y = 10 + 1180 * k;
      const rot = side * (70 + 25 * (i % 4)) * k;
      parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)} ${cx} ${b.y + SZ / 2})` }, block(b)));
    });
  }
  return parts.join('');
}
