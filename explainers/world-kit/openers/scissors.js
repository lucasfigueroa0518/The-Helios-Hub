// Scissors Cut-Out: a plain page with the hook's critter printed on it and a dashed cut line round
// it. Scissors snip round it in rhythm; the cut-out lifts off, the page falls away to show the
// hook, and the critter drops into its own place there.
import { T, g, el, ref, defs, seg, lerp, E, scene, heroAt, heroCritter, title, shake, shaken, burst, softShape, gloss } from './common.js';

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
const cutAt = (t, snips) => snips.reduce((u, s) => u + seg(t, s - 0.05, s, E.out) / snips.length, 0);

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
  // the blades point along the cut: (x, y) is where they meet the paper
  return g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)}) translate(-150 0)` }, [blade(1), blade(-1), el('circle', { cx: 0, cy: 0, r: 10, fill: T['ink-lit'] })]);
}

const printed = (ctx, pose) => heroCritter(ctx, FEET[0], FEET[1], S, { mood: 'worried', arms: 'down', ...pose });

export default function draw(t, ctx) {
  const { snips, lift, fall, drop } = ctx.M;
  const landed = t >= drop[1];
  const parts = [shaken(landed ? shake(t, drop[1], 18, 0.3) : [0, 0], scene(ctx, t, { hideHero: !landed })), defs()];
  const u = cutAt(t, snips);
  if (t < fall[1]) {
    // the page, with a hole where the cut-out was once it lifts, falling away
    const f = seg(t, fall[0], fall[1], E.in);
    const hole = t >= lift[0];
    const page = [
      el('path', { d: `M -60 -60 H 1140 V 1980 H -60 Z ${hole ? D : ''}`, fill: T['paper-lit'], 'fill-rule': 'evenodd', stroke: hole ? T['paper-shade'] : 'none', 'stroke-width': 4 }),
      hole ? '' : printed(ctx, {}),
      hole ? '' : el('path', { d: D, fill: 'none', stroke: T['text-tertiary'], 'stroke-width': 4, 'stroke-dasharray': '22 16', 'stroke-linecap': 'round', opacity: 0.6 }),
      !hole && u > 0 ? el('path', { d: D, fill: 'none', stroke: T['text-secondary'], 'stroke-width': 4, pathLength: 1, 'stroke-dasharray': `${u.toFixed(4)} 1`, 'stroke-linecap': 'round' }) : '',
    ];
    parts.push(g({ transform: `translate(${(-120 * f).toFixed(1)} ${(2100 * f * f).toFixed(1)}) rotate(${(-12 * f).toFixed(2)} 540 1900)` }, page));
  }
  if (t >= lift[0] && !landed) {
    // the cut-out lifts, then flies down into the critter's spot in the hook
    const l = seg(t, lift[0], lift[1], E.out);
    const d = seg(t, drop[0], drop[1], E.inOut);
    const h = heroAt(ctx, drop[1]) ?? { x: 518, y: 1300, s: 1.3 };
    const k = lerp(1 + 0.06 * l, h.s / S, d);
    const x = lerp(FEET[0], h.x, d);
    const y = lerp(FEET[1], h.y, d) - 120 * Math.sin(Math.PI * d);
    parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)}) translate(${-FEET[0]} ${-FEET[1]})`, opacity: (1 - seg(t, drop[1] - 0.05, drop[1], (q) => q)).toFixed(3) }, [
      el('path', { d: D, fill: T['shadow-warm'], opacity: (0.12 + 0.16 * l).toFixed(3), transform: `translate(${(-10 - 26 * l).toFixed(1)} ${(14 + 36 * l).toFixed(1)})`, filter: ref('soft-shadow') }),
      softShape(D, T['paper-lit'], { form: 0.5 }),
      printed(ctx, { mood: 'happy' }),
    ]));
  }
  if (t < lift[0]) {
    // the scissors, at the end of the cut, snapping shut on each snip
    const i = Math.min(N, Math.round(u * N));
    const [x, y] = PTS[i];
    const [x2, y2] = PTS[Math.min(N, i + 1)];
    const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
    const near = snips.find((s) => t >= s - 0.07 && t < s + 0.03);
    const open = near === undefined ? 1 : t < near ? 1 - seg(t, near - 0.07, near, E.in) : seg(t, near, near + 0.03, (q) => q);
    parts.push(scissors(x, y, ang, open));
  }
  if (landed) {
    const h = heroAt(ctx, t);
    if (h) parts.push(burst(h.mid[0], h.mid[1], seg(t, drop[1], drop[1] + 0.35, (q) => q), 2.4));
  }
  parts.push(title(ctx, t, ctx.M.titleAt));
  return parts.join('');
}
