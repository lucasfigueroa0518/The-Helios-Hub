/**
 * Explainers visual system 4.0 (hx-4): space, light and motion in the world kit, offline. The
 * scale ledger, back-to-front order, containers and the magnifier (space.js), the light helpers
 * (light.js), the motion principles and the layered frame with parallax and depth of field
 * (motion.js, shots.js). No model, no browser.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/* eslint-disable @typescript-eslint/no-explicit-any */
// draw.js imports perfect-freehand from the CDN; try.mjs stubs it for Node.
let M: any = null;
async function kit(): Promise<any> {
  if (M) return M;
  await import('../explainers/world-kit/try.mjs');
  const draw = await import('../explainers/world-kit/draw.js');
  M = {
    core: await import('../explainers/world-kit/core.js'),
    scope: draw.scope,
    groundName: draw.groundName,
    space: await import('../explainers/world-kit/space.js'),
    light: await import('../explainers/world-kit/light.js'),
    motion: await import('../explainers/world-kit/motion.js'),
    shots: await import('../explainers/world-kit/shots.js'),
    seams: await import('../explainers/world-kit/seams.js'),
    lens: await import('../explainers/world-kit/lens.js'),
  };
  return M;
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const clean = (svg: string) => !/NaN|undefined|Infinity|\[object Object\]/.test(svg);
const COS = Math.cos(Math.PI / 6);

// ── space.js ────────────────────────────────────────────────────────────────

test('scene places centimetres on the iso floor: a 72 cm critter stands 72·ppcm px tall', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  const sc = space.scene({ ppcm: 2, origin: [500, 400] });
  assert.deepEqual(sc.at(0, 0, 0), [500, 400]);
  assert.deepEqual(sc.at(0, 0, 72), [500, 256]);
  const [x, y] = sc.at(10, 0, 0);
  assert.ok(near(x, 500 + 10 * COS * 2) && near(y, 410), 'x runs right and toward the viewer');
  assert.equal(sc.size(72), 144);
  assert.equal(sc.s, 2, 'the s of onPlane / isoPlane / ring');
  assert.ok(near(sc.critterS * space.CRITTER_PX, 72 * 2), 'critterS draws a true 72 cm critter');
  assert.ok(near(sc.heldScale(9, 30), (9 * 2) / 30));
  assert.equal(space.CRITTER_CM, 72);
  assert.ok(near(space.PX_PER_CM, space.CRITTER_PX / 72));
  // On an existing kit projection: cm are converted into its units.
  const P = core.iso(100, 200, 1.25);
  const on = space.scene({ ppcm: 2.5, P });
  assert.deepEqual(on.at(4, 0, 0), P(8, 0, 0));
  assert.ok(near(on.at(0, 0, 10)[1], 200 - 25));
  const moved = space.scene({ ppcm: 2.5, P, origin: [0, 0] });
  assert.deepEqual(moved.at(0, 0, 0), [0, 0]);
  assert.throws(() => space.scene({ ppcm: 0 }), /ppcm/);
  // A face transform: (1, 0) lands one cm along u.
  const m = space.plane(sc.at, [0, 0, 0], [0, 1, 0], [0, 0, -1]).match(/matrix\(([^)]+)\)/)![1].split(' ').map(Number);
  assert.ok(near(m[0], -COS * 2, 1e-3) && near(m[1], 1, 1e-3) && near(m[2], 0) && near(m[3], 2, 1e-3));
});

test('depthSort draws back to front: farther (smaller x + y) first, what sits on top after, ties stable', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  const svg = space.depthSort([
    { at: [100, 100, 0], svg: 'C' },
    { at: [0, 0, 0], svg: 'A' },
    { at: [50, 50, 80], svg: 'B2' },
    { at: [50, 50, 0], svg: 'B1' },
    null,
    { at: [60, 40, 0], svg: 'B1b' },
    { at: [0, 0, 0], svg: '' },
    { at: [500, 500, 0], svg: 'D', depth: -1 },
  ] as never);
  assert.equal(svg, 'DAB1B1bB2C');
  assert.ok(space.depth(0, 0, 0) < space.depth(10, 0, 0) && space.depth(10, 0, 0) === space.depth(0, 10, 0));
});

test('sizes validates the scale ledger and gives the scale to draw an asset at its real size', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  const SIZES = { carton: { w: 7, d: 7, h: 24, exaggerate: 1.4 }, fridge: { w: 76, d: 72, h: 178 } };
  const s = space.sizes(SIZES);
  assert.equal(s.ok, true);
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.cm('fridge'), { w: 76, d: 72, h: 178 });
  assert.ok(near(s.px('fridge'), 178 * space.PX_PER_CM));
  assert.ok(near(s.px('carton', { ppcm: 2 }), 24 * 1.4 * 2), 'drawn with its declared exaggeration');
  assert.ok(near(s.scaleOf('fridge', 200), (178 * space.PX_PER_CM) / 200));
  assert.throws(() => s.cm('store'), /no real size/);
  assert.match(space.sizes(null).problems[0], /SIZES must be an object/);
  const bad = space.sizes({ a: { w: 1, d: 0, h: 2 }, b: { w: 1, d: 1, h: 1, exaggerate: 1.6 }, c: 'big' } as never).problems;
  assert.equal(bad.length, 3);
  assert.match(bad[0], /SIZES\.a\.d must be a positive number of cm/);
  assert.match(bad[1], /SIZES\.b\.exaggerate is 1\.6×; story exaggeration is capped at 1\.5×/);
  assert.match(bad[2], /SIZES\.c must be/);
});

test('scaleProblems: 1.4× passes and 1.6× fails against a 1.5× allowance, relative to the critter', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  const SIZES = { carton: { w: 7, d: 7, h: 24, exaggerate: 1.5 }, store: { w: 600, d: 900, h: 450, far: true }, fridge: { w: 76, d: 72, h: 178 } };
  const critterPx = 142; // a critter at scale 1
  const real = (cm: number) => (cm * critterPx) / 72;
  assert.deepEqual(space.scaleProblems(SIZES, { critter: critterPx, carton: real(24) * 1.4 }), []);
  const big = space.scaleProblems(SIZES, { critter: critterPx, carton: real(24) * 1.6 });
  assert.equal(big.length, 1);
  assert.match(big[0], /"carton" is drawn 1\.6× its real size \(24 cm tall next to a 72 cm critter is 47 px, drawn 76 px\): its SIZES allow 1\.5×/);
  // Too small is as wrong as too big; relative to the critter, whatever the scene's scale.
  assert.match(space.scaleProblems(SIZES, { critterS: 2, carton: real(24) * 2 * 0.6, t: 1.25 })[0], /drawn 0\.6× its real size at 1\.25s/);
  assert.deepEqual(space.scaleProblems(SIZES, { critterS: 2, carton: real(24) * 2 }), []);
  // Undeclared exaggeration gets only drawing slack, and the error says how to declare it.
  const fridge = space.scaleProblems(SIZES, { critter: critterPx, fridge: real(178) * 1.4 });
  assert.match(fridge[0], /"fridge" is drawn 1\.4× .*declare exaggerate \(at most 1\.5×\) in SIZES/);
  assert.deepEqual(space.scaleProblems(SIZES, { critter: critterPx, fridge: real(178) * 1.1 }), []);
  // Width instead of height; far things skipped; unknown things named once; a reference is required.
  assert.deepEqual(space.scaleProblems(SIZES, { critter: critterPx, carton: { w: real(7) * 1.2 } }), []);
  assert.deepEqual(space.scaleProblems(SIZES, { critter: critterPx, store: 4 }), []);
  assert.match(space.scaleProblems(SIZES, [{ critter: critterPx, milk: 9 }, { critter: critterPx, milk: 9 }]).join('|'), /^"milk" is drawn but has no real size in SIZES/);
  assert.equal(space.scaleProblems(SIZES, [{ critter: critterPx, milk: 9 }, { critter: critterPx, milk: 9 }]).length, 1);
  assert.match(space.scaleProblems(SIZES, { carton: 40 })[0], /needs a critter's drawn height/);
  assert.match(space.scaleProblems({ x: { w: 1, d: 1, h: 1, exaggerate: 2 } }, { critter: 142 })[0], /capped at 1\.5×/);
});

