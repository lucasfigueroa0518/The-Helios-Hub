/**
 * Explainers 4.2 checks (try.mjs, snap.mjs, bounds.mjs): code judges breakage, prompts judge taste.
 * Each frame's look comes from the storyboard; the taste checks of 4.1 no longer error; the kept
 * breakage checks still do, each under its `breakage:<check>` id; the jump-cut check (shots.js
 * jumpCutProblems) runs at every cut and between frames; and the run fails open (exit 1 for the
 * builder's one fix round, plus a machine-readable `problems` list the job turns into warnings).
 * Offline: SVG strings in Node; bounds.mjs uses the headless Chrome only when one is installed.
 * No model, no network.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const KIT = path.join(process.cwd(), 'explainers', 'world-kit');
/** shots.js jumpCutProblems (builder D's), typed for these calls. */
type JumpCuts = (shots: unknown[], o?: { samples?: unknown[] | null; duration?: number }) => string[];

type Frame = { number: number; source: string; look?: string; anchor?: string; duration?: number; shots?: string[] };
type Problem = { frame: string | null; check: string; rule: string; message: string };
type TryOut = { ok: boolean; errors: string[]; problems?: Problem[] };

/** A tiny project with a copy of the repo's kit (no VERSION file; the runs pass HELIOS_KIT_VERSION). */
function project(frames: Record<string, Frame>, o: { world?: string; identity?: string; kit?: Record<string, string> } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hx42-'));
  fs.mkdirSync(path.join(root, 'assets', 'frames'), { recursive: true });
  fs.cpSync(KIT, path.join(root, 'assets', 'kit'), { recursive: true });
  fs.rmSync(path.join(root, 'assets', 'kit', 'VERSION'), { force: true });
  for (const [file, src] of Object.entries(o.kit ?? {})) fs.writeFileSync(path.join(root, 'assets', 'kit', file), src);
  const board = ['# STORYBOARD', ''];
  for (const [id, f] of Object.entries(frames)) {
    board.push(`## Frame ${f.number} — F${f.number}`, '', `- duration: ${f.duration ?? 4}s`, `- src: compositions/frames/${id}.html`, '- ground: paper', '- voiceover: "A line."');
    if (f.look) board.push(`- look: ${f.look}`);
    if (f.anchor) board.push(`- anchor: ${f.anchor}`);
    if (f.shots) board.push('- shots:', ...f.shots.map((line) => `  - ${line}`));
    board.push('');
    fs.writeFileSync(path.join(root, 'assets', 'frames', `${id}.js`), f.source);
    fs.writeFileSync(path.join(root, 'assets', 'frames', `${id}.events.json`), '[]\n');
  }
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), board.join('\n'));
  if (o.world !== undefined || o.identity !== undefined) fs.mkdirSync(path.join(root, 'assets', 'world'), { recursive: true });
  if (o.world !== undefined) fs.writeFileSync(path.join(root, 'assets', 'world', 'world.js'), o.world);
  if (o.identity !== undefined) fs.writeFileSync(path.join(root, 'assets', 'world', 'identity.js'), o.identity);
  return root;
}

function tryRun(root: string, args = 'all', version = '4.2'): { status: number | null; out: TryOut; err: string } {
  const r = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), ...args.split(' ')], { cwd: root, encoding: 'utf8', env: { ...process.env, HELIOS_KIT_VERSION: version } });
  assert.ok(r.stdout.trim(), `try.mjs printed nothing: ${r.stderr}`);
  return { status: r.status, out: JSON.parse(r.stdout) as TryOut, err: r.stderr };
}

/** A frame module that draws the same SVG at every moment (plus optional shots). */
const still = (svg: string, extra = '') => `${extra}\nexport default { ground: 'paper', draw: () => ${JSON.stringify(svg)} };\n`;
/** A flat frame cut by crop shots (shots.js shotFrame) over one drawing. */
const cropped = (shots: unknown[], svg = '<g data-object="phone"><rect x="380" y="700" width="320" height="560" fill="#1C1B19"/></g><g data-object="server"><rect x="200" y="1300" width="200" height="200" fill="#14B8C4"/></g>') =>
  [
    "import { shotFrame } from '../kit/shots.js';",
    `export const shots = ${JSON.stringify(shots)};`,
    `export default { ground: 'paper', shots, draw: (t) => shotFrame(t, shots, () => ${JSON.stringify(svg)}) };`,
    '',
  ].join('\n');
const IDENTITY = "import { identity } from '../kit/explain.js';\nexport default identity({ cache: { icon: 'database', color: 'teal', shape: 'disc', label: 'cache' } });\n";
// a card big enough for the fill rule (content over 6% of the frame)
const readable = '<g data-ui="card"><rect x="240" y="760" width="600" height="400" fill="#FFFFFF"/><text x="340" y="980" font-size="48" font-family="Roboto">saved copy</text></g>';

// ── The look ─────────────────────────────────────────────────────────────────

