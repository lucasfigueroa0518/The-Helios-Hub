// Paper Rip: a full-screen sheet carries "AI 101" and its pencil; the pencil taps down onto it, the
// sheet strains, rips down the middle, and its halves fly off to uncover frame 2, the definition beat.
// Sound: a tap, a creak, then RIP + the hit; the beat drops on the tear.
import { T, g, el, id, ref, defs, seg, E, fill, shake, shaken, burst, nextBeat } from './common.js';
import { lessonIconAt, lessonLayout, lessonTitle } from './lesson.js';

// the jagged tear, top to bottom
const TEAR = Array.from({ length: 26 }, (_, i) => [540 + (i % 2 ? 1 : -1) * (10 + ((i * 37) % 26)), -80 + i * 82]);
const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** The pencil drops the last stretch onto the sheet and settles by cardIn. */
function pencil(ctx, t) {
  const L = lessonLayout(ctx.key);
  const u = seg(t, 0, ctx.M.cardIn, E.out);
  const cx = L.icon.x + L.icon.w / 2;
  const cy = L.icon.y + L.icon.h / 2;
  return g({ transform: `translate(0 ${(-70 * (1 - u)).toFixed(1)}) rotate(${(-12 * (1 - u)).toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})` }, lessonIconAt(ctx.key));
}

const sheet = (ctx, t) => [fill(T['paper-lit']), fill(T['paper-shade'], 0.08), lessonTitle(ctx.key), pencil(ctx, t)].join('');

export default function draw(t, ctx) {
  const { strainAt, exitAt: RIP, end } = ctx.M;
  if (t < RIP) {
    // the sheet strains: it swells, and the tear starts at the top
    const b = seg(t, strainAt, RIP, E.in);
    const torn = TEAR.slice(0, Math.max(0, Math.round(seg(t, strainAt, RIP, E.in) * 5)));
    return defs() + g({ transform: `translate(540 960) scale(${(1 + 0.03 * b).toFixed(4)}) translate(-540 -960)` }, [
      sheet(ctx, t),
      torn.length > 1 ? el('polyline', { points: pts(torn), fill: 'none', stroke: T['text-tertiary'], 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) : '',
    ]);
  }
  // the halves are gone by the cut
  // they part slowly, then whip away, so the tear reads before frame 2 shows
  const u = seg(t, RIP, end - 0.02, E.in);
  const left = [[-400, -200], ...TEAR, [-400, 2200]];
  const right = [[1480, -200], ...TEAR, [1480, 2200]];
  const half = (side, clip) => g({ transform: `translate(${(side * 1350 * u).toFixed(1)} ${(90 * u).toFixed(1)}) rotate(${(side * 16 * u).toFixed(2)} 540 960)` }, [
    g({ 'clip-path': ref(clip) }, sheet(ctx, t)),
    el('polyline', { points: pts(TEAR), fill: 'none', stroke: T['paper-shade'], 'stroke-width': 12, 'stroke-linejoin': 'round', 'clip-path': ref(clip) }),
  ]);
  return [
    shaken(shake(t, RIP, 24, 0.2), nextBeat(ctx)),
    defs(),
    el('defs', {}, el('clipPath', { id: id('tearL') }, el('polygon', { points: pts(left) })) + el('clipPath', { id: id('tearR') }, el('polygon', { points: pts(right) }))),
    u < 1 ? half(-1, 'tearL') + half(1, 'tearR') : '',
    burst(540, 960, seg(t, RIP, end, (x) => x), 3.2),
  ].join('');
}
