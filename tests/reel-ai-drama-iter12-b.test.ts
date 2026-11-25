import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { combineDrama, dramaState, DRAMA_SET } from '@/lib/reel-ai-drama/development/scores';
import { validatePitch } from '@/lib/reel-ai-drama/development/producer';
import { cutLines } from '@/lib/reel-ai-drama/production/draft';
import { loadPrompt, writerSystem } from '@/lib/reel-ai-drama/prompts';
import { withKnownNames } from '@/lib/reel-ai-drama/reporting/validate';
import type { CastMember, DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { scriptForEditor, storyEditUserMessage } from '@/lib/reel-ai-drama/writing/story-editor';
import {
  applyRevision,
  FIRST_LINE_MAX_WORDS,
  knownToViewer,
  newNamesSaid,
  NEW_NAMES_MAX,
  scriptWarnings,
  validateDraft,
  validatePlan,
} from '@/lib/reel-ai-drama/writing/validate';
import { namesForWriting, writeScript, writerUserMessage, type WritingDeps } from '@/lib/reel-ai-drama/writing/writer';

/** The three reels' stored pitch, facts and final draft (fact text trimmed; read once from the local database). */
const stored = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/reel-ai-drama-iter12-stored.json'), 'utf8')) as {
  job: string;
  pitch: Pitch;
  draft: WriterDraft;
  facts: FactSheet;
}[];

const limits = { max_seconds: 80, rung_max_seconds: 9, target_seconds: 60, words_per_minute_target: 180 };

const inventoryFor = (draft: WriterDraft): VisualsInventory =>
  ({ assets: draft.rungs.flatMap((r) => r.lines).flatMap((l) => (l.must_show && /^V\d+$/.test(l.must_show) ? [{ id: l.must_show, kind: 'photo', flags: [], character_image: false, shows: '', people: [] }] : [])) }) as unknown as VisualsInventory;

/** Stubbed model: answers `submit_script` with each input in turn; records what it was told. */
function stubDeps(outputs: unknown[]) {
  const seen: { user: unknown[] }[] = [];
  const create = (async (params: { messages: { content: unknown }[]; tools: { name: string }[] }) => {
    seen.push({ user: params.messages.map((m) => m.content) });
    const input = outputs[Math.min(seen.length - 1, outputs.length - 1)];
    return {
      id: 'm',
      model: 'stub',
      role: 'assistant',
      type: 'message',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: `t${seen.length}`, name: params.tools.at(-1)!.name, input }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }) as unknown as WritingDeps['create'];
  const db = { query: async () => ({ rows: [], rowCount: 0 }) };
  return { deps: { create, db, jobId: null, mode: 'test' } as unknown as WritingDeps, seen };
}

const person = (name: string, extra: Partial<CastMember> = {}): CastMember => ({ name, role: 'x', kind: 'person', player_id: null, ...extra });

const shortDraft = (first = 'He told them no.'): WriterDraft =>
  ({
    title: 't',
    hook: { line_id: 'L1' },
    rungs: Array.from({ length: 7 }, (_, i) => ({
      id: `R${i + 1}`,
      purpose: 'p',
      lines: [{ id: `L${i + 1}`, text: i === 0 ? first : Array(20).fill('word').join(' '), on_screen: null, fact_ids: [], must_show: null, pause_after: null }],
    })),
    peak_rung_id: 'R2',
    landing_rung_id: 'R7',
    close_question: 'Who was right?',
    central: [],
    pronounce: [],
  }) as unknown as WriterDraft;

const noFacts = { facts: [], quotes: [], artifacts: [], sources: [], cast: [] } as unknown as FactSheet;