test("a frame's look comes from the storyboard; an older storyboard falls back to its frame number and frame 7's anchor", async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const e = (number: number, fields: Record<string, string> = {}) => ({ number, fields });
  assert.equal(T.frameLook(e(2, { look: 'world' })), 'world', 'frame 2 may play the analogy');
  assert.equal(T.frameLook(e(4, { look: 'Mechanism' })), 'mechanism');
  assert.equal(T.frameLook(e(5, { look: 'blend — the fridge becomes the cache' })), 'blend');
  assert.equal(T.frameLook(e(4, { look: 'blend', anchor: 'own' })), 'blend', 'look wins over a stray anchor');
  // older storyboards
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => T.frameLook(e(n))), ['world', 'mechanism', 'mechanism', 'world', 'world', 'mechanism']);
  assert.equal(T.frameLook(e(7, { anchor: 'scene' })), 'world');
  assert.equal(T.frameLook(e(7, { anchor: 'own' })), 'mechanism');
  assert.equal(T.frameLook(e(7), "import { travel } from '../kit/explain.js';"), 'mechanism');
  assert.equal(T.frameLook(e(4, { look: 'sometimes' })), 'world', 'an unknown look falls back');
  assert.equal(T.frameLook(e(8)), null, 'the close has no look');
  // the builder's kind: blend is built by the scene worker
  assert.deepEqual(['world', 'mechanism', 'blend'].map((look) => T.frameKind(e(5, { look }))), ['scene', 'tech', 'scene']);
  assert.equal(T.frameKind(e(8)), null);
  assert.deepEqual(T.LOOKS.map((l: string) => [T.sceneLook(l), T.mechanismLook(l)]), [[true, false], [false, true], [true, true]]);
});

test('every check id is breakage: snake_case, and no 4.1 taste check is registered', async () => {
  const { CHECKS } = await import('../explainers/world-kit/try.mjs');
  const ids = Object.keys(CHECKS);
  for (const id of ids) assert.match(id, /^[a-z]+(_[a-z]+)*$/, id);
  // the fill rule is breakage again (a lone small object on an empty ground for more than 1 s)
  for (const kept of ['face_cut', 'rig', 'text', 'empty', 'identity', 'objects', 'jump_cut', 'shots', 'set', 'framing', 'label', 'fill', 'close']) assert.ok(ids.includes(kept), kept);
  for (const gone of ['crowd', 'focus', 'dof', 'technique', 'orange', 'frame7', 'hero', 'scale', 'cut']) assert.ok(!ids.includes(gone), gone);
});

// ── Fail open: the output ─────────────────────────────────────────────────────

test('fail open: a clean run prints exactly { ok, errors }; a broken one exits 1 with one problem per error, rule breakage:<check>', () => {
  const clean = project({ '02-gap': { number: 2, look: 'mechanism', source: still(readable) } });
  const ok = tryRun(clean);
  assert.equal(ok.status, 0, JSON.stringify(ok.out));
  assert.deepEqual(ok.out, { ok: true, errors: [] });

  const root = project({
    '02-gap': { number: 2, look: 'mechanism', source: still('<text x="300" y="900" font-size="20" font-family="Roboto">tiny words</text>') },
    '04-analogy': { number: 4, look: 'world', source: "export default { ground: 'paper', draw: (t) => { if (t > 1) throw new Error('boom'); return '<g></g>'; } };\n" },
  });
  const bad = tryRun(root);
  assert.equal(bad.status, 1, 'the builder sees the errors');
  const { errors, problems = [] } = bad.out;
  assert.equal(problems.length, errors.length);
  problems.forEach((p, k) => {
    assert.equal(p.rule, `breakage:${p.check}`);
    assert.equal(errors[k], `${p.frame}: ${p.message}`);
  });
  assert.ok(problems.some((p) => p.frame === '02-gap' && p.check === 'text' && /"tiny words" is 20px/.test(p.message)), errors.join('\n'));
  assert.ok(problems.some((p) => p.frame === '04-analogy' && p.check === 'draw' && /threw: boom/.test(p.message)), errors.join('\n'));
  // one frame on its own: the same problems, no frame prefix on the error lines
  const one = tryRun(root, 'frame 02-gap');
  assert.equal(one.status, 1);
  assert.equal(one.out.problems?.[0]?.frame, '02-gap');
  assert.equal(one.out.errors[0], one.out.problems?.[0]?.message);
});

test('fail open: in a job prepared before 4.1 the look checks are stderr warnings and the try passes', () => {
  const root = project({ '02-gap': { number: 2, look: 'mechanism', source: still('<text x="300" y="900" font-size="20" font-family="Roboto">tiny words</text>') } });
  const legacy = tryRun(root, 'all', '');
  assert.equal(legacy.status, 0, legacy.err);
  assert.deepEqual(legacy.out, { ok: true, errors: [] });
  assert.match(legacy.err, /- 02-gap: read: the text "tiny words" is 20px/);
});

// ── Removed: taste never errors ───────────────────────────────────────────────

