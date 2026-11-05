// Iteration 11, owner C: cheaper director fixes, the group rule in variety, the story rule (a person at the center, never a
// company) and the logo that collapses when flattened. Stubbed model and Jev; no live call, no search.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';

import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { logoCollapses } from '../explainers/reel-ai-drama/kit/components/stage.js';
import { isGroupName, namedPeople, varietyFindings } from '@/lib/reel-ai-drama/checks/variety';
import { CALIBRATION_ITEMS } from '@/lib/reel-ai-drama/development/calibration-data';
import { capWithoutPerson, CENTRAL_WANT_GATE, DRAMA_SET, scoreDrama } from '@/lib/reel-ai-drama/development/scores';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, FactSheet, Pitch, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { directReel } from '@/lib/reel-ai-drama/writing/director';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ROOT = process.cwd();

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'event_photo', file: `media/${id}.jpg`, url: null, source_page: 'https://example.test', credit: 'Credit', license: null, shows: 'a photo', people: [], qids: [],
    place: null, date_taken: null, date_confidence: 'unknown', width: 1000, height: 1000, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...over,
  };
}
const inv = (...assets: Asset[]): VisualsInventory => ({ assets, usable_count: assets.length, counts: {}, kill: null, usd: 0 });
function draft(...texts: string[]): WriterDraft {
  return {
    title: 'T', hook: { on_screen: 'A hook', line_id: 'L1' },
    rungs: [{ id: 'R1', purpose: 'p', lines: texts.map((text, i) => ({ id: `L${i + 1}`, text, on_screen: null, fact_ids: [], must_show: null, pause_after: null })) }],
    peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Would you?', word_count: 0, central: [],
  };
}
function frame(n: number, over: Partial<StoryboardFrame> = {}): StoryboardFrame {
  return { n, name: `f${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: [`V${n}`], purpose: `purpose of frame ${n}`, music: n === 1 ? 'start' : 'hold', on_screen: null, shows: [], focus: { kind: 'object', what: 'x' }, ...over } as StoryboardFrame;
}
const closeFrame = (n: number): StoryboardFrame => ({ n, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', music: 'end', on_screen: null, focus: null }) as StoryboardFrame;
const FACTS = { facts: [], quotes: [], artifacts: [], sources: [], cast: [], places: [], timeline: [], summary: '', verdict: { holds: true, reason: '' } } as unknown as FactSheet;
const toolMessage = (input: unknown, model: string) => ({ id: 'm', type: 'message', role: 'assistant', model, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input }] });

// ── Director fixes (contract §4) ────────────────────────────────────────────────────────────────────

async function fixRound(over: { kind: Any; escalate?: boolean }) {
  const d = draft('Line one.', 'Line two.', 'Line three.');
  const plan: DirectorPlan = { frames: [frame(1, { on_screen: 'A hook' }), frame(2), frame(3), closeFrame(4)], makes: [], wishes: [], lines_back: [] } as unknown as DirectorPlan;
  const calls: Any[] = [];
  // The model answers for its frame, and also rewrites a frame it wasn't asked about: that one must not land.
  const answer = { frames: [{ ...frame(2), purpose: 'the re-planned frame 2', asset_ids: ['V9'] }, { ...frame(1), purpose: 'an unasked change' }], makes: [], wishes: [], lines_back: [] };
  const create = (async (p: Any) => { calls.push(p); return toolMessage(answer, p.model); }) as never;
  const inventory = inv(asset('V1'), asset('V2'), asset('V3'), asset('V9'));
  const fixed = await directReel({ create, db: { query: async () => ({ rows: [] }) } as never, mode: 'production', root: ROOT }, {
    draft: d, inventory, facts: FACTS, kitGuide: '# Kit',
    fix: { plan, problems: [{ frame: 2, asset_id: 'V2', why: 'frame 2 shows a picture that is not what its line says' }], kind: over.kind, escalate: over.escalate },
  });
  return { calls, fixed, plan };
}

test('a pre-build fix sends the named frame whole, its findings, a line each for the rest, behind the cached shared input', async () => {
  const { calls, fixed, plan } = await fixRound({ kind: 'pre_build' });
  assert.equal(calls.length, 1);
  const p = calls[0];
  assert.equal(p.model, DEFAULT_SETTINGS.director_fix_model);
  assert.equal(p.output_config?.effort, 'medium');
  assert.ok(p.max_tokens <= 24_000, 'a fix writes frames, not a plan');
  const [shared, fix] = p.messages[0].content;
  assert.ok(shared.cache_control, 'the script, facts and inventory are their own cached block');
  assert.ok(!fix.cache_control, 'the per-fix suffix carries no breakpoint');
  assert.ok(Array.isArray(p.system) && p.system.some((b: Any) => b.cache_control), 'the system prompt is cached');
  assert.match(fix.text, /Pre-build fix: the frames to re-plan/);
  assert.match(fix.text, /purpose of frame 2/, 'the named frame goes whole');
  assert.match(fix.text, /not what its line says/, 'with its findings');
  assert.match(fix.text, /Frame 1, f1: photo/, 'a neighbour goes in one line');
  assert.ok(!/purpose of frame 1|purpose of frame 3/.test(fix.text), 'never whole');
  // Only the named frame changes.
  assert.equal(fixed.frames.find((f) => f.n === 2)!.purpose, 'the re-planned frame 2');
  assert.equal(fixed.frames.find((f) => f.n === 1)!.purpose, plan.frames[0]!.purpose, 'an unasked frame stays as it was');
  assert.deepEqual(fixed.frames.find((f) => f.n === 3)!.asset_ids, plan.frames[2]!.asset_ids);
  assert.deepEqual(fixed.frames.find((f) => f.n === 2)!.asset_ids, ['V9']);
});

test('escalate runs the same fix on director_fix_escalation_model, with the same prefix', async () => {
  const first = await fixRound({ kind: 'pre_build' });
  const second = await fixRound({ kind: 'pre_build', escalate: true });
  assert.equal(second.calls[0].model, DEFAULT_SETTINGS.director_fix_escalation_model);
  assert.equal(second.calls[0].output_config?.effort, 'medium');
  assert.deepEqual(second.calls[0].tools, first.calls[0].tools);
  assert.deepEqual(second.calls[0].system, first.calls[0].system);
  assert.equal(second.calls[0].messages[0].content[0].text, first.calls[0].messages[0].content[0].text);
});

test('a content-pass fix names itself and returns only its frames', async () => {
  const { calls, fixed } = await fixRound({ kind: 'content_pass' });
  assert.match(calls[0].messages[0].content[1].text, /Content-pass findings \(re-plan only these frames\)/);
  assert.equal(calls[0].model, DEFAULT_SETTINGS.director_fix_model);
  assert.equal(fixed.frames.filter((f) => f.purpose === 'an unasked change').length, 0);
});

test('the director prompt asks a fix for its named frames only, never the whole plan', () => {
  const md = fs.readFileSync(path.join(ROOT, 'explainers/reel-ai-drama/prompts/director.md'), 'utf8');
  const fix = md.slice(md.indexOf('## When the user message holds a fix'), md.indexOf('## HARD CONSTRAINTS'));
  assert.match(fix, /submit only the frames named/);
  assert.ok(!/submit the whole plan/i.test(fix));
  assert.match(fix, /A pre-build fix/);
  assert.match(fix, /A content-pass fix/);
});

// ── Variety: a group is not a person who must be shown ──────────────────────────────────────────────

test('variety: a group in the cast is never a person who must be shown', () => {
  for (const g of ['Acme employees who signed the letter', 'Acme Employees', 'the signatories', 'Research Staff']) assert.ok(isGroupName(g), g);
  for (const p of ['Ada Lovelace', 'Ursula von der Leyen', "Conan O'Brien"]) assert.ok(!isGroupName(p), p);
  const facts = { ...FACTS, cast: [
    { name: 'Dana Reyes', role: 'CEO', kind: 'person', player_id: null, qid: null },
    { name: 'Acme employees who signed the letter', role: 'signers', kind: 'person', player_id: null, qid: null },
    { name: 'Acme', role: 'company', kind: 'company', player_id: null, qid: null },
  ] } as unknown as FactSheet;
  assert.deepEqual(namedPeople({ facts }), ['Dana Reyes']);
  const d = draft('Acme wrote that it was proud of the deal.', 'More than 100 employees signed a letter to Dana Reyes.');
  const plan = { frames: [frame(1), frame(2, { shows: [{ person: 'Dana Reyes', asset_id: 'V2', treatment: 'photo' }] })] } as unknown as DirectorPlan;
  const found = varietyFindings(plan, { draft: d, facts });
  assert.deepEqual(found.filter((f) => f.id === 'named_not_shown'), [], 'the group was the false alarm: its first word matched the company');
  // A real person named and not shown still is.
  const missing = varietyFindings({ frames: [frame(1), frame(2)] } as unknown as DirectorPlan, { draft: d, facts });
  assert.deepEqual(missing.filter((f) => f.id === 'named_not_shown').map((f) => f.frame), [2]);
});

// ── The story rule (contract §8) ────────────────────────────────────────────────────────────────────

/** The shape Lucas rejected: a company's story whose CEO only receives events: an employee letter, a petition handed over. */
const COMPANY_STORY: Pitch = {
  title: 'Proud to support',
  brief: 'A large software company blogs that its cloud will help a federal agency. Months later the post goes viral. More than 100 employees address an open letter to the CEO, Dana Reyes, demanding the contract be cancelled; a nonprofit gathers 300,000 signatures and hands the petition to the company. Reyes emails staff that the policy is cruel, but the contract stays.',
  story_type: 'power_struggle',
  era: 'now',
  event_date: '2018-06-19',
  date_precision: 'day',
  cast: [
    { name: 'Dana Reyes', role: 'CEO, addressed by the employee letter and handed the petition', kind: 'person', player_id: 'dana-reyes' },
    { name: 'Acme', role: 'the company', kind: 'company', player_id: 'acme' },
  ],
  why_now: null,
  expected_visuals: [],
  sources: [],
};

function jevAnswering(levels: Record<string, number>) {
  const asked: Any[] = [];
  return {
    asked,
    jev: {
      async ask(req: Any) {
        asked.push(req);
        const answers: Record<string, unknown> = {};
        for (const [key, q] of Object.entries(req.questions as Record<string, Any>)) answers[key] = q.type === 'noul' ? { noul: key === 'about_ai' ? 1 : 0 } : { score: levels[key] ?? 4 };
        return { answers };
      },
    } as never,
  };
}

test('story gate: a company story whose CEO only receives events fails, under the bar', async () => {
  // The judge says, as a class, that someone others address, petition or hand things to is not a central figure.
  const judge = (DRAMA_SET.questions.central_want as Any).judge ?? JSON.stringify(DRAMA_SET.questions.central_want);
  assert.match(judge, /only receives events/);
  assert.match(judge, /address, petition, hand things to/);
  assert.match(judge, /a company[^.]*is never the central figure/);
  // A Jev that follows it puts this CEO at level 1 (people named, but they only receive events): the gate rejects it.
  const { jev, asked } = jevAnswering({ central_want: 1 });
  const drama = await scoreDrama(jev, { id: 'p1', pitch: COMPANY_STORY });
  assert.equal(asked[0].state.central_figure, 'Dana Reyes');
  assert.ok(drama.score < DEFAULT_SETTINGS.drama_bar, `${drama.score} is under the bar`);
  assert.match(drama.notes.cap ?? '', /central person whose want the viewer follows/);
  // A vague want is gated too; a followed want passes.
  assert.ok((await scoreDrama(jevAnswering({ central_want: CENTRAL_WANT_GATE - 1 }).jev, { id: 'p1', pitch: COMPANY_STORY })).score < DEFAULT_SETTINGS.drama_bar);
  assert.ok((await scoreDrama(jevAnswering({ central_want: CENTRAL_WANT_GATE }).jev, { id: 'p1', pitch: COMPANY_STORY })).score >= DEFAULT_SETTINGS.drama_bar);
});

test('story gate in code: a cast led by a company, or a group, is capped even when a person stands further down', () => {
  const high = { score: 0.9, notes: {} };
  const led = (first: Pitch['cast'][number]) => ({ ...COMPANY_STORY, cast: [first, COMPANY_STORY.cast[0]!] });
  assert.equal(capWithoutPerson(high, led({ name: 'Acme', role: 'r', kind: 'company', player_id: null })).score, 0.45);
  assert.equal(capWithoutPerson(high, led({ name: 'Acme employees', role: 'r', kind: 'person', player_id: null })).score, 0.45);
  assert.equal(capWithoutPerson(high, COMPANY_STORY).score, 0.9, 'a person first passes this check; the want is the Jev gate');
  assert.equal(capWithoutPerson(high, { ...COMPANY_STORY, central_figure: 'Acme' }).score, 0.45);
});

test('the producer and the calibration set put a person at the center, never a company', () => {
  const md = fs.readFileSync(path.join(ROOT, 'explainers/reel-ai-drama/prompts/producer.md'), 'utf8');
  assert.ok(!/acting through named people/.test(md));
  assert.match(md, /names one central figure, a named person/);
  assert.match(md, /Someone who only receives events/);
  assert.ok(!/Microsoft|Nadella/.test(md + JSON.stringify(DRAMA_SET)), 'no real company from the live reel in a prompt');
  const near01 = CALIBRATION_ITEMS.find((i) => i.id === 'near-01')!;
  assert.equal(near01.pitch.central_figure, 'Sam Altman');
  assert.ok(!CALIBRATION_ITEMS.some((i) => i.pitch.central_figure === 'OpenAI'));
});

// ── The logo (contract §8): a logo that collapses keeps its colours on a chip ───────────────────────

const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/iter11-live/project/assets/inventory.json'), 'utf8')) as VisualsInventory;
const live = (id: string) => ({ ...LIVE.assets.find((a) => a.id === id)! });
/** A simple one-colour wordmark, keyed: dark letters, gaps between them, nothing drawn by tone inside them. */
const MONO: Any = {
  id: 'L9', kind: 'logo', file: 'media/L9.png', width: 800, height: 200, shows: 'A black wordmark.', flags: ['logo', 'logo_keyed'],
  regions: { visible: { x: 0, y: 0, w: 1, h: 1 }, chroma: 0.01, brightness: 0.05, tone: { w: 16, h: 4, cells: ['................', '0.00.0.00.0.00.0', '0.00.0.00.0.00.0', '................'].join('') } },
};

test('logoCollapses: the live seal and the knocked-out square collapse; the wordmarks do not', () => {
  assert.equal(logoCollapses(live('V45')), true, 'the ICE seal (the black dot)');
  assert.equal(logoCollapses(live('V71')), true, 'white words on a black square (the blank white square)');
  assert.equal(logoCollapses(live('V1')), false, 'the four-square wordmark is drawn by its silhouette');
  assert.equal(logoCollapses(MONO), false, 'a one-colour mark has nothing to lose');
  assert.equal(logoCollapses({ kind: 'logo' }), false, 'unmeasured, it cannot be said to collapse');
});

const dom = () => {
  const win = new JSDOM('<!doctype html><html><body><div id="w" data-opening-not></div></body></html>').window as Any;
  nk.installKit(win.document, { fonts: 'f/', textures: 't/' });
  return win.document;
};
const logoEl = (ground: string, media: Any) => {
  const s = nk.stage(dom(), { ground, duration: 4, pieces: [{ id: 'logo', media, at: 0 }] }) as Any;
  s.render(2);
  return s.pieces.logo.el as Any;
};

test('stage: on the whiteboard a collapsing logo goes on a chip in its colours; a one-colour logo is still drawn in marker', () => {
  const seal = logoEl('whiteboard', live('V45'));
  assert.ok(!seal.querySelector('[data-drawn-logo]'), 'never flattened to a disc');
  assert.ok('chip' in seal.dataset);
  assert.ok(!('inked' in seal.dataset));
  const mono = logoEl('whiteboard', MONO);
  assert.ok(mono.querySelector('[data-drawn-logo]'), 'a simple mark keeps the marker');
});

test('stage: on a dark ground the knocked-out square keeps its colours on a chip; a one-colour logo still takes the ink that reads', () => {
  const square = logoEl('kraft', live('V71'));
  assert.ok(!('inked' in square.dataset), 'one ink would fill the square: the blank white square');
  assert.ok('chip' in square.dataset);
  const mono = logoEl('charcoal', MONO);
  assert.ok('inked' in mono.dataset, 'a black mark on a dark ground is inked light');
  assert.match(mono.firstElementChild.style.filter, /invert/);
});