test('container: back and contents are clipped to the opening; the frame and shell are drawn over them', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  scope('ct-', 'paper');
  const opening = [[100, 100], [300, 100], [300, 400], [100, 400]];
  const svg = space.container({ clip: opening, back: '<g id="BACK"></g>', contents: '<g id="CARTON"></g>', front: '<g id="FRAME"></g>' });
  const cid = svg.match(/<clipPath id="(ct-ctr-[a-z0-9]+)"/)![1];
  const clipped = svg.indexOf(`clip-path="url(#${cid})"`);
  assert.ok(clipped > 0, 'a clip-path group');
  assert.match(svg, /<clipPath id="ct-ctr-[a-z0-9]+"><path d="M 100 100 L 300 100 L 300 400 L 100 400 Z"><\/path><\/clipPath>/);
  const back = svg.indexOf('BACK');
  const carton = svg.indexOf('CARTON');
  const frameAt = svg.indexOf('FRAME');
  assert.ok(clipped < back && back < carton && carton < frameAt, 'back, then contents, inside the clip; then the frame');
  // The frame is outside the clipped group: the group closes before it.
  const group = svg.slice(clipped);
  assert.ok(group.indexOf('</g><g id="FRAME">') > 0 || /<\/g><g id="FRAME">/.test(svg), 'the frame is not clipped');
  assert.match(svg, /data-k="container"/);
  assert.ok(!space.container({ clip: 'M 0 0 L 10 0 L 10 10 Z', contents: 'x', ao: 0 }).includes('ctrao'), 'ao 0: no shade');
  assert.throws(() => space.container({ contents: 'x' } as never), /clip/);
  assert.ok(clean(svg));
});

test('magnifier: the scene redrawn at zoom inside a lens, a cone to the source, the ×N chip, no second cast', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  scope('mg-', 'paper');
  let seen: { zoom: number; lw: (px: number) => number } | null = null;
  const svg = space.magnifier({
    from: [500, 1200], at: [540, 700], r: 200, zoom: 5,
    draw: (ctx: { zoom: number; lw: (px: number) => number }) => { seen = ctx; return '<g data-who="nurse" data-look="orange||"><circle r="2"></circle></g>'; },
  });
  assert.equal(seen!.zoom, 5);
  assert.equal(seen!.lw(5), 1, 'line weights for the lens: px / zoom');
  assert.match(svg, /<clipPath id="mg-lens-[a-z0-9]+"><circle cx="540" cy="700" r="200"><\/circle><\/clipPath>/);
  assert.match(svg, /translate\(540 700\) scale\(5\) translate\(-500 -1200\)/);
  assert.match(svg, /<circle cx="500" cy="1200" r="40" fill="none"/, 'the source ring shows exactly what the lens shows (r / zoom)');
  assert.equal((svg.match(/stroke-dasharray="1 8"/g) ?? []).length, 2, 'two tangents of the cone');
  assert.match(svg, /data-text="×5"/);
  assert.ok(!/data-who|data-look/.test(svg), 'the magnified critter is not a second cast member');
  assert.ok(clean(svg));
  assert.ok(!space.magnifier({ from: [0, 0], at: [500, 500], r: 100, zoom: 2, draw: '', label: false }).includes('data-text'));
  assert.throws(() => space.magnifier({ from: [0, 0], at: [1, 1], r: 10, zoom: 1, draw: '' }), /zoom/);
  assert.equal(groundName(), 'paper');
});

// ── light.js ────────────────────────────────────────────────────────────────

test('light: a wedge, a rim, a glow, a glint that sweeps, a lit sign, and the level over time', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  scope('lt-', 'paper');
  const wedge = light.lightWedge({ from: [[100, 100], [140, 110]], to: [[60, 400], [300, 420]], level: 0.8 });
  assert.match(wedge, /<linearGradient id="lt-wedge-[a-z0-9]+" gradientUnits="userSpaceOnUse" x1="120" y1="105" x2="180" y2="410"/);
  assert.match(wedge, /<polygon points="100,100 140,110 300,420 60,400"/);
  assert.equal(light.lightWedge({ from: [[0, 0], [1, 1]], to: [[0, 9], [9, 9]], level: 0 }), '', 'dark: nothing');
  const r = light.rim('M 0 0 L 100 0 L 100 100 Z', { side: 'right', width: 8 });
  assert.match(r, /<feOffset in="SourceAlpha" dx="-8" dy="0"/, 'the band on the right: the shape minus itself moved left');
  assert.match(light.rim('<rect width="10" height="10"></rect>', { side: 'top', width: 4 }), /dx="0" dy="4"/);
  assert.match(light.rim('M 0 0 Z', { side: 'key' }), /dx="-3\.73" dy="4\.7"/, 'the kit key light, top right');
  assert.match(light.glow(10, 20, 30), /<circle cx="10" cy="20" r="30" fill="url\(#lt-glow-/);
  // The glint: nothing before or after the sweep; across the face in between, moving right.
  const face = 'M 0 0 L 100 0 L 100 200 L 0 200 Z';
  assert.equal(light.glint(face, 0), '');
  assert.equal(light.glint(face, 1), '');
  const xAt = (u: number) => Number(light.glint(face, u, { angle: 0 }).match(/<path d="M (-?[\d.]+) -2/)![1]);
  assert.ok(xAt(0.2) < xAt(0.5) && xAt(0.5) < xAt(0.8), 'sweeps left to right');
  assert.match(light.glint(face, 0.5), /clip-path="url\(#lt-glint-/);
  const sign = light.glowSign('OPEN', 540, 300, { color: 'warm' });
  assert.match(sign, /^<g data-k="text" data-text="OPEN"/, 'one piece of text for bounds.mjs');
  assert.equal((sign.match(/>OPEN<\/text>/g) ?? []).length, 2, 'halo and core');
  assert.deepEqual(light.bboxOf(face), { x: 0, y: 0, w: 100, h: 200 });
  // level: holds before and after, eases between keys.
  const keys: [number, number][] = [[0, 0], [0.4, 0.5], [0.9, 1]];
  assert.equal(light.level(-1, keys), 0);
  assert.equal(light.level(0.4, keys), 0.5);
  assert.equal(light.level(2, keys), 1);
  assert.ok(near(light.level(0.65, keys), 0.75), 'glide is symmetric: the midpoint is halfway');
  assert.ok(light.level(0.1, keys) < 0.125, 'eased, not linear');
  assert.ok(near(light.level(0.2, [{ at: 0, v: 0 }, { at: 0.4, v: 1, e: 'linear' }]), 0.5));
  for (const s of [wedge, r, sign, light.glint(face, 0.3)]) assert.ok(clean(s));
});

// ── motion.js ───────────────────────────────────────────────────────────────

test('motion principles: squash keeps the volume, follow-through decays, arcs end where they should, one smear frame', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  for (const u of [-1, -0.5, 0, 0.3, 1]) {
    const { sx, sy } = motion.squash(u, { amount: 0.3 });
    assert.ok(near(sx * sy, 1, 1e-12), `sx·sy = 1 at ${u}`);
  }
  assert.ok(motion.squash(1).sx > 1 && motion.squash(1).sy < 1, 'squash: wide and low');
  assert.ok(motion.squash(-1).sy > 1, 'stretch: tall and thin');
  assert.deepEqual(motion.squash(0), { sx: 1, sy: 1 });
  assert.match(motion.squashTransform(100, 500, motion.squash(1)), /^translate\(100\.00 500\.00\) scale\(1\.3333 0\.7500\) translate\(-100\.00 -500\.00\)$/);
  // follow-through: still before the stop; it overshoots, then each swing is smaller.
  assert.equal(motion.follow(0.9, 1), 0);
  const peak = (a: number, b: number) => Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(motion.follow(a + ((b - a) * i) / 49, 1, { amp: 20 }))));
  const first = peak(1, 1.25);
  const later = peak(1.5, 1.75);
  const last = peak(2.5, 2.75);
  assert.ok(first > 5 && later < first * 0.5 && last < later, `${first} → ${later} → ${last}`);
  assert.ok(motion.follow(1.1, 1, { amp: 20 }) > 0, 'carries on past the rest point first');
  // arcs
  assert.deepEqual(motion.arcPath([0, 100], [200, 300], 80, 0), [0, 100]);
  assert.deepEqual(motion.arcPath([0, 100], [200, 300], 80, 1), [200, 300]);
  assert.deepEqual(motion.arcPath([0, 100], [200, 300], 80, 0.5), [100, 120], 'the middle is lifted by apexLift');
  // smear: a 4-frame move smears its middle frame; a slow move never does.
  const s = motion.smear([0, 0], [400, 0], 0.5, { frames: 4, size: 100 });
  assert.equal(s.on, true);
  assert.ok(s.stretch > 1 && s.stretch <= 3 && s.angle === 0);
  assert.equal(motion.smear([0, 0], [400, 0], 0.25, { frames: 4 }).stretch, 1, 'only one frame');
  assert.equal(motion.smear([0, 0], [400, 0], 0.5, { frames: 9 }).on, false, 'a slow move does not smear');
  assert.equal(motion.smear([0, 0], [0, 50], 0.5).angle, 90);
});

