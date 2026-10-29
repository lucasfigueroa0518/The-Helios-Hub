import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { checkFacts, FACTS_FLAG_BELOW, factsVerdict } from '@/lib/reel-ai-drama/checks/facts';
import { viewerVerdict, checkFirstViewer, type ViewerAnswers } from '@/lib/reel-ai-drama/checks/first-viewer';
import { checkIntegrity } from '@/lib/reel-ai-drama/checks/integrity';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { CRAFT_NAMES, directorSystem, loadCraft, loadPrompt, PROMPT_NAMES, writerSystem } from '@/lib/reel-ai-drama/prompts';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { directReel } from '@/lib/reel-ai-drama/writing/director';
import type { SendMessage, SubmitParams } from '@/lib/reel-ai-drama/writing/llm';
import { creditsFor, writePost } from '@/lib/reel-ai-drama/writing/post';
import { buildReviewDoc, flagsReport } from '@/lib/reel-ai-drama/writing/review-doc';
import { applyRevision, countWords, pruneCutLines, validateDraft, validatePlan } from '@/lib/reel-ai-drama/writing/validate';
import { reviseScript, writeScript } from '@/lib/reel-ai-drama/writing/writer';
import { BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures (generic: no real story) ──────────────────────────────────────

const FACTS: FactSheet = {
  summary: 'A founder bet the company on one product, lost a partner, and shipped anyway.',
  timeline: [{ date: '2020-01-01', event: 'The bet', fact_ids: ['F1'] }],
  facts: [
    { id: 'F1', text: 'The founder bet the company on one product.', source_ids: ['S1'], key: true, confidence: 'confirmed' },
    { id: 'F2', text: 'The partner left in March.', source_ids: ['S1'], key: false, confidence: 'single_source' },
  ],
  sources: [{ id: 'S1', url: 'https://example.com/a', title: 'A', publisher: 'Example', date: '2020-01-02', kind: 'report' }],
  quotes: [{ id: 'Q1', speaker: 'The founder', text: 'We ship it.', source_id: 'S1', date: '2020-01-01', context: 'memo' }],
  artifacts: [{ id: 'A1', kind: 'post', text: 'Shipping today.', source_id: 'S1', url: null, date: '2020-04-01' }],
  cast: [],
  places: [],
  verdict: { holds: true, reason: 'confirmed' },
};

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: null, credit: `Photo ${id}`,
    license: null, shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown',
    width: 1600, height: 1200, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...over,
  };
}

const INVENTORY: VisualsInventory = { assets: ['V1', 'V2', 'V3', 'V4'].map((id) => asset(id)), usable_count: 4, counts: {}, kill: null, usd: 0 };

const PITCH = { title: 'The bet', engine: 'end first' } as unknown as Pitch;

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

/** A valid draft: 7 rungs × 20 words = 140 words, turn at R6. */
function goodDraft(): WriterDraft {
  let n = 0;
  const rungs = Array.from({ length: 7 }, (_, i) => ({
    id: `R${i + 1}`,
    purpose: `purpose ${i + 1}`,
    lines: [10, 10].map((count) => ({ id: `L${++n}`, text: `${words(count)}.`, on_screen: null, fact_ids: ['F1'], must_show: null })),
  }));
  return { title: 'T', engine: 'end first', hook: { on_screen: 'One bet', line_id: 'L1' }, rungs, turn_rung_id: 'R6', landing_rung_id: 'R7', close_question: 'Would you have shipped it?', word_count: 0 };
}

const lineIds = (d: WriterDraft) => d.rungs.flatMap((r) => r.lines.map((l) => l.id));

function goodPlan(d: WriterDraft = goodDraft()): DirectorPlan {
  const ids = lineIds(d);
  const frames = Array.from({ length: 7 }, (_, i) => ({
    n: i + 1, name: `f${i + 1}`, line_ids: ids.slice(i * 2, i * 2 + 2), treatment: 'photo', asset_ids: [`V${(i % 4) + 1}`], purpose: 'p', motion: 'push', marks: '', sound: 'room tone',
    music: (i === 0 ? 'start' : 'hold') as DirectorPlan['frames'][number]['music'], on_screen: i === 0 ? 'One bet' : null,
  }));
  frames.push({ n: 8, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null });
  return { frames, lines_back: [] };
}

