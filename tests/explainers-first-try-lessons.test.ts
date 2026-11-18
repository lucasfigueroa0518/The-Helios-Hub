// The first-try lessons designed out at the source (2026-11-17): the cut rule as geometry
// (shots.js snapCuts, shot.picture, sameFraming), text placed by code (layout.js placeText, inSafe,
// viewSafe under a crop shot), and the layout checks judging what rests (a chip in flight, a word on
// its magnet on the fridge). Offline: no model, no render.
import assert from 'node:assert/strict';
import test from 'node:test';

const KIT = '../explainers/world-kit';
const load = async () => {
  const T = await import(`${KIT}/try.mjs`); // registers the hooks the kit's modules load under
  const S = await import(`${KIT}/shots.js`);
  const LY = await import(`${KIT}/layout.js`);
  const LC = await import(`${KIT}/layout-checks.mjs`);
  const X = await import(`${KIT}/explain.js`);
  return { T, S, LY, LC, X };
};
const scanOf = (T: any) => (svg: string) => T.drawnElements(svg);
const CAM = { pos: [0, -400, 120], target: [0, 0, 60], fov: 40 };

test('snapCuts pulls the wider shot back to 2×; the tighter shot keeps its size', async () => {
  const { S } = await load();
  const shots = [{ at: 0, kind: 'medium' }, { at: 2, kind: 'close' }, { at: 4, kind: 'medium' }];
  assert.ok(S.jumpCutProblems(shots, { duration: 6 }).length >= 1, 'medium → close (1.6×) is a jump cut as declared');
  const out = S.snapCuts(shots);
  assert.equal(out[1], shots[1], 'the close is drawn as composed');
  assert.ok(out[0].zoom >= 1 && out[0].zoom <= 2.4 / 2 + 1e-9, `the medium before it is pulled back (${out[0].zoom})`);
  assert.ok(out[2].zoom <= 2.4 / 2 + 1e-9, 'the medium after it too');
  assert.deepEqual(S.jumpCutProblems(out, { duration: 6 }), []);
  assert.equal(S.snapCuts(shots), out, 'the same list in gives the same list out');
  assert.equal(out[0].snapped.zoom, 1.5);
});

test('snapCuts leaves a new picture, the same framing, a bridge and an unfixable nudge alone', async () => {
  const { S } = await load();
  const pic = [{ at: 0, kind: 'medium', zoom: 1, picture: 'chat' }, { at: 2, kind: 'close', zoom: 1.2, picture: 'tokens' }];
  assert.deepEqual(S.snapCuts(pic), pic);
  const same = [{ at: 0, kind: 'medium', zoom: 1 }, { at: 2, kind: 'insert', zoom: 1 }];
  assert.ok(S.sameFraming(same[0], same[1], 2, 2));
  assert.deepEqual(S.snapCuts(same), same);
  const carried = [{ at: 0, kind: 'medium' }, { at: 2, kind: 'close', carry: 'chip box 400 900 600 1000' }];
  assert.deepEqual(S.snapCuts(carried), carried);
  // 1.0 → 1.3 on one drawing: pulling the first shot back would shrink the drawing under zoom 1
  const nudge = [{ at: 0, kind: 'medium', zoom: 1 }, { at: 2, kind: 'close', zoom: 1.3 }];
  assert.deepEqual(S.snapCuts(nudge), nudge);
  assert.equal(S.jumpCutProblems(nudge, { duration: 4 }).length, 1, 'the check still names it');
});

test('snapCuts pulls a camera back along its line to the subject, the angle kept', async () => {
  const { S } = await load();
  const near = { ...CAM, pos: [0, -276, 99] }; // ~1.45× closer to the subject
  const shots = [
    { at: 0, kind: 'wide', camera: CAM, subject: 'student', cast: ['student'] },
    { at: 2, kind: 'medium', camera: near, subject: 'student', cast: ['student'] },
  ];
  assert.equal(S.jumpCutProblems(shots, { duration: 4 }).length, 1);
  const out = S.snapCuts(shots);
  assert.equal(out[1], shots[1], 'the closer shot is untouched');
  assert.deepEqual(out[0].camera.target, CAM.target);
  const dir = (p: number[]) => { const v = p.map((x, k) => x - CAM.target[k]); const l = Math.hypot(...v); return v.map((x) => x / l); };
  dir(out[0].camera.pos).forEach((x, k) => assert.ok(Math.abs(x - dir(CAM.pos)[k]) < 1e-3, 'same angle'));
  assert.deepEqual(S.jumpCutProblems(out, { duration: 4 }), []);
});

test('shotFrame draws the snapped list, and viewSafe is the safe area under its crop', async () => {
  const { T, S, LY } = await load();
  const shots = [{ at: 0, kind: 'medium', on: [540, 1000] }, { at: 2, kind: 'close', on: [540, 1000] }];
  const seen: any[] = [];
  const svg = String(S.shotFrame(0.5, shots, (shot: any) => {
    seen.push(shot);
    const s = LY.viewSafe();
    return `<rect data-probe="1" x="${s.x0}" y="${s.y0}" width="${s.x1 - s.x0}" height="${s.y1 - s.y0}"/>`;
  }));
  assert.ok(seen[0].zoom < 1.5, 'the medium is drawn pulled back');
  const probe = T.drawnElements(svg).elements.find((e: any) => e.tag === 'rect' && e.box && e.box.w > 300);
  assert.ok(probe, 'the probe is drawn');
  const b = probe.box;
  for (const [got, want] of [[b.x, 96], [b.y, 570], [b.x + b.w, 940], [b.y + b.h, 1600]]) assert.ok(Math.abs(got - want) < 1.5, `on screen the probe is the safe area (${got} vs ${want})`);
  assert.deepEqual(LY.viewSafe(), { ...LY.SAFE }, 'outside shotFrame the safe area is the screen\'s');
});

