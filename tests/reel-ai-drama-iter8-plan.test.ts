import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faceRings, FACE_RING_MAX, hasThoughtMark, varietyFindings } from '@/lib/reel-ai-drama/checks/variety';
import { impliedFigureProblems, lookItems } from '@/lib/reel-ai-drama/checks/integrity';
import { frameShots, storyboardMarkdown } from '@/explainers/reel-ai-drama/kit/project-files.mjs';
import type { Asset, Blueprint, DirectorPlan, FactSheet, FrameShot, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { SUBMIT_PLAN_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { buildReviewDoc, shotMapReview } from '@/lib/reel-ai-drama/writing/review-doc';
import { mediumProblems, pruneCutLines, SHOT_MAX_WORDS, shotMapFindings, spokenNumbers, validatePlan } from '@/lib/reel-ai-drama/writing/validate';

/** Iteration 8, the plan owner: hook, shot map, players, marks, implied figures (MD-134 to MD-138). Stubbed, no API. */

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: null, source_page: 'https://example.test', credit: 'c', license: null, shows: 'a photo', people: [], qids: [],
    place: null, date_taken: null, date_confidence: 'unknown', width: 1000, height: 1000, phash: null, character_image: false, made: false,
    upscaled: false, flags: [], ...over,
  };
}
const INVENTORY: VisualsInventory = { assets: [asset('V1'), asset('V2', { kind: 'place_photo' }), asset('V5', { kind: 'logo', flags: ['logo'] })], usable_count: 3, counts: {}, kill: null, usd: 0 };

