/**
 * Kit visual fixes from the job 87/88 review (2026-11-24): the logo halo, insert focus by intent,
 * group drawers sorted per member, the readout primitive for window text, the face-cut guard and
 * extras hidden behind critters. Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const load = async () => ({
  L: (await import('../explainers/world-kit/lens.js')) as any,
  F: (await import('../explainers/world-kit/scene-fit.js')) as any,
  C: (await import('../explainers/world-kit/cards.js')) as any,
  K: (await import('../explainers/world-kit/close.js')) as any,
});

test('close: the logo sits on an orange halo wider than the mark', async () => {
  const { K } = await load();
  const svg = K.halo(540, 900, 300);
  assert.match(svg, /data-role="halo"/);
  assert.match(svg, /f08-halo/);
  const r = Number(/<circle[^>]*\sr="([\d.]+)"/.exec(svg)?.[1]);
  assert.ok(r >= 150 * K.HALO_R - 1, `halo radius ${r}`);
});

test('shotFocus: close and insert shots focus on their subject; focus:false keeps them sharp', async () => {
  const { L } = await load();
  assert.deepEqual(L.shotFocus({ kind: 'insert', subject: 'phone' }), { reason: 'insert', on: 'phone', implied: true });
  assert.equal(L.shotFocus({ kind: 'close', cast: ['cat'] })?.on, 'cat');
  assert.equal(L.shotFocus({ kind: 'insert', subject: 'phone', focus: false }), null);
  assert.equal(L.shotFocus({ kind: 'wide', subject: 'phone' }), null);
  assert.equal(L.shotFocus({ kind: 'wide', focus: { on: 'x' } })?.on, 'x');
});

test('groupParts: a group drawer splits into members that keep the group id', async () => {
  const { L } = await load();
  const it = { id: 'dogs', at: [0, 0, 0], parts: ['<g/>', { svg: '<g/>', at: [100, 0, 0] }] };
  const parts = L.groupParts(it);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p: any) => p.id === 'dogs'));
  assert.deepEqual(parts[0].at, [0, 0, 0]);
  assert.deepEqual(parts[1].at, [100, 0, 0]);
  assert.deepEqual(L.groupParts({ id: 'one', svg: '<g/>' }), [{ id: 'one', svg: '<g/>' }]);
});

test('readout: one size fits the longest line, and chars types it in place', async () => {
  const { C } = await load();
  const box = { x: 0, y: 0, w: 370, h: 125 };
  const a = C.readout('4817×263', box, { fitTo: ['1,266,871'] });
  const b = C.readout('1,266,871', box, { fitTo: ['4817×263'] });
  const size = (s: string) => /font-size="([\d.]+)"/.exec(s)?.[1];
  assert.match(a, /data-ui="readout"/);
  assert.equal(size(a), size(b));
  assert.match(C.readout('1,266,871', box, { chars: 3 }), />1,2</);
});

test('cutCritters counts frames with a critter face cut by the edge', async () => {
  const { F } = await load();
  const c = (box: number[]) => ({ kind: 'critter', who: 'a', box, depth: 1 });
  assert.equal(F.cutCritters([[c([400, 900, 700, 1300])]]), 0);
  assert.equal(F.cutCritters([[c([-250, 900, 50, 1300])], [c([400, 900, 700, 1300])]]), 1);
  assert.equal(F.cutCritters(null), 0);
});

test('occlusion: a cast extra mostly behind a nearer critter is flagged; beside it is fine', async () => {
  const { L } = await load();
  const shot = { at: 0, kind: 'wide', on: [540, 1000], cast: ['learner', 'dogs'] };
  const learner = { kind: 'critter', who: 'learner', box: [300, 800, 700, 1400], depth: 300 };
  const behind = { kind: 'entity', who: 'dogs', box: [350, 1000, 650, 1200], depth: 500 };
  const beside = { kind: 'entity', who: 'dogs', box: [720, 1000, 1000, 1200], depth: 500 };
  const run = (e: object) => L.occlusionProblems([{ t: 0, boxes: [learner, e] }], { shots: [shot] }).join('|');
  assert.match(run(behind), /"dogs" is 100% hidden behind the critter "learner"/);
  assert.doesNotMatch(run(beside), /dogs/);
});
