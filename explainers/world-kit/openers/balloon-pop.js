// Balloon Pop: an orange balloon printed with "AI 101" and its graduate cap puffs up in three
// gulps, trembles, swells until it fills the screen, and POPS: its rubber shreds fly off and
// uncover frame 2, the definition beat.
// Sound: a stretch on each gulp, the pop and a hit, a paper flutter.
import { T, g, el, id, ref, defs, seg, lerp, E, fill, shake, shaken, burst, softShape, gloss, nextBeat } from './common.js';
import { lessonIconAt, lessonTitle } from './lesson.js';

/** The balloon's middle, and its half width and height at full size (s 1). */
const C = [540, 900];
const RX = 470;
const RY = 560;
/** Its size after each gulp, and how big it swells just before the pop (past the frame's corners). */
const GULP_S = [0.46, 0.74, 1];
const SWELL_S = 2.6;
/** The print grows less than the rubber, so "AI 101" stays whole on screen as it swells. */
const PRINT_MAX = 1.1;
const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** The balloon's size at t: three springy gulps, a slow strain, then the last swell into the pop. */
function size(t, M) {
  let s = 0.22;
  M.gulps.forEach(([a, b], i) => {
    if (t >= a) s = lerp(s, GULP_S[i], seg(t, a, b, E.spring));
  });
  s *= 1 + 0.05 * seg(t, M.cardIn, M.exitAt - 0.1, (x) => x);
  return lerp(s, SWELL_S, seg(t, M.exitAt - 0.1, M.exitAt, E.in));
}

function balloon(ctx, t) {
  const M = ctx.M;
  const s = size(t, M);
  // it trembles harder the fuller it gets
  const wob = Math.sin(t * 70) * seg(t, M.cardIn, M.exitAt, E.in);
  const rx = RX * s * (1 + 0.03 * wob);
  const ry = RY * s * (1 - 0.03 * wob);
  const [cx, cy] = C;
  const skin = `M ${(cx - rx).toFixed(1)} ${cy} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(cx + rx).toFixed(1)} ${cy} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(cx - rx).toFixed(1)} ${cy} Z`;
  const hx = cx + rx * 0.42;
  const hy = cy - ry * 0.48;
  const print = Math.min(s, 1) * 0.96 * lerp(1, PRINT_MAX / 0.96, seg(t, M.exitAt - 0.1, M.exitAt, E.in));
  return [
    // the string and the knot
    el('path', { d: `M ${cx} ${(cy + ry + 30).toFixed(1)} q -40 140 10 260 t -10 300`, fill: 'none', stroke: T['text-tertiary'], 'stroke-width': 3.5, 'stroke-linecap': 'round' }),
    softShape(`M ${(cx - 28 * s).toFixed(1)} ${(cy + ry + 34 * s).toFixed(1)} L ${cx} ${(cy + ry - 6).toFixed(1)} L ${(cx + 28 * s).toFixed(1)} ${(cy + ry + 34 * s).toFixed(1)} Z`, T['orange-shade'], { form: 0.5 }),
    // a glossy rubber volume lit from the top right, with its window highlight
    softShape(skin, T.orange),
    gloss(skin, { strength: 0.7 }),
    el('ellipse', { cx: hx.toFixed(1), cy: hy.toFixed(1), rx: (rx * 0.11).toFixed(1), ry: (ry * 0.17).toFixed(1), fill: T.canvas, opacity: 0.6, transform: `rotate(28 ${hx.toFixed(1)} ${hy.toFixed(1)})` }),
    // the print: AI 101 in paper white and the graduate cap
    g({ transform: `translate(${cx} ${cy}) scale(${print.toFixed(4)}) translate(${-cx} -900)` }, lessonTitle(ctx.key, 1, { color: T['paper-lit'] }) + lessonIconAt(ctx.key)),
  ].join('');
}