const LIMITS = DEFAULT_SETTINGS;
const ctx = { facts: FACTS, inventory: INVENTORY, limits: LIMITS };

function toolMessage(name: string, input: unknown, id = 'tu_1'): Anthropic.Message {
  return {
    id: `msg_${id}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function stubSend(responses: Anthropic.Message[]): SendMessage & { calls: SubmitParams[] } {
  const calls: SubmitParams[] = [];
  const fn = (async (params: SubmitParams) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error('no more stub responses');
    return next;
  }) as SendMessage & { calls: SubmitParams[] };
  fn.calls = calls;
  return fn;
}

async function freshDb() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

function stubJev(answer: (state: Record<string, string>) => Record<string, number>): DramaJevRunner {
  let calls = 0;
  return {
    get callCount() {
      return calls;
    },
    async ask(req) {
      calls += 1;
      const a = answer(req.state as Record<string, string>);
      const answers = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { type: 'noul', noul: v }]));
      return { answers, model: 'stub', usage: { input_tokens: 10, output_tokens: 1 } } as never;
    },
  };
}

// ── Prompts ────────────────────────────────────────────────────────────────

test('loadPrompt loads every prompt and craft file; system prompts compose', () => {
  for (const name of PROMPT_NAMES) assert.ok(loadPrompt(name).length > 300, name);
  for (const name of CRAFT_NAMES) assert.ok(loadCraft(name).includes('HARD CONSTRAINTS'), name);
  assert.throws(() => loadPrompt('nope' as never));
  assert.ok(writerSystem().startsWith(loadPrompt('writer')));
  const dir = directorSystem('KIT GUIDE TEXT');
  assert.ok(dir.includes(loadCraft('director-craft')) && dir.includes(loadCraft('writer-craft')) && dir.endsWith('KIT GUIDE TEXT'));
});

// ── Validators ─────────────────────────────────────────────────────────────

test('a valid draft passes and gets its word count from the text', () => {
  const v = validateDraft(goodDraft(), ctx);
  assert.deepEqual(v.problems, []);
  assert.equal(v.value?.word_count, 140);
  assert.equal(countWords('One — two, three.'), 3);
});

test('the draft validator catches each broken rule', () => {
  const problemsFor = (mutate: (d: WriterDraft) => void) => {
    const d = goodDraft();
    mutate(d);
    return validateDraft(d, ctx).problems.join(' | ');
  };
  assert.match(problemsFor((d) => (d.rungs[1]!.lines[0]!.fact_ids = ['F9'])), /cites F9/);
  assert.match(problemsFor((d) => (d.rungs[1]!.lines[0]!.must_show = 'V99')), /must show V99/);
  assert.match(problemsFor((d) => (d.hook.line_id = 'L2')), /hook's line_id/);
  assert.match(problemsFor((d) => (d.hook.on_screen = words(14))), /hook's on-screen words/);
  assert.match(problemsFor((d) => (d.rungs[2]!.lines[0]!.text = words(25))), /rung R3 runs/);
  assert.match(problemsFor((d) => (d.close_question = 'Would you have shipped it')), /question mark/);
  assert.match(problemsFor((d) => (d.close_question = `${words(12)}?`)), /close question runs/);
  assert.match(problemsFor((d) => (d.turn_rung_id = 'R2')), /back half/);
  assert.match(problemsFor((d) => (d.landing_rung_id = 'R6')), /landing_rung_id/);
  assert.match(problemsFor((d) => (d.rungs[3]!.lines[0]!.id = 'L42')), /line 7 has id/);
  assert.match(problemsFor((d) => d.rungs.splice(4, 3)), /narration totals 80 words/);
});

test('a valid plan passes; the plan validator catches coverage, order, treatments and assets', () => {
  const draft = goodDraft();
  assert.deepEqual(validatePlan(goodPlan(draft), { draft, inventory: INVENTORY }).problems, []);
  const problemsFor = (mutate: (p: DirectorPlan) => void) => {
    const p = goodPlan(draft);
    mutate(p);
    return validatePlan(p, { draft, inventory: INVENTORY }).problems.join(' | ');
  };
  assert.match(problemsFor((p) => p.frames[2]!.line_ids.pop()), /no frame carries L6/);
  assert.match(problemsFor((p) => p.frames[3]!.line_ids.push('L1')), /L1 appears in more than one frame/);
  assert.match(problemsFor((p) => ([p.frames[1]!.line_ids, p.frames[2]!.line_ids] = [p.frames[2]!.line_ids, p.frames[1]!.line_ids])), /out of script order/);
  assert.match(problemsFor((p) => p.frames.pop()), /last frame must be the close/);
  assert.match(problemsFor((p) => (p.frames[1]!.treatment = 'hologram')), /not a kit treatment/);
  assert.match(problemsFor((p) => (p.frames[1]!.asset_ids = ['V77'])), /V77, which is not in the inventory/);
  assert.match(problemsFor((p) => (p.frames[1]!.asset_ids = [])), /names no asset/);
  assert.match(problemsFor((p) => (p.frames[0]!.music = 'hold')), /music: start/);
  assert.match(problemsFor((p) => (p.frames[0]!.on_screen = null)), /hook's words/);
  assert.match(problemsFor((p) => p.lines_back.push({ line_id: 'L99', why: 'x', suggestion: 'y' })), /lines_back names L99/);
});

test('a revision changes only noted lines, never cuts the hook, and the plan drops cut lines', () => {
  const draft = goodDraft();
  const rep = (line_id: string, cut = false) => ({ line_id, cut, text: cut ? '' : `${words(10, 'new')}.`, on_screen: null, fact_ids: ['F2'], must_show: null });
  const ok = applyRevision(draft, [rep('L4'), rep('L5', true)], { ...ctx, notedLineIds: ['L4', 'L5'] });
  assert.deepEqual(ok.problems, []);
  const ids = lineIds(ok.value!);
  assert.ok(!ids.includes('L5') && ids.includes('L6'));
  assert.match(ok.value!.rungs[1]!.lines[1]!.text, /^new/);
  assert.match(applyRevision(draft, [rep('L4')], { ...ctx, notedLineIds: ['L3'] }).problems.join(), /L4 was not noted/);
  assert.match(applyRevision(draft, [rep('L1', true)], { ...ctx, notedLineIds: ['L1'] }).problems.join(), /can't be cut/);
  const pruned = pruneCutLines(goodPlan(draft), ok.value!);
  assert.deepEqual(pruned.frames[2]!.line_ids, ['L6']);
  assert.equal(pruned.frames.length, 8);
  const both = applyRevision(draft, [rep('L5', true), rep('L6', true)], { ...ctx, notedLineIds: ['L5', 'L6'] });
  const prunedBoth = pruneCutLines(goodPlan(draft), both.value!);
  assert.equal(prunedBoth.frames.length, 7);
  assert.deepEqual(prunedBoth.frames.map((f) => f.n), [1, 2, 3, 4, 5, 6, 7]);
});

// ── Model steps (stubbed) ──────────────────────────────────────────────────

test('writeScript: cached system prefix, auto tool choice, one validation fix, cost recorded', async () => {
  const db = await freshDb();
  const bad = { ...goodDraft(), rungs: goodDraft().rungs.map((r, i) => (i === 1 ? { ...r, lines: r.lines.map((l) => ({ ...l, fact_ids: ['F9'] })) } : r)) };
  const send = stubSend([toolMessage('submit_script', bad, 'tu_a'), toolMessage('submit_script', goodDraft(), 'tu_b')]);
  const draft = await writeScript({ create: send, db, mode: 'production' }, { pitch: PITCH, facts: FACTS, inventory: INVENTORY, settings: DEFAULT_SETTINGS });
  assert.equal(draft.word_count, 140);
  assert.equal(send.calls.length, 2);
  const first = send.calls[0]!;
  assert.equal(first.model, 'claude-opus-5-5');
  assert.deepEqual(first.tool_choice, { type: 'auto' });
  assert.equal((first.tools as unknown as { strict: boolean }[])[0]!.strict, false, 'the script schema is too large to be strict');
  const system = first.system as Anthropic.TextBlockParam[];
  assert.equal(system.length, 1);
  assert.deepEqual(system[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(system[0]!.text.includes('HARD CONSTRAINTS'));
  assert.ok(typeof first.messages[0]!.content === 'string' && first.messages[0]!.content.includes('## Fact sheet'));
  const fix = send.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(fix[0]!.type, 'tool_result');
  assert.match(String(fix[0]!.content), /cites F9/);
  const { rows } = await db.query<{ component: string; usd: string }>(`SELECT component, usd FROM reel_ai_drama.cost_events`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.component, 'writer');
  assert.ok(Number(rows[0]!.usd) > 0);
});

test('writeScript fails with its spend recorded when the fix round still fails', async () => {
  const db = await freshDb();
  const bad = { ...goodDraft(), close_question: 'no question' };
  const send = stubSend([toolMessage('submit_script', bad, 'a'), toolMessage('submit_script', bad, 'b')]);
  await assert.rejects(writeScript({ create: send, db, mode: 'production' }, { pitch: PITCH, facts: FACTS, inventory: INVENTORY, settings: DEFAULT_SETTINGS }), /question mark/);
  const { rows } = await db.query(`SELECT 1 FROM reel_ai_drama.cost_events WHERE component = 'writer'`);
  assert.equal(rows.length, 1);
});

test('reviseScript merges the replacements; directReel validates the plan; writePost builds credits and the question in code', async () => {
  const db = await freshDb();
  const draft = goodDraft();
  const revised = await reviseScript(
    { create: stubSend([toolMessage('submit_revision', { replacements: [{ line_id: 'L3', cut: false, text: `${words(9, 'fresh')}.`, on_screen: null, fact_ids: ['F2'], must_show: 'V2' }] })]), db, mode: 'production' },
    { draft, linesBack: [{ line_id: 'L3', why: 'no picture', suggestion: 'x' }], facts: FACTS, inventory: INVENTORY },
  );
  assert.match(revised.rungs[1]!.lines[0]!.text, /^fresh/);
  assert.equal(revised.rungs[1]!.lines[1]!.text, draft.rungs[1]!.lines[1]!.text);

  const send = stubSend([toolMessage('submit_plan', goodPlan(draft))]);
  const plan = await directReel({ create: send, db, mode: 'production' }, { draft, inventory: INVENTORY, facts: FACTS, kitGuide: '# Kit guide' });
  assert.equal(plan.frames.length, 8);
  assert.ok((send.calls[0]!.system as Anthropic.TextBlockParam[])[0]!.text.endsWith('# Kit guide'));
  const fixSend = stubSend([toolMessage('submit_plan', goodPlan(draft))]);
  await directReel({ create: fixSend, db, mode: 'production' }, { draft, inventory: INVENTORY, facts: FACTS, kitGuide: '# Kit guide', fix: { plan, problems: [{ frame: 2, asset_id: 'V2', why: 'wrong person' }] } });
  assert.match(String(fixSend.calls[0]!.messages[0]!.content), /Image-check problems[\s\S]*wrong person/);

  const inv = { ...INVENTORY, assets: [asset('V1'), asset('V2', { credit: 'Photo V1' }), asset('V3', { credit: 'Agency' })] };
  assert.deepEqual(creditsFor(inv, ['V3', 'V1', 'V2', 'V3']), ['Agency', 'Photo V1']);
  const post = await writePost(
    { create: stubSend([toolMessage('submit_caption', { caption: 'A bet, a loss, a launch. #history' })]), db, mode: 'production' },
    { draft, facts: FACTS, inventory: inv, usedAssetIds: ['V1', 'V3'] },
  );
  assert.equal(post.question, draft.close_question);
  assert.deepEqual(post.credits, ['Photo V1', 'Agency']);
  assert.equal(post.caption, 'A bet, a loss, a launch. #history');
});

// ── Checks (stubbed) ───────────────────────────────────────────────────────

test('facts check: loose verdict mapping from Jev answers', async () => {
  assert.equal(factsVerdict('L1', { supported: 0.45, meaning_kept: 0.9 }), null);
  assert.equal(factsVerdict('L1', { supported: FACTS_FLAG_BELOW, meaning_kept: FACTS_FLAG_BELOW }), null);
  assert.match(factsVerdict('L1', { supported: 0.1, meaning_kept: 0.9 })!.why, /doesn't support/);
  assert.match(factsVerdict('L2', { supported: 0.9, meaning_kept: 0.05 })!.why, /changes the meaning/);

  const db = await freshDb();
  void db;
  const draft = goodDraft();
  draft.rungs[2]!.lines[0]!.text = 'UNSUPPORTED claim here.';
  draft.rungs[4]!.lines[1]!.text = 'TWISTED meaning here.';
  const jev = stubJev((s) => ({ supported: s.line!.startsWith('UNSUPPORTED') ? 0.08 : 0.92, meaning_kept: s.line!.startsWith('TWISTED') ? 0.15 : 0.88 }));
  const { unsupported } = await checkFacts(jev, { draft, facts: FACTS });
  assert.deepEqual(unsupported.map((u) => u.line_id), ['L5', 'L10']);
  assert.equal(jev.callCount, 14);
});

test('integrity check: record problems in code, a clear "no" or a disqualifier flags, "unsure" passes', async () => {
  const db = await freshDb();
  const draft = goodDraft();
  const inv: VisualsInventory = { ...INVENTORY, assets: [asset('V1'), asset('V2', { credit: '' }), asset('V3'), asset('V4')] };
  const plan = goodPlan(draft);
  const looks = (n: number, verdicts: ('yes' | 'no' | 'unsure' | 'dq')[]) =>
    toolMessage('submit_looks', { looks: verdicts.slice(0, n).map((v, i) => ({ image: i + 1, sees: 'a room', matches: v === 'dq' ? 'yes' : v, disqualified: v === 'dq', why: `image ${i + 1}: ${v}` })) });
  const send = stubSend([looks(4, ['yes', 'no', 'unsure', 'yes']), looks(3, ['dq', 'yes', 'yes'])]);
  const { problems } = await checkIntegrity(
    { create: send, db, mode: 'production', jobDir: '/nowhere', batchSize: 4, readImage: async () => ({ data: 'AAAA', mediaType: 'image/jpeg' }) },
    { plan, inventory: inv, draft },
  );
  assert.deepEqual(problems.map((p) => `${p.frame}:${p.asset_id}`), ['2:V2', '6:V2', '2:V2', '5:V1']);
  assert.match(problems[0]!.why, /no credit/);
  assert.equal(send.calls.length, 2);
  assert.equal(send.calls[0]!.model, DEFAULT_SETTINGS.vision_model);
  const content = send.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[];
  assert.equal(content.filter((b) => b.type === 'image').length, 4);
});

test('first-viewer check: verdict mapping and the stubbed call', async () => {
  const fine: ViewerAnswers = { hook_seconds: 1, muted_followed: true, story_in_my_words: 'A founder shipped.', want_next: 'Did it work?', keep_watching: 4, confused: [] };
  assert.deepEqual(viewerVerdict(fine, 0.8, 1.5), { hookSeconds: 1, understood: true, problems: [], warnings: [] });
  const late = viewerVerdict({ ...fine, hook_seconds: 4, muted_followed: false, want_next: '', keep_watching: 2, confused: [{ at: 12, what: 'who is she?' }] }, 0.2, 1.5);
  assert.equal(late.understood, false);
  // Only what a picture fix can address gets the fix; the rest ship as warnings (#27).
  assert.equal(late.problems.length, 3);
  assert.equal(late.warnings.length, 3);
  assert.match(late.warnings.join(' '), /wanting nothing next/);
  assert.match(late.problems[0]!, /4s; the hook must land within 1.5s/);
  assert.match(viewerVerdict({ ...fine, hook_seconds: null }, 0.9, 1.5).problems[0]!, /never worked out/);

  const db = await freshDb();
  const send = stubSend([toolMessage('submit_viewing', fine)]);
  const jev = stubJev(() => ({ story_match: 0.7 }));
  const out = await checkFirstViewer(
    { create: send, jev, db, mode: 'production', readSheet: async () => 'AAAA' },
    { contactSheet: 'sheet.png', captions: '[0.0] one bet', draft: goodDraft(), facts: FACTS },
  );
  assert.deepEqual(out, { hookSeconds: 1, understood: true, problems: [], warnings: [] });
  assert.equal(send.calls[0]!.model, DEFAULT_SETTINGS.orchestrator_model);
});

// ── Pollution and flags lint ───────────────────────────────────────────────

/** Calibration stories (CALIBRATION.md) must never reach a prompt. */
const CALIBRATION_TERMS = [
  'Musk', 'Altman', 'Sutskever', 'Ilya', 'Murati', 'Zuckerberg', 'LeCun', 'Alexandr Wang', 'Zoph', 'Thinking Machines', 'Hassabis',
  'Jumper', 'AlphaFold', 'Jensen', 'Huang', "Denny's", 'Nvidia', 'ChatGPT', 'Shazeer', 'Sega', 'Irimajiri', 'DeepMind', 'Rosewood',
  'Brockman', 'Amodei', 'Scale AI', 'Johansson', 'Stargate', 'DeepSeek', 'Worldcoin', 'SoftBank', 'Copilot', 'Lake Tahoe', 'Sand Hill',
  'Recruiting Party', 'research preview', 'Attention Is All You Need', 'Nobel', '52-page', 'Ellison', 'AI pin',
];

function promptCorpus(): { file: string; text: string }[] {
  return [
    ...PROMPT_NAMES.map((n) => ({ file: `prompts/${n}.md`, text: loadPrompt(n) })),
    ...CRAFT_NAMES.map((n) => ({ file: `craft/${n}.md`, text: loadCraft(n) })),
  ];
}

test('no prompt or craft file names a calibration story or a blue-chip player', () => {
  const players = BLUE_CHIP_PLAYERS.flatMap((p) => [p.name, ...(p.aka ?? []), ...((p as { aliases?: readonly string[] }).aliases ?? [])]);
  const terms = [...new Set([...CALIBRATION_TERMS, ...players])];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hits: string[] = [];
  for (const { file, text } of promptCorpus()) {
    for (const term of terms) if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}($|[^\\p{L}\\p{N}])`, 'u').test(text)) hits.push(`${file}: ${term}`);
  }
  assert.deepEqual(hits, []);
});

