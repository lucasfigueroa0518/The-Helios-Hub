import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { acceptSwap, applyTouches, creativePass, parseTouches } from '@/lib/reel-ai-drama/production/creative';
import { hookOptions, identityUnconfirmed } from '@/lib/reel-ai-drama/hooks/eligibility';
import { soundUserText, validateCues } from '@/lib/reel-ai-drama/render/sound-design';
import { HOOK_IDS, type Asset, type DirectorPlan, type FactSheet, type HookChoice, type VisualsInventory, type WriterDraft } from '@/lib/reel-ai-drama/types';
import { directReel, inventoryForDirecting, scriptForDirecting } from '@/lib/reel-ai-drama/writing/director';
import { SUBMIT_PLAN_TOOL, SUBMIT_TOUCHES_TOOL } from '@/lib/reel-ai-drama/writing/schemas';

/** Iteration 12, part D: the director's hook, its fallbacks, the swap and the score, all with stubbed models and no live call. */

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({
  id, kind: 'person_photo', file: `media/${id}.jpg`, url: null, source_page: null, credit: 'c', license: null, shows: 'A person at a desk.', people: ['Ada Founder'],
  qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 2400, height: 3000, phash: null, character_image: false, made: false, upscaled: false,
  flags: ['identity:verified'], face: { x: 0.4, y: 0.25, w: 0.2, h: 0.16 }, ...over,
} as Asset);

const inv = (...assets: Asset[]): VisualsInventory => ({ assets, usable_count: assets.length, counts: {}, kill: null, usd: 0 });
const RICH = inv(...['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((id) => asset(id)));
const LINE = 'A summer intern changed everything';
const DRAFT = {
  title: 'T', hook: { line_id: 'L1', on_screen: 'OLD TITLE WORDS' },
  rungs: [{ id: 'R1', purpose: 'p', lines: [
    { id: 'L1', text: LINE, on_screen: null, fact_ids: [], must_show: null },
    { id: 'L2', text: 'Nobody noticed at first', on_screen: null, fact_ids: [], must_show: null },
  ] }],
  peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Why?', word_count: 9, central: [],
} as unknown as WriterDraft;
const FACTS = { facts: [], quotes: [], artifacts: [], cast: [], sources: [{ id: 'S1', url: 'https://example.com/a', title: 'A real headline', publisher: 'Example', date: null, kind: 'news' }] } as unknown as FactSheet;

const frame = (n: number, line_ids: string[], over: Any = {}) => ({
  n, name: `F${n}`, line_ids, treatment: 'photo', asset_ids: ['V1'], purpose: 'p', motion: 'push', marks: '', sound: 'room', music: n === 1 ? 'start' : 'hold', on_screen: null, focus: { kind: 'person', what: 'x' }, ...over,
});
const CLOSE = { n: 9, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null };
const planWith = (hook: unknown, frames: Any[] = [frame(1, ['L1']), frame(2, ['L2'])]) => ({ hook, frames: [...frames, { ...CLOSE, n: frames.length + 1 }], makes: [], wishes: [], lines_back: [] });

function stub(answers: unknown[]) {
  const sent: Any[] = [];
  const create = async (p: Any) => {
    sent.push(p);
    const input = answers[Math.min(sent.length - 1, answers.length - 1)];
    return { id: 'm', model: p.model, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `u${sent.length}`, name: p.tools[0].name, input }], usage: { input_tokens: 10, output_tokens: 10 } };
  };
  return { sent, deps: { create, db: { query: async () => ({ rows: [] }) }, mode: 'production', jobId: 'j' } as Any };
}
const direct = (deps: Any, inventory: VisualsInventory, extra: Any = {}) => directReel(deps, { draft: DRAFT, inventory, facts: FACTS, kitGuide: '# Kit', ...extra });
const userText = (req: Any) => req.messages[0].content.map((b: Any) => b.text ?? '').join('\n');
const hookOf = (id: string, ...assets: string[]): HookChoice => ({ id, charged: 'changed everything', beats: assets.map((a, i) => ({ asset: a, on: i ? 'changed' : 'A summer' })) } as HookChoice);

// ── The director ────────────────────────────────────────────────────────────

