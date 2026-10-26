/**
 * Explainers 4.1 camera grammar (shots.js + lens.js): cuts that change the subject or the angle,
 * one reframing per shot with at most one move, depth of field by intent, per-shot cast, and
 * labels anchored to their entities. Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const kit = async () => {
  await import('../explainers/world-kit/try.mjs');
  const S: any = await import('../explainers/world-kit/shots.js');
  const L: any = await import('../explainers/world-kit/lens.js');
  const D: any = await import('../explainers/world-kit/draw.js');
  return { S, L, D };
};

const ROUTER: [number, number, number] = [0, 0, 36];
const standOff = (at: number[], dist: number, deg: number, z = 95, fov = 40) => {
  const a = (deg * Math.PI) / 180;
  return { pos: [at[0] - dist * Math.sin(a), at[1] - dist * Math.cos(a), z], target: at, fov };
};
const shot = (at: number, o: Record<string, unknown>) => ({ at, kind: 'medium', subject: 'router', cast: ['router', 'a', 'b'], ...o });

test('cut grammar: a zoom on the same view is a jump cut; 35° around it or a new subject is a cut', async () => {
  const { S } = await kit();
  const wide = shot(0, { kind: 'wide', camera: standOff(ROUTER, 900, 0) });
  const zoomed = shot(3, { camera: standOff(ROUTER, 500, 0) });
  assert.match(S.cutProblems([wide, zoomed]).join('|'), /jump cut: the same subject "router" from 0°/);
  assert.deepEqual(S.cutProblems([wide, shot(3, { camera: standOff(ROUTER, 500, 35) })]), []);
  assert.deepEqual(S.cutProblems([wide, shot(3, { camera: standOff(ROUTER, 500, 0, 420) })]), [], 'a change of height is a new angle');
  assert.deepEqual(S.cutProblems([wide, shot(3, { subject: 'a', camera: standOff(ROUTER, 500, 0) })]), [], 'a new subject');
  // legacy crop shots: any kind on the same `on` point is a jump cut (was: only the same kind)
  assert.match(S.validateShots([{ at: 0, kind: 'wide', on: [500, 1000] }, { at: 3, kind: 'close', on: [510, 1004] }], 6).join('|'), /jump cut: the same picture/);
  assert.deepEqual(S.cutProblems([{ at: 0, kind: 'wide', on: [500, 1000] }, { at: 3, kind: 'close', on: [700, 1000] }]), []);
});

test('one reframing per shot, at most one eased move', async () => {
  const { S } = await kit();
  assert.match(S.cutProblems([shot(0, { camera: standOff(ROUTER, 600, 0), zoom: 1.5 })]).join('|'), /one reframing per shot/);
  assert.match(S.cutProblems([shot(0, { camera: standOff(ROUTER, 600, 0), move: [{ kind: 'push' }, { kind: 'pan' }] })]).join('|'), /at most one motivated move/);
  assert.match(S.cutProblems([shot(0, { camera: standOff(ROUTER, 600, 0), move: { kind: 'zoom' } })]).join('|'), /unknown move/);
  assert.match(S.cutProblems([{ at: 0, kind: 'wide', camera: standOff(ROUTER, 600, 0) }]).join('|'), /list its cast/);
  const s = shot(0, { camera: standOff(ROUTER, 600, 0), move: { kind: 'push', by: 100 } });
  const d = (c: { pos: number[] }) => Math.hypot(c.pos[0] - ROUTER[0], c.pos[1] - ROUTER[1], c.pos[2] - ROUTER[2]);
  const d0 = d(S.shotLensAt(s, 0, 3));
  const dMid = d(S.shotLensAt(s, 1.5, 3));
  const d1 = d(S.shotLensAt(s, 3, 3));
  assert.ok(Math.abs(d0 - d1 - 100) < 1e-6, 'pushes its full distance by the end');
  assert.ok(dMid < d0 && dMid > d1, 'eased in between');
  const pull = shot(0, { camera: standOff(ROUTER, 600, 0), move: { kind: 'pull', by: 50 } });
  assert.ok(d(S.shotLensAt(pull, 3, 3)) > d0);
  // the double reframing of the old frames (a per-shot lens AND a crop), from samples
  const legacy = [{ at: 0, kind: 'wide', on: [500, 1000] }, { at: 3, kind: 'close', on: [700, 1000] }];
  const smp = (t: number, cam: string, zoom: number) => ({ t, svg: `<g data-lens="${zoom} 0 0 540 960"><g data-lensed="1" data-cam="${cam}"></g></g>` });
  assert.match(S.cutProblems(legacy, { samples: [smp(1, '1 2 3', 1), smp(4, '4 5 6', 2.4)] }).join('|'), /double reframing/);
  assert.deepEqual(S.cutProblems(legacy, { samples: [smp(1, '1 2 3', 1), smp(4, '1 2 3', 2.4)] }), []);
});

test('shotFrame: a camera shot is framed by its lens alone and draws through it', async () => {
  const { S, D } = await kit();
  D.scope('cam-', 'paper');
  const list = [shot(0, { kind: 'wide', camera: standOff(ROUTER, 900, 0) })];
  let got: { P?: { pos: number[] } } | undefined;
  const svg = S.shotFrame(1, list, (_s: unknown, _l: number, _i: number, ctx: { P: { pos: number[] }; inShot: (id: string) => boolean }) => {
    got = ctx;
    assert.equal(ctx.inShot('router'), true);
    assert.equal(ctx.inShot('zed'), false);
    return ['<g></g>'];
  });
  assert.ok(got?.P, 'draw gets the shot lens');
  assert.match(svg, /data-lens="1 0 0 540 960"/, 'no 2D crop on top of the lens');
});

const scene = async (s: Record<string, unknown>, local = 0) => {
  const { L, D } = await kit();
  D.scope('dof-', 'paper');
  const P = L.lens(s.camera as never);
  const R = L.rig(P, { ground: 'paper' });
  const cr = (id: string, x: number, y: number) => {
    const c = L.critterAt(P, x, y, 0, { who: id }, R);
    return { id, svg: c.svg, at: [x, y, 36] };
  };
  const items = [cr('router', 0, 0), cr('a', -120, 200), cr('b', 140, -150), cr('z', 300, 300), { svg: L.box(P, [-60, 100, 0], [40, 40, 60], 'paper', R).svg, at: [-40, 120, 30] }];
  return { svg: L.render(P, { items, shot: s, local }), L };
};

test('depth of field by intent: sharp by default, the named subject never blurred, rack pulls', async () => {
  const { S } = await kit();
  const plain = shot(0, { camera: standOff(ROUTER, 500, 20) });
  const a = await scene(plain);
  assert.doesNotMatch(a.svg, /data-blur=/, 'a camera shot without intent is sharp');
  assert.doesNotMatch(a.svg, /data-frame-who="z"/, 'only the cast is drawn');
  const insert = shot(0, { kind: 'insert', camera: standOff(ROUTER, 300, 20), focus: { reason: 'insert', on: 'router' } });
  const b = await scene(insert);
  assert.match(b.svg, /data-blur=/);
  assert.doesNotMatch(b.svg, /data-blur-who="router"/);
  const rack = shot(0, { camera: standOff(ROUTER, 500, 20), focus: { reason: 'rack', on: 'router', to: 'b', at: 0.2, dur: 0.6 } });
  assert.doesNotMatch((await scene(rack, 0)).svg, /data-blur-who="router"/);
  assert.doesNotMatch((await scene(rack, 1.5)).svg, /data-blur-who="b"/);
  assert.match((await scene(rack, 1.5)).svg, /data-blur-who="router"/, 'after the rack the first read softens');
  // the checks
  assert.match(S.dofProblems([shot(0, { camera: standOff(ROUTER, 500, 0), focus: { on: 'router' } })]).join('|'), /needs a reason/);
  assert.match(S.dofProblems([shot(0, { camera: standOff(ROUTER, 500, 0), focus: { reason: 'insert', on: 'a' } })]).join('|'), /blurs the named subject "router"/);
  assert.match(S.dofProblems([shot(0, { camera: standOff(ROUTER, 500, 0), focus: { reason: 'rack', on: 'router' } })]).join('|'), /rack focus pulls/);
  assert.match(S.dofProblems([plain], [{ t: 1, svg: '<g data-blur="3"></g>' }]).join('|'), /blurred without a reason/);
  assert.match(S.dofProblems([insert], [{ t: 1, svg: '<g data-blur="3" data-blur-who="router"></g>' }]).join('|'), /"router" is blurred/);
  // the old API keeps its focus
  const { L } = a;
  const P = L.lens(standOff(ROUTER, 500, 20) as never);
  assert.match(L.render(P, { items: [{ svg: '<g></g>', at: [0, 900, 30] }], focus: 300 }), /data-blur=/);
});

test('per-shot cast: at most 3 critters, only the cast; occlusion is 15% in a camera shot', async () => {
  const { S, L } = await kit();
  const s = shot(0, { camera: standOff(ROUTER, 500, 0) });
  const b = (who: string, x: number, depth: number) => ({ kind: 'critter', who, box: [x, 900, x + 200, 1200], depth });
  assert.deepEqual(S.crowdProblems([s], [{ t: 1, boxes: [b('router', 100, 5), b('a', 400, 5), b('b', 700, 5)] }]), []);
  assert.match(S.crowdProblems([s], [{ t: 1, boxes: [b('router', 100, 5), b('a', 300, 5), b('b', 500, 5), b('c', 700, 5)] }]).join('|'), /shows 4 critters/);
  assert.match(S.crowdProblems([s], [{ t: 1, boxes: [b('z', 100, 5)] }]).join('|'), /"z", who is not in its cast/);
  assert.deepEqual(S.castItems(s, [{ id: 'z' }, { id: 'a' }, 'room']), [{ id: 'a' }, 'room']);
  // 20% hidden: staging for a crop shot, overlap-to-fit for a camera shot
  const pair = [b('a', 100, 300), b('router', 260, 500)];
  assert.deepEqual(L.occlusionProblems([{ t: 0, boxes: pair }], { shots: [{ at: 0, kind: 'wide', on: [540, 1000] }] }), []);
  assert.match(L.occlusionProblems([{ t: 0, boxes: pair }], { shots: [s] }).join('|'), /20% hidden/);
});

test('labels: anchored in world space on their entity, hidden off cast, nudged into the safe area', async () => {
  const { S, L, D } = await kit();
  D.scope('lab-', 'paper');
  const s = shot(0, { camera: standOff(ROUTER, 500, 0) });
  const P = L.lens((s as { camera?: unknown }).camera as never);
  const lab = L.labelFor('router', 'router', { P, shot: s, at: [0, 0, 0] });
  const [x0, , x1, y1] = lab.match(/data-label-box="([^"]+)"/)![1].split(' ').map(Number);
  const head = P(0, 0, L.CRITTER_CM);
  assert.ok(Math.abs((x0 + x1) / 2 - head[0]) < 1 && y1 < head[1], 'sits above its entity');
  assert.equal(L.labelFor('z', 'zed', { P, shot: s, at: [0, 0, 0] }), '', 'not in the cast: hidden');
  assert.equal(L.labelFor('router', 'router', { P, shot: s, at: [0, -900, 0] }), '', 'behind the lens: hidden');
  // an entity at the frame edge: the label slides inside the safe area
  const edge = L.labelFor('router', 'a long label here', { P, shot: s, at: [75, 0, 0] });
  const eb = edge.match(/data-label-box="([^"]+)"/)![1].split(' ').map(Number);
  assert.ok(eb[2] <= L.SAFE.x1 + 0.5 && eb[0] >= L.SAFE.x0 - 0.5);
  // the check: the label's entity visible, and no other entity nearer
  const R = L.rig(P, { ground: 'paper' });
  const own = L.critterAt(P, 0, 0, 0, { who: 'router' }, R).svg;
  const other = L.critterAt(P, 90, 0, 0, { who: 'a' }, R).svg;
  const wrap = (inner: string) => `<g data-lens="1 0 0 540 960">${inner}</g>`;
  assert.deepEqual(S.labelProblems([{ t: 1, svg: wrap(own + other + lab) }], [s]), []);
  assert.match(S.labelProblems([{ t: 1, svg: wrap(other + lab) }], [s]).join('|'), /its entity is not visible/);
  const wrong = L.labelFor('router', 'router', { P, shot: s, at: [90, 0, 0] });
  assert.match(S.labelProblems([{ t: 1, svg: wrap(own + other + wrong) }], [s]).join('|'), /nearer "a" than its own entity/);
});

// ── 4.1 Phase 2 ─────────────────────────────────────────────────────────────────────────────

test('worldAt: the exact world point under a pixel on a plane, stable right up to the lens', async () => {
  const { L } = await kit();
  for (const cam of [standOff(ROUTER, 500, 0), standOff(ROUTER, 260, 40, 140, 52), { pos: [30, -120, 80], target: [0, 200, 20], fov: 60, roll: 2 }]) {
    const P = L.lens(cam);
    for (const [sx, sy, z] of [[540, 1400, 0], [120, 1800, 0], [980, 1100, 36], [540, 1900, 10]] as [number, number, number][]) {
      const w = L.worldAt(P, sx, sy, z);
      assert.equal(w[2], z);
      const back = P(...w);
      assert.ok(Math.abs(back[0] - sx) < 1e-6 && Math.abs(back[1] - sy) < 1e-6, `${sx},${sy} round-trips`);
    }
  }
  // above the floor's horizon there is no floor point: it says so
  assert.throws(() => L.worldAt(L.lens(standOff(ROUTER, 500, 0)), 540, 10, 0), /never meets the plane z = 0/);
});

test('labelFor clamps every label into the safe area, however far its anchor sits', async () => {
  const { L, D } = await kit();
  D.scope('clamp-', 'paper');
  const P = L.lens(standOff(ROUTER, 400, 0));
  for (const at of [[150, 0, 0], [-150, 0, 0], [0, 0, -60], [120, 0, 30]]) {
    const lab = L.labelFor('router', 'a label that is rather long', { P, at });
    if (!lab) continue;
    const [x0, y0, x1, y1] = lab.match(/data-label-box="([^"]+)"/)![1].split(' ').map(Number);
    assert.ok(x0 >= L.SAFE.x0 - 0.01 && x1 <= L.SAFE.x1 + 0.01 && y0 >= L.SAFE.y0 - 0.01 && y1 <= L.SAFE.y1 + 0.01, `${at}: ${[x0, y0, x1, y1]}`);
  }
});

test('labelProblems: a sample without the data-lens of frame() says so once, instead of "not visible" per label', async () => {
  const { S, L, D } = await kit();
  D.scope('nolens-', 'paper');
  const s = shot(0, { camera: standOff(ROUTER, 500, 0) });
  const P = L.lens((s as { camera?: unknown }).camera as never);
  const own = L.critterAt(P, 0, 0, 0, { who: 'router' }, L.rig(P, { ground: 'paper' })).svg;
  const lab = L.labelFor('router', 'router', { P, shot: s, at: [0, 0, 0] }) + L.labelFor('a', 'a', { P, at: [90, 0, 0] });
  const errs = S.labelProblems([{ t: 1, svg: own + lab }, { t: 2, svg: own + lab }], [s]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /sample at 1\.00s is not wrapped in frame\(\): no data-lens/);
  assert.ok(!errs.some((e: string) => /not visible/.test(e)));
});

// ── 4.1 Phase 2, round 2 ────────────────────────────────────────────────────────────────────

test('K1: a cut between two places is never a jump cut, whatever the angles', async () => {
  const { S } = await kit();
  const store = shot(0, { camera: standOff(ROUTER, 500, 0), place: 'store' });
  const home = shot(3, { camera: standOff(ROUTER, 480, 5) });
  assert.deepEqual(S.cutProblems([store, home]), []);
  assert.match(S.cutProblems([shot(0, { camera: standOff(ROUTER, 500, 0) }), home]).join('|'), /jump cut/, 'the same place still needs a new angle');
});

test('K5: the band wash is opt-in on a lens shot, automatic on a 2D crop above WASH_ZOOM', async () => {
  const { S, L, D } = await kit();
  D.scope('wash-', 'paper');
  const cam = standOff(ROUTER, 500, 0);
  const draw = (_s: unknown, _l: unknown, _i: unknown, ctx: any) => L.render(ctx.P, { items: [] });
  assert.ok(!/bandwash/.test(S.shotFrame(0.5, [{ at: 0, kind: 'medium', camera: cam, subject: 'router', cast: ['router'] }], draw)), 'a medium lens shot keeps its set tells');
  assert.match(S.shotFrame(0.5, [{ at: 0, kind: 'medium', camera: cam, subject: 'router', cast: ['router'], wash: true }], draw), /bandwash/);
});

test('K4: render paints by world boxes: a long counter never covers the critter in front of it, a pin on a table is never covered', async () => {
  const { L } = await kit();
  const P = L.lens({ pos: [0, -600, 160], target: [0, 100, 40], fov: 40 });
  const counter = { svg: '<g id="COUNTER"/>', at: [0, 140, 45], bounds: [[-300, 110, 0], [300, 170, 90]] };
  const critter = { svg: '<g id="CRITTER"/>', at: [280, 95, 36] };
  // by its one point the counter's centre is nearer than the critter standing in front of its far end
  assert.ok(P.dist(...counter.at) < P.dist(...critter.at));
  const order = (items: any[]) => [...L.render(P, { items }).matchAll(/id="([A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order([critter, counter]), ['COUNTER', 'CRITTER']);
  const table = { svg: '<g id="TABLE"/>', at: [0, -200, 30], bounds: [[-200, -260, 0], [200, -140, 75]] };
  const pin = { svg: '<g id="PIN"/>', at: [-150, -150, 80] };
  assert.deepEqual(order([pin, table]), ['TABLE', 'PIN']);
  // without bounds: plain distance, as before
  assert.deepEqual(L.byDistance(P, [{ at: [0, 300, 0] }, { at: [0, 0, 0] }]).map((x: any) => x.at[1]), [300, 0]);
});

test('K3: critterAt exposes its hands and held props; an insert frames a held prop; close and insert may frame a critter big, a face is never cut by the edge', async () => {
  const { L, D, S } = await kit();
  const C: any = await import('../explainers/world-kit/cast.js');
  D.scope('ins-', 'paper');
  const P = L.lens({ pos: [0, -500, 110], target: [0, 0, 50], fov: 40 });
  const R = L.rig(P, { ground: 'paper' });
  const o = { who: 'cook', body: 'orange', ...C.act({ hold: { r: 'carton' } }), heldIds: { r: 'carton' } };
  const c = L.critterAt(P, 0, 0, 0, o, R);
  for (const side of ['l', 'r'] as const) {
    const back = P(...c.handsWorld[side]);
    assert.ok(Math.hypot(back[0] - c.hands[side][0], back[1] - c.hands[side][1]) < 1.5, `${side} hand world → screen round-trips`);
  }
  assert.ok(c.held.r && c.held.r.kind === 'carton' && c.held.r.box[2] > c.held.r.box[0]);
  assert.match(c.svg, /data-frame-kind="entity" data-frame-who="carton"/);
  // an insert camera on the carton makes it readable (it was ~40 px in a medium)
  const cam = L.insertCamera(c.held.r.world, { size: 20, fill: 0.3, deg: 25 });
  const P2 = L.lens(cam);
  const c2 = L.critterAt(P2, 0, 0, 0, o, R);
  const hb = c2.held.r.box;
  assert.ok(hb[3] - hb[1] > 250, `the carton reads: ${Math.round(hb[3] - hb[1])} px tall`);
  const wrap = (svg: string) => `<g data-lens="1 0 0 540 960">${svg}</g>`;
  const ins = [{ at: 0, kind: 'insert', camera: cam, subject: 'carton', cast: ['cook', 'carton'] }];
  const errs = L.occlusionProblems([{ t: 0, svg: wrap(c2.svg) }], { shots: ins });
  assert.ok(!errs.some((e: string) => /fills/.test(e)), 'an insert may frame the critter big');
  assert.deepEqual(L.framingProblems([{ t: 0, svg: wrap(c2.svg) }], { shots: ins }), [], 'the held carton is the subject, whole and safe');
  // a face cut by the frame edge is flagged in any shot; a head wholly out is fine
  const cr = (box: number[]) => ({ kind: 'critter', who: 'x', box, raw: box, depth: 100 });
  const s = 4;
  const half = cr([540 - 84 * s, 300 - 160 * s, 540 + 84 * s, 300 + 6 * s]);
  assert.match(L.occlusionProblems([{ t: 0, boxes: [half] }], { shots: [{ at: 0, kind: 'close', on: [540, 400] }] }).join('|'), /the face of "x" is cut by the top edge/);
  const out = cr([540 - 84 * s, -900, 540 + 84 * s, -900 + 166 * s]);
  assert.ok(!L.occlusionProblems([{ t: 0, boxes: [out] }], { shots: [{ at: 0, kind: 'insert', on: [540, 1200] }] }).some((e: string) => /face of/.test(e)), 'the head wholly out of the frame');
  void S;
});

test('K11: a label on an entity nested inside another (a pin in its neighborhood) is not a wrong-entity label', async () => {
  const { S, L, D } = await kit();
  D.scope('nest-', 'paper');
  const P = L.lens(standOff(ROUTER, 500, 0));
  const hood = L.entity(P, 'hood', [-120, -40, 0], [240, 80, 40], '');
  const pin = L.entity(P, 'pin', [-20, -5, 40], [10, 10, 20], '');
  const lab = L.labelFor('pin', 'pin', { P, at: [-15, 0, 40], height: 20 });
  assert.deepEqual(S.labelProblems([{ t: 1, svg: `<g data-lens="1 0 0 540 960">${hood + pin + lab}</g>` }]), []);
});
