// What every opener in the bank draws with (EX3-102). An opener never knows the reel: it gets
// the reel's hook scene (assets/frames/01-hook.js, written by the frame worker) through `ctx`:
//
//   ctx.hook   { ground, shots, hero, draw(t, { hideHero, heroPose }) }: the hook in motion,
//              framed by its own shots (a 2D crop and push: the hook's lens itself never moves);
//              `hero` is its critter, as the frame shows it at t = 0 before any shot's crop:
//                at: [x, y]        its feet on the page (through the hook's lens, if it has one)
//                s                 its screen scale there
//                box?: [x0, y0, x1, y1]   its screen box there (lens.js critterAt returns it)
//                critter           its CAST look ({ body, outfit, … })
//                lens?: { P, at: [x, y, z], rig }   the hook's lens, the hero's world feet and
//                                  the shot's light rig: the opener then draws the hero lit
//                                  exactly as the frame does (critterAt), and at/s/box can be
//                                  left out (they are projected from it)
//                draw?(pose)       or the hero drawn by the hook itself at its layout spot
//   ctx.M      the opener's timing (bank.js openerTiming): voiceAt, voice, duration, its moments
//   ctx.term   the storyboard's term, for the title card
//
// So the same opener takes on each reel's scene and critter. The first text an opener shows is
// "AI BRAIN BREAK" alone (Lucas, 2026-10-19); the term arrives later, in the title card.

import { T, g, el, ref, handwrite, handwriteWidth, shock, softShape, gloss } from '../draw.js';
import { soften } from '../props/kit.js';
import { seg, lerp, clamp01, E } from '../motion.js';
import { shotAt, shotCamera } from '../shots.js';
import { titleCard } from '../cards.js';
import { critter } from '../cast.js';
import { critterAt } from '../lens.js';

export { T, g, el, ref, handwrite, handwriteWidth, shock, seg, lerp, clamp01, E, critter, softShape, gloss };

/** An opener's own drawing in the soft style (hx-4): ink outlines become soft edges, flat fills
 *  soft gradients (props/kit.js soften). Never wrap the hook scene or a critter in it. */
export const soft = (svg) => soften(Array.isArray(svg) ? svg.join('') : svg);

/** A rounded rectangle as a path. */
export const roundRect = (x, y, w, h, r) =>
  `M ${(x + r).toFixed(1)} ${y.toFixed(1)} H ${(x + w - r).toFixed(1)} A ${r} ${r} 0 0 1 ${(x + w).toFixed(1)} ${(y + r).toFixed(1)} V ${(y + h - r).toFixed(1)} A ${r} ${r} 0 0 1 ${(x + w - r).toFixed(1)} ${(y + h).toFixed(1)} H ${(x + r).toFixed(1)} A ${r} ${r} 0 0 1 ${x.toFixed(1)} ${(y + h - r).toFixed(1)} V ${(y + r).toFixed(1)} A ${r} ${r} 0 0 1 ${(x + r).toFixed(1)} ${y.toFixed(1)} Z`;

/** A soft card (a sheet, a sticker, a plate): a soft-shaded rounded rect lifted off the page by a
 *  blurred warm shadow thrown to the lower left (the light is top right). `lift` 0..2. */
export function card(x, y, w, h, { r = 22, fill = T['paper-lit'], lift = 1 } = {}) {
  return [
    el('rect', { x: (x - 8 * lift).toFixed(1), y: (y + 18 * lift).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: r, fill: T['shadow-warm'], opacity: 0.24, filter: ref('soft-shadow') }),
    softShape(roundRect(x, y, w, h, r), fill),
  ].join('');
}
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

/** The hook's hero at its layout spot (t = 0, no shot crop): { at, s, box } from what the hook
 *  exports, projecting through its lens when it gives one. null when there is no critter hero. */
