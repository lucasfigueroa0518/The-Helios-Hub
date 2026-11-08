import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as g from '../explainers/real-case/kit/geometry.js';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test('kit: easing and windows are clamped and monotonic', () => {
  near(g.seg(0, 1, 2), 0); near(g.seg(3, 1, 2), 1); near(g.seg(1.5, 1, 2), 0.5);
  near(g.easeOut(0), 0); near(g.easeOut(1), 1); near(g.easeInOut(0.5), 0.5);
  let prev = -1;
  for (let i = 0; i <= 20; i++) { const v = g.easeInOut(i / 20); assert.ok(v >= prev); prev = v; }
});

test('kit: hand speed — ~10 letters a second, circles 0.45–0.7s closing on the cue', () => {
  near(g.writeSeconds('learned: Feb.'), 1.0); // 10 letters
  near(g.writeSeconds('a'), 0.25);
  const w = g.circleWindow(5, 600);
  near(w.end, 5);
  assert.ok(w.end - w.start >= 0.45 && w.end - w.start <= 0.7);
  near(g.circleWindow(5, 100).end - g.circleWindow(5, 100).start, 0.45);
  near(g.circleWindow(5, 99999).end - g.circleWindow(5, 99999).start, 0.7);
  const a = g.arrowWindows(2, 0.5);
  assert.ok(a.flick1[0] > a.shaft[1] && a.flick2[0] > a.flick1[1]);
  near(a.flick1[1] - a.flick1[0], g.FLICK_SECONDS);
});

test('kit: connector leaves and arrives at box edges, not centres', () => {
  const A = box(0, 0, 100, 100), B = box(400, 0, 100, 100);
  const p = g.edgePoint(A, 450, 50, 16);
  near(p[0], 116); near(p[1], 50);
  const arr = g.arrowBetween(A, B, { bend: 0 as never });
  const [s0, s1] = [arr.shaft.pts[0], arr.shaft.pts.at(-1)!];
  near(s0[0], 116); near(s1[0], 384);
  near(arr.shaft.length, 268, 1e-6);
  // head flicks end on the tip and are `head` px long
  near(arr.flick1.pts[1][0], s1[0]); near(arr.flick1.pts[1][1], s1[1]);
  near(arr.flick1.length, 34, 1e-9);
});

test('kit: arrow bend is capped on short arrows', () => {
  const arr = g.arrowBetween(box(0, 0, 10, 10), box(100, 0, 10, 10), { bend: 500 as never, pad: 0 });
  const dev = Math.max(...arr.shaft.pts.map((p: number[]) => Math.abs(p[1] - 5)));
  assert.ok(dev <= (0.6 * 90) / 2 + 1e-6, `apex ${dev}`); // capped bend 0.6·len, quad apex is half of it
});

test('kit: measured marks surround / sit under their target', () => {
  const b = box(100, 200, 300, 60);
  const e = g.ellipseAround(b, 18);
  const core = box(b.x + b.w * 0.075, b.y + b.h * 0.15, b.w * 0.85, b.h * 0.7);
  for (const [x, y] of e.pts) {
    const inside = x > core.x && x < core.x + core.w && y > core.y && y < core.y + core.h;
    assert.ok(!inside, 'circle never crosses the word');
  }
  assert.ok(e.length > 2 * (b.w + b.h) * 0.9);
  for (const [, y] of e.pts) assert.ok(y > b.y - 18 * 0.5 && y < b.y + b.h + 18 * 0.5, 'the circle stays on its own line');
  const u = g.underlineUnder(b);
  for (const [, y] of u.pts) assert.ok(y > b.y + b.h * 0.8 && y < b.y + b.h + 12, 'under the baseline, above the next line');
  const [c1, c2] = g.crossOver(b, 0);
  near(c1.length, Math.hypot(300, 60)); near(c2.length, c1.length);
});

test('kit: cord sags, unspools, and partial() covers the right fraction', () => {
  const c = g.cordPoints([[0, 0], [400, 0]]);
  const lowest = Math.max(...c.pts.map((p: number[]) => p[1]));
  near(lowest, 400 * g.CORD_SAG / 2, 0.5); // quad apex is half the control offset
  const slack = g.cordPoints([[0, 0], [400, 0]], 0);
  assert.ok(Math.max(...slack.pts.map((p: number[]) => p[1])) > lowest);
  near(g.polyLength(g.partial(c.pts, 0.5)), c.length / 2, 1e-6);
  const end = g.pointAt(c.pts, 1);
  near(end[0], 400, 1e-9); near(end[1], 0, 1e-9);
});

test('kit: arrive() lifts before contact, settles ≤ settle px, never elastic', () => {
  const pre = g.arrive(0.5, { from: [0, -80], lift: 0.03, settle: 2 });
  assert.ok(pre.scale > 1 && pre.scale <= 1.03 && pre.y < 0);
  let maxSettle = 0, minSettle = 0;
  for (let i = 86; i <= 100; i++) { const m = g.arrive(i / 100, { settle: 2 }); maxSettle = Math.max(maxSettle, m.y); minSettle = Math.min(minSettle, m.y); near(m.scale, 1); }
  assert.ok(maxSettle <= 2 && minSettle >= 0, 'one settle, no overshoot back up');
  near(g.arrive(1).y, 0);
  assert.equal(g.arrive(0).visible, false);
  near(g.tagSwing(1), 0);
});

test('kit: camera holds outside keys and eases between them', () => {
  const keys = [{ t: 1, x: 540, y: 960, scale: 1 }, { t: 2, x: 600, y: 900, scale: 1.5 }];
  assert.deepEqual(g.cameraAt(0, keys), { x: 540, y: 960, scale: 1 });
  assert.deepEqual(g.cameraAt(3, keys), { x: 600, y: 900, scale: 1.5 });
  const mid = g.cameraAt(1.5, keys);
  assert.ok(mid.scale > 1.25, 'ease-out is past halfway at the midpoint');
  assert.equal(g.cameraTransform({ x: 540, y: 960, scale: 1 }), 'translate(0.00px, 0.00px) scale(1.0000)');
});

test('kit: seeded randomness and torn edges are deterministic', () => {
  const a = g.rng(7), b = g.rng(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.equal(g.tornPolygon(3), g.tornPolygon(3));
  assert.notEqual(g.tornPolygon(3), g.tornPolygon(4));
});

test('kit: no network, no clock, no randomness in kit sources', () => {
  const dir = path.join(process.cwd(), 'explainers/real-case/kit');
  const files = ['geometry.js', ...fs.readdirSync(path.join(dir, 'components')).map((f) => `components/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(src), `${f}: no URLs`);
    assert.ok(!/Date\.now|new Date\(|Math\.random|performance\.now/.test(src), `${f}: deterministic`);
    assert.ok(!/@keyframes|animation:|transition:/.test(src), `${f}: no CSS animation`);
  }
});
