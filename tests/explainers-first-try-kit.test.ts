/**
 * Explainers first-try errors designed out of the world kit (2026-11-17), offline: a camera shot
 * draws its place's DRESSING by itself (render + setlock.js), a culled sliver keeps its dressing
 * mark, a thing an earlier shot of the place cast stays drawn, and scene-fit.js prepareScene
 * frames each shot's subject inside the safe area, turns the camera off a blocker, and pulls a
 * pop-in after a cut to the cut. No model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

async function kit() {
  const shots: any = await import('../explainers/world-kit/shots.js');
  const lens: any = await import('../explainers/world-kit/lens.js');
  const setlock: any = await import('../explainers/world-kit/setlock.js');
  const fit: any = await import('../explainers/world-kit/scene-fit.js');
  const LC: any = await import('../explainers/world-kit/layout-checks.mjs');
  return { shots, lens, setlock, fit, LC };
}

const CAM = { pos: [0, -600, 120], target: [0, 0, 60], fov: 40 };
const rect = '<rect width="1" height="1"/>';

/** A box-shaped thing at world (x, y), `w` cm wide, marked as an entity. */
function thing(lens: any, P: any, id: string, x: number, y: number, w = 80, h = 80) {
  return { id, at: [x, y, h / 2], svg: lens.entity(P, id, [x - w / 2, y - w / 2, 0], [w, w, h], rect) };
}

test('a camera shot draws its place\'s dressing by itself; undress opts a piece out; a hand-drawn piece is not doubled', async () => {
  const { shots, lens, setlock, LC } = await kit();
  const world = {
    DRESSING: { main: [{ id: 'plant', at: [120, 40, 0] }] },
    LENS: { plant: (P: any, _R: any, _s: any, pose: any) => ({ id: 'plant', at: pose.at, svg: '<g data-x="plant"></g>' }) },
  };
  setlock.useWorld(world);
  const list = [
    { at: 0, kind: 'wide', camera: CAM, subject: 'box', cast: ['box'] },
    { at: 2, kind: 'medium', camera: CAM, subject: 'box', cast: ['box'], undress: ['plant'] },
  ];
  const draw = (t: number, items: (P: any) => any[] = () => []) => shots.shotFrame(t, list, (shot: any, local: number, _i: number, { P }: any) => {
    lens.rig(P, {});
    return [lens.render(P, { items: [thing(lens, P, 'box', 0, 0), ...items(P)], shot, local })];
  });
  const svg = draw(1);
  assert.match(svg, /data-dressing="plant"/);
  assert.doesNotMatch(draw(3), /data-dressing="plant"/);
  const hand = draw(1, (P) => [{ id: 'plant', at: [120, 40, 0], svg: '<g data-x="own-plant"></g>' }]);
  assert.equal((hand.match(/data-dressing="plant"/g) ?? []).length, 1);
  assert.match(hand, /own-plant/);
  // the set-lock check: drawn in shot 1, opted out in shot 2
  const samples = [{ t: 1, svg }, { t: 3, svg: draw(3) }];
  const opts = { placeAt: () => 'main', shotAt: (t: number) => (t < 2 ? 0 : 1), dressing: world.DRESSING };
  assert.equal(LC.setLockProblems(samples, opts).length, 1);
  assert.deepEqual(LC.setLockProblems(samples, { ...opts, undressAt: (t: number) => (t < 2 ? [] : ['plant']) }), []);
});

test('a dressing piece culled as an edge sliver keeps its dressing mark', async () => {
  const { lens } = await kit();
  const P = lens.lens(CAM);
  const wall = { id: 'wall', set: true, at: [900, 0, 60], bounds: [[110, -10, 0], [3000, 10, 120]], svg: '<g data-dressing="wall"><g data-x="wall-art"></g></g>' };
  assert.ok(lens.edgeSliver(P, wall));
  const svg = lens.render(P, { items: [wall], shot: { camera: CAM, cast: [], place: 'nowhere' } });
  assert.match(svg, /data-dressing="wall"/);
  assert.doesNotMatch(svg, /wall-art/);
});

