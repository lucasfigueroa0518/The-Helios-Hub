/**
 * Explainers 4.2, kit objects and motion (explainers/world-kit/objects.js): the real-world object
 * library for mechanism frames, puppet pins, the courier, the motion verbs (CRAFT § 5 built in), the
 * no-face rule, sound events and the objectProblems breakage check. Offline: pure SVG strings in Node
 * (try.mjs stubs the CDN ink). No model, no browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const KIT = path.join(process.cwd(), 'explainers', 'world-kit');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
async function kit(): Promise<{ O: Any; D: Any; HX: Any; S: Any }> {
  await import('../explainers/world-kit/try.mjs'); // registers the CDN stub
  const D: Any = await import('../explainers/world-kit/draw.js');
  const O: Any = await import('../explainers/world-kit/objects.js');
  const HX: Any = await import('../explainers/world-kit/core.js');
  const S: Any = await import('../explainers/world-kit/sound.mjs');
  D.scope('t-', 'paper');
  return { O, D, HX, S };
}

const clean = (svg: string) => {
  assert.equal(typeof svg, 'string');
  assert.ok(!/NaN|undefined|Infinity|\[object Object\]/.test(svg), svg.slice(0, 300));
  const open = (svg.match(/<g\b/g) ?? []).length;
  const close = (svg.match(/<\/g>/g) ?? []).length;
  assert.equal(open, close, 'balanced <g>');
};
/** The puppet matrix of an object's body (the transform on its first inner group). */
const bodyMatrix = (svg: string) => {
  const m = svg.match(/<g transform="matrix\(([^)]+)\)"/);
  assert.ok(m, 'a posed body group');
  return m![1].split(' ').map(Number);
};
const close = (a: number, b: number, eps = 1e-2) => Math.abs(a - b) <= eps;