test('removed taste checks: fill, technique, shot counts, crowds, orange, which beat shows the hero, frame 7 mixing, scale, the set brief', async () => {
  const { lookKey } = await import('../explainers/world-kit/cast.js');
  const orange = lookKey({ body: 'orange' });
  const ink = lookKey({ body: 'ink' });
  const crowd = Array.from({ length: 6 }, (_, i) => `<g data-who="guest-${i + 1}" data-look="${['ink', 'paper'][i % 2]}|look-${i}|"></g>`).join('');
  const root = project(
    {
      // a sparse mechanism frame with no technique header and nothing changing (4.1: P8 fill, technique)
      '02-gap': { number: 2, look: 'mechanism', source: still(readable) },
      // a 9 s world frame with no shots and six critters (4.1: minimum shots, the crowd cap)
      '04-analogy': { number: 4, look: 'world', duration: 9, source: still(crowd + readable) },
      // the hero in frame 6, and a second orange critter outside CAST (4.1: EX3-132, EX3-107 orange)
      '06-example': { number: 6, look: 'mechanism', source: still(`<g data-who="cook" data-look="${orange}"></g><g data-who="stranger" data-look="orange|hat|"></g>${readable}`) },
      // frame 7 with no anchor, the world and glass together (4.1: one or the other)
      '07-payoff': { number: 7, source: still(`<g data-who="clerk" data-look="${ink}"></g>${readable}`) },
    },
    {
      // two orange critters, a cheated prop, no SET, no DRAWN (4.1: one orange, true scale, the brief)
      world: [
        "export const CAST = { cook: { body: 'orange' }, clerk: { body: 'ink' }, twin: { body: 'orange', wear: ['cap'] } };",
        "export const ENTITIES = { cook: 'the app', fridge: 'the cache' };",
        "export const SIZES = { fridge: { w: 70, d: 70, h: 180, exaggerate: 3, scale: 'cheat' } };",
      ].join('\n'),
      identity: IDENTITY,
      // the hook hero need not be orange either: no bank opener here, so it is not drawn
    },
  );
  const r = tryRun(root);
  assert.deepEqual(r.out.errors, [], 'no taste check errors');
  assert.equal(r.status, 0);
  // the helpers stay as tools: the 4.1 rules are still callable
  const T = await import('../explainers/world-kit/try.mjs');
  assert.equal(T.castShapeProblems({ a: { body: 'orange' }, b: { body: 'orange' } }).length, 1, 'castShapeProblems keeps its 4.1 default');
  assert.deepEqual(T.castShapeProblems({ a: { body: 'orange' }, b: { body: 'orange' } }, { orange: false }), []);
  assert.equal(typeof T.techFillProblems, 'function');
  assert.equal(typeof T.crowdProblems, 'function');
  assert.equal((T as Record<string, unknown>).MAX_EXAGGERATE, undefined, 'no exaggeration cap');
});

test('the scale ledger (4.2): no true scale, no DRAWN; only sizes the lens cannot draw', async () => {
  const { sizeLedgerProblems } = await import('../explainers/world-kit/try.mjs');
  assert.deepEqual(sizeLedgerProblems({}), [], 'no SIZES: nothing to check');
  assert.deepEqual(sizeLedgerProblems({ ENTITIES: { fridge: 'x', nurse: 'y' }, SIZES: { fridge: { w: 70, d: 70, h: 180, exaggerate: 4 } } }), [], 'no cap, no entry per entity, no DRAWN');
  assert.deepEqual(sizeLedgerProblems({ SIZES: { carton: { w: 7, d: 7, h: 20, scale: 'cheat' }, key: { w: 2, d: 1, h: 6, scale: 3 } } }), []);
  assert.match(sizeLedgerProblems({ SIZES: { fridge: { w: 70, h: 180 } } })[0], /SIZES\.fridge must be \{ w, d, h \}/);
  assert.match(sizeLedgerProblems({ SIZES: { carton: { w: 7, d: 7, h: 20, scale: 'huge' } } })[0], /scale must be 'cheat' or a positive number/);
  assert.match(sizeLedgerProblems({ SIZES: [] })[0], /SIZES must be an object/);
});

test('identity without orange: a critter outside CAST copying any CAST look is caught; orange alone is not', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const { lookKey } = await import('../explainers/world-kit/cast.js');
  const cast = { cook: { body: 'ink', wear: ['apron'] }, clerk: { body: 'paper' } };
  const at = (t: number, ...g: [string, object][]) => ({ t, svg: g.map(([who, look]) => `<g data-who="${who}" data-look="${lookKey(look)}"></g>`).join('') });
  assert.deepEqual(T.lookProblems([at(0, ['stranger', { body: 'orange' }])], cast, lookKey, { orange: false }), []);
  assert.match(T.lookProblems([at(0, ['stranger', { body: 'orange' }])], cast, lookKey)[0], /only the hero is an orange critter/, 'the 4.1 default is kept for callers');
  const copy = T.lookProblems([at(1, ['stranger', { body: 'ink', wear: ['apron'] }])], cast, lookKey, { orange: false });
  assert.match(copy[0], /"stranger" wears "cook"'s look/);
  assert.match(T.lookProblems([at(1, ['cook', { body: 'paper' }])], cast, lookKey, { orange: false })[0], /"cook" is drawn as paper\|\| .* but CAST says ink\|apron\|/);
  // outfits: nothing over the face is still checked, the colour is not
  const kit = await import('../explainers/world-kit/cast.js');
  const one = (outfit: object, o?: { orange: boolean }) => T.outfitProblems({ x: { body: 'ink', outfit } }, kit, o);
  assert.deepEqual(one({ top: { kind: 'vest', color: 'orange' } }, { orange: false }), []);
  assert.match(one({ top: { kind: 'vest', color: 'teal' }, head: { kind: 'visor' } }, { orange: false })[0], /covers the eyes or mouth/);
});

// ── Kept: breakage still errors, each under its check ─────────────────────────

