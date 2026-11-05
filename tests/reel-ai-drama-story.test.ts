import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { SUBMIT_PITCHES_TOOL, validatePitch } from '@/lib/reel-ai-drama/development/producer';
import { estimateRebrief, REBRIEF_MODEL, rebriefPitch, rebriefUserMessage } from '@/lib/reel-ai-drama/development/rebrief';
import { CRAFT_NAMES, directorSystem, loadCraft, loadPrompt, PROMPT_NAMES, storyEditorSystem, writerSystem } from '@/lib/reel-ai-drama/prompts';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import { FOCUS_KINDS, peakRungId, pitchBrief, pitchCentral, type Asset, type DirectorPlan, type FactSheet, type Pitch, type VisualsInventory, type WriterDraft } from '@/lib/reel-ai-drama/types';
import type { SendMessage, SubmitParams } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_PLAN_TOOL, SUBMIT_SCRIPT_TOOL, SUBMIT_STORY_NOTES_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { editStory, scriptForEditor } from '@/lib/reel-ai-drama/writing/story-editor';
import { factTimeline } from '@/lib/reel-ai-drama/writing/timeline';
import { validateDraft, validatePlan, validateStoryNotes } from '@/lib/reel-ai-drama/writing/validate';
import { reviseScript, writeScript, writerUserMessage } from '@/lib/reel-ai-drama/writing/writer';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures (generic: no real story; nothing calls a model) ────────────────

const FACTS: FactSheet = {
  summary: 'A founder bet the company on one product and a partner tried to stop it.',
  timeline: [
    { date: '2020-03-01', event: 'The partner leaves', fact_ids: ['F2'] },
    { date: '2020-01-05', event: 'The bet', fact_ids: ['F1'] },
  ],
  facts: [
    { id: 'F1', text: 'The founder bet the company on one product.', source_ids: ['S1'], key: true, confidence: 'confirmed' },
    { id: 'F2', text: 'The partner left in March', source_ids: ['S1'], key: false, confidence: 'single_source' },
    { id: 'F3', text: 'The office was above a bakery.', source_ids: ['S1'], key: false, confidence: 'confirmed' },
  ],
  sources: [{ id: 'S1', url: 'https://example.com/a', title: 'A', publisher: 'Example', date: '2020-01-02', kind: 'report' }],
  quotes: [{ id: 'Q1', speaker: 'Jane Roe', text: 'We ship it.', source_id: 'S1', date: '2020-02-01', context: 'in a memo' }],
  artifacts: [{ id: 'A1', kind: 'post', text: 'Shipping today.', source_id: 'S1', url: null, date: '2020-04-01', verified: false }],
  cast: [
    { name: 'Jane Roe', role: 'founder', kind: 'person', player_id: null, qid: null },
    { name: 'Max Doe', role: 'partner', kind: 'person', player_id: null, qid: null },
  ],
  places: [],
  verdict: { holds: true, reason: 'confirmed' },
};

function asset(id: string): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: null, credit: `Photo ${id}`,
    license: null, shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown',
    width: 1600, height: 1200, phash: null, character_image: false, made: false, upscaled: false, flags: [],
  };
}
const INVENTORY: VisualsInventory = { assets: ['V1', 'V2', 'V3', 'V4'].map(asset), usable_count: 4, counts: {}, kill: null, usd: 0 };
const BRIEF = 'In early 2020 a founder bets her company on one product while her partner tries to stop her. Focus on the bet.';
const PITCH = {
  title: 'The bet', brief: BRIEF, story_type: 'big_bet', era: 'scale_up', event_date: '2020-01-05', date_precision: 'day',
  cast: [{ name: 'Acme', role: 'company', kind: 'company', player_id: null }, { name: 'Jane Roe', role: 'founder', kind: 'person', player_id: null }],
  why_now: null, expected_visuals: [], sources: [],
} as Pitch;

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

/** 7 rungs × 20 words; the peak at R5, the landing last. */
function goodDraft(): WriterDraft {
  let n = 0;
  const rungs = Array.from({ length: 7 }, (_, i) => ({
    id: `R${i + 1}`,
    purpose: `rung ${i + 1}`,
    lines: [10, 10].map((count) => ({ id: `L${++n}`, text: `${words(count)}.`, on_screen: null, fact_ids: ['F1'], must_show: null })),
  }));
  return { title: 'T', hook: { on_screen: 'One bet', line_id: 'L1' }, rungs, peak_rung_id: 'R5', landing_rung_id: 'R7', close_question: 'Would you have shipped it?', word_count: 0, central: ['Jane Roe'] };
}

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