function heroLayout(hook) {
  const h = hook.hero;
  if (!h) return null;
  if (h.lens?.P && Array.isArray(h.lens.at)) {
    const [x, y, z = 0] = h.lens.at;
    const r = critterAt(h.lens.P, x, y, z, { ...(h.critter ?? {}), who: null }, h.lens.rig ?? null);
    return { at: Array.isArray(h.at) ? h.at : [r.feet[0], r.feet[1]], s: Number(h.s) > 0 ? h.s : r.s, box: Array.isArray(h.box) ? h.box : r.box };
  }
  if (!Array.isArray(h.at)) return null;
  return { at: h.at, s: h.s ?? 1, box: Array.isArray(h.box) && h.box.length === 4 ? h.box : null };
}

/**
 * The hook's critter on screen at its time t, through the hook's shot crop: its feet (x, y), its
 * scale s, its face, its left eye and its middle, its screen box, and its look (`critter`); null
 * when the hook has none. The feet, scale and box are the hero's projected layout spot (heroLayout);
 * a critter's eyes sit 98 units above its feet, 25 either side (cast.js), and when the hook gives
 * the hero's box its middle is the box's centre.
 */
export function heroAt(ctx, t) {
  const L = heroLayout(ctx.hook);
  if (!L) return null;
  const c = cameraAt(ctx.hook, t);
  const px = (v) => 540 + c.zoom * (v - 540 - c.x);
  const py = (v) => 960 + c.zoom * (v - 960 - c.y);
  const x = px(L.at[0]);
  const y = py(L.at[1]);
  const s = L.s * c.zoom;
  const box = L.box ? [px(L.box[0]), py(L.box[1]), px(L.box[2]), py(L.box[3])] : [x - 84 * s, y - 160 * s, x + 84 * s, y + 6 * s];
  const mid = L.box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : [x, y - 90 * s];
  return { x, y, s, box, face: [x, y - 98 * s], eye: [x - 25 * s, y - 98 * s], mid, critter: ctx.hook.hero?.critter ?? {} };
}

/**
 * The hero as drawn by an opener: a copy at its own place (feet x, y) and scale s, no world id,
 * looking exactly as the frame draws it. When the hook lights its hero through its lens
 * (hero.lens, lens.js critterAt) or draws it itself (hero.draw), that drawing is moved and scaled
 * from the hero's layout spot to (x, y, s), so the opener's copy never pops; otherwise a plain
 * critter in its CAST look.
 */
export function heroCritter(ctx, x, y, s, pose = {}) {
  const h = ctx.hook.hero ?? {};
  const look = h.critter ?? {};
  const L = heroLayout(ctx.hook);
  let own = null;
  if (L && h.lens?.P && Array.isArray(h.lens.at)) {
    const [wx, wy, wz = 0] = h.lens.at;
    own = critterAt(h.lens.P, wx, wy, wz, { ...look, ...pose, who: null }, h.lens.rig ?? null).svg;
  } else if (L && typeof h.draw === 'function') own = h.draw({ ...pose });
  if (own) {
    const k = s / L.s;
    return g({ transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)}) translate(${(-L.at[0]).toFixed(2)} ${(-L.at[1]).toFixed(2)})` }, own);
  }
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

/** The standard top-band title card, started at `from` (the bank's titleAt) and finished with the
 *  line; it lands cards.js TITLE_LANDS later with the term (EX3-102). */
export function title(ctx, t, from = ctx.M?.titleAt) {
  if (!Number.isFinite(from) || t < from || !ctx.term) return '';
  const { voiceAt, voice } = ctx.M;
  return titleCard(t - from, { term: ctx.term, to: Math.max(0.6, voiceAt + voice - 0.1 - from) });
}

/** "AI BRAIN BREAK", hand-lettered big and centred on (cx, cy); never the term. */
export function wordmark(cx, cy, size, progress = 1, { color = T.ink, weight = 1.4, plate = false, tilt = 0 } = {}) {
  const lineH = size * 1.45;
  const out = [];
  if (plate) {
    // a soft paper plate behind the letters, so they read over the drawing
    const w = handwriteWidth('AI BRAIN', size) + size * 1.1;
    const top = cy - lineH / 2 - size * 1.35;
    const h = lineH + size * 1.35 + size * 0.75;
    out.push(card(cx - w / 2, top, w, h, { r: 26 }));
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
