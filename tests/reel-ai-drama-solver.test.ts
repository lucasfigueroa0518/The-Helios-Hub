// Iteration 11: the problem solver (contract §5–§7, pre-mortem #4–#8, #12–#14, #16, #17). Offline: the model is a stub, and
// the kit runs on a scratch copy of tests/fixtures/iter11-live/project when a Chrome is there (frames 4, 8 and 9 have pictures).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { solveStage } from '../explainers/reel-ai-drama/kit/stage-layout.js';
import { solvedSourceProblems, sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { findChrome } from '../explainers/reel-ai-drama/kit/browser.mjs';
import { compileReel, readCompiled, readSolved } from '../lib/reel-ai-drama/render/compile';
import {
  chooseVersion,
  describePictures,
  installVersion,
  lastResort,
  lastResortFrames,
  liveSolverKit,
  newWords,
  parseLook,
  parseSubmit,
  readVersions,
  recordFindings,
  seriousFindings,
  settleFrame,
  solverLook,
  solverRound,
  SpendGuard,
  workList,
  worstCaseUsd,
  type FrameFinding,
  type FrameVersion,
  type FrameWork,
  type SolverDeps,
  type SolverKit,
} from '../lib/reel-ai-drama/production/solver';
import { BLUEPRINT, SOLVER_BLUEPRINT, SUBMIT_FRAME_TOOL } from '../lib/reel-ai-drama/writing/schemas';
import type { Blueprint, DirectorPlan, VisualsInventory } from '../lib/reel-ai-drama/types';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'iter11-live', 'project');
const KIT = path.join(ROOT, 'explainers', 'reel-ai-drama', 'kit');

// ── Stubs ───────────────────────────────────────────────────────────────────────────────────────────

const db = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
let msgId = 0;
function toolMessage(name: string, input: unknown, model = 'claude-sonnet-5-5'): Anthropic.Message {
  msgId += 1;
  return {
    id: `msg_${msgId}`,
    type: 'message',
    role: 'assistant',
    model,
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [{ type: 'tool_use', id: `tu_${msgId}`, name, input }],
    usage: { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}
type Sent = { params: Record<string, unknown>; at: number; done?: number };
function stubCreate(answer: (params: Record<string, unknown>, i: number) => Anthropic.Message, delayMs = 0) {
  const sent: Sent[] = [];
  const create = async (params: unknown) => {
    const s: Sent = { params: JSON.parse(JSON.stringify(params)) as Record<string, unknown>, at: Date.now() };
    sent.push(s);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    s.done = Date.now();
    return answer(params as Record<string, unknown>, sent.length - 1);
  };
  return { create, sent };
}
const ONE_PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const readImage = () => ({ data: ONE_PX, media_type: 'image/png' as const });

function deps(create: SolverDeps['create'], kit: SolverKit, over: Partial<SolverDeps> = {}): SolverDeps {
  return { db, mode: 'production', jobId: null, create, kitGuide: '# The kit guide\n\nEvery frame type.', models: { look: 'claude-sonnet-5-5', first: 'claude-sonnet-5-5', second: 'claude-opus-5-5' }, limitUsd: 4, kit, readImage, ...over };
}

const brief = { script: 'L1: Microsoft said it was proud to support ICE. L2: More than 300,000 signatures.', pictures: '- V1 (logo): The Microsoft logo.\n- V45 (logo): The ICE seal.', allowed: 'Microsoft proud to support ICE More than 300,000 signatures 500 staff' };

function scratch(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `solver-${name}-`));
}

/** A small project: a storyboard and compiled-looking frame files, no browser needed. */
function tinyProject(frames: { n: number; id: string; treatment: string }[]): string {
  const dir = scratch('tiny');
  const sb = ['---', 'format: 1080x1920', '---', ''];
  for (const f of frames) sb.push(`## Frame ${f.n} — Frame ${f.n}`, '', '- duration: 5s', `- src: compositions/frames/${f.id}.html`, `- treatment: ${f.treatment}`, '');
  fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), sb.join('\n'));
  fs.mkdirSync(path.join(dir, 'assets', 'frames'), { recursive: true });
  for (const f of frames) {
    fs.writeFileSync(path.join(dir, 'assets', 'frames', `${f.id}.js`), `// compiled ${f.id}\n`);
    fs.writeFileSync(path.join(dir, 'assets', 'frames', `${f.id}.events.json`), '[]\n');
  }
  return dir;
}

/** A kit that writes what it's asked and reports what a test tells it to. */
function fakeKit(dir: string, opt: { tryProblems?: (id: string) => string[]; measured?: (id: string) => string[]; words?: (id: string) => string[] } = {}): SolverKit & { compiled: number[] } {
  const compiled: number[] = [];
  return {
    compiled,
    compileFrame: async (plan, n) => {
      compiled.push(n);
      const f = plan.frames.find((x) => x.n === n)!;
      const id = fs.readdirSync(path.join(dir, 'assets', 'frames')).find((x) => x.startsWith(String(n).padStart(2, '0')) && x.endsWith('.js'))!.replace(/\.js$/, '');
      fs.writeFileSync(path.join(dir, 'assets', 'frames', `${id}.js`), `// plan ${JSON.stringify(f.blueprint)}\n`);
      return [];
    },
    tryFrame: (id) => opt.tryProblems?.(id) ?? [],
    measureFrame: (id) => opt.measured?.(id) ?? [],
    readWords: (id) => opt.words?.(id) ?? [],
  };
}

