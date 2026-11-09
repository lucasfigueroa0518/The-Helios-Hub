import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import * as frames from '@/explainers/reel-ai-drama/kit/frames.mjs';
import { frameMakes, frameShows, storyboardMarkdown } from '@/explainers/reel-ai-drama/kit/project-files.mjs';
import { EXPRESSIONS, SEED_CATALOG, SETTINGS, seedKind, seedSvg } from '@/explainers/reel-ai-drama/kit/settings/index.js';
import { mainCharacters, namedPeople, samePerson, stagingOf, varietyFindings, varietyProblems } from '@/lib/reel-ai-drama/checks/variety';
import { applyWishes } from '@/lib/reel-ai-drama/render/wishes';
import { makeAssets, makePrompt, planWithoutFailedMakes, referenceFor, type GenerateImage } from '@/lib/reel-ai-drama/render/make';
import { FOCUS_KINDS, type Asset, type DirectorPlan, type FactSheet, type MakeRequest, type StoryboardFrame, type VisualsInventory, type WriterDraft } from '@/lib/reel-ai-drama/types';
import { inventoryForDirecting } from '@/lib/reel-ai-drama/writing/director';
import { MAKE_KINDS, SUBMIT_PLAN_TOOL, TREATMENTS } from '@/lib/reel-ai-drama/writing/schemas';
import { MAX_GENERATED_MAKES, makeProblems, pruneCutLines, validatePlan, wishProblems } from '@/lib/reel-ai-drama/writing/validate';

// ── Fixtures (generic people and places; no real story) ─────────────────────

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: null, source_page: null, credit: `Photo ${id}`, license: null,
    shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1600, height: 1200,
    phash: null, character_image: false, made: false, upscaled: false, flags: [], ...over,
  };
}

const INVENTORY: VisualsInventory = {
  assets: [
    asset('V1', { people: ['Ada Founder'], anchor_for: 'Ada Founder' }),
    asset('V2', { people: ['Ada Founder'], character_image: true, file: 'media/V2.png' }),
    asset('V3', { people: ['Ben Rival'], anchor_for: 'Ben Rival', character_image: true, file: 'media/V3.png' }),
    asset('V4', { kind: 'web_page', shows: 'an article page' }),
    asset('V5', { kind: 'logo', flags: ['logo'] }),
  ],
  usable_count: 5, counts: {}, kill: null, usd: 0,
};

function draft(texts: string[]): WriterDraft {
  return {
    title: 'T', hook: { line_id: 'L1' },
    rungs: [{ id: 'R1', purpose: 'p', lines: texts.map((text, i) => ({ id: `L${i + 1}`, text, on_screen: null, fact_ids: [], must_show: null })) }],
    peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Would you?', word_count: 0, central: [],
  };
}