const userText = (p: SubmitParams) => String(p.messages[0]!.content);
const systemBlocks = (p: SubmitParams) => p.system as Anthropic.TextBlockParam[];
const toolOf = (p: SubmitParams) => (p.tools as unknown as { name: string; input_schema: { properties: Record<string, unknown>; required: string[] } }[])[0]!;

// ── Prompts, bundles and settings ───────────────────────────────────────────

test('bundles (MD-101): writer and writer-revise = role + principles; story editor = role + principles; director unchanged', () => {
  assert.deepEqual([...CRAFT_NAMES], ['principles', 'director-craft', 'story-timing']);
  for (const gone of ['spine-writer']) assert.ok(!(PROMPT_NAMES as readonly string[]).includes(gone), gone);
  const sep = '\n\n---\n\n';
  assert.equal(writerSystem('writer'), [loadPrompt('writer'), loadCraft('principles')].join(sep));
  assert.equal(writerSystem('writer-revise'), [loadPrompt('writer-revise'), loadCraft('principles')].join(sep));
  assert.equal(storyEditorSystem(), [loadPrompt('story-editor'), loadCraft('principles')].join(sep));
  const director = directorSystem('KIT');
  assert.equal(director, [loadPrompt('director'), loadCraft('director-craft'), loadCraft('story-timing'), '# Reference: the kit guide\n\nKIT'].join(sep));
});

test('settings (MD-103): 80s cap, 0.15s pause, no spine model', () => {
  assert.equal(DEFAULT_SETTINGS.max_seconds, 80);
  assert.equal(DEFAULT_SETTINGS.silent_beat_max, 0.15);
  assert.equal(DEFAULT_SETTINGS.target_seconds, 60);
  assert.equal(DEFAULT_SETTINGS.story_editor_model, 'claude-opus-5-5');
  assert.ok(!Object.keys(DEFAULT_SETTINGS).some((k) => /spine/.test(k)));
});

// ── The pitch's brief ───────────────────────────────────────────────────────

test('the producer submits a prose brief, not the story fields (MD-100)', () => {
  const schema = SUBMIT_PITCHES_TOOL.input_schema.properties.candidates.items;
  assert.ok(schema.required.includes('brief'));
  for (const gone of ['logline', 'pitch', 'story_question', 'end_point', 'turn', 'engine', 'scene', 'implication', 'central_figure']) {
    assert.ok(!(schema.required as readonly string[]).includes(gone), gone);
    assert.ok(!(gone in schema.properties), gone);
  }
  assert.ok(!('want' in schema.properties.cast.items.properties));
  const raw = {
    title: 'T', brief: BRIEF, story_type: 'deal', era: 'race', event_date: '2020-01-01', date_precision: 'day',
    cast: [{ name: 'Jane Roe', role: 'founder', kind: 'person', player_id: null }], why_now: null,
    expected_visuals: [{ kind: 'person_photo', what: 'w', hint: 'h' }], sources: [{ url: 'https://example.com/a', title: 'A', publisher: 'P', date: null }], typicality: 0.4,
  };
  const v = validatePitch(raw, { today: '2026-11-03' });
  assert.ok(v.ok && v.pitch.brief === BRIEF && v.pitch.cast[0]!.want === undefined);
  const none = validatePitch({ ...raw, brief: ' ' }, { today: '2026-11-03' });
  assert.ok(!none.ok && /missing brief/.test(none.why));
});

test('pitchBrief falls back to an old pitch text; pitchCentral to the first person in the cast', () => {
  assert.equal(pitchBrief(PITCH), BRIEF);
  const old = { title: 'Old', pitch: 'The old pitch text.', logline: 'L', cast: [], central_figure: 'Max Doe' } as unknown as Pitch;
  assert.equal(pitchBrief(old), 'The old pitch text.');
  assert.equal(pitchBrief({ logline: 'Only a logline.' } as Pitch), 'Only a logline.');
  assert.equal(pitchBrief(null), '');
  assert.equal(pitchCentral(old), 'Max Doe');
  assert.equal(pitchCentral(PITCH), 'Jane Roe', 'the first person, not the company listed first');
  assert.equal(pitchCentral({ cast: [] } as unknown as Pitch), '');
});

// ── The fact timeline ───────────────────────────────────────────────────────

