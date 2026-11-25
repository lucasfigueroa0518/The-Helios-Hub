/**
 * VISUAL_SYSTEM_6 §5 the analogy frame, offline: the `room` ground (clean paper and the faint
 * drafting grid, no grain), no ground draws grain, the front-on room is flat (no gradient, filter
 * or outlined solid, no orange), the dusk room has slate walls, and every drawn subject is flat
 * with no orange. No model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const kit = async () => {
  const core: any = await import('../explainers/world-kit/core.js');
  const D: any = await import('../explainers/world-kit/draw.js');
  const L: any = await import('../explainers/world-kit/lens.js');
  const SET: any = await import('../explainers/world-kit/set.js');
  const DR: any = await import('../explainers/world-kit/drawn.js');
  const A: any = await import('../explainers/world-kit/analogy.js');
  return { core, D, L, SET, DR, A };
};

const orangeHexes = (T: Record<string, string>) =>
  Object.entries(T).filter(([k, v]) => /^(stage-)?orange/.test(k) && typeof v === 'string' && v.startsWith('#')).map(([, v]) => v.toLowerCase());

function assertFlat(svg: string, T: Record<string, string>, what: string) {
  assert.ok(!/Gradient/.test(svg), `${what}: no gradient`);
  assert.ok(!/<filter|filter=/.test(svg), `${what}: no filter`);
  assert.ok(!/feTurbulence/.test(svg), `${what}: no grain`);
  const low = svg.toLowerCase();
  for (const hex of orangeHexes(T)) assert.ok(!low.includes(hex), `${what}: no orange (${hex})`);
}

test('ground(room): clean paper with the 72 px grid at 4.5% ink, no grain', async () => {
  const { D } = await kit();
  const svg = D.ground('room');
  assert.match(svg, /fill="#F3F0EA"/);
  assert.match(svg, /stroke-opacity="0.045"/);
  assert.match(svg, /M72,0V/);
  assert.match(svg, /M0,72H/);
  assert.ok(!/feTurbulence|Gradient|filter/.test(svg));
});

test('no ground draws grain (feTurbulence absent from every ground)', async () => {
  const { core, D } = await kit();
  for (const name of new Set([...Object.keys(core.GROUNDS), 'room'])) {
    D.scope('t-', name === 'room' && !core.GROUNDS.room ? 'paper' : name);
    assert.ok(!/feTurbulence/.test(D.ground(name)), `ground ${name} has no grain`);
  }
});

test('frontRoom: flat, no outlined solids, no orange; dusk walls are slate', async () => {
  const { core, L, SET, A } = await kit();
  const P = L.lens(SET.frontCamera());
  const o = { windows: [{ x: -100, z: 120, w: 90, h: 100 }], rug: { x: [-100, 100], y: [40, 160] }, pendants: [{ x: 0 }] };
  const day = SET.frontRoom(P, null, o).env.map((e: any) => e.svg).join('');
  assertFlat(day, core.TOKENS, 'day room');
  assert.ok(!/<(polygon|rect)[^>]*\sstroke=/.test(day), 'solids carry no outline');
  assert.ok(day.includes(A.tok('wall')), 'day wall tone');
  const dusk = SET.frontRoom(P, null, { ...o, mood: 'dusk' }).env;
  const wall = dusk.find((e: any) => e.part === 'wall').svg;
  assertFlat(wall, core.TOKENS, 'dusk room');
  assert.ok(wall.includes(A.tok('slate-dark')), 'dusk walls are slate');
  assert.equal(A.roomMood('dusk').windows, 'dark');
  assert.equal(A.roomMood('dusk').lamps, true);
});

test('every drawn subject renders flat, no orange', async () => {
  const { core, DR } = await kit();
  assert.ok(Object.keys(DR.SUBJECTS).length >= 11);
  for (const [name, spec] of Object.entries<any>(DR.SUBJECTS)) {
    for (const view of Object.keys(spec.views)) {
      const svg = DR.drawnSvg(spec, { view });
      assertFlat(svg, core.TOKENS, `${name}.${view}`);
      assert.ok(svg.length > 100, `${name}.${view} draws`);
    }
  }
});

test('pillSvg: white, ink and green Helios pills', async () => {
  const { A } = await kit();
  assert.match(A.pillSvg('Dog', 100, 100), /fill="#FFFFFF"/i);
  assert.match(A.pillSvg('Ready', 100, 100, { kind: 'green' }), /<text/);
});
