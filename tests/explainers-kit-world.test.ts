/**
 * Explainers 4.2 world kit (builder D): exteriors, moods and the colour script, journeys, carried
 * elements, the cheated scale and the light pools on big surfaces. Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any = null;
async function kit(): Promise<any> {
  if (M) return M;
  await import('../explainers/world-kit/try.mjs').catch(() => null);
  M = {
    draw: await import('../explainers/world-kit/draw.js'),
    core: await import('../explainers/world-kit/core.js'),
    lens: await import('../explainers/world-kit/lens.js'),
    light: await import('../explainers/world-kit/light.js'),
    set: await import('../explainers/world-kit/set.js'),
    shots: await import('../explainers/world-kit/shots.js'),
    cast: await import('../explainers/world-kit/cast.js'),
  };
  return M;
}
const clean = (svg: string) => !/NaN|undefined|Infinity|\[object Object\]/.test(svg);

test('exteriors: at least six generic kinds, each a place with a ground, a sky, fixtures and staging spots, by day and at night', async () => {
  const { draw, lens: K, set: S, light: LI } = await kit();
  assert.ok(S.EXTERIOR_KINDS.length >= 6);
  for (const kind of ['street', 'shopfront', 'park', 'road', 'plaza', 'rooftop', 'dock']) assert.ok(S.EXTERIOR_KINDS.includes(kind), kind);
  for (const kind of S.EXTERIOR_KINDS) {
    assert.ok(S.EXTERIOR_ABOUT[kind] && S.EXTERIOR_VIEWS[kind]?.wide?.pos, `${kind} has its tells and a wide view`);
    for (const mood of ['day', 'night']) {
      draw.scope(`t-ext-${kind}-${mood}-`, LI.mood(mood).ground);
      const P = K.lens(S.EXTERIOR_VIEWS[kind].wide);
      const R = K.rig(P, { mood });
      const B = S.setBuilder(P, R, {});
      const res = B.exterior(kind, { seed: 2 });
      const set = B.done();
      const svg = K.render(P, { env: set.env, items: set.items });
      assert.ok(clean(svg), `${kind} ${mood} draws clean`);
      assert.ok(res.env.some((e: any) => e.part === 'sky') && res.env.some((e: any) => e.part === 'ground' || e.part === 'water'), `${kind}: sky and ground`);
      assert.ok(res.items.length >= 3 && res.items.every((it: any) => Array.isArray(it.bounds)), `${kind}: fixtures with world bounds`);
      assert.ok(res.tells.length >= 4, `${kind}: ${res.tells.join(', ')}`);
      assert.ok(Object.keys(res.spots).length >= 2 && Array.isArray(res.lanes.walk) && res.lanes.walk.length >= 2, `${kind}: spots and a walk lane`);
      assert.equal(set.meta.floor, true);
      assert.equal(set.meta.exterior, kind);
      assert.deepEqual(S.setProblems(set), [], `${kind}: nothing broken`);
      assert.deepEqual(S.setProblems(svg), [], `${kind}: read back from the drawn frame`);
      if (mood === 'night' && ['street', 'park', 'plaza', 'dock', 'shopfront'].includes(kind)) assert.ok(res.lights.length >= 1, `${kind}: its lamps light at night`);
    }
  }
  assert.throws(() => S.exterior(K.lens(S.EXTERIOR_VIEWS.park.wide), K.rig(K.lens(S.EXTERIOR_VIEWS.park.wide)), 'moon'), /kind must be one of street, shopfront/);
  // by day the street has no lamps lit; lamps: true lights them anyway
  const P = K.lens(S.EXTERIOR_VIEWS.street.wide);
  assert.equal(S.exterior(P, K.rig(P, { mood: 'day' }), 'street').lights.length, 0);
  assert.ok(S.exterior(P, K.rig(P, { mood: 'day' }), 'street', { lamps: true }).lights.length > 0);
  // signs are blank unless given: no topic text leaks into a place
  draw.scope('t-ext-sign-', 'paper');
  const plain = S.exterior(P, K.rig(P, { mood: 'day' }), 'street').env.map((e: any) => e.svg).join('');
  assert.ok(!/<text/.test(plain), 'no sign text by default');
  assert.match(S.exterior(P, K.rig(P, { mood: 'day' }), 'street', { signs: ['BAKERY'] }).env.map((e: any) => e.svg).join(''), />BAKERY</);
});

test('exteriors take the brief, their materials are kit materials, a ground below the frame is cut, not thrown to infinity', async () => {
  const { lens: K, set: S } = await kit();
  for (const m of ['asphalt', 'paving', 'cobbles', 'grass', 'gravel', 'sand', 'water', 'roofing']) assert.ok(S.MATERIALS[m], m);
  assert.deepEqual(S.setBriefProblems({ place: 'a harbour', exterior: 'dock', materials: { ground: 'planks' }, colorStory: ['teal-shade', 'paper-shade'] }), []);
  const P = K.lens({ pos: [0, -760, 175], target: [0, 1800, 60], fov: 50 });
  const guard = S.groundGuard(P, 0);
  assert.ok(guard > 100 && guard < 1000, `guard ${guard}`);
  // the frame's bottom edge on the ground sits just past the guard
  const bottom = K.worldAt(P, 540, 1920, 0);
  assert.ok(guard < bottom[1] - P.pos[1], 'the guard is nearer than the frame bottom');
  assert.equal(S.groundGuard(K.lens({ pos: [0, -500, 50], target: [0, 500, 400] }), 100), 0, 'a plane above the lens has no guard');
  const svg = S.surface(P, K.rig(P), [[-6000, 420, 0], [6000, 420, 0], [6000, -1500, 0], [-6000, -1500, 0]], 'planks', { n: [0, 0, 1], guard });
  const xs = [...svg.matchAll(/<path d="M (-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.abs(Number(m[1])));
  assert.ok(xs.every((x) => x < 60000), `no huge projected coordinates (max ${Math.max(...xs)})`);
});

test('moods: day, evening, night, dark; a world-fixed key; night and dark keep the cast readable', async () => {
  const { lens: K, light: LI } = await kit();
  assert.deepEqual(LI.MOOD_NAMES, ['day', 'evening', 'night', 'dark']);
  assert.throws(() => LI.mood('dusk'), /must be one of day, evening, night, dark/);
  const night = LI.mood('night');
  assert.equal(night.dark, true);
  assert.equal(night.ground, 'stage');
  assert.ok(night.stars && night.moon && night.lamps && night.windows === 'lit');
  assert.ok(night.critterFill > 0.3);
  assert.ok(Math.abs(Math.hypot(...night.key.dir) - 1) < 1e-9, 'unit key');
  assert.equal(LI.mood(night), night, 'a mood passes through');
  assert.equal(LI.mood('day', { ambient: 0.3 }).ambient, 0.3, 'overrides');
  for (const name of LI.MOOD_NAMES) assert.ok(LI.mood(name).sky.every((c: string) => /^#[0-9A-F]{6}$/.test(c)), `${name} sky is palette hex`);
  // the key is fixed in the world: two cameras looking opposite ways get the same light
  const A = K.rig(K.lens({ pos: [0, -500, 150], target: [0, 500, 100] }), { mood: 'evening' });
  const B = K.rig(K.lens({ pos: [0, 500, 150], target: [0, -500, 100] }), { mood: 'evening' });
  assert.deepEqual(A.dirs[0].dir, B.dirs[0].dir);
  assert.equal(A.mood.name, 'evening');
  assert.ok(A.dirs.some((d: any) => d.color === 'warm' && d !== A.dirs[0]), 'its rim from behind');
  // the old defaults are untouched without a mood
  const P = K.lens({ pos: [0, -500, 150], target: [0, 500, 100] });
  assert.deepEqual(K.rig(P, { ground: 'paper' }).dirs[0].dir, P.key);
  assert.equal(K.rig(P, { ground: 'stage' }).dirs.length, 0);
  // at night a critter far from any lamp still reads (its fill), and carries the cool rim
  const Rn = K.rig(P, { mood: 'night' });
  const c = K.critterAt(P, 0, 300, 0, { who: 'x' }, Rn);
  const gain = Number(c.svg.match(/feColorMatrix[^>]*values="([\d.]+)/)?.[1]);
  assert.ok(gain >= 0.3, `gain ${gain}`);
  assert.match(c.svg, /data-light="rim"/);
  // hazed fades far colors toward the mood's haze
  const near = LI.hazed('#202020', 100, 'day');
  const far = LI.hazed('#202020', 20000, 'day');
  assert.notEqual(near, far);
});

test('colourScript: a plan per frame that holds until it changes; names checked; a strip of colour keys', async () => {
  const { light: LI, draw } = await kit();
  draw.scope('t-cs-', 'paper');
  const cs = LI.colourScript({ 1: 'day', 4: { mood: 'evening', palette: ['teal-lit', 'paper-shade'], accent: 'yellow', note: 'the turn' }, 6: 'night' });
  assert.equal(cs.frames.length, 7);
  assert.deepEqual(cs.frames.map((f: any) => f.mood), ['day', 'day', 'day', 'evening', 'evening', 'night', 'night']);
  assert.deepEqual(cs.at(5).palette, ['teal-lit', 'paper-shade'], 'a palette holds too');
  assert.equal(cs.at(4).note, 'the turn');
  assert.equal(cs.at(5).note, null, 'a note belongs to its frame');
  assert.equal(cs.at(6).light.name, 'night');
  assert.equal(LI.colourScript(cs), cs, 'passes through');
  assert.deepEqual(cs.problems, []);
  const bad = LI.colourScript([{ frame: 2, mood: 'dusk' }, { frame: 3, palette: ['neon'] }, { frame: 9, mood: 'day' }]).problems.join('\n');
  for (const want of ['mood "dusk"', '"neon" is not a palette color', 'frame "9"']) assert.ok(bad.includes(want), `${want}\n${bad}`);
  const strip = cs.strip({ x: 0, y: 0, w: 700, h: 200 });
  assert.equal((strip.match(/<text /g) ?? []).length, 7);
  assert.ok(clean(strip));
});

test('journey by cut: leave through the door, cut to a wide of the new place, walk in; screen direction holds', async () => {
  const { lens: K, shots: S } = await kit();
  const J = S.journey({ id: 'home', at: [0, 0, 0], door: [300, 0, 0] }, { id: 'shop', at: [0, 200, 0], heading: [0, 1] }, { by: 'cut', dur: 4, traveller: 'hero' });
  assert.equal(J.by, 'cut');
  assert.deepEqual(J.shots.map((x: any) => [x.place, x.kind, x.subject]), [['home', 'medium', 'hero'], ['shop', 'wide', 'hero']]);
  assert.deepEqual(S.validateShots(J.shots, 4), []);
  assert.deepEqual(S.jumpCutProblems(J.shots, { duration: 4 }), [], 'a new place is a clean cut');
  assert.ok(J.cutAt > 1 && J.cutAt < 3);
  assert.equal(J.at(0.5).place, 'home');
  assert.equal(J.at(3.5).place, 'shop');
  assert.equal(J.at(3.99).walking, true);
  assert.deepEqual(J.at(4).pos, [0, 200, 0], 'arrives where it was going');
  // on screen it always moves left to right, in both places
  for (const [t0, t1] of [[0.4, 1.4], [2.4, 3.6]]) {
    const { shot } = S.shotAt(t0, J.shots);
    const P = K.lens(shot.camera);
    const a = P(...J.at(t0).pos);
    const b = P(...J.at(t1).pos);
    assert.ok(b[0] > a[0], `left to right in ${shot.place}`);
    assert.equal(J.at(t0).flip, false);
  }
  const L = S.journey({ id: 'a', at: [0, 0, 0] }, { id: 'b', at: [0, 0, 0] }, { side: 'left' });
  const P = K.lens(L.shots[0].camera);
  assert.ok(P(...L.at(1.5).pos)[0] < P(...L.at(0.3).pos)[0], 'side left: right to left');
  assert.equal(L.at(1).flip, true, 'faces the way it walks');
  assert.throws(() => S.journey('a', 'b', { by: 'teleport' }), /by must be 'cut' or 'travel'/);
});

test('journey by travel: a follow shot along the path keeps the traveller on its spot while the place slides past', async () => {
  const { lens: K, shots: S } = await kit();
  const path = [[-400, 0, 0], [400, 0, 0]];
  const J = S.journey('home', { id: 'shop', at: [0, 0, 0] }, { by: 'travel', via: { id: 'street', path }, dur: 5, traveller: 'hero', dist: 800 });
  assert.deepEqual(J.shots.map((x: any) => x.place), ['street', 'shop'], 'travel, then the arrival');
  const s0 = J.shots[0];
  assert.equal(s0.move.kind, 'follow');
  assert.deepEqual(S.cutProblems(J.shots), []);
  const len = J.cutAt;
  const spot = (t: number) => K.lens(S.shotLensAt(s0, t, len))(...J.at(t).pos)[0];
  const xs = [0.2, 1, 2, 2.8].map(spot);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 6, `the traveller holds its spot (${xs.map(Math.round)})`);
  assert.ok(xs[0] < 540, 'a third in from the trailing edge: looking room ahead');
  const fixed = [0, 300, 0];
  const bg = [0.2, 2.8].map((t) => K.lens(S.shotLensAt(s0, t, len))(...fixed)[0]);
  assert.ok(bg[0] - bg[1] > 300, 'the place slides past');
  // from behind: a track move, the traveller seen from its back
  const B = S.journey('a', 'b', { by: 'travel', via: { id: 'road', path: [[0, 0, 0], [0, 1500, 0]] }, camera: 'behind', arrive: false });
  assert.equal(B.shots.length, 1);
  assert.equal(B.shots[0].move.kind, 'track');
  assert.equal(B.at(1).view, 'back');
  const c = S.shotLensAt(B.shots[0], 4, 4);
  assert.ok(Math.abs(c.pos[1] - (B.shots[0].camera.pos[1] + 1500)) < 1e-6, 'the camera tracks the whole path');
});

test('carry: an element keeps its spot across a cut (lens to lens, lens to flat) and can morph world → mechanism', async () => {
  const { lens: K, shots: S, draw } = await kit();
  draw.scope('t-carry-', 'paper');
  const A = K.lens({ pos: [0, -500, 120], target: [0, 200, 60], fov: 40 });
  const c = S.carry('parcel', { from: { P: A, at: [20, 40, 0], size: [60, 44, 40] }, morph: 'world→mechanism', at: 0.1, dur: 0.6 });
  assert.equal(c.id, 'parcel');
  assert.ok(c.w > 40 && c.h > 30);
  // into another lens shot: where to build it so its base lands under the same spot
  const B = K.lens({ pos: [300, -400, 160], target: [100, 300, 40], fov: 36 });
  const into = S.carry('parcel', { from: { box: c.box }, to: { P: B, z: 0 } }).to;
  const q = B(...into.at);
  assert.ok(Math.abs(q[0] - c.center[0]) < 0.5 && Math.abs(q[1] - c.box[3]) < 0.5, 'its base under the same screen point');
  assert.ok(into.cm.h > 0 && into.scale > 0);
  // a flat frame: lensOnto draws the world look on the held box (its height and its centre)
  const { P: Pp } = S.lensOnto(c.box, [60, 44, 40]);
  const corners: number[][] = [];
  for (const x of [-30, 30]) for (const y of [-22, 22]) for (const z of [0, 40]) corners.push(Pp(x, y, z));
  const bb = [Math.min(...corners.map((v) => v[0])), Math.min(...corners.map((v) => v[1])), Math.max(...corners.map((v) => v[0])), Math.max(...corners.map((v) => v[1]))];
  assert.ok(Math.abs(bb[3] - bb[1] - c.h) < 1, `same height: ${bb[3] - bb[1]} vs ${c.h}`);
  assert.ok(Math.abs((bb[0] + bb[2]) / 2 - c.center[0]) < 1 && Math.abs((bb[1] + bb[3]) / 2 - c.center[1]) < 1, 'same centre');
  // the morph: world before, a wipe in between, mechanism after; always tagged with its box
  assert.deepEqual(c.mix(0), { world: 1, mechanism: 0, wipe: 0 });
  assert.deepEqual(c.mix(1), { world: 0, mechanism: 1, wipe: 1 });
  const looks = { world: () => '<rect data-look="w"/>', mechanism: () => '<rect data-look="m"/>' };
  assert.ok(c.draw(0, looks).includes('data-look="w"') && !c.draw(0, looks).includes('data-look="m"'));
  const mid = c.draw(0.4, looks);
  assert.ok(mid.includes('data-look="w"') && mid.includes('data-look="m"') && /clip-path/.test(mid), 'mid-wipe: both looks, clipped');
  assert.ok(c.draw(0.8, looks).includes('data-look="m"') && !c.draw(0.8, looks).includes('data-look="w"'));
  assert.deepEqual(S.carriedBoxes(mid).map((x: any) => x.id), ['parcel']);
  assert.deepEqual(S.carriedBoxes(mid)[0].box, c.box.map((v: number) => Math.round(v * 10) / 10));
  // from a drawn frame by its entity box; errors say what is missing
  const svg = `<g data-frame-kind="entity" data-frame-who="parcel" data-frame-box="10 20 110 220"></g>`;
  assert.deepEqual(S.carry('parcel', { from: { svg } }).box, [10, 20, 110, 220]);
  assert.throws(() => S.carry('x', {}), /from` is required/);
  assert.throws(() => S.carry('x', { from: { box: [0, 0, 1, 1] }, morph: 'sideways' }), /morph is/);
  assert.equal(S.carry('x', { from: { box: [0, 0, 10, 10] } }).draw(0.5, looks).includes('data-look="w"'), true, 'no morph: the world look, tagged');
});

test('cheated scale: held props, dressing, solids and any custom piece draw bigger about their base; face checks still hold', async () => {
  const { lens: K, set: S, cast: C, core } = await kit();
  const phone = C.propOf({ kind: 'phone', scale: 'cheat' });
  const real = C.propOf('phone');
  assert.ok(phone.k > 1.5 && Math.abs(phone.box.h - real.box.h * phone.k) < 1e-9);
  assert.equal(C.propOf({ kind: 'phone', scale: 2 }).k, 2);
  assert.throws(() => C.propOf({ kind: 'phone', scale: 'big' }), /'cheat' or a positive number/);
  const big = C.critter(0, 0, { hold: { r: { kind: 'phone', scale: 'cheat' } } });
  assert.match(big, /data-held="phone"[^>]*data-held-scale="1\.85"|data-held-scale="1\.85"[^>]*data-held="phone"/);
  const hb = C.heldBoxes(0, 0, { hold: { r: { kind: 'phone', scale: 'cheat' } } }).r.box;
  const hr = C.heldBoxes(0, 0, { hold: { r: 'phone' } }).r.box;
  assert.ok(hb[3] - hb[1] > (hr[3] - hr[1]) * 1.5, 'the held box grows with it');
  // a prop cheated so big it reaches the face is still caught (breakage, not taste)
  const near = { arms: { l: [-74, -50], r: [50, 0] }, rig: true, hold: { r: { kind: 'card', scale: 4 } } };
  assert.ok(C.riggedProblems(near).some((p: any) => p.code === 'prop-on-face'), 'a huge prop over the face is flagged');
  assert.ok(!C.riggedProblems({ ...near, hold: { r: 'card' } }).some((p: any) => p.code === 'prop-on-face'), 'the same card at true size is clear');
  assert.ok(Math.abs(C.heldScale(12, 142, 'cheat') - C.heldScale(12, 142) * core.propScale('cheat', 12)) < 1e-12);
  // set pieces
  const P = K.lens({ pos: [0, -500, 140], target: [0, 100, 50], fov: 40 });
  const R = K.rig(P);
  const t1 = S.thing(P, R, 'mug', [0, 0, 0], 'teal-lit');
  const t2 = S.thing(P, R, 'mug', [0, 0, 0], 'teal-lit', 1, { scale: 'cheat' });
  assert.equal(t2.scale, core.CHEAT.max);
  assert.notEqual(t1.svg, t2.svg);
  assert.deepEqual(S.cheatBox({ at: [0, 0, 0], size: [10, 10, 10], scale: 2 }), { at: [-5, -5, 0], size: [20, 20, 20] });
  const B = S.setBuilder(P, R, {});
  B.solid({ at: [0, 0, 0], size: [10, 10, 10], scale: 3 });
  assert.deepEqual(B.done().items[0].bounds, [[-10, -10, 0], [20, 20, 30]]);
  // any custom piece: scaledLens grows it about its base, standing where it stood
  const Pk = K.scaledLens(P, [0, 0, 0], 2);
  const base = P(0, 0, 0);
  const baseK = Pk(0, 0, 0);
  assert.ok(Math.abs(base[0] - baseK[0]) < 1e-9 && Math.abs(base[1] - baseK[1]) < 1e-9);
  const top = P(0, 0, 20)[1];
  assert.ok(Math.abs(Pk(0, 0, 10)[1] - top) < 1e-6, 'a 10 cm thing drawn ×2 is 20 cm tall on screen');
  assert.ok(Math.abs(Pk.scaleAt(0, 0, 10) - P.scaleAt(0, 0, 20) * 2) < 1e-9);
  assert.equal(K.scaledLens(P, [0, 0, 0], 1), P);
  assert.ok(clean(K.box(Pk, [-5, -5, 0], [10, 10, 10], 'teal', R).svg));
});

test('light pools: a lamp throws a pool on a big wall or floor instead of tinting it flat; an aperture light keeps its spill', async () => {
  const { lens: K, set: S, draw } = await kit();
  draw.scope('t-lp-', 'stage');
  const P = K.lens({ pos: [0, -600, 150], target: [0, 200, 100], fov: 46 });
  const wall = [[-400, 300, 300], [400, 300, 300], [400, 300, 0], [-400, 300, 0]];
  const dark = K.rig(P, { mood: 'night' });
  const lamp = { pos: [0, 200, 220], level: 0.6, reach: 250, color: 'warm' };
  const lit = K.rig(P, { mood: 'night', points: [lamp] });
  const a = S.surface(P, dark, wall, 'plaster', { n: [0, -1, 0] });
  const b = S.surface(P, lit, wall, 'plaster', { n: [0, -1, 0] });
  assert.ok(!/radialGradient/.test(a));
  assert.match(b, /<radialGradient id="[^"]*pool-/);
  const fill = (svg: string) => svg.match(/<path d="[^"]+" fill="(#[0-9A-F]{6})" fill-rule/)?.[1];
  assert.equal(fill(a), fill(b), 'the wall keeps its own colour; the lamp adds a pool');
  const ap = K.rig(P, { mood: 'night', points: [{ ...lamp, aperture: [[-50, 250, 100], [50, 250, 100], [50, 250, 200], [-50, 250, 200]] }] });
  assert.ok(!/pool-/.test(S.surface(P, ap, wall, 'plaster', { n: [0, -1, 0] })), 'a light through an aperture is not pooled here');
});

test('a planned carry: the storyboard declares the spot, and two frames built apart place the element identically', async () => {
  const { lens: K, shots: S } = await kit();
  // the canonical form (NOTES-B): its screen box; the centre-and-size form reads to the same box
  assert.deepEqual(S.parseCarry('parcel box 610 1155 910 1375'), { id: 'parcel', box: [610, 1155, 910, 1375], spot: [760, 1265], w: 300, h: 220 });
  assert.deepEqual(S.parseCarry('parcel @ 760,1265 300x220px')!.box, [610, 1155, 910, 1375]);
  assert.deepEqual(S.parseCarry('parcel @ 760,1265 300px')!.box, [610, 1115, 910, 1415], 'a size alone is square');
  assert.deepEqual(S.parseCarry(' parcel '), { id: 'parcel', box: null, spot: null, w: null, h: null }, 'a bare id still parses');
  for (const bad of ['parcel @ 760,1265', 'parcel @ 760 1265 300px', 'parcel @ 1,2 0px', 'parcel box 10 10 5 20', 'parcel box 1 2 3', '']) assert.equal(S.parseCarry(bad), null, bad);
  const DECL = 'parcel box 610 1155 910 1375';
  // the outgoing world frame and the incoming mechanism frame, each from the declaration alone
  const world = K.lens({ pos: [0, -500, 120], target: [0, 200, 60], fov: 40 });
  const a = S.carry(DECL, { to: { P: world, z: 0, size: [60, 44, 40] } });
  const b = S.carry('parcel', { from: DECL, morph: 'world→mechanism' });
  const c = S.carry('parcel', { spot: [760, 1265], size: 220, w: 300 });
  const e = S.carry('parcel', { from: { box: [610, 1155, 910, 1375] } });
  const f = S.carry('parcel @ 760,1265 300x220px');
  for (const x of [b, c, e, f]) assert.deepEqual(x.box, a.box);
  assert.equal(a.id, 'parcel');
  assert.ok(a.planned && b.planned);
  // the world frame stands it so its drawn box is the declared one (drawn at `fit` about its base)
  const Pk = K.scaledLens(world, a.to.at, a.to.fit);
  const q: number[][] = [];
  for (const x of [-30, 30]) for (const y of [-22, 22]) for (const z of [0, 40]) q.push(Pk(a.to.at[0] + x, a.to.at[1] + y, z));
  const top = Math.min(...q.map((v) => v[1]));
  const bottom = Math.max(...q.map((v) => v[1]));
  const cx = (Math.min(...q.map((v) => v[0])) + Math.max(...q.map((v) => v[0]))) / 2;
  assert.ok(Math.abs(top - 1155) < 0.5 && Math.abs(bottom - 1375) < 0.5 && Math.abs(cx - 760) < 0.5, `${top} ${bottom} ${cx}`);
  // another camera, the same declaration: the same screen spot
  const other = K.lens({ pos: [300, -400, 160], target: [100, 300, 40], fov: 36 });
  const d = S.carry(DECL, { to: { P: other, z: 0, size: [60, 44, 40] } });
  assert.deepEqual(d.box, a.box);
  assert.throws(() => S.carry('parcel', { from: 'parcel at the door' }), /not a carry declaration/);
  assert.throws(() => S.carry('parcel', { spot: [1, 2] }), /a spot is \[x, y\] .* with a size/);
});

test('jumpCutProblems exempts a planned bridge: a cut declared as a carry, or a change of look', async () => {
  const { shots: S } = await kit();
  const cam = { pos: [0, -600, 100], target: [0, 0, 40], fov: 40 };
  const a = { at: 0, kind: 'medium', subject: 'parcel', cast: ['parcel'], camera: cam };
  const b = { at: 3, kind: 'medium', subject: 'parcel', cast: ['parcel'], camera: cam };
  assert.match(S.jumpCutProblems([a, b]).join('|'), /jump cut: the same subject "parcel" changes only 1\.00×/, 'the same spot and size is a jump cut…');
  assert.deepEqual(S.jumpCutProblems([{ ...a, carry: 'parcel box 610 1155 910 1375' }, b]), [], '…unless the cut is a declared carry (outgoing side)');
  assert.deepEqual(S.jumpCutProblems([{ ...a, carry: { id: 'parcel', box: [610, 1155, 910, 1375] } }, { ...b, carry: { id: 'parcel', box: [610, 1155, 910, 1375] } }]), [], "(the lint's parsed form)");
  assert.deepEqual(S.jumpCutProblems([a, { ...b, carry: 'parcel' }]), [], '(or incoming side)');
  assert.deepEqual(S.jumpCutProblems([{ ...a, look: 'world' }, { ...b, look: 'mechanism' }]), [], 'world → mechanism is a new picture');
  assert.deepEqual(S.jumpCutProblems([{ ...a, look: 'mechanism' }, { ...b, look: 'blend' }]), []);
  assert.match(S.jumpCutProblems([{ ...a, look: 'world' }, { ...b, look: 'world' }]).join('|'), /jump cut/, 'the same look is held to the rule');
  assert.match(S.jumpCutProblems([{ ...a, carry: '' }, b]).join('|'), /jump cut/, 'an empty carry declares nothing');
});