const bp = (asset = 'V1', extra: Partial<Blueprint['pieces'][number]> = {}): Blueprint => ({ ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: [{ id: 'p1', asset, on: '', ...extra }], labels: [], speech: [], marks: [], arrows: [], camera: { move: 'hold', stops: [] }, sounds: [] });
const tinyPlan = (frames: { n: number; blueprint: Blueprint }[]): DirectorPlan => ({ frames: frames.map((f) => ({ n: f.n, name: `Frame ${f.n}`, line_ids: [], treatment: 'collision', asset_ids: ['V1'], purpose: 'job', blueprint: f.blueprint, music: 'hold', on_screen: null })), lines_back: [] });
const work = (n: number, id: string, over: Partial<FrameWork> = {}): FrameWork => ({ n, id, name: `Frame ${n}`, voice: 'Microsoft said it was proud to support ICE.', job: 'the contradiction', duration: 5, blueprint: bp(), findings: [], sheets: [{ file: 'x.png', label: `Frame ${n}, sheet 1` }], still: { file: 'x.png', label: 'Full-size still' }, neighbours: [], ...over });
const submitFrame = (n: number, change: unknown) => ({ frame: n, diagnosis: 'the logo is tiny and the line is about it', approach: 'make it the frame', change });
const GOOD_EVENTS = [{ t: 0, kind: 'ambience', what: 'quiet room tone', dur: 5 }];

// ── Prompts and schemas ─────────────────────────────────────────────────────────────────────────────

test('prompts: solver-look.md and solver-frame.md are the approved draft, verbatim', () => {
  const draft = fs.readFileSync(path.join(ROOT, 'planning', 'AI Mini Docs', 'ITERATION-11-SOLVER-PROMPT-DRAFT.md'), 'utf8');
  for (const name of ['solver-look.md', 'solver-frame.md']) {
    const start = draft.indexOf(`# \`${name}\``);
    assert.ok(start >= 0, name);
    const body = draft.slice(draft.indexOf('\n', start) + 1);
    const end = body.search(/^---\s*$|^# `/m);
    const want = (end < 0 ? body : body.slice(0, end)).trim();
    assert.equal(fs.readFileSync(path.join(ROOT, 'explainers', 'reel-ai-drama', 'prompts', name), 'utf8').trim(), want, name);
  }
});

test('schemas: only the solver may place a piece; the director keeps its blueprint', () => {
  const pieceProps = (s: unknown) => (s as { properties: { pieces: { items: { properties: Record<string, unknown> } } } }).properties.pieces.items.properties;
  assert.equal(pieceProps(BLUEPRINT).place, undefined);
  assert.ok(pieceProps(SOLVER_BLUEPRINT).place);
  assert.deepEqual(Object.keys(pieceProps(SOLVER_BLUEPRINT)).filter((k) => k !== 'place'), Object.keys(pieceProps(BLUEPRINT)));
  assert.equal(SUBMIT_FRAME_TOOL.name, 'submit_frame');
});

// ── Serious findings and the version that ships (§7) ────────────────────────────────────────────────

test('seriousFindings: the named reviewer problems, the named measured tags, the words check and a broken build', () => {
  const f = (x: Partial<FrameFinding>): FrameFinding => ({ frame: 1, from: 'review', what: 'x', ...x });
  const all = [
    f({ item: 'off_edge', severity: 'problem' }),
    f({ item: 'off_edge', severity: 'warning' }),
    f({ item: 'marks_on_target', severity: 'problem' }),
    f({ item: 'readable_text', severity: 'problem' }),
    f({ from: 'measured', what: 'screen: 04-x: [off_frame] "V1" is mostly off the edge (1.0–2.0s)' }),
    f({ from: 'measured', what: '[mark_on_nothing] 04-x: "ring" marks nothing' }),
    f({ from: 'measured', what: 'bounds: [small_text] tiny' }),
    f({ from: 'words', item: 'new_words', what: '[new_words] 2019' }),
    f({ from: 'build', what: 'render threw' }),
  ];
  assert.deepEqual(seriousFindings(all).map((x) => all.indexOf(x)), [0, 3, 4, 5, 7, 8]);
});

const ver = (label: string, seq: number, serious: number, over: Partial<FrameVersion> = {}): FrameVersion => ({ label, seq, round: 1, kind: 'plan', built: true, usd: 0, treatment: 'collision', findings: Array.from({ length: serious }, () => ({ frame: 1, from: 'build' as const, what: 'x' })), review: [], pictures: [], ...over });

test('chooseVersion: fewest serious ships, a tie goes to the latest, a swap back is flagged, an unbuilt version never ships', () => {
  let c = chooseVersion([ver('v0', 0, 2, { kind: 'compiled', round: 0 }), ver('r1', 1, 1)]);
  assert.equal(c.chosen?.label, 'r1');
  assert.equal(c.flag, null);
  c = chooseVersion([ver('v0', 0, 1, { kind: 'compiled', round: 0 }), ver('r1', 1, 1)]);
  assert.equal(c.chosen?.label, 'r1', 'tie → latest');
  c = chooseVersion([ver('v0', 0, 1, { kind: 'compiled', round: 0 }), ver('r1', 1, 3), ver('r2', 2, 2, { round: 2 })]);
  assert.equal(c.chosen?.label, 'v0');
  assert.ok(c.swappedBack && /swapped back to v0/.test(c.flag!));
  c = chooseVersion([ver('v0', 0, 2, { kind: 'compiled', round: 0 }), ver('r1', 1, 0, { built: false })]);
  assert.equal(c.chosen?.label, 'v0');
  assert.ok(c.swappedBack && /didn't build/.test(c.flag!));
});

test('the last resort ships only with strictly fewer serious findings, flagged; a weak-only frame never takes it', () => {
  let c = chooseVersion([ver('v0', 0, 2, { kind: 'compiled', round: 0 }), ver('r1', 1, 1), ver('last', 2, 1, { kind: 'plain', round: 3 })]);
  assert.equal(c.chosen?.label, 'r1', 'a tie keeps the best version');
  c = chooseVersion([ver('v0', 0, 2, { kind: 'compiled', round: 0 }), ver('r1', 1, 1), ver('last', 2, 0, { kind: 'plain', round: 3 })]);
  assert.equal(c.chosen?.label, 'last');
  assert.match(c.flag!, /last resort/);
  assert.deepEqual(lastResortFrames([{ frame: 1, serious: 0, kind: 'plan' }, { frame: 2, serious: 2, kind: 'code' }, { frame: 3, serious: 1, kind: 'plain' }]), [2]);
});

// ── Spend (§5, #12) ─────────────────────────────────────────────────────────────────────────────────

test('spend: the worst case counts every image and the output ceiling; a call that would not fit does not run', async () => {
  const params = { model: 'claude-opus-5-5', max_tokens: 32_000, system: 'x'.repeat(3000), messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'A'.repeat(100000) } }] }] } as never;
  const w = worstCaseUsd(params);
  // 1000 + 4800 tokens in at $4 x2, 32k out at $20.
  assert.ok(Math.abs(w - ((5800 * 8 + 32000 * 20) / 1e6)) < 1e-4, String(w));
  const g = new SpendGuard(1, 0.5);
  assert.ok(g.hold(0.4));
  assert.equal(g.hold(0.2), false, 'a call in flight holds its worst case');
  g.add(0.1);
  g.release(0.4);
  assert.ok(g.fits(0.4) && !g.fits(0.41));

  const dir = tinyProject([{ n: 1, id: '01-a', treatment: 'collision' }]);
  const { create, sent } = stubCreate(() => toolMessage('submit_frame', {}));
  const r = await solverRound({ projectDir: dir, plan: tinyPlan([{ n: 1, blueprint: bp() }]), brief, round: 2, frames: [work(1, '01-a')], inventoryIds: ['V1'] }, deps(create, fakeKit(dir), { limitUsd: 0.2 }));
  assert.equal(sent.length, 0, 'no call ran');
  assert.equal(r.attempts[0]!.skipped, 'limit');
  assert.match(r.problems.join(' '), /limit/);
});