function draft(...texts: string[]): WriterDraft {
  return {
    title: 'T', hook: { line_id: 'L1' },
    rungs: [{ id: 'R1', purpose: 'p', lines: texts.map((text, i) => ({ id: `L${i + 1}`, text, on_screen: null, fact_ids: [], must_show: null, pause_after: null })) }],
    peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Would you?', word_count: 0, central: [],
  };
}
const beat = (at: string, over: Partial<FrameShot> = {}): FrameShot => ({ at, shows: 'a picture', asset_ids: ['V2'], introduces: null, ...over });
function frame(n: number, over: Partial<StoryboardFrame> = {}): StoryboardFrame {
  return {
    n, name: `f${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: ['V2'], purpose: 'p', motion: 'push', marks: '', sound: '', music: n === 1 ? 'start' : 'hold',
    on_screen: null, shows: [], focus: { kind: 'place', what: 'a place' }, ...over,
  };
}
const marksOnly = (kinds: string[]): Blueprint => ({ ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: [{ id: 'a', asset: 'V2', on: '' }], labels: [], speech: [], marks: kinds.map((kind) => ({ kind, on_piece: 'a', target: 'face:Ada', on: '' })), arrows: [], camera: { move: 'hold', stops: [{ on: '', aim: 'whole' }] }, sounds: [] });
const written = (note: string): Blueprint => ({ ...marksOnly([]), pieces: [{ id: 'a', note, on: '' }] });
const close = (n: number): StoryboardFrame => ({ n, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null, focus: null, shots: [] });
const facts = (cast: { name: string; kind: 'person' | 'company' | 'product' }[]) => ({ facts: [], quotes: [], artifacts: [], cast: cast.map((c) => ({ ...c, role: 'r', player_id: null })) }) as unknown as FactSheet;
const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

// ── Shot map (MD-136) ───────────────────────────────────────────

test('shot map: a frame whose beats land on its words, in order, within the limit, passes', () => {
  const d = draft('The company spent five billion dollars on a device nobody wanted that spring.');
  const f = frame(1, { shots: [beat('The company spent'), beat('five billion dollars'), beat('a device nobody wanted')] });
  assert.deepEqual(shotMapFindings({ frames: [f, close(2)] }, d), []);
});

test('shot map: `at` matches past case and punctuation, across the frame\'s lines', () => {
  const d = draft('They paid $5 billion, in cash.', 'Then it stopped.');
  const f = frame(1, { line_ids: ['L1', 'L2'], shots: [beat('they paid'), beat('5 billion in cash'), beat('then it stopped')] });
  assert.deepEqual(shotMapFindings({ frames: [f, close(2)] }, d), []);
});

test('shot map: an `at` the narration does not say is flagged; so is one out of order', () => {
  const d = draft('The founder called the board that night.');
  const missing = shotMapFindings({ frames: [frame(1, { shots: [beat('The founder'), beat('the investors')] }), close(2)] }, d);
  assert.match(missing[0]!.why, /"the investors", which the frame's narration doesn't say/);
  const backward = shotMapFindings({ frames: [frame(1, { shots: [beat('The founder'), beat('that night'), beat('the board')] }), close(2)] }, d);
  assert.ok(backward.some((f) => /out of spoken order/.test(f.why)));
});

test('shot map: a beat past SHOT_MAX_WORDS is flagged; exactly at the limit passes; a frame with no beats is flagged', () => {
  assert.equal(SHOT_MAX_WORDS, 12);
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const at = (n: number) => shotMapFindings({ frames: [frame(1, { shots: [beat('word0')] }), close(2)] }, draft(words(n)));
  assert.deepEqual(at(12), []);
  assert.match(at(13)[0]!.why, /holds the beat on "word0" for 13 spoken words; at most 12/);
  assert.match(shotMapFindings({ frames: [frame(1, { shots: [] }), close(2)] }, draft('Some words.'))[0]!.why, /has no shots/);
});

test('shot map: the first beat lands on the opening words, and `at` stays a few words', () => {
  const d = draft('The founder called the board that night in the rain.');
  assert.match(shotMapFindings({ frames: [frame(1, { shots: [beat('the board')] }), close(2)] }, d)[0]!.why, /first beat lands 3 words in/);
  assert.ok(shotMapFindings({ frames: [frame(1, { shots: [beat('The founder called the board that night')] }), close(2)] }, d).some((f) => /at runs 7 words/.test(f.why)));
});

test('shot map: every spoken number has a beat landing on it', () => {
  const d = draft('The company spent five billion dollars on it.');
  const none = shotMapFindings({ frames: [frame(1, { shots: [beat('The company spent')] }), close(2)] }, d);
  assert.deepEqual(ids(none), ['shot_number']);
  assert.match(none[0]!.why, /says "five billion"/);
  assert.deepEqual(shotMapFindings({ frames: [frame(1, { shots: [beat('The company spent'), beat('five billion')] }), close(2)] }, d), []);
});

test('spoken numbers: figures, magnitudes and measured counts are numbers; years, dates, names and grammar are not', () => {
  const values = (s: string) => spokenNumbers(s).map((n) => n.value);
  assert.deepEqual(values('They paid $24 million'), [24e6]);
  assert.deepEqual(values('They paid twenty-four million'), [24e6]);
  assert.deepEqual(values('a staff of 3,000'), [3000]);
  assert.deepEqual(values('40% left'), [40]);
  assert.deepEqual(values('three hours later'), [3]);
  assert.deepEqual(values('two hundred and forty engineers'), [240]);
  assert.deepEqual(values('In 2011 on May 12 the two founders of GPT-4 met one rival in the 1990s'), []);
  assert.deepEqual(spokenNumbers('the two founders', { loose: true }).map((n) => n.value), [2]);
});

// ── Old plans (MD-136) ──────────────────────────────────────────

test('old plans: a plan with no shots still validates and every shot check skips it', () => {
  const d = draft('Five billion dollars went to Acme, and Ada Founder lost it all over the next twelve long months of work.');
  const plan: DirectorPlan = { frames: [frame(1), { ...close(2), shots: undefined }], lines_back: [], wishes: [] };
  delete plan.frames[1]!.shots;
  const v = validatePlan(plan, { draft: d, inventory: INVENTORY });
  assert.deepEqual(v.problems, []);
  assert.deepEqual(shotMapFindings(plan, d), []);
  const f = facts([{ name: 'Acme', kind: 'company' }, { name: 'Ada Founder', kind: 'person' }]);
  const later = varietyFindings({ frames: [frame(1, { blueprint: marksOnly(['circle', 'circle', 'circle']) }), close(2)].map((x) => { const { shots: _s, ...rest } = x; return rest; }) }, { draft: d, facts: f });
  assert.deepEqual(ids(later).filter((id) => ['shot_map', 'shot_number', 'player_intro', 'face_rings', 'thought_marks'].includes(id)), []);
  assert.deepEqual(impliedFigureProblems({ frames: [frame(1, { blueprint: written('$9 million') })], lines_back: [] }, d), []);
});

test('validatePlan: the schema requires shots and the wish search fields; beats\' pictures join the frame; the close has none', () => {
  const required = ((SUBMIT_PLAN_TOOL.input_schema as { properties: { frames: { items: { required: string[] } }; wishes: { items: { required: string[] } } } }).properties);
  assert.ok(required.frames.items.required.includes('shots'));
  for (const k of ['query', 'as', 'count']) assert.ok(required.wishes.items.required.includes(k));
  const d = draft('The founder called.');
  const plan: DirectorPlan = { frames: [frame(1, { asset_ids: ['V2'], shots: [beat('The founder', { asset_ids: ['V1'] })] }), { ...close(2), shots: [beat('nothing')] }], lines_back: [] };
  const v = validatePlan(plan, { draft: d, inventory: INVENTORY });
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.value!.frames[0]!.asset_ids, ['V2', 'V1']);
  assert.deepEqual(v.value!.frames[1]!.shots, []);
  const unknown = validatePlan({ frames: [frame(1, { shots: [beat('The founder', { asset_ids: ['V9'] })] }), close(2)], lines_back: [] }, { draft: d, inventory: INVENTORY });
  assert.ok(unknown.problems.some((p) => /uses V9/.test(p)));
  const notList = validatePlan({ frames: [frame(1, { shots: 'x' as unknown as FrameShot[] }), close(2)], lines_back: [] }, { draft: d, inventory: INVENTORY });
  assert.ok(notList.problems.some((p) => /shots must be a list/.test(p)));
});

test('wishes: a new plan\'s wish carries a query, an as and a count; an old plan\'s needs none', () => {
  const d = draft('The founder called.');
  const wish = { id: 'W1', person: null, want: 'a thing', frame_ns: [1], fallback: 'V2' };
  const check = (extra: object, withShots = true) => validatePlan({ frames: [frame(1, { asset_ids: ['W1'], ...(withShots ? { shots: [beat('The founder', { asset_ids: ['W1'] })] } : {}) }), withShots ? close(2) : { ...close(2), shots: undefined }], wishes: [{ ...wish, ...extra }], lines_back: [] }, { draft: d, inventory: INVENTORY }).problems;
  assert.deepEqual(check({ query: 'a stone mill', as: 'place', count: 1 }), []);
  assert.deepEqual(check({ query: 'a stone mill', as: 'photo', count: 10 }), []);
  assert.deepEqual(check({}, false), []);
  assert.ok(check({ as: 'place', count: 1 }).some((p) => /query runs 0 words/.test(p)));
  assert.ok(check({ query: 'one two three four five six seven', as: 'place', count: 1 }).some((p) => /query runs 7 words/.test(p)));
  assert.ok(check({ query: 'a mill', as: 'drawing', count: 1 }).some((p) => /as is "drawing"/.test(p)));
  assert.ok(check({ query: 'a mill', as: 'place', count: 11 }).some((p) => /count is 11/.test(p)));
});

test('a beat on a cut line goes with the line', () => {
  const before = draft('The founder called.', 'The board said no.');
  const after = draft('The founder called.');
  const plan: DirectorPlan = { frames: [frame(1, { line_ids: ['L1', 'L2'], shots: [beat('The founder'), beat('The board said')] }), close(2)], lines_back: [] };
  assert.equal(before.rungs[0]!.lines.length, 2);
  assert.deepEqual(pruneCutLines(plan, after).frames[0]!.shots!.map((s) => s.at), ['The founder']);
});

// ── Players (MD-135) ────────────────────────────────────────────

test('players: a company, a product and a person each need a beat with a picture on the line that first names them', () => {
  const d = draft('Acme bought the Widget from Ada Founder.', 'Acme said nothing.');
  const f = facts([{ name: 'Acme', kind: 'company' }, { name: 'Widget', kind: 'product' }, { name: 'Ada Founder', kind: 'person' }, { name: 'Nobody Named', kind: 'person' }]);
  const shows = [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'photo' }];
  const frames = (shots: FrameShot[]) => [frame(1, { shows, asset_ids: ['V1', 'V2'], shots }), frame(2, { shots: [beat('Acme said nothing')] }), close(3)];
  const findings = (shots: FrameShot[]) => varietyFindings({ frames: frames(shots) }, { draft: d, facts: f }).filter((x) => x.id === 'player_intro');
  assert.deepEqual(findings([beat('Acme', { introduces: 'Acme' }), beat('the Widget', { introduces: 'Widget' }), beat('Ada Founder', { introduces: 'Ada Founder', asset_ids: ['V1'] })]), []);
  const missing = findings([beat('Acme', { introduces: 'Acme' }), beat('the Widget')]);
  assert.equal(missing.length, 2);
  assert.match(missing[0]!.why, /L1 is the first line to name (Widget|Ada Founder)/);
  const noPicture = findings([beat('Acme', { introduces: 'Acme', asset_ids: [] }), beat('the Widget', { introduces: 'Widget' }), beat('Ada Founder', { introduces: 'Ada Founder' })]);
  assert.match(noPicture[0]!.why, /introduces Acme on "Acme" with no picture/);
});

test('players: the beat must sit on the line that first names them, and a lower-case word is not a one-word name', () => {
  const d = draft('Acme moved first.', 'Then came the rest.');
  const f = facts([{ name: 'Acme', kind: 'company' }, { name: 'Apple', kind: 'company' }]);
  const off = varietyFindings({ frames: [frame(1, { line_ids: ['L1', 'L2'], shots: [beat('Acme moved'), beat('Then came', { introduces: 'Acme' })] }), close(2)] }, { draft: d, facts: f }).filter((x) => x.id === 'player_intro');
  assert.equal(off.length, 1);
  const lower = draft('She ate an apple.');
  assert.deepEqual(varietyFindings({ frames: [frame(1, { line_ids: ['L1'], shots: [beat('She ate')] }), close(2)] }, { draft: lower, facts: f }).filter((x) => x.id === 'player_intro'), []);
});

// ── Marks (MD-138) ──────────────────────────────────────────────

test('face rings: at most FACE_RING_MAX per reel, read from the blueprint; a face target with another kind is not a ring', () => {
  assert.equal(FACE_RING_MAX, 2);
  assert.equal(faceRings({ blueprint: marksOnly(['circle']) }), 1);
  assert.equal(faceRings({ blueprint: { ...marksOnly(['circle', 'circle']), marks: [{ kind: 'circle', on_piece: 'a', target: 'face:Ada', on: '' }, { kind: 'underline', on_piece: 'a', target: 'text:the deal', on: '' }, { kind: 'circle', on_piece: 'a', target: 'face:Bo', on: '' }] } }), 2);
  assert.equal(faceRings({ blueprint: { ...marksOnly([]), marks: [{ kind: 'arrow', on_piece: 'a', target: 'face:Ada', from: 'b', on: '' }, { kind: 'circle', on_piece: 'a', on: '' }] } }), 0);
  assert.equal(faceRings({}), 0);
  const d = draft('One thing.', 'Two things.', 'Three things.');
  const plan = (marks: string[][]) => ({ frames: [...marks.map((m, i) => frame(i + 1, { blueprint: marksOnly(m), shots: [beat(d.rungs[0]!.lines[i]!.text.split(' ')[0]!)] })), close(marks.length + 1)] });
  assert.deepEqual(varietyFindings(plan([['circle'], ['circle'], []]), { draft: d }).filter((x) => x.id === 'face_rings'), []);
  const over = varietyFindings(plan([['circle'], ['circle'], ['circle']]), { draft: d }).filter((x) => x.id === 'face_rings');
  assert.equal(over.length, 1);
  assert.equal(over[0]!.frame, 3);
});

test('thought marks: at most one per reel, read from the blueprint', () => {
  assert.ok(hasThoughtMark({ blueprint: { ...marksOnly([]), marks: [{ kind: 'thought', on_piece: 'a', on: '' }] } }));
  assert.ok(!hasThoughtMark({ blueprint: marksOnly(['circle']) }));
  assert.ok(!hasThoughtMark({}));
  const thought = { ...marksOnly([]), marks: [{ kind: 'thought', on_piece: 'a', on: '' }] };
  const d = draft('One thing.', 'Two things.');
  const plan = (a: Blueprint, b: Blueprint) => ({ frames: [frame(1, { blueprint: a, shots: [beat('One')] }), frame(2, { blueprint: b, shots: [beat('Two')] }), close(3)] });
  assert.deepEqual(varietyFindings(plan(thought, marksOnly([])), { draft: d }).filter((x) => x.id === 'thought_marks'), []);
  assert.equal(varietyFindings(plan(thought, thought), { draft: d }).filter((x) => x.id === 'thought_marks')[0]!.frame, 2);
});

// ── A picture implies what the line says (MD-137) ───────────────

test('implied figures: a figure written on screen must be in the frame\'s words; a beat\'s figure in that beat\'s words', () => {
  const d = draft('The price was never disclosed.', 'They raised $24 million that year.');
  const plan = (f: Partial<StoryboardFrame>): DirectorPlan => ({ frames: [frame(1, { shots: [beat('The price')], ...f }), close(2)], lines_back: [] });
  assert.match(impliedFigureProblems(plan({ blueprint: written('$24 million') }), d)[0]!.why, /writes "\$24 million" on screen, and its lines don't state that figure/);
  assert.deepEqual(impliedFigureProblems({ frames: [frame(1, { line_ids: ['L2'], blueprint: written('24 million'), shots: [beat('They raised')] }), close(2)], lines_back: [] }, d), []);
  assert.match(impliedFigureProblems(plan({ shots: [beat('The price', { shows: 'a stat of 24 million' })] }), d)[0]!.why, /shows "24 million" over words that don't state it/);
  const split = draft('They paid. It came to three hours of talks.');
  assert.ok(impliedFigureProblems({ frames: [frame(1, { shots: [beat('They paid', { shows: 'a clock at 3 hours' }), beat('It came to')] }), close(2)], lines_back: [] }, split).length === 1, 'the figure is spoken on a later beat');
});

test('the look: an image placed by a beat is judged against that beat\'s words', () => {
  const d = draft('The founder called. The price was never disclosed.');
  const plan: DirectorPlan = { frames: [frame(1, { asset_ids: ['V1', 'V2'], shots: [beat('The founder', { asset_ids: ['V1'] }), beat('The price', { asset_ids: ['V2'] })] }), close(2)], lines_back: [] };
  const items = lookItems(plan, INVENTORY, d);
  assert.equal(items.find((i) => i.asset.id === 'V2')!.beat, 'The price was never disclosed.');
  assert.equal(items.find((i) => i.asset.id === 'V1')!.beat, 'The founder called.');
  assert.equal(lookItems({ frames: [frame(1), close(2)], lines_back: [] }, INVENTORY, d)[0]!.beat, null);
});

// ── Storyboard and review ───────────────────────────────────────

test('STORYBOARD.md carries each frame\'s shots for the frame workers; the review doc shows them', () => {
  const f = frame(1, { shots: [beat('The founder', { shows: 'her photo', asset_ids: ['V1'] }), beat('Acme', { shows: 'the logo', asset_ids: ['V5'], introduces: 'Acme' })] });
  assert.equal(frameShots(f), '“The founder” = her photo [V1]; “Acme” = the logo [V5] introduces Acme');
  assert.equal(frameShots(frame(2)), '');
  const md = storyboardMarkdown(draft('The founder and Acme.'), [{ ...f, id: '01-f1' }]);
  assert.match(md, /^- shots: “The founder” = her photo \[V1\]; “Acme”/m);
  assert.ok(!/- shots:/.test(storyboardMarkdown(draft('x'), [{ ...frame(1), id: '01-f1' }])));
  const review = shotMapReview({ frames: [f, close(2)] });
  assert.match(review, /\| Acme \| the logo \| V5 \| Acme \|/);
  assert.match(buildReviewDoc(process.cwd(), { frames: [f, close(2)] }), /This plan's shot map/);
  assert.ok(!/This plan's shot map/.test(buildReviewDoc()));
});

// ── Prompts ─────────────────────────────────────────────────────

const FILES = ['craft/principles.md', 'craft/director-craft.md', 'craft/story-timing.md', 'prompts/director.md', 'prompts/writer.md', 'prompts/writer-revise.md', 'prompts/integrity.md', 'prompts/reporting.md', 'prompts/producer.md'];
const read = (f: string) => readFileSync(`explainers/reel-ai-drama/${f}`, 'utf8');

test('prompts: the hook rule is the consequence, the old person-at-the-centre rule is gone, and no prompt carries Lucas\'s examples', () => {
  const principles = read('craft/principles.md');
  assert.match(principles, /biggest real consequence/);
  assert.match(principles, /a person or a company the viewer\s+knows carry it/);
  assert.ok(!/person at the centre/i.test(principles));
  for (const f of FILES) assert.ok(!/fireplace|Amazon|Siri|Alexa|ballet|dollar sign|Kittlaus|Limp\b/.test(read(f)), `${f} carries an example from the notes`);
});

test('prompts: the scene tools have jobs and no quota; the old 8-second clock is gone', () => {
  const craft = read('craft/director-craft.md');
  assert.match(craft, /`board` — a good pick when a beat connects three or more players/);
  assert.match(craft, /`newspaper` — a good pick when a beat is how the world read a moment/);
  for (const f of ['craft/director-craft.md', 'prompts/director.md']) assert.ok(!/at least once/.test(read(f)), f);
  assert.ok(!/every 8 seconds|8 seconds is the ceiling/.test(read('craft/story-timing.md')));
  assert.match(read('craft/story-timing.md'), /every 12 spoken words/);
});