test('E.world eases in and out; E.ui is the brand ease-out cubic-bezier(0.16, 1, 0.3, 1), no bounce', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  // A reference solve of the bezier by bisection.
  const ref = (t: number) => {
    const bx = (u: number) => 3 * (1 - u) ** 2 * u * 0.16 + 3 * (1 - u) * u * u * 0.3 + u ** 3;
    const by = (u: number) => 3 * (1 - u) ** 2 * u + 3 * (1 - u) * u * u + u ** 3;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2;
      if (bx(m) < t) lo = m;
      else hi = m;
    }
    return by((lo + hi) / 2);
  };
  assert.equal(motion.E.ui(0), 0);
  assert.equal(motion.E.ui(1), 1);
  for (const t of [0.05, 0.1, 0.25, 0.5, 0.75, 0.9]) assert.ok(near(motion.E.ui(t), ref(t), 1e-6), `E.ui(${t}) = ${motion.E.ui(t)} vs ${ref(t)}`);
  assert.ok(motion.E.ui(0.25) > 0.75, 'fast out of the gate');
  let prev = 0;
  for (let i = 1; i <= 200; i++) {
    const v = motion.E.ui(i / 200);
    assert.ok(v >= prev - 1e-12 && v <= 1 + 1e-12, 'monotone, never past 1');
    prev = v;
  }
  assert.equal(motion.E.world(0), 0);
  assert.equal(motion.E.world(1), 1);
  assert.equal(motion.E.world(0.5), 0.5);
  assert.ok(motion.E.world(0.1) < 0.1 && motion.E.world(0.9) > 0.9, 'slow out, slow in');
  // the old curves are still there
  for (const k of ['linear', 'inOut', 'in', 'out', 'spring', 'glide', 'slam']) assert.equal(typeof (motion.E as Record<string, unknown>)[k], 'function');
});

test('frame(): the iso camera has no near or far, so depth layers and focus are errors; a lens shot stacks them; no grid, no boil', async () => {
  const { core, scope, motion, seams, lens } = await kit();
  scope('fm-', 'paper');
  const parts = { bg: '<g id="BG"></g>', mid: '<g id="MID"></g>', fg: '<g id="FG"></g>' };
  const camera = { x: 100, y: -40, zoom: 1.2 };
  // the orthographic iso camera: no parallax layers, no depth of field
  assert.throws(() => motion.frame(2, { camera }, parts), /an isometric frame has no near or far \(the iso camera is orthographic\)/);
  assert.match(motion.depthProblems({}, parts)[0], /no \{ bg, mid, fg \} parallax layers/);
  assert.match(motion.depthProblems({ focus: 'fg' }, ['<g></g>'])[0], /no depth of field/);
  assert.deepEqual(motion.depthProblems({}, ['<g></g>']), []);
  // a perspective shot: the stack in order under one framing (no speeds of their own)
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100] });
  const svg = motion.frame(2, { camera, lens: P }, parts);
  const one = core.cameraTransform(core.cam(camera), 540, 960);
  assert.equal(svg.split(`transform="${one}"`).length, 2, 'one framing for the whole stack');
  const order = ['BG', 'MID', 'FG'].map((x) => svg.indexOf(x));
  assert.ok(order[0] < order[1] && order[1] < order[2]);
  assert.ok(!/data-blur|feGaussianBlur stdDeviation="12"/.test(svg), 'no layer blur: depth of field is per object (lens.render)');
  assert.throws(() => motion.frame(0, { lens: P }, { mid: '', front: 'x' } as never), /"front" is not a depth layer/);
  // No grid, no boil: the frame is the same at any t for the same camera.
  assert.ok(!/gridmask|gridfade/.test(svg));
  assert.equal(motion.frame(0.1, { camera }, ['<g></g>']), motion.frame(0.733, { camera }, ['<g></g>']));
  // Old frames: an array (or a string) is one picture; cell and oy are accepted.
  const flat = motion.frame(1, { camera: { zoom: 1.1 }, pivot: [480, 1100], cell: 108, oy: 30 } as never, ['<g id="A"></g>', '<g id="B"></g>']);
  assert.ok(flat.includes(`<g transform="${core.cameraTransform(core.cam({ zoom: 1.1 }), 480, 1100)}"><g id="A"></g><g id="B"></g></g>`));
  // Seams still wrap the whole world.
  const whip = seams.whipOut(1, 1.05, { dir: -1 });
  const seamed = motion.frame(1, { camera }, ['<g id="W"></g>'], whip);
  assert.ok(seamed.indexOf('filter="url(#fm-whip)"') < seamed.indexOf('id="W"'));
  assert.ok(clean(svg) && clean(seamed));
  // the old constants still compile
  assert.deepEqual(motion.PARALLAX, { bg: 0.35, mid: 1, fg: 1.8 });
  assert.equal(typeof motion.layerCamera, 'function');
});

test('shotFrame: a perspective shot may pass its stack through; on the iso camera it is refused; a shot never adds a layer', async () => {
  const { core, scope, shots, motion, lens } = await kit();
  scope('sf-', 'paper');
  const list = [{ at: 0, kind: 'wide', on: [540, 1100] }, { at: 3, kind: 'close', on: [600, 1000] }];
  const stack = () => ({ bg: '<g id="BG"></g>', mid: '<g id="MID"></g>', fg: '<g id="FG"></g>' });
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100] });
  const svg = shots.shotFrame(3.5, list, stack, { lens: P });
  assert.match(svg, /data-layer="bg"/);
  const cam = shots.shotCamera(list[1], 0.5, Infinity);
  assert.ok(svg.includes(core.cameraTransform(core.cam(cam), 540, 960)), 'the shot camera frames the whole stack');
  assert.match(svg, /bandwash/, 'a close shot still washes the caption band');
  assert.throws(() => shots.shotFrame(3.5, list, stack), /isometric frame has no near or far/);
  assert.throws(() => shots.shotFrame(1, list, () => ({ world: '<g></g>', front: '<g></g>' }) as never), /a shot never adds a foreground layer/);
  assert.ok(shots.shotFrame(1, list, () => ['<g></g>']).includes('<g transform='), 'arrays still work');
  assert.deepEqual(shots.validateShots(list, 6.5), []);
  void motion;
});

// ── lens.js: the perspective camera ─────────────────────────────────────────