// ── The look ────────────────────────────────────────────────────────────────────────────────────────

test('parseLook and workList: every frame judged; because always, aim on weak and wrong; worst first, serious included', () => {
  const bad = parseLook({ verdicts: [{ frame: 1, verdict: 'strong', because: '' }, { frame: 2, verdict: 'weak', because: 'flat', aim: null }, { frame: 9, verdict: 'wrong', because: 'x', aim: 'y' }] }, [1, 2, 3]);
  assert.equal(bad.problems.length, 4, bad.problems.join(' | '));
  const ok = parseLook({ verdicts: [{ frame: 1, verdict: 'strong', because: 'the seal lands on "ICE"', aim: null }, { frame: 2, verdict: 'weak', because: 'small', aim: 'make the logo the subject' }, { frame: 3, verdict: 'wrong', because: 'cut off', aim: 'whole' }] }, [1, 2, 3]);
  assert.deepEqual(ok.problems, []);
  const findings: FrameFinding[] = [{ frame: 1, from: 'measured', what: '[keep_covered] V1 (1s)' }, { frame: 1, from: 'measured', what: '[off_frame] x' }];
  assert.deepEqual(workList(ok.value!, findings, [1, 2, 3, 4]), [1, 3, 2]);
});

test('solverLook: one cached call with the kit guide in the system, every picture described and every frame sheet; fails open', async () => {
  const dir = tinyProject([{ n: 1, id: '01-a', treatment: 'collision' }, { n: 2, id: '02-b', treatment: 'collision' }]);
  const { create, sent } = stubCreate(() => toolMessage('submit_look', { verdicts: [{ frame: 1, verdict: 'strong', because: 'it shows the seal on the word', aim: null }, { frame: 2, verdict: 'weak', because: 'the logo is a speck', aim: 'the viewer sees whose logo it is' }] }));
  const frames = [1, 2].map((n) => ({ n, id: `0${n}-x`, name: `F${n}`, voice: 'v', job: 'j', sheets: [{ file: 'a.png', label: `Frame ${n}, sheet 1` }, { file: 'b.png', label: `Frame ${n}, sheet 2` }] }));
  const look = await solverLook({ projectDir: dir, brief, frames, findings: [] }, deps(create, fakeKit(dir)));
  assert.deepEqual(look.work, [2]);
  assert.equal(sent.length, 1);
  const p = sent[0]!.params as { system: { text: string; cache_control: unknown }[]; messages: { content: { type: string; text?: string; cache_control?: unknown }[] }[]; model: string };
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.system.length, 1);
  assert.ok(p.system[0]!.cache_control, 'the stable prefix is marked');
  assert.match(p.system[0]!.text, /Call `submit_look` once/);
  assert.match(p.system[0]!.text, /# The kit guide/);
  assert.match(p.system[0]!.text, /`place`/);
  const content = p.messages[0]!.content;
  assert.equal(content.filter((b) => b.type === 'image').length, 4);
  assert.ok(content.some((b) => b.text?.includes('V45 (logo): The ICE seal.')));
  assert.ok(!content.some((b) => b.cache_control), 'a one-shot user message is not marked');
  // Kept on disk: a restarted job doesn't look again.
  const again = await solverLook({ projectDir: dir, brief, frames, findings: [] }, deps(create, fakeKit(dir)));
  assert.equal(sent.length, 1);
  assert.deepEqual(again.work, [2]);

  const dir2 = tinyProject([{ n: 1, id: '01-a', treatment: 'collision' }]);
  const failing = await solverLook({ projectDir: dir2, brief, frames, findings: [{ frame: 1, from: 'measured', what: '[off_frame] x' }] }, deps(async () => { throw new Error('overloaded'); }, fakeKit(dir2)));
  assert.deepEqual(failing.work, [1]);
  assert.match(failing.problems[0]!, /look failed/);
});

