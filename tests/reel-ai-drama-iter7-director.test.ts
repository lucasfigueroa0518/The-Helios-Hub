import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusShareFindings, OTHER_FOCUS_MAX, PERSON_FOCUS_MAX, varietyFindings } from '@/lib/reel-ai-drama/checks/variety';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, FactSheet, FocusKind, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { applyRevision, mediumProblems, validateDraft, validatePlan } from '@/lib/reel-ai-drama/writing/validate';

/** Iteration 7, owner 1 (the director): focus (MD-131), one medium per frame (MD-127), date labels (MD-130). Stubbed, no API. */

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: null, source_page: null, credit: 'c', license: null, shows: 'a photo', people: [], qids: [],
    place: null, date_taken: null, date_confidence: 'unknown', width: 1000, height: 1000, phash: null, character_image: false, made: false,
    upscaled: false, flags: [], ...over,
  };
}

const INVENTORY: VisualsInventory = {
  assets: [
    asset('V1', { people: ['Ada Founder'] }),
    asset('V2', { kind: 'place_photo', shows: 'a dining room' }),
    asset('V3', { kind: 'map', made: true, shows: 'a map with a pin' }),
    asset('V4', { kind: 'person_photo', made: true, made_kind: 'sketch', shows: 'a line sketch of Ada', people: ['Ada Founder'] }),
    asset('V5', { kind: 'logo', flags: ['logo'] }),
  ],
  usable_count: 5, counts: {}, kill: null, usd: 0,
};

const FACTS = { facts: [], quotes: [], artifacts: [], cast: [] } as unknown as FactSheet;

function draft(labels: (string | null)[], kinds: ('date' | null | undefined)[] = []): WriterDraft {
  return {
    title: 'T', hook: { line_id: 'L1' },
    rungs: [{ id: 'R1', purpose: 'p', lines: labels.map((on_screen, i) => ({ id: `L${i + 1}`, text: `line ${i + 1}`, on_screen, ...(kinds[i] !== undefined ? { on_screen_kind: kinds[i] } : {}), fact_ids: [], must_show: null })) }],
    peak_rung_id: 'R1', landing_rung_id: 'R1', close_question: 'Would you?', word_count: 0, central: [],
  };
}