test('factTimeline: facts, quotes and artifacts in date order, plain sentences ending with their ids', () => {
  const t = factTimeline(FACTS);
  const lines = t.split('\n');
  assert.deepEqual(lines.slice(0, 4), [
    '- 2020-01-05: The founder bet the company on one product. (F1)',
    '- 2020-02-01: Jane Roe said: "We ship it.", in a memo. (Q1)',
    '- 2020-03-01: The partner left in March. (one source: Example) (F2)',
    '- 2020-04-01: A post read: "Shipping today." (wording unverified) (A1)',
  ]);
  assert.ok(t.includes('Undated:\n- The office was above a bakery. (F3)'));
  assert.ok(t.includes("Who's who:\n- Jane Roe — then: founder.\n- Max Doe — then: partner."));
  for (const l of lines.filter((x) => x.startsWith('- 20') || x.startsWith('- The'))) assert.match(l, /\((F|Q|A)\d+\)$/);
  assert.ok(!t.includes('{'), 'plain text, not JSON');
});

test('factTimeline: a fact cited by two timeline entries takes the earliest date; an empty sheet is empty', () => {
  const facts = { ...FACTS, timeline: [...FACTS.timeline, { date: '2019-12-01', event: 'Earlier', fact_ids: ['F2'] }] };
  assert.match(factTimeline(facts).split('\n')[0]!, /^- 2019-12-01: The partner left in March\. \(one source: Example\) \(F2\)$/);
  assert.equal(factTimeline({ ...FACTS, timeline: [], facts: [], quotes: [], artifacts: [], cast: [] }), '');
});

// ── The writer ──────────────────────────────────────────────────────────────