test('the options reach the director in the cached shared input, and the script carries no hook words', async () => {
  const { sent, deps } = stub([planWith(hookOf('darkroom', 'V1'))]);
  await direct(deps, RICH);
  const block = sent[0].messages[0].content[0];
  assert.match(block.text, /Hook options/);
  assert.ok(block.cache_control, 'the block with the options stays cached');
  assert.doesNotMatch(block.text, /OLD TITLE WORDS/);
  assert.deepEqual(scriptForDirecting(DRAFT).hook, { line_id: 'L1' });
});

test('an eligible choice is kept, with its images and words', async () => {
  const { deps } = stub([planWith(hookOf('darkroom', 'V2'))]);
  const plan = await direct(deps, RICH);
  assert.equal(plan.hook?.id, 'darkroom');
  assert.equal(plan.hook?.beats[0]?.asset, 'V2');
  assert.equal(plan.hook?.charged, 'changed everything');
});

test('an asset outside the option cannot get through', async () => {
  const { deps } = stub([planWith(hookOf('darkroom', 'V2', 'NOT-IN-THE-BANK'))]);
  const plan = await direct(deps, RICH);
  assert.ok(plan.hook);
  assert.ok(!plan.hook.beats.some((b) => b.asset === 'NOT-IN-THE-BANK'));
});

test('an ineligible choice becomes the code\'s choice, flagged', async () => {
  // No dates anywhere, so rewind's gate can't pass.
  assert.ok(!hookOptions(RICH, []).some((o) => o.id === 'rewind'));
  const { deps } = stub([planWith(hookOf('rewind', 'V1', 'V2', 'V3'))]);
  const plan = await direct(deps, RICH);
  assert.ok(plan.hook);
  assert.notEqual(plan.hook.id, 'rewind');
  assert.ok(plan.hook.flags?.length, 'what code changed ships as a flag');
});

test('a missing choice becomes the code\'s choice, flagged', async () => {
  const { deps } = stub([planWith(null)]);
  const plan = await direct(deps, RICH);
  assert.ok(plan.hook);
  assert.ok(plan.hook.flags?.length);
});

test('a thin bank falls back and the reel still gets a hook; an empty one gets none and still ships', async () => {
  const thin = stub([planWith(hookOf('flashbulb', 'V1', 'V2', 'V3'))]);
  const fell = await direct(thin.deps, inv(asset('V1', { people: ['A'] }), asset('V2', { people: ['B'] }), asset('V3', { people: ['C'] })));
  assert.ok(fell.hook);
  assert.notEqual(fell.hook.id, 'flashbulb');
  assert.ok(fell.hook.flags?.length);

  const empty = stub([planWith(null)]);
  const bare = await direct(empty.deps, inv(asset('V1', { kind: 'logo', flags: ['logo'], people: [], width: 200, height: 200, face: null })));
  assert.ok(!bare.hook);
  assert.equal(bare.frames.length, 3);
});

test('a fix keeps the plan\'s hook, unless it names frame 1 and answers with a new one', async () => {
  const held = hookOf('darkroom', 'V1');
  const before = { ...planWith(held), hook: held } as unknown as DirectorPlan;

  const other = stub([{ frames: [frame(2, ['L2'])], makes: [], wishes: [], lines_back: [], hook: hookOf('darkroom', 'V3') }]);
  const kept = await direct(other.deps, RICH, { fix: { kind: 'pre_build', plan: before, problems: [{ frame: 2, asset_id: null, why: 'x' }] } });
  assert.equal(kept.hook?.beats[0]?.asset, 'V1');

  const silent = stub([{ frames: [frame(1, ['L1'])], makes: [], wishes: [], lines_back: [], hook: null }]);
  assert.equal((await direct(silent.deps, RICH, { fix: { kind: 'pre_build', plan: before, problems: [{ frame: 1, asset_id: null, why: 'x' }] } })).hook?.beats[0]?.asset, 'V1');

  const first = stub([{ frames: [frame(1, ['L1'])], makes: [], wishes: [], lines_back: [], hook: hookOf('darkroom', 'V3') }]);
  const changed = await direct(first.deps, RICH, { fix: { kind: 'pre_build', plan: before, problems: [{ frame: 1, asset_id: null, why: 'x' }] } });
  assert.equal(changed.hook?.beats[0]?.asset, 'V3');
  assert.match(userText(first.sent[0]), /The hook the plan has/);
});

