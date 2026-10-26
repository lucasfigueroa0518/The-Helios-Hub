// Paper Rip: a full-screen sheet lettered "AI BRAIN BREAK" bulges, rips down the middle, and its
// halves fly off to show the hook. Sound: a creak, then RIP + a sub hit; the beat drops on the tear.
import { T, g, el, id, ref, defs, seg, E, scene, title, wordmark, fill, shake, shaken, burst } from './common.js';

// the jagged tear, top to bottom
const TEAR = Array.from({ length: 26 }, (_, i) => [540 + (i % 2 ? 1 : -1) * (10 + ((i * 37) % 26)), -80 + i * 82]);
const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const sheet = () => [fill(T['paper-lit']), fill(T['paper-shade'], 0.08), wordmark(540, 900, 132, 1)].join('');

export default function draw(t, ctx) {
  const RIP = ctx.M.breakAt;
  if (t < RIP) {
    // the sheet strains: it swells, and the tear starts at the top
    const b = seg(t, 0.06, RIP, E.in);
    const torn = TEAR.slice(0, Math.max(0, Math.round(seg(t, 0.25, RIP, E.in) * 5)));
    return defs() + g({ transform: `translate(540 960) scale(${(1 + 0.03 * b).toFixed(4)}) translate(-540 -960)` }, [
      sheet(),
      torn.length > 1 ? el('polyline', { points: pts(torn), fill: 'none', stroke: T.ink, 'stroke-width': 4, 'stroke-linejoin': 'round' }) : '',
    ]);
  }
  const u = seg(t, RIP, RIP + 0.55, E.out);
  const left = [[-400, -200], ...TEAR, [-400, 2200]];
  const right = [[1480, -200], ...TEAR, [1480, 2200]];
  const half = (side, clip) => g({ transform: `translate(${(side * 1350 * u).toFixed(1)} ${(90 * u).toFixed(1)}) rotate(${(side * 16 * u).toFixed(2)} 540 960)` }, [
    g({ 'clip-path': ref(clip) }, sheet()),
    el('polyline', { points: pts(TEAR), fill: 'none', stroke: T['paper-shade'], 'stroke-width': 12, 'stroke-linejoin': 'round', 'clip-path': ref(clip) }),
  ]);
  return [
    shaken(shake(t, RIP, 34), scene(ctx, t - RIP)),
    defs(),
    el('defs', {}, el('clipPath', { id: id('tearL') }, el('polygon', { points: pts(left) })) + el('clipPath', { id: id('tearR') }, el('polygon', { points: pts(right) }))),
    u < 1 ? half(-1, 'tearL') + half(1, 'tearR') : '',
    burst(540, 960, seg(t, RIP, RIP + 0.45, (x) => x), 3.2),
    title(ctx, t, RIP + 0.25),
  ].join('');
}
