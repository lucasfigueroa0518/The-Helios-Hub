// Iteration 10, owner D: the plan checks, the stand-in rule, and the integrity check's shot map.
// Pure functions and stubbed calls; no model, no search, no live runs. The Musk and Apple fixtures are written from the two
// saved iteration 9 plans (test-runs/iter9-final-renders), which predate blueprints.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANCHORED_KINDS } from '../explainers/reel-ai-drama/kit/components/anchor.js';
import { cueAt } from '../explainers/reel-ai-drama/kit/components/moves.js';
import { checkIntegrity, frameShotMap, impliedFigureProblems, lookItems, lookText, recordProblems, storyDates, visibleDateProblems } from '@/lib/reel-ai-drama/checks/integrity';
import { varietyFindings } from '@/lib/reel-ai-drama/checks/variety';
import type { Asset, Blueprint, DirectorPlan, FactSheet, FrameShot, MakeRequest, ShotWish, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { directReel, inventoryForDirecting } from '@/lib/reel-ai-drama/writing/director';
import { blueprintReview } from '@/lib/reel-ai-drama/writing/review-doc';
import {
  ANCHORED_MARK_KINDS, ARRANGEMENT_MAX, blueprintFindings, ensurePlannedMakes, frameAssetIds, PERSON_PICTURE_MAX, planFindings, repeatedPictures,
  shotPictureFindings, standInFindings, standInFits, standInsFrom, validatePlan, wordsAt, type PlanFinding,
} from '@/lib/reel-ai-drama/writing/validate';

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
const beat = (at: string, shows: string, ...asset_ids: string[]): FrameShot => ({ at, shows, asset_ids, introduces: null });
function frame(n: number, over: Partial<StoryboardFrame> = {}): StoryboardFrame {
  return { n, name: `f${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: [], purpose: 'p', music: n === 1 ? 'start' : 'hold', on_screen: null, shows: [], focus: { kind: 'person', what: 'x' }, ...over } as StoryboardFrame;
}
const closeFrame = (n: number): StoryboardFrame => ({ n, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', music: 'end', on_screen: null, focus: null }) as StoryboardFrame;
function blueprint(over: Partial<Blueprint> = {}): Blueprint {
  return { ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: [{ id: 'a', asset: 'V1', on: '' }], labels: [], speech: [], marks: [], arrows: [], camera: { move: 'push', stops: [{ on: '', aim: 'whole' }] }, sounds: [], ...over };
}
const facts = (cast: { name: string; kind: 'person' | 'company' | 'product' }[], extra: { places?: string[]; sources?: string[] } = {}) => ({
  cast: cast.map((c) => ({ ...c, role: 'r', player_id: null, qid: null })),
  places: (extra.places ?? []).map((name) => ({ name, address: null, lat: null, lon: null, role: 'r' })),
  sources: (extra.sources ?? []).map((publisher, i) => ({ id: `S${i}`, url: 'https://x.test', title: 't', publisher, date: null, kind: 'news' })),
});
const ofId = (found: PlanFinding[], id: PlanFinding['id']) => found.filter((f) => f.id === id);

// ── The rule set in the contract, on the saved plans ─────────────────────────────────────────────────

const MUSK_INVENTORY = inv(
  asset('V9', { kind: 'person_photo', people: ['Elon Musk'], character_image: true, anchor_for: 'Elon Musk', flags: ['cutout', 'anchor:Elon Musk'], shows: 'An approved cutout portrait of Elon Musk' }),
  asset('V12', { kind: 'person_photo', people: ['Elon Musk'], shows: 'A man in a dark suit and blue tie against a red background', regions: { visible: { x: 0, y: 0, w: 1, h: 1 }, shape: { w: 1, h: 1, cells: '1' }, tone: { w: 1, h: 1, cells: 'f' }, expression: 'serious, frowning' } }),
  asset('V88', { kind: 'person_photo', people: ['Elon Musk'], shows: 'A man in a black t-shirt speaking on a stage' }),
  asset('V29', { kind: 'person_photo', people: ['Demis Hassabis'], character_image: true, anchor_for: 'Demis Hassabis', flags: ['cutout'], shows: 'A cutout portrait of Demis Hassabis' }),
  asset('V83', { kind: 'person_photo', people: ['Larry Page'], flags: ['cutout', 'cutout_of:V51'], shows: 'Larry Page, cut out of V51' }),
  asset('V51', { kind: 'person_photo', people: ['Larry Page'], shows: 'Larry Page at a podium' }),
  asset('V45', { kind: 'person_photo', people: ['Luke Nosek'], character_image: true, flags: ['cutout'], shows: 'Luke Nosek, cut out' }),
  asset('V54', { kind: 'logo', flags: ['logo'], shows: 'The Google logo (wordmark, on a light plate).' }),
  asset('V61', { kind: 'place_photo', shows: 'A Google sign among trees, Mountain View campus.' }),
  asset('V80', { kind: 'event_photo', shows: 'The DeepMind logo glowing over a blue screen of binary code.' }),
  asset('V81', { kind: 'event_photo', shows: 'The Google DeepMind sign mounted on a glossy wall in a building lobby.' }),
  asset('V86', { kind: 'place_photo', place: 'London', shows: "Rendered view of a long building, likely Google's King's Cross building in London" }),
  asset('V87', { kind: 'logo', flags: ['logo'], shows: 'The Wall Street Journal masthead logo in black letters on white.' }),
  asset('V92', { kind: 'object', flags: ['cutout', 'cutout_of:V85'], shows: 'A real-photo cutout of an open laptop computer' }),
);
const MUSK_MAKES: MakeRequest[] = [
  { id: 'M1', kind: 'expression', brief: 'Walter Isaacson sketch', people: ['Walter Isaacson'], from_assets: [], seed: null },
  { id: 'M2', kind: 'expression', brief: 'Elon Musk sketch', people: ['Elon Musk'], from_assets: [], seed: null },
];
/** Which pictures each of Musk's ten story frames used, as the saved storyboard lists them. */
const MUSK_FRAMES: Record<number, string[]> = { 1: ['V9', 'V92', 'V54'], 2: ['V86', 'V9', 'V29'], 3: ['M1', 'M2'], 4: ['V83', 'V9', 'V54'], 5: ['V61', 'V88'], 6: ['V45', 'V9', 'V87'], 7: ['V92', 'V9', 'V45', 'V29', 'V83'], 8: ['M2', 'V54'], 9: ['V81', 'V9', 'V29'], 10: ['M2', 'V54'] };
const MUSK_PLAN = (): DirectorPlan => ({ frames: [...Object.entries(MUSK_FRAMES).map(([n, asset_ids]) => frame(Number(n), { asset_ids })), closeFrame(11)], makes: MUSK_MAKES, lines_back: [] });
const MUSK_SCRIPT = draft(
  "Before Elon Musk co-founded OpenAI, he Skyped from a party closet, trying to stop Google from buying the world's leading AI lab.",
  'The lab was DeepMind in London, and Musk had backed it early, after its co-founder Demis Hassabis warned him AI could be dangerous.',
  "Walter Isaacson's biography says Musk put in five million dollars, as a way to watch what DeepMind was doing.",
  "Musk distrusted how Google's boss, Larry Page, would develop AI; Page had once called him a 'specist' when they argued over AI replacing humans.",
  'Now Google was about to buy DeepMind, and Musk made a last-minute attempt to buy it himself.',
  "With his friend Luke Nosek, Musk tried to raise the money, though The Wall Street Journal later reported the plan never reached DeepMind's board.",
  'From an upstairs closet at that party, they Skyped Hassabis, and Musk told him, "The future of AI should not be controlled by Larry."',
  'Author Sebastian Mallaby says Hassabis turned Musk down for Google, which could promise the computing power DeepMind needed.',
  'Google bought DeepMind, and Musk turned against Hassabis, still bitter about the snub a year later.',
  'Then Musk set out to counter Google another way, and co-founded OpenAI with Sam Altman.',
);
const MUSK_FACTS = facts([{ name: 'Elon Musk', kind: 'person' }, { name: 'Google', kind: 'company' }, { name: 'DeepMind', kind: 'company' }, { name: 'OpenAI', kind: 'company' }, { name: 'Skype', kind: 'product' }], { places: ['London'], sources: ['The Wall Street Journal'] });

test('repetition: fires on the Musk portrait in 6 of 10 frames, naming the frames to change and the other pictures', () => {
  const found = repeatedPictures(MUSK_PLAN(), { inventory: MUSK_INVENTORY });
  const portrait = found.find((f) => /^\[repeated_picture\] V9 holds frames 1, 2, 4, 6, 7, 9/.test(f));
  assert.ok(portrait, found.join('\n'));
  assert.match(portrait, /Change frames 2, 7, 9/);
  assert.match(portrait, /V12 \(serious, frowning\)/, 'it offers another picture, with its recorded expression');
  const per = ofId(planFindings(MUSK_PLAN(), { draft: MUSK_SCRIPT, inventory: MUSK_INVENTORY }), 'repeated_picture').filter((f) => f.asset_id === 'V9');
  assert.deepEqual(per.map((f) => f.frame), [2, 7, 9], 'one finding per frame to change, since a fix re-plans only the frames it names');
});

test('repetition: three non-adjacent uses pass; dup_of and a cut of a photo count as that photo; a logo is a name', () => {
  assert.equal(PERSON_PICTURE_MAX, 3);
  const a = asset('V1', { kind: 'person_photo', people: ['Ada'], character_image: true });
  const planOf = (uses: Record<number, string[]>): DirectorPlan => ({ frames: Object.entries(uses).map(([n, asset_ids]) => frame(Number(n), { asset_ids })), lines_back: [] });
  assert.deepEqual(repeatedPictures(planOf({ 1: ['V1'], 3: ['V1'], 5: ['V1'] }), { inventory: inv(a) }), []);
  assert.equal(repeatedPictures(planOf({ 1: ['V1'], 3: ['V1'], 5: ['V1'], 7: ['V1'] }), { inventory: inv(a) }).length, 1, 'a fourth use');
  assert.equal(repeatedPictures(planOf({ 1: ['V1'], 2: ['V1'] }), { inventory: inv(a) }).length, 1, 'adjacent');
  const near = inv(a, asset('V2', { kind: 'person_photo', people: ['Ada'], regions: { dup_of: 'V1' } as never }), asset('V3', { kind: 'person_photo', people: ['Ada'], flags: ['cutout', 'cutout_of:V2'] }));
  const found = repeatedPictures(planOf({ 1: ['V1'], 2: ['V2'], 4: ['V3'] }), { inventory: near });
  assert.equal(found.length, 1, 'three ids, one picture, adjacent');
  const logo = inv(asset('V4', { kind: 'logo', flags: ['logo'] }));
  assert.deepEqual(repeatedPictures(planOf({ 1: ['V4'], 2: ['V4'], 3: ['V4'], 4: ['V4'], 5: ['V4'] }), { inventory: logo }), []);
  const made = repeatedPictures({ ...planOf({ 3: ['M2'], 8: ['M2'], 10: ['M2'] }), makes: MUSK_MAKES }, { inventory: inv() });
  assert.deepEqual(made, [], 'a sketch may return three times, apart');
  assert.equal(repeatedPictures({ ...planOf({ 3: ['M2'], 4: ['M2'] }), makes: MUSK_MAKES }, { inventory: inv() }).length, 1, 'adjacent sketches count');
});

test('same cast: consecutive frames, or the same pair and arrangement anywhere; a change of arrangement or cast passes; one layout holds at most its share', () => {
  const a = asset('V1', { kind: 'person_photo', people: ['Ada Founder'] });
  const b = asset('V2', { kind: 'person_photo', people: ['Bo Rival'] });
  const c = asset('V3', { kind: 'person_photo', people: ['Ada Founder'] });
  const d = asset('V4', { kind: 'person_photo', people: ['Bo Rival'] });
  const pair = (arrangement: Blueprint['arrangement'], ...ids: string[]) => blueprint({ arrangement, pieces: ids.map((asset, i) => ({ id: `p${i}`, asset, on: '' })) });
  const check = (...bps: Blueprint[]) => ofId(planFindings({ frames: bps.map((blueprintOf, i) => frame(i + 1, { blueprint: blueprintOf, line_ids: [] })) }, { draft: draft(), inventory: inv(a, b, c, d) }), 'same_cast');
  const twice = check(pair('face_off', 'V1', 'V2'), pair('face_off', 'V3', 'V4'));
  assert.equal(twice.length, 1);
  assert.equal(twice[0]!.frame, 2);
  assert.match(twice[0]!.why, /right after it/);
  assert.deepEqual(check(pair('face_off', 'V1', 'V2'), pair('turned_away', 'V3', 'V4')), []);
  assert.deepEqual(check(pair('face_off', 'V1', 'V2'), pair('face_off', 'V3')), []);
  assert.equal(check(pair('face_off', 'V1', 'V2'), pair('solo', 'V1'), pair('face_off', 'V3', 'V4'))[0]!.frame, 3, 'the same pair staged the same way later in the reel');

  assert.equal(ARRANGEMENT_MAX, 3);
  const assets = ['V1', 'V2', 'V3', 'V4'];
  const layouts = planFindings({ frames: assets.map((id, i) => frame(i + 1, { blueprint: pair('face_off', id), line_ids: [] })) }, { draft: draft(), inventory: inv(a, b, c, d) });
  assert.deepEqual(ofId(layouts, 'arrangement_share').map((f) => f.frame), [4]);
});

test('named things: fires on what the Musk reel left out, and stays quiet on what it showed', () => {
  const found = ofId(planFindings(MUSK_PLAN(), { draft: MUSK_SCRIPT, inventory: MUSK_INVENTORY, facts: MUSK_FACTS }), 'named_thing');
  const said = found.map((f) => `${f.frame} ${/name ([^,]+),/.exec(f.why)![1]}`);
  for (const miss of ['1 OpenAI', '2 DeepMind', '5 DeepMind', '6 DeepMind', '10 OpenAI']) assert.ok(said.includes(miss), `${miss}: ${said.join('; ')}`);
  assert.ok(!said.includes('1 Google'), 'the Google logo is in frame 1');
  assert.ok(!said.includes('9 DeepMind'), 'the sign in frame 9 shows it');
  assert.ok(!said.some((s) => /Skype/.test(s)), '"Skyped" is not the product');
  assert.ok(!said.some((s) => /Wall Street/.test(s)), 'the masthead is in frame 6');
  assert.match(found.find((f) => f.frame === 2)!.why, /use V80 or V81/, 'it names what the inventory holds');
  assert.match(found.find((f) => f.frame === 1)!.why, /add a wish \{ as: 'logo', query: 'OpenAI logo' \}/, 'and asks for a wish when it holds nothing');
});

test('named things: near misses. Case, modifiers, sentence heads, portraits and credits', () => {
  const logo = asset('V1', { kind: 'logo', flags: ['logo'], shows: 'The Apple logo' });
  const photo = asset('V2', { shows: 'a quiet lab' });
  const portrait = asset('V3', { kind: 'person_photo', people: ['Ada'], shows: 'Ada Founder, Director of AI Research at Apple' });
  const inventory = inv(logo, photo, portrait);
  const f = facts([{ name: 'Apple', kind: 'company' }, { name: 'Acme Robotics', kind: 'company' }], { sources: ['Fortune'] });
  const run = (lines: string[], uses: string[][]) => ofId(planFindings({ frames: uses.map((asset_ids, i) => frame(i + 1, { asset_ids })) }, { draft: draft(...lines), inventory, facts: f }), 'named_thing').map((x) => `${x.frame}:${/name ([^,]+),/.exec(x.why)![1]}`);

  assert.deepEqual(run(['She ate an apple at lunch.'], [['V2']]), [], 'a common word in lower case is not the company');
  assert.deepEqual(run(['Apple hired her.'], [['V2']]), ['1:Apple']);
  assert.deepEqual(run(['Apple hired her.'], [['V1']]), []);
  assert.deepEqual(run(['Apple hired her.'], [['V3']]), ['1:Apple'], "a portrait whose caption names the company doesn't show the company");
  assert.deepEqual(run(['Apple spoke.', "Apple's secrecy grew.", 'An Apple session ran.', 'Apple researchers left.'], [['V1'], ['V2'], ['V2'], ['V2']]), [], 'a passing mention after it was shown is fine');
  assert.deepEqual(run(["Apple's secrecy grew."], [['V2']]), ['1:Apple'], 'a passing mention still needs it shown by then');
  assert.deepEqual(run(['The acme robotics team spoke.'], [['V2']]), ['1:Acme Robotics'], 'a longer name matches in any case');
  assert.deepEqual(run(['Fortune favors the bold.'], [['V2']]), [], 'a publisher named after a common word, at the head of a sentence and not credited');
  assert.deepEqual(run(['The paper, though Fortune noted a catch.'], [['V2']]), ['1:Fortune']);
  assert.deepEqual(run(['Fortune reported it.'], [['V2']]), ['1:Fortune'], 'at the head of a sentence, credited');

  const credited = inv(asset('V5', { shows: 'A phone screen with a voice assistant', credit: 'Fortune (article image)' }), asset('V6', { kind: 'headline', shows: 'A screenshot of the page "Its first paper" on fortune.com', credit: 'Fortune' }));
  const on = (asset_ids: string[]) => ofId(planFindings({ frames: [frame(1, { asset_ids })] }, { draft: draft('The paper, though Fortune noted a catch.'), inventory: credited, facts: f }), 'named_thing').length;
  assert.equal(on(['V5']), 1, 'a photo merely credited to the source is not the source');
  assert.equal(on(['V6']), 0);

  const labelled = planFindings({ frames: [frame(1, { blueprint: blueprint({ pieces: [{ id: 'a', asset: 'V2', on: '' }], labels: [{ text: 'Apple', for: 'a', on: '' }] }) })] }, { draft: draft('Apple hired her.'), inventory, facts: f });
  assert.deepEqual(ofId(labelled, 'named_thing'), [], 'a label on a real picture identifies it');
  const floating = planFindings({ frames: [frame(1, { blueprint: blueprint({ pieces: [{ id: 'a', asset: 'V2', on: '' }], labels: [{ text: 'Apple', on: '' }] }) })] }, { draft: draft('Apple hired her.'), inventory, facts: f });
  assert.equal(ofId(floating, 'named_thing').length, 1, 'a label on nothing does not');
  const board = planFindings({ frames: [frame(1, { blueprint: blueprint({ ground: 'whiteboard', pieces: [{ id: 'a', note: 'Apple', on: '' }] }) })] }, { draft: draft('Apple hired her.'), inventory, facts: f });
  assert.deepEqual(ofId(board, 'named_thing'), [], 'a note on a whiteboard names it');
  const wished = planFindings({ frames: [frame(1, { asset_ids: ['W1'] })], wishes: [{ id: 'W1', person: null, want: 'The Apple logo', frame_ns: [1], fallback: 'V2' }] }, { draft: draft('Apple hired her.'), inventory, facts: f });
  assert.deepEqual(ofId(wished, 'named_thing'), [], 'a wish that asks for it counts until it resolves');
});

test('places: a place said as a place gets shown; near misses stay quiet; a room the line sets the scene in counts', () => {
  const f = facts([{ name: 'Acme', kind: 'company' }], { places: ['Barcelona, Spain', 'Toronto', 'Montreal', 'Acme'] });
  const inventory = inv(asset('V1', { shows: 'a plain portrait', kind: 'person_photo', people: ['Ada'] }), asset('V2', { kind: 'place_photo', place: 'Barcelona', shows: 'A convention hall' }), asset('V3', { kind: 'place_photo', shows: 'A park' }), asset('V4', { made: true, made_kind: 'setting', shows: 'a drawn room' }));
  const run = (line: string, over: Partial<StoryboardFrame>) => ofId(planFindings({ frames: [frame(1, over)] }, { draft: draft(line), inventory, facts: f }), 'named_place');
  assert.equal(run('He spoke at a session in Barcelona.', { asset_ids: ['V1'] }).length, 1);
  assert.match(run('He spoke at a session in Barcelona.', { asset_ids: ['V1'] })[0]!.why, /never a plain ground/);
  assert.deepEqual(run('He spoke at a session in Barcelona.', { asset_ids: ['V2'] }), []);
  assert.deepEqual(run('He spoke at a session in Barcelona.', { asset_ids: ['V4'] }), [], 'a built scene');
  assert.deepEqual(run('He spoke at a session in Barcelona.', { treatment: 'map', asset_ids: [] }), [], 'a map');
  assert.equal(run('He spoke at a session in Barcelona.', { asset_ids: ['V3'] }).length, 1, 'another place is not that place');
  assert.deepEqual(run('Montreal\'s Ada said so.', { asset_ids: ['V1'] }), [], 'a possessive names a person, not a scene');
  assert.deepEqual(run('Ada, a Toronto professor, said so.', { asset_ids: ['V1'] }), [], 'a modifier');
  assert.deepEqual(run('They went to Acme.', { asset_ids: ['V1'] }), [], 'a place that is also the cast is held by the named-things check');
  assert.deepEqual(run('The whiteboard note', { blueprint: blueprint({ pieces: [{ id: 'a', note: 'x', on: '' }] }) }), []);
  const onBoard = (note_role: 'place' | 'body') => run('He flew to Toronto.', { blueprint: blueprint({ ground: 'whiteboard', pieces: [{ id: 'a', note: 'Toronto', note_role, on: '' }] }) }).length;
  assert.equal(onBoard('place'), 0, 'a place note on a whiteboard');
  assert.equal(onBoard('body'), 1);

  assert.match(run('He called from a party closet.', { asset_ids: ['V1'] })[0]!.why, /sets? the scene "from a party closet"/);
  assert.match(run('From an upstairs closet at that party, he called.', { asset_ids: ['V1'] })[0]!.why, /closet/);
  assert.deepEqual(run('He called from a party closet.', { asset_ids: ['V3'] }), [], 'a place photo builds it');
  assert.deepEqual(run('He called from a party closet.', { asset_ids: ['V4'] }), []);
  assert.deepEqual(run('While in office he spoke.', { asset_ids: ['V1'] }), [], '"in office" is not a room');
  assert.deepEqual(run('He came out of the closet deal happy.', { asset_ids: ['V1'] }), [], 'no locative before it');
});

// ── Failed searches (decision 4) ─────────────────────────────────────────────────────────────────────

/** The Apple reel's records and wishes, as the saved plan and log hold them. */
const APPLE_INVENTORY = inv(
  asset('V1', { kind: 'logo', flags: ['logo'], shows: 'The Apple logo (symbol, on a light plate).', credit: 'Logo: Apple' }),
  asset('V3', { kind: 'place_photo', shows: 'Aerial daytime view of the Apple Park ring-shaped headquarters in Cupertino, surrounded by trees and roads.' }),
  asset('V5', { kind: 'place_photo', shows: 'Aerial view of the Apple Park ring headquarters at sunset with the surrounding town below.' }),
  asset('V36', { kind: 'headline', credit: 'Screenshot of 9to5mac.com', shows: 'A screenshot of the page "Apple AI researchers will be able to publish, likely a move to attract the best minds" on 9to5mac.com' }),
  asset('V37', { kind: 'headline', credit: 'Screenshot of top500.org', shows: 'A screenshot of the page "Apples Covert Machine Learning Strategy Takes a Step Out of the Shadows | TOP500" on top500.org' }),
  asset('V39', { kind: 'headline', credit: 'Screenshot of engadget.com', shows: 'A screenshot of the page "How Apple reinvigorated its AI aspirations in under a year" on engadget.com' }),
  asset('V40', { kind: 'event_photo', credit: 'Fortune (article image)', shows: "A phone screen showing a Siri prompt ('...you with?') beside an Apple Watch displaying 'Hey Siri...'" }),
  asset('V52', { kind: 'event_photo', credit: 'Cult of Mac', shows: "A stage slide reading 'Machine Learning at Apple, Engagement with Research Community: Can we publish? Yes.'" }),
);
const wish = (id: string, want: string, fallback: string, query: string, over: Partial<ShotWish> = {}): ShotWish => ({ id, person: null, want, query, as: 'photo', count: 1, cut_out: false, frame_ns: [], fallback, ...over });
const W2 = wish('W2', "A screenshot of 9to5Mac's 30 October 2015 article 'Apple's artificial intelligence work is being hurt by its extreme secrecy'", 'V37', '9to5Mac Apple AI secrecy academics');
const W10 = wish('W10', "A screenshot of the arXiv abstract page 1612.07828 'Learning from Simulated and Unsupervised Images through Adversarial Training'", 'V39', 'arXiv 1612.07828 simulated unsupervised images');
const W11 = wish('W11', "A screenshot of Fortune's 27 December 2016 article 'Apple Has Finally Published Its First AI Research Paper', headline visible", 'V40', 'Fortune Apple first AI research paper');

test('stand-ins: Apple frames 2 and 10 are caught: the searches failed and the fallbacks show something else', () => {
  const plan: DirectorPlan = { frames: [frame(2, { asset_ids: ['W2'] }), frame(10, { asset_ids: ['W10', 'W11'] })], wishes: [W2, W10, W11], lines_back: [] };
  const standIns = standInsFrom(plan, new Map());
  assert.deepEqual(standIns.map((s) => [s.wish_id, s.fallback, s.frames]), [['W2', 'V37', [2]], ['W10', 'V39', [10]], ['W11', 'V40', [10]]]);
  const resolved: DirectorPlan = { frames: [frame(2, { asset_ids: ['V37'] }), frame(10, { asset_ids: ['V39', 'V40'] })], lines_back: [] };
  const found = standInFindings(resolved, standIns, APPLE_INVENTORY);
  assert.deepEqual(found.map((f) => [f.frame, f.asset_id]), [[2, 'V37'], [10, 'V39'], [10, 'V40']]);
  assert.match(found[1]!.why, /frame 10 wanted "A screenshot of the arXiv/);
  assert.match(found[1]!.why, /rebuild the frame's message from the real pictures/);
  assert.match(found[2]!.why, /it is not an article or page/, 'credited to Fortune, and still no article');
  // Through the checks the run already calls.
  const via = varietyFindings(resolved, { draft: draft('a', 'b'), inventory: APPLE_INVENTORY, standIns });
  assert.equal(via.filter((v) => v.id === 'stand_in').length, 3);
  // Once the director rebuilds the frame, the finding is gone.
  assert.deepEqual(standInFindings({ frames: [frame(2, { asset_ids: ['V52'] }), frame(10, { asset_ids: ['V1'] })] }, standIns, APPLE_INVENTORY), []);
});

test('stand-ins: a found wish is no stand-in; a make, the same person, or a picture that shows the shot all fit', () => {
  const plan: DirectorPlan = { frames: [frame(1, { asset_ids: ['W1'] })], wishes: [wish('W1', 'x', 'V3', 'x')], lines_back: [] };
  assert.deepEqual(standInsFrom(plan, new Map([['W1', ['V9']]])), []);
  const fits = (w: ShotWish, makes?: MakeRequest[]) => standInFits({ want: w.want, query: w.query ?? null, as: w.as ?? null, person: w.person, fallback: w.fallback }, { inventory: APPLE_INVENTORY, makes }).fits;
  assert.ok(fits(wish('W1', 'The arXiv paper', 'M1', 'arxiv'), [{ id: 'M1', kind: 'drawing', brief: 'a page, drawn', people: [], from_assets: [], seed: null }]), 'a drawn page reads as made');
  assert.ok(fits(wish('W1', 'The Apple Park ring headquarters seen from above', 'V5', 'Apple Park ring')), 'a near miss on wording, the same thing');
  assert.ok(!fits(wish('W1', 'A real photo of a blank projection screen at the front of a conference hall', 'V3', 'blank projection screen conference')), 'an aerial view of a campus');
  assert.ok(!fits(wish('W1', 'Its logo', 'V3', 'its logo', { as: 'logo' })), 'a logo wish needs a logo');
  const people = inv(asset('V7', { kind: 'person_photo', people: ['Ada Founder'], shows: 'A woman on a stage' }), asset('V8', { kind: 'person_photo', people: ['Bo Rival'], shows: 'A man in a suit' }));
  const person = (fallback: string) => standInFits({ want: 'Ada Founder in 2013, face clear', query: 'Ada Founder 2013', as: 'photo', person: 'Ada Founder', fallback }, { inventory: people }).fits;
  assert.ok(person('V7'));
  assert.ok(!person('V8'));
});

test('shot against picture: the Apple frame 10 beats fire; the beats that match their pictures do not', () => {
  const apple: Pick<DirectorPlan, 'frames'> = { frames: [frame(10, { shots: [beat('On 22 December', 'the arXiv page of the paper', 'V39'), beat('though Fortune noted', "Fortune's article flashes in", 'V40')] })] };
  const found = shotPictureFindings(apple, APPLE_INVENTORY);
  assert.equal(found.length, 2);
  assert.match(found[0]!.why, /records nothing of arXiv/);
  assert.match(found[1]!.why, /is not an article or page/);
  const fine: Pick<DirectorPlan, 'frames'> = { frames: [
    frame(1, { shots: [beat('Before Elon Musk', 'Musk cutout, close, on charcoal', 'V9')] }),
    frame(2, { shots: [beat('trying to stop', 'Google logo lands on the right', 'V54'), beat('he Skyped', 'open laptop arrives in front of Musk', 'V92', 'V9')] }),
    frame(3, { shots: [beat('The Wall Street', 'slow push toward the WSJ print', 'V87')] }),
    frame(4, { shots: [beat('M', 'drawn research paper appears', 'M3'), beat('x', "'2015' written in marker")] }),
    frame(5, { shots: [beat('y', "a card reading 'Zurich Report'", 'V54')] }),
  ] };
  assert.deepEqual(shotPictureFindings(fine, MUSK_INVENTORY), []);
});

test('a recreation reads as made: a page built with no real picture behind it goes back; a whiteboard, or the real page, passes', () => {
  const inventory = inv(asset('V1', { kind: 'headline', shows: 'a real page' }), asset('V2', { made: true, made_kind: 'drawing', shows: 'a sketch' }));
  const check = (b: Partial<Blueprint>, makes?: MakeRequest[]) => ofId(planFindings({ frames: [frame(1, { blueprint: blueprint(b), line_ids: [] })], makes }, { draft: draft(), inventory }), 'recreated_as_real');
  assert.equal(check({ pieces: [{ id: 'a', treatment: 'headline', on: '' }] }).length, 1);
  assert.equal(check({ pieces: [{ id: 'a', treatment: 'page', asset: 'V2', on: '' }] }).length, 1);
  assert.equal(check({ pieces: [{ id: 'a', treatment: 'page', asset: 'M1', on: '' }] }, [{ id: 'M1', kind: 'drawing', brief: 'x', people: [], from_assets: [], seed: null }]).length, 1);
  assert.deepEqual(check({ pieces: [{ id: 'a', treatment: 'page', asset: 'V1', on: '' }] }), []);
  assert.deepEqual(check({ ground: 'whiteboard', pieces: [{ id: 'a', treatment: 'headline', on: '' }] }), []);
  assert.deepEqual(check({ pieces: [{ id: 'a', treatment: 'stat', on: '' }] }), [], 'a code-built number is not a page');
});

test('a long frame where only the camera moves goes back; an arrival, a mark or a second aim is enough', () => {
  const long = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen.';
  const check = (b: Partial<Blueprint>, line = long) => ofId(planFindings({ frames: [frame(1, { blueprint: blueprint(b) })] }, { draft: draft(line), inventory: inv(asset('V1')) }), 'static_frame').length;
  assert.equal(check({}), 1);
  assert.equal(check({}, 'One two three.'), 0, 'a short frame may hold');
  assert.equal(check({ pieces: [{ id: 'a', asset: 'V1', on: '' }, { id: 'b', asset: 'V1', on: 'seven eight' }] }), 0);
  assert.equal(check({ marks: [{ kind: 'circle', on_piece: 'a', on: 'nine' }] }), 0);
  assert.equal(check({ camera: { move: 'tour', stops: [{ on: '', aim: 'whole' }, { on: 'nine', aim: 'a' }] } }), 0);
});

// ── Blueprint validity ───────────────────────────────────────────────────────────────────────────────

const VOICE = "Musk told him, \"The future of AI should not be controlled by Larry,\" and Google's $5 billion—won.";

test('words are matched the way nk.cueAt matches, whole phrase', () => {
  const timed = VOICE.split(/[\s—–]+/).map((text, i) => ({ text, start: i, end: i + 1 }));
  for (const phrase of ['Musk told him', 'the future of ai', 'Larry and', "google's $5", '5 billion', 'BY LARRY,', 'won']) {
    const at = wordsAt(phrase, VOICE);
    assert.ok(at >= 0, phrase);
    assert.equal(cueAt(timed, phrase), at, `nk.cueAt lands "${phrase}" at the same word`);
  }
  assert.equal(wordsAt('', VOICE), 0, "'' is the frame's start");
  assert.equal(wordsAt('the investors said', VOICE), -1);
  assert.equal(wordsAt('Musk told her', VOICE), -1, 'a voice-differing phrase: cueAt would land it on its opening; the plan must say the words');
  assert.equal(wordsAt('Musk', VOICE, 1), -1, 'after the words already spoken');
  assert.deepEqual([...ANCHORED_MARK_KINDS], ANCHORED_KINDS, 'the mark kinds are the kit\'s');
});

function valid(): Blueprint {
  return {
    ground: 'charcoal', style: 'cutouts', arrangement: 'face_off',
    hook: { text: 'The call', on: '' },
    pieces: [
      { id: 'musk', asset: 'V1', role: 'lead', side: 'left', on: '', label: 'Elon Musk' },
      { id: 'laptop', asset: 'V2', belongs: 'musk', on: 'told him' },
      { id: 'note', note: 'the future', note_role: 'body', onto: { piece: 'laptop', box: 'screen' }, on: 'The future of AI', until: 'by Larry' },
    ],
    labels: [{ text: 'Larry Page', for: 'laptop', on: 'by Larry' }],
    speech: [{ on_piece: 'musk', text: 'Not Larry', on: 'should not be', until: "Google's" }],
    marks: [{ kind: 'circle', on_piece: 'musk', target: 'face:Elon Musk', on: 'Musk told' }, { kind: 'worry', on_piece: 'musk', on: 'controlled' }, { kind: 'arrow', on_piece: 'note', from: 'musk', on: 'him' }],
    arrows: [{ from: 'musk', to: 'laptop', on: 'told' }],
    camera: { move: 'tour', stops: [{ on: '', aim: 'whole' }, { on: 'told him', aim: 'face:Elon Musk' }, { on: 'by Larry', aim: 'laptop' }, { on: "Google's", aim: 'text:the future' }] },
    ground_tone: [{ on: 'controlled', to: 0.3 }],
    sounds: [{ kind: 'foley', what: 'paper landing', on: 'him' }],
  };
}
const BP_INVENTORY = inv(asset('V1', { kind: 'person_photo', people: ['Elon Musk'] }), asset('V2', { kind: 'object', shows: 'a laptop' }));
const findingsOf = (b: unknown, over: Partial<DirectorPlan> = {}) => blueprintFindings({ frames: [frame(1, { blueprint: b as Blueprint })], ...over }, { draft: draft(VOICE), inventory: BP_INVENTORY }).map((f) => f.why);

test('blueprint validity: a good blueprint has no findings', () => {
  assert.deepEqual(findingsOf(valid()), []);
  assert.deepEqual(blueprintFindings({ frames: [frame(1)] }, { draft: draft(VOICE), inventory: BP_INVENTORY }), [], 'a plan with no blueprints skips this');
});

test('blueprint validity: each error says what to change', () => {
  const broke = (change: (b: Blueprint) => void) => { const b = valid(); change(b); return findingsOf(b).join('\n'); };
  assert.match(broke((b) => { b.pieces[1]!.on = 'the investors said'; }), /lands on "the investors said", which the frame's voice doesn't say\. The voice says: "Musk told him/);
  assert.match(broke((b) => { b.speech[0]!.until = 'Musk told'; }), /ends on "Musk told", which the voice says before the words it starts on/);
  assert.match(broke((b) => { b.marks[0]!.on_piece = 'hassabis'; }), /is on "hassabis" is not a piece in this frame \(its pieces: musk, laptop, note\)/);
  assert.match(broke((b) => { b.labels[0]!.for = 'page'; }), /is for "page" is not a piece/);
  assert.match(broke((b) => { b.arrows[0]!.to = 'nobody'; }), /goes to "nobody" is not a piece/);
  assert.match(broke((b) => { b.arrows[0]!.from = 'nobody'; }), /starts from "nobody" is not a piece/);
  assert.match(broke((b) => { b.pieces[1]!.belongs = 'nobody'; }), /belongs to "nobody" is not a piece/);
  assert.match(broke((b) => { b.pieces[2]!.onto = { piece: 'nobody', box: 'x' }; }), /placed onto "nobody" is not a piece/);
  assert.match(broke((b) => { b.speech[0]!.on_piece = 'nobody'; }), /is on "nobody" is not a piece/);
  assert.match(broke((b) => { b.arrangement = 'grid' as never; }), /arrangement "grid" isn't one of face_off/);
  assert.match(broke((b) => { b.style = 'neon' as never; }), /style "neon" isn't one of cutouts, paper/);
  assert.match(broke((b) => { b.marks[0]!.kind = 'glow'; }), /mark kind "glow" isn't one of circle.*worry/);
  assert.match(broke((b) => { b.camera.move = 'orbit' as never; }), /camera move "orbit" isn't one of hold/);
  assert.match(broke((b) => { b.camera.stops[2]!.aim = 'nothing'; }), /camera aims at "nothing"; aim at whole, a piece id/);
  assert.match(broke((b) => { b.camera.stops[1]!.aim = 'face:Sam Altman'; }), /no piece in this frame shows Sam Altman/);
  assert.match(broke((b) => { b.marks[0]!.target = 'somewhere'; }), /target "somewhere"; write text:/);
  assert.match(broke((b) => { b.pieces[1]!.asset = 'V77'; }), /uses V77, which is not in the inventory, the makes or the wishes/);
  assert.match(broke((b) => { b.ground = 'V77'; }), /ground "V77" is neither/);
  assert.match(broke((b) => { b.pieces[1]!.treatment = 'hologram'; }), /treatment "hologram"; one of page/);
  assert.match(broke((b) => { b.pieces.push({ id: 'musk', asset: 'V1', on: '' }); }), /two pieces share the id "musk"/);
  assert.match(broke((b) => { b.pieces.push({ id: 'empty', on: '' }); }), /no asset, note or treatment/);
  assert.match(broke((b) => { b.peak = true; b.camera.move = 'slide'; }), /peak frame uses a slide/);
  assert.match(broke((b) => { b.ground_tone![0]!.to = 2; }), /give 0 to 1/);
  const untrusted = inv(asset('V1', { kind: 'person_photo', people: ['Elon Musk'], regions: { faces: [{ x: 0, y: 0, w: 0.1, h: 0.1, trusted: false }] } as never }), asset('V2'));
  const found = blueprintFindings({ frames: [frame(1, { blueprint: valid() })] }, { draft: draft(VOICE), inventory: untrusted }).map((f) => f.why).join('\n');
  assert.match(found, /targets a face on V1, which has no trusted face/);
  assert.match(found, /no picture of them here has a trusted face; aim at the piece/);
});

test('blueprint validity: wishes and makes count as assets; the close carries none', () => {
  const b = valid();
  b.pieces[1]!.asset = 'W1';
  b.pieces.push({ id: 'drawn', asset: 'M1', on: '' });
  const plan = { wishes: [wish('W1', 'x', 'V1', 'x')], makes: [{ id: 'M1', kind: 'drawing', brief: 'x', people: [], from_assets: [], seed: null }] } as Partial<DirectorPlan>;
  assert.deepEqual(findingsOf(b, plan), []);
  assert.deepEqual(blueprintFindings({ frames: [frame(1, { blueprint: valid() }), closeFrame(2)] }, { draft: draft(VOICE), inventory: BP_INVENTORY }), []);
});

test('validatePlan: blueprint findings are the one correction, never a failure; pictures join the frame; a planned drawing becomes a make', () => {
  const d = draft(VOICE);
  d.hook.on_screen = 'A hook';
  const b = valid();
  b.pieces[1]!.on = 'words nobody says';
  const v = validatePlan({ frames: [frame(1, { on_screen: 'A hook', blueprint: b, treatment: 'tableau' }), closeFrame(2)], lines_back: [] }, { draft: d, inventory: BP_INVENTORY });
  assert.deepEqual(v.problems, []);
  assert.equal(v.soft.length, 1);
  assert.match(v.soft[0]!, /"words nobody says"/);
  assert.ok(v.warnings.some((w) => /"words nobody says"/.test(w)), 'it ships flagged if it stays');
  assert.ok(v.value!.frames[0]!.asset_ids.includes('V2'), "a piece's picture joins the frame");

  const drawn = blueprint({ pieces: [{ id: 'sketch', asset: 'M7', on: 'told' }] });
  const made = validatePlan({ frames: [frame(1, { on_screen: 'A hook', blueprint: drawn, treatment: 'tableau', shots: [beat('Musk told', 'a drawn laptop on a table', 'M7')] }), closeFrame(2)], lines_back: [] }, { draft: d, inventory: BP_INVENTORY });
  assert.deepEqual(made.problems, []);
  assert.deepEqual(made.value!.makes!.map((m) => [m.id, m.kind, m.brief]), [['M7', 'drawing', 'a drawn laptop on a table']]);

  const left = ensurePlannedMakes({ frames: [frame(1, { blueprint: blueprint({ pieces: [{ id: 'a', asset: 'M1', on: '' }, { id: 'b', asset: 'V404', on: '' }] }) })], lines_back: [] }, inv());
  assert.deepEqual(left.added, ['M1'], 'only a make id can become a make');
  const full = Array.from({ length: 6 }, (_, i) => ({ id: `M${i + 10}`, kind: 'drawing' as const, brief: 'x', people: [], from_assets: [], seed: null }));
  assert.deepEqual(ensurePlannedMakes({ frames: [frame(1, { blueprint: blueprint({ pieces: [{ id: 'a', asset: 'M1', on: '' }] }) })], makes: full, lines_back: [] }, inv()).added, [], 'not past the make limit');
});

// ── What the director sees, and the fix round ────────────────────────────────────────────────────────

test('inventoryForDirecting: shows what harvest measured; never the grids; a rejected cut is no cutout', () => {
  const shape = { w: 2, h: 2, cells: '1111' };
  const regions = { visible: { x: 0, y: 0, w: 1, h: 1 }, shape, tone: { w: 2, h: 2, cells: 'ffff' } };
  const inventory = inv(
    asset('V1', { kind: 'person_photo', people: ['Ada'], character_image: true, flags: ['cutout'], regions: { ...regions, cut: { grade: 'clean', edge_softness: 0.1, islands: 0, straight_cuts: 0, sharpness: 0.9 }, dup_of: 'V9', brightness: 0.4321, expression: 'laughing', sharp_width_px: 640, open_edges: { left: false, right: true, top: false, bottom: true }, faces: [{ x: 0, y: 0, w: 1, h: 1, trusted: true }, { x: 0, y: 0, w: 1, h: 1, trusted: false }] } }),
    asset('V2', { kind: 'person_photo', people: ['Bo'] }),
    asset('V3', { kind: 'person_photo', people: ['Bo'], character_image: true, anchor_for: 'Bo', flags: ['cutout', 'cutout_of:V2', 'garbled:cut_rejected'], regions: { ...regions, cut: { grade: 'rejected', edge_softness: 1, islands: 1, straight_cuts: 1, sharpness: 0 } } }),
    asset('V4', { kind: 'person_photo', people: ['Cy'], character_image: true, flags: ['cutout'], regions: { ...regions, cut: { grade: 'rejected', edge_softness: 1, islands: 1, straight_cuts: 1, sharpness: 0 } } }),
  );
  const seen = inventoryForDirecting(inventory);
  const json = JSON.stringify(seen);
  assert.ok(!/cells|"shape"|"tone"/.test(json), 'never the grids');
  assert.deepEqual(seen.map((a) => a.id), ['V1', 'V2', 'V4'], "a rejected cut with its photo at hand isn't offered");
  const v1 = seen[0] as Record<string, unknown>;
  assert.equal(v1.cut, 'clean');
  assert.equal(v1.dup_of, 'V9');
  assert.equal(v1.brightness, 0.43);
  assert.equal(v1.expression, 'laughing');
  assert.equal(v1.sharp_width_px, 640);
  assert.deepEqual(v1.open_edges, { left: false, right: true, top: false, bottom: true });
  assert.equal(v1.trusted_faces, 1);
  const v4 = seen[2] as Record<string, unknown>;
  assert.equal(v4.print_only, true, 'with no photo at hand it shows as a print');
  assert.equal(v4.character_image, false);
  assert.ok(!(v4.flags as string[]).includes('cutout'));
  assert.ok(!('cut' in (seen[1] as object)), 'an unmeasured picture stays short');
});

const toolMessage = (input: unknown) => ({ id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't', name: 'submit_plan', input }] });

test('the fix round carries the plan findings to the director, and only the named frames', async () => {
  const d = draft('Line one.');
  const plan = { frames: [frame(1, { on_screen: 'A hook', treatment: 'tableau', asset_ids: ['V1'] }), closeFrame(2)], lines_back: [] } as unknown as DirectorPlan;
  const calls: { messages: { content: { text: string }[] }[] }[] = [];
  const create = (async (p: never) => { calls.push(p); return toolMessage(plan); }) as never;
  const db = { query: async () => ({ rows: [] }) };
  const problems = [{ id: 'named_thing', frame: 1, asset_id: null, why: "frame 1's words name Acme, and nothing on screen shows it" }];
  await directReel({ create, db: db as never, mode: 'production' }, { draft: d, inventory: inv(asset('V1')), facts: { facts: [], quotes: [], artifacts: [], sources: [], cast: [], places: [], timeline: [], summary: '', verdict: { holds: true, reason: '' } } as FactSheet, kitGuide: '# Kit', fix: { kind: 'plan_check', plan, problems } });
  const text = calls[0]!.messages[0]!.content[1]!.text;
  assert.match(text, /Plan-check problems \(re-plan only these frames\)/);
  assert.match(text, /name Acme, and nothing on screen shows it/);
});

// ── The integrity check's shot map ───────────────────────────────────────────────────────────────────

const PAGE_LINE = "Musk distrusted how Google's boss, Larry Page, would develop AI.";

function labelled(label: string, line = PAGE_LINE) {
  const d = draft(line);
  d.rungs[0]!.lines[0]!.on_screen = label;
  return d;
}

test("integrity: the label goes with the shot on screen, not the frame's first picture (the 'Larry Page' false alarm)", () => {
  const f = frame(1, { asset_ids: ['V9', 'V83', 'V54'], shots: [beat('Musk distrusted', 'Musk cutout alone on the left', 'V9'), beat('Larry Page', 'Page arrives right', 'V83'), beat('would develop AI', 'Google logo lands', 'V54')] });
  const plan: DirectorPlan = { frames: [f, closeFrame(2)], lines_back: [] };
  const items = lookItems(plan, MUSK_INVENTORY, labelled('Larry Page, Google CEO'));
  const of = (id: string) => items.find((i) => i.asset.id === id)!;
  assert.equal(of('V9').onScreen, '', 'the first picture is no longer judged by a label about someone else');
  assert.equal(of('V54').onScreen, '');
  assert.equal(of('V83').onScreen, 'Larry Page, Google CEO');
  assert.equal(of('V9').beat, "Musk distrusted how Google's boss,");
  assert.equal(of('V9').shot, 'Musk cutout alone on the left');
  const text = lookText(of('V83'), 0);
  assert.match(text, /The shot on screen with it: "Page arrives right"/);
  assert.match(text, /On screen with this picture: "Larry Page, Google CEO"/);
});

test('integrity: a label naming two people goes to the first one named; a label naming no one goes to what is up when it lands', () => {
  const line = 'With his friend Luke Nosek, Musk tried to raise the money.';
  const f = frame(1, { asset_ids: ['V45', 'V9'], shots: [beat('With his friend', 'Nosek arrives', 'V45'), beat('Musk tried', 'Musk beside him', 'V9')] });
  const items = lookItems({ frames: [f], lines_back: [] }, MUSK_INVENTORY, labelled("Luke Nosek, Musk's friend", line));
  assert.equal(items.find((i) => i.asset.id === 'V9')!.onScreen, '');
  assert.equal(items.find((i) => i.asset.id === 'V45')!.onScreen, "Luke Nosek, Musk's friend");
  const dated = lookItems({ frames: [frame(1, { asset_ids: ['V61', 'V54'], shots: [beat('Musk distrusted', 'a campus', 'V61'), beat('would develop AI', 'the logo', 'V54')] })], lines_back: [] }, MUSK_INVENTORY, labelled('Winter 2013–14'));
  assert.equal(dated.find((i) => i.asset.id === 'V61')!.onScreen, 'Winter 2013–14', 'an unspoken label lands at the start of its line');
  assert.equal(dated.find((i) => i.asset.id === 'V54')!.onScreen, '');
});

test('integrity: reads a blueprint when there are no beats; a label for a piece stays with that piece; no map, every word plays over every picture', () => {
  const b = blueprint({ arrangement: 'face_off', pieces: [{ id: 'musk', asset: 'V9', on: '' }, { id: 'page', asset: 'V83', on: 'Larry Page' }], labels: [{ text: 'A friend once', for: 'page', on: 'Larry Page' }] });
  const map = frameShotMap(frame(1, { blueprint: b }), draft(PAGE_LINE), MUSK_INVENTORY);
  assert.deepEqual(map.get('V9')!.labels, []);
  assert.deepEqual(map.get('V83')!.labels, ['A friend once']);
  assert.equal(map.get('V83')!.words, 'Larry Page, would develop AI.');
  const none = lookItems({ frames: [frame(1, { asset_ids: ['V61', 'V54'] })], lines_back: [] }, MUSK_INVENTORY, labelled('Winter 2013–14'));
  assert.ok(none.every((i) => i.onScreen === 'Winter 2013–14' && i.beat === null));
  assert.deepEqual(recordProblems({ frames: [frame(1, { blueprint: blueprint({ pieces: [{ id: 'a', asset: 'V404', on: '' }] }) })], lines_back: [] }, MUSK_INVENTORY).map((p) => p.asset_id), ['V404'], "a piece's picture is checked too");
});

test("integrity: figures read from the blueprint's written words, not free text", () => {
  const d = draft('The price was never disclosed.');
  const on = (b: Partial<Blueprint>) => impliedFigureProblems({ frames: [frame(1, { blueprint: blueprint(b), shots: [beat('The price', 'a page', 'V1')] })], lines_back: [] }, d);
  assert.match(on({ pieces: [{ id: 'a', note: '$24 million', on: '' }] })[0]!.why, /writes "\$24 million" on screen/);
  assert.match(on({ pieces: [{ id: 'a', treatment: 'stat', opts: { value: '$9 billion' }, on: '' }] })[0]!.why, /\$9 billion/);
  assert.match(on({ speech: [{ on_piece: 'a', text: '7 billion', on: '' }] })[0]!.why, /7 billion/);
  assert.deepEqual(on({ pieces: [{ id: 'a', asset: 'V1', on: '' }] }), []);
});

test("integrity: a picture's visible words against the story's date; near misses stay quiet", () => {
  const facts2 = { timeline: [{ date: '2014-01-26', event: 'x', fact_ids: ['F1'] }, { date: 'March 2016', event: 'y', fact_ids: ['F2'] }] };
  const d = draft('Google bought the lab.', 'Later nothing changed.', 'By 2023 it had a new name.');
  d.rungs[0]!.lines[0]!.fact_ids = ['F1'];
  const inventory = inv(
    asset('V1', { kind: 'headline', shows: 'A page headed "The 2023 merger"' }),
    asset('V2', { kind: 'headline', shows: 'A page headed "The 2010 lab"' }),
    asset('V3', { kind: 'headline', shows: 'A page captured 2026-11-04 headed "A deal"' }),
    asset('V4', { kind: 'event_photo', shows: 'A sign', regions: { words: [{ text: 'Summit' }, { text: '2021' }] } as never }),
  );
  const frames = (...ids: string[][]) => ({ frames: ids.map((asset_ids, i) => frame(i + 1, { asset_ids })), lines_back: [] });
  const check = (plan: DirectorPlan) => visibleDateProblems(plan, inventory, d, facts2);
  assert.match(check(frames(['V1']))[0]!.why, /V1's visible words say 2023, and frame 1's story is set in 2014-01-26/);
  assert.deepEqual(check(frames(['V2'])), [], 'an earlier year is fine');
  assert.deepEqual(check(frames(['V3'])), [], 'a capture date is not on the page');
  assert.equal(check(frames(['V4'])).length, 1, 'measured words count');
  assert.equal(check(frames([], ['V1'])).length, 1, 'a frame that states no date carries the last one');
  assert.deepEqual(check(frames([], [], ['V1'])), [], "the frame's own words reach that year");
  assert.deepEqual(visibleDateProblems(frames(['V1']), inventory, draft('Nothing dated.')), [], 'no date stated, nothing to hold it to');
  assert.deepEqual([...storyDates(frames([], [], []), d, facts2).values()].map((v) => v?.to), [2014, 2014, 2023]);
  const dated = draft('It happened.');
  dated.rungs[0]!.lines[0]!.on_screen = 'Winter 2013–14';
  dated.rungs[0]!.lines[0]!.on_screen_kind = 'date';
  assert.deepEqual(storyDates({ frames: [frame(1)] }, dated).get(1), { text: 'Winter 2013–14', to: 2013 });
});

test('integrity: the look gets the shot and the date, and code findings join its own; stubbed, no API', async () => {
  const seen: string[] = [];
  const create = (async (p: { messages: { content: { type: string; text?: string }[] }[] }) => {
    seen.push(...p.messages[0]!.content.filter((c) => c.type === 'text').map((c) => c.text!));
    return { id: 'm', type: 'message', role: 'assistant', model: 'stub', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't', name: 'submit_looks', input: { looks: [{ image: 1, sees: 'a page', matches: 'yes', disqualified: false, why: '' }] } }] };
  }) as never;
  const inventory = inv(asset('V1', { kind: 'headline', shows: 'A page headed "The 2023 merger"', credit: 'c' }));
  const d = draft('In 2014 the lab sold.');
  const { problems } = await checkIntegrity(
    { create, db: { query: async () => ({ rows: [] }) } as never, mode: 'production', jobDir: '/nowhere', readImage: async () => ({ data: 'x', mediaType: 'image/jpeg' }) } as never,
    { plan: { frames: [frame(1, { asset_ids: ['V1'], shots: [beat('In 2014', 'the page', 'V1')] }), closeFrame(2)], lines_back: [] }, inventory, draft: d },
  );
  assert.match(seen[0]!, /The story's date here: 2014/);
  assert.match(seen[0]!, /The shot on screen with it: "the page"/);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.why, /visible words say 2023/);
});

test('frameAssetIds and the review doc read the blueprint', () => {
  const f = frame(1, { asset_ids: ['V1'], shows: [{ person: 'A', asset_id: 'V2', treatment: 'x' }], shots: [beat('a', 'b', 'V3')], blueprint: blueprint({ ground: 'V5', pieces: [{ id: 'a', asset: 'V4', on: '' }] }) });
  assert.deepEqual(frameAssetIds(f), ['V1', 'V2', 'V3', 'V4', 'V5']);
  const doc = blueprintReview({ frames: [frame(1, { blueprint: valid() }), closeFrame(2)] });
  assert.match(doc, /Frame 1: f1 \(face_off on charcoal, cutouts; camera tour\)/);
  assert.match(doc, /\| told him \| piece laptop \| V2 \|/);
  assert.match(doc, /\| Musk told \| circle on musk \| face:Elon Musk \|/);
});
