// Scissors Cut-Out: the AI 101 card ("AI 101" and its graduate-cap cut-out) is printed on a sheet
// that fills the frame, with a dashed cut line round it. Scissors snip round the line in rhythm;
// then the cut-out lifts off and flies away, and the sheet, with its hole, falls away below,
// uncovering frame 2, the definition beat.
// Sound: a snip per bite, a paper flutter and a whoosh as the cut-out flies.
import { T, g, el, ref, defs, seg, lerp, E, fill, shake, shaken, softShape, roundRect, nextBeat } from './common.js';
import { lessonIconAt, lessonLayout, lessonTitle } from './lesson.js';

// the cut line: a rounded box round the card's row, from its top middle, clockwise
const L = lessonLayout('scissors');
const PAD = 54;
const BOX = (() => {
  const x0 = L.title.x - PAD;
  const x1 = L.icon.x + L.icon.w + PAD;
  const y0 = Math.min(L.icon.y, L.title.y - L.title.size * 0.75) - PAD;
  const y1 = Math.max(L.icon.y + L.icon.h, L.title.y + L.title.size * 0.6) + PAD;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: 46 };
})();
const MID = [BOX.x + BOX.w / 2, BOX.y + BOX.h / 2];
const D = roundRect(BOX.x, BOX.y, BOX.w, BOX.h, BOX.r);