function frame(n: number, over: Partial<StoryboardFrame> = {}): StoryboardFrame {
  return { n, name: `f${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: ['V4'], purpose: 'p', motion: 'push', marks: '', sound: '', music: n === 1 ? 'start' : 'hold', on_screen: null, shows: [], focus: { kind: FOCUS_KINDS[n % FOCUS_KINDS.length]!, what: 'what the eye lands on' }, ...over };
}

const close = (n: number): StoryboardFrame => ({ n, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null });

// ── Variety ─────────────────────────────────────────────────────────────────

test('variety: the staging type follows the treatment; a photo splits on whether it shows a person', () => {
  assert.equal(stagingOf({ treatment: 'photo', shows: [] }), 'place');
  assert.equal(stagingOf({ treatment: 'photo', shows: [{ person: 'A', asset_id: 'V1', treatment: 'photo' }] }), 'portrait');
  assert.equal(stagingOf({ treatment: 'lower_third' }), 'portrait');
  assert.equal(stagingOf({ treatment: 'post' }), stagingOf({ treatment: 'page' }));
  assert.equal(stagingOf({ treatment: 'close' }), null);
  for (const t of TREATMENTS) if (t !== 'close') assert.ok(stagingOf({ treatment: t }), `${t} has a staging type`);
});

test('variety: a staging type repeated back to back is found; alternating is clean', () => {
  const plan = { frames: [
    frame(1, { treatment: 'photo', asset_ids: ['V1'], shows: [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'photo' }] }),
    frame(2, { treatment: 'cutout_lift', asset_ids: ['V3'], shows: [{ person: 'Ben Rival', asset_id: 'V3', treatment: 'cutout_lift' }] }),
    frame(3, { treatment: 'page', asset_ids: ['V4'] }),
    close(4),
  ] };
  const f = varietyFindings(plan);
  assert.deepEqual(f.map((x) => [x.id, x.frame]), [['staging_repeat', 2]]);
  plan.frames[1] = frame(2, { treatment: 'map', asset_ids: ['V4'] });
  assert.deepEqual(varietyProblems(plan), []);
});

test('variety: the same person the same way three appearances in a row is found, once; a change resets it', () => {
  const ada = (n: number, id = 'V2', t = 'cutout_lift') => frame(n, { treatment: t, asset_ids: [id], shows: [{ person: 'Ada Founder', asset_id: id, treatment: t }] });
  const gap = (n: number) => frame(n, { treatment: n % 2 ? 'page' : 'map' });
  const plan = { frames: [ada(1), gap(2), ada(3), gap(4), ada(5), gap(6), ada(7), close(8)] };
  const same = varietyFindings(plan).filter((x) => x.id === 'same_way');
  assert.deepEqual(same.map((x) => x.frame), [5], 'flagged on the third appearance only');
  assert.match(same[0].why, /Ada Founder.*V2.*third time/);
  plan.frames[4] = ada(5, 'V2', 'tableau');
  assert.deepEqual(varietyFindings(plan).filter((x) => x.id === 'same_way'), [], 'another treatment of the same image is another way');
});

test('variety: a person named in a frame but not shown is found (full name or capitalised surname), main or not', () => {
  const d = draft(['Ada Founder walked in.', 'Then Rival said no.', "Founder's smile faded.", 'Nobody named here, not even a page.']);
  const plan = { frames: [
    frame(1, { asset_ids: ['V1'], shows: [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'photo' }] }),
    frame(2, { treatment: 'page' }),
    frame(3, { treatment: 'map' }),
    frame(4, { treatment: 'page' }),
    close(5),
  ] };
  const missing = varietyFindings(plan, { draft: d, inventory: INVENTORY }).filter((x) => x.id === 'named_not_shown');
  assert.deepEqual(missing.map((x) => [x.frame, /Ben Rival|Ada Founder/.exec(x.why)?.[0]]), [[2, 'Ben Rival'], [3, 'Ada Founder']]);
  assert.deepEqual(mainCharacters(INVENTORY), ['Ada Founder', 'Ben Rival']);
  assert.ok(samePerson('Founder', 'Ada Founder') && !samePerson('Ada Founder', 'Ben Rival'));
  assert.deepEqual(varietyFindings(plan, {}).filter((x) => x.id === 'named_not_shown'), [], 'without a draft the name check is skipped');

  // MD-75: a named peripheral person (fact sheet cast, no anchor) is shown too; a lowercase common word is not a name.
  const facts = { cast: [{ name: 'Cy Page', role: 'investor', kind: 'person', player_id: null, want: '' }, { name: 'Acme Labs', role: 'lab', kind: 'company', player_id: null, want: '' }] } as unknown as FactSheet;
  const d2 = draft(['Ada Founder met Page.', 'Acme Labs grew.', 'She turned the page.']);
  const plan2 = { frames: [
    frame(1, { asset_ids: ['V1'], shows: [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'photo' }] }),
    frame(2, { treatment: 'page' }),
    frame(3, { treatment: 'map' }),
    close(4),
  ] };
  const named = varietyFindings(plan2, { draft: d2, inventory: INVENTORY, facts }).filter((x) => x.id === 'named_not_shown');
  assert.deepEqual(named.map((x) => [x.frame, /Cy Page|Acme Labs/.exec(x.why)?.[0]]), [[1, 'Cy Page']]);
  assert.deepEqual(namedPeople({ facts, inventory: INVENTORY }), ['Cy Page', 'Ada Founder', 'Ben Rival']);
});

test('variety: medium_mix — a cutout beside a drawing, or a drawing over a photo; all drawn or all photo is clean (MD-69)', () => {
  const makes: MakeRequest[] = [{ id: 'M1', kind: 'expression', brief: 'Ben, worried', people: ['Ben Rival'], from_assets: ['V3'], seed: null }];
  const mixed = { makes, frames: [
    frame(1, { treatment: 'collision', asset_ids: ['V2', 'M1'], shows: [{ person: 'Ada Founder', asset_id: 'V2', treatment: 'collision' }, { person: 'Ben Rival', asset_id: 'M1', treatment: 'collision' }] }),
    close(2),
  ] };
  const f = varietyFindings(mixed, { inventory: INVENTORY }).filter((x) => x.id === 'medium_mix');
  assert.equal(f.length, 1);
  assert.match(f[0].why, /Ada Founder as V2 \(photo\).*Ben Rival as M1 \(drawn\)/);

  const overPhoto = { makes, frames: [frame(1, { treatment: 'cutout_lift', asset_ids: ['V1', 'M1'], shows: [{ person: 'Ben Rival', asset_id: 'M1', treatment: 'cutout_lift' }] }), close(2)] };
  assert.match(varietyProblems(overPhoto, { inventory: INVENTORY }).join('\n'), /drawing of Ben Rival over the photo V1/);

  const board = { makes, frames: [frame(1, { treatment: 'whiteboard', asset_ids: ['M1'], shows: [{ person: 'Ada Founder', asset_id: 'V2', treatment: 'whiteboard' }, { person: 'Ben Rival', asset_id: 'M1', treatment: 'whiteboard' }] }), close(2)] };
  assert.deepEqual(varietyFindings(board, { inventory: INVENTORY }).filter((x) => x.id === 'medium_mix'), [], 'both drawn on one whiteboard');
  const photos = { frames: [frame(1, { treatment: 'tableau', asset_ids: ['V2', 'V3'], shows: [{ person: 'Ada Founder', asset_id: 'V2', treatment: 'tableau' }, { person: 'Ben Rival', asset_id: 'V3', treatment: 'tableau' }] }), close(2)] };
  assert.deepEqual(varietyFindings(photos, { inventory: INVENTORY }).filter((x) => x.id === 'medium_mix'), []);
});

// ── Wishes (MD-68) ───────────────────────────────────────────────────────────

test('applyWishes: a found wish becomes the found asset everywhere; a missed one its fallback; resolved wishes leave the plan', () => {
  const plan: DirectorPlan = {
    frames: [
      frame(1, { treatment: 'photo', asset_ids: ['W1', 'V4'], motion: 'push to W1 on his name', marks: 'ring on W1 face', shows: [{ person: 'Ada Founder', asset_id: 'W1', treatment: 'photo' }] }),
      frame(2, { treatment: 'tableau', asset_ids: ['M2', 'W2', 'V3'], shows: [{ person: 'Ben Rival', asset_id: 'W2', treatment: 'tableau' }] }),
      frame(3, { treatment: 'collage', asset_ids: ['W3', 'V1'], motion: 'W3 slaps on; W12 stays', shows: [] }),
      close(4),
    ],
    makes: [
      { id: 'M2', kind: 'setting', brief: 'a hall', people: [], from_assets: [], seed: null },
      { id: 'M3', kind: 'drawing', brief: 'the hall drawn', people: [], from_assets: ['W3'], seed: null },
      { id: 'M4', kind: 'expression', brief: 'Ada sketch', people: ['Ada Founder'], from_assets: ['V1'], seed: null },
    ],
    wishes: [
      { id: 'W1', person: 'Ada Founder', want: 'Ada on stage, 2015', frame_ns: [1], fallback: 'V1' },
      { id: 'W2', person: 'Ben Rival', want: 'Ben at the table', frame_ns: [2], fallback: 'V3' },
      { id: 'W3', person: null, want: 'the hall from outside', frame_ns: [3], fallback: 'M3' },
      { id: 'W12', person: null, want: 'a crowd', frame_ns: [3], fallback: 'V4' },
    ],
    lines_back: [],
  };
  const out = applyWishes(plan, new Map([['W1', 'V21'], ['W3', 'V22']]));
  assert.deepEqual(out.frames[0].asset_ids, ['V21', 'V4']);
  assert.equal(out.frames[0].shows![0].asset_id, 'V21');
  assert.equal(out.frames[0].motion, 'push to V21 on his name');
  assert.equal(out.frames[0].marks, 'ring on V21 face');
  assert.deepEqual(out.frames[1].asset_ids, ['M2', 'V3'], 'the fallback is already in the frame: listed once');
  assert.equal(out.frames[1].shows![0].asset_id, 'V3');
  assert.equal(out.frames[2].motion, 'V22 slaps on; V4 stays', 'W12 is not read as W1');
  assert.equal(out.wishes, undefined, 'every wish resolved');
  assert.deepEqual(out.makes!.map((m) => m.id), ['M2', 'M4'], 'M3 was only a fallback and is no longer needed; M4 is kept as planned');
  assert.equal(plan.frames[0].asset_ids[0], 'W1', 'pure: the input plan is unchanged');

  const none = applyWishes(plan, new Map());
  assert.deepEqual(none.frames[2].asset_ids, ['M3', 'V1']);
  assert.ok(none.makes!.some((m) => m.id === 'M3'), 'a fallback make in use is kept');
  assert.deepEqual(none.makes!.find((m) => m.id === 'M3')!.from_assets, [], 'a make never traces itself when its wish falls back to it');
  assert.deepEqual(out.makes!.find((m) => m.id === 'M4')!.from_assets, ['V1']);
  const plain = { ...plan, wishes: [] };
  assert.equal(applyWishes(plain, new Map()), plain, 'no wishes: the plan as it is');
});

// ── Plan schema and validation ─────────────────────────────────────────────

test('plan schema: frames carry shows, the plan carries makes, and the composed treatments exist everywhere', () => {
  const schema = SUBMIT_PLAN_TOOL.input_schema as { properties: Record<string, { items?: { properties: Record<string, unknown> } }> };
  assert.ok(schema.properties.makes, 'makes');
  assert.ok(schema.properties.frames.items?.properties.shows, 'shows');
  assert.deepEqual(Object.keys(schema.properties.makes.items!.properties).sort(), ['brief', 'from_assets', 'id', 'kind', 'people', 'seed']);
  for (const t of ['tableau', 'collage']) {
    assert.ok((TREATMENTS as readonly string[]).includes(t), `schema ${t}`);
    assert.ok(frames.TREATMENTS.includes(t), `kit ${t}`);
  }
  assert.deepEqual([...MAKE_KINDS].sort(), ['collage', 'drawing', 'expression', 'setting']);
  const seen = inventoryForDirecting(INVENTORY);
  assert.equal(seen[0].anchor_for, 'Ada Founder');
});

function composedPlan(): DirectorPlan {
  return {
    frames: [
      frame(1, { treatment: 'tableau', asset_ids: ['M1', 'V2', 'V3'], shows: [{ person: 'Ada Founder', asset_id: 'V2', treatment: 'tableau' }, { person: 'Ben Rival', asset_id: 'V3', treatment: 'tableau' }] }),
      frame(2, { treatment: 'whiteboard', asset_ids: ['M2'], shows: [{ person: 'Ada Founder', asset_id: 'M2', treatment: 'whiteboard' }] }),
      close(3),
    ],
    makes: [
      { id: 'M1', kind: 'setting', brief: 'a dinner for two', people: ['Ada Founder', 'Ben Rival'], from_assets: [], seed: 'dinner-table' },
      { id: 'M2', kind: 'expression', brief: 'worried, hand on the forehead', people: ['Ada Founder'], from_assets: ['V1'], seed: null },
    ],
    lines_back: [],
  };
}

test('validatePlan: make ids count as assets; character images may be staged in a tableau; shows must name the frame\'s assets', () => {
  const d = draft(['Ada Founder and Ben Rival met.', 'Ada worried.']);
  // MD-127: a drawn setting under real cutouts mixes media; that is the only problem in the composed plan.
  const ok = validatePlan(composedPlan(), { draft: d, inventory: INVENTORY });
  assert.equal(ok.problems.length, 1, ok.problems.join('\n'));
  assert.match(ok.problems[0]!, /frame 1 mixes real material \(V2, V3\) with made material \(M1\)/);

  const bad = composedPlan();
  bad.frames[1].shows = [{ person: 'Ada Founder', asset_id: 'V9', treatment: 'whiteboard' }];
  bad.frames[1].asset_ids = ['M3'];
  const v = validatePlan(bad, { draft: d, inventory: INVENTORY });
  assert.ok(v.problems.some((p) => /M3, which is not in the inventory or the makes/.test(p)), v.problems.join('\n'));
  assert.ok(v.problems.some((p) => /shows Ada Founder as V9/.test(p)));
  assert.ok(v.problems.some((p) => /make M2 is used by no frame/.test(p)));

  const plain = composedPlan();
  delete plain.makes;
  plain.frames[0].asset_ids = ['V2'];
  plain.frames[0].shows = [];
  plain.frames[1] = frame(2, { treatment: 'page', asset_ids: ['V4'] });
  delete plain.frames[1].shows;
  assert.deepEqual(validatePlan(plain, { draft: d, inventory: INVENTORY }).problems, [], 'a plan without makes or shows still validates');
});

test('makeProblems: ids, kinds, seeds of the right kind, a picture to trace, the image-model cap', () => {
  const plan = { frames: [frame(1, { asset_ids: ['M1', 'M2', 'M3', 'M4'] })] };
  const p = makeProblems([
    { id: 'M1', kind: 'setting', brief: 'x', people: [], from_assets: [], seed: 'worry' },
    { id: 'M2', kind: 'expression', brief: 'x', people: ['Nobody Known'], from_assets: [], seed: null },
    { id: 'M3', kind: 'drawing', brief: '', people: [], from_assets: ['V99'], seed: null },
    { id: 'X4', kind: 'collage', brief: 'x', people: [], from_assets: [], seed: null },
  ] as MakeRequest[], plan, INVENTORY);
  assert.ok(p.some((x) => /M1's seed "worry" is not a seeded setting/.test(x)));
  assert.ok(p.some((x) => /M2 is an expression sketch with nothing to trace/.test(x)));
  assert.ok(p.some((x) => /M3 has no brief/.test(x)) && p.some((x) => /M3 builds from V99/.test(x)));
  assert.ok(p.some((x) => /"X4" needs an id/.test(x)));
  const many = Array.from({ length: MAX_GENERATED_MAKES + 1 }, (_, i) => ({ id: `M${i + 1}`, kind: 'drawing' as const, brief: 'a lamp', people: [], from_assets: [], seed: null }));
  const capped = makeProblems(many, { frames: [frame(1, { asset_ids: many.map((m) => m.id) })] }, INVENTORY);
  assert.ok(capped.some((x) => /at most 6 per reel/.test(x)));
  const seeded = many.map((m) => ({ ...m, kind: 'setting' as const, seed: 'boardroom' }));
  assert.deepEqual(makeProblems(seeded, { frames: [frame(1, { asset_ids: seeded.map((m) => m.id) })] }, INVENTORY), [], 'seeded makes are free');
  // A make may trace a wished person photo (applyWishes swaps in the find or the fallback), and that wish counts as used.
  const wishes = [{ id: 'W1', person: 'Nobody Known', want: 'a portrait', frame_ns: [1], fallback: 'V2' }];
  const fromWish = [{ id: 'M1', kind: 'expression' as const, brief: 'x', people: [], from_assets: ['W1'], seed: null }];
  const wished = { frames: [frame(1, { asset_ids: ['M1'] })], makes: fromWish, wishes };
  assert.deepEqual(makeProblems(fromWish, wished, INVENTORY), [], 'a make traces a wish');
  assert.ok(!wishProblems(wishes, wished, INVENTORY).some((x) => /W1 is used by no frame/.test(x)), 'a wish used by a make is used');
});

test('pruneCutLines keeps the makes the remaining frames use', () => {
  const d = draft(['Ada Founder and Ben Rival met.']);
  const pruned = pruneCutLines(composedPlan(), d);
  assert.deepEqual(pruned.makes?.map((m) => m.id), ['M1']);
});

// ── Seeded tools ────────────────────────────────────────────────────────────

test('seeds: every seed renders an SVG; settings keep their seats in frame and under a layer that exists', () => {
  assert.equal(SEED_CATALOG.filter((s) => s.kind === 'setting').length, 5);
  for (const s of SEED_CATALOG) {
    const out = seedSvg(s.id);
    assert.match(out.svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    assert.equal(seedKind(s.id), s.kind);
    assert.ok(!/<text\b/.test(out.svg), `${s.id} draws no text`);
  }
  for (const s of Object.values(SETTINGS)) {
    for (const seat of s.seats) {
      assert.ok(seat.x > 0 && seat.x < 1080 && seat.y > 600 && seat.y <= 1920, `${s.id}/${seat.id} in frame`);
      assert.ok(seat.y - seat.h >= 560, `${s.id}/${seat.id}: the head stays below the caption band`);
      assert.ok(seat.under < s.layers.length, `${s.id}/${seat.id} sits under a real layer`);
    }
  }
  for (const [kind, fn] of Object.entries(EXPRESSIONS)) assert.ok(fn({ x: 400, y: 800, w: 280, h: 360 }).every((p) => /^M/.test(p.d)), kind);
  assert.equal(seedKind('no-such-seed'), null);
});

// ── Makes ───────────────────────────────────────────────────────────────────

const PNG_1x1 = Buffer.from('89504e470d0a1a0a0000000d4948445200000400000004000806000000', 'hex');

function jobDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-make-'));
  fs.mkdirSync(path.join(dir, 'media'));
  for (const a of INVENTORY.assets) fs.writeFileSync(path.join(dir, a.file), 'x');
  return dir;
}

test('makeAssets: a seed is code-built and free; a traced expression uses the person\'s picture; assets keep the plan order', async () => {
  const dir = jobDir();
  const calls: { prompt: string; reference?: string; size: string }[] = [];
  const generate: GenerateImage = async (req) => {
    calls.push(req);
    return { png: PNG_1x1, usage: { textInputTokens: 10, imageInputTokens: 10, imageOutputTokens: 10, usd: 0.05 } };
  };
  const recorded: number[] = [];
  const out = await makeAssets({ plan: composedPlan(), inventory: INVENTORY, jobDir: dir, draft: draft(['a', 'b']) }, { generate, record: async (e) => { recorded.push(e.usd); } });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.assets.map((a) => [a.id, a.made, a.made_kind, a.file]), [['M1', true, 'setting', 'media/M1.svg'], ['M2', true, 'expression', 'media/M2.png']]);
  assert.ok(out.assets[0].flags.includes('seed:dinner-table'));
  assert.ok(fs.readFileSync(path.join(dir, 'media/M1.svg'), 'utf8').startsWith('<svg'));
  assert.equal(calls.length, 1, 'only the expression needs the image model');
  assert.equal(calls[0].reference, path.resolve(dir, 'media/V1.jpg'));
  assert.match(calls[0].prompt, /worried, hand on the forehead/);
  assert.match(calls[0].prompt, /never as a photograph/);
  assert.equal(out.usd, 0.05);
  assert.deepEqual(recorded, [0.05]);
  assert.equal(out.assets[1].width, 1024);
  assert.match(out.assets[1].shows, /not a photograph/);
});

test('makeAssets fails open per request: a generator error, nothing to trace, an over-budget make', async () => {
  const dir = jobDir();
  const plan: DirectorPlan = {
    frames: [frame(1, { asset_ids: ['M1', 'M2', 'M3'] }), close(2)],
    makes: [
      { id: 'M1', kind: 'drawing', brief: 'a server rack', people: [], from_assets: [], seed: null },
      { id: 'M2', kind: 'expression', brief: 'angry', people: ['Nobody Known'], from_assets: [], seed: null },
      { id: 'M3', kind: 'setting', brief: 'a garage', people: [], from_assets: [], seed: null },
    ],
    lines_back: [],
  };
  const generate: GenerateImage = async ({ prompt }) => {
    if (/server rack/.test(prompt)) throw new Error('boom');
    return { png: PNG_1x1, usage: { textInputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0, usd: 0.07 } };
  };
  const out = await makeAssets({ plan, inventory: INVENTORY, jobDir: dir, draft: draft(['a']) }, { generate, maxUsd: 0.2 });
  assert.deepEqual(out.assets.map((a) => a.id), ['M3']);
  assert.equal(out.problems.length, 2);
  assert.ok(out.problems.some((p) => /M1 \(drawing\) was not made: boom/.test(p)));
  assert.ok(out.problems.some((p) => /M2 \(expression\) was not made: no picture of the person to trace/.test(p)));

  const tight = await makeAssets({ plan: { ...plan, makes: [plan.makes![2], { ...plan.makes![2], id: 'M4' }] }, inventory: INVENTORY, jobDir: dir, draft: draft(['a']) }, { generate, maxUsd: 0.1 });
  assert.equal(tight.assets.length, 1);
  assert.ok(tight.problems.some((p) => /over the make budget/.test(p)));
});

test('referenceFor and makePrompt: anchor first after from_assets; every prompt keeps it drawn and wordless', () => {
  const m: MakeRequest = { id: 'M1', kind: 'expression', brief: 'shocked', people: ['Ben Rival'], from_assets: [], seed: null };
  assert.equal(referenceFor(m, INVENTORY)?.id, 'V3');
  assert.equal(referenceFor({ ...m, from_assets: ['V5', 'V2'] }, INVENTORY)?.id, 'V2', 'a logo is never traced as the person');
  assert.equal(referenceFor({ ...m, kind: 'drawing', people: [] }, INVENTORY), null);
  for (const kind of MAKE_KINDS) {
    const p = makePrompt({ ...m, kind }, true);
    assert.match(p, /No (real people, no faces, no )?text|no text|No text/i, kind);
    assert.match(p, /never (as )?a photograph/i, kind);
  }
});

test('planWithoutFailedMakes: frames go back to existing assets and a treatment that still fits them', () => {
  const plan = composedPlan();
  plan.makes![0] = { ...plan.makes![0], seed: null };
  const { plan: out, notes } = planWithoutFailedMakes(plan, [], INVENTORY);
  assert.equal(out.frames[0].treatment, 'collision', 'a tableau that lost its setting with two cutouts is a collision');
  assert.deepEqual(out.frames[0].asset_ids, ['V2', 'V3']);
  assert.deepEqual(out.frames[1].asset_ids, ['V1'], 'the expression falls back to the picture it traced');
  assert.deepEqual(out.frames[1].shows, [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'whiteboard' }]);
  assert.deepEqual(out.makes, []);
  assert.equal(notes.length, 2);
  assert.deepEqual(planWithoutFailedMakes(plan, ['M1', 'M2'], INVENTORY).notes, [], 'nothing failed, nothing changes');
});

// ── Storyboard ──────────────────────────────────────────────────────────────

test('STORYBOARD.md prints each frame\'s shows and makes', () => {
  const plan = composedPlan();
  const f = { ...plan.frames[1], id: '02-f2' };
  assert.equal(frameShows(f), 'Ada Founder = M2 (whiteboard)');
  assert.equal(frameMakes(f, plan.makes), 'M2 = expression, from V1, of Ada Founder: worried, hand on the forehead');
  const md = storyboardMarkdown(draft(['a', 'b']), plan.frames.map((x, i) => ({ ...x, id: `0${i + 1}-f` })), plan.makes);
  assert.match(md, /- shows: Ada Founder = V2 \(tableau\); Ben Rival = V3 \(tableau\)/);
  assert.match(md, /- makes: M1 = setting, seed dinner-table, of Ada Founder and Ben Rival: a dinner for two/);
  const parsed = frames.parseFrames(md);
  assert.equal(parsed[0].fields.makes.startsWith('M1 = setting'), true);
});

// ── Kit builders (DOM) ──────────────────────────────────────────────────────

test('tableau, collage, drawn layers and expression marks build in a DOM and render deterministically', async () => {
  const { JSDOM } = await import('jsdom');
  const nk = await import('@/explainers/reel-ai-drama/kit/components/index.js');
  const builds: Record<string, (d: Document) => { el: Element; render: (t: number) => void }> = {
    tableau: (d) => nk.tableau(d, { setting: 'dinner-table', cast: [{ media: { file: 'media/V2.png' }, seat: 'left' }, { src: 'media/V3.png', seat: 'right', enter: { at: [1, 1.6], from: 'right' } }], duration: 6 }),
    'tableau-made': (d) => nk.tableau(d, { setting: { file: 'media/M3.png' }, seats: [{ id: 'a', x: 300, y: 1500, h: 700 }], cast: [{ src: 'media/V2.png', seat: 'a' }], duration: 6 }),
    'tableau-stage': (d) => nk.tableau(d, { setting: 'stage', cast: [{ src: 'media/V2.png', seat: 'podium' }], screen: { src: 'media/V5.png', on: 'main', at: 1 } }),
    collage: (d) => nk.collage(d, { layers: [{ seed: 'torn-paper', x: 90, y: 700, w: 900 }, { src: 'media/V1.jpg', x: 200, y: 800, w: 600, halftone: true, torn: true, rot: -3, at: 1 }, { seed: 'tape', x: 400, y: 780, w: 200, at: 1.2 }], duration: 6 }),
    drawn: (d) => nk.drawn(d, { src: 'media/M2.png', at: [0.5, 1.5] }),
    marks: (d) => nk.expressionMarks(d, { kind: 'worry', face: { x: 400, y: 800, w: 280, h: 360 }, at: 0.5 }) as unknown as { el: Element; render: (t: number) => void },
  };
  for (const [name, build] of Object.entries(builds)) {
    const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
    const doc = window.document as unknown as Document;
    nk.installKit(doc, { fonts: 'assets/fonts/' });
    const r = build(doc);
    doc.getElementById('w')!.append(r.el);
    const snap = (t: number) => { r.render(t); return doc.getElementById('w')!.innerHTML; };
    for (const t of [0, 1.3, 3, 5.9]) {
      const a = snap(t);
      snap(6);
      snap(0.05);
      assert.equal(snap(t), a, `${name} at ${t}s is a pure function of t`);
    }
  }
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const t = nk.tableau(window.document as unknown as Document, { setting: 'dinner-table', cast: [{ src: 'a.png', seat: 'left', enter: { at: [1, 1.6], from: 'left' } }] });
  t.render(0.5);
  assert.equal(t.figures[0].box.style.visibility, 'hidden', 'a figure is hidden before its entrance');
  t.render(2);
  assert.equal(t.figures[0].box.style.visibility, '');
  assert.equal(typeof nk.TREATMENT_BUILDERS.tableau, 'function');
  assert.equal(typeof nk.TREATMENT_BUILDERS.collage, 'function');
});

test('MD-126: a dropped label never reaches the frame', async () => {
  const { frameLines } = await import('@/explainers/reel-ai-drama/kit/project-files.mjs');
  const lines = new Map([['L2', { id: 'L2', text: 'two words', on_screen: 'A label', pause_after: null }], ['L3', { id: 'L3', text: 'three more words', on_screen: 'Kept', pause_after: null }]]);
  const out = frameLines({ treatment: 'photo', line_ids: ['L2', 'L3'], drop_labels: ['L2'] }, lines);
  assert.deepEqual(out.map((l: { label: string | null }) => l.label), [null, 'Kept']);
});