test('kept breakage checks: rig, empty container, read text, identity, objects, face cut, occlusion, CAST looks, a shot list that cannot play', async () => {
  const { lookKey } = await import('../explainers/world-kit/cast.js');
  const lensed = (inner: string) => `<g data-lens="1 0 0 540 960">${inner}</g>`;
  const critterBox = (who: string, box: number[], depth = 300) => `<g data-frame-kind="critter" data-frame-who="${who}" data-frame-box="${box.join(' ')}" data-frame-depth="${depth}"></g>`;
  const counter = '<g data-set-part="counter" data-set-hull="0,700 1080,700 1080,1920 0,1920" data-set-depth="100"></g>';
  // a stand-in objects.js (C's real one checks pins and floors; here only the wiring is under test)
  const objects = "export function objectProblems(samples) { return samples.some((s) => /data-object=\"sunk\"/.test(String(s.svg))) ? ['the object \"sunk\" sits below its floor'] : []; }\n";
  const root = project(
    {
      '02-gap': { number: 2, look: 'mechanism', source: "import { phone } from '../kit/glass.js';\nexport default { ground: 'paper', draw: () => String(phone(300, 700, { title: '', messages: [] })) };\n" },
      '04-analogy': { number: 4, look: 'world', source: still(`<g data-who="cook" data-look="${lookKey({ body: 'paper' })}" data-rig="prop-on-face"></g>`) },
      '05-why': { number: 5, look: 'blend', source: still(lensed(counter + critterBox('cook', [400, 800, 600, 1000]) + critterBox('clerk', [-120, 900, 80, 1100]))) },
      '06-example': { number: 6, look: 'mechanism', source: still('<g data-concept="ghost" data-icon="x"></g><g data-object="sunk"></g><text x="300" y="1000" font-size="20" font-family="Roboto">tiny</text>') },
      '07-payoff': { number: 7, look: 'world', source: "export default { ground: 'paper', shots: [{ at: 1, kind: 'wide' }, { at: 0.5, kind: 'ots' }], draw: () => '<g></g>' };\n" },
    },
    { world: "export const CAST = { cook: { body: 'ink' }, clerk: { body: 'ink', wear: ['cap'] } };\n", identity: IDENTITY, kit: { 'objects.js': objects } },
  );
  const r = tryRun(root);
  assert.equal(r.status, 1);
  const problems = r.out.problems ?? [];
  const has = (frame: string, check: string, re: RegExp) => assert.ok(problems.some((p) => p.frame === frame && p.check === check && re.test(p.message)), `${frame} ${check} ${re}\n${r.out.errors.join('\n')}`);
  has('02-gap', 'empty', /a phone with a blank screen/);
  has('04-analogy', 'rig', /"cook" at 0\.00s: a held prop covers its face/);
  has('04-analogy', 'identity', /"cook" is drawn as paper/);
  has('05-why', 'face_cut', /the face of "cook" is cut by "counter"/);
  has('05-why', 'face_cut', /the face of "clerk" is cut by the left edge of the frame/);
  has('06-example', 'identity', /the concept "ghost" is not in assets\/world\/identity\.js/);
  has('06-example', 'objects', /"sunk" sits below its floor/);
  has('06-example', 'text', /"tiny" is 20px/);
  has('07-payoff', 'shots', /over-the-shoulder was removed/);
  has('07-payoff', 'shots', /the first shot starts at 0s/);
});

test("identity: the map's defs go in whole, so a concept mapped to its real object is held to that object in every frame", async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const X = await import('../explainers/world-kit/explain.js');
  const reg = X.identity({ cache: { object: 'box', tone: 'teal', label: 'cache' }, server: { icon: 'server', color: 'blue', shape: 'tile', label: 'server' } });
  const drawn = (object: string, color: string) => [{ t: 0, svg: `<g data-concept="cache" data-shape="object" data-object="${object}" data-color="${color}"></g>` }];
  const def = (reg.defs as Record<string, { object?: unknown; tone?: unknown; toneName?: unknown }>).cache;
  // as the map says: clean
  const same = T.identityMapProblems(drawn(String(def.object), String(def.toneName ?? def.tone)), reg.defs, X.identityProblems);
  assert.deepEqual(same, [], same.join('\n'));
  // drawn as another object than the map's: one real thing per concept
  const other = T.identityMapProblems(drawn('database', String(def.toneName ?? def.tone)), reg.defs, X.identityProblems);
  assert.ok(other.some((p: string) => /"cache" is drawn as 2 objects/.test(p)), other.join('\n'));
});

test("identity: a mapped concept's object drawn freehand (no concept tag) is breakage:identity; tagged, or unmapped, it is not", async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const X = await import('../explainers/world-kit/explain.js');
  const O = await import('../explainers/world-kit/objects.js');
  const reg = X.identity({ cache: { object: 'box', tone: 'teal', label: 'cache' } });
  const at = (svg: string) => [{ t: 1, svg }, { t: 2, svg }];
  const bare = String(O.object('box', [540, 1000]).draw(0));
  const tagged = String(O.object('box', [540, 1000], { concept: 'cache' }).draw(0));
  const free = T.identityMapProblems(at(bare), reg.defs, X.identityProblems).filter((p: string) => /without its concept/.test(p));
  assert.equal(free.length, 1, 'reported once');
  assert.match(free[0], /the object "box" is drawn at 1\.00s without its concept: identity\.js maps it to "cache"/);
  assert.deepEqual(T.identityMapProblems(at(tagged), reg.defs, X.identityProblems).filter((p: string) => /without its concept/.test(p)), []);
  assert.deepEqual(T.identityMapProblems(at(String(O.object('laptop', [540, 1000]).draw(0))), reg.defs, X.identityProblems).filter((p: string) => /without its concept/.test(p)), [], 'an unmapped object');
  // wired: a mechanism frame drawing it freehand fails under breakage:identity
  const root = project({ '02-gap': { number: 2, look: 'mechanism', source: `import { object } from '../kit/objects.js';\nexport default { ground: 'paper', draw: () => String(object('box', [540, 1000]).draw(0)) };\n` } }, { identity: "import { identity } from '../kit/explain.js';\nexport default identity({ cache: { object: 'box', tone: 'teal', label: 'cache' } });\n" });
  const r = tryRun(root);
  assert.ok((r.out.problems ?? []).some((p) => p.frame === '02-gap' && p.rule === 'breakage:identity' && /"box" .* without its concept/.test(p.message)), r.out.errors.join('\n'));
});