test("flags.json calls are applied: rewrites verbatim, cut principles absent, no cut id cited", () => {
  assert.deepEqual(flagsReport().missingRewrites, []);
  const flags = JSON.parse(readFileSync(path.join('planning', 'AI Mini Docs', 'research', 'flags.json'), 'utf8')) as { items: { id: string; final: { action: string } }[] };
  const cut = new Set(flags.items.filter((f) => f.final.action === 'cut').map((f) => f.id));
  /** A phrase only the cut principle's own wording carries. */
  const CUT_PHRASES: Record<string, RegExp> = {
    'W-31': /impossible to convey in pictures/i,
    'W-34': /leave deliberate gaps/i,
    'W-37': /throttle on pace/i,
    'W-19': /signpost every change/i,
    'W-129': /spoken signpost/i,
    'W-134': /reflection line/i,
    'W-5': /explanatory narrative/i,
    'W-3': /root for/i,
    'W-2': /complication they confront and resolve/i,
    'W-90': /many drafts/i,
    'D-4': /working hypothesis/i,
    'D-5': /hypothesis loosely/i,
    'D-93': /burn down/i,
    'D-78': /label handouts/i,
    'D-64': /fair-use/i,
    'D-97': /microphone/i,
    'D-46': /world's own sound carry scenes before music/i,
    'S-35': /speak to "you"/i,
    'S-39': /brisk baseline/i,
    'S-86': /name the next part/i,
    'S-88': /recap that also works as a hook/i,
    'S-89': /pinned comment/i,
    'S-5': /engaged views/i,
    'D-11': /real outcomes rebuild/i,
  };
  const corpus = promptCorpus();
  const hits: string[] = [];
  for (const [id, re] of Object.entries(CUT_PHRASES)) for (const { file, text } of corpus) if (re.test(text)) hits.push(`${id} in ${file}`);
  for (const { file, text } of corpus) {
    for (const tag of text.match(/\[[^\]]*\]/g) ?? []) for (const id of tag.match(/(?<![A-Z])[WDS]-\d+/g) ?? []) if (cut.has(id)) hits.push(`cut ${id} cited in ${file}`);
  }
  assert.deepEqual(hits, []);
});

test('the review document covers every craft and prompt file', () => {
  const doc = buildReviewDoc();
  for (const n of [...CRAFT_NAMES, ...PROMPT_NAMES]) assert.ok(doc.includes(`\`${n}.md\``), n);
  assert.ok(doc.includes('| W-31 |'));
});
