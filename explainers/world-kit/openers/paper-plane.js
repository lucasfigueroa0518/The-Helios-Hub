// Paper Plane: a paper plane loops in from off-screen, straight at the camera, and smacks into the
// glass. It sticks, unfolds flat into a sheet with "AI BRAIN BREAK" on it, then peels off and falls
// away, leaving the hook.
import { T, g, el, ref, defs, seg, lerp, E, scene, title, wordmark, shake, shaken, burst } from './common.js';

const B = [[-260, 1560], [520, 1820], [1240, 560], [540, 900]];
function bez(u) {
  const m = 1 - u;
  const p = (i) => m * m * m * B[0][i] + 3 * m * m * u * B[1][i] + 3 * m * u * u * B[2][i] + u * u * u * B[3][i];
  return [p(0), p(1)];
}

function plane(squash = 0) {
  return g({ transform: `scale(1 ${(1 - squash).toFixed(3)})`, filter: ref('wobble') }, [
    el('path', { d: 'M 170 0 L -90 0 L -150 64 Z', fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M 170 0 L -150 -96 L -90 0 Z', fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M 170 0 L -120 -46', stroke: T['paper-dark'], 'stroke-width': 3 }),
    el('path', { d: 'M -90 0 L -130 34', stroke: T.ink, 'stroke-width': 4 }),
  ]);
}

function sheet() {
  return g({ filter: ref('wobble') }, [
    el('rect', { x: -400, y: -520, width: 800, height: 1040, fill: T.ink, opacity: 0.2, transform: 'translate(16 22)' }),
    el('rect', { x: -400, y: -520, width: 800, height: 1040, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 6 }),
    // the creases the folds left
    ...['M 0 -520 L 0 520', 'M -400 -120 L 0 -520 L 400 -120', 'M -400 120 L 0 -300 L 400 120'].map((d) => el('path', { d, fill: 'none', stroke: T['paper-dark'], 'stroke-width': 4 })),
    wordmark(0, 0, 104, 1),
  ]);
}

export default function draw(t, ctx) {
  const { breakAt: SMACK, unfold, peel } = ctx.M;
  const parts = [shaken(shake(t, SMACK, 30, 0.35), scene(ctx, t)), defs()];
  if (t < SMACK) {
    const u = seg(t, 0, SMACK, E.in);
    const [x, y] = bez(u);
    const [x2, y2] = bez(Math.min(1, u + 0.02));
    const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
    parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${lerp(0.5, 3.6, u * u).toFixed(3)})` }, plane()));
    return parts.join('');
  }
  const slide = 40 * seg(t, SMACK, unfold[0], E.out);
  if (t < unfold[1]) {
    // stuck to the glass, squashed flat; then it flips open (the plane narrows, the sheet widens)
    const f = seg(t, unfold[0], unfold[1], E.inOut);
    if (f < 0.5) parts.push(g({ transform: `translate(540 ${(920 + slide).toFixed(1)}) rotate(-14) scale(${(3.6 * (1 - 2 * f)).toFixed(3)} 3.6)` }, plane(0.25)));
    else parts.push(g({ transform: `translate(540 ${(940 + slide).toFixed(1)}) rotate(${lerp(-8, -2, f).toFixed(2)}) scale(${(2 * f - 1).toFixed(3)} 1)` }, sheet()));
  } else {
    const p = seg(t, peel[0], peel[1], E.in);
    if (p < 1) parts.push(g({ transform: `translate(${(540 + 260 * p).toFixed(1)} ${(940 + slide + 1700 * p).toFixed(1)}) rotate(${(-2 + 34 * p).toFixed(2)})` }, sheet()));
  }
  parts.push(burst(540, 920, seg(t, SMACK, SMACK + 0.35, (x) => x), 4));
  parts.push(title(ctx, t, peel[0] + 0.2));
  return parts.join('');
}