test('lens projects centimetres in perspective: the target at the centre, nearer is bigger, scaleAt = focal / depth', async () => {
  const { lens } = await kit();
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100], fov: 40 });
  const [cx, cy, d] = P(0, 0, 100);
  assert.ok(near(cx, 540) && near(cy, 960) && near(d, 500));
  assert.ok(near(P.focal, 960 / Math.tan((20 * Math.PI) / 180)));
  assert.ok(near(P.scaleAt(0, 0, 100), P.focal / 500));
  // a 72 cm critter: twice as near, twice as tall on screen
  const tall = (y: number) => P(0, y, 0)[1] - P(0, y, 72)[1];
  assert.ok(near(tall(-250), 2 * tall(0), 1e-6));
  assert.ok(P(50, 0, 100)[0] > 540, 'x runs right');
  assert.ok(P(0, 0, 150)[1] < 960, 'z runs up');
  assert.ok(near(P.dist(0, 0, 100), 500));
  assert.ok(P.facing([0, 0, 100], [0, -1, 0]) && !P.facing([0, 0, 100], [0, 1, 0]), 'back faces are culled');
  // the key light comes from above, the camera's right, in front
  assert.ok(P.key[2] > 0.5 && light_dot(P.key, P.right) > 0 && light_dot(P.key, P.fwd) < 0);
  // roll turns the picture
  const rolled = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100], roll: 90 });
  assert.ok(Math.abs(rolled(50, 0, 100)[0] - 540) < 1e-6 && rolled(50, 0, 100)[1] !== 960);
  assert.throws(() => lens.lens({ pos: [0, 0, 500], target: [0, 0, 0] }), /straight up or down/);
});
const light_dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('camera moves: push, dolly, crane, orbit and zoom, eased in-world (E.world) over their time', async () => {
  const { lens, motion } = await kit();
  const start = { pos: [0, -500, 100], target: [0, 0, 100], fov: 40 };
  const push = [{ at: 1, dur: 4, kind: 'push', by: 200 }];
  assert.deepEqual(lens.cameraAt(0.5, start, push).pos, [0, -500, 100], 'before the move');
  assert.ok(near(lens.cameraAt(5, start, push).pos[1], -300), 'pushed 200 cm toward the target');
  assert.ok(near(lens.cameraAt(2, start, push).pos[1], -500 + 200 * motion.E.world(0.25)), 'eased in-world');
  assert.deepEqual(lens.cameraAt(5, start, push).target, [0, 0, 100], 'a push keeps its subject');
  const dolly = lens.cameraAt(1, start, [{ at: 0, dur: 1, kind: 'dolly', by: 100 }]);
  assert.ok(near(dolly.pos[1], -400) && near(dolly.target[1], 100));
  const crane = lens.cameraAt(1, start, [{ at: 0, dur: 1, kind: 'crane', by: 50 }]);
  assert.ok(near(crane.pos[2], 150) && near(crane.target[2], 150));
  const orbit = lens.cameraAt(1, start, [{ at: 0, dur: 1, kind: 'orbit', deg: 90 }]);
  assert.ok(near(Math.hypot(orbit.pos[0], orbit.pos[1]), 500, 1e-6) && near(orbit.pos[0], 500, 1e-6), 'circles the target');
  assert.ok(near(lens.cameraAt(1, start, [{ at: 0, dur: 1, kind: 'zoom', fov: 30 }]).fov, 30));
  const pan = lens.cameraAt(1, start, [{ at: 0, dur: 1, kind: 'pan', deg: 90 }]);
  assert.ok(near(pan.target[0], -500, 1e-6) && near(pan.pos[1], -500), 'a pan turns on the spot');
  assert.throws(() => lens.cameraAt(1, start, [{ at: 0, dur: 1, kind: 'whoosh' }]), /unknown camera move/);
});

test('depth: things are drawn far to near by their real distance from the lens, and blur by their distance from the focus', async () => {
  const { lens, scope } = await kit();
  scope('dp-', 'paper');
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100] });
  const items = [
    { at: [0, -200, 50], svg: '<g id="NEAR"></g>' },
    { at: [0, 300, 50], svg: '<g id="FAR"></g>' },
    { at: [200, 0, 50], svg: '<g id="MIDDLE"></g>' },
  ];
  assert.deepEqual(lens.byDistance(P, items).map((it: { svg: string }) => it.svg.match(/id="(\w+)"/)![1]), ['FAR', 'MIDDLE', 'NEAR']);
  const svg = lens.render(P, { env: [{ svg: '<g id="FLOOR"></g>', sharp: true }], items, focus: P.dist(200, 0, 50) });
  const at = (k: string) => svg.indexOf(`id="${k}"`);
  assert.ok(at('FLOOR') < at('FAR') && at('FAR') < at('MIDDLE') && at('MIDDLE') < at('NEAR'));
  // the focused thing is sharp; the near one blurs more than the far one
  const blurOf = (k: string) => Number(svg.slice(0, at(k)).match(/data-blur="([\d.]+)"[^>]*><g $/)?.[1] ?? 0);
  assert.equal(blurOf('MIDDLE'), 0);
  assert.ok(blurOf('NEAR') > blurOf('FAR') && blurOf('FAR') > 0, `${blurOf('NEAR')} vs ${blurOf('FAR')}`);
  // dofBlur: zero at the focus, growing as things come toward the lens, tending to the aperture far away
  assert.equal(lens.dofBlur(500, 500), 0);
  assert.ok(lens.dofBlur(250, 500) > lens.dofBlur(1000, 500));
  assert.ok(lens.dofBlur(1e9, 500, { aperture: 7 }) < 7.0001);
  assert.equal(lens.dofBlur(10, 500, { max: 26 }), 26);
  // a rack focus is the focus distance animated: the near thing sharp first, the far one after
  const rack = (f: number) => [lens.dofBlur(300, f), lens.dofBlur(800, f)];
  assert.ok(rack(300)[0] === 0 && rack(300)[1] > 0 && rack(800)[1] === 0 && rack(800)[0] > 0);
  assert.equal(lens.render(P, { items, focus: null }).includes('data-blur'), false, 'no focus, no depth of field');
});

test('solids through the lens: back faces culled, shaded by the rig; an open box keeps its contents inside; a critter is true size for its distance', async () => {
  const { lens, scope } = await kit();
  scope('sl-', 'paper');
  const P = lens.lens({ pos: [150, -500, 140], target: [40, 30, 90] });
  const R = lens.rig(P, { ground: 'paper' });
  const b = lens.box(P, [0, 0, 0], [76, 72, 90], 'paper', R);
  assert.deepEqual(Object.keys(b.faces).sort(), ['n1', 'u1', 'v0'], 'top, right and front: the three faces turned to the lens');
  assert.ok(!('n1' in lens.box(P, [0, 0, 0], [76, 72, 178], 'paper', R).faces), 'a top above the lens is not seen');
  assert.ok(clean(b.svg));
  // the lit top is lighter than the side turned from the key
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  assert.ok(lum(lens.shade('paper', [0, 0, 1], [0, 0, 0], R)) > lum(lens.shade('paper', [-1, 0, 0], [0, 0, 0], R)));
  // in the dark, a face no light reaches is near black
  const dark = lens.rig(P, { ground: 'stage', ambient: 0.03 });
  assert.ok(lum(lens.shade('paper', [0, -1, 0], [0, 0, 0], dark)) < 3 * 0x30);
  const ob = lens.openBox(P, [0, 0, 0], [76, 72, 178], 'paper', R, { open: '-y', from: 68, to: 173, contents: '<g id="CARTON"></g>' });
  assert.deepEqual(ob.opening, [[4, 0, 68], [72, 0, 68], [72, 0, 173], [4, 0, 173]]);
  const clip = ob.svg.match(/<clipPath id="(sl-ox-[a-z0-9]+)">/)![1];
  assert.ok(ob.svg.indexOf(`clip-path="url(#${clip})"`) < ob.svg.indexOf('CARTON'), 'the contents are clipped to the opening');
  const cy = lens.cylinder(P, [20, 20, 0], 10, 30, 'yellow', R);
  assert.ok(clean(cy) && /linearGradient/.test(cy));
  const h = lens.hinge([0, 0, 64], { width: 76, height: 112, deg: 90 });
  assert.ok(near(h.edge[0], 0, 1e-9) && near(h.edge[1], -76, 1e-9), 'a door swung 90° toward the room');
  const cr = lens.critterAt(P, 120, -40, 0, { who: 'snacker' }, R);
  assert.ok(near(cr.s, (P.scaleAt(120, -40, 0) * 72) / 142));
  assert.equal((cr.svg.match(/data-who="snacker"/g) ?? []).length, 1, 'its light and shadow copies are not a second critter');
  const far = lens.critterAt(P, 120, 400, 0, {}, R);
  assert.ok(far.s < cr.s, 'farther, smaller');
  const art = lens.faceArt(P, [0, 0, 100], [10, 0, 0], [0, 0, -10], '<rect width="10" height="10"></rect>', { cells: 2 });
  assert.equal((art.match(/<clipPath/g) ?? []).length, 4, 'a 2 × 2 piecewise map');
});