test('read text: the set’s own signs are background, never read text', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const svg = '<g data-set="1"><text x="20" y="300" font-size="18">EXIT</text></g><text x="300" y="900" font-size="18">tiny</text>';
  const texts = T.drawnTexts(svg);
  assert.deepEqual(texts.map((x: { text: string; set: boolean }) => [x.text, x.set]), [['EXIT', true], ['tiny', false]]);
  const read = T.readTextProblems([{ t: 0, svg }], { readMin: 34, safeProblems: (b: { name: string }[]) => b.map((x) => `${x.name} leaves`) });
  assert.equal(read.length, 2, read.join('\n'));
  assert.ok(read.every((p: string) => /"tiny"/.test(p)));
});

// ── Jump cuts ─────────────────────────────────────────────────────────────────

test("jump cuts: tonight's 4.0 zoom-only crop cuts fail (frames 2, 3, 6, 7 of job 16491d23)", () => {
  // the shot lists exactly as that job's frames exported them; each a crop of one flat drawing
  const F40: Record<string, { number: number; duration: number; shots: unknown[] }> = {
    '02-gap': { number: 2, duration: 8.877, shots: [{ at: 0, kind: 'medium', zoom: 1.25, push: 1.04, on: [518, 1085] }, { at: 3, kind: 'close', zoom: 1.5, on: [518, 1085] }, { at: 5.106, kind: 'medium', zoom: 1.2, push: 1.04, on: [518, 1085] }] },
    '03-define': { number: 3, duration: 8.142, shots: [{ at: 0, kind: 'wide', on: [518, 1085] }, { at: 3.68, kind: 'medium', zoom: 1.05, on: [540, 1010] }] },
    '06-example': { number: 6, duration: 10.119, shots: [{ at: 0, kind: 'medium', zoom: 1.2, on: [520, 949] }, { at: 3.2, kind: 'close', zoom: 1.4, on: [520, 1082] }, { at: 5.2, kind: 'close', zoom: 1.4, on: [490, 959] }, { at: 6.7, kind: 'close', zoom: 1.3, on: [525, 967] }, { at: 8.4, kind: 'close', zoom: 1.6, on: [520, 1038] }] },
    '07-payoff': { number: 7, duration: 6.7, shots: [{ at: 0, kind: 'medium', zoom: 1.4, push: 1.04, on: [518, 1030] }, { at: 3.778, kind: 'close', zoom: 1.35, push: 1.04, on: [600, 1040] }] },
  };
  const frames = Object.fromEntries(Object.entries(F40).map(([id, f]) => [id, { number: f.number, duration: f.duration, look: 'mechanism', source: cropped(f.shots) }]));
  // frame 3 must draw the dictionary card: give it one, so only the cut is under test
  frames['03-define'].source = frames['03-define'].source.replace("() => \"", "() => '<g data-role=\"definition\"><text x=\"100\" y=\"300\" font-size=\"60\">cache</text></g>' + \"");
  const r = tryRun(project(frames));
  const cuts = (r.out.problems ?? []).filter((p) => p.check === 'jump_cut').map((p) => `${p.frame} ${/shots (\d+) and (\d+)/.exec(p.message)?.slice(1).join('→')}`);
  assert.deepEqual(cuts.sort(), ['02-gap 1→2', '02-gap 2→3', '03-define 1→2', '06-example 1→2', '06-example 2→3', '06-example 3→4', '06-example 4→5', '07-payoff 1→2'], r.out.errors.join('\n'));
});

test('jump cuts: a 2× punch-in or pull-out on the same subject passes, a new part of the drawing passes, another place passes', () => {
  const root = project({
    // the same subject at 1 → 2.2 → 1.1: both cuts change its size 2× or more
    '02-gap': { number: 2, look: 'mechanism', duration: 6, source: cropped([{ at: 0, kind: 'wide' }, { at: 2, kind: 'insert', zoom: 2.2, on: [540, 980] }, { at: 4, kind: 'medium', zoom: 1.1, on: [540, 980] }]) },
    // a crop to a far part of the drawing: a new subject
    '04-analogy': { number: 4, look: 'mechanism', source: cropped([{ at: 0, kind: 'close', zoom: 2.4, on: [300, 700] }, { at: 2, kind: 'close', zoom: 2.4, on: [800, 1500] }]) },
  });
  const r = tryRun(root);
  assert.deepEqual((r.out.problems ?? []).filter((p) => p.check === 'jump_cut'), [], r.out.errors.join('\n'));
});