test('a thing an earlier shot of the place cast stays drawn in a later shot that leaves it out', async () => {
  const { shots, lens } = await kit();
  const list = [
    { at: 0, kind: 'wide', camera: CAM, subject: 'board', cast: ['board', 'eraser'], place: 'lab' },
    { at: 2, kind: 'medium', camera: CAM, subject: 'board', cast: ['board'], place: 'lab' },
    { at: 4, kind: 'medium', camera: CAM, subject: 'board', cast: ['board'], place: 'lab', away: ['eraser'] },
  ];
  const draw = (t: number) => shots.shotFrame(t, list, (shot: any, local: number, _i: number, { P }: any) => [lens.render(P, { items: [thing(lens, P, 'board', 0, 0), thing(lens, P, 'eraser', 60, -40, 10, 6)], shot, local })]);
  assert.match(draw(3), /data-frame-who="eraser"/);
  assert.doesNotMatch(draw(5), /data-frame-who="eraser"/);
});

test('framePlan: slides a subject back inside the safe area, dollies a small one in, leaves a good one alone', async () => {
  const { fit } = await kit();
  const off = fit.framePlan([[40, 900, 300, 1200]], 'medium');
  assert.ok(off && off.dx >= 66 && Math.abs(off.zoom - 1) < 0.01);
  const small = fit.framePlan([[500, 1000, 560, 1060]], 'close');
  assert.ok(small && small.zoom > 1.5);
  assert.equal(fit.framePlan([[300, 800, 700, 1300]], 'medium'), null);
  assert.deepEqual(fit.SHARE_MIN, (await kit()).LC.SUBJECT_MIN_SHARE);
});

test('orbitCamera keeps its distance to the pivot; occludedShare measures what is drawn in front', async () => {
  const { fit } = await kit();
  const c = fit.orbitCamera(CAM, 30, 10, [0, 0, 60]);
  const d = (p: number[]) => Math.hypot(p[0], p[1], p[2] - 60);
  assert.ok(Math.abs(d(c.pos) - d(CAM.pos)) < 1e-6);
  const boxes = [
    { kind: 'entity', who: 'box', box: [400, 900, 600, 1100], depth: 600 },
    { kind: 'critter', who: 'ai', box: [400, 900, 500, 1100], depth: 400 },
  ];
  assert.ok(Math.abs(fit.occludedShare(boxes, 'box') - 0.5) < 0.06);
  assert.equal(fit.occludedShare(boxes.slice(0, 1), 'box'), 0);
});