function frame(n: number, kind: FocusKind | null, over: Partial<StoryboardFrame> = {}): StoryboardFrame {
  return {
    n, name: `f${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: ['V2'], purpose: 'p', motion: 'push', marks: '', sound: '', music: n === 1 ? 'start' : 'hold',
    on_screen: null, shows: [], ...(kind ? { focus: { kind, what: 'what the eye lands on' } } : {}), ...over,
  };
}
const close = (n: number): StoryboardFrame => ({ n, name: 'close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'close', motion: '', marks: '', sound: '', music: 'end', on_screen: null });

// ── Focus (MD-131) ──────────────────────────────────────────────────────────

test('focus: every story frame names a known kind and what it is; the close is set to null', () => {
  const d = draft([null, null, null]);
  const plan = (): DirectorPlan => ({ frames: [frame(1, 'place'), frame(2, 'logo', { asset_ids: ['V5'] }), frame(3, 'object'), { ...close(4), focus: { kind: 'person', what: 'x' } }], lines_back: [] });
  const ok = validatePlan(plan(), { draft: d, inventory: INVENTORY });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.value!.frames[3]!.focus, null);

  const missing = plan();
  delete missing.frames[1]!.focus;
  assert.ok(validatePlan(missing, { draft: d, inventory: INVENTORY }).problems.some((p) => /frame 2 needs a focus/.test(p)));
  const badKind = plan();
  badKind.frames[0]!.focus = { kind: 'face' as FocusKind, what: 'her face' };
  assert.ok(validatePlan(badKind, { draft: d, inventory: INVENTORY }).problems.some((p) => /frame 1 needs a focus .*person, place, object, logo, document, number, animation/.test(p)));
  const noWhat = plan();
  noWhat.frames[2]!.focus = { kind: 'object', what: ' ' };
  assert.ok(validatePlan(noWhat, { draft: d, inventory: INVENTORY }).problems.some((p) => /frame 3's focus says no what/.test(p)));
});

test('focus shares: person-focused frames up to 65% of the story frames, any other kind up to 50%; the close and unfocused frames are left out', () => {
  assert.equal(PERSON_FOCUS_MAX, 0.65);
  assert.equal(OTHER_FOCUS_MAX, 0.5);
  const plan = (people: number, places: number, others: number) => {
    const kinds: FocusKind[] = [...Array(people).fill('person'), ...Array(places).fill('place'), ...Array(others).fill('object')];
    return [...kinds.map((k, i) => frame(i + 1, k)), frame(kinds.length + 1, null), close(kinds.length + 2)];
  };
  assert.deepEqual(focusShareFindings(plan(13, 4, 3)), [], '13 of 20 person-focused is 65%: allowed');
  const over = focusShareFindings(plan(14, 3, 3));
  assert.equal(over.length, 1);
  assert.equal(over[0]!.id, 'focus_share');
  assert.equal(over[0]!.frame, 14, 'named on the first frame past the limit');
  assert.match(over[0]!.why, /14 of the 20 story frames focus on a person .*at most 13 .*re-focus at least 1/);

  assert.deepEqual(focusShareFindings(plan(5, 10, 5)), [], '10 of 20 place-focused is 50%: allowed');
  const places = focusShareFindings(plan(5, 11, 4));
  assert.equal(places.length, 1);
  assert.match(places[0]!.why, /11 of the 20 story frames focus on a place .*at most 10/);
  assert.doesNotMatch(places[0]!.why, /\(a place,/, 'the suggestions leave out the kind that is over');

  assert.deepEqual(focusShareFindings([frame(1, 'person'), close(2)]), [], 'a one-frame plan is never held to a share it cannot meet');
  assert.deepEqual(focusShareFindings([frame(1, null), frame(2, null), close(3)]), [], 'plans saved before iteration 7 carry no focus');

  const viaVariety = varietyFindings({ frames: plan(14, 3, 3) }).filter((f) => f.id === 'focus_share');
  assert.equal(viaVariety.length, 1, 'the variety check carries it to the existing director variety fix');
});

// ── One medium per frame (MD-127) ───────────────────────────────────────────

test('medium: a frame mixing real material with made material is a plan problem; maps, seeded paper layers and the kit marks are neither', () => {
  const setting = { id: 'M1', kind: 'setting' as const, brief: 'a dining room', people: [], from_assets: [], seed: null };
  const tape = { id: 'M2', kind: 'collage' as const, brief: 'tape', people: [], from_assets: [], seed: 'tape' };
  const drawing = { id: 'M3', kind: 'drawing' as const, brief: 'a server rack', people: [], from_assets: [], seed: null };
  const check = (frames: StoryboardFrame[], extra: Partial<DirectorPlan> = {}) => mediumProblems({ frames: [...frames, close(frames.length + 1)], makes: [setting, tape, drawing], ...extra }, INVENTORY);

  assert.match(check([frame(1, 'person', { treatment: 'tableau', asset_ids: ['M1', 'V1'] })])[0]!, /frame 1 mixes real material \(V1\) with made material \(M1\)/);
  assert.match(check([frame(1, 'person', { treatment: 'whiteboard', asset_ids: ['V1'] })])[0]!, /made material \(the whiteboard\)/);
  assert.match(check([frame(1, 'person', { treatment: 'collage', asset_ids: ['V1', 'V4'] })])[0]!, /real material \(V1\) with made material \(V4\)/, 'a banked sketch is made');
  assert.deepEqual(check([frame(1, 'place', { treatment: 'collage', asset_ids: ['V2', 'V1', 'V5', 'M2'] })]), [], 'real photos, a logo and a seeded paper layer');
  assert.deepEqual(check([frame(1, 'place', { treatment: 'map', asset_ids: ['V3', 'V1'] })]), [], 'a map carries a fact');
  assert.deepEqual(check([frame(1, 'object', { treatment: 'whiteboard', asset_ids: ['M3', 'V4'] })]), [], 'all made');
  assert.deepEqual(check([frame(1, 'number', { treatment: 'stat', asset_ids: [] })]), [], 'a code-built stat has no material');

  const wished = (fallback: string) => check([frame(1, 'place', { treatment: 'tableau', asset_ids: ['W1', 'V1'] })], { wishes: [{ id: 'W1', person: null, want: 'a real dinner table from above', cut_out: true, frame_ns: [1], fallback }] });
  assert.deepEqual(wished('V2'), [], 'a wish is real, and so is its fallback');
  assert.match(wished('M1')[0]!, /frame 1 would mix media if the search finds nothing: with W1's fallback M1/);
});

test('medium and cut_out reach validatePlan: the problem is reported, and a wish reads cut_out as false unless it says true', () => {
  const d = draft([null, null]);
  const plan: DirectorPlan = {
    frames: [frame(1, 'object', { treatment: 'tableau', asset_ids: ['W1', 'W2', 'V1'] }), frame(2, 'person', { treatment: 'whiteboard', asset_ids: ['V1'] }), close(3)],
    wishes: [
      { id: 'W1', person: null, want: 'a real dinner table', cut_out: true, frame_ns: [1], fallback: 'V2' },
      { id: 'W2', person: null, want: 'a real overhead lamp', frame_ns: [1], fallback: 'V2' },
    ],
    lines_back: [],
  };
  const v = validatePlan(plan, { draft: d, inventory: INVENTORY });
  assert.deepEqual(v.problems.filter((p) => /mix/.test(p)).map((p) => p.slice(0, 7)), ['frame 2']);
  assert.deepEqual(v.value!.wishes!.map((w) => w.cut_out), [true, false]);
});

// ── Date labels (MD-130) ────────────────────────────────────────────────────

test('iteration 12: no line carries a date mark, and the first line has no label', () => {
  const v = validateDraft(draft(['February 2010', 'Jan 2019', 'Spring 2020'], ['date', 'date', null]), { facts: FACTS, inventory: INVENTORY, limits: DEFAULT_SETTINGS });
  assert.deepEqual(v.value!.rungs[0]!.lines.map((l) => l.on_screen_kind), [null, null, null]);
  assert.deepEqual(v.value!.rungs[0]!.lines.map((l) => l.on_screen), [null, 'Jan 2019', 'Spring 2020']);
});

test('cut_out: a cut-out wish may only sit in frames that stage cutouts', async () => {
  const { wishProblems } = await import('@/lib/reel-ai-drama/writing/validate');
  const wish = { id: 'W1', person: null, want: 'a real dinner table', cut_out: true, frame_ns: [1, 2], fallback: 'V1' };
  const plan = (t2: string) => ({ frames: [frame(1, 'object', { treatment: 'tableau', asset_ids: ['W1'] }), frame(2, 'object', { treatment: t2, asset_ids: ['W1'] })], makes: [] });
  assert.ok(wishProblems([wish], plan('photo'), INVENTORY).some((p) => /W1 is cut out.*frame 2 \(photo\)/.test(p)));
  assert.ok(!wishProblems([wish], plan('collage'), INVENTORY).some((p) => /cut out/.test(p)));
  assert.ok(!wishProblems([{ ...wish, cut_out: false }], plan('photo'), INVENTORY).some((p) => /cut out/.test(p)));
});
