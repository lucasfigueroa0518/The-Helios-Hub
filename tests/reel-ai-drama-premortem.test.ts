// The pre-mortem: what a fresh live run hits that a replay's saved state never showed. Everything offline: the model is canned
// tool responses at the `create` seam, so the real validators, merge, cut clean-up and custom-piece rules run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

import { frameModule, customProblems } from '../lib/reel-ai-drama/render/compile';
import { sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { measureInventory } from '../lib/reel-ai-drama/harvest/regions';
import { mergeFrames } from '../lib/reel-ai-drama/production/draft';
import { runSubmit, WritingError } from '../lib/reel-ai-drama/writing/llm';
import { SUBMIT_PLAN_TOOL } from '../lib/reel-ai-drama/writing/schemas';
import { salvagePlan, validateFixedPlan, validatePlan } from '../lib/reel-ai-drama/writing/validate';
import { directReel } from '../lib/reel-ai-drama/writing/director';
import type { Asset, DirectorPlan, StoryboardFrame, VisualsInventory, WriterDraft } from '../lib/reel-ai-drama/types';

const line = (id: string, text: string) => ({ id, text, on_screen: null, fact_ids: ['F1'], must_show: null });
const DRAFT: WriterDraft = {
  title: 'A', hook: { line_id: 'L1' },
  rungs: [{ id: 'R1', purpose: 'p', lines: [line('L1', 'She pulled the post.'), line('L2', 'Nobody noticed for a week.'), line('L3', 'Then it came back.')] }],
  peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Who decides?', word_count: 12, central: [],
} as unknown as WriterDraft;
const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, kind: 'event_photo', file: `media/${id}.jpg`, url: `https://x/${id}`, source_page: null, credit: 'Ex', license: null, shows: id, people: [], qids: [], place: null, date_taken: null,
  date_confidence: 'unknown', width: 1080, height: 1350, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...extra,
}) as Asset;
const INV: VisualsInventory = { assets: [asset('V1'), asset('V2'), asset('V3', { character_image: true, kind: 'person_photo', people: ['A B'] })], usable_count: 3, counts: {}, kill: null, usd: 0 } as VisualsInventory;
const bp = (a: string, on = '') => ({ ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: [{ id: 'p', asset: a, on }], labels: [], speech: [], marks: [], arrows: [], camera: { move: 'push', stops: [{ on: '', aim: 'whole' }] }, sounds: [] });
const frame = (n: number, lines: string[], a: string, extra: Partial<StoryboardFrame> = {}): StoryboardFrame => ({
  n, name: `Frame ${n}`, line_ids: lines, treatment: 'photo', asset_ids: [a], purpose: `purpose ${n}`, music: n === 1 ? 'start' : 'hold', on_screen: null, focus: { kind: 'document', what: 'the post' }, blueprint: bp(a), ...extra,
}) as unknown as StoryboardFrame;
const close = (n: number) => ({ n, name: 'Close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'the question', music: 'hold', on_screen: null }) as unknown as StoryboardFrame;
const PLAN = (): DirectorPlan => ({ frames: [frame(1, ['L1'], 'V1'), frame(2, ['L2'], 'V2'), frame(3, ['L3'], 'V1'), close(4)], makes: [], wishes: [], lines_back: [] });
const ctx = { draft: DRAFT, inventory: INV };
const message = (input: unknown, stop = 'tool_use') => ({ id: 'm', model: 'claude-opus-5-5', role: 'assistant', stop_reason: stop, content: [{ type: 'tool_use', id: 'u', name: SUBMIT_PLAN_TOOL.name, input }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const ledger = () => ({ db: { query: async () => ({ rows: [] }) }, mode: 'production', jobId: 'j' }) as never;
const req = (over: Record<string, unknown> = {}) => ({ component: 'director', model: 'claude-opus-5-5', system: 'S', user: 'U', tool: SUBMIT_PLAN_TOOL, maxTokens: 100, parse: (raw: unknown) => validatePlan(raw, ctx), ...over }) as never;

test('the fixture plan is valid, so every test below fails for its own reason', () => {
  assert.deepEqual(validatePlan(PLAN(), ctx).problems, []);
});

// ── The submit loop ─────────────────────────────────────────

test('a non-strict tool: an answer of the wrong shape costs a fix round, not a crash', async () => {
  const answers = [{ frames: [{ n: 1 }, null, { n: 3, treatment: 'photo' }], lines_back: [] }, PLAN()];
  const sent: unknown[] = [];
  const out = await runSubmit(async (p) => (sent.push(p), message(answers.shift()) as never), ledger(), req());
  assert.equal(sent.length, 2);
  assert.equal((out.value as DirectorPlan).frames.length, 4);
});

test('a parser that keeps failing still ends in a WritingError carrying its problems', async () => {
  await assert.rejects(runSubmit(async () => message({ frames: [{ n: 1 }], lines_back: [] }) as never, ledger(), req()), (e: Error) => e instanceof WritingError);
});

test('salvage runs only once the fix rounds are spent, and its answer is what ships', async () => {
  let calls = 0;
  const seen: unknown[] = [];
  const out = await runSubmit(async () => (calls += 1, message({ frames: [], lines_back: [] }) as never), ledger(), req({ salvage: (raw: unknown, problems: string[]) => (seen.push([raw, problems]), PLAN()) }));
  assert.equal(calls, 2);
  assert.equal(seen.length, 1);
  assert.equal((out.value as DirectorPlan).frames.length, 4);
});

// ── A first plan that never passes ──────────────────────────

test('salvage: every structural fault a plan can have comes out as a plan the run can build', () => {
  const raw = {
    frames: [
      frame(7, ['L3', 'L3'], 'V1'),
      { ...frame(9, ['L1', 'L99'], 'NOPE', { music: 'hold', on_screen: 'words nobody wrote' }), blueprint: bp('NOPE') },
      { n: 12, treatment: 'close', line_ids: ['L2'] },
      { n: 3, treatment: 'hologram', line_ids: [], asset_ids: [] },
    ],
    lines_back: 'none',
  };
  const plan = salvagePlan(raw, ['the last frame must be the close'], ctx)!;
  assert.ok(plan);
  assert.deepEqual(plan.frames.map((f) => f.n), [1, 2, 3], 'numbered in order');
  assert.deepEqual(plan.frames.flatMap((f) => f.line_ids), ['L1', 'L2', 'L3'], 'every line once, in order');
  assert.equal(plan.frames.at(-1)!.treatment, 'close');
  assert.deepEqual(plan.frames.at(-1)!.line_ids, []);
  assert.equal(plan.frames[0].music, 'start');
  assert.equal(plan.frames[0].on_screen, null, 'off-script words go; no title takes their place');
  assert.ok(plan.frames[0].asset_ids.length, 'a frame left with no picture borrows one');
  assert.ok(plan.frames.every((f) => f.asset_ids.every((a) => INV.assets.some((x) => x.id === a))));
  assert.deepEqual(plan.lines_back, []);
  assert.ok(plan.repairs?.length, 'and it says so');
  assert.deepEqual(validatePlan(JSON.parse(JSON.stringify({ ...plan, repairs: undefined })), ctx).problems.filter((p) => /numbered|the close|carries|out of script|must start the music|hook/.test(p)), []);
});

test('salvage: a plan with no frames, or no lines to build from, is not a plan', () => {
  assert.equal(salvagePlan({ frames: [], lines_back: [] }, [], ctx), null);
  assert.equal(salvagePlan('nonsense', [], ctx), null);
  assert.equal(salvagePlan({ frames: [{ n: 1, treatment: 'close', line_ids: ['L1'] }], lines_back: [] }, [], ctx), null);
});

test('directReel: a first plan still invalid after its fix round ships repaired; the prefix stays cached', async () => {
  const sent: { system: { cache_control?: unknown }[]; messages: { content: { cache_control?: unknown }[] }[] }[] = [];
  const bad = { frames: [frame(1, ['L1', 'L2', 'L3'], 'V1', { music: 'hold' })], lines_back: [] };
  const plan = await directReel({ db: { query: async () => ({ rows: [] }) }, mode: 'production', jobId: 'j', create: async (p: never) => (sent.push(p), message(bad)), loadPrompt: () => 'P', root: process.cwd() } as never, { draft: DRAFT, inventory: INV, facts: { facts: [] } as never, kitGuide: 'KIT' });
  assert.equal(sent.length, 2, 'the one fix round was still offered');
  assert.equal(plan.frames.at(-1)!.treatment, 'close');
  assert.ok(plan.repairs?.length);
  for (const r of sent) {
    assert.ok(r.system.at(-1)!.cache_control, 'the system prefix carries a breakpoint');
    assert.ok(r.messages[0].content[0].cache_control, 'the shared input carries one too');
  }
});

// ── Fix rounds ──────────────────────────────────────────────

test('a fix answers for its named frames: a partial answer is enough, and frames code has changed cost nothing', () => {
  // Code swapped a character image into frame 3 (a cutout swap): the validator would refuse it, but nobody asked about frame 3.
  const held = PLAN();
  held.frames[2] = frame(3, ['L3'], 'V3', { blueprint: undefined });
  const fix = { plan: held, problems: [{ frame: 2, asset_id: 'V2', why: 'wrong picture' }] };
  assert.ok(validatePlan(JSON.parse(JSON.stringify(held)), ctx).problems.some((p) => /frame 3/.test(p)), 'the frame really is invalid');
  const out = validateFixedPlan({ frames: [frame(2, ['L2'], 'V1', { name: 'A new name' })], lines_back: [] }, fix, ctx);
  assert.deepEqual(out.problems, []);
  assert.equal(out.value!.frames[1].asset_ids[0], 'V1', 'the fix landed');
  assert.equal(out.value!.frames[1].name, 'Frame 2', 'its name, so its timing, stays');
  assert.equal(out.value!.frames[2].asset_ids[0], 'V3', 'the other frame is as the run held it');
});

test('a fix can still be sent back for what it got wrong on its own frame', () => {
  const fix = { plan: PLAN(), problems: [{ frame: 2, asset_id: null, why: 'x' }] };
  const out = validateFixedPlan({ frames: [frame(2, ['L2'], 'NOPE')], lines_back: [] }, fix, ctx);
  assert.ok(out.problems.some((p) => /frame 2 uses NOPE/.test(p)), out.problems.join());
});

test('a fix keeps the makes the plan already has, and only the wishes its frames use', () => {
  const held = { ...PLAN(), makes: [{ id: 'M1', kind: 'setting', brief: 'A room.', from_assets: [], seed: null }] } as unknown as DirectorPlan;
  held.frames[0] = frame(1, ['L1'], 'M1', { blueprint: undefined });
  const asked = { plan: held, problems: [{ frame: 2, asset_id: null, why: 'x' }] };
  const out = validateFixedPlan({
    frames: [frame(2, ['L2'], 'W1', { blueprint: undefined })],
    wishes: [{ id: 'W1', want: 'the post', fallback: 'V2', person: null }, { id: 'W2', want: 'unused', fallback: 'V2', person: null }],
    makes: [],
    lines_back: [],
  }, asked, ctx);
  assert.deepEqual(out.value!.makes!.map((m) => m.id), ['M1']);
  assert.deepEqual(out.value!.wishes!.map((w) => w.id), ['W1']);
});

test('mergeFrames: a fix changes the picture, never the frame id or what was voiced', () => {
  const merged = mergeFrames(PLAN(), { ...PLAN(), frames: [frame(2, ['L1', 'L2'], 'V1', { name: 'Renamed', n: 2 })] }, [2]);
  assert.equal(merged.frames[1].name, 'Frame 2');
  assert.deepEqual(merged.frames[1].line_ids, ['L2']);
  assert.equal(merged.frames[1].asset_ids[0], 'V1');
  assert.deepEqual(merged.frames[0].line_ids, ['L1'], 'no line is carried twice');
});

// ── A fresh harvest's cuts ──────────────────────────────────

test('a cut saved before its photo was known is cleaned with the photo once it is: a fresh run gets what the replay got', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-cut-'));
  fs.mkdirSync(path.join(root, 'media'));
  const W = 200, H = 260;
  // A photo on a green wall; the cut keeps the figure and a rim of that wall.
  const raw = Buffer.alloc(W * H * 4);
  const photo = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dist = Math.hypot((x - 100) / 60, (y - 140) / 110);
    const body = dist < 1, rim = dist < 1.08;
    const [r, g, b] = body ? [190, 150, 130] : [30, 200, 60];
    photo.set([r, g, b], (y * W + x) * 3);
    raw.set([r, g, b, rim ? 255 : 0], (y * W + x) * 4);
  }
  await sharp(photo, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toFile(path.join(root, 'media', 'V1.jpg'));
  await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(root, 'media', 'C1.png'));
  const src = asset('V1', { width: W, height: H, people: ['A B'], kind: 'person_photo' });
  const cut = asset('C1', { file: 'media/C1.png', width: W, height: H, people: ['A B'], kind: 'person_photo', flags: ['cutout', 'transparent', 'cutout_of:V1'] });
  // First as the harvest saves it: no photo in hand.
  const alone = { assets: [cut], usable_count: 1, counts: {}, kill: null, usd: 0 } as VisualsInventory;
  await measureInventory(alone, root);
  assert.equal(cut.regions?.cut?.with_source, false);
  const before = cut.regions!.cut!.fringe ?? 0;
  const inventory = { ...alone, assets: [src, cut] } as VisualsInventory;
  await measureInventory(inventory, root);
  assert.equal(cut.regions?.cut?.with_source, true, 'the next measure cleans it with its photo');
  assert.ok((cut.regions!.cut!.fringe ?? 0) >= before, `the wall's colour is what it looks for now: ${before} → ${cut.regions!.cut!.fringe}`);
  const file = path.join(root, 'media', 'C1.png');
  const stamp = fs.statSync(file).mtimeMs;
  await measureInventory(inventory, root);
  assert.equal(fs.statSync(file).mtimeMs, stamp, 'and only once');
});

// ── Compile ─────────────────────────────────────────────────

const custom = (body: string) => `export default { build(el, ctx) { ${body} }, render(t) {} };`;

test("a custom piece's ordinary code isn't refused for looking like reach", () => {
  for (const body of [
    "el.style.top = '10px'; el.style.left = '4px';",
    "const box = { top: 0, parent: 1, location: 'x', history: [] }; el.dataset.y = box.top;",
    "const top = 20; const parent = el; parent.append(el.ownerDocument.createElement('div')); el.style.top = top + 'px';",
    "// the document on the desk, from the window\nel.textContent = 'Date of the document';",
    "el.textContent = \"Top of the window: fetch this\";",
  ]) assert.deepEqual(customProblems(custom(body)), [], body);
});

test('a custom piece that really reaches out is still refused', () => {
  for (const [body, why] of [
    ['document.body.append(el);', /outside its box/],
    ['window.x = 1;', /outside its box/],
    ['top.location.href;', /outside its box/],
    ['parent.document;', /outside its box/],
    ['location.href = el;', /outside its box/],
    ["fetch(el);", /network/],
    ['new Image();', /network/],
    ['new Function(el);', /code from text/],
    ['eval(el);', /code from text/],
    ['const d = Date;', /clock|randomness/],
    ['el.parentNode.remove();', /outside its box/],
    ['el.ownerDocument.body;', /outside its box/],
  ] as [string, RegExp][]) assert.ok(customProblems(custom(body)).some((p) => why.test(p)), body);
});

test("the story's words in a compiled frame are never read as code", () => {
  const spec = { treatment: 'collision', blueprint: { pieces: [{ id: 'a', label: "He took it from 'the board' and called the transition: slow, new Date() and setTimeout at https://x.test" }] } };
  assert.deepEqual(sourceProblems(frameModule(spec)), []);
  // A hand-written module still gets every rule.
  assert.ok(sourceProblems("import x from 'lodash'; export default { render(t) { Math.random(); } };").length >= 2);
});