test('describePictures: every picture, what it shows, its kind, shape and credit', () => {
  const text = describePictures({ assets: [{ id: 'V1', kind: 'logo', file: 'm/V1.png', shows: 'The Microsoft logo.', credit: 'Wikimedia', width: 800, height: 200, made: false, people: [] }, { id: 'M1', kind: 'object', file: 'm/M1.png', shows: 'A marker drawing.', credit: 'Helios', width: 600, height: 600, made: true, made_kind: 'drawing', people: [] }] as never });
  assert.match(text, /^- V1 \(logo; 800x200\): The Microsoft logo\. Credit: Wikimedia\.$/m);
  assert.match(text, /^- M1 \(object; 600x600; made \(drawing\)\)/m);
});

// ── A submission (#7, #17) ──────────────────────────────────────────────────────────────────────────

const ctx = { n: 4, duration: 5, treatment: 'whiteboard', assets: new Set(['V1', 'V45', 'M4']), allowed: brief.allowed, canMake: false };

test('parseSubmit: a code change needs its events, valid by eventProblems, and kit-only imports; [hand_placed] is waived', () => {
  const module = "import { x } from '../kit/components/stage.js';\nexport default { treatment: 'whiteboard', build(root, ctx) { ctx.nk.collision(root.ownerDocument, {}); }, render(t) {} };\n";
  assert.deepEqual(parseSubmit(submitFrame(4, { kind: 'code', module, events: GOOD_EVENTS }), ctx).problems, []);
  assert.ok(sourceProblems(module).some((p: string) => p.startsWith('[hand_placed]')), 'it would fail a compiled frame');
  assert.deepEqual(solvedSourceProblems(module), []);
  const missing = parseSubmit(submitFrame(4, { kind: 'code', module }), ctx).problems;
  assert.ok(missing.some((p) => /needs `events`/.test(p)), missing.join(' | '));
  assert.ok(parseSubmit(submitFrame(4, { kind: 'code', module, events: [] }), ctx).problems.some((p) => /empty/.test(p)));
  const bad = parseSubmit(submitFrame(4, { kind: 'code', module: module.replace("'../kit/components/stage.js'", "'https://evil.example/x.js'").replace("'whiteboard'", "'photo'"), events: [{ t: 9, kind: 'whoosh' }] }), ctx).problems.join(' | ');
  for (const want of [/imports https/, /must be "whiteboard"/, /t must be a number from 0 to 5/, /kind "whoosh"/]) assert.match(bad, want);
});

test('parseSubmit: a plan change shows only pictures on the list or ordered, valid places, and no new names, numbers or dates', () => {
  assert.deepEqual(parseSubmit(submitFrame(4, { kind: 'plan', blueprint: bp('V45', { place: { x: 100, y: 700, w: 400 } }) }), ctx).problems, []);
  const p = parseSubmit(submitFrame(5, { kind: 'plan', blueprint: { ...bp('V99', { place: { x: 1, y: 2, w: 0 } }), labels: [{ text: 'Signed by 1,000,000 in May 2019', on: '' }] }, makes: [{ id: 'M9', kind: 'drawing', brief: 'a hand' }] }), ctx).problems.join(' | ');
  for (const want of [/`frame` is 4/, /no picture "V99"/, /place/, /1000000|1,000,000/, /May/, /2019/, /no drawing can be ordered/]) assert.match(p, want);
  assert.deepEqual(newWords(['More than 300,000 signatures', 'ICE', 'Proud to support'], brief.allowed), []);
  assert.deepEqual(newWords(['Satya Nadella, 2019'], brief.allowed), ['Satya', 'Nadella', '2019']);
});