test('the three stored scripts have long first lines and at least one crowd of names, and neither blocks', async () => {
  assert.equal(stored.length, 3);
  for (const r of stored) {
    const inventory = inventoryFor(r.draft);
    const { deps, seen } = stubDeps([r.draft, r.draft]);
    const value = await writeScript(deps, { pitch: r.pitch, facts: r.facts, inventory, settings: { ...limits, writer_model: 'stub' } as never });
    assert.equal(seen.length, 2, `${r.job}: one fix round, then it ships`);
    assert.deepEqual(value.hook, { line_id: 'L1' }, 'a saved draft\'s hook words load and stop there');
    assert.equal(value.rungs[0]!.lines[0]!.on_screen, null, 'L1 has no label');
    assert.ok(value.rungs.flatMap((x) => x.lines).every((l) => l.on_screen_kind === null), 'no date mark survives');
    assert.ok(scriptWarnings(value, r.facts).some((w) => w.includes('the first line')), 'still long: flagged on delivery');
    // The first attempt was asked to fix it, in plain words.
    assert.match(JSON.stringify(seen[1]!.user), new RegExp(`at most ${FIRST_LINE_MAX_WORDS}`));
  }
});

test('a fresh short script on each reel\'s stored inputs passes first time', async () => {
  for (const r of stored) {
    const fresh = shortDraft();
    const { deps, seen } = stubDeps([fresh]);
    const value = await writeScript(deps, { pitch: r.pitch, facts: { ...r.facts, cast: [] }, inventory: inventoryFor(fresh), settings: { ...limits, writer_model: 'stub' } as never });
    assert.equal(seen.length, 1);
    assert.deepEqual(value.hook, { line_id: 'L1' });
  }
});

test('the conservative exemption on the three reels, checked by hand: famous people only through the stored flag', () => {
  const redmond = stored.find((r) => r.facts.cast.some((c) => c.name === 'Geoffrey Hinton'))!;
  const said = newNamesSaid(redmond.draft.rungs.flatMap((r) => r.lines), redmond.facts.cast);
  assert.ok(said.includes('Geoffrey Hinton') && said.length > NEW_NAMES_MAX, `Redmond spends too many names: ${said.join(', ')}`);
  assert.ok(scriptWarnings(redmond.draft, redmond.facts).some((w) => w.includes('must 6')));

  const siri = stored.find((r) => r.facts.cast.some((c) => c.name === 'Steve Jobs'))!;
  const flagged = withKnownNames(siri.facts, { cast: [person('Steve Jobs', { widely_known: true })] });
  assert.ok(knownToViewer(flagged.cast.find((c) => c.name === 'Steve Jobs')!));
  assert.ok(!newNamesSaid(siri.draft.rungs.flatMap((r) => r.lines), flagged.cast).includes('Steve Jobs'));
  assert.ok(newNamesSaid(siri.draft.rungs.flatMap((r) => r.lines), siri.facts.cast).includes('Steve Jobs'), 'unflagged is not exempt');
});

test('knownToViewer: the list, the flag, and nothing else', () => {
  assert.ok(knownToViewer(person('Tim Cook')), 'a listed person, by name');
  assert.ok(knownToViewer({ name: 'Siri', kind: 'product', player_id: null }), 'a listed company\'s product');
  assert.ok(knownToViewer({ name: 'Microsoft', kind: 'company', player_id: 'microsoft' }));
  assert.ok(!knownToViewer(person('Kimbal Musk')), 'a surname from the list is not the listed person');
  assert.ok(!knownToViewer(person('A Stranger')));
  assert.ok(!knownToViewer(person('A Stranger', { widely_known: false })));
  assert.deepEqual(namesForWriting([person('Tim Cook'), person('A Stranger')] as FactSheet['cast']), { known: ['Tim Cook'], new: ['A Stranger'] });
});