test('frame 1 is asked once to carry the opening line alone, and a plan that stays this way still ships', async () => {
  const wide = planWith(hookOf('darkroom', 'V1'), [frame(1, ['L1', 'L2'])]);
  const { sent, deps } = stub([wide]);
  const plan = await direct(deps, RICH);
  assert.equal(sent.length, 2);
  assert.match(JSON.stringify(sent[1].messages), /opening line \(L1\) alone/);
  assert.equal(plan.frames.length, 2);
});

test('the opening has no words of its own, whatever comes back', async () => {
  const words = planWith(hookOf('darkroom', 'V1'), [
    frame(1, ['L1'], { blueprint: { hook: { text: 'BIG WORDS', on: '' }, pieces: [{ id: 'a', asset: 'V1', on: '' }], camera: { move: 'push', stops: [] }, sounds: [] } }),
    frame(2, ['L2']),
  ]);
  const plan = await direct(stub([words]).deps, RICH);
  assert.equal(plan.frames[0]!.on_screen, null);
  assert.ok(plan.frames[0]!.blueprint);
  assert.equal((plan.frames[0]!.blueprint as Any).hook, undefined);
});

test('an unconfirmed identity names nobody in what the director reads', () => {
  const marked = asset('V9', { shows: 'A man on stage; captioned as Ada Founder; not confirmed.', anchor_for: 'Ada Founder' } as Partial<Asset>);
  const [seen, clean] = inventoryForDirecting(inv(marked, asset('V1'))) as Any[];
  assert.equal(identityUnconfirmed(marked), true);
  assert.deepEqual(seen.people, []);
  assert.equal(seen.anchor_for, null);
  assert.equal(seen.identity_unconfirmed, true);
  assert.match(seen.shows, /not confirmed/);
  assert.deepEqual(clean.people, ['Ada Founder']);
  assert.equal(clean.identity_unconfirmed, undefined);
});

// ── The problem solver ──────────────────────────────────────────────────────

function project() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iter12-d-'));
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'inventory.json'), JSON.stringify(RICH));
  return projectDir;
}
const stills = () => ({ ok: true, frames: {}, stills: [{ number: 1, name: 'F1', id: 'f1', at: 1, file: 'x.jpg' }] });
const PLAN_NOW = { ...planWith(hookOf('darkroom', 'V1')), hook: hookOf('darkroom', 'V1') } as unknown as DirectorPlan;
const solve = (answer: unknown) => {
  const { sent, deps } = stub([answer]);
  const projectDir = project();
  return creativePass({ draft: DRAFT, plan: PLAN_NOW, projectDir, sources: [] }, { ...deps, loadPrompt: () => 'P', stills, readStill: () => 'B' }).then((out) => ({ ...out, sent, projectDir }));
};

test('the solver sees the opening and its options, and a swap among them is written out', async () => {
  const out = await solve({ touches: [], custom: [], hook_swap: hookOf('darkroom', 'V4') });
  assert.equal(out.touches.hook_swap?.beats[0]?.asset, 'V4');
  const text = userText(out.sent[0]);
  assert.match(text, /The opening now/);
  assert.match(text, /Hook options/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out.projectDir, 'assets', 'touches.json'), 'utf8')).hook_swap.id, 'darkroom');
});

test('a swap to a hook that does not qualify is dropped and the opening stays', async () => {
  const out = await solve({ touches: [], custom: [], hook_swap: hookOf('rewind', 'V1', 'V2', 'V3') });
  assert.equal(out.touches.hook_swap, undefined);
  assert.ok(out.problems.some((p) => /hook swap to rewind dropped/.test(p)));
});

test('no swap is an answer, and a hook frame takes no touches', async () => {
  const out = await solve({ touches: [{ id: 't1', frame: 1, why: 'w', type: 'ground_tone', on: 'changed', to: 0.5 }], custom: [], hook_swap: null });
  assert.equal(out.touches.hook_swap, undefined);
  assert.equal(out.touches.touches.length, 0);
  assert.equal(parseTouches({ touches: [], custom: [], hook_swap: null }).value?.hook_swap, undefined);
  assert.equal(acceptSwap(null, [], { inventory: RICH, sources: [], words: LINE }).hook_swap, null);
});