// ── light.js: physically motivated light ────────────────────────────────────

test('light through an aperture: irradiance falls off with distance, never reaches what the source body hides; the spill fans out', async () => {
  const { light, lens, scope } = await kit();
  scope('sp-', 'stage');
  const aperture = [[4, 0, 68], [72, 0, 68], [72, 0, 173], [4, 0, 173]];
  const L = { pos: [38, 40, 166], level: 1, reach: 170, color: 'warm', aperture };
  assert.equal(light.throughAperture(L.pos, [38, -100, 0], aperture), true);
  assert.equal(light.throughAperture(L.pos, [200, 40, 50], aperture), false, 'beside the fridge: its body is in the way');
  const up = [0, 0, 1];
  const near1 = light.irradiance(L, [40, -60, 0], up);
  const far1 = light.irradiance(L, [40, -300, 0], up);
  assert.ok(near1 > far1 && far1 > 0, `${near1} > ${far1}`);
  assert.equal(light.irradiance(L, [150, 30, 50], [0, -1, 0]), 0, 'the counter behind the fridge front stays dark');
  assert.equal(light.irradiance({ ...L, level: 0 }, [40, -60, 0], up), 0);
  assert.equal(light.irradiance(L, [40, -60, 0], [0, 0, -1]), 0, 'a face turned away gets nothing');
  const P = lens.lens({ pos: [150, -520, 100], target: [56, 30, 104], fov: 40 });
  const sp = light.spill(P, L);
  assert.equal(sp.poly.length, 4);
  // the pool starts in front of the opening and fans out away from the fridge
  const d = (q: number[]) => Math.hypot(q[0] - 38, q[1] - 40);
  assert.ok(d(sp.poly[2]) > d(sp.poly[1]) && d(sp.poly[3]) > d(sp.poly[0]), 'the far edge is farther from the light');
  assert.ok(Math.hypot(sp.poly[2][0] - sp.poly[3][0], sp.poly[2][1] - sp.poly[3][1]) > Math.hypot(sp.poly[0][0] - sp.poly[1][0], sp.poly[0][1] - sp.poly[1][1]), 'it widens');
  // its color falls off along the pool
  const ops = [...sp.svg.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ops[0] > ops[ops.length - 1] && ops[ops.length - 1] === 0);
  assert.equal(light.spill(P, { ...L, level: 0 }).svg, '');
});

test('castShadow points away from the light; veil and wash keep the cast tags single', async () => {
  const { light, scope } = await kit();
  scope('cs-', 'paper');
  const centroid = (poly: number[][]) => poly.reduce((a, q) => [a[0] + q[0] / poly.length, a[1] + q[1] / poly.length], [0, 0]);
  // a point light up and to the left: the shadow goes right
  const s1 = light.castShadow({ x: 100, y: 0, r: 20 }, { pos: [0, 0, 200] }, { height: 72 });
  const c1 = centroid(s1);
  assert.ok(c1[0] > 100 && Math.abs(c1[1]) < 1e-6, `${c1}`);
  assert.ok(s1.every((q: number[]) => q[2] === 0), 'on the floor');
  // a directional light from the front (toward −y): the shadow goes back (+y)
  const s2 = light.castShadow([[0, 0], [10, 0], [10, 10], [0, 10]], { dir: [0, -1, 1] }, { height: 50 });
  assert.ok(centroid(s2)[1] > 5);
  // longer for a lower light
  const len = (p: number[][]) => Math.max(...p.map((q) => q[0]));
  assert.ok(len(light.castShadow({ x: 100, y: 0, r: 20 }, { pos: [0, 0, 120] }, { height: 72 })) > len(s1));
  // a light low behind a thing never streaks across the room: at most 2.4× its height
  const low = light.castShadow({ x: 0, y: 0, r: 10 }, { pos: [-30, 0, 80] }, { height: 72 });
  assert.ok(Math.max(...low.map((q: number[]) => q[0])) <= 10 + 72 * 2.4 + 1e-6);
  const body = '<g data-who="hero" data-look="orange||"><rect width="10" height="10"></rect></g>';
  for (const svg of [light.veil(body, { level: 0.5 }), light.wash(body, { level: 0.4 }), light.rim(body)]) assert.ok(!/data-who|data-look/.test(svg));
  assert.equal(light.veil(body, { level: 0 }), '');
});

