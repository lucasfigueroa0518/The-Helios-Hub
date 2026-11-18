/**
 * Explainers hx-6 hands on things and cast continuity, offline: handPlace keeps a placed thing in
 * the hand until it is let go at its spot, handWrite keeps the tool's point on the marks' growing
 * end, both refuse a spot out of the stub arm's reach; shotFrame keeps a critter drawn in every
 * later shot of its place (castItems and render), castContinuityProblems flags a shot list that
 * drops one, and try.mjs handProblems flags a thing that travels on after a critter lets go.
 * No model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

async function kit() {
  const tr: any = await import('../explainers/world-kit/try.mjs');
  const cast: any = await import('../explainers/world-kit/cast.js');
  const shots: any = await import('../explainers/world-kit/shots.js');
  const lens: any = await import('../explainers/world-kit/lens.js');
  const cont: any = await import('../explainers/world-kit/continuity.js');
  return { tr, cast, shots, lens, cont };
}

test('reachProblems / reachSpot: the stub arm reaches a spot beside the critter, not one 80 cm away', async () => {
  const { cast } = await kit();
  const slot = [-80, 229, 60];
  assert.ok(cast.reachProblems([-162, 212, 0], slot).some((p: string) => /to the side/.test(p)));
  assert.deepEqual(cast.reachProblems(cast.reachSpot(slot), slot), []);
  assert.ok(cast.reachProblems([-80, 212, 0], [-80, 229, 140]).some((p: string) => /cm up/.test(p)));
});

test('handPlace: the thing is in the hand until release, then at its spot; out of reach it tosses', async () => {
  const { cast } = await kit();
  const to = [-80, 229, 60];
  const p = cast.handPlace({ hold: 'card', to, at: 2, dur: 0.6, standAt: cast.reachSpot(to) });
  assert.equal(p.thingAt(2.3), null);
  assert.ok(p.held(2.3));
  assert.deepEqual(p.thingAt(p.release + 0.01), to);
  // the reach that carries it ends at the spot, holding the thing; the next key lets go there
  const carry = p.keys.find((k: any) => k.hold?.r);
  assert.deepEqual(carry.reach, to);
  const letGo = p.keys.find((k: any) => k.hold && !k.hold.r);
  assert.deepEqual(letGo.reach, to);
  assert.ok(Math.abs(letGo.at - (carry.at + carry.blend)) < 1e-9);
  // out of reach (Lucas 2026-11-17): a toss, never a refusal — the swing ends at the reach, the
  // thing flies on an arc and lands at the spot
  const far = cast.handPlace({ hold: 'card', to, at: 2, standAt: [-162, 212, 0] });
  assert.equal(far.tossed, true);
  assert.equal(far.thingAt(far.release - 0.01), null);
  const mid = far.thingAt((far.release + far.lands) / 2);
  const start = far.thingAt(far.release + 1e-6)!;
  assert.ok(mid && mid[2] > (start[2] + to[2]) / 2 + 5, 'mid-flight it arcs above the straight line');
  assert.deepEqual(far.thingAt(far.lands + 0.01), to);
  const swing = far.keys.find((k: any) => k.effort === 0.9);
  assert.deepEqual(cast.reachProblems([-162, 212, 0], swing.reach), [], 'the swing ends inside the reach');
  assert.throws(() => cast.handPlace({ hold: 'card', to, at: 2 }), /standAt/);
});

test('handWrite: marks progress and the tool point move together; no tool throws', async () => {
  const { cast } = await kit();
  const from = [-20, 110, 20];
  const to = [10, 110, 20];
  const w = cast.handWrite({ from, to, at: 4, dur: 2, tool: 'pen', standAt: [0, 130, 0] });
  assert.equal(w.u(3.9), 0);
  assert.equal(w.u(6.1), 1);
  const mid = w.tipAt(5);
  assert.ok(Math.abs(mid[0] - -5) < 1e-6, 'the point is halfway along when half the marks are down');
  // every writing key holds the tool and reaches just above the point the marks have reached
  const writing = w.keys.filter((k: any) => k.at >= 4 && k.at < 6);
  assert.ok(writing.length >= 10);
  for (const k of writing) {
    assert.equal(k.hold.r, 'pen');
    const arrive = k.at + k.blend;
    const tip = w.tipAt(arrive);
    assert.ok(Math.abs(k.reach[0] - tip[0]) < 1e-6 && Math.abs(k.reach[2] - (tip[2] + 5)) < 1e-6);
  }
  assert.throws(() => cast.handWrite({ from, to, at: 4, dur: 2, standAt: [0, 130, 0] }), /tool/);
});

test('critter() writes its hands on screen and what they hold for the checks', async () => {
  const { cast } = await kit();
  const svg = cast.critter(500, 1200, { who: 'a', body: 'orange', s: 1, hold: { r: 'pen' } });
  const tag = svg.match(/<g [^>]*data-who="a"[^>]*>/)[0];
  assert.match(tag, /data-holds="r"/);
  const h = tag.match(/data-hands="([^"]+)"/)[1].split(' ').map(Number);
  assert.equal(h.length, 4);
  const at = cast.handAt(500, 1200, { s: 1, hold: { r: 'pen' } });
  assert.ok(Math.abs(h[2] - at.r[0]) < 0.6 && Math.abs(h[3] - at.r[1]) < 0.6);
});

const cam = { pos: [0, -300, 120], target: [0, 100, 60], fov: 40 };
const SHOTS = [
  { at: 0, kind: 'wide', camera: cam, subject: 'student', cast: ['student', 'sheet'], place: 'room' },
  { at: 2, kind: 'insert', camera: { ...cam, pos: [0, 60, 200] }, subject: 'sheet', cast: ['sheet'], place: 'room' },
  { at: 4, kind: 'insert', camera: cam, subject: 'sheet', cast: ['sheet'], place: 'room', away: ['student'] },
];

test('castContinuityProblems: a critter left out of a later shot of its place, unless away', async () => {
  const { cont: shots } = await kit();
  const p = shots.castContinuityProblems(SHOTS, ['student']);
  assert.equal(p.length, 1);
  assert.match(p[0], /shot 2 \(insert\) leaves "student" out of its cast/);
  assert.deepEqual(shots.castContinuityProblems(SHOTS.slice(0, 1), ['student']), []);
  // another place is another set: no carry-over
  const other = [SHOTS[0], { ...SHOTS[1], place: 'hall' }];
  assert.deepEqual(shots.castContinuityProblems(other, ['student']), []);
  // an object left out is not a critter
  assert.deepEqual(shots.castContinuityProblems(SHOTS, []), []);
});

test('shotFrame keeps a critter of the place drawn in a shot whose cast leaves it out', async () => {
  const { shots, lens } = await kit();
  const critterItem = { id: 'student', at: [0, 150, 36], svg: '<g data-who="student"></g>' };
  const prop = { id: 'cup', at: [20, 150, 10], svg: '<g data-x="cup"></g>' };
  const seen: Record<number, string[]> = {};
  const draw = (t: number) => shots.shotFrame(t, SHOTS, (shot: any, local: number, i: number, { P }: any) => {
    seen[i] = shots.castItems(shot, [critterItem, prop]).map((it: any) => it.id);
    return [lens.render(P, { items: [critterItem, prop], shot, local })];
  });
  const svg2 = draw(2.5);
  assert.deepEqual(seen[1], ['student']);
  assert.match(svg2, /data-who="student"/);
  const svg3 = draw(4.5);
  assert.deepEqual(seen[2], []);
  assert.doesNotMatch(svg3, /data-who="student"/);
  // outside shotFrame, castItems is the plain cast filter
  assert.deepEqual(shots.castItems(SHOTS[1], [critterItem, prop]).map((it: any) => it.id), []);
});

test('handProblems: a thing that travels on after the hand lets go, not one the hand carries', async () => {
  const { tr } = await kit();
  const critter = (x: number, holds: boolean) => `<g data-who="reader" data-hands="${x - 60} 1000 ${x} 900"${holds ? ' data-holds="r"' : ''}></g>`;
  const thing = (x: number) => `<g data-frame-kind="entity" data-frame-who="magnet" data-frame-box="${x - 10} 890 ${x + 10} 910"></g>`;
  // the hand lets go at x 300, then the magnet slides 200 px with no hand on it
  const magic = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t, k) => ({ t, svg: critter(300, k < 2) + thing(k < 2 ? 300 : 300 + (k - 1) * 50) }));
  const bad = tr.handProblems(magic);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /"reader" lets go at 0\.20s, then "magnet" moves on by itself/);
  // carried: the hand travels with it, then lets go where it stays
  const carried = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t, k) => {
    const x = 300 + Math.min(k, 3) * 50;
    return { t, svg: critter(x, k < 4) + thing(x) };
  });
  assert.deepEqual(tr.handProblems(carried), []);
  // a straight drop after letting go is gravity
  const drop = [0, 0.1, 0.2, 0.3].map((t, k) => ({ t, svg: critter(300, k < 1) + `<g data-frame-kind="entity" data-frame-who="magnet" data-frame-box="290 ${890 + k * 30} 310 ${910 + k * 30}"></g>` }));
  assert.deepEqual(tr.handProblems(drop), []);
  // a toss: the hand swings toward where the magnet then flies — not magic
  const toss = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t, k) => ({ t, svg: critter(240 + Math.min(k, 2) * 30, k < 3) + thing(k < 3 ? 240 + k * 30 : 300 + (k - 2) * 60) }));
  assert.deepEqual(tr.handProblems(toss), []);
  // a cut ends the watch
  assert.deepEqual(tr.handProblems(magic, (t: number) => (t < 0.25 ? 0 : 1)), []);
});