test('objects.js is self-contained: kit imports only, no CDN, palette colours only (V-T1)', async () => {
  const src = fs.readFileSync(path.join(KIT, 'objects.js'), 'utf8');
  assert.ok(!/https?:\/\//.test(src.replace(/^\s*\/\/.*$/gm, '')), 'no network import');
  for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.match(m[1], /^\.\/[a-z-]+\.js$/, `imports ${m[1]}`);
  const { HX } = await kit();
  const allowed = new Set(Object.values(HX.TOKENS).map((c) => String(c).toUpperCase()));
  for (const h of src.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) assert.ok(allowed.has(h.toUpperCase()), `objects.js uses ${h}`);
});

test('OBJECTS: at least 16 generic things, each with states, mass, an accent part and a label slot', async () => {
  const { O } = await kit();
  assert.ok(O.OBJECT_IDS.length >= 16, `${O.OBJECT_IDS.length} objects`);
  assert.deepEqual(Object.keys(O.OBJECTS), [...O.OBJECT_IDS]);
  for (const need of ['laptop', 'phone', 'server', 'chip', 'database', 'router', 'cloud', 'document', 'folder', 'envelope', 'box', 'key', 'lock', 'card', 'screen', 'speaker']) assert.ok(O.OBJECT_IDS.includes(need), need);
  for (const id of O.OBJECT_IDS) {
    const spec = O.OBJECTS[id];
    assert.ok(spec.states.length >= 1, id);
    assert.ok(['heavy', 'light'].includes(spec.mass), id);
    assert.equal(typeof spec.accent, 'string', id);
    assert.ok(['plate', 'screen'].includes(spec.label), id);
    assert.equal(typeof spec.hinge, 'boolean', id);
  }
  assert.ok(Object.isFrozen(O.OBJECTS));
  assert.deepEqual(O.OBJECT_IDS.filter((id: string) => O.OBJECTS[id].hinge).sort(), ['box', 'envelope', 'folder', 'laptop', 'lock']);
});

test('object(): every object draws clean in every state, both facings, with its label and accent', async () => {
  const { O } = await kit();
  for (const id of O.OBJECT_IDS) {
    for (const state of O.OBJECTS[id].states) {
      for (const facing of ['left', 'right']) {
        const o = O.object(id, [540, 1200], { label: 'a label', state, accent: true, facing });
        const svg = String(o);
        clean(svg);
        assert.match(svg, new RegExp(`data-object="${id}"`));
        assert.match(svg, new RegExp(`data-state="${state}"`));
        assert.match(svg, /data-accent="1"/);
        assert.match(svg, /data-k="textbox"/, `${id} label is a measured textbox`);
        assert.match(svg, />a label<\/text>/);
        const sizes = [...svg.matchAll(/data-k="text"[^>]*font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
        assert.ok(sizes.length && sizes.every((s) => s >= 34), `${id} label ≥ READ_MIN (${sizes})`);
        for (const pin of ['base', 'center', 'top', 'front']) assert.ok(o.pins[pin].every(Number.isFinite), `${id} pin ${pin}`);
        assert.equal('hinge' in o.pins, O.OBJECTS[id].hinge, `${id} hinge pin only when it opens`);
      }
    }
  }
});

test('object(): the base pin is `at`, size scales it, facing turns it, and the rest pose is upright', async () => {
  const { O } = await kit();
  const a = O.object('server', [400, 1300]);
  assert.deepEqual(a.pins.base, [400, 1300]);
  assert.ok(a.pins.top[1] < a.pins.center[1] && a.pins.center[1] < a.pins.base[1], 'top above centre above base');
  const big = O.object('server', [400, 1300], { size: 1.5 });
  assert.ok(close(big.box.h / a.box.h, 1.5, 0.02), 'size scales the drawing');
  const r = O.object('server', [400, 1300], { facing: 'right' });
  assert.notEqual(String(r), String(a));
  assert.ok(r.pins.front[0] > 400 && a.pins.front[0] < 400, 'the front faces lower right / lower left');
  assert.equal(a.key, 'server@400,1300');
  assert.equal(O.object('server', [400, 1300], { key: 'srv' }).key, 'srv');
  const m = bodyMatrix(String(a));
  assert.ok(close(m[0], 1) && close(m[3], 1) && close(m[1], 0) && close(m[2], 0), 'identity pose at rest');
  // label size grows with the object, never below READ_MIN
  assert.equal(O.object('box', [0, 0], { size: 0.5 }).labelSize, 34);
  assert.equal(O.object('box', [0, 0], { size: 1.2 }).labelSize, 48);
});

test('object(): refuses faces, orange bodies, unknown ids, states, facings, options and long labels', async () => {
  const { O } = await kit();
  for (const k of O.FACE_KEYS) assert.throws(() => O.object('laptop', [0, 0], { [k]: true }), /never get a face/, k);
  assert.throws(() => O.object('box', [0, 0], { tone: 'orange' }), /never orange/);
  assert.throws(() => O.object('box', [0, 0], { tone: { mix: ['orange', 'paper', 0.5] } }), /never mixed from orange/);
  assert.throws(() => O.object('unicorn', [0, 0]), /no object "unicorn"/);
  assert.throws(() => O.object('box', [0, 0], { state: 'on' }), /states closed, open/);
  assert.throws(() => O.object('box', [0, 0], { facing: 'three-quarter' }), /facing/);
  assert.throws(() => O.object('box', [0, 0], { colour: 'teal' }), /unknown option "colour"/);
  assert.throws(() => O.object('box', [0, 0], { accent: 'orange' }), /accent is true, false or 0\.\.1/);
  assert.throws(() => O.object('box', [0, 0], { label: 'one two three four' }), /1–3 words/);
  assert.throws(() => O.object('box', 'here'), /screen point/);
  assert.doesNotThrow(() => O.object('box', [0, 0], { tone: 'teal' }));
  assert.doesNotThrow(() => O.object('box', [0, 0], { tone: { mix: ['teal', 'paper', 0.4] } }));
});

test('verbs: every verb is a timeline segment, refuses faces and unknown options, and places on GSAP', async () => {
  const { O } = await kit();
  const o = O.object('lock', [500, 1300]);
  const make: Record<string, (x: Any) => Any> = {
    hopTo: (x) => O.hopTo(o, [700, 1250], x),
    slideTo: (x) => O.slideTo(o, [700, 1300], x),
    lookAt: (x) => O.lookAt(o, [900, 900], x),
    react: (x) => O.react(o, 'surprised', x),
    nod: (x) => O.nod(o, x),
    shake: (x) => O.shake(o, x),
    openHinge: (x) => O.openHinge(o, x),
    closeHinge: (x) => O.closeHinge(o, x),
    settle: (x) => O.settle(o, x),
    breathe: (x) => O.breathe(o, x),
    setState: (x) => O.setState(o, 'unlocked', x),
    setAccent: (x) => O.setAccent(o, 1, x),
  };
  assert.deepEqual(Object.keys(make).sort(), [...O.VERBS].sort());
  for (const [name, fn] of Object.entries(make)) {
    const s = fn({ at: 1.25 });
    assert.equal(s.kind, 'segment', name);
    assert.equal(s.verb, name);
    assert.equal(s.at, 1.25);
    assert.ok(s.dur > 0 && close(s.end, s.at + s.dur, 1e-9), name);
    assert.ok(Array.isArray(s.events));
    assert.throws(() => fn({ eyes: [0, 0] }), /never get a face/, name);
    assert.throws(() => fn({ mood: 'happy' }), /never get a face/, name);
    assert.throws(() => fn({ delay: 1 }), /unknown option "delay"/, name);
    // seg.gsap places the same slot on a GSAP timeline at `at`
    const calls: Any[] = [];
    const tl = { fromTo: (...args: Any[]) => calls.push(args) };
    const seen: number[] = [];
    assert.equal(s.gsap(tl, (t: number) => seen.push(t)), tl);
    assert.equal(calls.length, 1);
    const [target, from, to, pos] = calls[0];
    assert.equal(pos, 1.25);
    assert.equal(from.t, 1.25);
    assert.equal(to.t, s.end);
    assert.equal(to.ease, 'none');
    target.t = 1.5;
    to.onUpdate();
    assert.deepEqual(seen, [1.5]);
  }
  assert.throws(() => O.hopTo({ id: 'box' }, [0, 0]), /made by object\(\)/);
});

test('hopTo: anticipation, take-off stretch, an arc with the shadow on the floor, landing squash, settle', async () => {
  const { O } = await kit();
  const o = O.object('box', [300, 1300]);
  const s = O.hopTo(o, [700, 1250], { at: 1 });
  const P = (t: number) => O.poseAt(o, t, [s]);
  const D = s.dur;
  assert.ok(P(1 + D * 0.15).sq > 0.08, 'crouch (squash) before take-off');
  assert.ok(P(1 + D * 0.15).rot < 0, 'leans back, away from the hop');
  assert.ok(P(1 + D * 0.28).sq < -0.05, 'stretched at take-off');
  const apex = P(1 + D * 0.49);
  assert.ok(apex.lift > 100, `in the air (${apex.lift})`);
  assert.ok(Math.abs(apex.sq) < 0.05, 'round at the apex');
  assert.ok(apex.rot > 0, 'leans into the travel');
  assert.ok(P(1 + D * 0.82).sq > 0.12, 'squash on landing');
  assert.equal(P(1 + D * 0.82).lift, 0, 'on the floor when it lands');
  const end = P(s.end + 0.01);
  assert.deepEqual([end.x, end.y, end.lift, end.sq, end.rot], [700, 1250, 0, 0, 0]);
  // persistent: it stays there; the pins move with it
  assert.deepEqual(O.pinsAt(o, 9, [s]).base, [700, 1250]);
  // volume kept on every frame: the body matrix has determinant 1
  for (let t = 1; t <= s.end; t += 0.05) {
    const m = bodyMatrix(O.play(t, [s]));
    assert.ok(close(m[0] * m[3] - m[1] * m[2], 1, 1e-4), `volume at ${t.toFixed(2)}`);
  }
  // the shadow stays on the floor while the body lifts: its ellipse is drawn outside the pose
  const svg = O.play(1 + D * 0.49, [s]);
  assert.match(svg, /data-floor="[\d.]+"/);
  assert.ok(s.events.some((e: Any) => e.kind === 'impact'), 'a heavy box lands with an impact');
  assert.ok(O.hopTo(O.object('phone', [0, 1000]), [300, 1000]).events.some((e: Any) => e.kind === 'foley' && e.what === 'drop'));
});

test('slideTo: never leaves the floor, counter-leans, the top lags then runs on, and settles', async () => {
  const { O } = await kit();
  const o = O.object('box', [300, 1300]);
  const s = O.slideTo(o, [700, 1300], { at: 0 });
  const P = (t: number) => O.poseAt(o, t, [s]);
  for (let t = 0; t <= s.end; t += 0.04) assert.equal(P(t).lift, 0);
  assert.ok(P(s.dur * 0.12).rot < 0, 'counter-lean first');
  assert.ok(P(s.dur * 0.7).rot > 0, 'the top runs on as it brakes');
  assert.ok(P(s.dur * 0.93).rot > 0, 'overshoots forward after the stop');
  assert.deepEqual([P(s.end).x, P(s.end).y, P(s.end).rot], [700, 1300, 0]);
  assert.ok(s.events[0].kind === 'foley' && s.events[0].dur > 0, 'a continuous foley while it slides');
});

test('lookAt: a beat of thought, then a tilt toward the target that holds; null turns it back', async () => {
  const { O } = await kit();
  const o = O.object('laptop', [300, 1300]);
  const look = O.lookAt(o, [900, 900], { at: 1 });
  const back = O.lookAt(o, null, { at: 3 });
  const P = (t: number) => O.poseAt(o, t, [look, back]);
  assert.ok(P(1.1).rot < 0, 'counter-tilt first (thought before action)');
  assert.ok(P(1.42).rot > P(2).rot, 'overshoots, then settles');
  assert.ok(P(2).rot > 5, `holds the tilt toward the target (${P(2).rot})`);
  assert.ok(P(2).sq < 0, 'rises a touch toward something above it');
  assert.ok(close(P(5).rot, 0) && close(P(5).sq, 0), 'back upright');
  const other = O.object('server', [100, 1300]);
  assert.ok(O.poseAt(o, 3, [O.lookAt(o, other, { at: 1 })]).rot < 0, 'an object target: tilts toward it (left)');
});

test('react: motion only (no face), each reaction readable, transient and back to rest', async () => {
  const { O } = await kit();
  const o = O.object('router', [500, 1300]);
  for (const k of ['happy', 'sad', 'smile', 'angry']) assert.throws(() => O.react(o, k), /motion alone/);
  for (const kind of O.REACTIONS) {
    const s = O.react(o, kind, { at: 2 });
    const peak = { sq: 0, lift: 0, rot: 0, dx: 0 };
    for (let t = 2; t <= s.end; t += 0.02) {
      const p = O.poseAt(o, t, [s]);
      peak.sq = Math.max(peak.sq, Math.abs(p.sq));
      peak.lift = Math.max(peak.lift, p.lift);
      peak.rot = Math.max(peak.rot, Math.abs(p.rot));
      peak.dx = Math.max(peak.dx, Math.abs(p.dx ?? 0));
    }
    assert.ok(peak.sq > 0.05, `${kind} squashes or stretches`);
    if (kind === 'surprised' || kind === 'yes') assert.ok(peak.lift > 20, `${kind} leaves the floor`);
    if (kind === 'no') assert.ok(peak.rot > 6, 'no shakes');
    if (kind === 'worried') assert.ok(peak.dx > 1, 'worried trembles');
    const after = O.poseAt(o, s.end + 0.01, [s]);
    assert.deepEqual([after.sq, after.lift, after.rot, after.dx], [0, 0, 0, 0], `${kind} returns to rest`);
    assert.ok(s.events.length >= 1, `${kind} has a sound`);
    const svg = O.play(s.at + s.dur * 0.4, [s]);
    clean(svg);
    assert.ok(!/data-face|data-who|data-eyes|data-mood/.test(svg), `${kind} draws no face`);
  }
  assert.match(O.play(2.3, [O.react(o, 'surprised', { at: 2 })]), /data-mark="shock"/);
  assert.match(O.play(2.6, [O.react(o, 'proud', { at: 2 })]), /data-mark="sparkle"/);
});

test('nod and shake: smaller each time, then still', async () => {
  const { O } = await kit();
  const o = O.object('speaker', [500, 1300]);
  const n = O.nod(o, { at: 0, times: 2 });
  const per = (n.dur - 0.25) / 2;
  const d1 = O.poseAt(o, per * 0.5, [n]);
  const d2 = O.poseAt(o, per * 1.5, [n]);
  assert.ok(d1.sq > d2.sq && d2.sq > 0, 'the second nod is smaller');
  assert.ok(d1.rot < 0, 'facing left, the top tips toward the lower left');
  assert.ok(O.poseAt(O.object('speaker', [0, 0], { facing: 'right' }), per * 0.5, [O.nod(O.object('speaker', [0, 0], { facing: 'right' }), { at: 0 })]).rot > 0);
  assert.equal(n.events.length, 2);
  const s = O.shake(o, { at: 0, times: 3 });
  const rots = Array.from({ length: 60 }, (_, i) => O.poseAt(o, (s.dur * i) / 60, [s]).rot);
  assert.ok(Math.max(...rots) > 4 && Math.min(...rots) < -3, 'swings both ways');
  assert.equal(O.poseAt(o, s.end + 0.01, [s]).rot, 0);
});

test('openHinge / closeHinge: a press, a swing past open and back, the state at the end; hinged objects only', async () => {
  const { O } = await kit();
  const box = O.object('box', [500, 1300]);
  const open = O.openHinge(box, { at: 0 });
  const hs = Array.from({ length: 80 }, (_, i) => O.poseAt(box, (open.dur * i) / 79, [open]).hinge);
  assert.ok(Math.min(...hs) < 0, 'a tiny press shut first (anticipation)');
  assert.ok(Math.max(...hs) > 1.02, 'swings past open (overshoot)');
  const end = O.poseAt(box, open.end + 0.01, [open]);
  assert.equal(end.hinge, 1);
  assert.equal(end.state, 'open');
  assert.match(O.play(open.end + 0.1, [open]), /data-state="open"/);
  const shut = O.closeHinge(box, { at: 2 });
  const after = O.poseAt(box, shut.end + 0.01, [open, shut]);
  assert.equal(after.hinge, 0);
  assert.equal(after.state, 'closed');
  const impact = Math.max(...Array.from({ length: 40 }, (_, i) => O.poseAt(box, 2 + (shut.dur * i) / 39, [open, shut]).sq));
  assert.ok(impact > 0.05, 'the body takes the impact');
  // the laptop opens into 'on'; the lock opens into 'unlocked'
  const lap = O.object('laptop', [0, 1000], { state: 'closed' });
  assert.equal(O.poseAt(lap, 9, [O.openHinge(lap)]).state, 'on');
  const lock = O.object('lock', [0, 1000]);
  assert.equal(O.poseAt(lock, 9, [O.openHinge(lock)]).state, 'unlocked');
  assert.throws(() => O.openHinge(O.object('server', [0, 0])), /has no hinge/);
  assert.throws(() => O.openHinge(box, { state: 'on' }), /states closed, open/);
  for (const ev of [...open.events, ...shut.events]) assert.equal(ev.kind, 'foley');
});

test('settle, breathe, setState, setAccent', async () => {
  const { O } = await kit();
  const o = O.object('database', [500, 1300]);
  const st = O.settle(o, { at: 1 });
  const sq = Array.from({ length: 50 }, (_, i) => O.poseAt(o, 1 + (st.dur * i) / 49, [st]).sq);
  assert.ok(Math.max(...sq) > 0.08 && Math.min(...sq) < 0, 'squash, then a smaller stretch back');
  assert.equal(O.poseAt(o, st.end + 0.01, [st]).sq, 0);
  const br = O.breathe(o, { at: 0, dur: 5 });
  const bs = Array.from({ length: 100 }, (_, i) => O.poseAt(o, (5 * i) / 99, [br]).sq);
  assert.ok(Math.max(...bs.map(Math.abs)) <= 0.02 && Math.max(...bs.map(Math.abs)) > 0.005, 'a moving hold, faint');
  assert.equal(O.poseAt(o, 0, [br]).sq, 0, 'eases in from rest');
  const srv = O.object('server', [500, 1300]);
  assert.equal(O.poseAt(srv, 0.9, [O.setState(srv, 'busy', { at: 1 })]).state, 'on');
  assert.equal(O.poseAt(srv, 1.1, [O.setState(srv, 'busy', { at: 1 })]).state, 'busy');
  assert.deepEqual(O.setState(srv, 'off', { at: 2 }).events, [{ t: 2, kind: 'click' }]);
  assert.throws(() => O.setState(srv, 'open'), /states on, off, busy/);
  const acc = [O.setAccent(srv, 1, { at: 1 }), O.setAccent(srv, 0, { at: 3 })];
  assert.equal(O.poseAt(srv, 0.5, acc).accent, 0);
  assert.ok(close(O.poseAt(srv, 2, acc).accent, 1));
  assert.match(O.play(2, acc), /data-accent="1"/);
  assert.equal(O.poseAt(srv, 4, acc).accent, 0);
});

test('courier: pops in, pulls back, rides an arc, lands with a squash, changes state, nudges and switches its target', async () => {
  const { O } = await kit();
  const a = O.object('laptop', [300, 1400], { label: 'app' });
  const b = O.object('server', [800, 1000], { label: 'server' });
  const c = O.courier('request', a, b, { at: 1, dur: 1.2, label: 'GET', state: 'ok', arrive: 'busy' });
  assert.equal(c.verb, 'courier');
  assert.deepEqual(c.events.map((e: Any) => e.kind), ['pop', 'whoosh', 'pop']);
  assert.equal(c.events[0].t, 1);
  assert.equal(c.events[2].t, 2.2);
  const segs = [c];
  assert.equal(c.overlay(0.9, { segments: segs, pinsAt: (o: Any, t: number) => O.pinsAt(o, t, segs) }), '', 'nothing before it pops in');
  const posAt = (t: number) => {
    const m = O.play(t, segs).match(/<g data-courier="request"[^>]*>(?:<path[^>]*><\/path>)?<g transform="translate\(([-\d.]+) ([-\d.]+)\)/);
    assert.ok(m, `courier drawn at ${t}`);
    return [Number(m![1]), Number(m![2])];
  };
  const from = O.pinsAt(a, 1, segs).top;
  const to = O.pinsAt(b, 2.2, segs).top;
  const mid = posAt(1.24 + (2.2 - 1.24) / 2);
  const chordY = (from[1] + to[1]) / 2;
  assert.ok(mid[0] > from[0] && mid[0] < to[0], 'between the ends');
  assert.ok(mid[1] < chordY - 30, `bows up above the straight line (${mid[1]} vs ${chordY})`);
  assert.match(O.play(1.6, segs), /data-mark="trail"/);
  const land = posAt(2.25);
  assert.ok(close(land[0], to[0], 1) && close(land[1], to[1], 1), 'sits on the target pin');
  assert.match(O.play(2.25, segs), /data-courier="request" data-state="ok"/);
  assert.match(O.play(2.25, segs), /data-mark="badge-ok"/);
  assert.equal(O.poseAt(b, 2.1, segs).state, 'on');
  assert.equal(O.poseAt(b, 2.3, segs).state, 'busy', 'the target switches on arrival');
  assert.ok(Math.max(...[2.21, 2.23, 2.25, 2.27].map((t) => O.poseAt(b, t, segs).sq)) > 0.03, 'the target takes a small hit (bump)');
  assert.ok(!/data-courier/.test(O.play(3, segs)), 'absorbed after it lands');
  const kept = O.courier('file', b, a, { at: 0, dur: 1, keep: true, state: 'empty' });
  assert.match(O.play(5, [kept]), /data-courier="file" data-state="empty"/, 'parked where it landed');
  assert.match(O.play(5, [kept]), /data-object="document"/, 'a file is a page');
  for (const kind of [...O.COURIER_KINDS, 'key', 'card']) clean(O.play(0.6, [O.courier(kind, [200, 1500], [800, 900], { at: 0, dur: 1, label: 'x' })]));
  assert.throws(() => O.courier('rocket', a, b), /courier kind "rocket"/);
  assert.throws(() => O.courier('request', a, b, { state: 'open' }), /states/);
  assert.throws(() => O.courier('request', a, [0, 0], { arrive: 'on' }), /needs `to` to be an object/);
  assert.throws(() => O.courier('request', a, b, { dur: 0.2 }), /≥ 0.4s/);
  assert.throws(() => O.courier('request', a, b, { face: 'smile' }), /never get a face/);
});

test('courier follows a moving target, and arc 0 is a straight track', async () => {
  const { O } = await kit();
  const a = O.object('phone', [200, 1500]);
  const b = O.object('box', [800, 1200]);
  const moveB = O.slideTo(b, [800, 1500], { at: 0, dur: 1 });
  const c = O.courier('packet', a, b, { at: 0, dur: 1.4, arc: 0 });
  const end = O.play(1.45, [moveB, c]).match(/<g data-courier="packet"[^>]*>(?:<path[^>]*><\/path>)?<g transform="translate\(([-\d.]+) ([-\d.]+)\)/);
  assert.ok(end);
  assert.ok(close(Number(end![2]), O.pinsAt(b, 1.4, [moveB]).top[1], 2), 'lands on where the target went');
  const mid = O.play(0.24 + 0.58, [c]).match(/<g data-courier="packet"[^>]*>(?:<path[^>]*><\/path>)?<g transform="translate\(([-\d.]+) ([-\d.]+)\)/);
  const A = O.pinsAt(a, 0, []).top;
  const B = O.pinsAt(b, 1.4, []).top;
  const x = Number(mid![1]);
  const y = Number(mid![2]);
  const onLine = A[1] + ((B[1] - A[1]) * (x - A[0])) / (B[0] - A[0]);
  assert.ok(Math.abs(y - onLine) < 3, 'no bow on a straight track');
});

test('play: objects back to front by their floor line, couriers over them; deterministic', async () => {
  const { O } = await kit();
  const near = O.object('box', [500, 1500]);
  const far = O.object('server', [500, 1000]);
  const segs = [O.courier('request', near, far, { at: 0, dur: 1 }), O.breathe(far)];
  const svg = O.play(0.5, segs, [O.object('chip', [800, 1200])]);
  clean(svg);
  const order = [...svg.matchAll(/data-object="([a-z]+)" data-key/g)].map((m) => m[1]);
  assert.deepEqual(order, ['server', 'chip', 'box'], 'far first');
  assert.ok(svg.lastIndexOf('data-courier') > svg.lastIndexOf('data-object="box"'), 'the courier draws last');
  assert.equal(O.play(0.5, segs), O.play(0.5, segs), 'a pure function of t');
});

test('soundEvents: every event, sorted, in the sound kinds the mixer knows', async () => {
  const { O, S } = await kit();
  const a = O.object('box', [300, 1300]);
  const b = O.object('folder', [700, 1100]);
  const segs = [O.react(b, 'yes', { at: 3 }), O.hopTo(a, [400, 1350], { at: 0.5 }), O.openHinge(b, { at: 2 }), O.courier('file', a, b, { at: 1, dur: 0.9 }), O.setState(a, 'open', { at: 4 })];
  const ev = O.soundEvents(segs);
  assert.ok(ev.length >= 7);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t >= ev[i - 1].t, 'sorted');
  for (const e of ev) {
    assert.ok(Object.keys(S.KINDS).includes(e.kind), `kind ${e.kind}`);
    if (e.kind === 'foley') assert.ok(typeof e.what === 'string' && e.what.length > 0);
  }
  ev[0].t = -1;
  assert.notEqual(O.soundEvents(segs)[0].t, -1, 'copies, not the segments’ own events');
});

test('objectProblems: clean frames pass; pins out of frame, sinking below the floor and faces are breakage', async () => {
  const { O, HX } = await kit();
  const a = O.object('laptop', [300, 1400], { label: 'app' });
  const b = O.object('server', [800, 1000]);
  const segs = [O.courier('request', a, b, { at: 0.2, dur: 1 }), O.hopTo(a, [360, 1450], { at: 1.5 }), O.react(b, 'surprised', { at: 1.4 })];
  const samples = Array.from({ length: 30 }, (_, i) => ({ t: i * 0.1, svg: O.play(i * 0.1, segs) }));
  assert.deepEqual(O.objectProblems(samples), []);
  assert.deepEqual(O.objectProblems(samples.map((s) => s.svg)), [], 'plain SVG strings too');
  // a pin out of frame
  const edge = String(O.object('rack', [60, 1300]));
  const p1 = O.objectProblems([{ t: 1, svg: edge }]);
  assert.ok(p1.some((p: string) => /^t=1\.00s: rack: its \w+ pin \(-?\d+, \d+\) is out of frame$/.test(p)), p1.join('\n'));
  // a camera push maps the pins through the transforms around the object
  const inside = String(O.object('server', [900, 1500]));
  assert.deepEqual(O.objectProblems(inside), []);
  const pushed = `<g transform="${HX.cameraTransform(HX.cam({ zoom: 1.6 }))}">${inside}</g>`;
  assert.deepEqual(O.objectProblems(pushed), [], 'a crop push cuts it on purpose');
  const shifted = `<g transform="translate(400 0)">${inside}</g>`;
  assert.ok(O.objectProblems(shifted).some((p: string) => /server: its \w+ pin .* out of frame/.test(p)), 'transforms still map the pins');
  // below its floor: drawn lower than the surface it stands on
  const sunk = String(O.object('document', [500, 1300], { floor: 1260 }));
  assert.deepEqual(O.objectProblems(sunk), ['document: sinks 40px below its floor line']);
  assert.deepEqual(O.objectProblems(String(O.object('document', [500, 1300], { floor: 1300 }))), []);
  // a face drawn on an object
  const withFace = String(O.object('box', [500, 1300], { label: 'order' })).replace('</g></g>', '<g data-face="eyes"><circle r="3"></circle></g></g></g>');
  assert.ok(O.objectProblems(withFace).includes('box "order": has a face (objects never get a face; they act through motion alone)'));
  const withCritter = String(O.object('box', [500, 1300])).replace(/<\/g>$/, '<g data-who="bob"></g></g>');
  assert.ok(O.objectProblems(withCritter).some((p: string) => /box: has a face/.test(p)));
  const beside = String(O.object('box', [300, 1300])) + '<g data-who="bob"><circle r="3"></circle></g>';
  assert.deepEqual(O.objectProblems(beside), [], 'a critter beside an object is fine');
  // duplicates across samples collapse
  assert.equal(O.objectProblems([edge, edge]).length, O.objectProblems([edge]).length);
});

test('parseTransform: the SVG transforms a frame wraps objects in', async () => {
  const { O } = await kit();
  const m = O.parseTransform('translate(10 20) scale(2) rotate(90)');
  const ap = (p: number[]) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  const q = ap([1, 0]);
  assert.ok(close(q[0], 10) && close(q[1], 22));
  assert.deepEqual(O.parseTransform(''), [1, 0, 0, 1, 0, 0]);
  const r = O.parseTransform('rotate(180 5 5)');
  assert.ok(close(r[4], 10) && close(r[5], 10));
  assert.deepEqual(O.parseTransform('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]);
});

// ── Round 2: the identity map's real things, object heroes through the camera, a quiet courier ──

async function kit2(): Promise<{ O: Any; D: Any; X: Any; L: Any }> {
  const { O, D } = await kit();
  const X: Any = await import('../explainers/world-kit/explain.js');
  const L: Any = await import('../explainers/world-kit/lens.js');
  return { O, D, X, L };
}

test('identity: a concept may be its real thing (object + tone), a marker, or both in one colour; never orange', async () => {
  const { O, X } = await kit2();
  assert.equal(O.READ_MIN, X.READ_MIN, 'one reading floor');
  assert.ok(!X.CONCEPT_COLORS.includes('orange'));
  const reg = X.identity({
    cache: { object: 'database', tone: 'teal', label: 'Saved copy' },
    server: { icon: 'server', color: 'blue', object: 'server' },
    token: { icon: 'zap' },
  });
  assert.equal(reg.get('token').color, 'teal', 'the first default colour is teal, not orange');
  assert.equal(reg.get('server').tone, 'blue', 'the object tone defaults to the concept colour');
  assert.equal(reg.get('cache').color, 'teal', 'lines and chips take the object tone');
  for (const bad of [{ icon: 'zap', color: 'orange' }, { object: 'box', tone: 'orange' }, { object: 'box', tone: 'orange-lit' }, { object: 'box', tone: { mix: ['orange', 'paper', 0.5] } }]) {
    assert.throws(() => X.identity({ a: bad }), /orange marks what to look at now/, JSON.stringify(bad));
  }
  assert.throws(() => X.identity({ a: { icon: 'server', color: 'blue', object: 'server', tone: 'teal' } }), /blue as a marker but tone "teal" as an object/);
  assert.throws(() => X.identity({ a: { object: 'unicorn' } }), /not one of OBJECTS/);
  assert.throws(() => X.identity({ a: { tone: 'teal' } }), /needs an icon .* or an object/);
  assert.throws(() => X.identity({ a: { object: 'box', shape: 'disc' } }), /a shape is for a diagram marker/);
  assert.throws(() => X.identity({ a: { object: 'box', look: 'x' } }), /unknown field "look"/);
  // drawing: the real thing carries its concept; a marker of an object-only concept is refused
  const db = reg.object('cache', [400, 1300], { label: true });
  const svg = String(db);
  assert.match(svg, /data-object="database"[^>]*data-concept="cache" data-shape="object" data-color="teal"/);
  assert.match(svg, />Saved copy<\/text>/, 'label: true puts its name on it');
  assert.throws(() => reg.node('cache', 0, 0), /is a real thing \(object "database"\)/);
  assert.throws(() => reg.object('token', [0, 0]), /has no object/);
  assert.throws(() => reg.object('cache', [0, 0], { tone: 'blue' }), /its tone comes from the identity map/);
  const w = reg.worldObject('server', [0, 50, 0]);
  assert.equal(w.space, 'world');
  assert.equal(w.concept, 'server');
  // one look per concept, in either form and across them
  assert.deepEqual(X.identityProblems([svg, String(reg.object('cache', [700, 1200])), reg.node('server', 200, 900).svg, String(reg.object('server', [600, 900]))]), []);
  assert.deepEqual(X.identityProblems(Object.values(reg.defs)), [], 'the defs themselves are one look each');
  const twoTones = X.identityProblems([svg, String(O.object('database', [0, 0], { tone: 'blue', concept: 'cache' }))]);
  assert.ok(twoTones.some((p: string) => /"cache" is drawn as an object in 2 tones/.test(p)), twoTones.join('\n'));
  const twoThings = X.identityProblems([svg, String(O.object('server', [0, 0], { tone: 'teal', concept: 'cache' }))]);
  assert.ok(twoThings.some((p: string) => /"cache" is drawn as 2 objects \(database, server\)/.test(p)));
  const cross = X.identityProblems([reg.node('server', 0, 0).svg, String(O.object('server', [0, 0], { tone: 'green', concept: 'server' }))]);
  assert.ok(cross.some((p: string) => /"server" is blue as a marker but green as an object/.test(p)));
  const shared = X.identityProblems([String(O.object('box', [0, 0], { tone: 'teal', concept: 'a' })), String(O.object('box', [0, 0], { tone: 'teal', concept: 'b' }))]);
  assert.ok(shared.some((p: string) => /the object "box" in teal stands for 2 concepts \(a, b\)/.test(p)));
  // declared defs against drawn usage: the map's object form counts
  const drift = X.identityProblems([...Object.values(reg.defs), String(O.object('database', [0, 0], { tone: 'lilac', concept: 'cache' }))]);
  assert.ok(drift.some((p: string) => /"cache" is drawn as an object in 2 tones \(teal, lilac\)/.test(p)), drift.join('\n'));
});

test('courier: its own tone by default; orange only with accent: true', async () => {
  const { O } = await kit2();
  const a = O.object('laptop', [300, 1400]);
  const b = O.object('server', [800, 1000]);
  const quiet = O.play(1, [O.courier('request', a, b, { at: 0, dur: 1.4, label: 'GET' })]);
  const loud = O.play(1, [O.courier('request', a, b, { at: 0, dur: 1.4, label: 'GET', accent: true })]);
  const orangeIn = (svg: string) => (svg.match(/data-courier[\s\S]*/)?.[0] ?? '').includes('#FF5E1A');
  assert.ok(!orangeIn(quiet), 'a quiet request tag is paper');
  assert.ok(orangeIn(loud), 'accent: true makes it orange');
  const page = O.play(0.8, [O.courier('file', a, b, { at: 0, dur: 1.4 })]);
  assert.ok(!/data-courier="file"[\s\S]*data-accent=/.test(page), 'a carried object wears its own tone');
  const teal = O.play(0.8, [O.courier('packet', a, b, { at: 0, dur: 1.4, tone: 'teal' })]);
  assert.match(teal, /data-courier="packet"/);
  assert.throws(() => O.courier('request', a, b, { tone: 'teal' }), /tone is for a carried object/);
  assert.throws(() => O.courier('packet', a, b, { tone: 'orange' }), /never orange/);
  const w = O.worldObject('box', [0, 0]);
  assert.throws(() => O.courier('request', w, b), /travels on screen/);
});

test('worldObject + lensObject: a real thing in a perspective world, scaled by depth, lit by the rig, moved in cm', async () => {
  const { O, L, D } = await kit2();
  D.scope('wo-', 'paper');
  const P = L.lens({ pos: [0, -420, 150], target: [0, 60, 40], fov: 40 });
  const day = L.rig(P);
  // every object, every state, both facings, with a label and its accent: clean through the lens
  for (const id of O.OBJECT_IDS) {
    for (const state of O.OBJECTS[id].states) {
      for (const facing of ['left', 'right']) {
        const it = O.lensObject(P, O.worldObject(id, [20, 60], { size: 'cheat', state, facing, label: 'x', accent: true }), { rig: day });
        clean(it.svg);
        assert.match(it.svg, /^<g data-frame-kind="entity" data-frame-who=/, `${id} is a framed entity`);
        assert.deepEqual(O.objectProblems(it.svg), [], `${id} ${state} ${facing}`);
      }
    }
  }
  const near = O.lensObject(P, O.worldObject('server', [0, -100]), {});
  const far = O.lensObject(P, O.worldObject('server', [0, 200]), {});
  assert.ok(near.box.h > far.box.h * 1.4, 'nearer reads bigger (depth)');
  assert.ok(near.dist < far.dist);
  const trueKey = O.worldObject('key', [0, 0]);
  const cheat = O.worldObject('key', [0, 0], { size: 'cheat' });
  assert.ok(cheat.cm > trueKey.cm, 'cheat makes a small prop bigger so it reads');
  assert.equal(O.OBJECT_CM.key, 6);
  // a render() item: id, at (mid-height), bounds on the floor
  const it = O.lensObject(P, O.worldObject('box', [30, 40, 0], { key: 'hero' }), { rig: day });
  assert.equal(it.id, 'hero');
  assert.equal(it.at[0], 30);
  assert.ok(it.bounds[0][2] === 0 && it.bounds[1][2] > 20, 'bounds stand on the floor');
  assert.match(L.render(P, { items: [it] }), /data-object="box"/);
  // the verbs move it through world positions; the shadow stays on the floor while it hops
  const hero = O.worldObject('box', [-40, 40], { key: 'hero' });
  const hop = O.hopTo(hero, [40, 0], { at: 0 });
  const apex = O.lensObject(P, hero, { t: hop.dur * 0.49, segments: [hop] });
  const rest = O.lensObject(P, hero, { t: 0, segments: [hop] });
  const floorY = Number(apex.svg.match(/data-floor="([\d.]+)"/)![1]);
  assert.ok(apex.pins.base[1] < floorY - 20, 'in the air above its floor point');
  assert.ok(O.poseAt(hero, hop.dur * 0.49, [hop]).lift > 8, 'lift in cm');
  assert.deepEqual(O.objectProblems(apex.svg), []);
  const end = O.lensObject(P, hero, { t: hop.end + 0.1, segments: [hop] });
  assert.deepEqual(end.at.slice(0, 2), [40, 0]);
  assert.notDeepEqual(end.pins.base, rest.pins.base);
  // lookAt resolves on screen: a target to the right tilts it right
  const look = O.lookAt(hero, [300, 40, 40], { at: 0 });
  const m = O.lensObject(P, hero, { t: 2, segments: [look] }).svg.match(/<g transform="matrix\(([^)]+)\)"/)![1].split(' ').map(Number);
  assert.ok(m[1] > 0.05, `tilted clockwise toward the target (${m[1]})`);
  // react draws its marks through the lens too
  assert.match(O.lensObject(P, hero, { t: 0.3, segments: [O.react(hero, 'surprised', { at: 0 })] }).svg, /data-mark="shock"/);
  // at night the rig darkens it (one lit filter on the body), its shadows come from the lights
  const night = L.rig(P, { mood: 'night', points: [{ pos: [-60, 20, 150], level: 0.7, reach: 200, color: 'warm' }] });
  const nightSvg = O.lensObject(P, hero, { rig: night }).svg;
  assert.match(nightSvg, /filter="url\(#wo-lit-/, 'lit by the night rig');
  assert.match(nightSvg, /data-k="shadow"/);
  // a low camera (below a tall rack's top) still draws clean: faces are culled by the lens
  const low = L.lens({ pos: [0, -300, 40], target: [0, 60, 80], fov: 50 });
  clean(O.lensObject(low, O.worldObject('rack', [0, 60]), {}).svg);
  // refusals
  assert.throws(() => O.lensObject(P, O.object('box', [0, 0])), /is a worldObject/);
  assert.throws(() => O.lensObject({}, hero), /lens\.js lens\(\)/);
  assert.throws(() => O.worldObject('box', [0, 0], { floor: 3 }), /unknown option "floor"/);
  assert.throws(() => O.pinsAt(hero, 0, []), /depend on the camera/);
  assert.throws(() => O.hopTo(hero, O.object('box', [0, 0])), /moves to a world point/);
  assert.throws(() => String(hero), /drawn through the camera/);
  assert.equal(O.play(0.5, [hop]), '', 'play() draws screen objects only');
});

test('objectProblems: an object moving across the frame edge, or cut by a crop push, is not breakage; a held one is', async () => {
  const { O, HX } = await kit();
  const ph = O.object('phone', [500, 1500], { key: 'ph' });
  const off = O.slideTo(ph, [500, 2300], { at: 0, dur: 1 });
  const samples = Array.from({ length: 12 }, (_, i) => ({ t: i * 0.1, svg: O.play(i * 0.1, [off]) }));
  assert.ok(samples.slice(0, 11).some((s) => /out of frame/.test(O.objectProblems([s]).join())), 'a lone sample cannot tell');
  assert.deepEqual(O.objectProblems(samples.slice(0, 10)), [], 'sliding off: fine');
  const parked = [1.5, 1.6, 1.7].map((t) => ({ t, svg: O.play(t, [off]) }));
  assert.ok(O.objectProblems(parked).some((p: string) => /ph|phone: its \w+ pin/.test(p)), 'held still out of frame: flagged');
  const push = `<g transform="${HX.cameraTransform(HX.cam({ zoom: 1.6 }))}">${String(O.object('server', [900, 1500]))}</g>`;
  assert.deepEqual(O.objectProblems([push, push]), [], 'a crop push cuts it on purpose');
});