test('writer user message: the brief, the facts (timeline), the visual inventory, the length; no spine, no JSON fact sheet', () => {
  const user = writerUserMessage({ pitch: PITCH, facts: FACTS, inventory: INVENTORY, settings: DEFAULT_SETTINGS });
  assert.match(user, /^## The brief\n\nIn early 2020[\s\S]*\n## The facts\n\n- 2020-01-05[\s\S]*\n## The visual inventory\n[\s\S]*\n## The length\n\nAim for about 60 seconds/);
  assert.ok(user.includes(factTimeline(FACTS)));
  assert.ok(!/spine|"facts":|"summary"/i.test(user));
  const old = writerUserMessage({ pitch: { ...PITCH, brief: undefined, pitch: 'Old text.' } as unknown as Pitch, facts: FACTS, inventory: INVENTORY, settings: DEFAULT_SETTINGS });
  assert.match(old, /^## The brief\n\nOld text\./);
});

test('submit_script: title, hook, rungs, peak, landing, close question, central, pronounce; no engine, turn or spine ids', () => {
  const schema = SUBMIT_SCRIPT_TOOL.input_schema as { properties: Record<string, { items?: { properties: Record<string, unknown> } }>; required: string[] };
  assert.deepEqual(schema.required, ['title', 'hook', 'rungs', 'peak_rung_id', 'landing_rung_id', 'close_question', 'central', 'pronounce']);
  assert.deepEqual(Object.keys(schema.properties.rungs!.items!.properties), ['id', 'purpose', 'lines']);
});

test('validateDraft: the peak is any rung; central names come from the facts; no turn or setup rules', () => {
  assert.deepEqual(validateDraft(goodDraft(), { facts: FACTS, inventory: INVENTORY, limits: DEFAULT_SETTINGS }).problems, []);
  const problemsFor = (mutate: (d: WriterDraft) => void) => {
    const d = goodDraft();
    mutate(d);
    return validateDraft(d, { facts: FACTS, inventory: INVENTORY, limits: DEFAULT_SETTINGS }).problems.join(' | ');
  };
  assert.equal(problemsFor((d) => (d.peak_rung_id = 'R1')), '', 'an early peak is fine');
  assert.match(problemsFor((d) => (d.peak_rung_id = 'R9')), /peak_rung_id "R9" is not a rung/);
  assert.match(problemsFor((d) => (d.central = ['Nobody Known'])), /central names "Nobody Known"/);
  assert.match(problemsFor((d) => delete (d as Partial<WriterDraft>).central), /central must be a list/);
  // A draft saved before iteration 5 still reads its turn rung as the peak.
  const old = { ...goodDraft(), peak_rung_id: undefined, turn_rung_id: 'R6' } as unknown as WriterDraft;
  assert.equal(peakRungId(old), 'R6');
  assert.ok(!validateDraft(old, { facts: FACTS, inventory: INVENTORY, limits: DEFAULT_SETTINGS }).problems.some((p) => /peak/.test(p)));
});

test('writeScript: cached writer system, the new message, the draft with central', async () => {
  const db = await freshDb();
  const send = stubSend([toolMessage('submit_script', goodDraft())]);
  const draft = await writeScript({ create: send, db, mode: 'production' }, { pitch: PITCH, facts: FACTS, inventory: INVENTORY, settings: DEFAULT_SETTINGS });
  assert.deepEqual(draft.central, ['Jane Roe']);
  const first = send.calls[0]!;
  assert.equal(toolOf(first).name, 'submit_script');
  assert.equal(systemBlocks(first).length, 1);
  assert.deepEqual(systemBlocks(first)[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(systemBlocks(first)[0]!.text, writerSystem('writer'));
  assert.ok(userText(first).startsWith('## The brief'));
});

// ── The blind story editor ──────────────────────────────────────────────────

test('the editor reads the script only: line ids, narration and on-screen words; nothing else', async () => {
  const db = await freshDb();
  const draft = goodDraft();
  draft.rungs[1]!.lines[0]!.on_screen = 'March 2020';
  const send = stubSend([toolMessage('submit_story_notes', { tell_back: 'A founder bets.', notes: [{ lines: ['L3', 'L4'], note: 'Who is the partner?' }] })]);
  const out = await editStory({ create: send, db, mode: 'production' }, { draft, settings: DEFAULT_SETTINGS });
  assert.deepEqual(out, { tell_back: 'A founder bets.', notes: [{ lines: ['L3', 'L4'], note: 'Who is the partner?' }] });
  const call = send.calls[0]!;
  const user = userText(call);
  assert.equal(user, `## The script\n\n${scriptForEditor(draft)}`);
  assert.match(user, /^## The script\n\nL1: word[^\n]*\n {4}On screen: One bet\nL2: /);
  assert.match(user, /L3: word[^\n]*\n {4}On screen: March 2020\n/);
  for (const absent of ['F1', 'R1', 'rung', 'purpose', 'fact', 'brief', 'Jane Roe', 'Would you have shipped it?', 'peak', 'V1']) assert.ok(!user.includes(absent), `no ${absent}`);
  assert.equal(systemBlocks(call)[0]!.text, storyEditorSystem());
  assert.equal(call.model, DEFAULT_SETTINGS.story_editor_model);
  assert.equal(toolOf(call).name, 'submit_story_notes');
  assert.deepEqual(Object.keys(SUBMIT_STORY_NOTES_TOOL.input_schema.properties as object).sort(), ['notes', 'tell_back']);
  const { rows } = await db.query<{ component: string }>(`SELECT component FROM reel_ai_drama.cost_events`);
  assert.deepEqual(rows.map((r) => r.component), ['story_notes']);
});

test('editor notes: at most five; unknown line ids get one correction, then are dropped', async () => {
  const ids = ['L1', 'L2', 'L3'];
  const six = Array.from({ length: 6 }, (_, i) => ({ lines: ['L1'], note: `n${i + 1}` }));
  assert.equal(validateStoryNotes({ tell_back: 't', notes: six }, { lineIds: ids }).value!.notes.length, 5);
  assert.match(validateStoryNotes({ tell_back: 't', notes: [{ lines: ['L9'], note: 'x' }] }, { lineIds: ids }).problems.join(), /names L9/);
  assert.match(validateStoryNotes({ notes: [] }, { lineIds: ids }).problems.join(), /tell_back is missing/);

  const db = await freshDb();
  const bad = { tell_back: 't', notes: [{ lines: ['L99', 'L2'], note: 'x' }] };
  const send = stubSend([toolMessage('submit_story_notes', bad, 'a'), toolMessage('submit_story_notes', bad, 'b')]);
  const out = await editStory({ create: send, db, mode: 'production' }, { draft: goodDraft() });
  assert.deepEqual(out.notes, [{ lines: ['L2'], note: 'x' }]);
  assert.equal(send.calls.length, 2);
});

// ── The one rewrite ─────────────────────────────────────────────────────────

test('reviseScript: labelled notes (story editor, director, facts check), writer-revise system, only noted lines change', async () => {
  const db = await freshDb();
  const draft = goodDraft();
  const send = stubSend([
    toolMessage('submit_revision', {
      replacements: [{ line_id: 'L3', cut: false, text: `${words(10, 'clear')}.`, on_screen: null, fact_ids: ['F1'], must_show: null, pause_after: null }],
      pronounce: [],
    }),
  ]);
  const out = await reviseScript(
    { create: send, db, mode: 'production' },
    {
      draft,
      notes: [
        { source: 'Story editor', lines: ['L3', 'L4'], note: 'Who is the partner?' },
        { source: 'Director', lines: ['L5'], note: 'no picture', suggestion: 'use the office' },
        { source: 'Facts check', lines: ['L6'], note: 'not in the facts' },
      ],
      facts: FACTS,
      inventory: INVENTORY,
    },
  );
  assert.match(out.rungs[1]!.lines[0]!.text, /^clear/);
  assert.deepEqual(out.central, ['Jane Roe']);
  const call = send.calls[0]!;
  assert.equal(systemBlocks(call)[0]!.text, writerSystem('writer-revise'));
  const user = userText(call);
  assert.match(user, /^## The notes\n\n- Story editor — L3, L4: Who is the partner\?\n- Director — L5: no picture\n {2}Suggestion: use the office\n- Facts check — L6: not in the facts\n\n## The script\n[\s\S]*## The facts\n\n- 2020-01-05[\s\S]*## The visual inventory/);
  // No notes, no call.
  const none = stubSend([]);
  assert.equal(await reviseScript({ create: none, db, mode: 'production' }, { draft, notes: [], facts: FACTS, inventory: INVENTORY }), draft);
  assert.equal(none.calls.length, 0);
});

// ── The director's plan (unchanged) ─────────────────────────────────────────

test('the plan validator takes wishes: wish ids in frames, a real fallback, every wish used, at most 12', () => {
  const draft = goodDraft();
  const ids = draft.rungs.flatMap((r) => r.lines.map((l) => l.id));
  const frames: DirectorPlan['frames'] = Array.from({ length: 7 }, (_, i) => ({
    n: i + 1, name: `f${i + 1}`, line_ids: ids.slice(i * 2, i * 2 + 2), treatment: 'photo', asset_ids: [i === 2 ? 'W1' : `V${(i % 4) + 1}`], purpose: 'p', motion: 'push', marks: '', sound: '',
    music: i === 0 ? 'start' : 'hold', on_screen: i === 0 ? 'One bet' : null, focus: { kind: FOCUS_KINDS[i % FOCUS_KINDS.length]!, what: 'what the eye lands on' }, 
  }));
  frames.push({ n: 8, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null });
  const plan = (wishes: DirectorPlan['wishes']): DirectorPlan => ({ frames: structuredClone(frames), wishes, lines_back: [] });
  const wish = { id: 'W1', person: 'The founder', want: 'the founder on stage at launch', frame_ns: [3], fallback: 'V3' };
  assert.deepEqual(validatePlan(plan([wish]), { draft, inventory: INVENTORY }).problems, []);
  const p = (w: DirectorPlan['wishes']) => validatePlan(plan(w), { draft, inventory: INVENTORY }).problems.join(' | ');
  assert.match(p([]), /uses W1, which is not in the inventory or the makes, nor a wish/);
  assert.match(p([{ ...wish, fallback: 'V99' }]), /fallback "V99"/);
  assert.match(p([wish, { ...wish, id: 'W2' }]), /wish W2 is used by no frame/);
  assert.match(p([wish, ...Array.from({ length: 12 }, (_, i) => ({ ...wish, id: `W${i + 2}` }))]), /13 wishes; at most 12/);
  const schema = SUBMIT_PLAN_TOOL.input_schema as { properties: Record<string, unknown> };
  assert.ok('wishes' in schema.properties);
});

// ── The one-off re-brief (MD-107; stubbed) ──────────────────────────────────

test('rebriefPitch: the producer prompt as the cached system, the old pitch and its sources, submit_brief, one cost row', async () => {
  const db = await freshDb();
  const old = { ...PITCH, brief: undefined, pitch: 'Old pitch text.', sources: [{ url: 'https://example.com/s', title: 'S', publisher: 'P', date: null }] } as unknown as Pitch;
  const row = { id: '00000000-0000-0000-0000-000000000001', title: 'The bet', pitch: old };
  const brief = `${words(130, 'story')}.`;
  const send = stubSend([toolMessage('submit_brief', { brief: 'too short' }, 'a'), toolMessage('submit_brief', { brief }, 'b')]);
  const out = await rebriefPitch({ create: send, db, producerPrompt: loadPrompt('producer') }, row);
  assert.equal(out.brief, brief);
  const first = send.calls[0]!;
  assert.equal(first.model, REBRIEF_MODEL);
  assert.equal(toolOf(first).name, 'submit_brief');
  assert.equal(systemBlocks(first)[0]!.text, loadPrompt('producer'));
  assert.deepEqual(systemBlocks(first)[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.match(userText(first), /## The pitch[\s\S]*Old pitch text\.[\s\S]*## Its sources[\s\S]*example\.com\/s/);
  assert.ok(!rebriefUserMessage(row).includes('expected_visuals'));
  assert.ok(estimateRebrief([row], 12_000) < 0.05);
  const { rows } = await db.query<{ component: string }>(`SELECT component FROM reel_ai_drama.cost_events`);
  assert.deepEqual(rows.map((r) => r.component), ['rebrief']);
});
