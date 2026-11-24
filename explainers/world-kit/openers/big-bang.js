// Big Bang: "AI 101" and its chalkboard slam onto the sheet, then tremble as a charge gathers in
// toward them (orange rings drawn in, faster and faster); BOOM, the whole sheet blows apart and its
// shards fly off over frame 2, the definition beat.
// Sound: a thud on the slam, a riser over the charge, the break on the blast.
import { T, g, el, id, ref, defs, seg, lerp, E, fill, shake, shaken, burst, nextBeat } from './common.js';
import { lessonIconAt, lessonTitle } from './lesson.js';

/** The blast's centre (the row's middle). */
const C = [540, 900];
const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/**
 * The sheet broken into jagged shards round C: `n` wedges cut by rings that share their edges, so
 * the shards tile the frame exactly until they move. The last ring is far off screen.
 */
function shards(n = 12, rings = [250, 620, 2600]) {
  const ang = Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 + 0.21 + 0.16 * Math.sin(i * 7.3));
  const angle = (i) => ang[i % n] + (i >= n ? Math.PI * 2 : 0);
  const rad = (ri, key) => (ri === rings.length - 1 ? rings[ri] : rings[ri] * (1 + 0.22 * Math.sin(key * 4.1 + ri * 2.3)));
  const P = (a, r) => [C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r];
  const edge = (ri, i) => {
    const a0 = angle(i);
    const a1 = angle(i + 1);
    return [P(a0, rad(ri, i % n)), P((a0 + a1) / 2, rad(ri, i + 0.5)), P(a1, rad(ri, (i + 1) % n))];
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
      out.push({ poly, c: pv, dir, spin: ((i * 37 + ri * 11) % 9) - 4, ri });
    }
  }
  return out;
}
const SHARDS = shards();

/** The card: "AI 101" and the chalkboard slam in from big, land with a squash, then tremble. */
function content(ctx, t) {
  const { slam, cardIn, exitAt } = ctx.M;
  const hit = slam[1];
  const s = t < hit ? lerp(2.6, 1, seg(t, slam[0], hit, E.in)) : 1 - 0.06 * Math.sin(Math.PI * seg(t, hit, hit + 0.1, (x) => x));
  // the charge: the tremble grows to the blast
  const q = seg(t, cardIn, exitAt, E.in);
  const k = Math.floor(t * 30);
  const amp = t >= cardIn ? 1.5 + 9 * q : 0;
  const j = [amp * Math.sin(k * 2.3), amp * Math.cos(k * 3.1)];
  const sc = s * (1 + 0.03 * q);
  return g({ transform: `translate(${(C[0] + j[0]).toFixed(1)} ${(C[1] + j[1]).toFixed(1)}) scale(${sc.toFixed(4)}) translate(${-C[0]} ${-C[1]})` }, lessonTitle(ctx.key) + lessonIconAt(ctx.key));
}

/** Orange rings drawn in toward the card, quickening as the charge builds. */
function charge(ctx, t) {
  const { cardIn, exitAt } = ctx.M;
  if (t < cardIn) return '';
  const q = seg(t, cardIn, exitAt, (x) => x);
  // the rings' phase: their rate climbs from 2 to 6 a second
  const ph = 2 * (t - cardIn) + 2 * (exitAt - cardIn) * q * q;
  return [0, 1 / 3, 2 / 3].map((o) => {
    const p = (ph + o) % 1;
    const r = 1150 * (1 - p) + 60;
    return el('circle', { cx: C[0], cy: C[1], r: r.toFixed(1), fill: 'none', stroke: o ? T['orange-lit'] : T.orange, 'stroke-width': (4 + 16 * p).toFixed(1), opacity: ((0.15 + 0.3 * q) * Math.min(1, p * 4)).toFixed(3) });
  }).join('');
}

const sheet = (ctx, t) => [fill(T.paper), charge(ctx, t), content(ctx, t)].join('');

export default function draw(t, ctx) {
  const { slam, exitAt, end } = ctx.M;
  if (t < exitAt) return defs() + shaken(shake(t, slam[1], 22, 0.2), sheet(ctx, t));
  // BOOM: the shards fly out from the centre, a little pop, then whipping away, all gone before the cut
  const u = seg(t, exitAt, end - 0.04, (x) => x);
  const under = nextBeat(ctx);
  if (u >= 1) return under;
  const frozen = sheet(ctx, exitAt - 0.001);
  const clips = el('defs', {}, SHARDS.map((sh, i) => el('clipPath', { id: id(`bang${i}`) }, el('polygon', { points: pts(sh.poly) }))).join(''));
  const flying = SHARDS.map((sh, i) => {
    const d = (110 * E.out(u) + 2800 * u * u) * (1 + 0.15 * sh.ri);
    const rot = sh.spin * 14 * u;
    return g({ transform: `translate(${(sh.dir[0] * d).toFixed(1)} ${(sh.dir[1] * d).toFixed(1)}) rotate(${rot.toFixed(2)} ${sh.c[0].toFixed(1)} ${sh.c[1].toFixed(1)})` }, [
      el('polygon', { points: pts(sh.poly.map(([x, y]) => [x - 10, y + 22])), fill: T['shadow-warm'], opacity: 0.22, filter: ref('soft-shadow') }),
      g({ 'clip-path': ref(`bang${i}`) }, frozen + el('polygon', { points: pts(sh.poly), fill: 'none', stroke: T['paper-shade'], 'stroke-width': 10, 'stroke-linejoin': 'round' })),
    ]);
  }).join('');
  // the flash ring races out and the burst rays are gone before the shards are
  const f = seg(t, exitAt, exitAt + 0.13, E.out);
  const ring = f > 0 && f < 1 ? el('circle', { cx: C[0], cy: C[1], r: (60 + 1500 * f).toFixed(1), fill: 'none', stroke: T.orange, 'stroke-width': (40 * (1 - f)).toFixed(1) }) : '';
  return [
    shaken(shake(t, exitAt, 26, 0.16), under),
    defs(),
    clips,
    flying,
    ring,
    burst(C[0], C[1], seg(t, exitAt, exitAt + 0.14, (x) => x), 5),
  ].join('');
}
