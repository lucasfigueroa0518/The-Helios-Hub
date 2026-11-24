import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { compiledOptions, withTouches, wordsAt } from '../explainers/reel-ai-drama/kit/components/compiled.js';
import { cueAt } from '../explainers/reel-ai-drama/kit/components/moves.js';
import { blueprintFields, blueprintTreatment, withBlueprints } from '../explainers/reel-ai-drama/kit/project-files.mjs';
import { eventProblems } from '../explainers/reel-ai-drama/kit/sound.mjs';
import { sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { applyTouches, creativePass, newFindings } from '../lib/reel-ai-drama/production/creative';
import { acceptTouches, compileReel, customProblems, eventsFor, frameModule, MAX_CUSTOM, MAX_TOUCHES, normalBlueprint, plainBlueprint, readTouches, TOUCHES_FILE } from '../lib/reel-ai-drama/render/compile';
import { checkPlanCarried, planMissText, type FrameManifest } from '../lib/reel-ai-drama/render/plan-carried';
import { blueprintAssets, type Blueprint, type CustomPiece, type DirectorPlan, type StoryboardFrame, type Touch, type WriterDraft } from '../lib/reel-ai-drama/types';
import { SUBMIT_PLAN_TOOL, SUBMIT_TOUCHES_TOOL } from '../lib/reel-ai-drama/writing/schemas';
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
  assert.ok(!options.labels.some((l: { text: string }) => l.text === '6 December 2016'), 'a date label does not reach the screen (iteration 12)');
  assert.equal(cues['a slide went up'], WORDS[1].start);
});

test('compile options: a thing landing near the cut comes in early enough to be read (A12.2), and the plan check agrees', () => {
  const late: Blueprint = { ...BP, marks: [], camera: { move: 'hold', stops: [] }, labels: [{ text: '4', kind: 'number', on: 'to publish' }] };
  const { options, reports, cues } = compiledOptions({ blueprint: late }, { media: { V8: { id: 'V8' } }, words: WORDS as never[], lines: [], duration: 4.6, cueAt }) as unknown as Compiled;
  assert.ok(Math.abs(options.labels[0].at - 3.4) < 1e-6);
  assert.match(reports[0], /^beat_held: /);
  assert.ok(Math.abs(cues['to publish'] - 3.4) < 1e-6);
});

test('touches only add: lines, in-turn arrivals, closer cuts, marks; nothing planned moves', () => {
  const touches = [
    { id: 't1', frame: 1, why: 'x', type: 'extra_line', text: 'Yes.', on: 'free to publish' },
    { id: 't2', frame: 1, why: 'x', type: 'mark', kind: 'underline', on_piece: 'slide', on: 'saying' },
    { id: 't3', frame: 1, why: 'x', type: 'closer_cuts', aim: 'slide', on: ['saying', 'free to publish'] },
    { id: 't4', frame: 1, why: 'x', type: 'in_turn', piece_ids: ['slide'], from: 'saying', to: 'publish' },
  ] as Touch[];
  const { blueprint, inTurn, closer } = withTouches(BP, touches);
  assert.equal(blueprint.labels.length, 2);
  assert.equal(blueprint.marks.length, 2);
  assert.equal(blueprint.marks[0], BP.marks[0]);
  assert.equal(blueprint.camera.move, 'tour');
  assert.equal(closer, true);
  assert.deepEqual(inTurn.map((x: { ids: string[] }) => x.ids), [['slide']]);
  assert.equal(BP.labels.length, 1, 'the plan itself is untouched');
});

