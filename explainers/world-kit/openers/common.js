// What every opener in the bank draws with (EX3-102). An opener never knows the reel: it gets
// the reel's hook scene (assets/frames/01-hook.js, written by the frame worker) through `ctx`:
//
//   ctx.hook   { ground, shots, hero, draw(t, { hideHero, heroPose }) }: the hook in motion,
//              framed by its own shots; `hero` is its critter ({ at, s, critter }, see frame.md)
//   ctx.M      the opener's timing (bank.js openerTiming): voiceAt, voice, duration, its moments
//   ctx.term   the storyboard's term, for the title card
//
// So the same opener takes on each reel's scene and critter. The first text an opener shows is
// "AI BRAIN BREAK" alone (Lucas, 2026-10-19); the term arrives later, in the title card.

import { T, g, el, ref, handwrite, handwriteWidth, shock } from '../draw.js';
import { seg, lerp, clamp01, E } from '../motion.js';
import { shotAt, shotCamera } from '../shots.js';
import { titleCard } from '../cards.js';
import { critter } from '../cast.js';

export { T, g, el, ref, handwrite, handwriteWidth, shock, seg, lerp, clamp01, E, critter };
export { id, defs, scope } from '../draw.js';

export const W = 1080;
export const H = 1920;

/** The hook scene at its own time `t` (never before 0). */
export const scene = (ctx, t, o = {}) => ctx.hook.draw(Math.max(0, t), o);

/** The hook's camera at its time t (its shots; none means the plain frame). */
function cameraAt(hook, t) {
  if (!Array.isArray(hook.shots) || !hook.shots.length) return { x: 0, y: 0, zoom: 1 };
  const { shot, local, length } = shotAt(Math.max(0, t), hook.shots);
  return shotCamera(shot, local, length);
}

/**
 * The hook's critter on screen at its time t: its feet (x, y), its scale s, its face, its left eye
 * and its middle, and its look (`critter`: wear, body…); null when the hook has none. A critter's
 * eyes sit 98 units above its feet, 25 either side (cast.js).
 */
export function heroAt(ctx, t) {
  const h = ctx.hook.hero;
  if (!h || !Array.isArray(h.at)) return null;
  const c = cameraAt(ctx.hook, t);
  const x = 540 + c.zoom * (h.at[0] - 540 - c.x);
  const y = 960 + c.zoom * (h.at[1] - 960 - c.y);
  const s = (h.s ?? 1) * c.zoom;
  return { x, y, s, face: [x, y - 98 * s], eye: [x - 25 * s, y - 98 * s], mid: [x, y - 90 * s], critter: h.critter ?? {} };
}

/** The hero as drawn by an opener (a copy at its own place and size, no world id). */
export function heroCritter(ctx, x, y, s, pose = {}) {
  const look = ctx.hook.hero?.critter ?? {};
  return critter(x, y, { ...look, ...pose, s, who: null });
}

/** `svg` seen through a camera that puts screen point p at q, zoomed z. */
export const zoomed = (svg, p, z, q = [540, 960]) => g({ transform: `translate(${q[0].toFixed(1)} ${q[1].toFixed(1)}) scale(${z.toFixed(4)}) translate(${(-p[0]).toFixed(1)} ${(-p[1]).toFixed(1)})` }, svg);

/**
 * A zoom from Z on point p (held at q) back out to the plain frame, u 0..1: the zoom moves on a
 * log scale and the aim with it, so the shot never swings past what it is on.
 */
export function zoomOut(svg, p, Z, u, q = [540, 960]) {
  const z = Math.exp(Math.log(Z) * (1 - u));
  const k = Math.log(Z) ? 1 - Math.log(z) / Math.log(Z) : 1;
  return zoomed(svg, p, z, [lerp(q[0], p[0], k), lerp(q[1], p[1], k)]);
}

/** The standard top-band title card, started at `from` and finished with the line. */
export function title(ctx, t, from) {
  if (t < from || !ctx.term) return '';
  const { voiceAt, voice } = ctx.M;
  return titleCard(t - from, { term: ctx.term, to: Math.max(0.6, voiceAt + voice - 0.1 - from) });
}

/** "AI BRAIN BREAK", hand-lettered big and centred on (cx, cy); never the term. */
export function wordmark(cx, cy, size, progress = 1, { color = T.ink, weight = 1.4, plate = false, tilt = 0 } = {}) {
  const lineH = size * 1.45;
  const out = [];
  if (plate) {
    // a paper plate behind the letters, so they read over the drawing
    const w = handwriteWidth('AI BRAIN', size) + size * 1.1;
    const top = cy - lineH / 2 - size * 1.35;
    const h = lineH + size * 1.35 + size * 0.75;
    out.push(el('rect', { x: (cx - w / 2 + 10).toFixed(1), y: (top + 14).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 22, fill: T.ink, opacity: 0.16 }));
    out.push(g({ filter: ref('wobble') }, el('rect', { x: (cx - w / 2).toFixed(1), y: top.toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 22, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5 })));
  }
  out.push(
    handwrite('AI BRAIN', cx, cy - lineH / 2, size, clamp01(progress * 2), { color, align: 'center', weight }),
    handwrite('BREAK', cx, cy + lineH / 2, size, clamp01(progress * 2 - 1), { color, align: 'center', weight }),
  );
  const body = out.join('');
  return tilt ? g({ transform: `rotate(${tilt} ${cx} ${cy})` }, body) : body;
}

/** A full-frame fill (black for dead air, paper for a sheet). */
export const fill = (color, opacity = 1) => el('rect', { x: -50, y: -50, width: W + 100, height: H + 100, fill: color, opacity: opacity.toFixed(3) });

/** A camera shake offset at t for a hit at `at` (decays over `dur`). */
export function shake(t, at, amp = 26, dur = 0.35) {
  if (t < at || t > at + dur) return [0, 0];
  const u = (t - at) / dur;
  const k = Math.floor(t * 30);
  const a = amp * (1 - u) * (1 - u);
  return [a * Math.sin(k * 2.9), a * Math.cos(k * 3.7)];
}

/** `svg` moved by a shake offset. */
export const shaken = ([sx, sy], svg) => (sx || sy ? g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, svg) : svg);

/** Shock rays all round a point (a burst). */
export function burst(x, y, u, scale = 2) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    rays.push([Math.cos(a), Math.sin(a)]);
  }
  return shock(x, y, u, scale, rays);
}

/** The wordmark bursting in big at `at`, holding, then shrinking away as the title card writes. */
export function slamMark(t, at, { cy = 620, size = 112, from = 2.3, tilt = -3, hold = 1.0 } = {}) {
  if (t < at - 0.04) return '';
  const w = seg(t, at - 0.04, at + 0.24, E.spring);
  const gone = seg(t, at + hold, at + hold + 0.3, E.in);
  if (gone >= 1) return '';
  return g({ transform: `translate(540 ${cy}) scale(${(lerp(from, 1, w) * lerp(1, 0.3, gone)).toFixed(3)}) translate(-540 ${-cy})`, opacity: ((1 - gone) * Math.min(1, w * 3)).toFixed(3) }, wordmark(540, cy, size, 1, { plate: true, tilt }));
}