test('a swap is measured like a touch: what breaks the frame is removed', async () => {
  const swap = hookOf('darkroom', 'V4');
  const compiled: Any[] = [];
  let broken = false;
  const out = await applyTouches({
    proposed: { touches: [], custom: [], hook_swap: swap },
    compile: async (t) => { compiled.push(t); broken = Boolean(t.hook_swap); },
    findings: async () => (broken ? ['frame 1: broke'] : []),
  });
  assert.equal(out.accepted.hook_swap, undefined);
  assert.equal(out.removed[0]?.id, 'hook_swap');

  const fine = await applyTouches({ proposed: { touches: [], custom: [], hook_swap: swap }, compile: async () => {}, findings: async () => [] });
  assert.equal(fine.accepted.hook_swap?.id, 'darkroom');
});

// ── Sound ───────────────────────────────────────────────────────────────────

const CLOCK = [{
  number: 1, id: 'f1', name: 'F1', start: 0, duration: 3, fields: { lines: 'L1', treatment: 'photo' },
  words: LINE.split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 })),
}];

test('the designer is told the hook\'s score, which it adds to and never removes', () => {
  const reel = { clock: CLOCK, total: 3, closeStart: null, hookFrame: 1, peakFrames: [], landingFrames: [], hooked: true };
  const text = soundUserText(reel, DRAFT, { ...PLAN_NOW, frames: [] } as DirectorPlan);
  assert.match(text, /opening hook darkroom/);
  assert.match(text, /"changed everything" @1\.5/);
  assert.match(text, /never remove/);
  assert.match(text, new RegExp(`Opening line: "${LINE}"`));
  assert.doesNotMatch(text, /OLD TITLE WORDS/);
});

test('a hook is the opening\'s arc, so its absence of a riser is no craft gap', () => {
  const lib = { styles: [], stingers: {}, ambience: [] } as Any;
  const reel = { clock: CLOCK, total: 3, closeStart: null, hookFrame: 1, peakFrames: [], landingFrames: [] };
  const arc = (r: Any) => validateCues({}, r, lib).problems.some((p) => /riser-to-hit/.test(p));
  assert.equal(arc(reel), true);
  assert.equal(arc({ ...reel, hooked: true }), false);
});

// ── The prompts ─────────────────────────────────────────────────────────────

const read = (f: string) => fs.readFileSync(path.join('explainers', 'reel-ai-drama', f), 'utf8');
const MINE = ['prompts/director.md', 'prompts/sound-designer.md', 'prompts/creative-pass.md', 'prompts/fix.md', 'prompts/frame-worker.md', 'prompts/build-workflow.md', 'craft/director-craft.md'];

test('no prompt of this part asks for hook words or frame 1\'s date, or names a test reel', () => {
  for (const f of MINE) {
    const text = read(f);
    assert.doesNotMatch(text, /hook's words|hook's on-screen|on-screen promise|L1`?'s (?:date )?label|its date label|never remove a date label|other than a date/i, f);
    assert.doesNotMatch(text, /\b(?:Jobs|Hinton|Dell|Siri|Chrome|Pichai|Srinivas|Kittlaus|Redmond)\b/, f);
  }
});

test('the hook rule is a hard constraint with its fields, and every name in it matches the schemas and the types', () => {
  const director = read('prompts/director.md');
  assert.match(director, /18\. Hook, in the first plan: `hook` is always present/);
  const plan = (SUBMIT_PLAN_TOOL.input_schema as Any).properties.hook;
  assert.deepEqual(plan.required, ['id', 'beats', 'charged']);
  for (const field of Object.keys(plan.properties)) assert.ok(director.includes(`\`${field}\``), `director.md names ${field}`);
  for (const field of ['asset', 'on']) assert.ok(director.includes(`\`${field}\``));
  for (const id of HOOK_IDS) assert.doesNotMatch(director, new RegExp(`\`${id}\``), 'hooks come from the options, not the prompt');
  const solver = read('prompts/creative-pass.md');
  assert.ok((SUBMIT_TOUCHES_TOOL.input_schema as Any).properties.hook_swap);
  assert.match(solver, /HARD CONSTRAINT: `hook_swap`/);
  for (const field of Object.keys(plan.properties)) assert.ok(solver.includes(`\`${field}\``), `creative-pass.md names ${field}`);
  assert.match(read('prompts/sound-designer.md'), /add\s+to it and never remove it/);
  assert.match(read('prompts/sound-designer.md'), /The voice stays on top/);
});