test('jump cuts on camera shots: the same subject measured from its framed box at the cut; a new subject is always clean', () => {
  // one lens world: the cook stands at the origin; each shot is a camera at its own distance
  const lensFrame = (shots: unknown[]) => [
    "import { scope } from '../kit/draw.js';",
    "import { shotFrame } from '../kit/shots.js';",
    "import * as K from '../kit/lens.js';",
    `export const shots = ${JSON.stringify(shots)};`,
    'export default {',
    "  ground: 'paper',",
    '  shots,',
    '  draw(t) {',
    "    scope('jc-', 'paper');",
    '    return shotFrame(t, shots, (shot, local, i, { P }) => {',
    '      const R = K.rig(P);',
    "      const cook = K.critterAt(P, 0, 0, 0, { who: 'cook', body: 'ink' }, R);",
    "      const jar = K.critterAt(P, 30, 260, 0, { who: 'jar', body: 'paper' }, R);",
    "      return K.render(P, { items: [{ id: 'cook', at: cook.at, svg: cook.svg }, { id: 'jar', at: jar.at, svg: jar.svg }], shot, local });",
    '    });',
    '  },',
    '};',
    '',
  ].join('\n');
  const cam = (dist: number) => ({ pos: [0, -dist, 60], target: [0, 0, 40], fov: 40 });
  const shot = (at: number, subject: string, dist: number) => ({ at, kind: 'medium', subject, cast: ['cook', 'jar'], camera: cam(dist) });
  const root = project({
    // 900 → 700 cm on the cook: about 1.3×, a jump cut
    '04-analogy': { number: 4, look: 'world', source: lensFrame([shot(0, 'cook', 900), shot(2, 'cook', 700)]) },
    // a new subject at the frame cut and inside, then 900 → 380 cm on the cook: well over 2×
    '05-why': { number: 5, look: 'world', duration: 6, source: lensFrame([shot(0, 'jar', 500), shot(2, 'cook', 900), shot(4, 'cook', 380)]) },
  });
  const r = tryRun(root);
  const cuts = (r.out.problems ?? []).filter((p) => p.check === 'jump_cut');
  assert.equal(cuts.length, 1, r.out.errors.join('\n'));
  assert.equal(cuts[0].frame, '04-analogy');
  assert.match(cuts[0].message, /shots 1 and 2: jump cut: the same subject "cook" changes only 1\.\d\d× in size/);
});

test('a cut between frames on the same subject is held to the same 2× rule; a new subject, a new place, or the bank opener is not', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const S = await import('../explainers/world-kit/shots.js');
  const edge = (who: string | null, box: number[] | null, place?: string) => ({ shot: { at: 0, kind: 'medium', subject: who, ...(place ? { place } : {}) }, who, box });
  const a = { first: edge('cook', [400, 800, 600, 1100]), last: edge('cook', [400, 800, 600, 1100]) };
  const near = { first: edge('cook', [380, 760, 620, 1120]), last: edge('cook', null) };
  const far = { first: edge('cook', [200, 400, 800, 1500]), last: edge('cook', null) };
  assert.match(T.edgeCutProblems(a, near, S.jumpCutProblems)[0] ?? '', /^jump cut: the same subject "cook" changes only 1\.\d\d× in size/);
  assert.deepEqual(T.edgeCutProblems(a, far, S.jumpCutProblems), [], '3× closer: a clean cut');
  assert.deepEqual(T.edgeCutProblems(a, { first: edge('fridge', [400, 800, 600, 1100]) }, S.jumpCutProblems), [], 'a new subject');
  assert.deepEqual(T.edgeCutProblems(a, { first: edge('cook', [400, 800, 600, 1100], 'store') }, S.jumpCutProblems), [], 'another place');
  assert.deepEqual(T.edgeCutProblems(a, { first: edge('cook', null) }, S.jumpCutProblems), [], 'not measurable: fail open');

  // through try all: the last shot of 04 and the first of 05 frame the jar the same way
  const flat = (box: number[]) => cropped([{ at: 0, kind: 'medium', subject: 'jar', zoom: 1.5, on: [540, 960] }], `<g data-object="jar"><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="#14B8C4"/></g>`);
  const root = project({ '04-analogy': { number: 4, look: 'mechanism', source: flat([440, 860, 200, 200]) }, '05-why': { number: 5, look: 'mechanism', source: flat([430, 850, 220, 220]) } });
  const r = tryRun(root);
  const cut = (r.out.problems ?? []).find((p) => p.check === 'jump_cut');
  assert.equal(cut?.frame, '05-why', r.out.errors.join('\n'));
  assert.match(cut?.message ?? '', /^cut: the cut from 04-analogy into it: jump cut: the same subject "jar"/);
});

