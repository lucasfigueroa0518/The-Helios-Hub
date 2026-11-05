import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { compiledOptions, wordsAt } from '../explainers/reel-ai-drama/kit/components/compiled.js';
import { cueAt } from '../explainers/reel-ai-drama/kit/components/moves.js';
import { blueprintFields, blueprintTreatment, withBlueprints } from '../explainers/reel-ai-drama/kit/project-files.mjs';
import { eventProblems } from '../explainers/reel-ai-drama/kit/sound.mjs';
import { sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { acceptCustom, compileReel, customProblems, eventsFor, frameModule, MAX_CUSTOM, normalBlueprint, plainBlueprint } from '../lib/reel-ai-drama/render/compile';
import { checkPlanCarried, planMissText, type FrameManifest } from '../lib/reel-ai-drama/render/plan-carried';
import { blueprintAssets, type Blueprint, type CustomPiece, type DirectorPlan, type StoryboardFrame } from '../lib/reel-ai-drama/types';
import { SUBMIT_PLAN_TOOL } from '../lib/reel-ai-drama/writing/schemas';
import { blueprintsIn, dropSecrets, originalsProblem, planWith, storyboardPlan } from '../scripts/reel-ai-drama-replay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the kit's options are plain data, read loosely here
type Compiled = { options: Record<string, any>; reports: string[]; cues: Record<string, number> };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rad-compile-'));

const BP: Blueprint = {
  ground: 'charcoal',
  style: 'paper',
  arrangement: 'solo',
  pieces: [{ id: 'slide', asset: 'V8', role: 'lead', on: '', label: 'The slide' }],
  labels: [{ text: 'In Barcelona', kind: 'place', on: 'free to publish' }],
  speech: [],
  marks: [{ kind: 'highlight', on_piece: 'slide', target: 'text:Can we publish?', on: 'free to publish' }],
  arrows: [],
  camera: { move: 'push', stops: [{ on: 'a slide went up', aim: 'text:Can we publish?' }] },
  sounds: [{ kind: 'foley', what: 'a clicker click', on: 'a slide went up', dur: 0.3 }],
};
const WORDS = 'Then a slide went up saying researchers would now be free to publish'.split(' ').map((text, i) => ({ text, start: 0.4 * i, end: 0.4 * i + 0.35 }));
const LINES = [{ id: 'L1', start: 0, end: 5.2, label: '6 December 2016', label_kind: 'date' }];
const frameOf = (n: number, blueprint?: Blueprint, extra: Partial<StoryboardFrame> = {}): StoryboardFrame => ({
  n, name: `Frame ${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: blueprint ? blueprintAssets(blueprint) : ['V1'], purpose: `purpose ${n}`, music: 'hold', on_screen: null, ...(blueprint ? { blueprint } : {}), ...extra,
});
const planOf = (...frames: StoryboardFrame[]): DirectorPlan => ({ frames, lines_back: [] }) as DirectorPlan;

test('words: a phrase finds its first word; a word not spoken falls back to the line and reports', () => {
  const reports: string[] = [];
  const cues: Record<string, number> = {};
  const at = wordsAt({ words: WORDS, lines: LINES, cueAt, report: (r) => reports.push(r), cues });
  assert.equal(at('free to publish', 'x'), WORDS[10].start);
  assert.equal(at('', 'x'), 0, "'' is the frame's start");
  assert.deepEqual(reports, []);
  assert.equal(at('never said', 'the mark'), 0);
  assert.match(reports[0], /^word_missing: the mark: "never said"/);
  assert.equal(cues['free to publish'], WORDS[10].start);
});

test('compile options: the plan arrives whole, on its words, and the camera starts on the whole frame', () => {
  const media = { V8: { id: 'V8', src: 'x.jpg', width: 1200, height: 600 } };
  const { options, reports, cues } = compiledOptions({ treatment: 'photo', blueprint: BP }, { media, words: WORDS as never[], lines: LINES as never[], duration: 6, cueAt }) as unknown as Compiled;
  assert.deepEqual(reports, []);
  assert.equal(options.pieces[0].media, media.V8);
  assert.equal(options.marks[0].at, WORDS[10].start, 'a planned highlight lands on its word (A8.3)');
  assert.equal(options.marks[0].target, 'text:Can we publish?');
  assert.deepEqual(options.camera.stops.map((s: { aim: string }) => s.aim), ['whole', 'text:Can we publish?'], 'a later stop does not start zoomed in');
  assert.ok(options.labels.some((l: { text: string; kind?: string }) => l.text === '6 December 2016' && l.kind === 'date'), "the line's own label goes through the layout");
  assert.equal(cues['a slide went up'], WORDS[1].start);
});

test('compile options: a thing landing near the cut comes in early enough to be read (A12.2), and the plan check agrees', () => {
  const late: Blueprint = { ...BP, marks: [], camera: { move: 'hold', stops: [] }, labels: [{ text: '4', on: 'to publish' }] };
  const { options, reports, cues } = compiledOptions({ blueprint: late }, { media: { V8: { id: 'V8' } }, words: WORDS as never[], lines: [], duration: 4.6, cueAt }) as unknown as Compiled;
  assert.ok(Math.abs(options.labels[0].at - 3.6) < 1e-6);
  assert.match(reports[0], /^beat_held: /);
  assert.ok(Math.abs(cues['to publish'] - 3.6) < 1e-6);
});

test('custom pieces: two a reel, one a frame, never on a frame without a blueprint or the close, and no code that breaks the rules', () => {
  const plan = planOf(...[1, 2, 3, 4].map((n) => frameOf(n, BP)), { ...frameOf(5, BP), treatment: 'close' }, frameOf(6));
  const good = 'import { h } from "../kit/components/dom.js";\nexport default { build(el, ctx) { el.append(h(el.ownerDocument, "div")); }, render(t) {} };\n';
  const custom = (id: string, frame: number, code = good): CustomPiece => ({ id, frame, why: 'x', aspect: 1, min_width: 300, on: '', code });
  const { custom: kept, rejected } = acceptCustom([custom('k', 1), custom('l', 1), custom('m', 2, 'export default { build() { fetch("x"); }, render() {} };'), custom('slide', 2), custom('n', 5), custom('o', 6), custom('p', 3), custom('q', 4)], plan);
  assert.deepEqual(kept.map((c) => c.id), ['k', 'p']);
  assert.ok(kept.length <= MAX_CUSTOM);
  const why = new Map(rejected.map((r) => [r.id, r.why]));
  assert.match(why.get('l')!, /one custom piece a frame/);
  assert.match(why.get('m')!, /its code/);
  assert.match(why.get('slide')!, /planned piece is already called slide/);
  assert.match(why.get('n')!, /can't take a custom piece/, 'the close');
  assert.match(why.get('o')!, /can't take a custom piece/, 'no blueprint');
  assert.match(why.get('q')!, new RegExp(`at most ${MAX_CUSTOM} custom pieces a reel`));
  assert.deepEqual(acceptCustom(null, plan), { custom: [], rejected: [] });
  for (const bad of ['import x from "https://a.b/c.js"; export default { build() {}, render() {} };', 'export default { build() { setTimeout(() => {}); }, render() { Math.random(); } };', 'import y from "../custom/other.js"; export default { build() {}, render() {} };', 'export default { build() {} };']) {
    assert.ok(customProblems(bad).length > 0, bad);
  }
  assert.deepEqual(customProblems(good), []);
  assert.ok(customProblems('export default { build(el) {}, render(t) { el.style.visibility = "visible"; } };').length > 0);
});

test("the kit never sets visibility to 'visible': it would show through the hidden clip of a frame that isn't playing", () => {
  const dir = path.join('explainers', 'reel-ai-drama', 'kit', 'components');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /visibility\s*(=|:)\s*[^;\n]*['"]visible['"]/, f);
  }
});

test('sounds land on their words in the format the kit checks, with no decorative kinds', () => {
  const timing = { words: WORDS, lines: LINES, duration: 6 };
  const reports: string[] = [];
  const events = eventsFor({ ...BP, sounds: [...BP.sounds, { kind: 'whoosh', what: 'a whoosh', on: 'saying' }, { kind: 'foley', what: 'a thud', on: 'unsaid words' }] }, timing, 6, ['V8'], (r) => reports.push(r));
  assert.deepEqual(eventProblems(events, 6, { assets: new Set(['V8']) }), []);
  assert.equal(events.find((e) => e.what === 'a clicker click')!.t, WORDS[1].start);
  assert.ok(events.every((e) => e.kind !== 'whoosh'));
  assert.match(reports[0], /word_missing: sound "a thud"/);
});

test('a compiled module is logic-free data that passes the kit source rules; a thin blueprint goes plain', () => {
  const code = frameModule({ treatment: 'photo', blueprint: BP, known_names: [] });
  assert.deepEqual(sourceProblems(code), []);
  assert.match(code, /export default compiledFrame\(/);
  assert.equal(normalBlueprint({ pieces: [] } as Partial<Blueprint>), null);
  assert.deepEqual(plainBlueprint({ asset_ids: ['V9'] }).pieces.map((p) => p.asset), ['V9']);
  assert.deepEqual(plainBlueprint({ asset_ids: [] }).pieces, []);
});

test('the frame treatment follows the blueprint, and satisfies assemble and try', () => {
  assert.equal(blueprintTreatment({ treatment: 'photo', blueprint: { ...BP, ground: 'whiteboard' } }), 'whiteboard');
  assert.equal(blueprintTreatment({ treatment: 'photo', blueprint: BP }), 'photo');
  assert.equal(typeof blueprintTreatment({ treatment: 'invented', blueprint: BP }), 'string');
});

test('compileReel writes every frame: names carry across frames, a frame with no blueprint goes plain and is reported, only `only` is written', async () => {
  const projectDir = tmp();
  fs.mkdirSync(path.join(projectDir, 'assets', 'timing'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'STORYBOARD.md'), '## Frame 1 — A\n\n- duration: 6s\n- src: compositions/frames/01-a.html\n\n## Frame 2 — B\n\n- duration: 6s\n- src: compositions/frames/02-b.html\n\n## Frame 3 — C\n\n- duration: 6s\n- src: compositions/frames/03-c.html\n');
  fs.writeFileSync(path.join(projectDir, 'assets', 'timing', '01-a.json'), JSON.stringify({ words: WORDS, lines: [], duration: 6 }));
  const plan = planOf(frameOf(1, BP), frameOf(2, BP), frameOf(3));
  const out = await compileReel({ plan, projectDir, readWords: null });
  assert.deepEqual(out.frames.map((f) => [f.n, f.id, f.plain]), [[1, '01-a', false], [2, '02-b', false], [3, '03-c', true]]);
  assert.ok(out.problems.some((p) => /frame 3: no blueprint/.test(p)));
  const second = fs.readFileSync(path.join(projectDir, 'assets', 'frames', '02-b.js'), 'utf8');
  assert.match(second, /"known_names": \[\s*"The slide"/);
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'frames', '01-a.events.json')));
  fs.rmSync(path.join(projectDir, 'assets', 'frames', '01-a.js'));
  const again = await compileReel({ plan, projectDir, only: [2], seeds: { 2: 7 }, readWords: null });
  assert.equal(again.frames.length, 3);
  assert.ok(!fs.existsSync(path.join(projectDir, 'assets', 'frames', '01-a.js')), 'only the named frame is written');
  assert.match(fs.readFileSync(path.join(projectDir, 'assets', 'frames', '02-b.js'), 'utf8'), /"seed": 7/);
  // A custom piece goes through `custom`: written beside the frames when accepted, dropped with a problem line when not.
  const code = 'export default { build(el) { el.append(el.ownerDocument.createElement("div")); }, render(t) {} };\n';
  const piece = (id: string, frame: number): CustomPiece => ({ id, frame, why: 'x', aspect: 1, min_width: 300, on: '', code });
  const withCustom = await compileReel({ plan, projectDir, only: [2], custom: [piece('drawer', 2), piece('again', 2)], readWords: null });
  assert.equal(fs.readFileSync(path.join(projectDir, 'assets', 'custom', 'drawer.js'), 'utf8'), code);
  assert.match(fs.readFileSync(path.join(projectDir, 'assets', 'frames', '02-b.js'), 'utf8'), /"drawer"/);
  assert.ok(withCustom.problems.some((p) => /frame 2: custom piece again dropped: at most one custom piece a frame/.test(p)), withCustom.problems.join('\n'));
});

const CARRIED: FrameManifest = {
  manifest: {
    pieces: [{ id: 'slide', asset: 'V8', at: 0, box_at_rest: { x: 100, y: 800, w: 300, h: 300 } }],
    labels: [{ text: 'The slide', at: 0 }, { text: 'In Barcelona', at: 3.6 }],
    marks: [{ kind: 'highlight', on: 'slide', target: 'text:Can we publish?', at: 3.6 }],
    camera: { move: 'push', stops: [{ at: 0, aim: 'whole' }, { at: 0.4, aim: 'text:Can we publish?' }] },
  },
  cues: { 'free to publish': 3.6, 'a slide went up': 0.4 },
};

test('plan check: a frame that carries its plan is quiet; each thing lost or late is named', () => {
  const plan = planOf(frameOf(1, BP));
  assert.deepEqual(checkPlanCarried(plan, { 1: CARRIED }), []);
  const lost = (over: FrameManifest['manifest']) => checkPlanCarried(plan, { 1: { ...CARRIED, manifest: { ...CARRIED.manifest, ...over } } });
  assert.deepEqual(lost({ marks: [] }).map((m) => m.kind), ['mark'], 'a dropped highlight (A8.3)');
  assert.deepEqual(lost({ marks: [{ kind: 'highlight', on: 'slide', target: 'text:Can we publish?', at: 5 }] }).map((m) => m.kind), ['mark'], 'a late mark');
  assert.deepEqual(lost({ camera: { move: 'hold', stops: [] } }).map((m) => m.kind), ['camera', 'camera'], 'a lost move (M6.10)');
  assert.deepEqual(lost({ pieces: [] }).map((m) => m.kind).includes('piece'), true);
  assert.match(planMissText(lost({ marks: [] })[0]), /Frame 1/);
  assert.deepEqual(checkPlanCarried(plan, { 1: { manifest: CARRIED.manifest, cues: CARRIED.cues, plain: true } }).map((m) => m.kind), ['frame']);
  assert.deepEqual(checkPlanCarried(plan, {}).map((m) => m.kind), ['frame'], 'no manifest is a miss');
});

test('plan check: a piece on the wrong word or side is a miss (M1.8, M7.3, M10.2, A1.3)', () => {
  const two: Blueprint = { ...BP, marks: [], labels: [], camera: { move: 'hold', stops: [] }, pieces: [{ id: 'a', asset: 'V1', on: '' }, { id: 'b', asset: 'V2', side: 'right', on: 'free to publish' }] };
  const shown = (b: { at: number; x: number }): FrameManifest => ({ cues: { 'free to publish': 3.6 }, manifest: { pieces: [{ id: 'a', asset: 'V1', at: 0 }, { id: 'b', asset: 'V2', at: b.at, box_at_rest: { x: b.x, y: 800, w: 300, h: 300 } }], camera: { move: 'hold', stops: [] } } });
  const plan = planOf(frameOf(1, two));
  assert.deepEqual(checkPlanCarried(plan, { 1: shown({ at: 3.6, x: 700 }) }), []);
  assert.match(checkPlanCarried(plan, { 1: shown({ at: 0, x: 700 }) })[0].why, /lands at 0s/);
  assert.match(checkPlanCarried(plan, { 1: shown({ at: 3.6, x: 100 }) })[0].why, /stands on the left, not the right/);
});

test('the plan tool carries the blueprint and no free-text motion, marks or sound; the storyboard shows it readably', () => {
  const frame = (SUBMIT_PLAN_TOOL.input_schema.properties as Record<string, { items: { properties: Record<string, unknown> } }>).frames.items.properties;
  assert.ok(frame.blueprint);
  for (const gone of ['motion', 'marks', 'sound']) assert.ok(!(gone in frame), gone);
  const fields = new Map(blueprintFields(BP) as [string, string][]);
  assert.match(fields.get('marks')!, /highlight/);
  assert.match(fields.get('marks')!, /free to publish/);
  assert.match(fields.get('pieces')!, /V8/);
  assert.match(fields.get('camera')!, /push/);
  const md = '## Frame 1 — A\n\n- treatment: collage\n- motion: old words\n- marks: old marks\n- sound: old sound\n- music: hold\n- voiceover: "x"\n';
  const written = withBlueprints(md, [frameOf(1, BP)]);
  assert.ok(!/old words|old marks|old sound/.test(written));
  assert.match(written, /- treatment: photo/);
  assert.match(written, /- camera: /);
});

test('replay: a saved storyboard becomes a plan, blueprints join by frame, secrets and originals stay out', () => {
  const md = '## Frame 8 — The slide\n\n- duration: 4.5s\n- src: compositions/frames/08-the-slide.html\n- treatment: photo\n- assets: V35\n- lines: L8\n- purpose: The peak.\n- music: drop\n- on_screen: none\n\n## Frame 9 — Out\n\n- treatment: close\n- assets: V1, V2\n- lines: L9, L10\n- music: hold\n';
  const plan = storyboardPlan(md);
  assert.deepEqual(plan.frames.map((f) => [f.n, f.name, f.treatment, f.asset_ids, f.line_ids, f.on_screen]), [[8, 'The slide', 'photo', ['V35'], ['L8'], null], [9, 'Out', 'close', ['V1', 'V2'], ['L9', 'L10'], null]]);
  const blueprints = blueprintsIn({ blueprints: { 8: BP } });
  const withThem = planWith(plan, blueprints);
  assert.equal(withThem.frames[0].blueprint, BP);
  assert.deepEqual(withThem.frames[0].asset_ids, ['V8']);
  assert.equal(withThem.frames[1].blueprint, undefined);
  assert.throws(() => blueprintsIn([]), /expected/);
  assert.throws(() => blueprintsIn({ one: BP }), /not a frame number/);
  assert.match(originalsProblem('/x/.explainers-local/reel-ai-drama/jobs/j/render/project')!, /copy it first/);
  assert.equal(originalsProblem('/tmp/scratch/project'), null);
  const env = { ANTHROPIC_API_KEY: 'a', HEYGEN_API_KEY: 'b', SUPABASE_SERVICE_TOKEN: 'c', DATABASE_URL: 'd', PATH: '/bin', HOME: '/h' } as unknown as NodeJS.ProcessEnv;
  dropSecrets(env);
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH']);
});

test('plan carried: a label the stage set on two lines, a name and what it says of them, is the planned words', () => {
  const plan = planOf(frameOf(1, BP));
  const b = { ...plan.frames[0]!.blueprint!, pieces: plan.frames[0]!.blueprint!.pieces.map((p, i) => (i === 0 ? { ...p, label: 'Sam Altman the OpenAI chief' } : p)), labels: [] };
  const twoLines = { ...plan, frames: [{ ...plan.frames[0]!, blueprint: b }] };
  const on = (labels: { text: string; sub?: string | null; at: number }[]) => checkPlanCarried(twoLines, { 1: { ...CARRIED, manifest: { ...CARRIED.manifest, labels } } }).filter((m) => /label/.test(planMissText(m)));
  const at = (CARRIED.manifest!.labels ?? [])[0]?.at ?? 0;
  assert.deepEqual(on([{ text: 'Sam Altman', sub: 'the OpenAI chief', at }]).filter((m) => /not on the frame/.test(planMissText(m))), []);
  assert.equal(on([{ text: 'Sam Altman', sub: 'someone else', at }]).filter((m) => /not on the frame/.test(planMissText(m))).length, 1);
});
