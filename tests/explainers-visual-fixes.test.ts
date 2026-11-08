// Explainers visual fixes (2026-10-28): the hinged laptop, ports and cables, the locked set, the
// layout checks, the hand-off's backdrop. Offline: no model, no render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const KIT = '../explainers/world-kit';
const load = async () => {
  const T = await import(`${KIT}/try.mjs`); // registers the hooks the kit's modules load under
  const O = await import(`${KIT}/objects.js`);
  const L = await import(`${KIT}/lens.js`);
  const C = await import(`${KIT}/connect.js`);
  const SL = await import(`${KIT}/setlock.js`);
  const LY = await import(`${KIT}/layout.js`);
  const LC = await import(`${KIT}/layout-checks.mjs`);
  return { T, O, L, C, SL, LY, LC };
};
const CAM = { pos: [-30, -110, 150], target: [10, 150, 80], fov: 40 };
const scanOf = (T: any) => (svg: string) => T.drawnElements(svg);

test('the laptop is one hinged object through a close lens: the lid stands on the base\'s back edge, a hinge, one shadow on the desk', async () => {
  const { O, L } = await load();
  const P = L.lens({ pos: [-15, -90, 120], target: [-15, 150, 78], fov: 40 });
  const lap = O.worldObject('laptop', [-20, 162, 76], { size: 2, tone: 'blue', key: 'laptop', state: 'on' });
  const it = O.lensObject(P, lap, {});
  // the hinge pin lies on the projected back edge of the base (screen), within a few px
  const k = lap.u;
  const back = P(-20, 162 + 0, 76 + 14 * k); // near the base's middle, at its top
  assert.ok(Array.isArray(it.pins.hinge));
  assert.ok(it.pins.hinge[1] < back[1] + 5, 'the hinge is at or behind the base top, never floating in front');
  // the shadows fall on the desk top (z 76), not the floor below: every shadow polygon is near the object
  const ys = [...it.svg.matchAll(/data-k="shadow"[^]*?points="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/).map((p: string) => Number(p.split(',')[1])));
  assert.ok(ys.length > 0);
  assert.ok(Math.max(...ys) < it.box.y + it.box.h + 200, 'no shadow far below the laptop');
  // ports: world points on the base's sides, outward directions, and data-ports on the drawing
  assert.ok(it.ports.usb && Array.isArray(it.ports.usb.at) && it.ports.usb.at.length === 3);
  assert.ok(Math.abs(Math.hypot(...it.ports.usb.dir) - 1) < 0.01);
  assert.match(it.svg, /data-ports="usb:/);
});

test('every device the kit draws lists named ports', async () => {
  const { O } = await load();
  for (const id of ['laptop', 'phone', 'tablet', 'screen', 'server', 'rack', 'router', 'speaker', 'database', 'chip']) assert.ok(O.OBJECT_PORTS[id]?.length, id);
  const ph = O.object('phone', [500, 900], { state: 'on' });
  const ports = O.portsAt(ph, 0);
  assert.ok(Array.isArray(ports.usb.screen) && Array.isArray(ports.usb.sdir));
});

test('cable(): both ends seated in their ports, plugs drawn, the sag rests on the surface, never freehand', async () => {
  const { O, L, C } = await load();
  const P = L.lens(CAM);
  const lap = O.lensObject(P, O.worldObject('laptop', [-20, 160, 76], { size: 1.5, key: 'lap' }), {});
  const ph = O.lensObject(P, O.worldObject('phone', [55, 128, 76], { size: 0.9, key: 'ph' }), {});
  const c = C.cable(P, lap.ports.usb2, ph.ports.usb, { slack: 0.6, rest: 76, id: 'c1' });
  const ends = c.svg.match(/data-ends="([^"]+)"/)[1].split(' ').map((p: string) => p.split(',').map(Number));
  const a = P(...lap.ports.usb2.at);
  const b = P(...ph.ports.usb.at);
  assert.ok(Math.hypot(ends[0][0] - a[0], ends[0][1] - a[1]) < 1 && Math.hypot(ends[1][0] - b[0], ends[1][1] - b[1]) < 1, 'ends at the ports');
  assert.ok(c.bounds[0][2] >= 76, 'the cable never sinks through the desk');
  assert.equal(c.id, 'c1');
  assert.throws(() => C.cable(P, [0, 0, 0], ph.ports.usb), /port/);
  assert.throws(() => C.cable(P, null, ph.ports.usb), /port/);
  const s = C.screenCable({ screen: [100, 900], sdir: [1, 0] }, { screen: [700, 900], sdir: [-1, 0] }, { slack: 0.3, rest: 1000 });
  assert.match(s, /data-ends="100,900 700,900"/);
  assert.throws(() => C.screenCable({ at: [0, 0, 0] }, { screen: [1, 1] }), /screen/);
});

test('shadowsOf: a thing on a desk casts its shadow on the desk top', async () => {
  const { L } = await load();
  const P = L.lens(CAM);
  const R = L.rig(P, {});
  const foot = [[-10, 150, 76], [10, 150, 76], [10, 170, 76], [-10, 170, 76]];
  const onDesk = L.shadowsOf(P, foot, 20, R);
  const onFloor = L.shadowsOf(P, foot.map((q) => [q[0], q[1], 0]), 20, R);
  if (onDesk) assert.notEqual(onDesk, onFloor, 'the desk shadow is not the floor shadow');
});

test('the locked set: dressedItems marks every DRESSING thing; render keeps it whatever the cast; setLockProblems', async () => {
  const { O, L, SL, LC } = await load();
  const P = L.lens(CAM);
  const R = L.rig(P, {});
  const world = {
    OBJ: { lap: O.worldObject('laptop', [-20, 160, 76], { size: 1.5, key: 'lap' }) },
    LENS: { mug: (_P: any, _R: any, st: any, pose: any) => ({ id: 'mug', at: pose.at, svg: `<g data-frame-kind="entity" data-frame-who="mug" data-frame-box="0 0 10 10" data-state="${st.full ? 1 : 0}"></g>` }) },
    DRESSING: { main: [{ id: 'lap' }, { id: 'mug', at: [30, 170, 76], state: { full: 0 } }] },
  };
  const items = SL.dressedItems(world, 'main', P, R, { states: { mug: { full: 1 } } });
  assert.equal(items.length, 2);
  assert.ok(items.every((i: any) => i.set === true));
  assert.match(items[1].svg, /data-dressing="mug"[^]*data-state="1"/, 'a shot changes a state, never the list');
  const svg = L.render(P, { items, shot: { camera: CAM, cast: ['hero'] } });
  assert.match(svg, /data-dressing="lap"/);
  assert.match(svg, /data-dressing="mug"/);
  assert.throws(() => SL.dressedItems({ DRESSING: { main: [{ id: 'nope' }] } }, 'main', P, R), /neither a LENS item/);
  // the check: a declared thing missing, a thing that comes and goes across a cut
  const ent = (id: string) => `<g data-frame-kind="entity" data-frame-who="${id}" data-frame-box="0 0 1 1"></g>`;
  const dressed = '<g data-dressing="lap"></g><g data-dressing="mug"></g>';
  const samples = [
    { t: 0, svg: dressed + ent('drawer') },
    { t: 1, svg: '<g data-dressing="lap"></g>' },
    { t: 2, svg: dressed + ent('dongle') },
  ];
  const p = LC.setLockProblems(samples, { shotAt: (t: number) => t, dressing: world.DRESSING });
  assert.ok(p.some((m: string) => /"mug" is main's set dressing/.test(m)));
  assert.ok(p.some((m: string) => /"drawer" is in shot 1 of main and gone in shot 2/.test(m)));
  assert.ok(p.some((m: string) => /"dongle" appears in shot 3/.test(m)));
  assert.deepEqual(LC.setLockProblems([{ t: 0, svg: dressed }, { t: 1, svg: dressed }], { shotAt: (t: number) => t, dressing: world.DRESSING }), []);
  assert.deepEqual(LC.setLockProblems(samples.slice(2), { shotAt: () => 0, dressing: world.DRESSING, story: ['dongle'] }), [], 'a story object may come and go');
});

test('layout.js: rows and columns keep MIN_GAP, clearZone() avoids objects', async () => {
  const { LY } = await load();
  const r = LY.row([{ w: 60 }, { w: 100 }, { w: 80 }], { x: 100, y: 900, gap: 4 });
  assert.equal(r.at[1].x - (r.at[0].x + 60), LY.MIN_GAP, 'never closer than MIN_GAP');
  assert.equal(LY.row([{ w: 500 }, { w: 500 }], { width: 800 }).fits, false);
  const c = LY.row([{ w: 100 }, { w: 100 }], { x: 0, width: 400, align: 'center' });
  assert.equal(c.at[0].x, (400 - 224) / 2);
  const col = LY.column([{ h: 40 }, { h: 40 }], { y: 10 });
  assert.equal(col.at[1].y, 10 + 40 + LY.MIN_GAP);
  assert.equal(LY.clearZone([[100, 250, 900, 700]], 300), 1400, 'the top is taken: the lower zone, kept inside the safe area');
  assert.equal(LY.clearZone([[100, 1200, 900, 1700]], 300), 270);
});

test('layout checks: text over an object, the subject\'s share, near-empty shots, a blank opening, UI collisions', async () => {
  const { T, LC, L } = await load();
  const scan = scanOf(T);
  const framedOf = L.framedBoxes;
  const lensMark = '<g data-lens="1 0 0 540 960">';
  const ent = (id: string, b: number[]) => `<g data-frame-kind="entity" data-frame-who="${id}" data-frame-box="${b.join(' ')}"><rect x="${b[0]}" y="${b[1]}" width="${b[2] - b[0]}" height="${b[3] - b[1]}"/></g>`;
  const text = (s: string, x: number, y: number, extra = '') => `<text x="${x}" y="${y}" font-size="48" ${extra}>${s}</text>`;
  // text over an object; a label pinned on its own object is fine
  const over = [{ t: 0, svg: `${lensMark}${ent('server', [300, 800, 700, 1200])}</g>${text('requests 0/3', 320, 1000)}` }];
  assert.ok(LC.textOverObjectProblems(over, { scanOf: scan, framedOf }).some((m: string) => /"requests 0\/3" sits over "server"/.test(m)));
  const pinned = [{ t: 0, svg: `${lensMark}<g data-frame-kind="entity" data-frame-who="server" data-frame-box="300 800 700 1200"><rect x="300" y="800" width="400" height="400"/>${text('server', 320, 1000)}</g></g>` }];
  assert.deepEqual(LC.textOverObjectProblems(pinned, { scanOf: scan, framedOf }), []);
  const card = [{ t: 0, svg: `${lensMark}${ent('lamp', [100, 300, 400, 700])}</g><g data-role="definition"><rect x="104" y="270" width="872" height="400"/>${text('MCP', 150, 360)}</g>` }];
  assert.ok(LC.textOverObjectProblems(card, { scanOf: scan, framedOf }).some((m: string) => /dictionary card sits over "lamp"/.test(m)));
  // subject mostly cropped / too small
  const shots = [{ at: 0, kind: 'close', camera: CAM, subject: 'lamp', cast: ['lamp'] }, { at: 1, kind: 'wide', camera: CAM, subject: 'dongle', cast: ['dongle'] }];
  const shotAt = (t: number) => (t >= 1 ? { i: 1, shot: shots[1] } : { i: 0, shot: shots[0] });
  const sub = [
    { t: 0.3, svg: `${lensMark}${ent('lamp', [200, -1400, 900, 300])}</g>` },
    { t: 1.3, svg: `${lensMark}${ent('dongle', [500, 900, 560, 940])}</g>` },
  ];
  const sp = LC.subjectShareProblems(sub, { shotAt, framedOf });
  assert.ok(sp.some((m: string) => /"lamp" is mostly cropped/.test(m)));
  assert.ok(sp.some((m: string) => /"dongle" covers/.test(m)));
  // near empty: a box and a dongle in a room
  const ne = LC.nearEmptyProblems([{ t: 0, svg: `${lensMark}${ent('box', [400, 900, 500, 1000])}${ent('dongle', [600, 950, 640, 980])}</g>` }], { framedOf });
  assert.ok(ne.some((m: string) => /near empty/.test(m)));
  assert.deepEqual(LC.nearEmptyProblems([{ t: 0, svg: `${lensMark}${ent('desk', [100, 700, 1000, 1500])}</g>` }], { framedOf }), []);
  // a blank opening: nothing until 0.6 s, then the subject
  const blank = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => ({ t, svg: '<g></g>' })).concat([{ t: 0.6, svg: '<rect x="300" y="800" width="400" height="400"/>' }]);
  assert.equal(LC.blankOpenProblems(blank, { scanOf: scan }).length, 1);
  assert.deepEqual(LC.blankOpenProblems([{ t: 0, svg: text('hi', 300, 900) }, { t: 0.5, svg: '' }, { t: 0.6, svg: '' }], { scanOf: scan }), []);
  // UI: two numbers on top of each other; a number half over its icon
  const ui = [{ t: 0, svg: `<g data-ui="meter">${text('0/3', 300, 900)}${text('100', 310, 905)}<rect x="250" y="850" width="60" height="60"/></g>` }];
  const uc = LC.uiCollisionProblems(ui, { scanOf: scan });
  assert.ok(uc.some((m: string) => /"0\/3" and "100" overlap/.test(m)));
  assert.ok(uc.some((m: string) => /runs into an icon or button edge/.test(m)));
});

test('the dictionary card draws on an opaque plate', async () => {
  await load();
  const { dictionaryCard } = await import(`${KIT}/cards.js`);
  const c = dictionaryCard(1, { headword: 'MCP', words: [{ text: 'a', start: 0 }] });
  assert.match(c.svg, /data-k="plate"/);
  assert.doesNotMatch(c.svg.match(/<path[^>]*data-k="plate"[^>]*>/)[0], /opacity/);
});

test('the hand-off: frame 4\'s first shot is the backdrop; the card is never blank; the module imports frame 4 once it exists', async () => {
  await load();
  const { handoffFrame, handoffCard } = await import(`${KIT}/handoff.js`);
  const next = { draw: (t: number) => `<g data-next-first-shot="${t}"></g>` };
  const f = handoffFrame('shine-warm', { next, duration: 2.6, term: 'MCP' });
  assert.match(String(f.draw(2.59)), /data-next-first-shot="0"/, 'the exit lands on frame 4 at t = 0');
  const failing = handoffFrame('shine-warm', { next: { draw: () => { throw new Error('x'); } }, duration: 2.6, term: 'MCP' });
  assert.doesNotThrow(() => failing.draw(2.59), 'fail open');
  assert.match(String(handoffCard(0, { term: 'MCP' })), /<path/, 'the first words are written when the card appears');
  const { parseFrames, writeHandoff } = await import(`${KIT}/frames.mjs`);
  const fixture = fs.readFileSync(path.join(process.cwd(), 'explainers', 'lint', 'fixtures', 'good', 'STORYBOARD.md'), 'utf8');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-next-'));
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), fixture);
  fs.mkdirSync(path.join(root, 'assets', 'frames'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'handoff.json'), JSON.stringify({ key: 'shine-warm', parts: [], sounds: [] }));
  const frames = parseFrames(fixture);
  const f3 = frames.find((x: { number: number }) => x.number === 3);
  const f4 = frames.find((x: { number: number }) => x.number === 4);
  writeHandoff(root, f3);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets', 'frames', `${f3.id}.js`), 'utf8'), /import next/, 'no frame 4 yet');
  fs.writeFileSync(path.join(root, 'assets', 'frames', `${f4.id}.js`), 'export default { draw: () => "" };');
  const { rewriteHandoff } = await import(`${KIT}/pace.mjs`);
  assert.deepEqual(rewriteHandoff(root).handoff, [f3.id]);
  const mod = fs.readFileSync(path.join(root, 'assets', 'frames', `${f3.id}.js`), 'utf8');
  assert.match(mod, new RegExp(`import next from "\\./${f4.id}\\.js";`));
  assert.match(mod, /\{ world, next, \.\.\./);
});

test('the hand-off lands early: its last frames are frame 4\'s first picture exactly, no ghost card', async () => {
  await load();
  const { handoffFrame } = await import(`${KIT}/handoff.js`);
  const { handoffTiming, EXIT_HOLD } = await import(`${KIT}/handoff-bank.js`);
  const pic = '<g data-next-first-shot="0"><rect x="0" y="0" width="1080" height="1920"/></g>';
  const next = { draw: () => pic };
  const { settle, duration } = handoffTiming(2.604);
  assert.ok(duration - settle >= EXIT_HOLD - 1e-6);
  for (const key of ['shine-warm', 'sound-steps', 'gather-drop']) {
    const f = handoffFrame(key, { next, duration: 2.604, term: 'MCP', parts: [] });
    // the render's last sample is D - 1/30: it must be frame 4's t = 0, byte for byte
    for (const t of [settle, duration - 1 / 30, duration - 0.001]) assert.equal(String(f.draw(t)), pic, `${key} at ${t}`);
  }
});

test('depth: an animal sorts as a box, not a point; a prop with a world size or a screen box gets a default box', async () => {
  const { L } = await load();
  const A = await import(`${KIT}/animals.js`);
  const pup = A.animal('puppy', 0, 0);
  assert.match(pup, /data-animal-cm="[\d.]+"/);
  const P = L.lens({ pos: [0, -300, 100], target: [0, 100, 40], fov: 40 });
  const size = (b: number[][]) => b[1].map((v, k) => v - b[0][k]);
  // the puppy: a box its drawn height tall, not the point it used to be
  const pb = size(L.boundsOf({ at: [150, 50, 19], svg: pup }, P));
  assert.ok(pb[2] > 20 && pb[0] > 10 && pb[0] <= 80, `puppy box ${pb}`);
  // a prop with a world size: that box around its at
  assert.deepEqual(size(L.boundsOf({ at: [0, 0, 10], size: [30, 20, 20] }, P)), [30, 20, 20]);
  // a prop tagged with a screen box: its box taken back to cm at its distance (capped wide)
  const k = P.scaleAt(0, 100, 30);
  const tagged = `<g data-frame-kind="entity" data-frame-who="vase" data-frame-box="500 900 ${500 + 20 * k} ${900 + 40 * k}"></g>`;
  const vb = size(L.boundsOf({ at: [0, 100, 30], svg: tagged }, P)).map((v: number) => Math.round(v));
  assert.deepEqual(vb, [20, 20, 40]);
  // nothing to go on: still the point
  assert.deepEqual(size(L.boundsOf({ at: [0, 0, 0], svg: '<g></g>' }, P)), [0, 0, 0]);
  // the order still runs on the boxes
  const counter = { id: 'counter', at: [0, 160, 40], bounds: [[-200, 120, 0], [200, 200, 80]], svg: '<g></g>' };
  const order = L.paintOrder(P, [{ id: 'puppy', at: [150, 50, 19], svg: pup }, counter].map((it, i) => ({ it, i, d: P.dist(...it.at) }))).map(({ it }: any) => it.id);
  assert.deepEqual(order, ['counter', 'puppy']);
});

test('layout checks: subject share by shot kind, occlusion, shot timing, pop-in after a cut', async () => {
  const { L, LC } = await load();
  const framedOf = (svg: string) => L.framedBoxes(svg);
  const lensMark = '<g data-lens="1 0 0 540 960">';
  const ent = (id: string, b: number[], depth = 300) => `<g data-frame-kind="entity" data-frame-who="${id}" data-frame-box="${b.join(' ')}" data-frame-depth="${depth}"><rect/></g>`;
  // a small puppy (1.2%) is fine in a wide, too small in a close; the message never says "push in"
  const pup = [400, 900, 520, 1110]; // 120 x 210 = 1.2%
  const one = (kind: string) => {
    const shot = { at: 0, kind, subject: 'puppy', cast: ['puppy'] };
    return LC.subjectShareProblems([{ t: 0.3, svg: `${lensMark}${ent('puppy', pup)}</g>` }], { shotAt: () => ({ i: 0, shot }), framedOf });
  };
  assert.deepEqual(one('wide'), []);
  const close = one('close');
  assert.equal(close.length, 1);
  assert.doesNotMatch(close[0], /push in/i);
  assert.match(close[0], /wide|angle/);
  // occlusion: a sofa drawn in front hides most of the puppy
  const shot = { at: 0, kind: 'medium', subject: 'puppy', cast: ['puppy', 'sofa'] };
  const occ = LC.subjectOcclusionProblems([{ t: 0.4, svg: `${lensMark}${ent('puppy', [400, 900, 600, 1100], 300)}${ent('sofa', [350, 950, 800, 1300], 250)}</g>` }], { shotAt: () => ({ i: 0, shot }), framedOf });
  assert.equal(occ.length, 1);
  assert.match(occ[0], /hidden behind "sofa"/);
  // the same sofa behind the puppy (painted first) is fine
  assert.deepEqual(LC.subjectOcclusionProblems([{ t: 0.4, svg: `${lensMark}${ent('sofa', [350, 950, 800, 1300], 400)}${ent('puppy', [400, 900, 600, 1100], 300)}</g>` }], { shotAt: () => ({ i: 0, shot }), framedOf }), []);
  // timing: a 0.5 s shot, a cut 0.3 s in, a cut 0.2 s before the end
  const tp = LC.shotTimingProblems([{ at: 0 }, { at: 0.3 }, { at: 1.5 }, { at: 2.0 }, { at: 3.8 }], 4);
  assert.ok(tp.some((m: string) => /shot 3 lasts 0\.50s/.test(m)));
  assert.ok(tp.some((m: string) => /shot 2's cut at 0\.30s is within 0\.5s of the frame's start/.test(m)));
  assert.ok(tp.some((m: string) => /shot 5's cut at 3\.80s is within 0\.5s of the frame's end/.test(m)));
  assert.deepEqual(LC.shotTimingProblems([{ at: 0 }, { at: 1.2 }, { at: 2.4 }], 4), []);
  // pop-in: the bowl appears 0.2 s after the cut
  const cutShots = [{ at: 0 }, { at: 1 }];
  const pop = [1, 1.1, 1.2, 1.3].map((t) => ({ t, svg: `${lensMark}${ent('puppy', pup)}${t >= 1.2 ? ent('bowl', [700, 1200, 800, 1260]) : ''}</g>` }));
  const pp = LC.popInProblems(pop, { shots: cutShots, framedOf });
  assert.equal(pp.length, 1);
  assert.match(pp[0], /"bowl" appears 0\.20s after shot 2's cut/);
  assert.deepEqual(LC.popInProblems(pop.map((s) => ({ ...s, svg: `${lensMark}${ent('puppy', pup)}${ent('bowl', [700, 1200, 800, 1260])}</g>` })), { shots: cutShots, framedOf }), []);
});

test('fill rule: content under 6% of the frame for more than 1 s is flagged, one instant is not', async () => {
  const { T, LC, L } = await load();
  const scan = scanOf(T);
  const framedOf = L.framedBoxes;
  const lensMark = '<g data-lens="1 0 0 540 960">';
  const ent = (id: string, b: number[]) => `<g data-frame-kind="entity" data-frame-who="${id}" data-frame-box="${b.join(' ')}"><rect x="${b[0]}" y="${b[1]}" width="${b[2] - b[0]}" height="${b[3] - b[1]}"/></g>`;
  const lone = `${lensMark}${ent('cup', [500, 1000, 580, 1080])}</g>`;
  const full = `${lensMark}${ent('desk', [200, 800, 900, 1400])}</g>`;
  const at = (ts: number[], svg: (t: number) => string) => ts.map((t) => ({ t, svg: svg(t) }));
  const ts = Array.from({ length: 30 }, (_, i) => i / 10);
  assert.equal(LC.MIN_CONTENT, 0.06, 'X is the near-empty threshold');
  assert.equal(LC.sparseProblems(at(ts, () => lone), { scanOf: scan, framedOf }).length, 1, 'a lone small object for 3 s');
  assert.deepEqual(LC.sparseProblems(at(ts, (t) => (t < 0.8 ? lone : full)), { scanOf: scan, framedOf }), [], 'under 1 s is fine');
  assert.deepEqual(LC.sparseProblems(at(ts, (t) => (Math.round(t * 10) % 5 === 0 ? full : lone)), { scanOf: scan, framedOf }), [], 'broken runs are fine');
  // a flat picture: its drawn pieces count
  assert.equal(LC.sparseProblems(at(ts, () => '<rect x="500" y="900" width="60" height="60"/>'), { scanOf: scan }).length, 1);
  assert.deepEqual(LC.sparseProblems(at(ts, () => '<rect x="200" y="700" width="600" height="600"/>'), { scanOf: scan }), []);
});

test('closeups show a relationship: a close whose only thing in frame is a lone label is flagged', async () => {
  const { T, LC, L } = await load();
  const scan = scanOf(T);
  const framedOf = L.framedBoxes;
  const lensMark = '<g data-lens="1 0 0 540 960">';
  const pill = `<g data-frame-kind="entity" data-frame-who="score" data-frame-box="300 900 780 1040"><rect x="300" y="900" width="480" height="140" rx="70"/><text x="400" y="990" font-size="64">+12</text></g>`;
  const dog = `<g data-frame-kind="critter" data-frame-who="dog" data-frame-box="200 1000 500 1500"><rect x="200" y="1000" width="300" height="500"/></g>`;
  const shots = [{ at: 0, kind: 'insert', camera: CAM, subject: 'score', cast: ['score'] }];
  const shotAt = () => ({ i: 0, shot: shots[0] });
  const s = (svg: string) => [0, 0.5, 1].map((t) => ({ t, svg: `${lensMark}${svg}</g>` }));
  assert.equal(LC.loneCloseProblems(s(pill), { shotAt, framedOf, scanOf: scan }).length, 1, 'a lone score pill');
  assert.deepEqual(LC.loneCloseProblems(s(pill + dog), { shotAt, framedOf, scanOf: scan }), [], 'the pill with who it scores');
  const wide = () => ({ i: 0, shot: { ...shots[0], kind: 'wide' } });
  assert.deepEqual(LC.loneCloseProblems(s(pill), { shotAt: wide, framedOf, scanOf: scan }), [], 'only closes and inserts');
});