test('a planned bridge is never a jump cut: a carry declared on the storyboard across a frame cut, a change of look, or a carry inside a frame', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const S = await import('../explainers/world-kit/shots.js');
  // the same jar at nearly the same size on both sides of the cut 04 → 05 (a jump cut when unplanned)
  const flat = (box: number[]) => cropped([{ at: 0, kind: 'medium', subject: 'jar', zoom: 1.5, on: [540, 960] }], `<g data-object="jar"><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="#14B8C4"/></g>`);
  const carry = 'carry: jar box 440 860 640 1060';
  const line = (cue: string, extra = '') => `medium — jar — on "${cue}" — angle: front — why: the jar is the cache${extra}`;
  const run = (looks: [string, string], carries: [string, string]) => {
    const r = tryRun(project({
      '04-analogy': { number: 4, look: looks[0], source: flat([440, 860, 200, 200]), shots: [line('jar', carries[0])] },
      '05-why': { number: 5, look: looks[1], source: flat([430, 850, 220, 220]), shots: [line('same', carries[1])] },
    }));
    return (r.out.problems ?? []).filter((p) => p.check === 'jump_cut');
  };
  assert.equal(run(['mechanism', 'mechanism'], ['', '']).length, 1, 'unplanned: a jump cut');
  assert.deepEqual(run(['mechanism', 'mechanism'], [` — ${carry}`, ` — ${carry}`]), [], 'a carry declared on both sides');
  assert.deepEqual(run(['mechanism', 'mechanism'], ['', ` — ${carry}`]), [], 'a carry declared on either side');
  assert.deepEqual(run(['world', 'mechanism'], ['', '']), [], 'a change of look: the same thing seen as something else');
  // the storyboard's carries, one per shot line (null where none), parsed by shots.js parseCarry
  const root = project({ '04-analogy': { number: 4, look: 'world', source: still('<g></g>'), shots: [line('a'), line('b', ` — ${carry}`), 'close — the lid — on "lid" — angle: front — why: x — carry: lid'] } });
  const carries = T.shotCarries(root, { number: 4 }, S.parseCarry);
  assert.equal(carries.length, 3);
  assert.equal(carries[0], null);
  assert.deepEqual(carries[1].box, [440, 860, 640, 1060]);
  assert.deepEqual([carries[2].id, carries[2].box], ['lid', null]);
  // inside a frame: a 1.2 → 1.5 crop is a jump cut unless the storyboard plans a carry on it
  const crops = [{ at: 0, kind: 'medium', zoom: 1.2 }, { at: 2, kind: 'close', zoom: 1.5 }];
  const inFrame = (second: string) => (tryRun(project({ '02-gap': { number: 2, look: 'mechanism', source: cropped(crops), shots: [line('a'), `close — jar — on "b" — angle: front — why: x${second}`] } })).out.problems ?? []).filter((p) => p.check === 'jump_cut');
  assert.equal(inFrame('').length, 1);
  assert.deepEqual(inFrame(` — ${carry}`), []);
});

test('cut samples: the last video frame before each cut and the first after it, with a named subject boxed from the drawing', async () => {
  const T = await import('../explainers/world-kit/try.mjs');
  const S = await import('../explainers/world-kit/shots.js');
  const shots = [{ at: 0, kind: 'medium', subject: 'laptop', zoom: 1.2 }, { at: 2, kind: 'close', subject: 'laptop', zoom: 2.6 }];
  const draw = (t: number) => S.shotFrame(t, shots, () => '<g data-object="laptop"><rect x="440" y="900" width="200" height="120"/></g>');
  const smp = T.cutSamples(draw, shots, { shotAt: S.shotAt });
  assert.deepEqual(smp.map((x: { t: number }) => Math.round(x.t * 1000) / 1000), [1.967, 2]);
  const w = (x: { boxes: { box: number[] }[] }) => x.boxes[0].box[2] - x.boxes[0].box[0];
  assert.ok(Math.abs(w(smp[0]) - 240) < 1 && Math.abs(w(smp[1]) - 520) < 1, JSON.stringify(smp.map((x: { boxes: unknown }) => x.boxes)));
  assert.deepEqual((S.jumpCutProblems as JumpCuts)(shots, { samples: smp, duration: 4 }), [], '1.2 → 2.6: over 2×');
  // subjectBox: through transforms, a named group's union; nothing for an unknown id
  assert.deepEqual(T.subjectBox('<g transform="translate(10 20) scale(2)"><g data-concept="cache"><rect x="0" y="0" width="10" height="5"/><rect x="20" y="0" width="5" height="5"/></g></g>', 'cache'), [10, 20, 60, 30]);
  assert.equal(T.subjectBox('<g data-concept="cache"><rect x="0" y="0" width="10" height="5"/></g>', 'server'), null);
});

