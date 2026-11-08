/**
 * Explainers 4.2 layering (tonight's live renders): the critter's body stack (body, its light, the
 * outfit's torso, the face as one group, sleeved arms over the torso, held props) and the world's
 * paint order (a critter beside a tall fridge; a car behind a fence). Offline: no model, no browser.
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
    lens: await import('../explainers/world-kit/lens.js'),
    set: await import('../explainers/world-kit/set.js'),
    cast: await import('../explainers/world-kit/cast.js'),
  };
  return M;
}
const at = (svg: string, part: string) => svg.indexOf(`data-part="${part}"`);
const COAT = { top: { kind: 'coat', color: 'lilac' } };

test('1, 5, 6: the body light is drawn on the body, under the outfit, the face and the arms', async () => {
  const { draw, lens: K } = await kit();
  draw.scope('lay1-', 'stage');
  const P = K.lens({ pos: [0, -400, 90], target: [0, 0, 40], fov: 40 });
  const R = K.rig(P, { mood: 'night', points: [{ pos: [80, 60, 120], level: 0.8, reach: 200, color: 'warm' }] });
  const svg = K.critterAt(P, 0, 0, 0, { who: 'x', body: 'orange', outfit: COAT, arms: 'wave' }, R).svg;
  const order = ['body', 'body-light', 'outfit', 'face', 'arm-l', 'arm-r'].map((p) => at(svg, p));
  assert.ok(order.every((i) => i >= 0), `every layer is drawn: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'body < its light < outfit < face < arms');
  assert.equal((svg.match(/data-light="rim"/g) ?? []).length, 1, 'the rims live inside the critter, once');
  // the stage's rim filter lights the body alone, never the outfit
  const body = svg.slice(at(svg, 'body'), at(svg, 'body-light'));
  assert.match(body, /data-part="body" filter="url\(#/);
  assert.ok(!/data-part="outfit"[^>]*filter=/.test(svg));
});

test('4, 6: both arms are always over the torso, sleeved in the outfit colour, whatever the hands do', async () => {
  const { draw, cast } = await kit();
  draw.scope('lay4-', 'paper');
  for (const arms of ['down', 'wave', 'point', 'hold', 'out', { l: [-70, -10], r: [90, -60] }, { l: [-30, -40], r: [30, -40] }]) {
    const svg = cast.critter(0, 0, { body: 'ink', outfit: COAT, arms, rig: typeof arms === 'object' });
    const o = at(svg, 'outfit');
    for (const side of ['l', 'r']) assert.ok(at(svg, `arm-${side}`) > o, `${JSON.stringify(arms)}: the ${side} arm over the torso`);
  }
  // a sleeveless top now sleeves its arms in its own colour (short); a given sleeves wins
  assert.equal(cast.normalizeOutfit({ top: { kind: 'apron', color: 'yellow' } }).sleeves, 'yellow');
  assert.equal(cast.normalizeOutfit({ top: { kind: 'apron', color: 'yellow' } }).sleeveLen, 'short');
  assert.equal(cast.normalizeOutfit({ top: { kind: 'vest', color: 'yellow', under: 'blue' } }).sleeves, 'blue');
  assert.equal(cast.normalizeOutfit({ top: { kind: 'apron', color: 'yellow' }, sleeves: false }).sleeves, false);
  // a raised arm beside the head keeps its sleeve (only an arm crossing the body stops short of the face)
  const raised = cast.critter(0, 0, { body: 'ink', outfit: COAT, arms: { l: [-74, -50], r: [70, -150] }, rig: true });
  const armR = raised.slice(at(raised, 'arm-r'));
  assert.ok(armR.includes('stroke-linejoin="round"'), 'the raised arm is sleeved');
});

test('the face is one group: eyes, brows, mouth and head garment together, after the torso', async () => {
  const { draw, cast } = await kit();
  draw.scope('lay5-', 'paper');
  const svg = cast.critter(0, 0, { body: 'paper', outfit: { ...COAT, head: { kind: 'beanie', color: 'blue' } } });
  const face = svg.slice(at(svg, 'face'), at(svg, 'arm-l'));
  assert.ok(/data-outfit="head"/.test(face), 'the head garment rides with the face');
  assert.ok(!/data-part="arm-/.test(face), 'no arm inside the face group');
  assert.ok(at(svg, 'outfit') < at(svg, 'face'));
});

test('2: a critter beside a tall fridge, the lens level with the fridge side, paints in front of it, and stays there as it steps', async () => {
  const { lens: K } = await kit();
  const P = K.lens({ pos: [-7930, -6215, 70], target: [-7890, -5800, 60], fov: 50 });
  const fridge = { svg: '<g id="fridge"/>', at: [-7890, -5815, 64], bounds: [[-7930, -5847, 0], [-7850, -5784, 128]] };
  for (let x = -8020; x <= -7900; x += 10) {
    const critter = { svg: '<g data-frame-kind="critter" data-frame-who="c"></g>', at: [x, -5888, 36] };
    const order = K.byDistance(P, [critter, fridge]).map((it: any) => (it === fridge ? 'fridge' : 'critter'));
    assert.deepEqual(order, ['fridge', 'critter'], `critter at x ${x}`);
  }
});

test('3: a fence nearer the lens than a car on the road paints over it; one beyond it paints under', async () => {
  const { draw, lens: K, set: S } = await kit();
  draw.scope('lay3-', 'paper');
  const near = K.lens({ pos: [1400, 1200, 140], target: [0, 1200, 60], fov: 44 });
  const res = S.exterior(near, K.rig(near), 'road');
  const bays = res.items.filter((it: any) => it.tell === 'a fence');
  assert.ok(bays.length > 10 && bays.every((b: any) => Array.isArray(b.bounds)), 'the fence is items with world boxes, not background');
  assert.ok(!res.env.some((e: any) => e.part === 'fence'));
  const car = { svg: '<g id="car"/>', at: [-110, 1200, 60], bounds: [[-200, 1000, 0], [-20, 1400, 120]] };
  const bay = bays.find((b: any) => b.bounds[0][1] <= 1200 && b.bounds[1][1] >= 1200);
  const order = (P: any) => K.byDistance(P, [bay, car]).map((it: any) => (it === car ? 'car' : 'fence'));
  assert.deepEqual(order(near), ['car', 'fence'], 'the lens beyond the fence: the fence over the car');
  const far = K.lens({ pos: [-1200, 1200, 140], target: [0, 1200, 60], fov: 44 });
  assert.deepEqual(order(far), ['fence', 'car'], 'the lens on the road side: the car over the fence');
  // kerbs stand too
  const P = K.lens(S.EXTERIOR_VIEWS.street.wide);
  const st = S.exterior(P, K.rig(P), 'street');
  assert.ok(st.items.some((it: any) => it.part === 'kerb') && !st.env.some((e: any) => e.part === 'kerb'));
});
