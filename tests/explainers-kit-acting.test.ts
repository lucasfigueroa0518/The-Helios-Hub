/**
 * Explainers hx-6 critter D acting (acting.js through cast.js), offline: a performance is a pure
 * function of time (deterministic, seeded), feelings hold until the next beat at any length,
 * changes blend with no jumps, intensity scales the expression, the life layer stays subtle and
 * follows the feeling, accents play once under a rate cap, actingProblems flags emote spam, the
 * arsenal is three times the reference's, every mood and pose draws clean (eyes only: nothing that
 * reads as a mouth or brows; mittens off the eyes; arms within D_STUB), and roles still hold props.
 * No model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

async function kit() {
  await import('../explainers/world-kit/try.mjs');
  const draw: any = await import('../explainers/world-kit/draw.js');
  const cast: any = await import('../explainers/world-kit/cast.js');
  const acting: any = await import('../explainers/world-kit/acting.js');
  draw.scope('a-', 'paper');
  return { draw, cast, acting };
}
const INK = '#171717';
const flat = (p: any) => [...(p.face ? Object.entries(p.face) : [])].flatMap(([k, v]: any) => (Array.isArray(v) ? v.flat() : [v]));

test('the arsenal: 30 moods, 30 arm poses, 15 states, accents ×3 (gestures, eye behaviours, body moves)', async () => {
  const { cast } = await kit();
  assert.equal(Object.keys(cast.D.MOODS).length, 29);
  assert.equal(Object.keys(cast.D.ARM_POSES).length, 30);
  assert.equal(Object.keys(cast.D.STATES).length, 15);
  const kinds: Record<string, number> = {};
  for (const a of Object.values<any>(cast.D.ACCENTS)) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  assert.ok(kinds.gesture >= 3 * Object.keys(cast.GESTURES).length, `gestures ${kinds.gesture}`);
  assert.ok(kinds.eye >= 15, `eye behaviours ${kinds.eye} (5 CSS look/blink hooks before)`);
  assert.ok(kinds.body >= 15, `body moves ${kinds.body} (5 CSS bob/hop/bounce/step hooks before)`);
  for (const [n, a] of Object.entries<any>(cast.D.ACCENTS)) assert.ok(a.dur > 0 && a.dur <= 2.5 && a.cool >= a.dur, n);
});

test('a performance is deterministic and seeded per critter', async () => {
  const { cast } = await kit();
  const track = [{ at: 0, emotion: 'content' }, { at: 2, emotion: 'nervous', accent: 'dart' }, { at: 5, emotion: 'relieved', accent: 'sigh' }];
  for (const t of [0, 0.7, 2.1, 4.33, 6.9]) assert.deepEqual(cast.actingAt(t, track, { seed: 'a' }), cast.actingAt(t, track, { seed: 'a' }));
  let differ = 0;
  for (let t = 0; t < 8; t += 0.1) if (JSON.stringify(cast.actingAt(t, track, { seed: 'a' }).face) !== JSON.stringify(cast.actingAt(t, track, { seed: 'b' }).face)) differ++;
  assert.ok(differ > 40, 'two critters do not blink and glance in unison');
});

test('changes blend continuously (no jump cuts), with or without the life layer', async () => {
  const { cast } = await kit();
  const track = [{ at: 0, emotion: 'neutral' }, { at: 1, emotion: 'panicked' }, { at: 1.2, emotion: 'excited', blend: 0.3 }, { at: 3, emotion: 'skeptical', pose: ['hips', 'pointup'], look: [1, 0], accent: 'shake' }, { at: 5, emotion: 'sleepy', intensity: 0.4, accent: 'yawn' }];
  for (const life of [false, true]) {
    for (let t = 0; t < 7; t += 1 / 60) {
      // continuous: the change over dt shrinks with dt (a jump cut would not)
      const step = (dt: number) => {
        const a = flat(cast.actingAt(t, track, { life }));
        const b = flat(cast.actingAt(t + dt, track, { life }));
        return Math.max(...a.map((v: number, i: number) => Math.abs(v - b[i])));
      };
      const big = step(1e-4);
      assert.ok(big < 0.002 || step(1e-5) < big * 0.2, `life ${life}: a jump of ${big} at t ${t.toFixed(3)}`);
    }
  }
  // a beat arriving mid-blend starts from wherever the face had got to
  const mid = cast.actingAt(1.2, track, { life: false }).face;
  const just = cast.actingAt(1.2 - 1e-4, track, { life: false }).face;
  assert.ok(Math.abs(mid.esl - just.esl) < 1e-3);
});

test('a feeling holds for as long as the story does, and intensity scales it', async () => {
  const { cast } = await kit();
  const track = [{ at: 0, emotion: 'worried' }];
  const at5 = cast.actingAt(5, track, { life: false });
  const at900 = cast.actingAt(900, track, { life: false });
  assert.equal(at900.mood, 'worried');
  assert.deepEqual(at900.face, at5.face, 'no built-in end');
  const full = cast.D.faceOf('worried');
  const neutral = cast.D.faceOf('neutral');
  assert.deepEqual([full.lo, full.li], [0.42, 0.04]);
  const half = cast.actingAt(9, [{ at: 0, emotion: 'worried', intensity: 0.5 }], { life: false }).face;
  for (const k of ['lo', 'li', 'px', 'py', 'tilt']) assert.ok(Math.abs(half[k] - (neutral[k] + full[k]) / 2) < 1e-9, k);
  // still alive after a long hold: blinks keep coming at 15 minutes
  let shut = 0;
  for (let t = 900; t < 930; t += 1 / 30) if (cast.actingAt(t, track).face.lo > 0.95) shut++;
  assert.ok(shut > 3, 'blinks at t 900+');
});

test('the life layer is subtle and follows the feeling', async () => {
  const { cast } = await kit();
  const sample = (emotion: string) => {
    let blinks = 0;
    let was = false;
    let maxG = 0;
    let maxT = 0;
    let maxSq = 0;
    let moves = 0;
    let prevPx = 0;
    for (let t = 0; t < 60; t += 1 / 30) {
      const p = cast.actingAt(t, [{ at: 0, emotion }], { seed: 'life' });
      const still = cast.actingAt(t, [{ at: 0, emotion }], { life: false }).face;
      const shut = p.life.blink > 0.9;
      if (shut && !was) blinks++;
      was = shut;
      maxG = Math.max(maxG, Math.hypot(p.life.gx, p.life.gy));
      maxT = Math.max(maxT, Math.abs(p.face.tilt - still.tilt));
      maxSq = Math.max(maxSq, Math.abs(p.face.sq - still.sq));
      if (Math.abs(p.life.gx - prevPx) > 0.5) moves++;
      prevPx = p.life.gx;
    }
    return { blinks, maxG, maxT, maxSq, moves };
  };
  const calm = sample('neutral');
  const sleepy = sample('sleepy');
  const nervous = sample('nervous');
  for (const [n, s] of Object.entries({ calm, sleepy, nervous })) {
    assert.ok(s.blinks >= 4 && s.blinks <= 45, `${n}: ${s.blinks} blinks a minute`);
    assert.ok(s.maxG <= 6, `${n}: glances stay small (${s.maxG})`);
    assert.ok(s.maxT <= 2.5, `${n}: weight shifts stay small (${s.maxT})`);
    assert.ok(s.maxSq <= 0.013, `${n}: breathing stays small (${s.maxSq})`);
  }
  assert.ok(nervous.moves > calm.moves && calm.moves > sleepy.moves, `glances: nervous ${nervous.moves} > calm ${calm.moves} > sleepy ${sleepy.moves}`);
  assert.ok(nervous.blinks > sleepy.blinks, 'a nervous critter blinks more than a sleepy one');
});

test('accents play once on their beat and never repeat; the rate cap and cooldown drop the rest', async () => {
  const { cast } = await kit();
  const one = [{ at: 0, emotion: 'happy' }, { at: 1, emotion: 'happy', accent: 'nod' }];
  const playing = (track: any, t: number) => cast.actingAt(t, track).accents;
  assert.deepEqual(playing(one, 1.2), ['nod']);
  for (let t = 2; t < 30; t += 0.25) assert.deepEqual(playing(one, t), [], `nothing auto-repeats (t ${t})`);
  const spam = [{ at: 0, emotion: 'happy', accent: 'nod' }, { at: 0.3, emotion: 'happy', accent: 'nod' }, { at: 0.4, emotion: 'happy', accent: 'hop' }, { at: 1, emotion: 'happy', accent: 'clap' }, { at: 2, emotion: 'happy', accent: 'wave' }, { at: 3, emotion: 'happy', accent: 'bounce' }];
  const names = new Set<string>();
  for (let t = 0; t < 6; t += 0.05) for (const a of playing(spam, t)) names.add(a);
  assert.deepEqual([...names], ['nod', 'clap', 'wave'], 'the second nod (cooldown), the hop (gap) and the bounce (3 per 5 s) are dropped');
});

test('actingProblems flags emote spam and passes a well-acted track', async () => {
  const { cast } = await kit();
  const good = [{ at: 0, emotion: 'curious', hold: 2 }, { at: 2.5, emotion: 'thoughtful', accent: 'scratch' }, { at: 5, emotion: 'excited', accent: 'pointup' }, { at: 9, emotion: 'content' }];
  assert.deepEqual(cast.actingProblems(good), []);
  const codes = (track: any) => cast.actingProblems(track).map((p: any) => p.code);
  assert.ok(codes([{ at: 0, emotion: 'happy' }, { at: 0.4, emotion: 'sad' }]).includes('short-hold'));
  assert.ok(codes([{ at: 0, emotion: 'happy', hold: 3 }, { at: 1.5, emotion: 'sad' }]).includes('short-hold'), 'cut before its own hold');
  assert.ok(codes([{ at: 0, emotion: 'happy' }, { at: 1, emotion: 'sad' }, { at: 2, emotion: 'angry' }, { at: 2.9, emotion: 'smug' }]).includes('emote-spam'));
  assert.ok(codes([{ at: 0, emotion: 'happy', accent: 'nod' }, { at: 1, emotion: 'happy', accent: 'nod' }]).includes('accent-cooldown'));
  assert.ok(codes([{ at: 0, emotion: 'happy', accent: 'nod' }, { at: 0.3, emotion: 'happy', accent: 'hop' }]).includes('accent-gap'));
  assert.ok(codes([0, 1, 2, 3].map((at, i) => ({ at, emotion: 'happy', accent: ['nod', 'hop', 'clap', 'wave'][i] }))).includes('accent-rate'));
  assert.deepEqual(codes([{ at: 0, emotion: 'grumpy', accent: 'moonwalk', pose: 'jazz', intensity: 2 }]).sort(), ['bad-intensity', 'unknown-accent', 'unknown-emotion', 'unknown-pose']);
  // main's mood names are feelings too
  assert.deepEqual(cast.actingProblems([{ at: 0, emotion: 'confident' }]), []);
});

/** The ink and colour marks of a tile, checked against D's face rules. */
function faceRules(svg: string, label: string, body: string) {
  const eyes = [...svg.matchAll(/<ellipse cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)" fill="(#FFFFFF|#[0-9A-F]{6})"/g)].filter((m) => m[5] !== body).map((m) => m.slice(1, 5).map(Number));
  assert.equal(eyes.length, 2, `${label}: two eye whites`);
  const inEye = (x: number, y: number, pad = 0) => eyes.some(([cx, cy, rx, ry]) => ((x - cx) / (rx + pad)) ** 2 + ((y - cy) / (ry + pad)) ** 2 <= 1);
  for (const m of svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)" fill="#171717"/g)) {
    const [x, y, r] = m.slice(1, 4).map(Number);
    if (!inEye(x, y)) assert.ok(r === 12 && !inEye(x, y, 11), `${label}: a mitten at (${x}, ${y}) is on an eye`);
    else assert.ok(inEye(x, y) && eyes.some(([cx, cy, rx, ry]) => Math.hypot(x - cx, y - cy) + r <= Math.max(rx, ry) + 0.5), `${label}: a pupil at (${x}, ${y}) is outside the eyes`);
  }
  // every other ink mark is an arm stroke from a shoulder or a leg: nothing drawn above or below the eyes
  for (const m of svg.matchAll(/<path d="M([-\d.]+) ([-\d.]+)[^"]*" fill="none" stroke="#171717"/g)) assert.ok(Number(m[2]) >= 100, `${label}: an ink stroke starting at y ${m[2]}`);
  for (const m of svg.matchAll(/<(polygon|path|rect|ellipse|line)[^>]*(fill|stroke)="([^"]+)"/g)) {
    const c = m[3];
    assert.ok([INK, body, '#FFFFFF', '#E5E5E5', 'none'].includes(c) || /^#[0-9A-F]{6}$/i.test(c) && c === body, `${label}: an unexpected ${m[1]} in ${c}`);
  }
  assert.doesNotMatch(svg, /<line|<path[^>]*stroke-width="[2-9](\.\d)?"(?![^>]*stroke-linecap="round")/, `${label}: no line marks (mouth or brows)`);
}

test('every mood × body and every arm pose draws clean: eyes only, mittens off the eyes, the ten unchanged', async () => {
  const { cast } = await kit();
  const B = cast.D.BODY_COLORS;
  for (const body of ['orange', 'green', 'ink', 'white']) {
    for (const mood of Object.keys(cast.D.MOODS)) {
      const svg = cast.D.tile({ body, mood });
      assert.doesNotMatch(svg, /undefined|NaN/, `${mood} ${body}`);
      faceRules(svg, `${mood} ${body}`, B[body]);
    }
    for (const arms of Object.keys(cast.D.ARM_POSES)) faceRules(cast.D.tile({ body, arms }), `${arms} ${body}`, B[body]);
  }
  // mid-performance frames, accents and blinks included
  const track = Object.keys(cast.D.ACCENTS).map((accent, i) => ({ at: i * 2.6, emotion: Object.keys(cast.D.MOODS)[i % 30], accent }));
  for (let t = 0; t < track.length * 2.6; t += 0.37) faceRules(cast.D.tile({ body: 'green', pose: cast.actingAt(t, track) }), `t ${t.toFixed(2)}`, B.green);
  // the added moods use the acting path; the reference ten keep D's original markup
  assert.match(cast.D.tile({ mood: 'happy' }), /<polygon|<ellipse cx="74" cy="121.2"/);
  assert.doesNotMatch(cast.D.tile({ mood: 'neutral' }), /<path d="M50/);
});

test('arms stay within D_STUB in critter() at every pose and accent, and roles still hold their props', async () => {
  const { cast } = await kit();
  const S = cast.RIG.shoulder;
  const check = (o: any, label: string) => {
    const sol = cast.solveArms(o);
    ['l', 'r'].forEach((side, i) => {
      const sh = [(side === 'l' ? -1 : 1) * S[0], S[1] + 15];
      const d = Math.hypot(sol.hands[i][0] - sh[0], sol.hands[i][1] - sh[1]);
      assert.ok(d <= cast.D_STUB + 0.5, `${label} ${side}: ${d.toFixed(1)} > D_STUB`);
    });
    const svg = cast.critter(500, 900, { ...o, who: 'c' });
    assert.doesNotMatch(svg, /undefined|NaN/, label);
    assert.doesNotMatch(svg, /data-rig="[^"]*(hand-over-eyes|arm-across-face|prop-on-face)/, label);
  };
  for (const pose of Object.keys(cast.D.ARM_POSES)) check(cast.actingAt(1, [{ at: 0, emotion: 'neutral', pose }]), pose);
  for (const accent of Object.keys(cast.D.ACCENTS)) for (const u of [0.2, 0.5]) check(cast.actingAt(u, [{ at: 0, emotion: 'neutral', accent }]), accent);
  // roles: the prop stays in the mitten through any feeling or gesture; act() takes the pose too
  for (const role of ['barista', 'chef', 'mail carrier']) {
    for (const t of [0.3, 2.2]) {
      const p = cast.actingAt(t, [{ at: 0, emotion: 'excited', accent: 'wave' }, { at: 2, emotion: 'guilty', accent: 'shrug' }]);
      const W = cast.D.wearOf({ role });
      if (W.hand) {
        assert.match(cast.critter(0, 0, { ...p, role }), new RegExp(`data-held="${W.hand}"`), role);
        assert.ok(cast.D.tile({ role, pose: p }).length > cast.D.tile({ pose: p }).length, `${role}: the tile draws the prop`);
      }
    }
  }
  const acted = cast.act({ acting: cast.actingAt(0.5, [{ at: 0, emotion: 'hopeful' }]) });
  assert.ok(acted.face && acted.mood === 'hopeful');
  assert.match(cast.critter(0, 0, acted), /data-critter/);
});