test("Phase 1's shot lists: every cut changes subject except mcp's wide → medium on the traveler, which 4.2 calls a jump cut", async () => {
  const S = await import('../explainers/world-kit/shots.js');
  const standOff = (at: number[], dist: number, deg: number, z: number, fov: number) => {
    const a = (deg * Math.PI) / 180;
    return { pos: [at[0] - dist * Math.sin(a), at[1] - dist * Math.cos(a), z], target: at, fov };
  };
  // the subjects and cameras of .explainers-local/previews/4.1/phase1/<topic>/build.mjs SHOTS
  const clean: Record<string, unknown[]> = {
    cache: [
      { at: 0, kind: 'wide', subject: 'cook', cast: ['cook', 'clerk', 'store'], camera: standOff([-40, 40, 80], 470, -6, 120, 46) },
      { at: 3, kind: 'insert', subject: 'carton', cast: ['fridge', 'carton'], camera: standOff([-100, 140, 58], 220, -5, 75, 34) },
      { at: 6, kind: 'medium', subject: 'cook', cast: ['cook', 'fridge'], camera: standOff([-60, 100, 60], 360, 24, 100, 48) },
    ],
    routing: [
      { at: 0, kind: 'medium', subject: 'triage', cast: ['triage', 'patient'], camera: standOff([-110, 55, 55], 650, -24, 110, 44) },
      { at: 3, kind: 'wide', subject: 'patient', cast: ['patient', 'minor'], camera: standOff([120, 120, 60], 470, 32, 150, 46) },
      { at: 6, kind: 'close', subject: 'splinter', cast: ['minor', 'patient', 'splinter'], camera: standOff([195, 125, 45], 640, -8, 70, 34) },
    ],
    'api-key': [
      { at: 0, kind: 'medium', subject: 'sneak', cast: ['sneak', 'reader'], camera: { pos: [120, -600, 58], target: [-45, -205, 85], fov: 36 } },
      { at: 2.2, kind: 'insert', subject: 'reader', cast: ['reader', 'card'], camera: { pos: [-30, -140, 95], target: [-112, -36, 86], fov: 36 } },
      { at: 4.4, kind: 'wide', subject: 'minibar', cast: ['sneak', 'minibar'], camera: { pos: [70, -330, 92], target: [35, 120, 80], fov: 44 } },
    ],
    gpu: [
      { at: 0, kind: 'medium', subject: 'prof', cast: ['prof', 'tower'], camera: { pos: [300, -330, 100], target: [-5, -30, 112], fov: 42 } },
      { at: 2.5, kind: 'insert', subject: 'page', cast: ['page', 'tower'], camera: { pos: [-2, -105, 138], target: [-20, -4, 80], fov: 34 } },
      { at: 5, kind: 'wide', subject: 'hall', cast: ['hall', 'prof', 'tower'], move: { kind: 'push', by: 40 }, camera: { pos: [205, -170, 165], target: [70, 520, 45], fov: 48 } },
    ],
    'git-branch': [
      { at: 0, kind: 'wide', subject: 'architect', cast: ['architect', 'overlay'], camera: standOff([-20, 40, 80], 540, 26, 165, 56) },
      { at: 3, kind: 'medium', subject: 'overlay', cast: ['architect', 'overlay'], camera: standOff([-44, 25, 62], 450, -38, 195, 42), move: { kind: 'push', by: 30 } },
      { at: 6, kind: 'insert', subject: 'master', cast: ['master'], camera: standOff([50, 36, 40], 240, 8, 185, 36) },
    ],
  };
  const jump = S.jumpCutProblems as JumpCuts;
  for (const [topic, shots] of Object.entries(clean)) assert.deepEqual(jump(shots, { duration: 9 }), [], topic);
  const mcp = [
    { at: 0, kind: 'wide', subject: 'traveler', cast: ['traveler', 'adapter'], camera: standOff([-10, 160, 120], 560, 32, 135, 52) },
    { at: 3, kind: 'medium', subject: 'traveler', cast: ['traveler', 'adapter'], camera: standOff([-48, 50, 45], 420, -22, 80, 38), move: { kind: 'push', by: 30 } },
  ];
  assert.match(jump(mcp, { duration: 6 })[0] ?? '', /shots 1 and 2: jump cut: the same subject "traveler" changes only 1\.\d\d×/);
});

// ── snap.mjs and bounds.mjs ──────────────────────────────────────────────────

test('snap world: every SETS place (a room or an exterior) gets a still; VIEWS cover their own places; at most six', async () => {
  const S = await import('../explainers/world-kit/snap.mjs');
  const views = S.worldViews({ SETS: { store: { place: 'a corner store' }, street: { place: 'the street', view: { pos: [0, -900, 160], target: [0, 0, 80], fov: 50 } } } });
  assert.deepEqual(views.map((v: { place?: string }) => v.place ?? 'main'), ['main', 'main', 'store', 'street']);
  assert.deepEqual(views[3].pos, [0, -900, 160], "a brief's own view is used");
  const own = S.worldViews({ VIEWS: [{ pos: [0, -500, 100], target: [0, 0, 80], place: 'store' }], SETS: { store: {}, park: {} } });
  assert.deepEqual(own.map((v: { place?: string }) => v.place ?? 'main'), ['store', 'park'], 'VIEWS replace the default main views');
  const many = S.worldViews({ SETS: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`, {}])) });
  assert.equal(many.length, S.MAX_TIMES);
  assert.equal(S.MAX_CALLS, 4, 'a first look, two revisions and a last look');
});

test('bounds.mjs: text cut off by the frame edge comes back as a breakage:bounds problem (needs the headless Chrome)', async (t) => {
  const B = await import('../explainers/world-kit/bounds.mjs');
  if (!(await B.driver()) || !B.findChrome()) {
    t.skip('no browser driver or headless Chrome here');
    return;
  }
  const root = project({ '02-gap': { number: 2, look: 'mechanism', duration: 0.4, source: still('<text x="900" y="900" font-size="60" font-family="Roboto">off the edge</text>') } });
  const r = await B.checkBounds(root);
  assert.equal(r.ok, false);
  assert.equal(r.problems?.length, r.errors.length);
  assert.equal(r.problems?.[0]?.rule, 'breakage:bounds');
  assert.equal(r.problems?.[0]?.frame, '02-gap');
  assert.match(r.problems?.[0]?.message ?? '', /"off the edge" is cut off by the frame edge/);
  assert.equal(r.errors[0], `02-gap: ${r.problems?.[0]?.message}`);
});
