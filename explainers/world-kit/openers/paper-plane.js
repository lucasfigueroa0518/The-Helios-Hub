// Paper Plane: a big worksheet with "AI 101" and its worksheet icon slides into place over the
// frame. Its top corners fold down to the centre, it folds in half into a dart, and the plane flies
// off up and away, uncovering frame 2, the definition beat.
// Sound: the sheet slides, the folds crease, a throw and a whoosh as it flies.
import { T, g, el, id, ref, defs, seg, lerp, E, fill, softShape, nextBeat } from './common.js';
import { lessonIconAt, lessonTitle } from './lesson.js';

// the sheet, in its own coordinates about the frame's centre: bigger than the frame, so it covers
// it all as it slides into place
const SW = 780;
const SH = 1200;
const SLIDE = { x: 140, y: 100, r: 3 };

const P = (pts) => `M ${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;

/** Point p folded about the line through a and b by angle th (0 flat, PI folded over), seen from the front. */
function foldPt(p, a, b, th) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const ux = dx / L;
  const uy = dy / L;
  const k = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
  const q = [a[0] + k * ux, a[1] + k * uy];
  const c = Math.cos(th);
  return [q[0] + (p[0] - q[0]) * c, q[1] + (p[1] - q[1]) * c];
}

/** The printed face: paper, faint ruled lines, "AI 101" and the worksheet, in frame coordinates. */
function face(key) {
  const lines = [];
  for (let y = 260; y < 1920; y += 72) lines.push(el('line', { x1: -300, y1: y, x2: 1380, y2: y, stroke: T['blue-lit'], 'stroke-width': 2, opacity: 0.35 }));
  return [
    el('rect', { x: 540 - SW, y: 960 - SH, width: 2 * SW, height: 2 * SH, fill: T['paper-lit'] }),
    ...lines,
    el('line', { x1: 150, y1: -300, x2: 150, y2: 2200, stroke: T['red-lit'], 'stroke-width': 3, opacity: 0.4 }),
    lessonTitle(key),
    lessonIconAt(key),
  ].join('');
}

/** A sheet-space polygon as a frame-space path. */
const toFrame = (pts) => P(pts.map(([x, y]) => [540 + x, 960 + y]));

/** The paper plane (side on, nose to +x), for the throw. */
function plane() {
  return [
    el('path', { d: 'M 170 6 L -150 -84 L -96 6 L -150 70 Z', fill: T['shadow-warm'], opacity: 0.22, transform: 'translate(-14 26)', filter: ref('soft-shadow') }),
    softShape('M 170 0 L -90 0 L -150 64 Z', T['paper-shade'], { form: 0.6 }),
    softShape('M 170 0 L -150 -96 L -90 0 Z', T['paper-lit'], { form: 0.6 }),
    el('path', { d: 'M 170 0 L -120 -46', stroke: T['paper-dark'], 'stroke-width': 3, 'stroke-linecap': 'round' }),
    el('path', { d: 'M -90 0 L -130 34', stroke: T['paper-dark'], 'stroke-width': 3, 'stroke-linecap': 'round' }),
  ].join('');
}

export default function draw(t, ctx) {
  const { slide, exitAt, fold, fly, end } = ctx.M;
  const parts = [];
  if (t < exitAt) {
    // the sheet slides the last stretch into place and settles
    const u = seg(t, slide[0], slide[1], E.out);
    const tr = `translate(${(SLIDE.x * (1 - u)).toFixed(1)} ${(SLIDE.y * (1 - u)).toFixed(1)}) rotate(${(SLIDE.r * (1 - u)).toFixed(2)} 540 960)`;
    parts.push(defs(), fill(T['paper-shade']), g({ transform: tr }, face(ctx.key)));
    return parts.join('');
  }
  const out = end - 0.034;
  parts.push(nextBeat(ctx), defs());
  const mid = (fold[0] + fold[1]) / 2;
  if (t < fold[1]) {
    // first fold: the top corners come down to the centre line, their backs showing
    const a = seg(t, fold[0], mid, E.inOut);
    const th1 = Math.PI * a;
    const nose = [0, -SH];
    const lA = [-SW, -SH + SW];
    const rA = [SW, -SH + SW];
    const lFlap = [nose, [-SW, -SH], lA].map((p) => foldPt(p, nose, lA, th1));
    const rFlap = [nose, [SW, -SH], rA].map((p) => foldPt(p, nose, rA, th1));
    const left = [nose, [0, SH], [-SW, SH], lA];
    const right = [nose, rA, [SW, SH], [0, SH]];
    // second fold: the right half comes over onto the left, and the dart shrinks and turns to fly
    const b = seg(t, mid, fold[1], E.inOut);
    const c = Math.cos(Math.PI * b);
    // all through the folds the sheet shrinks away (even steps on a log scale) and turns to fly
    const s = seg(t, fold[0], fold[1], (x) => x);
    const k = Math.pow(0.16, s);
    const rot = lerp(0, 62, E.inOut(s));
    const under = (pts) => softShape(toFrame(pts), T['paper-shade'], { form: 0.5 });
    // a corner flap shows the printed face until it passes upright, then its back
    const flapAt = (pts, clip) => (Math.cos(th1) >= 0 ? g({ 'clip-path': ref(clip) }, face(ctx.key)) : under(pts));
    const shape = [
      el('defs', {}, el('clipPath', { id: id('pp-l') }, el('path', { d: toFrame(left) })) + el('clipPath', { id: id('pp-r') }, el('path', { d: toFrame(right) })) + el('clipPath', { id: id('pp-lf') }, el('path', { d: toFrame(lFlap) })) + el('clipPath', { id: id('pp-rf') }, el('path', { d: toFrame(rFlap) }))),
      el('path', { d: toFrame(c >= 0 ? [nose, rA, [SW, SH], [-SW, SH], lA] : left), fill: T['shadow-warm'], opacity: 0.25, transform: 'translate(-16 30)', filter: ref('soft-shadow') }),
      g({ 'clip-path': ref('pp-l') }, face(ctx.key)),
      flapAt(lFlap, 'pp-lf'),
      // the right half swings over about the centre crease: its face, then its back
      g({ transform: `translate(540 0) scale(${c.toFixed(4)} 1) translate(-540 0)` }, c >= 0 ? g({ 'clip-path': ref('pp-r') }, face(ctx.key)) + flapAt(rFlap, 'pp-rf') : under(right)),
      el('path', { d: `M 540 ${960 - SH} L 540 ${960 + SH}`, stroke: T['paper-dark'], 'stroke-width': 4, opacity: 0.6 }),
    ].join('');
    parts.push(g({ transform: `translate(540 960) rotate(${rot.toFixed(2)}) scale(${k.toFixed(4)}) translate(-540 -960)` }, shape));
    return parts.join('');
  }
  // the throw: the plane shoots up and away to the top right, gone by the cut
  const f = seg(t, fly[0], out, E.in);
  if (f < 1) {
    const x = lerp(560, 1500, f);
    const y = lerp(900, -520, f);
    const s = lerp(1.9, 0.9, f);
    parts.push(g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${lerp(-30, -40, f).toFixed(1)}) scale(${s.toFixed(3)})` }, plane()));
  }
  return parts.join('');
}
