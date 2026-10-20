// Record Scratch Freeze: the hook in full motion with the music loud; a record scratch, the music
// cuts, the frame freezes ink-only and a red marker circles the critter; the voice starts in the
// silence; "AI BRAIN BREAK" slaps on as a sticker; it unfreezes on the line's "this".
import { T, g, el, id, ref, defs, seg, lerp, E, scene, heroAt, zoomed, wordmark, burst } from './common.js';

const RED = T['status-error'];

/** A hand-drawn loop around (cx, cy), revealed by u. */
function loop(cx, cy, rx, ry, u) {
  const p = [];
  for (let i = 0; i <= 40; i++) {
    const a = -1.9 + (i / 40) * Math.PI * 2.25;
    const wob = 1 + 0.05 * Math.sin(i * 1.7);
    p.push([cx + rx * wob * Math.cos(a), cy + ry * wob * Math.sin(a)]);
  }
  const d = `M ${p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')}`;
  return el('path', { d, fill: 'none', stroke: RED, 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': (1 - u).toFixed(3), filter: ref('wobble') });
}

function sticker(t, at) {
  if (t < at) return '';
  const u = seg(t, at, at + 0.16, E.spring);
  return g({ transform: `translate(540 420) rotate(-5) scale(${lerp(1.6, 1, u).toFixed(3)})` }, [
    el('rect', { x: -372, y: -170, width: 744, height: 330, rx: 18, fill: T.ink, opacity: 0.18, transform: 'translate(10 12)' }),
    el('rect', { x: -372, y: -170, width: 744, height: 330, rx: 18, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5 }),
    wordmark(0, -10, 84, 1),
  ]);
}

export default function draw(t, ctx) {
  const { breakAt: FREEZE, voiceAt, unfreezeAt: UNFREEZE } = ctx.M;
  const live = t < FREEZE || t >= UNFREEZE;
  const at = t < FREEZE ? t : t < UNFREEZE ? FREEZE : t - (UNFREEZE - FREEZE);
  const parts = [defs()];
  if (live) parts.push(scene(ctx, at));
  else {
    const punch = 1.07;
    parts.push(el('defs', {}, el('filter', { id: id('desat') }, el('feColorMatrix', { type: 'saturate', values: '0' }) + el('feComponentTransfer', {}, ['R', 'G', 'B'].map((c) => el(`feFunc${c}`, { type: 'linear', slope: 1.1, intercept: -0.05 })).join('')))));
    parts.push(g({ filter: ref('desat') }, zoomed(scene(ctx, FREEZE), [540, 960], punch)));
    // circle the critter (or the middle of the shot, when the hook has none)
    const h = heroAt(ctx, FREEZE);
    const [mx, my] = h ? h.mid : [518, 1085];
    const cx = 540 + punch * (mx - 540);
    const cy = 960 + punch * (my - 960);
    const r = h ? Math.max(150, Math.min(330, 120 * h.s * punch)) : 220;
    parts.push(loop(cx, cy - 10, r * 0.83, r, seg(t, FREEZE + 0.06, FREEZE + 0.32, E.out)));
    // the arrow, from the empty side down to the circle
    const a = seg(t, FREEZE + 0.3, FREEZE + 0.45, E.out);
    if (a > 0) {
      const side = cx < 540 ? 1 : -1;
      const ex = cx + side * r * 0.78;
      const ey = cy - r * 0.78;
      const x0 = ex + side * 190;
      const y0 = ey - 190;
      parts.push(el('path', { d: `M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${(x0 - side * 20).toFixed(1)} ${((y0 + ey) / 2).toFixed(1)} ${lerp(x0, ex, a).toFixed(1)} ${lerp(y0, ey, a).toFixed(1)}`, fill: 'none', stroke: RED, 'stroke-width': 11, 'stroke-linecap': 'round', filter: ref('wobble') }));
      if (a >= 1) parts.push(el('path', { d: `M ${(ex + side * 15).toFixed(1)} ${(ey - 50).toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)} L ${(ex + side * 50).toFixed(1)} ${(ey - 15).toFixed(1)}`, fill: 'none', stroke: RED, 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
  }
  parts.push(sticker(t, voiceAt));
  parts.push(burst(540, 960, seg(t, UNFREEZE, UNFREEZE + 0.35, (x) => x), 3));
  return parts.join('');
}
