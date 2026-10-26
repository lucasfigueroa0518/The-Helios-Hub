/**
 * Explainers 4.1 rig (cast.js): two-bone arms from intent, moods that only touch the face, whole
 * faces, held props drawn in the hand, chest gestures below the mouth, and the riggedProblems
 * check. Offline: no model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

type Pt = [number, number];
async function kit() {
  await import('../explainers/world-kit/try.mjs');
  const draw: any = await import('../explainers/world-kit/draw.js');
  const cast: any = await import('../explainers/world-kit/cast.js');
  const outfits: any = await import('../explainers/world-kit/outfits.js');
  draw.scope('rig-', 'paper');
  return { cast, outfits };
}
const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('IK: the hand reaches a target in range, clamps to arm length, and the elbow bends down/out', async () => {
  const { cast } = await kit();
  const { solveArm, RIG } = cast;
  const near = solveArm('r', [100, -60]);
  assert.ok(d(near.hand, [100, -60]) < 1e-6, 'an in-range target is reached exactly');
  assert.equal(near.clamped, false);
  const far = solveArm('r', [400, -100]);
  assert.ok(Math.abs(d(far.hand, far.shoulder) - RIG.reach) < 1e-6, 'a far target is clamped to the reach');
  assert.equal(far.clamped, true);
  assert.ok(far.hand[0] > 150 && Math.abs(far.hand[1] + 100) < 1e-6, 'clamped along the line to the target');
  // a bent arm: elbow below the shoulder-hand line's midpoint and outward
  const bent = solveArm('r', [74, -52]);
  const mid: Pt = [(bent.shoulder[0] + bent.hand[0]) / 2, (bent.shoulder[1] + bent.hand[1]) / 2];
  assert.ok(bent.elbow[0] >= mid[0], 'the right elbow bends outward');
  const left = solveArm('l', [-74, -52]);
  assert.ok(left.elbow[0] <= (left.shoulder[0] + left.hand[0]) / 2, 'the left elbow bends outward (mirrored)');
  // the elbow sits on both bones (upper and fore ≈ bone at rest)
  assert.ok(Math.abs(d(bent.shoulder, bent.elbow) - d(bent.elbow, bent.hand)) < 1e-6);
});

test('act: reach targets the near hand, leans toward effort and away from fear, eyes look at it', async () => {
  const { cast } = await kit();
  const { act, handAt } = cast;
  const r = act({ reach: [150, -150], effort: 0.8 });
  assert.ok(r.tilt > 0, 'leans toward the reach');
  assert.ok(r.look[0] > 0 && r.look[1] < 0, 'looks up and to the right');
  // the lean is undone for the target: the drawn hand lands on the reach target (or the reach limit toward it)
  const h = handAt(0, 0, r).r;
  const toT = Math.hypot(150 - h[0], -150 - h[1]);
  assert.ok(toT < 40, `hand near the target (${toT.toFixed(1)})`);
  const rec = act({ recoil: [200, -100] });
  assert.ok(rec.tilt < 0, 'leans away from a threat on the right');
  assert.equal(rec.mood, 'surprised');
  // screen targets with a frame: same intent from a flipped critter at (500, 800)
  const f = act({ reach: [500 - 120, 800 - 90] }, { x: 500, y: 800, flip: true });
  const hf = handAt(500, 800, { ...f, flip: true });
  assert.ok(Math.min(d(hf.l, [380, 710]), d(hf.r, [380, 710])) < 1, 'a flipped critter reaches a screen point');
});

test('moods never override arms; an explicit arms option or intent always wins', async () => {
  const { cast } = await kit();
  const { MOODS, handAt, solveArms, act, ARM_POSES } = cast;
  for (const [name, m] of Object.entries(MOODS as Record<string, Record<string, unknown>>)) {
    assert.ok(!('arms' in m) && !('legs' in m) && !('tilt' in m), `${name} sets only the face`);
  }
  assert.deepEqual(handAt(0, 0, { mood: 'panicked' }), handAt(0, 0, {}), 'panicked keeps the default arms');
  assert.deepEqual(handAt(0, 0, { mood: 'panicked', arms: 'hold' }).r, ARM_POSES.hold.arms[1].slice(2));
  const o = act({ reach: [120, -90], mood: 'panicked' });
  assert.deepEqual(solveArms(o).hands, solveArms({ ...o, mood: 'neutral' }).hands);
});

test('every face draws eyes, brows and a mouth; neutral is calm, not blank', async () => {
  const { cast } = await kit();
  const { critter, MOODS, riggedProblems } = cast;
  const strokes = (svg: string) => (svg.match(/stroke-width="5\.5"/g) ?? []).length;
  const mouths = (svg: string) => (svg.match(/stroke-width="5\.2"|<ellipse[^>]*rx="9" ry="11"|Q 0 18 20 -6 Z/g) ?? []).length;
  for (const mood of [...Object.keys(MOODS), undefined]) {
    const svg = critter(0, 0, mood ? { mood } : {});
    assert.equal(strokes(svg), 2, `${mood ?? 'no mood'}: two brows`);
    assert.ok(mouths(svg) >= 1, `${mood ?? 'no mood'}: a mouth`);
  }
  assert.equal(MOODS.neutral.mouth, 'calm');
  assert.equal(MOODS.neutral.brows, 'calm');
  assert.deepEqual(riggedProblems({ mood: 'neutral' }), []);
  assert.ok(riggedProblems({ mouth: 'none' }).some((p: { code: string }) => p.code === 'faceless'));
});

test('held props are drawn at the solved hand and follow it; two hands hold two things', async () => {
  const { cast } = await kit();
  const { act, critter, gripAt, handAt, riggedProblems, PX_PER_CM } = cast;
  const o = act({ hold: { l: 'mug', r: 'carton' }, reach: [140, -120] });
  const svg = critter(300, 600, o);
  assert.ok(svg.includes('data-held="mug"') && svg.includes('data-held="carton"'), 'both props drawn');
  const hands = handAt(300, 600, o);
  for (const side of ['l', 'r'] as const) {
    const gp = gripAt(300, 600, o, side);
    assert.ok(d([gp.x, gp.y], hands[side]) < 1e-6, `${side} prop grip is the hand`);
  }
  // the grip moves with the hand
  const o2 = act({ hold: { r: 'carton' }, reach: [60, -190] });
  assert.ok(d([gripAt(0, 0, o2, 'r').x, gripAt(0, 0, o2, 'r').y], handAt(0, 0, o2).r) < 1e-6);
  // a two-handed box sits between the hands, below the mouth
  const box = act({ hold: { both: 'box' } });
  const g = gripAt(0, 0, box, 'both');
  const hb = handAt(0, 0, box);
  assert.ok(d([g.x, g.y], [(hb.l[0] + hb.r[0]) / 2, (hb.l[1] + hb.r[1]) / 2]) < 1e-6);
  assert.deepEqual(riggedProblems(box).filter((p: { code: string }) => p.code !== 'overreach'), []);
  // an overlay prop drawn apart from the hand is caught; one at the hand passes
  const tol = 4 * PX_PER_CM;
  assert.ok(riggedProblems({ x: 0, y: 0, opts: o, props: [{ at: [hands.r[0] - 300, hands.r[1] - 600 + tol * 3], hand: 'r', name: 'mug' }] }).some((p: { code: string }) => p.code === 'prop-off-hand'));
  const at = handAt(0, 0, o).r;
  assert.ok(!riggedProblems({ x: 0, y: 0, opts: o, props: [{ at: [at[0] + 2, at[1]], hand: 'r' }] }).some((p: { code: string }) => p.code === 'prop-off-hand'));
});

test('chest gestures keep hands below the mouth line; nothing crosses the eyes', async () => {
  const { cast } = await kit();
  const { act, solveArms, riggedProblems, RIG, GESTURES, clearOfFace, FACE_KEEPOUT } = cast;
  const clutch = solveArms(act({ gesture: 'clutch' }));
  for (const h of clutch.hands) assert.ok(h[1] > RIG.mouthY, `clutch hand y ${h[1]} below the mouth line`);
  // a raw "chest" target at eye height is moved off the face (the blindfold bug)
  const blind = solveArms({ arms: { l: [-30, -98], r: [30, -98] } });
  for (const h of blind.hands) {
    for (const z of FACE_KEEPOUT) {
      const dx = Math.max(z.x - h[0], 0, h[0] - (z.x + z.w));
      const dy = Math.max(z.y - h[1], 0, h[1] - (z.y + z.h));
      assert.ok(Math.hypot(dx, dy) >= RIG.hand, `hand ${h} clear of the ${z.part}`);
    }
  }
  assert.deepEqual(clearOfFace([120, -100]), [120, -100], 'a clear target is unchanged');
  // every gesture and a sweep of reach targets: no problems except deliberate cover / overreach
  for (const name of Object.keys(GESTURES)) {
    const probs = riggedProblems(act({ gesture: name })).filter((p: { code: string }) => p.code !== 'overreach');
    assert.deepEqual(probs, [], `${name}: ${JSON.stringify(probs)}`);
  }
  for (let x = -200; x <= 200; x += 40) for (let y = -220; y <= 0; y += 40) {
    const probs = riggedProblems(act({ reach: [x, y] })).filter((p: { code: string }) => p.code !== 'overreach');
    assert.deepEqual(probs, [], `reach (${x}, ${y}): ${JSON.stringify(probs)}`);
  }
  // hands-to-face is allowed only when asked for (cover), and then not reported
  assert.deepEqual(riggedProblems({ arms: { l: [-25, -98], r: [25, -98] }, cover: true }).filter((p: { code: string }) => p.code !== 'overreach'), []);
});

test('actAt eases between keyed intents and the eyes lead', async () => {
  const { cast } = await kit();
  const { actAt, act } = cast;
  const keys = [{ at: 0, gesture: 'calm' }, { at: 1, reach: [140, -120] }];
  const a = actAt(0.5, keys);
  assert.deepEqual(a.arms, act(keys[0]).arms);
  const b = actAt(1.6, keys);
  assert.deepEqual(b.arms, act(keys[1]).arms);
  const mid = actAt(1.2, keys);
  assert.ok(mid.arms.r[0] > act(keys[0]).arms.r[0] && mid.arms.r[0] < act(keys[1]).arms.r[0], 'the hand is on its way');
  const before = actAt(0.95, keys);
  assert.ok((before.look?.[0] ?? 0) > 0, 'the eyes turn before the hand moves');
  assert.deepEqual(before.arms, act(keys[0]).arms);
});

test('outfits: the apron reads as a kitchen; scrub-colored sleeves under it are flagged', async () => {
  const { outfits } = await kit();
  const { normalizeOutfit, outfitReads, ROLE_GUIDE, TOP_READS, TOP_KINDS } = outfits;
  for (const k of TOP_KINDS) assert.ok(TOP_READS[k]?.reads, `${k} has a reads hint`);
  const apron = normalizeOutfit({ top: { kind: 'apron' } });
  assert.equal(apron.top.color, 'white', 'the apron defaults out of the scrubs palette');
  assert.equal(apron.top.pocket, true);
  assert.match(outfitReads({ top: { kind: 'apron' } }).reads, /kitchen/);
  assert.equal(outfitReads(ROLE_GUIDE.cook.outfit).clashes.length, 0);
  assert.ok(outfitReads({ top: { kind: 'apron', color: 'blue', under: 'teal' } }).clashes.some((c: string) => /scrubs/.test(c)));
  const shapes = outfits.outfitLayers({ D: outfits.defsBag(), L: 1, dark: false, bodyClip: null, fill: '#000' }, { top: { kind: 'apron' } }).shapes;
  assert.ok(!shapes.some((s: { part: string }) => s.part === 'strap'), 'no tubing straps on an apron');
  assert.ok(shapes.some((s: { part: string }) => s.part === 'apron-tie') && shapes.some((s: { part: string }) => s.part === 'pocket'));
});

// ── 4.1 Phase 2: bodies, views, the resting hand ────────────────────────────────────────────

test('bodies: the light palette bodies draw soft-3D in their own color; an unknown body throws', async () => {
  const { cast } = await kit();
  const D: any = await import('../explainers/world-kit/draw.js');
  assert.deepEqual([...cast.BODIES].sort(), ['blue', 'green', 'ink', 'lilac', 'orange', 'paper', 'teal', 'yellow']);
  const inkSvg = cast.critter(0, 0, { body: 'ink' });
  for (const b of ['yellow', 'blue', 'teal', 'lilac', 'green']) {
    const svg = cast.critter(0, 0, { body: b });
    assert.notEqual(svg, inkSvg, `${b} is not ink`);
    assert.ok(svg.includes(D.T[`${b}-lit`]) && svg.includes(D.T[b]), `${b} is shaded from its own ramp`);
    assert.equal(cast.bodyOf(b).base, D.T[`${b}-lit`]);
  }
  assert.throws(() => cast.critter(0, 0, { body: 'red' }), /body "red" must be one of/);
  assert.throws(() => cast.critter(0, 0, { body: 'purple' }), /must be one of .*yellow/);
});

test('views: three-quarter turns the face to its side, back turns it away and is never flagged', async () => {
  const { cast } = await kit();
  const front = cast.critter(0, 0, { body: 'paper' });
  const tq = cast.critter(0, 0, { body: 'paper', view: 'three-quarter', side: 'right' });
  const tqL = cast.critter(0, 0, { body: 'paper', view: 'three-quarter', side: 'left' });
  const back = cast.critter(0, 0, { body: 'paper', view: 'back', side: 'left', outfit: { top: { kind: 'apron', color: 'white' } }, who: 'cook' });
  assert.ok(tq.includes(`matrix(${cast.THREE_QUARTER.squeeze} 0 0 1 ${cast.THREE_QUARTER.shift} 0)`), 'the face plane slides right');
  assert.ok(tqL.includes(`matrix(${cast.THREE_QUARTER.squeeze} 0 0 1 ${-cast.THREE_QUARTER.shift} 0)`), 'and left');
  assert.notEqual(tq, front);
  // a flipped critter told side 'right' still turns right on screen
  assert.equal(cast.viewOf({ view: 'back', side: 'right', flip: true }).k, -1);
  assert.equal(cast.viewOf({ view: 'back', flip: true }).k, 1, 'no side: forward');
  // the back: no mouth or brows of the front face, the lost profile, the apron's bow, data-view
  assert.ok(back.includes('data-view="back"') && back.includes('data-face="lost-profile"'));
  assert.ok(!back.includes('data-outfit="front"'), 'no front garment layer');
  assert.deepEqual(cast.riggedProblems({ body: 'paper', view: 'back', arms: 'hold', hold: { both: 'box' } }), []);
  assert.ok(!/data-rig=/.test(back));
  assert.throws(() => cast.critter(0, 0, { view: 'side' }), /view "side" must be one of front, three-quarter, back/);
  // three-quarter face zones sit on the near side: a hand there is on the face, the far side is clear
  const z = cast.faceKeepoutFor('three-quarter', 1).find((q: { part: string }) => q.part === 'mouth');
  assert.ok(z.x > -32 && z.x + z.w > 32, 'the mouth zone moved right');
  assert.deepEqual(cast.faceKeepoutFor('back', 1), []);
});

test('the resting hand: a held prop rests below the face line, never over the face; riggedProblems catches one that is', async () => {
  const { cast } = await kit();
  const { act, riggedProblems, RIG, PX_PER_CM } = cast;
  const cm = (v: number) => v * PX_PER_CM;
  const tweezers = { name: 'tweezers', follow: 1, box: { x: -3, y: -cm(12), w: 6, h: cm(12) + 4 }, draw: () => '' };
  for (const side of ['l', 'r'] as const) {
    for (const prop of ['mug', 'clipboard', 'card', tweezers]) {
      for (const flip of [false, true]) {
        const o = act({ hold: { [side]: prop }, lookAt: [180, -120], effort: 0.3 }, null);
        assert.ok(o.arms[side][1] > RIG.mouthY, `${side} ${JSON.stringify(prop).slice(0, 20)}: the resting hand is below the mouth line`);
        assert.deepEqual(riggedProblems({ ...o, flip }).filter((p: { code: string }) => p.code !== 'overreach'), [], `${side} flip ${flip}`);
      }
    }
  }
  // a long prop turned toward the face at rest is lowered until it clears it
  const pole = { name: 'pole', upright: true, box: { x: -70, y: -60, w: 10, h: 64 }, draw: () => '' };
  const low = act({ hold: { r: pole } }, null);
  assert.deepEqual(riggedProblems(low).filter((p: { code: string }) => p.code === 'prop-on-face'), []);
  assert.ok(low.arms.r[1] > RIG.restHold[1], 'moved down from the rest');
  // but a hand told to hold it there is reported
  const bad = { arms: { l: [-72, -50], r: [84, -66] }, rig: true, hold: { r: pole } };
  assert.ok(riggedProblems(bad).some((p: { code: string }) => p.code === 'prop-on-face'));
  // and an overlay prop drawn over the face is caught too
  const at = cast.handAt(500, 900, { s: 1 });
  const props = [{ at: [500, 900 - 100], name: 'a card' }];
  assert.ok(riggedProblems({ x: 500, y: 900, props, opts: { s: 1 } }).some((p: { code: string; detail: string }) => p.code === 'prop-on-face' && /a card is drawn over the eyes/.test(p.detail)));
  assert.ok(at.l && at.r);
  // a reach still lifts a held prop: it targets it
  const up = act({ hold: { r: 'card' }, reach: [120, -150] }, null);
  assert.ok(up.arms.r[1] < RIG.mouthY);
});

test('outfitBack: the back panel hugs the body outline (no flat box), soft-shaded, with no stray rectangles', async () => {
  const { cast, outfits } = await kit();
  const D = outfits.defsBag();
  const C = { D, L: 1, dark: false, bodyClip: null, fill: '#2B2926' };
  for (const kind of ['coat', 'scrubs', 'tee', 'hoodie', 'uniform', 'dress']) {
    const svg = outfits.outfitBack(C, { top: { kind, color: 'yellow' } });
    assert.ok(svg.length > 0, kind);
    assert.ok(!/<rect /.test(svg), `${kind}: no rectangles`);
    const d = svg.match(/<path d="(M [^"]+Z)"/)![1];
    const pts: number[][] = d.replace(/[MZ]/g, '').split(' L ').map((p: string) => p.trim().split(' ').map(Number));
    // from the shoulders down the sides ride the body's own outline (BODY_D, a hair outside it)
    const body = (y: number) => 66 * (1 - Math.abs((y + 86) / 56) ** 3.3) ** (1 / 3.3);
    const side = pts.filter(([x, y]) => y >= -88 && y <= -62 && Math.abs(x) > 40);
    assert.ok(side.length >= 4 && side.every(([x, y]) => Math.abs(Math.abs(x) - body(y)) < 2.5), `${kind}: hugs the body`);
    // the hem corners are rounded: the lowest points sit well inside the widest
    const wide = Math.max(...pts.map(([x]) => Math.abs(x)));
    const low = Math.max(...pts.map(([, y]) => y));
    assert.ok(pts.filter(([, y]) => y > low - 1).every(([x]) => Math.abs(x) < wide - 4), `${kind}: no square hem corner`);
    assert.ok(/linearGradient|url\(#/.test(svg), `${kind}: soft-shaded`);
  }
  assert.ok(cast.critter(0, 0, { view: 'back', outfit: { top: { kind: 'coat', color: 'yellow' } } }).length > 0);
});

// ── 4.1 Phase 2, round 2 ────────────────────────────────────────────────────────────────────

test('K2: a prop in a hand that mirrors it keeps its printed text readable', async () => {
  const { cast } = await kit();
  const sign = { name: 'sign', upright: true, box: { x: 4, y: -30, w: 40, h: 30 }, draw: () => '<rect x="4" y="-30" width="40" height="30"/><text x="8" y="-10" text-anchor="start">MILK</text>' };
  const right = cast.critter(0, 0, { ...cast.act({ hold: { r: sign } }) });
  const left = cast.critter(0, 0, { ...cast.act({ hold: { l: sign } }) });
  const flippedRight = cast.critter(0, 0, { flip: true, ...cast.act({ hold: { r: sign } }) });
  assert.ok(!/data-unmirror/.test(right), 'a right hand draws it as it is');
  assert.match(left, /<g data-unmirror="1" transform="translate\(16 0\) scale\(-1 1\)"><text x="8" y="-10" text-anchor="end">MILK<\/text><\/g>/);
  assert.match(flippedRight, /data-unmirror="1"/, 'a flipped critter mirrors its right hand too');
  assert.equal(cast.unmirrorText('<text x="5" text-anchor="middle">A</text>'), '<g data-unmirror="1" transform="translate(10 0) scale(-1 1)"><text x="5" text-anchor="middle">A</text></g>');
});

test('K6: a hand travelling to a reach may pass the mouth line; a resting or holding hand over the face is still caught', async () => {
  const { cast } = await kit();
  const { act, blendRig, riggedProblems, RIG } = cast;
  const rest = act({ hold: { r: 'mug' } });
  const shelf = act({ reach: [40, -130], hand: 'r' });
  let fired = 0;
  for (let u = 0; u <= 1.0001; u += 0.1) fired += riggedProblems(blendRig(rest, shelf, u)).filter((p: { code: string }) => p.code === 'hand-above-mouth').length;
  assert.equal(fired, 0, 'no hand-above-mouth on the way to a shelf');
  assert.deepEqual(shelf.reaching, ['r']);
  // a hand simply held there (no reach) is still a problem
  const held = { arms: { l: [-72, -50], r: [58, -61] }, rig: true, hold: { r: 'card' } };
  assert.ok(riggedProblems(held).some((p: { code: string }) => p.code === 'hand-above-mouth'));
  assert.ok(RIG.mouthY < -40);
});

test('K10: the generic carryables draw, rest clear of the face, and are listed in PROPS', async () => {
  const { cast } = await kit();
  for (const k of ['glass', 'bottle', 'book', 'envelope', 'plate', 'tote', 'cup', 'bag', 'mug']) {
    assert.ok(cast.PROPS[k], k);
    for (const side of ['l', 'r']) {
      const o = cast.act({ hold: { [side]: k } });
      const svg = cast.critter(0, 0, { body: 'paper', ...o });
      assert.match(svg, new RegExp(`data-held="${k}"`));
      assert.ok(!/NaN|undefined/.test(svg), k);
      assert.deepEqual(cast.riggedProblems(o).filter((p: { code: string }) => p.code !== 'overreach'), [], `${k} ${side}`);
    }
  }
});
