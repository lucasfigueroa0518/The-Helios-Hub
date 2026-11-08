/**
 * Draw order of stacked, moving things (2026-11-03, Lucas: sheets glitching over the folder they go
 * into, and over each other while dealt out). Geometry from that reel's frame 02 (a top-down
 * insert: four sheets slide off a pile into an open folder). Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const load = async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const L = await import('../explainers/world-kit/lens.js');
  return { T, L };
};

const CAM = { pos: [-72, -25, 128], target: [-72, 46, 19], fov: 40 };
const DZ = 19;
const folder = { id: 'folder', at: [-75, 47, DZ + 1], bounds: [[-120, 36, DZ], [-60, 61, DZ + 2]], svg: '<g/>' };
const sheet = (id: string, c: number[], lift: number) => {
  const h = Math.max(1, lift + 1);
  const o = [c[0] - 12, c[1] - 9, c[2]];
  return { id, at: [c[0], c[1], c[2] + h / 2], bounds: [o, [o[0] + 24, o[1] + 18, c[2] + h]], svg: '<g/>' };
};
const lerp = (a: number[], b: number[], u: number) => a.map((v, i) => v + (b[i] - v) * u);

test('a sheet sliding into the open folder stays above it the whole way (no flip)', async () => {
  const { L } = await load();
  const P = L.lens(CAM);
  const from = [-48, 62, DZ];
  const to = [-74, 48, DZ + 0.6];
  const fronts: string[] = [];
  for (let k = 0; k <= 40; k++) {
    const u = k / 40;
    const s = sheet('rules_sheet', lerp(from, to, u), 4 * Math.sin(Math.PI * u) + 0.3);
    const ox = Math.min(s.bounds[1][0], -60) - Math.max(s.bounds[0][0], -120);
    if (ox <= 2) continue; // only grazing the folder's edge, still below its cover
    const order = L.byDistance(P, [s, folder]).map((it: any) => it.id);
    fronts.push(order[1]);
  }
  assert.ok(fronts.length > 5);
  assert.ok(fronts.every((f) => f === 'rules_sheet'), `front over time: ${fronts.join(',')}`);
});

test('a card dealt off the top rides above the pile it leaves, and the pile keeps its order', async () => {
  const { L } = await load();
  const P = L.lens(CAM);
  const pile = [0, 1, 2].map((k) => sheet(`card${k}`, [-30, 60, DZ + k * 0.4], 0));
  for (let k = 0; k <= 20; k++) {
    const u = k / 20;
    const top = sheet('card3', lerp([-30, 60, DZ + 1.2], [10, 20, DZ], u), 6 * Math.sin(Math.PI * u) + 0.2);
    const order = L.byDistance(P, [top, ...pile].reverse()).map((it: any) => it.id);
    assert.deepEqual(order.filter((id: string) => id !== 'card3'), ['card0', 'card1', 'card2'], `u=${u}`);
    const overlaps = top.bounds[0][0] < pile[0].bounds[1][0] && top.bounds[0][1] < pile[0].bounds[1][1];
    if (overlaps) assert.equal(order[order.length - 1], 'card3', `u=${u}: ${order}`);
  }
});

const ent = (who: string, box: number[]) => `<g data-frame-kind="entity" data-frame-who="${who}" data-frame-box="${box.join(' ')}"></g>`;

test('orderFlickerProblems flags a swap back and forth, not a single swap', async () => {
  const { T } = await load();
  const a = [100, 100, 300, 300];
  const b = [150, 150, 350, 350];
  const flick = ['ab', 'ba', 'ab'].map((o, i) => ({ t: i, svg: o === 'ab' ? ent('A', a) + ent('B', b) : ent('B', b) + ent('A', a) }));
  assert.equal(T.orderFlickerProblems(flick).length, 1);
  const crossing = ['ab', 'ab', 'ab', 'ba', 'ba', 'ba', 'ab', 'ab', 'ab'].map((o, i) => ({ t: i, svg: o === 'ab' ? ent('A', a) + ent('B', b) : ent('B', b) + ent('A', a) }));
  assert.equal(T.orderFlickerProblems(crossing).length, 0);
  const once = ['ab', 'ba', 'ba'].map((o, i) => ({ t: i, svg: o === 'ab' ? ent('A', a) + ent('B', b) : ent('B', b) + ent('A', a) }));
  assert.equal(T.orderFlickerProblems(once).length, 0);
});

test('pickNotTopProblems flags the bottom card moved first, not the top one', async () => {
  const { T } = await load();
  const box = (z: number, dx = 0) => [[dx, 0, z], [24 + dx, 18, z + 0.3]];
  const frames = (moving: 'low' | 'high') => [0, 1, 2, 3].map((i) => {
    const dx = i >= 2 ? (i - 1) * 10 : 0;
    const low = { id: 'low', bounds: box(0, moving === 'low' ? dx : 0) };
    const high = { id: 'high', bounds: box(0.4, moving === 'high' ? dx : 0) };
    return { t: i * 0.1, svg: '', paint: [[low, high]] };
  });
  const bad = T.pickNotTopProblems(frames('low'));
  assert.equal(bad.length, 1);
  assert.match(bad[0], /"low" starts to move .* from under "high"/);
  assert.equal(T.pickNotTopProblems(frames('high')).length, 0);
});

test('render() logs its paint order only while a recorder is set', async () => {
  const { L } = await load();
  const P = L.lens(CAM);
  const log: any[] = [];
  (globalThis as any).__hxPaintLog = log;
  L.render(P, { items: [folder, sheet('s', [-74, 48, DZ + 0.6], 0.3)] as never[] });
  (globalThis as any).__hxPaintLog = undefined;
  assert.deepEqual(log[0].map((x: any) => x.id), ['folder', 's']);
  L.render(P, { items: [folder] as never[] });
  assert.equal(log.length, 1);
});

test('a tilted sheet in flight stays above a landed tilted one it passes over; a critter is not stacked', async () => {
  const { L } = await load();
  const cam = { pos: [-24, -20, 165], target: [-24, 47, 19], fov: 60 };
  const P = L.lens(cam);
  const landed = { id: 'blue', at: [-8, 59, DZ + 5], bounds: [[-20, 50, DZ], [4, 68, DZ + 9.2]], svg: '<g/>' };
  const flying = { id: 'green', at: [-2, 52, DZ + 7], bounds: [[-14, 43, DZ + 1], [10, 61, DZ + 12]], svg: '<g/>' };
  assert.deepEqual(L.byDistance(P, [flying, landed]).map((it: any) => it.id), ['blue', 'green']);
  const critter = { id: 'c', at: [-8, 59, DZ + 19], bounds: [[-22, 45, DZ], [6, 73, DZ + 38]], svg: '<g/>' };
  const near = L.byDistance(P, [critter, landed]).map((it: any) => it.id);
  const far = L.byDistance(P, [landed, critter]).map((it: any) => it.id);
  assert.deepEqual(near, far); // decided by distance, as before
});
