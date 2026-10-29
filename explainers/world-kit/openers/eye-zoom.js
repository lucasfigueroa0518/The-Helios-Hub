// Eye Zoom-Out: one giant eye of the hook's critter fills the screen. It looks left, right, then
// straight at you, and blinks. Whoosh: a crash zoom out to the whole hook lands on a bass hit, and
// "AI BRAIN BREAK" slams in as it lands.
import { T, el, defs, seg, lerp, E, scene, heroAt, zoomed, zoomOut, title, shake, shaken, burst, slamMark } from './common.js';

const CLOSE = 24;

export default function draw(t, ctx) {
  const { blink, zoom, landAt } = ctx.M;
  const still = t < landAt;
  // the eye darts left, right, then locks on the viewer
  const look = t < 0.12 ? [-0.8, 0] : t < 0.26 ? [0.8, 0] : [0, 0];
  const h = heroAt(ctx, Math.min(t, zoom[0]));
  const eye = h ? h.eye : [540, 960];
  const z = h ? CLOSE : 6;
  const shot = scene(ctx, t, still ? { heroPose: { look } } : {});
  const view = t < zoom[0] ? zoomed(shot, eye, z) : zoomOut(shot, eye, z, seg(t, zoom[0], zoom[1], E.out));
  const parts = [defs(), shaken(shake(t, landAt, 28, 0.4), view)];
  // the blink: the ink lid sweeps down over the whole frame and back up
  const b = t >= blink[0] && t < blink[1] ? Math.sin(Math.PI * seg(t, blink[0], blink[1], (x) => x)) : 0;
  if (b > 0) {
    parts.push(el('rect', { x: -50, y: -50, width: 1180, height: (-50 + 1100 * b).toFixed(1), fill: T.ink }));
    parts.push(el('rect', { x: -50, y: (1970 - 1100 * b).toFixed(1), width: 1180, height: 1100, fill: T.ink }));
  }
  // speed lines on the zoom
  const u = seg(t, zoom[0], zoom[1], (x) => x);
  if (u > 0 && u < 1) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.1;
      const r0 = lerp(120, 700, u);
      const r1 = r0 + 520 * (1 - u);
      parts.push(el('line', { x1: (540 + Math.cos(a) * r0).toFixed(1), y1: (960 + Math.sin(a) * r0).toFixed(1), x2: (540 + Math.cos(a) * r1).toFixed(1), y2: (960 + Math.sin(a) * r1).toFixed(1), stroke: T.ink, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: (0.7 * (1 - u)).toFixed(3) }));
    }
  }
  parts.push(slamMark(t, landAt, { cy: 600, tilt: 3, from: 2.4, hold: 1.05 }));
  parts.push(burst(540, 960, seg(t, landAt, landAt + 0.4, (x) => x), 4.5));
  parts.push(title(ctx, t, ctx.M.titleAt));
  return parts.join('');
}