test('touch limits: three touches, two custom, one of either per frame, and no custom code that breaks the rules', () => {
  const plan = planOf(...[1, 2, 3, 4, 5, 6].map((n) => frameOf(n, BP)));
  const touch = (id: string, frame: number): Touch => ({ id, frame, why: 'x', type: 'extra_line', text: 'y', on: '' });
  const good = 'import { h } from "../kit/components/dom.js";\nexport default { build(el, ctx) { el.append(h(el.ownerDocument, "div")); }, render(t) {} };\n';
  const custom = (id: string, frame: number, code = good): CustomPiece => ({ id, frame, why: 'x', aspect: 1, min_width: 300, on: '', code });
  const { touches, rejected } = acceptTouches({ touches: [touch('a', 1), touch('b', 1), touch('c', 2), touch('d', 3), touch('e', 4)], custom: [custom('k', 5), custom('l', 1), custom('m', 6, 'export default { build() { fetch("x"); }, render() {} };'), custom('n', 6), custom('o', 6)] }, plan);
  assert.equal(touches.touches.length, 3);
  assert.ok(touches.touches.length <= MAX_TOUCHES && touches.custom.length <= MAX_CUSTOM);
  assert.deepEqual(touches.touches.map((t) => t.id), ['a', 'c', 'd']);
  assert.deepEqual(touches.custom.map((c) => c.id), ['k', 'n']);
  assert.ok(rejected.some((r) => r.id === 'b'));
  assert.ok(rejected.some((r) => r.id === 'm'));
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
  const events = eventsFor({ ...BP, sounds: [...BP.sounds, { kind: 'whoosh', what: 'a whoosh', on: 'saying' }, { kind: 'foley', what: 'a thud', on: 'unsaid words' }] }, [], timing, 6, ['V8'], (r) => reports.push(r));
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
  assert.deepEqual(readTouches(projectDir), { touches: [], custom: [] });
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

const DRAFT = { rungs: [{ id: 'R1', purpose: 'x', lines: [{ id: 'L1', text: 'Then a slide went up.' }] }] } as unknown as WriterDraft;
const creativeCtx = (over: Record<string, unknown> = {}) => {
  const costs: unknown[][] = [];
  const projectDir = tmp();
  const requests: { system: { text: string; cache_control?: unknown }[]; messages: { content: { type: string; cache_control?: unknown }[] }[]; tools: unknown[]; tool_choice?: unknown }[] = [];
  return {
    projectDir,
    costs,
    requests,
    ctx: {
      db: { query: async (_sql: string, args: unknown[]) => (costs.push(args), { rows: [] }) },
      mode: 'production',
      jobId: 'job',
      loadPrompt: () => 'THE PROMPT',
      stills: () => ({ ok: true, frames: {}, stills: [{ number: 1, name: 'A', id: '01-a', at: 1.2, file: 'x.jpg' }] }),
      readStill: () => 'BASE64',
      create: async (req: never) => {
        requests.push(req);
        return { content: [{ type: 'tool_use', id: 'u', name: SUBMIT_TOUCHES_TOOL.name, input: { touches: [{ id: 't1', frame: 1, why: 'x', type: 'extra_line', text: 'Yes.', on: '' }, { id: 't2', frame: 1, why: 'x', type: 'extra_line', text: 'No.', on: '' }], custom: [] } }], usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: 'tool_use' };
      },
      ...over,
    } as never,
  };
};

test('the creative pass: one cached call, stable prefix carries the breakpoint, stills in the suffix, cost on the ledger, one touch a frame', async () => {
  const { ctx, projectDir, requests, costs } = creativeCtx();
  const out = await creativePass({ draft: DRAFT, plan: planOf(frameOf(1, BP)), projectDir }, ctx);
  assert.equal(requests.length, 1, 'never a paid fix round');
  const req = requests[0];
  assert.equal(req.system[0].text, 'THE PROMPT');
  assert.ok(req.system.at(-1)!.cache_control, 'the breakpoint is on the stable prefix');
  const user = req.messages[0].content;
  assert.ok(user.some((b) => b.type === 'image'));
  assert.ok(user.every((b) => !b.cache_control), 'never on the per-reel suffix');
  assert.deepEqual(out.touches.touches.map((t) => t.id), ['t1']);
  assert.match(out.problems[0], /t2/);
  assert.ok(out.usd > 0);
  assert.ok(costs[0].includes('creative_pass') && costs[0].includes('job'), 'the cost reaches the job through the ledger');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectDir, TOUCHES_FILE), 'utf8')).touches.map((t: { id: string }) => t.id), ['t1']);
});

test('the creative pass fails open: an error, or no stills, is no touches and a problem line', async () => {
  const thrown = creativeCtx({ create: async () => { throw new Error('the API is down'); } });
  const a = await creativePass({ draft: DRAFT, plan: planOf(frameOf(1, BP)), projectDir: thrown.projectDir }, thrown.ctx);
  assert.deepEqual(a.touches, { touches: [], custom: [] });
  assert.match(a.problems[0], /the API is down/);
  const none = creativeCtx({ stills: () => ({ ok: false, frames: {}, stills: [], skipped: 'no browser' }) });
  const b = await creativePass({ draft: DRAFT, plan: planOf(frameOf(1, BP)), projectDir: none.projectDir }, none.ctx);
  assert.equal(none.requests.length, 0, 'no pictures, no paid call');
  assert.match(b.problems[0], /no browser/);
});

test('the removal rule: a touch with a new finding is removed and the frame recompiled clean; old findings and numbers are not new', async () => {
  assert.deepEqual(newFindings(['[x] 01-a: at y 100'], ['[x] 01-a: at y 240', '[y] 01-a: new']), ['[y] 01-a: new']);
  const good = { id: 'g', frame: 1, why: 'x', type: 'extra_line', text: 'a', on: '' } as Touch;
  const bad = { id: 'b', frame: 2, why: 'x', type: 'extra_line', text: 'b', on: '' } as Touch;
  const broken = { id: 'k', frame: 3, why: 'x', aspect: 1, min_width: 200, on: '', code: '' } as CustomPiece;
  const compiled: [string[], number][] = [];
  let current: string[] = [];
  const { accepted, removed } = await applyTouches({
    proposed: { touches: [good, bad], custom: [broken] },
    compile: async (touches, frame) => {
      current = [...touches.touches, ...touches.custom].map((t) => t.id);
      compiled.push([current, frame]);
    },
    findings: async (frame) => {
      if (frame === 3 && current.includes('k')) throw new Error('no reading');
      return ['[old] always', ...(current.includes('b') ? ['[plate_on_head] 02-b: on a head'] : [])];
    },
  });
  assert.deepEqual(accepted.touches.map((t) => t.id), ['g']);
  assert.deepEqual(accepted.custom, []);
  assert.deepEqual(removed.map((r) => r.id), ['b', 'k']);
  assert.match(removed[0].why, /plate_on_head/);
  assert.deepEqual(compiled.at(-1), [['g'], 3], 'the clean frame is back');
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