// points round the cut, from the top middle, clockwise (the scissors ride them)
const N = 200;
const PTS = (() => {
  const { x, y, w, h, r } = BOX;
  const straight = [w - 2 * r, h - 2 * r];
  const arc = (Math.PI * r) / 2;
  const total = 2 * straight[0] + 2 * straight[1] + 4 * arc;
  const at = (s) => {
    // walk the outline: top (from the middle), corner, right, corner, bottom, corner, left, corner, top
    s = ((s % total) + total) % total;
    const legs = [
      [straight[0] / 2, (d) => [x + w / 2 + d, y]],
      [arc, (d) => corner(x + w - r, y + r, -Math.PI / 2 + d / r)],
      [straight[1], (d) => [x + w, y + r + d]],
      [arc, (d) => corner(x + w - r, y + h - r, d / r)],
      [straight[0], (d) => [x + w - r - d, y + h]],
      [arc, (d) => corner(x + r, y + h - r, Math.PI / 2 + d / r)],
      [straight[1], (d) => [x, y + h - r - d]],
      [arc, (d) => corner(x + r, y + r, Math.PI + d / r)],
      [straight[0] / 2, (d) => [x + r + d, y]],
    ];
    for (const [len, f] of legs) {
      if (s <= len) return f(s);
      s -= len;
    }
    return [x + w / 2, y];
  };
  const corner = (cx, cy, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  return Array.from({ length: N + 1 }, (_, i) => at((i / N) * total));
})();

/** How far round the cut is at t: a bite per snip. */
const cutAt = (t, snips) => snips.reduce((u, s) => u + seg(t, s - 0.04, s, E.out) / snips.length, 0);

function scissors(x, y, ang, open) {
  const o = 4 + 20 * open;
  const blade = (sgn) => g({ transform: `rotate(${(sgn * o).toFixed(2)})` }, [
    // a steel blade (soft, glossy), a dark shank, a glossy orange loop handle
    softShape(`M 0 0 L 230 ${sgn * -6} L 0 ${sgn * 22} Z`, T['paper-shade'], { gloss: true, form: 0.6 }),
    el('path', { d: `M 0 0 L -120 ${sgn * 30}`, stroke: T['ink-lit'], 'stroke-width': 14, 'stroke-linecap': 'round' }),
    el('ellipse', { cx: -170, cy: sgn * 52, rx: 62, ry: 42, fill: 'none', stroke: T['orange-shade'], 'stroke-width': 26 }),
    el('ellipse', { cx: -170, cy: sgn * 52, rx: 62, ry: 42, fill: 'none', stroke: T.orange, 'stroke-width': 18 }),
    el('path', { d: `M -224 ${sgn * 52 - 14} A 62 42 0 0 1 -150 ${sgn * 52 - 40}`, fill: 'none', stroke: T['orange-lit'], 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.8 }),
  ]);
  // the blades point along the cut: (x, y) is where they meet the paper; the handles trail outside it
  return g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(0.72) translate(-150 0)` }, [
    el('ellipse', { cx: -120, cy: 40, rx: 200, ry: 70, fill: T['shadow-warm'], opacity: 0.18, filter: ref('soft-shadow') }),
    blade(1),
    blade(-1),
    el('circle', { cx: 0, cy: 0, r: 10, fill: T['ink-lit'] }),
  ]);
}

/** The printed card: "AI 101" and its cut-out cap. */
const print = (key) => lessonTitle(key) + lessonIconAt(key);

export default function draw(t, ctx) {
  const { cardIn, snips, exitAt, end } = ctx.M;
  const out = end - 0.034;
  const u = cutAt(t, snips);
  const parts = [];
  if (t < exitAt) {
    // the sheet, pressed down in the first frames, the cut line and the cut so far
    const press = 1 + 0.03 * (1 - seg(t, 0, cardIn, E.out));
    parts.push(defs(), g({ transform: `translate(540 960) scale(${press.toFixed(4)}) translate(-540 -960)` }, [
      fill(T['paper-lit']),
      fill(T['paper-shade'], 0.06),
      print(ctx.key),
      el('path', { d: D, fill: 'none', stroke: T['text-tertiary'], 'stroke-width': 4, 'stroke-dasharray': '22 16', 'stroke-linecap': 'round', opacity: 0.6 }),
      u > 0 ? el('path', { d: `M ${PTS.slice(0, Math.max(2, Math.round(u * N) + 1)).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')}`, fill: 'none', stroke: T['text-secondary'], 'stroke-width': 5, 'stroke-linecap': 'round' }) : '',
    ].join('')));
    // the scissors ride the cut, snapping shut on each snip; once round, they pull out to the right
    const i = Math.min(N - 1, Math.round(u * N));
    const [x, y] = PTS[i];
    const [x2, y2] = PTS[i + 1];
    const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
    const near = snips.find((s) => t >= s - 0.05 && t < s + 0.02);
    const open = near === undefined ? 1 : t < near ? 1 - seg(t, near - 0.05, near, E.in) : seg(t, near, near + 0.02, (q) => q);
    const last = snips[snips.length - 1];
    const away = seg(t, last + 0.02, exitAt, E.in);
    if (away < 1) parts.push(g({ transform: `translate(${(900 * away).toFixed(1)} ${(-200 * away).toFixed(1)})` }, scissors(x, y, ang, open)));
    return parts.join('');
  }
  // the sheet, with its hole, falls away below; the cut-out lifts and flies off up and to the right
  parts.push(shaken(shake(t, exitAt, 16, 0.16), nextBeat(ctx)), defs());
  const f = seg(t, exitAt + 0.01, out, E.in);
  if (f < 1) {
    parts.push(g({ transform: `translate(${(-80 * f).toFixed(1)} ${(2250 * f).toFixed(1)}) rotate(${(-6 * f).toFixed(2)} 540 1900)` }, [
      el('path', { d: `M -60 -60 H 1140 V 1980 H -60 Z ${D}`, fill: T['shadow-warm'], 'fill-rule': 'evenodd', opacity: 0.25, transform: 'translate(-12 26)', filter: ref('soft-shadow') }),
      el('path', { d: `M -60 -60 H 1140 V 1980 H -60 Z ${D}`, fill: T['paper-lit'], 'fill-rule': 'evenodd' }),
      el('path', { d: D, fill: 'none', stroke: T['paper-shade'], 'stroke-width': 5 }),
    ].join('')));
  }
  const l = seg(t, exitAt, exitAt + 0.07, E.out);
  const fly = seg(t, exitAt + 0.03, out, E.in);
  if (fly < 1) {
    const k = (1 + 0.1 * l) * lerp(1, 0.8, fly);
    const x = lerp(MID[0], MID[0] + 1250, fly);
    const y = lerp(MID[1], MID[1] - 1500, fly);
    parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(-4 * l - 22 * fly).toFixed(2)}) scale(${k.toFixed(4)}) translate(${-MID[0]} ${-MID[1]})` }, [
      el('path', { d: D, fill: T['shadow-warm'], opacity: (0.14 + 0.16 * l).toFixed(3), transform: `translate(${(-10 - 30 * l).toFixed(1)} ${(14 + 40 * l).toFixed(1)})`, filter: ref('soft-shadow') }),
      softShape(D, T['paper-lit'], { form: 0.5 }),
      print(ctx.key),
    ]));
  }
  return parts.join('');
}