/** The skin torn into ragged shreds round the pop: wedges cut by rings that share their edges. */
function shreds(n = 11, rings = [300, 700, 2600]) {
  const ang = Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 + 0.4 + 0.2 * Math.sin(i * 5.7));
  const angle = (i) => ang[i % n] + (i >= n ? Math.PI * 2 : 0);
  const rad = (ri, key) => (ri === rings.length - 1 ? rings[ri] : rings[ri] * (1 + 0.28 * Math.sin(key * 3.7 + ri * 1.9)));
  const P = (a, r) => [C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r];
  // each cut ragged: three points along it
  const edge = (ri, i) => {
    const a0 = angle(i);
    const a1 = angle(i + 1);
    return [0, 0.33, 0.5, 0.67, 1].map((k, j) => P(lerp(a0, a1, k), rad(ri, j === 0 ? i % n : j === 4 ? (i + 1) % n : i + k)));
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let ri = 0; ri < rings.length; ri++) {
      const poly = [...edge(ri, i), ...(ri === 0 ? [C] : edge(ri - 1, i).reverse())];
      const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
      const d = Math.hypot(c[0] - C[0], c[1] - C[1]) || 1;
      const dir = [(c[0] - C[0]) / d, (c[1] - C[1]) / d];
      // each shard turns about its inner edge (on screen), not its middle (far off it for the outer ring)
      const pv = ri === 0 ? c : [C[0] + dir[0] * rings[ri - 1], C[1] + dir[1] * rings[ri - 1]];
      out.push({ poly, c: pv, dir, spin: (i % 2 ? 1 : -1) * (3 + ((i * 7 + ri) % 4)), ri });
    }
  }
  return out;
}
const SHREDS = shreds();

// confetti bits flung out of the pop, out of frame before the cut
const BITS = Array.from({ length: 30 }, (_, i) => {
  const a = i * 2.39996;
  return { a, v: 1800 + ((i * 53) % 9) * 160, spin: ((i * 97) % 13) * 60 - 360, w: 26 + (i % 4) * 10, h: 14 + (i % 3) * 8, c: [T.orange, T['paper-lit'], T['orange-lit'], T.mustard][i % 4] };
});

export default function draw(t, ctx) {
  const { exitAt, end } = ctx.M;
  if (t < exitAt) return defs() + fill(T['paper-lit']) + balloon(ctx, t);
  // POP: the shreds snap back and fly off, all gone before the cut
  const u = seg(t, exitAt, end - 0.04, (x) => x);
  const under = nextBeat(ctx);
  if (u >= 1) return under;
  const skin = balloon(ctx, exitAt);
  const clips = el('defs', {}, SHREDS.map((sh, i) => el('clipPath', { id: id(`pop${i}`) }, el('polygon', { points: pts(sh.poly) }))).join(''));
  const flying = SHREDS.map((sh, i) => {
    const d = (130 * E.out(u) + 2700 * u * u) * (1 + 0.15 * sh.ri);
    const k = lerp(1, 0.7, u);
    return g({ transform: `translate(${(sh.dir[0] * d).toFixed(1)} ${(sh.dir[1] * d).toFixed(1)}) rotate(${(sh.spin * 9 * u).toFixed(2)} ${sh.c[0].toFixed(1)} ${sh.c[1].toFixed(1)}) translate(${sh.c[0].toFixed(1)} ${sh.c[1].toFixed(1)}) scale(${k.toFixed(3)}) translate(${(-sh.c[0]).toFixed(1)} ${(-sh.c[1]).toFixed(1)})` },
      g({ 'clip-path': ref(`pop${i}`) }, skin + el('polygon', { points: pts(sh.poly), fill: 'none', stroke: T['orange-shade'], 'stroke-width': 14, 'stroke-linejoin': 'round' })));
  }).join('');
  const bits = BITS.map((b) => {
    const dist = 60 + b.v * u * (0.6 + u);
    const x = C[0] + Math.cos(b.a) * dist;
    const y = C[1] + Math.sin(b.a) * dist;
    if (x < -100 || x > 1180 || y < -100 || y > 2020) return '';
    const flip = Math.abs(Math.cos(u * 9 + b.spin));
    return el('rect', { x: (-b.w / 2).toFixed(1), y: (-b.h / 2).toFixed(1), width: b.w, height: b.h, fill: b.c, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(b.spin * u).toFixed(1)}) scale(1 ${flip.toFixed(3)})` });
  }).join('');
  return [
    shaken(shake(t, exitAt, 30, 0.16), under),
    defs(),
    clips,
    flying,
    bits,
    burst(C[0], C[1], seg(t, exitAt, exitAt + 0.13, (x) => x), 5),
  ].join('');
}