test('words check (#7): a built attempt that puts a new name or date on screen gets a serious [new_words] finding', async () => {
  const dir = tinyProject([{ n: 1, id: '01-a', treatment: 'collision' }]);
  let after = false;
  const kit = fakeKit(dir, { words: () => (after ? ['Microsoft', 'Satya Nadella', 'June 2019', 'Reuters'] : ['Microsoft', 'June']) });
  const compile = kit.compileFrame;
  kit.compileFrame = async (plan, n) => ((after = true), compile(plan, n));
  const { create } = stubCreate(() => toolMessage('submit_frame', submitFrame(1, { kind: 'plan', blueprint: bp('V1') })));
  const r = await solverRound({ projectDir: dir, plan: tinyPlan([{ n: 1, blueprint: bp() }]), brief: { ...brief, pictures: '- V1 (logo): The logo. Credit: Reuters.' }, round: 1, frames: [work(1, '01-a')], inventoryIds: ['V1'] }, deps(create, kit));
  const f = r.attempts[0]!.findings.find((x) => x.item === 'new_words');
  assert.ok(f && seriousFindings([f]).length === 1);
  assert.match(f.what, /Satya, Nadella, 2019$/, "the frame's old words and the picture's credit are allowed");
});

// ── Rounds, with a fake kit (#13, #14, #16) ─────────────────────────────────────────────────────────

test('solverRound: the first frame runs alone, then up to 3 at once; applying runs one at a time; the shared block is cached', async () => {
  const frames = [1, 2, 3, 4, 5].map((n) => ({ n, id: `0${n}-f`, treatment: 'collision' }));
  const dir = tinyProject(frames);
  let applying = 0;
  let overlap = false;
  const kit = fakeKit(dir);
  const tryFrame = kit.tryFrame;
  kit.tryFrame = async (id) => {
    applying += 1;
    if (applying > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 15));
    applying -= 1;
    return tryFrame(id);
  };
  const { create, sent } = stubCreate((p) => {
    const n = Number(/## Frame (\d+):/.exec(JSON.stringify(p.messages))?.[1]);
    return toolMessage('submit_frame', submitFrame(n, { kind: 'plan', blueprint: bp('V45') }));
  }, 40);
  const plan = tinyPlan(frames.map((f) => ({ n: f.n, blueprint: bp() })));
  const r = await solverRound({ projectDir: dir, plan, brief, round: 1, frames: frames.map((f) => work(f.n, f.id)), inventoryIds: ['V1', 'V45'] }, deps(create, kit));
  assert.deepEqual(r.attempts.map((a) => [a.frame, a.built]), frames.map((f) => [f.n, true]));
  assert.ok(sent[1]!.at >= sent[0]!.done!, 'the first call finished before the next began');
  const maxAtOnce = Math.max(...sent.map((s) => sent.filter((o) => o.at <= s.at && o.done! > s.at).length));
  assert.ok(maxAtOnce <= 3 && maxAtOnce >= 2, String(maxAtOnce));
  assert.equal(overlap, false, 'applying and trying never overlap');
  // Byte-identical cached prefix: system and the first user block, on every frame call.
  const sys = sent.map((s) => JSON.stringify(s.params.system));
  const shared = sent.map((s) => JSON.stringify((s.params.messages as { content: unknown[] }[])[0]!.content[0]));
  assert.equal(new Set(sys).size, 1);
  assert.equal(new Set(shared).size, 1);
  assert.match(shared[0]!, /cache_control/);
  assert.match(sys[0]!, /Call `submit_frame` once/);
  assert.ok(r.attempts.every((a) => a.newPictures.includes('V45')), 'a changed picture is reported for the image check (#8)');
  assert.deepEqual(Object.keys(readSolved(dir)).sort(), frames.map((f) => f.id));
  // A restart doesn't redo a round that ran.
  const again = await solverRound({ projectDir: dir, plan, brief, round: 1, frames: frames.map((f) => work(f.n, f.id)), inventoryIds: ['V1', 'V45'] }, deps(create, kit));
  assert.ok(again.attempts.every((a) => a.skipped === 'done'));
  assert.equal(sent.length, 5);
});

test('an unbuildable submission gets one retry in the same conversation; failing twice leaves the last good version', async () => {
  const dir = tinyProject([{ n: 1, id: '01-a', treatment: 'collision' }]);
  const before = fs.readFileSync(path.join(dir, 'assets', 'frames', '01-a.js'), 'utf8');
  const kit = fakeKit(dir, { tryProblems: () => ['render threw: boom'] });
  const { create, sent } = stubCreate(() => toolMessage('submit_frame', submitFrame(1, { kind: 'code', module: "export default { treatment: 'collision', build() {}, render() { throw new Error('boom'); } };", events: GOOD_EVENTS })));
  const r = await solverRound({ projectDir: dir, plan: tinyPlan([{ n: 1, blueprint: bp() }]), brief, round: 1, frames: [work(1, '01-a')], inventoryIds: ['V1'] }, deps(create, kit));
  assert.equal(sent.length, 2);
  const retry = sent[1]!.params.messages as { role: string; content: { type: string; is_error?: boolean; content?: string; cache_control?: unknown }[] }[];
  assert.equal(retry.length, 3, 'user, assistant, the error');
  assert.equal(retry[2]!.content[0]!.type, 'tool_result');
  assert.match(retry[2]!.content[0]!.content!, /render threw: boom/);
  assert.ok(retry[2]!.content[0]!.cache_control, 'the retry marks its last block');
  assert.ok(retry[0]!.content[0]!.cache_control, 'and keeps the shared block marked');
  assert.equal(r.attempts[0]!.built, false);
  assert.match(r.problems.join(' '), /keeps its last good version/);
  assert.equal(fs.readFileSync(path.join(dir, 'assets', 'frames', '01-a.js'), 'utf8'), before);
  assert.deepEqual(readSolved(dir), {});
});