test('lit(): one drawing, one filter: exposure, a tint and rims, and never a blend mode', async () => {
  const { light, scope } = await kit();
  scope('lt1-', 'stage');
  const body = '<g data-who="hero" data-look="orange||"><rect width="10" height="10"></rect></g>';
  const svg = light.lit(body, { gain: 0.4, tint: 'warm', tintLevel: 0.5, rims: [{ side: 'left', color: 'warm', width: 6, level: 0.8 }, { side: 'right', color: 'cool', width: 4, level: 0.3 }] });
  assert.equal((svg.match(/data-who="hero"/g) ?? []).length, 1, 'the critter once');
  assert.equal((svg.match(/<filter/g) ?? []).length, 1, 'one filter');
  assert.match(svg, /<feColorMatrix in="SourceGraphic" type="matrix" values="([\d.]+) 0 0 0 0 {2}0 ([\d.]+) 0 0 0 {2}0 0 ([\d.]+) 0 0/);
  const [r, gg, b] = svg.match(/values="([\d.]+) 0 0 0 0 {2}0 ([\d.]+) 0 0 0 {2}0 0 ([\d.]+)/)!.slice(1).map(Number);
  assert.ok(r < 1 && r > b && gg > b, 'darker than studio light, and warm');
  assert.equal((svg.match(/<feMergeNode/g) ?? []).length, 3, 'the lit drawing and two rims');
  assert.equal(light.lit(body, { gain: 1 }), body, 'studio light: the drawing as drawn');
  for (const s2 of [svg, light.wash(body), light.glow(0, 0, 10), light.lightWedge({ from: [[0, 0], [1, 0]], to: [[0, 9], [9, 9]] }), light.glowSign('A', 0, 0)]) assert.ok(!/mix-blend-mode/.test(s2), 'no blend modes (HyperFrames falls back to screenshots)');
});

// ── Framing and orange in lens shots (hx-4.1) ────────────────────────────────

test('framingProblems: the shot\'s subject is whole inside the safe area at the shot\'s rest poses; other critters never flagged', async () => {
  const { lens, motion, scope } = await kit();
  scope('fr-', 'paper');
  assert.deepEqual(lens.SAFE, { x0: 96, x1: 940, y0: 570, y1: 1600 });
  const focus = (box: number[], who = 'carton') => ({ kind: 'focus', who, box, raw: box });
  const critter = (box: number[]) => ({ kind: 'critter', who: 'hero', box, raw: box });
  // a critter cut by the edge is fine (close shots crop; every critter is drawn in every shot)
  assert.deepEqual(lens.framingProblems([{ t: 0, boxes: [focus([300, 800, 360, 900]), critter([900, 900, 1300, 1400])] }]), []);
  // the subject cut at a rest pose (the end of the move) is an error, once
  const run = [0, 1, 2, 3, 4].map((t) => ({ t, boxes: [focus(t < 4 ? [300, 800, 360, 900] : [1050, 800, 1110, 900])] }));
  const cut = lens.framingProblems(run);
  assert.equal(cut.length, 1);
  assert.match(cut[0], /the subject "carton" is cut by the right edge of the frame at 4\.00s/);
  // mid-move only: not a rest pose
  const mid = [0, 1, 2, 3, 4].map((t) => ({ t, boxes: [focus(t === 2 ? [1050, 800, 1110, 900] : [300, 800, 360, 900])] }));
  assert.deepEqual(lens.framingProblems(mid), []);
  assert.match(lens.framingProblems([{ t: 1, boxes: [focus([400, 500, 600, 700], 'sign')] }])[0], /the subject "sign" leaves the safe area .*above y 570 \(the caption band holds only background\)/);
  // wholly off screen: ignored
  assert.deepEqual(lens.framingProblems([{ t: 0, boxes: [focus([1200, 800, 1300, 900])] }]), []);
  // with shots: each shot's subject is the focal under its `on` point, checked at its first and last sample
  const shots = [{ at: 0, kind: 'wide', on: [330, 850] }, { at: 2, kind: 'close', on: [700, 1000] }];
  const two = [0, 1, 2, 3].map((t) => ({ t, boxes: [focus([300, 800, 360, 900], 'jar'), focus(t >= 2 ? [900, 950, 1000, 1050] : [650, 950, 750, 1050], 'keeper')] }));
  const p2 = lens.framingProblems(two, { shots });
  assert.equal(p2.length, 1);
  assert.match(p2[0], /the subject "keeper" leaves the safe area at 2\.00s \(shot 2, close\)/);
  // from a lens frame's SVG: the boxes critterAt and focal() carry, through the frame's 2D framing
  const P = lens.lens({ pos: [110, -700, 95], target: [95, 30, 92], fov: 40 });
  const R = lens.rig(P, { ground: 'paper' });
  const cr = lens.critterAt(P, 140, -20, 0, { who: 'snacker' }, R);
  const fo = lens.focal(P, [33, 30, 98], [9.5, 9.5, 26], '<g></g>', { name: 'carton' });
  // a frame that passes no { lens }: render()'s mark says it is a lens picture
  const plain = motion.frame(0, {}, [lens.render(P, { items: [{ at: [140, -20, 36], svg: cr.svg }, { at: [38, 35, 110], svg: fo }] })]);
  assert.match(plain, /data-lens="/);
  const boxes = lens.framedBoxes(plain);
  assert.deepEqual(boxes.map((b: { kind: string; who: string }) => `${b.kind}:${b.who}`).sort(), ['critter:snacker', 'focus:carton']);
  const zoomed = lens.framedBoxes(motion.frame(0, { camera: { zoom: 2 }, pivot: [540, 960] }, [lens.render(P, { items: [{ at: [140, -20, 36], svg: cr.svg }] })]));
  assert.ok(near(zoomed[0].box[0], 540 + 2 * (cr.box[0] - 540), 0.02), 'a 2D zoom on the lens shot is applied');
  assert.ok(near(zoomed[0].raw[0], cr.box[0], 0.01), 'raw: as the lens drew it');
  assert.deepEqual(lens.framingProblems([{ t: 0, svg: plain }]), []);
  // only critters in view are on screen (try's crowd check)
  assert.deepEqual(lens.visibleCritters(plain), ['snacker']);
  assert.deepEqual(lens.visibleCritters(motion.frame(0, { camera: { x: 2000 } }, [lens.render(P, { items: [{ at: [140, -20, 36], svg: cr.svg }] })])), []);
  // an iso frame has no lens: skipped
  assert.equal(lens.framedBoxes(motion.frame(0, {}, ['<g></g>'])), null);
  assert.equal(lens.visibleCritters(motion.frame(0, {}, ['<g></g>'])), null);
});

test('orangeProblems: orange is only the hero\'s and the one focal\'s in a lens shot', async () => {
  const { lens, motion, scope } = await kit();
  scope('or-', 'paper');
  const P = lens.lens({ pos: [110, -700, 95], target: [95, 30, 92], fov: 40 });
  const R = lens.rig(P, { ground: 'paper' });
  const pot = lens.cylinder(P, [150, -300, 100], 10, 14, 'orange', R);
  assert.match(pot, /^<g data-tone="orange">/, 'an orange solid is marked');
  assert.ok(!/data-tone/.test(lens.cylinder(P, [150, -300, 100], 10, 14, 'lilac', R)));
  assert.ok(lens.isOrange('orange') && lens.isOrange('#FF5E1A') && !lens.isOrange('teal'));
  const shot = (...parts: string[]) => [{ t: 1, svg: motion.frame(1, { lens: P }, parts) }];
  assert.match(lens.orangeProblems(shot(pot))[0], /1 orange solid is drawn at 1\.00s that is neither the hero nor the focal: .*EX3-139/);
  const carton = lens.box(P, [33, 30, 98], [9.5, 9.5, 19], 'orange', R).svg;
  assert.deepEqual(lens.orangeProblems(shot(lens.focal(P, [33, 30, 98], [9.5, 9.5, 19], carton, { name: 'carton' }))), [], 'the focal may be orange');
  assert.deepEqual(lens.orangeProblems(shot(lens.critterAt(P, 140, -20, 0, { who: 'hero', body: 'orange' }, R).svg)), [], 'the hero critter is CAST\'s check');
  const two = shot(lens.focal(P, [33, 30, 98], [9.5, 9.5, 19], carton, { name: 'a' }), lens.focal(P, [53, 30, 98], [9.5, 9.5, 19], carton, { name: 'b' }));
  assert.match(lens.orangeProblems(two)[0], /2 orange focals at 1\.00s: exactly one focal per beat carries the orange/);
  assert.deepEqual(lens.orangeProblems([{ t: 1, svg: motion.frame(1, {}, [pot]) }]), [], 'iso frames: skipped');
});

test('try reports a lens frame whose subject is cut by the frame edge, and a stray orange solid; a cropped critter is fine', () => {
  const KIT = path.join(process.cwd(), 'explainers', 'world-kit');
  const SFX = path.join(process.cwd(), 'explainers', 'design', 'sfx');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-lens-'));
  fs.cpSync(KIT, path.join(root, 'assets', 'kit'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'sfx'), { recursive: true });
  for (const file of ['riser.mp3', 'impact-bass-1.mp3']) fs.copyFileSync(path.join(SFX, file), path.join(root, 'assets', 'sfx', file));
  fs.symlinkSync(SFX, path.join(root, 'assets', 'sfx-library'), 'dir');
  fs.cpSync(path.join(process.cwd(), 'explainers', 'smoke', 'fixture'), root, { recursive: true });
  const frame = (x: number, potTone: string) => [
    "import { scope } from '../kit/draw.js';",
    "import { frame } from '../kit/motion.js';",
    "import * as K from '../kit/lens.js';",
    "const START = { pos: [110, -700, 95], target: [95, 30, 92], fov: 40 };",
    `const aim = K.lens(START)(${x + 6}, 6, 70).slice(0, 2);`,
    "export const shots = [{ at: 0, kind: 'wide', on: aim }, { at: 3.6, kind: 'close', on: aim, push: 1.08 }];",
    'export default {',
    "  ground: 'stage',",
    '  shots,',
    '  draw(t) {',
    "    scope('l2-', 'stage');",
    "    const P = K.lens(K.cameraAt(t, START, [{ at: 0, dur: 4, kind: 'push', by: 90 }]));",
    '    const R = K.rig(P);',
    `    const cr = K.critterAt(P, 300, -20, 0, { who: 'writer', body: 'ink' }, R);`,
    `    const pot = K.cylinder(P, [60, -100, 90], 10, 14, '${potTone}', R);`,
    `    const jar = K.focal(P, [${x}, 0, 60], [12, 12, 20], K.box(P, [${x}, 0, 60], [12, 12, 20], 'yellow', R).svg, { name: 'jar' });`,
    '    return frame(t, {}, [K.render(P, { items: [{ at: [60, -100, 95], svg: pot }, { at: [300, -20, 36], svg: cr.svg }, { at: [' + x + ', 6, 70], svg: jar }] })]);',
    '  },',
    '};',
  ].join('\n');
  const run = () => spawnSync(process.execPath, ['assets/kit/try.mjs', 'all'], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'assets', 'frames', '02-scene.js'), frame(60, 'lilac'));
  const good = run();
  assert.deepEqual(JSON.parse(good.stdout).errors.filter((e: string) => /framing|orange:|kit:/.test(e)), [], good.stdout + '(the critter at x 300 is cropped by the frame: fine)');
  fs.writeFileSync(path.join(root, 'assets', 'frames', '02-scene.js'), frame(220, 'orange'));
  const bad = JSON.parse(run().stdout).errors as string[];
  assert.ok(bad.some((e) => /^02-scene: framing: the subject "jar" (is cut by the right edge|leaves the safe area)/.test(e)), bad.join('\n'));
  assert.ok(!bad.some((e) => /framing: .*"writer"/.test(e)), 'a critter is never flagged');
  assert.ok(bad.some((e) => /^02-scene: orange: 1 orange solid is drawn/.test(e)), bad.join('\n'));
  assert.ok(!bad.some((e) => /^0[13]-\w+: (framing|orange)/.test(e)), 'iso frames are skipped');
});

test('render() draws plain strings in place, marks its picture as a lens shot, and floor shadows are capped and fade', async () => {
  const { lens, scope } = await kit();
  scope('rs-', 'paper');
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100] });
  const svg = lens.render(P, {
    env: ['<g id="FLOOR"></g>', { svg: '<g id="WALL"></g>' }],
    items: [{ at: [0, 300, 50], svg: '<g id="FAR"></g>' }, '<g id="ON-FAR"></g>', { at: [0, -200, 50], svg: '<g id="NEAR"></g>' }, '<g id="ON-NEAR"></g>'],
    focus: 500,
  });
  const at = (k: string) => svg.indexOf(`id="${k}"`);
  assert.ok(at('FLOOR') >= 0 && at('FLOOR') < at('WALL') && at('WALL') < at('FAR'), 'env strings are drawn, in order');
  assert.ok(at('FAR') < at('ON-FAR') && at('ON-FAR') < at('NEAR') && at('NEAR') < at('ON-NEAR'), 'a string keeps its place after the item before it');
  assert.match(svg, /^<g data-lensed="1">/);
  const R = lens.rig(P, { ground: 'paper' });
  const sh = lens.floorShadow(P, [[0, 0, 0], [50, 0, 0], [50, 400, 0], [0, 400, 0]], { level: 0.95, from: [25, 0, 0] });
  assert.ok(Number(sh.match(/opacity="([\d.]+)"/)![1]) <= lens.SHADOW_MAX.paper, 'never near black on paper');
  assert.match(sh, /stop-opacity="0.1"/, 'fades along its length');
  assert.ok(!/<feGaussianBlur stdDeviation="[\d.]+"><\/feGaussianBlur><\/filter>/.test(sh.replace(/x="-50%"/g, '')) || /x="-50%"/.test(sh), 'a local filter region');
  void R;
});