test('prepareScene: the subject framed whole in the safe area, turned clear of a blocker, and no pop-in after a cut', async () => {
  const { shots, lens, fit, LC } = await kit();
  const list = [
    { at: 0, kind: 'medium', camera: CAM, subject: 'box', cast: ['box', 'post', 'ball'], place: 'lab' },
    { at: 2, kind: 'medium', camera: CAM, subject: 'crate', cast: ['crate', 'post', 'ball'], place: 'lab' },
    { at: 4, kind: 'medium', camera: { ...CAM, pos: [0, -700, 140] }, subject: 'box', cast: ['box', 'ball'], place: 'lab' },
  ];
  const scene = {
    ground: 'room',
    shots: list,
    draw: (t: number) => shots.shotFrame(t, list, (shot: any, local: number, _i: number, { P }: any) => [lens.render(P, {
      items: [
        thing(lens, P, 'box', -100, 0), // left: cut by the frame edge in shots 1 and 3
        thing(lens, P, 'crate', 50, 150),
        thing(lens, P, 'post', 30, -250, 40, 200), // stands between the lens and the crate
        ...(t >= 4.15 ? [thing(lens, P, 'ball', 10, -60, 20, 20)] : []), // pops in 0.15 s after the cut
      ],
      shot,
      local,
    })]),
  };
  const times = Array.from({ length: 60 }, (_, k) => k * 0.1);
  const shotAt = (t: number) => shots.shotAt(t, list);
  const framedOf = lens.framedBoxes;
  const problems = (s: any) => {
    const samples = times.map((t) => ({ t, svg: String(s.draw(t)) }));
    return [
      ...lens.framingProblems(samples, { shots: list }),
      ...LC.subjectOcclusionProblems(samples, { shotAt, framedOf }),
      ...LC.popInProblems(samples, { shots: list, framedOf }),
    ];
  };
  const before = problems(scene);
  assert.ok(before.some((p: string) => /subject "box"/.test(p)), before.join('\n'));
  assert.ok(before.some((p: string) => /occlusion: shot 2's subject "crate"/.test(p)), before.join('\n'));
  assert.ok(before.some((p: string) => /pop_in: "ball"/.test(p)), before.join('\n'));
  const ready = fit.prepareScene(scene, { duration: 6 });
  assert.deepEqual(problems(ready), []);
  const fits = ready.fits();
  assert.ok(fits.cameras[1] && fits.cameras[2]);
  assert.ok(fits.popIn[3] > 0 && fits.popIn[3] <= 0.3);
  // opt-outs: fit: false keeps the shot's own camera; popIn: false keeps the action's own time
  const list2 = list.map((s, k) => (k === 0 ? { ...s, fit: false } : k === 2 ? { ...s, popIn: false } : s));
  const ready2 = fit.prepareScene({ ...scene, shots: list2 }, { duration: 6 });
  ready2.draw(1);
  ready2.draw(4.05);
  assert.equal(ready2.fits().cameras[1], undefined);
  assert.equal(ready2.fits().popIn[3], undefined);
});

test('warpTime holds the shift through the pop-in window, then eases back onto the voice clock', async () => {
  const { fit } = await kit();
  const w = { cut: 2, delta: 0.2, span: 1 };
  assert.equal(fit.warpTime(1.9, w), 1.9);
  assert.ok(Math.abs(fit.warpTime(2, w) - 2.2) < 1e-9);
  assert.ok(Math.abs(fit.warpTime(2.29, w) - 2.49) < 1e-9);
  assert.ok(Math.abs(fit.warpTime(2.8, w) - 2.9) < 1e-9);
  assert.equal(fit.warpTime(3.5, w), 3.5);
  assert.equal(fit.popInShift([0, 0.1, 0.2], [new Set(['a']), new Set(['a']), new Set(['a'])]), 0);
});

test('mount draws the frame through prepareScene when the job kit has scene-fit.js', async () => {
  const { frameHtml }: any = await import('../explainers/world-kit/mount.mjs');
  const html = frameHtml('04-analogy', 9, 'room', { fit: true, world: true });
  assert.match(html, /import frameScene from '\.\/assets\/frames\/04-analogy\.js';/);
  assert.match(html, /import \{ prepareScene \} from '\.\/assets\/kit\/scene-fit\.js';/);
  assert.match(html, /const scene = prepareScene\(frameScene, \{ duration: 9, world: reelWorld \}\);/);
  assert.match(frameHtml('04-analogy', 9, 'room'), /import scene from '\.\/assets\/frames\/04-analogy\.js';/);
});

test('each composition namespaces its drawn ids, so frame 1 drawing frame 2 cannot steal its clip paths', async () => {
  const { frameHtml }: any = await import('../explainers/world-kit/mount.mjs');
  const html = frameHtml('02-define', 5, 'paper', { fit: true, world: true });
  const src = html.match(/const ns = (\(s\) => .*?);\n/)?.[1];
  assert.ok(src, 'the mount template namespaces ids');
  assert.match(html, /world\.innerHTML = svg\(ns\(scene\.draw\(t\)\)\)/);
  const ns = new Function(`return ${src}`)();
  const drawn = '<defs><clipPath id="f02-c1"><path d="M0 0"/></clipPath><linearGradient id="f02-l1"/></defs><g clip-path="url(#f02-c1)" data-id="x"><path fill="url(#f02-l1)"/><use href="#f02-l1"/></g>';
  const out = ns(drawn);
  assert.match(out, / id="f02_define-f02-c1"/);
  assert.match(out, /clip-path="url\(#f02_define-f02-c1\)"/);
  assert.match(out, /fill="url\(#f02_define-f02-l1\)"/);
  assert.match(out, /href="#f02_define-f02-l1"/);
  assert.match(out, /data-id="x"/);
  // frame 1 drawing the same scene gets different ids
  const opener = frameHtml('01-opener', 1, 'paper', { fit: true, world: true }).match(/const ns = (\(s\) => .*?);\n/)?.[1];
  assert.notEqual(new Function(`return ${opener}`)()(drawn), out);
});