test('selection: widely_known is stored on the pitch only on a clear yes; reporting carries it and adds no opinion', () => {
  const base = {
    title: 'T',
    brief: 'word '.repeat(150),
    story_type: 'deal',
    era: 'origins',
    event_date: '2010-02-01',
    date_precision: 'month',
    why_now: null,
    typicality: 0.2,
    expected_visuals: [{ kind: 'person_photo', what: 'x', hint: 'y' }],
    sources: [{ url: 'https://example.com/a', title: 'a', publisher: 'p', date: null }],
  };
  const cast = [
    { name: 'Famous One', role: 'x', kind: 'person', player_id: null, widely_known: true },
    { name: 'Quiet One', role: 'x', kind: 'person', player_id: null, widely_known: 'yes' },
    { name: 'Older One', role: 'x', kind: 'person', player_id: null },
  ];
  const parsed = validatePitch({ ...base, cast }, { today: '2026-11-06' });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  if (!parsed.ok) return;
  assert.deepEqual(parsed.pitch.cast.map((c) => c.widely_known), [true, false, false]);
  const sheet = withKnownNames({ cast: [person('F. One', { widely_known: false }), person('Famous One'), person('Added By Reporter', { widely_known: true })] } as unknown as FactSheet, parsed.pitch);
  assert.deepEqual(sheet.cast.map((c) => c.widely_known), [true, true, false], 'the reporter never decides');
});

test('selection scores the players as a gate; older answers without it still combine', () => {
  const all = { central_want: { score: 4 }, opposition: { score: 4 }, bounded_episode: { score: 4 }, stakes: { score: 4 }, scene: { score: 4 }, turn: { score: 4 }, implication: { score: 4 } };
  assert.equal(combineDrama(all).score, 1);
  assert.equal(combineDrama({ ...all, players: { score: 3 } }).score, 1);
  const relay = combineDrama({ ...all, players: { score: 1 } });
  assert.equal(relay.score, 0.45);
  assert.match(relay.notes.cap!, /players/);
  assert.ok('players' in DRAMA_SET.questions);
  const state = dramaState({ title: 't', cast: [person('Tim Cook'), person('A Stranger')], event_date: '2010-01-01', story_type: 'deal', era: 'origins', why_now: null, brief: 'b' } as unknown as Pitch);
  assert.deepEqual(state.cast.map((c) => c.known), [true, false]);
});

test('validate: no hook words are needed anywhere, and the first line stays one soft fix', () => {
  const ok = validateDraft(shortDraft(), { facts: noFacts, inventory: null, limits });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.soft, []);
  const long = validateDraft(shortDraft(Array(FIRST_LINE_MAX_WORDS + 1).fill('word').join(' ')), { facts: noFacts, inventory: null, limits });
  assert.deepEqual(long.problems, [], 'never a hard problem');
  assert.equal(long.soft!.length, 1);
  assert.equal(validateDraft(shortDraft(Array(FIRST_LINE_MAX_WORDS).fill('word').join(' ')), { facts: noFacts, inventory: null, limits }).soft!.length, 0);
});

test('a revision answers only for what it changes', () => {
  const longFirst = shortDraft(Array(20).fill('word').join(' '));
  const keep = applyRevision(longFirst, [{ line_id: 'L2', cut: false, text: 'New words here.', on_screen: null, fact_ids: [], must_show: null }], { notedLineIds: ['L2'], facts: noFacts, inventory: null, limits });
  assert.ok(keep.value);
  assert.deepEqual(keep.soft, [], 'a saved long L1 is not this round\'s problem');
  const rewrite = applyRevision(shortDraft(), [{ line_id: 'L1', cut: false, text: Array(20).fill('word').join(' '), on_screen: 'Some label', fact_ids: [], must_show: null }], { notedLineIds: ['L1'], facts: noFacts, inventory: null, limits }, { hook_on_screen: 'stale words' } as never);
  assert.equal(rewrite.soft!.length, 1, 'a rewritten L1 keeps to the limit');
  assert.deepEqual(rewrite.value!.hook, { line_id: 'L1' });
  assert.equal(rewrite.value!.rungs[0]!.lines[0]!.on_screen, null);
});