test('try: outfit colors (no orange on a non-hero), the world\'s LENS/ROOM/LIGHTS run once, and a broken kit module is reported', async () => {
  const tryMod = await import('../explainers/world-kit/try.mjs');
  const cast = await import('../explainers/world-kit/cast.js');
  const { outfitColorProblems, lensWorldProblems } = tryMod as unknown as { outfitColorProblems: (c: unknown, k: unknown) => string[]; lensWorldProblems: (m: unknown) => Promise<string[]> };
  assert.deepEqual(outfitColorProblems({ hero: { body: 'orange', outfit: { top: { kind: 'tee', color: 'orange' } } }, nurse: { body: 'paper', outfit: { top: { kind: 'scrubs', color: 'teal' } } } }, cast), []);
  assert.match(outfitColorProblems({ nurse: { body: 'paper', outfit: { top: { kind: 'scrubs', color: 'teal' }, items: ['clipboard'], sleeves: 'orange' } } }, cast)[0] ?? '', /CAST\.nurse\.outfit draws orange/);
  assert.deepEqual(outfitColorProblems({ nurse: { body: 'ink', outfit: 'none' } }, cast), []);
  const { box, quad } = await import('../explainers/world-kit/lens.js');
  const good = await lensWorldProblems({
    STATES: { lamp: { start: 1, f4: 0 } },
    LIGHTS: (state: { lamp: number }) => ({ dirs: [], points: [{ pos: [0, 0, 200], level: state.lamp, reach: 100 }] }),
    ROOM: (P: (...a: number[]) => number[]) => [quad(P, [[0, 0, 0], [10, 0, 0], [10, 10, 0]], '#FBFAF6')],
    LENS: { jar: (P: never, R: never) => ({ at: [0, 0, 10], svg: box(P, [0, 0, 0], [10, 10, 20], 'yellow', R).svg }) },
  });
  assert.deepEqual(good, []);
  const bad = await lensWorldProblems({
    STATES: { lamp: { start: 1 } },
    LIGHTS: () => { throw new Error('no lamp'); },
    ROOM: () => 'not a list',
    LENS: { jar: () => ({ svg: '<g></g>' }), cup: () => { throw new Error('cup broke'); } },
  });
  assert.ok(bad.some((e) => /LIGHTS\(state\) threw: no lamp/.test(e)));
  assert.ok(bad.some((e) => /ROOM\(P, R, state\) must return the set builder's result/.test(e)));
  assert.ok(bad.some((e) => /LENS\.jar\(P, R, state, pose\) must return \{ at: \[x, y, z\], svg \}/.test(e)));
  assert.ok(bad.some((e) => /LENS\.cup\(P, R, state, pose\) threw: cup broke/.test(e)));
  // a kit module that fails to import is reported, not silently skipped
  const KIT = path.join(process.cwd(), 'explainers', 'world-kit');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-kitbroken-'));
  fs.cpSync(KIT, path.join(root, 'assets', 'kit'), { recursive: true });
  fs.cpSync(path.join(process.cwd(), 'explainers', 'smoke', 'fixture'), root, { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'kit', 'space.js'), 'export const = broken;');
  const out = spawnSync(process.execPath, ['assets/kit/try.mjs', 'world'], { cwd: root, encoding: 'utf8' });
  assert.match(out.stdout, /kit: assets\/kit\/space\.js failed to load/);
});

// ── Final pass (hx-4.1): set text, occlusion, near plane, quad shading, lens-only worlds ──

test('set text is background: bounds lets a room sign sit in the caption band or leave the frame, but not cover the focal', async () => {
  const { lens, scope } = await kit();
  const { textProblems } = await import('../explainers/world-kit/bounds.mjs');
  scope('st-', 'paper');
  const sign = { label: 'EMERGENCY', role: null, rect: [300, 300, 700, 360], box: null, set: true };
  const cut = { label: 'CARDIOLOGY', role: null, rect: [900, 800, 1200, 860], box: null, set: true };
  assert.deepEqual(textProblems([sign, cut]), [], 'a sign in the band, a sign off the edge: background');
  assert.match(textProblems([{ ...sign, set: false }]).join('|'), /"EMERGENCY" is in the caption band/);
  assert.match(textProblems([{ ...cut, set: false }]).join('|'), /"CARDIOLOGY" is cut off by the frame edge/);
  const focal = { focal: true, rect: [320, 290, 680, 380] };
  assert.match(textProblems([sign, focal]).join('|'), /"EMERGENCY" \(set text\) covers the focal/);
  const line = { label: 'the jar', role: null, rect: [310, 300, 690, 350], box: null };
  assert.ok(textProblems([sign, line]).some((e) => /"EMERGENCY" \(set text\) covers "the jar"/.test(e)));
  // the kit marks it: set() and every ROOM piece render() draws
  assert.equal(lens.set('<text>EXIT</text>'), '<g data-set="1"><text>EXIT</text></g>');
  assert.equal(lens.set(''), '');
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 100] });
  const svg = lens.render(P, { env: ['<text>EMERGENCY</text>'], items: [{ at: [0, 0, 0], svg: '<text>the jar</text>' }] });
  assert.match(svg, /<g data-set="1"><text>EMERGENCY<\/text><\/g>/);
  assert.ok(!/data-set="1"><text>the jar/.test(svg), 'an item is not set unless marked');
});

