// Big Bang: empty paper, one small orange dot pulsing faster on a rising sub-bass; BOOM, the dot
// bursts with shock rings and the hook springs out of it; "AI BRAIN BREAK" bursts out with it.
import { T, g, el, defs, seg, lerp, E, scene, title, fill, shake, burst, slamMark, softShape, gloss } from './common.js';

// four quarter arcs through the dot's extremes, so its drawn box is the whole dot
const dot = (r) => { const R = r.toFixed(1); const p = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`; return `M ${p(540 - r, 960)} A ${R} ${R} 0 0 1 ${p(540, 960 - r)} A ${R} ${R} 0 0 1 ${p(540 + r, 960)} A ${R} ${R} 0 0 1 ${p(540, 960 + r)} A ${R} ${R} 0 0 1 ${p(540 - r, 960)} Z`; };

export default function draw(t, ctx) {
  const BOOM = ctx.M.breakAt;
  if (t < BOOM) {
    // the pulse quickens and the dot swells as the bass rises
    const u = seg(t, 0, BOOM, E.in);
    // never under 0.5% of the frame (layout-checks blankOpen): a dot that reads from the first frame
    const r = lerp(70, 96, u) * (1 + 0.25 * Math.sin(2 * Math.PI * (3 * t + 9 * t * t)));
    return defs() + fill(T['paper-lit']) + el('circle', { cx: 540, cy: 960, r: (r * 3).toFixed(1), fill: T.orange, opacity: lerp(0, 0.25, u).toFixed(3) }) + softShape(dot(r), T.orange) + gloss(dot(r), { strength: 0.8 });
  }
  const [sx, sy] = shake(t, BOOM, 30, 0.45);
  // the hook springs out from the dot
  const sc = lerp(0.02, 1, seg(t, BOOM, BOOM + 0.55, E.spring));
  const springs = g({ transform: `translate(${(540 + sx).toFixed(1)} ${(960 + sy).toFixed(1)}) scale(${sc.toFixed(4)}) translate(-540 -960)` }, scene(ctx, t));
  const rings = [0, 0.08, 0.16].map((d) => {
    const u = seg(t, BOOM + d, BOOM + d + 0.6, E.out);
    return u > 0 && u < 1 ? el('circle', { cx: 540, cy: 960, r: (40 + 1100 * u).toFixed(1), fill: 'none', stroke: d ? T['orange-lit'] : T.orange, 'stroke-width': (22 * (1 - u)).toFixed(1), opacity: (1 - u).toFixed(3) }) : '';
  }).join('');
  return defs() + fill(T['paper-lit']) + springs + rings + burst(540, 960, seg(t, BOOM, BOOM + 0.45, (x) => x), 5) + slamMark(t, BOOM, { cy: 640, size: 116, from: 2.2 }) + title(ctx, t, ctx.M.titleAt);
}