test('placeText keeps clear of objects and inside the safe area; inSafe moves a box in', async () => {
  const { LY } = await load();
  const fridge = [300, 500, 800, 1300];
  const p = LY.placeText({ w: 200, h: 60 }, { near: [550, 900], avoid: [fridge] });
  assert.ok(p.clear);
  assert.ok(p.x >= 96 && p.x + p.w <= 940 && p.y >= 570 && p.y + p.h <= 1600, 'inside the safe area');
  const gapX = Math.max(fridge[0] - (p.x + p.w), p.x - fridge[2]);
  const gapY = Math.max(fridge[1] - (p.y + p.h), p.y - fridge[3]);
  assert.ok(Math.max(gapX, gapY) >= LY.MIN_GAP, 'MIN_GAP off the fridge');
  const free = LY.placeText({ w: 200, h: 60 }, { near: [500, 900] });
  assert.deepEqual([free.cx, free.cy], [500, 900], 'nothing to avoid: exactly where wished');
  const m = LY.inSafe({ x: 800, y: 1580, w: 200, h: 50 });
  assert.deepEqual([m.x, m.y, m.dx, m.dy], [740, 1550, -60, -30]);
});

test('layout checks judge what rests: a word on its magnet on the fridge, a chip in flight', async () => {
  const { T, LC } = await load();
  const scan = scanOf(T);
  const fridge = '<g data-object="fridge"><rect x="300" y="500" width="500" height="800"/></g>';
  const magnet = (x: number) => `<g data-who="magnets"><rect x="${x}" y="900" width="140" height="70"/><text x="${x + 10}" y="950" font-size="40">view</text></g>`;
  // a word written on its own magnet, the magnet on the fridge: no text over the fridge
  assert.deepEqual(LC.textOverObjectProblems([{ t: 0, svg: fridge + magnet(400) }], { scanOf: scan }), []);
  // a free word at rest over the fridge is still caught
  const free = (x: number) => `<text x="${x}" y="950" font-size="40">view</text>`;
  const rest = [0, 0.1, 0.2].map((t) => ({ t, svg: fridge + free(400) }));
  assert.equal(LC.textOverObjectProblems(rest, { scanOf: scan }).length, 1);
  // the same word flying across the fridge is motion, not placement
  const flight = [0, 0.1, 0.2].map((t, k) => ({ t, svg: fridge + free(200 + k * 150) }));
  assert.deepEqual(LC.textOverObjectProblems(flight, { scanOf: scan }), []);
  // UI: a token chip flying through a label is not a spacing problem; one parked on its edge is
  const label = '<g data-ui="meter"><text x="300" y="900" font-size="40">reading limit</text></g>';
  const chip = (x: number) => `<g data-ui="chip"><rect x="${x}" y="860" width="120" height="60"/></g>`;
  const flying = [0, 0.1, 0.2].map((t, k) => ({ t, svg: label + chip(200 + k * 120) }));
  assert.deepEqual(LC.uiCollisionProblems(flying, { scanOf: scan }), []);
  const parked = [0, 0.1, 0.2].map((t) => ({ t, svg: label + chip(500) }));
  assert.equal(LC.uiCollisionProblems(parked, { scanOf: scan }).length, 1);
});

test('try jumpCuts: a new picture and the same framing are clean cuts; a nudge names picture', async () => {
  const { T, S } = await load();
  const samples = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => ({ t, svg: '<g></g>' }));
  const same = [{ at: 0, kind: 'medium', zoom: 1 }, { at: 1.5, kind: 'close', zoom: 1 }];
  assert.deepEqual(T.jumpCuts(same, samples, 3, S), []);
  const pics = [{ at: 0, kind: 'medium', zoom: 1, picture: 'a' }, { at: 1.5, kind: 'close', zoom: 1.3, picture: 'b' }];
  assert.deepEqual(T.jumpCuts(pics, samples, 3, S), []);
  const nudge = [{ at: 0, kind: 'medium', zoom: 1 }, { at: 1.5, kind: 'close', zoom: 1.3 }];
  const e = T.jumpCuts(nudge, samples, 3, S);
  assert.equal(e.length, 1);
  assert.match(e[0], /picture: '…'/);
  assert.deepEqual(T.jumpCuts([{ at: 0, kind: 'medium' }, { at: 1.5, kind: 'close' }], samples, 3, S), [], 'kinds alone: snapped clean');
});

test('meter: its name sits clear of the track and the fill glow', async () => {
  const { T, LC, X } = await load();
  const G = await import(`${KIT}/glass.js`);
  const svg = String(X.meter(200, 900, 500, { value: 0.5, name: 'reading limit', h: 36 }));
  // measured as the try measures (glass.js measure): the name's plate is its text's width
  assert.deepEqual(LC.uiCollisionProblems([{ t: 0, svg }], { scanOf: (s: string) => T.drawnElements(s, G.measure) }), []);
});