test('occlusion: a critter mostly hidden behind a nearer one, and a giant face outside a reaction shot', async () => {
  const { lens } = await kit();
  const cr = (who: string, box: number[], depth: number) => ({ kind: 'critter', who, box, raw: box, depth });
  const near1 = cr('a', [300, 900, 600, 1300], 300);
  const behind = cr('b', [350, 950, 640, 1320], 400);
  const p = lens.occlusionProblems([{ t: 0, boxes: [near1, behind] }]);
  assert.equal(p.length, 1);
  assert.match(p[0], /the critter "b" is \d+% hidden behind "a" at 0\.00s/);
  assert.deepEqual(lens.occlusionProblems([{ t: 0, boxes: [near1, cr('b', [560, 950, 860, 1320], 400)] }]), [], 'a little overlap is staging');
  assert.deepEqual(lens.occlusionProblems([{ t: 0, boxes: [near1, cr('b', [2000, 950, 2300, 1320], 200)] }]), [], 'off screen: ignored');
  const giant = cr('hero', [100, 400, 800, 1500], 120);
  assert.match(lens.occlusionProblems([{ t: 1, boxes: [giant] }])[0], /"hero" fills \d+% of the frame's width at 1\.00s: a giant face belongs to a close, an insert or a reaction shot/);
  assert.deepEqual(lens.occlusionProblems([{ t: 1, boxes: [giant] }], { shots: [{ at: 0, kind: 'reaction', on: [450, 700] }] }), []);
  // through the lens: critterAt carries its depth
  const { scope } = await kit();
  scope('oc-', 'paper');
  const P = lens.lens({ pos: [0, -500, 100], target: [0, 0, 60] });
  const R = lens.rig(P);
  const a = lens.critterAt(P, 0, -100, 0, { who: 'a' }, R);
  const b = lens.critterAt(P, 10, 0, 0, { who: 'b' }, R);
  assert.ok(a.dist < b.dist && /data-frame-depth="/.test(a.svg));
  const { frame } = await import('../explainers/world-kit/motion.js');
  const svg = frame(0, {}, [lens.render(P, { items: [{ at: a.at, svg: a.svg }, { at: b.at, svg: b.svg }] })]);
  assert.match(lens.occlusionProblems([{ t: 0, svg }]).join('|'), /"b" is \d+% hidden behind "a"/);
});

test('quad and box faces are clipped at the near plane; quad shades from the rig with { tones, n }', async () => {
  const { lens, scope } = await kit();
  scope('np-', 'stage');
  // an off-axis camera low over a long floor: the floor runs behind the lens
  const P = lens.lens({ pos: [0, 0, 120], target: [300, 400, 60], fov: 40 });
  const floor = [[-800, -800, 0], [800, -800, 0], [800, 800, 0], [-800, 800, 0]];
  const c = lens.clipNear(P, floor);
  assert.ok(c.world.length >= 3);
  assert.ok(c.world.every((q: number[]) => P(...q)[2] >= P.near), 'nothing behind the lens');
  const q = lens.quad(P, floor, '#2B2926');
  const pts = q.match(/points="([^"]+)"/)![1].split(' ').map((xy: string) => xy.split(',').map(Number));
  assert.ok(pts.every((xy: number[]) => xy.every(Number.isFinite) && Math.abs(xy[0]) < 1e6 && Math.abs(xy[1]) < 1e6));
  assert.equal(lens.quad(P, [[0, -50, 0], [10, -50, 0], [10, -60, 0]], '#2B2926'), '', 'wholly behind: nothing');
  // a box straddling the lens draws only what is in front
  const b = lens.box(P, [-50, -50, 0], [100, 100, 40], 'paper', lens.rig(P));
  assert.ok(clean(b.svg));
  // shaded quads: a floor darkens on the stage with the rest
  const dark = lens.rig(P, { ground: 'stage', ambient: 0.03 });
  const lightR = lens.rig(P, { ground: 'paper' });
  const fillOf = (svg: string) => svg.match(/fill="(#[0-9A-F]{6})"/)![1];
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  const qd = lens.quad(P, [[100, 100, 0], [200, 100, 0], [200, 200, 0], [100, 200, 0]], { tones: 'paper', n: [0, 0, 1], R: dark });
  const ql = lens.quad(P, [[100, 100, 0], [200, 100, 0], [200, 200, 0], [100, 200, 0]], { tones: 'paper', n: [0, 0, 1], R: lightR });
  assert.ok(!/object Object/.test(qd + ql));
  assert.ok(lum(fillOf(qd)) < lum(fillOf(ql)) / 2);
});

test('try world: an empty entity is fine; a lens-only world needs SIZES but no DRAWN', async () => {
  const tryMod = await import('../explainers/world-kit/try.mjs');
  const space = await import('../explainers/world-kit/space.js');
  const { lensWorldProblems, sizeLedgerProblems } = tryMod as unknown as { lensWorldProblems: (m: unknown) => Promise<string[]>; sizeLedgerProblems: (w: unknown, s: unknown) => string[] };
  assert.deepEqual(await lensWorldProblems({ LENS: { later: () => '', soon: () => ({ svg: '' }), gone: () => null } }), []);
  assert.match((await lensWorldProblems({ LENS: { bad: () => ({ svg: '<g></g>' }) } })).join('|'), /LENS\.bad\(P, R, state, pose\) must return \{ at/);
  const SIZES = { jar: { w: 10, d: 10, h: 20 } };
  const lensOnly = { ENTITIES: { jar: 'the cache' }, SIZES, CAST: {}, LENS: { jar: () => '' } };
  assert.deepEqual(sizeLedgerProblems(lensOnly, space), [], 'no DRAWN needed');
  assert.match(sizeLedgerProblems({ ...lensOnly, SIZES: { jar: { w: 10, d: 0, h: 20 } } }, space).join('|'), /SIZES\.jar\.d must be a positive number/);
  assert.match(sizeLedgerProblems({ ...lensOnly, SIZES: undefined }, space).join('|'), /must export SIZES/);
  const both = { ...lensOnly, jar: () => '<g></g>' };
  assert.match(sizeLedgerProblems(both, space).join('|'), /must export DRAWN/, 'an isometric drawing: DRAWN holds it to scale');
});

test('the new modules draw only in palette colors', async () => {
  const { core, scope, groundName, space, light, motion, shots, seams, lens } = await kit();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const kitDir = path.join(process.cwd(), 'explainers', 'world-kit');
  const allowed = new Set(Object.values(core.TOKENS).map((c) => String(c).toUpperCase()));
  for (const f of ['space.js', 'light.js', 'motion.js', 'shots.js']) {
    const hexes = fs.readFileSync(path.join(kitDir, f), 'utf8').match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
    for (const h of hexes) assert.ok(allowed.has(h.toUpperCase()), `${f} uses ${h}`);
  }
});