test('a cut first line hands the hook on with no words', () => {
  const cut = cutLines({ ...shortDraft(), hook: { line_id: 'L1', on_screen: 'old words' } }, ['L1']);
  assert.deepEqual(cut.hook, { line_id: 'L2' });
});

test('plan validation asks for no hook words, and a stray title cannot pass', () => {
  const draft = { ...shortDraft(), hook: { line_id: 'L1', on_screen: 'saved hook words' } };
  const frame = (n: number, line: string, on_screen: string | null) => ({
    n,
    name: `f${n}`,
    line_ids: [line],
    treatment: 'photo',
    asset_ids: [],
    purpose: 'p',
    music: n === 1 ? 'start' : 'hold',
    on_screen,
    focus: { kind: 'object', what: 'x' },
    blueprint: n === 1 ? { hook: { text: 'saved hook words', on: '' } } : undefined,
  });
  const plan = { frames: [frame(1, 'L1', 'saved hook words')], makes: [], wishes: [], lines_back: [] } as unknown as DirectorPlan;
  const checked = validatePlan(plan, { draft, inventory: { assets: [] } as unknown as VisualsInventory, limits } as never);
  const problems = checked.problems.join(' | ');
  assert.doesNotMatch(problems, /must show the hook's words/);
  assert.match(problems, /are not the script's: use a line's on_screen label exactly, or null/, 'a frame title is not the script\'s');
  assert.equal(plan.frames[0]!.blueprint?.hook, undefined);
  const noWords = validatePlan({ ...plan, frames: [{ ...plan.frames[0]!, on_screen: null }] } as DirectorPlan, { draft, inventory: { assets: [] } as unknown as VisualsInventory, limits } as never);
  assert.doesNotMatch(noWords.problems.join(' | '), /hook/i);
});

test('story editor: reads no hook words, and learns only which names are known', () => {
  const draft = { ...shortDraft(), hook: { line_id: 'L1', on_screen: 'saved hook words' } } as WriterDraft;
  assert.doesNotMatch(scriptForEditor(draft), /saved hook words/);
  const user = storyEditUserMessage({ draft, cast: [person('Tim Cook'), person('A Stranger')] as FactSheet['cast'] });
  assert.match(user, /Names the viewer already knows/);
  assert.match(user, /Tim Cook/);
  assert.doesNotMatch(user, /A Stranger/);
  assert.doesNotMatch(storyEditUserMessage({ draft }), /already knows/);
});

test('prompts: the limits match code, no name examples, no hook words left', () => {
  const principles = writerSystem('writer').split('---').at(-1)!;
  assert.match(principles, new RegExp(`at most ${FIRST_LINE_MAX_WORDS} spoken words`));
  const files = ['producer', 'reporting', 'writer', 'writer-revise', 'story-editor', 'first-viewer'].map((p) => [p, loadPrompt(p as never)] as const);
  const all = [...files, ['principles', principles] as const];
  for (const [name, text] of all) {
    assert.doesNotMatch(text, /\b(Jobs|Hinton|Dell|Siri|Chrome|Kittlaus|Deng|Pichai)\b/, `${name} names a test reel`);
    assert.doesNotMatch(text, /hook's on-screen|hook_on_screen|on_screen_kind|label is the date/, `${name} still asks for hook words or a date label`);
  }
  assert.match(loadPrompt('producer'), /`widely_known`/);
  assert.match(writerSystem('writer'), /\*\*The names\*\*/);
  const user = writerUserMessage({ pitch: stored[0]!.pitch, facts: stored[0]!.facts, inventory: { assets: [] } as unknown as VisualsInventory, settings: limits as never });
  assert.match(user, /The names/);
});

test('validate has no hook-words rule left, and labelKind is gone', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/reel-ai-drama/writing/validate.ts'), 'utf8');
  assert.doesNotMatch(src, /hook\.on_screen|hook_on_screen|HOOK_ON_SCREEN|labelKind|isFirst/);
});