test('round 2 runs on the second model with the previous attempt; versions settle; the last resort needs strictly fewer', async () => {
  const dir = tinyProject([{ n: 1, id: '01-a', treatment: 'collision' }]);
  const plan = tinyPlan([{ n: 1, blueprint: bp() }]);
  const kit = fakeKit(dir, { measured: () => ['screen: 01-a: [keep_covered] V45 under V1 (1.0–2.0s)'] });
  const { create, sent } = stubCreate((p) => toolMessage('submit_frame', submitFrame(1, { kind: 'plan', blueprint: bp(String(p.model).includes('opus') ? 'V1' : 'V45') }), String(p.model)));
  const d = deps(create, kit);
  const w = work(1, '01-a', { findings: [{ frame: 1, from: 'measured', what: '[off_frame] V1' }, { frame: 1, from: 'review', item: 'readable_text', severity: 'problem', what: 'too small' }] });
  await solverRound({ projectDir: dir, plan, brief, round: 1, frames: [w], inventoryIds: ['V1', 'V45'] }, d);
  recordFindings(dir, '01-a', 'r1', [{ frame: 1, from: 'review', item: 'off_edge', severity: 'problem', what: 'cut' }]);
  let s = settleFrame(dir, '01-a', 1);
  assert.equal(s.chosen?.label, 'r1', 'r1 has 2 serious, v0 has 2: the tie goes to the latest');
  await solverRound({ projectDir: dir, plan, brief, round: 2, frames: [w], inventoryIds: ['V1', 'V45'] }, d);
  assert.equal(sent[1]!.params.model, 'claude-opus-5-5');
  assert.match(JSON.stringify(sent[1]!.params.messages), /previous attempt, which wasn't enough/);
  assert.match(JSON.stringify(sent[1]!.params.messages), /still_wrong/);
  recordFindings(dir, '01-a', 'r2', [{ frame: 1, from: 'review', item: 'off_edge', severity: 'problem', what: 'cut' }, { frame: 1, from: 'review', item: 'nothing_missing', severity: 'problem', what: 'gone' }]);
  s = settleFrame(dir, '01-a', 1);
  assert.equal(s.chosen?.label, 'r1');
  assert.ok(s.swappedBack && s.flag);
  assert.deepEqual(readSolved(dir)['01-a'], { kind: 'plan', round: 1, usd: readSolved(dir)['01-a']!.usd });
  // Last resort: same serious count as r1 → r1 stays.
  const plainKit = fakeKit(dir, { measured: () => ['[keep_covered] a', '[off_frame] b'] });
  const lr = await lastResort({ projectDir: dir, plan, work: w, allowed: brief.allowed }, plainKit);
  assert.ok(lr.built);
  s = settleFrame(dir, '01-a', 1);
  assert.equal(s.chosen?.label, 'r1');
  assert.deepEqual(readVersions(dir, '01-a').map((v) => v.label), ['v0', 'r1', 'r2', 'last'], 'every attempt is kept');
  // Back to the frame as compiled: solved.json lets go of it.
  installVersion(dir, '01-a', 1, readVersions(dir, '01-a')[0]!);
  assert.deepEqual(readSolved(dir), {});
});

// ── place (§6): the stage ───────────────────────────────────────────────────────────────────────────

const media = (id: string, w: number, h: number) => ({ id, kind: 'logo', width: w, height: h, people: [], flags: ['logo'], regions: { faces: [], visible: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, shape: { w: 1, h: 1, cells: '1' }, tone: { w: 1, h: 1, cells: [0.3] } } });

test('place: a placed piece keeps its exact box; an invalid place is no place, and the layout is unchanged by it', () => {
  const spec = { pieces: [{ id: 'a', media: media('A', 800, 400), at: 0 }, { id: 'b', media: media('B', 600, 600), at: 0 }], labels: [], marks: [], style: 'cutouts', duration: 5, seed: 7 };
  const plain = solveStage(spec as never);
  const ignored = solveStage({ ...spec, pieces: spec.pieces.map((p) => ({ ...p, place: { x: Number.NaN, y: 1, w: 1 } })) } as never);
  assert.deepEqual(ignored.pieces, plain.pieces);
  const placed = solveStage({ ...spec, pieces: [{ ...spec.pieces[0], place: { x: 120, y: 700, w: 480, z: 5 } }, spec.pieces[1]] } as never);
  const a = placed.pieces.find((p: { id: string }) => p.id === 'a');
  assert.ok(Math.abs(a.w - 480) < 0.5 && Math.abs(a.x - 120) < 0.5 && Math.abs(a.y - 700) < 0.5 && a.z === 5, JSON.stringify(a));
  const b = placed.pieces.find((p: { id: string }) => p.id === 'b');
  assert.ok(b && Number.isFinite(b.x), 'the other piece is laid out around it');
});

// ── compile (§6, #5) ────────────────────────────────────────────────────────────────────────────────

/** The fixture's plan, read back from its compiled frames: one frame for each storyboard frame but the close. */
function fixturePlan(dir: string): DirectorPlan {
  const sb = fs.readFileSync(path.join(dir, 'STORYBOARD.md'), 'utf8');
  const frames = [...sb.matchAll(/^## Frame (\d+) — (.*)$/gm)].map((m) => ({ n: Number(m[1]), name: m[2]!.trim() }));
  const out: DirectorPlan = { frames: [], lines_back: [] };
  for (const f of frames) {
    const file = fs.readdirSync(path.join(dir, 'assets', 'frames')).find((x) => x.startsWith(`${String(f.n).padStart(2, '0')}-`) && x.endsWith('.js'))!;
    const src = fs.readFileSync(path.join(dir, 'assets', 'frames', file), 'utf8');
    if (!src.includes('compiledFrame(')) continue;
    const spec = JSON.parse(src.slice(src.indexOf('compiledFrame(') + 14, src.lastIndexOf(');'))) as { treatment: string; blueprint: Blueprint };
    out.frames.push({ n: f.n, name: f.name, line_ids: [], treatment: spec.treatment, asset_ids: [], purpose: 'job', blueprint: spec.blueprint, music: 'hold', on_screen: null });
  }
  return out;
}

function fixtureCopy(): string {
  const dir = scratch('fixture');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.cpSync(KIT, path.join(dir, 'assets', 'kit'), { recursive: true });
  return dir;
}

test('compileReel never overwrites a frame assets/solved.json lists, and puts its solved copy back', async () => {
  const dir = fixtureCopy();
  const plan = fixturePlan(dir);
  assert.equal(plan.frames.length, 12);
  const id = '08-old-email-unexplained-line';
  fs.mkdirSync(path.join(dir, 'assets', 'solved'), { recursive: true });
  const code = "export default { treatment: 'whiteboard', build() {}, render() {} };\n";
  fs.writeFileSync(path.join(dir, 'assets', 'solved', `${id}.js`), code);
  fs.writeFileSync(path.join(dir, 'assets', 'solved', `${id}.events.json`), JSON.stringify(GOOD_EVENTS));
  fs.writeFileSync(path.join(dir, 'assets', 'solved.json'), JSON.stringify({ [id]: { kind: 'code', round: 1, usd: 0.3 } }));
  fs.rmSync(path.join(dir, 'assets', 'frames', `${id}.js`));
  const r = await compileReel({ plan, projectDir: dir, readWords: null });
  assert.equal(fs.readFileSync(path.join(dir, 'assets', 'frames', `${id}.js`), 'utf8'), code);
  assert.ok(r.frames.find((f) => f.id === id)?.solved);
  assert.match(fs.readFileSync(path.join(dir, 'assets', 'frames', '04-the-post-goes-viral.js'), 'utf8'), /compiledFrame/);
  // A rewrite of that frame (the solver's own build) does write it.
  await compileReel({ plan, projectDir: dir, only: [8], rewrite: [8], readWords: null });
  assert.match(fs.readFileSync(path.join(dir, 'assets', 'frames', `${id}.js`), 'utf8'), /compiledFrame/);
  // The solved copy is gone: compiled as planned, and said.
  fs.rmSync(path.join(dir, 'assets', 'solved'), { recursive: true });
  const again = await compileReel({ plan, projectDir: dir, only: [8], readWords: null });
  assert.match(again.problems.join(' '), /solved copy is gone/);
});

// ── The fixture, end to end with the real kit (browser) ─────────────────────────────────────────────

const chrome = process.env.HELIOS_CHROME || findChrome() || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : null);

test('fixture: a plan change, a place change and a code change each build, survive a recompile; a broken code change falls back', { skip: chrome ? false : 'no Chrome', timeout: 15 * 60 * 1000 }, async () => {
  process.env.HELIOS_CHROME = chrome!;
  const dir = fixtureCopy();
  const plan = fixturePlan(dir);
  const kit = liveSolverKit(dir);
  const ids = { 4: '04-the-post-goes-viral', 8: '08-old-email-unexplained-line', 9: '09-300-000-signatures' } as const;
  const bpOf = (n: number) => plan.frames.find((f) => f.n === n)!.blueprint!;
  const codeModule = [
    "import { STAGE } from '../kit/stage-layout.js';",
    'let el = null;',
    'export default {',
    "  treatment: 'stat',",
    '  build(root) {',
    '    const doc = root.ownerDocument;',
    "    el = doc.createElement('div');",
    "    el.textContent = '300,000';",
    "    el.style.cssText = `position:absolute;left:140px;top:${STAGE.top + 300}px;width:800px;text-align:center;font:700 150px sans-serif;color:#f4efe6;`;",
    '    root.appendChild(el);',
    '  },',
    '  render(t) {',
    "    el.style.opacity = String(Math.min(1, t / 0.6));",
    '  },',
    '};',
    '',
  ].join('\n');
  const submits: Record<number, unknown> = {
    // Plan: off the whiteboard onto kraft, as a row; the storyboard's treatment follows.
    4: submitFrame(4, { kind: 'plan', blueprint: { ...bpOf(4), ground: 'kraft', arrangement: 'row', arrows: [], marks: [] } }),
    // place: the ICE seal set exactly where the layout put it too small.
    8: submitFrame(8, { kind: 'plan', blueprint: { ...bpOf(8), pieces: bpOf(8).pieces.map((p) => (p.id === 'p_ice' ? { ...p, place: { x: 140, y: 700, w: 360 } } : p)) } }),
    9: submitFrame(9, { kind: 'code', module: codeModule, events: [{ t: 0, kind: 'ambience', what: 'low room tone', dur: 6 }] }),
  };
  const { create, sent } = stubCreate((p) => {
    const n = Number(/## Frame (\d+):/.exec(JSON.stringify(p.messages))?.[1]);
    return toolMessage('submit_frame', submits[n]);
  });
  const frames = ([4, 8, 9] as const).map((n) => work(n, ids[n], { duration: 6, blueprint: bpOf(n) }));
  const inv = JSON.parse(fs.readFileSync(path.join(dir, 'assets', 'inventory.json'), 'utf8')) as VisualsInventory;
  const inventory = inv.assets.map((a) => a.id);
  const reel = { ...brief, pictures: describePictures(inv) };
  const r = await solverRound({ projectDir: dir, plan, brief: reel, round: 1, frames, inventoryIds: inventory }, deps(create, kit));
  assert.equal(sent.length, 3, r.problems.join(' | '));
  for (const a of r.attempts) assert.ok(a.built, `frame ${a.frame}: ${a.problems.join(' | ')}`);
  // Credits and the frames' own words are no new words; the measured checks ran on each attempt.
  for (const a of r.attempts) assert.ok(!a.findings.some((f) => f.item === 'new_words'), JSON.stringify(a.findings));
  for (const a of r.attempts) assert.ok(!a.findings.some((f) => /could not/.test(f.what)), JSON.stringify(a.findings));
  assert.equal(r.attempts.find((a) => a.frame === 9)!.kind, 'code');
  const sb = fs.readFileSync(path.join(dir, 'STORYBOARD.md'), 'utf8');
  assert.match(sb.slice(sb.indexOf('## Frame 4 '), sb.indexOf('## Frame 5 ')), /^- treatment: collision$/m, "the storyboard's treatment follows the plan change");
  const solved = readSolved(dir);
  assert.deepEqual(Object.keys(solved).sort(), [ids[4], ids[8], ids[9]]);
  assert.equal(solved[ids[9]]!.kind, 'code');

  // compiled-read: the code frame has no manifest and says so; the placed seal sits where it was put.
  const read = readCompiled(dir, { only: [ids[8], ids[9]] });
  assert.equal(read.frames['9']!.manifest, null);
  assert.equal(read.frames['9']!.solved?.kind, 'code');
  assert.ok(read.frames['9']!.words?.includes('300,000'));
  const seal = (read.frames['8']!.manifest as unknown as { pieces: { id: string; x: number; y: number; w: number }[] }).pieces.find((p) => p.id === 'p_ice');
  assert.ok(seal, JSON.stringify(read.frames['8']!.manifest).slice(0, 300));

  // A full recompile from the original plan: every solved frame survives byte for byte, and still tries clean.
  const live = (n: 4 | 8 | 9) => fs.readFileSync(path.join(dir, 'assets', 'frames', `${ids[n]}.js`), 'utf8');
  const kept = { 4: live(4), 8: live(8), 9: live(9) };
  await compileReel({ plan, projectDir: dir, readWords: null });
  for (const n of [4, 8, 9] as const) {
    assert.equal(live(n), kept[n], `frame ${n} survived`);
    assert.deepEqual(await kit.tryFrame(ids[n]), [], `frame ${n} still builds`);
  }

  // Broken code on frame 8, twice: one retry, then frame 8's last good version (its round-1 place change) stays live.
  const broken = submitFrame(8, { kind: 'code', module: "export default { treatment: 'whiteboard', build() {}, render() { throw new Error('boom'); } };\n", events: GOOD_EVENTS });
  const b = stubCreate(() => toolMessage('submit_frame', broken, 'claude-opus-5-5'));
  const r2 = await solverRound({ projectDir: dir, plan, brief: reel, round: 2, frames: [frames[1]!], inventoryIds: inventory }, deps(b.create, kit));
  assert.equal(b.sent.length, 2);
  assert.match(JSON.stringify(b.sent[1]!.params.messages), /render threw/);
  assert.equal(r2.attempts[0]!.built, false);
  assert.equal(live(8), kept[8]);
  assert.deepEqual(readSolved(dir)[ids[8]], solved[ids[8]]);
  assert.notEqual(settleFrame(dir, ids[8], 8).chosen?.label, 'r2', 'a version that did not build never ships');
});
