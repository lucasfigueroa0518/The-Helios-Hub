/**
 * Explainers 4.1/4.2 set design (world-kit/set.js): the set brief, the general primitives through
 * the perspective lens, and the set check (4.2: breakage only). Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any = null;
async function kit(): Promise<any> {
  if (M) return M;
  await import('../explainers/world-kit/try.mjs').catch(() => null);
  const draw = await import('../explainers/world-kit/draw.js');
  M = { draw, lens: await import('../explainers/world-kit/lens.js'), set: await import('../explainers/world-kit/set.js') };
  return M;
}

const BRIEF = {
  place: 'a post office counter hall',
  tells: ['service counter', 'parcel shelving', 'queue signage'],
  architecture: { walls: ['back', 'left'], openings: [{ wall: 'back', kind: 'window' }] },
  materials: { floor: 'terrazzo', walls: 'plaster' },
  colorStory: ['blue-shade', 'paper-shade'],
  layers: { fg: 'a parcel on the near counter', mid: 'the queue', bg: 'the counter run and the street window' },
  beyond: { kind: 'outdoor', place: 'the street' },
  density: 'sparse',
};

async function shot(ground = 'paper', build?: (B: any) => void) {
  const { draw, lens: K, set: S } = await kit();
  draw.scope(`t-set-${ground}-`, ground);
  // aimed a little down so the ceiling keeps to CEILING_MAX_SHARE of the vertical frame (4.1)
  const P = K.lens(S.fitCeiling({ pos: [60, -520, 140], target: [0, 160, 95], fov: 46 }, { x: [-250, 250], y: [-600, 220], h: 280 }));
  const R = K.rig(P, { ground });
  const B = S.setBuilder(P, R, BRIEF);
  (build ?? ((b: any) => {
    b.room({ x: [-250, 250], y: [-600, 220], h: 280, floor: 'terrazzo', wall: 'plaster', walls: { back: { openings: [{ kind: 'window', at: 300, w: 120, beyond: { kind: 'outdoor', volumes: [{ u: 0, at: [0, 2000], size: [600, 500, 500], windows: [3, 2] }] } }] }, left: true } });
    b.run({ at: [-200, 150], len: 300, h: 105, body: 'blue-shade', tell: 'service counter' });
    b.shelving({ at: [-245, -200], facing: '+x', len: 200, contents: 'boxes', tell: 'parcel shelving' });
    b.sign({ a: [-250, 220], b: [250, 220], s: 100, z: 220, w: 120, h: 30, text: 'QUEUE HERE', tell: 'queue signage', env: true });
    b.dress({ area: { x: [-190, 90], y: [160, 200], z: 105 }, kinds: ['paper', 'box'], seed: 2 });
    b.foreground(S.solid(P, R, { at: [20, -380, 0], size: [60, 50, 100], tone: 'paper-lit' }), [50, -355, 50]);
  }))(B);
  const out = B.done();
  const svg = K.render(P, { env: out.env, items: out.items });
  return { ...out, svg, P, R, S };
}

test('setBriefProblems (4.2): names only; counts and quotas are craft, never checked', async () => {
  const { set: S } = await kit();
  assert.deepEqual(S.setBriefProblems(BRIEF), []);
  assert.ok(S.setBriefProblems(null)[0].includes('SET must be an object'));
  // a thin brief is the builder's call: two tells, one wall, no layers, an orange accent
  assert.deepEqual(S.setBriefProblems({ place: 'x', tells: ['a', 'b'], colorStory: ['orange'], architecture: { walls: ['back'] }, materials: { floor: 'wood' } }), []);
  const p = S.setBriefProblems({ ...BRIEF, colorStory: ['nope'], materials: { floor: 'lava' }, density: 'packed', architecture: { openings: [{ kind: 'porthole' }] }, exterior: 'moon' }).join('\n');
  for (const want of ['not a palette token', '"lava" is not a kit material', 'density', '"porthole" is not an opening', '"moon" is not an exterior']) assert.ok(p.includes(want), `missing: ${want}\n${p}`);
  assert.deepEqual(S.setBriefProblems({ ...BRIEF, architecture: undefined, exterior: 'street' }), []);
  for (const gone of ['MIN_TELLS', 'MIN_DRESSING', 'LARGE_SURFACE_M2']) assert.equal(S[gone], undefined, `${gone} is removed (4.2)`);
});

test('materials: every kind resolves to palette tones, its pattern is laid on the face', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-mat-', 'paper');
  const P = K.lens({ pos: [0, -400, 140], target: [0, 100, 100] });
  const R = K.rig(P, { ground: 'paper' });
  const face = [[-100, 100, 200], [100, 100, 200], [100, 100, 0], [-100, 100, 0]];
  for (const kind of Object.keys(S.MATERIALS)) {
    const svg = S.surface(P, R, face, kind, { n: [0, -1, 0] });
    assert.ok(svg.includes(`data-set-mat="${kind}"`), kind);
    assert.ok(!/NaN|undefined/.test(svg), kind);
    if (!['plaster', 'paint', 'fabric'].includes(kind)) assert.ok(svg.includes('<pattern'), `${kind} draws a pattern`);
  }
  assert.throws(() => S.material('lava'), /unknown kind/);
  assert.equal(S.toneProblem('orange-lit'), null, 'orange is a craft call (house style), never an error');
  assert.match(S.toneProblem('neon'), /not a palette token/);
  assert.equal(S.toneProblem({ mix: ['paper', 'teal', 0.3] }), null);
});

test('a room shell through the lens: floor, walls, corner, opening with a beyond; check passes', async () => {
  const s = await shot();
  assert.deepEqual(s.S.setProblems(s, BRIEF), []);
  assert.equal(s.meta.walls, 2);
  assert.equal(s.meta.corners, 1);
  assert.deepEqual(s.meta.openings.map((o: any) => [o.kind, o.beyond]), [['window', true]]);
  assert.ok(s.meta.layers.fg >= 1 && s.meta.layers.mid >= 1 && s.meta.layers.bg >= 1);
  assert.ok(s.apertures.length === 1 && s.apertures[0].length === 4, 'the window is an aperture a light can shine through');
  assert.ok(!/NaN|undefined|Infinity/.test(s.svg));
  // the same check reads a drawn frame
  assert.deepEqual(s.S.setProblems(s.svg, BRIEF), []);
});

test('setProblems (4.2) flags breakage only: nothing to stand on, a window onto the void, an unknown material', async () => {
  const s = await shot('paper', (b) => {
    b.room({ x: [-200, 200], y: [-500, 200], walls: ['back'], floor: 'wood', wall: null, ceiling: null });
    b.solid({ at: [0, 0, 0], size: [40, 40, 40], tone: 'orange', tell: 'one thing' });
  });
  // one wall, no foreground, a bare wall, one tell, no dressing, orange: all craft now
  assert.deepEqual(s.S.setProblems(s, BRIEF), []);
  const errs = s.S.setProblems({ floor: false, walls: 0, corners: 0, openings: [{ kind: 'window', beyond: false }, { kind: 'door', beyond: false }], layers: {}, tells: [], surfaces: [{ part: 'wall', mat: 'lava', area: 9 }] }).join('\n');
  for (const want of ['nothing to stand on', 'a window shows nothing beyond', '"lava", which is not a kit material']) assert.ok(errs.includes(want), `missing: ${want}\n${errs}`);
  assert.ok(!errs.includes('a door'), 'an open door may show the room behind it');
});

test('works on the stage: the same set darkens without the studio key', async () => {
  const paper = await shot('paper');
  const stage = await shot('stage');
  assert.ok(stage.R.dark && !paper.R.dark);
  assert.notEqual(paper.svg, stage.svg);
  assert.deepEqual(stage.S.setProblems(stage, BRIEF), []);
});

test('fixtures and dressing are deterministic and stay in palette', async () => {
  const a = await shot();
  const b = await shot();
  assert.equal(a.svg, b.svg);
  const { set: S, lens: K } = await kit();
  const n = S.dress(a.P, a.R, { area: { x: [0, 300], y: [0, 300], z: 0 }, density: 'busy', seed: 4 }).length;
  const m = S.dress(a.P, a.R, { area: { x: [0, 300], y: [0, 300], z: 0 }, density: 'sparse', seed: 4 }).length;
  assert.ok(n > m, `busy (${n}) holds more than sparse (${m})`);
  for (const f of [S.desk, S.chair, S.bed]) assert.ok(!/data-tone="orange"/.test(f(a.P, a.R, { at: [0, 0] })));
  assert.ok(S.drape(a.P, a.R, { a: [0, 0], b: [100, 0] }).length > 100);
  assert.ok(S.lamp(a.P, a.R, { kind: 'pendant', at: [0, 0, 200] }).light.reach > 0);
  assert.ok(S.beam(a.P, a.R, { a: [0, 0, 250], b: [0, 300, 250], kind: 'tray' }).length > 100);
  assert.ok(K.render(a.P, { env: [], items: [{ svg: S.shelving(a.P, a.R, { at: [0, 0], rack: true, contents: 'servers' }), at: [0, 0, 100] }] }).length > 1000);
});

// ── 4.1 Phase 2 ─────────────────────────────────────────────────────────────────────────────

test('counters at critter scale: h "critter" sits under the chin line, a number is cm, anything else throws', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-run-', 'paper');
  const core: any = await import('../explainers/world-kit/core.js');
  const outfits: any = await import('../explainers/world-kit/outfits.js');
  const mouth = outfits.FACE_KEEPOUT.find((z: { part: string }) => z.part === 'mouth');
  assert.ok(Math.abs(S.CRITTER_CHIN_CM - (-(mouth.y + mouth.h) / core.CRITTER_PX) * core.CRITTER_CM) < 1e-9);
  assert.equal(S.CRITTER_COUNTER_CM, Math.floor(S.CRITTER_CHIN_CM));
  assert.ok(S.CRITTER_COUNTER_CM < 0.3 * core.CRITTER_CM, 'a critter is nearly all head: its chin is low');
  assert.equal(S.runHeight('critter'), S.CRITTER_COUNTER_CM);
  assert.equal(S.runHeight(75), 75);
  assert.equal(S.runHeight(undefined), 90);
  assert.throws(() => S.runHeight('tall'), /h must be 'critter' or a height/);
  const P = K.lens({ pos: [0, -420, 60], target: [0, 100, 40], fov: 40 });
  const R = K.rig(P, { ground: 'paper' });
  const top = (svg: string) => Math.min(...[...svg.matchAll(/points="([^"]+)"/g)].flatMap((m) => m[1].split(' ').map((p) => Number(p.split(',')[1]))));
  const tall = S.run(P, R, { at: [-100, 50], len: 200 });
  const low = S.run(P, R, { at: [-100, 50], len: 200, h: 'critter', inserts: [{ kind: 'sink', s: 60 }] });
  assert.ok(top(low) > top(tall) + 40, 'the critter counter sits well below the true one on screen');
  assert.ok(!/NaN|undefined/.test(low));
});

test('the dado rail stops at a door and a low window, like the skirting', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-dado-', 'paper');
  const P = K.lens({ pos: [0, -500, 140], target: [0, 200, 90], fov: 46 });
  const R = K.rig(P, { ground: 'paper' });
  const rails = (ops: unknown[]) => {
    const w = S.wall(P, R, { a: [-250, 200], b: [250, 200], n: [0, -1], mat: 'plaster', dado: { h: 100, mat: 'panel' }, skirting: false, openings: ops });
    return w.env.find((e: { part: string }) => e.part === 'wall').svg;
  };
  const count = (svg: string) => (svg.match(/<polygon/g) ?? []).length;
  const none = count(rails([]));
  assert.ok(none > 0);
  const door = count(rails([{ kind: 'door', at: 200, w: 90, leaf: false, frame: false }]));
  const high = count(rails([{ kind: 'window', at: 200, w: 90, z0: 120, z1: 200, frame: false }]));
  assert.ok(door > none, 'the rail splits round the door (two pieces, not one across it)');
  assert.ok(high >= none, 'a window above the rail does not split it');
});

test('beyond pieces carry tells: the beyond, its volumes, a custom piece and B.beyond', async () => {
  const brief = { ...BRIEF, tells: ['service counter', 'parcel shelving', 'queue signage', 'the street', 'the bus stop', 'the depot'] };
  const s = await shot('paper', (b) => {
    b.room({ x: [-250, 250], y: [-600, 220], h: 280, walls: { back: { openings: [{ kind: 'window', at: 300, w: 120, beyond: { kind: 'outdoor', tell: 'the street', volumes: [{ u: 0, at: [0, 2000], size: [600, 500, 500], tell: 'the depot' }], custom: (_P: unknown, _R: unknown, ctx: any) => ({ svg: `<circle cx="${ctx.at(0, 300, 100)[0]}" cy="1" r="3"/>`, tell: 'the bus stop' }) } }] }, left: true } });
    b.piece('', [0, 0, 0], { tell: 'queue signage' });
    b.beyond('<rect width="2" height="2"/>', [0, 900, 100], { tell: 'the far depot', clip: [[50, 220, 210], [170, 220, 210], [170, 220, 95], [50, 220, 95]] });
  });
  for (const t of ['the street', 'the depot', 'the bus stop', 'the far depot']) assert.ok(s.meta.tells.includes(t), `${t} in meta.tells`);
  assert.ok(!s.meta.tells.includes('queue signage'), 'an empty piece builds nothing');
  const fromSvg = s.S.setMetaFromSvg(s.svg).tells;
  for (const t of ['the street', 'the depot', 'the bus stop', 'the far depot']) assert.ok(fromSvg.includes(t), `${t} read back from the drawn frame`);
  assert.deepEqual(s.S.setProblems(s, brief), []);
});

test('ceilings: flat, beamed, none; ceilingShare measures, fitCeiling aims below a share (a helper, never a check)', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-ceil-', 'paper');
  const ROOM = { x: [-250, 250], y: [-600, 220], h: 280 };
  const cam = { pos: [60, -520, 140], target: [0, 160, 95], fov: 46 };
  const P = K.lens(cam);
  const R = K.rig(P, { ground: 'paper' });
  assert.ok(S.ceilingShare(P, ROOM) > 0.18, 'a level vertical wide spends ~20% on ceiling');
  const flat = S.room(P, R, { ...ROOM, ceiling: 'flat' });
  const beamed = S.room(P, R, { ...ROOM, ceiling: 'beamed' });
  const none = S.room(P, R, { ...ROOM, ceiling: 'none' });
  assert.equal(flat.ceiling.style, 'flat');
  assert.ok(beamed.env.some((e: { part: string; svg: string }) => e.part === 'beams' && e.svg.length > 0));
  assert.ok(!none.env.some((e: { part: string }) => e.part === 'ceiling') && none.ceiling.share === 0);
  assert.ok(!S.room(P, R, { ...ROOM, ceiling: { kind: 'plaster', tone: 'paper-lit' } }).env.some((e: { part: string }) => e.part === 'beams'), 'a material alone is a flat ceiling');
  assert.throws(() => S.room(P, R, { ...ROOM, ceiling: 'vaulted' }), /ceiling must be flat, beamed, none/);
  const B = S.setBuilder(P, R, BRIEF);
  B.room({ ...ROOM, ceiling: 'beamed' });
  assert.deepEqual(S.setProblems(B.done(), BRIEF), [], 'the ceiling share is craft (4.2)');
  const fit = S.fitCeiling(cam, ROOM);
  assert.deepEqual(fit.pos, cam.pos);
  assert.ok(fit.target[2] < cam.target[2]);
  const share = S.ceilingShare(K.lens(fit), ROOM);
  assert.ok(share <= S.CEILING_MAX_SHARE && share > S.CEILING_MAX_SHARE - 0.02, `fits just under: ${share}`);
  assert.equal(S.fitCeiling(fit, ROOM), fit, 'a camera that fits comes back unchanged');
});

test('a reverse shot inside the room sees a closing wall, never a void; forward shots and cutaways are unchanged', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-rev-', 'paper');
  const ROOM = { x: [-250, 250], y: [-600, 220], h: 280, walls: ['back', 'left'] };
  const fwd = K.lens({ pos: [0, -400, 120], target: [0, 200, 80] });
  const rev = K.lens({ pos: [0, 100, 120], target: [0, -500, 80] });
  const closing = (P: any, o = {}) => S.room(P, K.rig(P), { ...ROOM, ...o }).env.filter((e: { part: string; svg: string }) => e.part === 'closing-wall' && e.svg);
  assert.equal(closing(fwd).length, 0);
  assert.equal(closing(rev).length, 1, 'the front wall closes the reverse shot');
  assert.equal(closing(rev, { enclose: false }).length, 0, 'enclose: false keeps a cutaway');
});

test('a critter near the lens counts as the foreground layer in the set meta (from the SVG); never a check', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-fg-', 'paper');
  const P = K.lens({ pos: [-130, -520, 110], target: [90, 190, 50], fov: 40 });
  const R = K.rig(P, { ground: 'paper' });
  const B = S.setBuilder(P, R, BRIEF);
  B.room({ x: [-260, 300], y: [-700, 240], h: 300, ceiling: 'none', walls: ['back', 'left'] });
  const set = B.done();
  const feet = K.worldAt(P, 250, 1840, 0);
  const near = K.critterAt(P, feet[0], feet[1], 0, { who: 'visitor', view: 'back' }, R);
  const far = K.critterAt(P, 90, 190, 0, { who: 'clerk' }, R);
  assert.ok(S.nearCritter(near.box) && !S.nearCritter(far.box));
  assert.deepEqual(S.setProblems(set), [], 'no foreground is craft (4.2)');
  const svg = K.render(P, { env: set.env, items: [...set.items, { svg: near.svg, at: [feet[0], feet[1], 36] }, { svg: far.svg, at: [90, 190, 36] }] });
  assert.ok(S.setMetaFromSvg(svg).layers.fg >= 1, 'read from the drawn frame');
  // the occlusion check does not call a turned-away shoulder a giant face
  assert.ok(!K.occlusionProblems([{ t: 0, svg: `<g data-lens="1 0 0 540 960">${near.svg}</g>` }]).some((e: string) => /fills/.test(e)));
});

test('faceCutProblems: a counter nearer the lens than a critter must not cut its face; the critter-height counter keeps it whole', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-cut-', 'paper');
  const P = K.lens({ pos: [-130, -520, 110], target: [90, 190, 50], fov: 40 });
  const R = K.rig(P, { ground: 'paper' });
  const frame = (h: number | string, view = 'front') => {
    const B = S.setBuilder(P, R, BRIEF);
    B.run({ at: [-140, 110], len: 320, depth: 55, h, tell: 'service counter' });
    const out = B.done();
    const clerk = K.critterAt(P, 90, 175, 0, { who: 'clerk', view }, R);
    return K.render(P, { env: out.env, items: [...out.items, { svg: clerk.svg, at: [90, 175, 36] }] });
  };
  assert.match(S.faceCutProblems(frame(40)).join('|'), /the face of "clerk" is cut by "service counter"/);
  assert.match(S.faceCutProblems(frame(90)).join('|'), /cut by "service counter"/);
  assert.deepEqual(S.faceCutProblems(frame('critter')), []);
  assert.deepEqual(S.faceCutProblems(frame(40, 'back')), [], 'a back view has no face to cut');
  assert.deepEqual(S.faceCutProblems([{ t: 1, svg: frame('critter') }]), []);
});

// ── 4.1 Phase 2, round 2 ────────────────────────────────────────────────────────────────────

test('K12: a beyond volume takes windows: true (a grid for its size) or [cols, rows]; anything else says what it expects', async () => {
  const { set: S } = await kit();
  assert.deepEqual(S.windowGrid(true, 600, 500), [2, 2]);
  assert.deepEqual(S.windowGrid([3, 1]), [3, 1]);
  assert.throws(() => S.windowGrid('lots'), /windows must be \[cols, rows\] .* or true/);
  const s = await shot('paper', (b) => {
    b.room({ x: [-250, 250], y: [-600, 220], h: 280, walls: { back: { openings: [{ kind: 'window', at: 300, w: 120, beyond: { kind: 'outdoor', volumes: [{ u: 0, at: [0, 2000], size: [600, 500, 500], windows: true }] } }] }, left: true } });
  });
  assert.ok(!/NaN|undefined/.test(s.svg));
});

test('K4: setBuilder gives its fixtures world bounds, so a dressed counter paints right against the cast', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('t-bnd-', 'paper');
  const P = K.lens({ pos: [0, -600, 160], target: [0, 100, 40], fov: 40 });
  const B = S.setBuilder(P, K.rig(P), BRIEF);
  B.run({ at: [-300, 110], len: 600, depth: 60, h: 'critter' });
  B.solid({ at: [-50, -300, 0], size: [100, 60, 75] });
  const items = B.done().items;
  assert.ok(items.every((it: any) => Array.isArray(it.bounds) && it.bounds[1][2] > it.bounds[0][2]));
  assert.deepEqual(items[0].bounds, [[-300, 110, 0], [300, 170, S.CRITTER_COUNTER_CM]]);
});
