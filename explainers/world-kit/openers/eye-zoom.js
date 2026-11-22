// Eye Zoom: "AI 101" writes itself beside the house scholar, which glances at it, turns to you and
// blinks; then the camera dives into its eye. Frame 2, the definition beat, waits inside the pupil
// and opens out with the dive until it fills the screen.
// Sound: a marker squeak on the writing, a tap on the blink, a swish and a hit on the dive.
import { T, g, el, id, ref, defs, seg, lerp, E, scene, zoomed, nextBeat } from './common.js';
import { lessonLayout, lessonTitle } from './lesson.js';

/** Screen px per critter tile unit at scale 1 (cast.js CRITTER_PX over the tile's body height). */
const DK = 142 / 152;
/** The dive's last zoom: the pupil's window is past the frame's corners by then. */
const Z = 130;
/** The window into frame 2 is this much of the pupil, so an ink rim rings it. */
const WINDOW = 0.84;

/** Where the scholar looks: at the title as it writes, then at the viewer. */
const lookAt = (t) => {
  const u = seg(t, 0.26, 0.34, E.inOut);
  return [lerp(-0.4, 0, u), lerp(0.2, 0, u)];
};

/** The scholar's left pupil on screen (cast.js dEye: tile eye (74, 96), the happy mood's pupil
 *  offset, the look's gaze), and its radius. */
function pupil(ctx, look) {
  const { at, s } = lessonLayout(ctx.key).scholar;
  const tx = 74 + look[0] * 6;
  const ty = 96 - 2 * 0.8 + look[1] * 5;
  return { p: [at[0] + (tx - 100) * DK * s, at[1] + (ty - 192) * DK * s], r: 11.5 * DK * s };
}

/** The card: the scholar (its blink, its look) and "AI 101" written beside it. */
function card(ctx, t) {
  const { write, blink } = ctx.M;
  const lid = t >= blink[0] && t < blink[1] ? Math.sin(Math.PI * seg(t, blink[0], blink[1], (x) => x)) : 0;
  return scene(ctx, t, { hideTitle: true, heroPose: { look: lookAt(t), lid } }) + lessonTitle(ctx.key, seg(t, write[0], write[1], (x) => x));
}

export default function draw(t, ctx) {
  const { exitAt, end } = ctx.M;
  if (t < exitAt) return defs() + card(ctx, t);
  // the dive: the zoom climbs steadily on a log scale while the eye slides to the frame's middle
  const u = seg(t, exitAt, end - 0.04, (x) => x);
  const under = nextBeat(ctx);
  if (u >= 1) return under;
  const { p, r } = pupil(ctx, lookAt(exitAt));
  const z = Math.exp(Math.log(Z) * u);
  const q = [lerp(p[0], 540, E.inOut(u)), lerp(p[1], 960, E.inOut(u))];
  const R = r * z * WINDOW;
  const parts = [defs(), zoomed(card(ctx, exitAt), p, z, q)];
  // speed lines streak out of the eye
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    const r0 = R + 320 + 400 * u;
    const r1 = r0 + 420 * (1 - u) + 60;
    parts.push(el('line', { x1: (q[0] + Math.cos(a) * r0).toFixed(1), y1: (q[1] + Math.sin(a) * r0).toFixed(1), x2: (q[0] + Math.cos(a) * r1).toFixed(1), y2: (q[1] + Math.sin(a) * r1).toFixed(1), stroke: T['paper-lit'], 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.6 }));
  }
  // frame 2 inside the pupil, opening with the dive and settling to its own scale
  const inner = zoomed(under, [540, 960], lerp(1.35, 1, E.out(u)));
  parts.push(el('defs', {}, el('clipPath', { id: id('pupil') }, el('circle', { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: R.toFixed(1) }))));
  parts.push(g({ 'clip-path': ref('pupil') }, inner));
  return parts.join('');
}
