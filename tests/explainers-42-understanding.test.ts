/**
 * Explainers 4.2 pipeline pieces, offline: the understanding test's reel test, readers, Jev checklist
 * and evidence rule (models and Jev stubbed), the warnings format, try.mjs's leftovers as warnings, the
 * least-bad analogy and gap (fail open), the gap writer back on v2, and the spend meter's direct
 * charges. No model, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { leastBadAnalogy } from '@/lib/explainers/ideas/analogy';
import { gapCheckProblems, leastBadGap } from '@/lib/explainers/ideas/gap';
import { GAP_WRITER_VERSION, GAPS_PER_TOPIC } from '@/lib/explainers/ideas/generator';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { assetRows, pictureCheckPrompt, pictureFailures, pictureFixPrompt, tryViolations, understandingWarnings, MINOR_WARNINGS_MAX } from '@/lib/explainers/render/job';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { checkToolCall } from '@/lib/explainers/render/policy';
import {
  anchorEntities,
  applyDiagnosis,
  diagnoserParams,
  findingsJson,
  judgeReader,
  mergeFindings,
  parseAnswerKey,
  parseDiagnosis,
  parseReaderAnswers,
  quoteBeat,
  PERSONA_LINES,
  READER_INSTRUCTIONS,
  READER_SCHEMA,
  readerLead,
  readerParams,
  agentUnderstandingModel,
  textJson,
  reelTestMarkdown,
  replaceTerm,
  standInWord,
  STAND_IN_WORDS,
  unStandIn,
  viewerNouns,
  viewerSceneLine,
  type AnswerKey,
  type ProbeAnswer,
  type ReaderAnswers,
  type SeriousFinding,
} from '@/lib/explainers/render/understanding';
import type { AnalogyNote, GapNote } from '@/lib/explainers/types';
import { asReelWarning, groupWarnings, isReelWarning, reelWarnings, warningsSummary, warningText } from '@/lib/explainers/warnings';

// ── The reel test, built by code ──────────────────────────────────────────────────────────

const BOARD = [
  '---',
  'term: cache',
  '---',
  '',
  '## Visual arc',
  '- throughline: the fridge saves the trip',
  '',
  '## Anchor scene',
  '- entities:',
  '  - fridge — a kitchen fridge — stands for the cache — soft 3D — beats 1, 4',
  '',
  '## Frame 1 — Opener',
  '- look: world',
  '- scene: A critter opens a fridge (the cache) and grabs milk',
  '- shots: medium — the critter at the fridge — at 0s — angle: eye level — why: the hook',
  '- voiceover: "In the next minute, this fridge will teach you a tech concept."',
  '',
  '## Frame 2 — Gap',
  '- look: mechanism',
  '- scene: A phone loads a page twice; the second time it is instant',
  '- shots:',
  '  - close — the phone — on "phone" — angle: front — why: the viewer sees the wait — cast: phone',
  '  - insert — the loading bar = latency — on "instant" — angle: front — why: the payoff',
  '- gap_question: "Why is the second time instant?"',
  '',
  '## Frame 3 — Define',
  '- look: mechanism',
  '- definition: "A cache is a nearby store of things you used recently."',
  '- part_of_speech: noun',
  '- scene: The dictionary card fills in',
  '',
  '## Frame 8 — Close',
  '- scene: White screen; the logo',
  '',
].join('\n');

const SCRIPT = [
  '# SCRIPT', '',
  '## Line 2 — Gap (Frame 2)', '', '    Your phone opens a page once slowly, then instantly. Why?', '',
  '## Line 3 — Define (Frame 3)', '', '    A cache is a nearby store of things you used recently. Caches save trips.', '',
].join('\n');

test('the reel test is what a viewer meets: scenes, shot subjects, the voice, the cards; never the meaning', () => {
  const t = reelTestMarkdown({ storyboard: BOARD, script: SCRIPT, term: 'cache' });
  for (let n = 1; n <= 8; n += 1) assert.match(t.text, new RegExp(`^## Beat ${n}$`, 'm'));
  assert.match(t.text, /On screen: A critter opens a fridge and grabs milk\n/, 'the parenthesis is cut');
  assert.match(t.text, /Shots: the phone; the loading bar\n/, '"=" and everything after it are cut; why, cast and angle never appear');
  assert.deepEqual(t.leakedScenes, [1], 'only scene lines are flagged');
  // 4.3: the opener shows only the wordmark; the card with the term is frame 3's hand-off.
  assert.match(t.text, /## Beat 1\n[\s\S]*?Words on screen: "AI BRAIN BREAK"\.\n/);
  assert.match(t.text, /Words on screen: a card that reads "today's AI Brain Break: cache"\./);
  assert.match(t.text, /Words on screen: a dictionary card: "cache" \(noun\): A cache is a nearby store of things you used recently\./);
  assert.match(t.text, /Voice: In the next minute, this fridge will teach you a tech concept\./, "the storyboard's voiceover when SCRIPT.md has no line");
  assert.match(t.text, /Voice: Your phone opens a page once slowly, then instantly\. Why\?/, "SCRIPT.md's line wins");
  assert.match(t.text, /## Beat 8\n\nThe video ends on the Helios logo\./);
  assert.match(t.text, /## Beat 5\n\nVoice: \(none\)/);
  assert.doesNotMatch(t.text, /stands for|why:|cast:|angle:|gap_question|throughline|latency/);

  // The newcomer meets an invented word everywhere, plurals and capitals included.
  const word = standInWord(t.text);
  const n = reelTestMarkdown({ storyboard: BOARD, script: SCRIPT, term: 'cache', standIn: word });
  assert.doesNotMatch(n.text, /cache/i);
  assert.match(n.text, new RegExp(`Voice: A ${word} is a nearby store of things you used recently\\. ${word[0].toUpperCase()}${word.slice(1)}s save trips\\.`));
  assert.match(n.text, new RegExp(`a card that reads "today's AI Brain Break: ${word}"`));
});

test('the stand-in word: invented, never already in the text; the term replaced in any form', () => {
  assert.equal(standInWord('nothing here'), STAND_IN_WORDS[0]);
  assert.equal(standInWord('a velk and a dorrin'), STAND_IN_WORDS[2]);
  assert.equal(replaceTerm('An API is how an app asks. APIs and api calls.', 'API', 'velk'), 'A Velk is how an app asks. Velks and velk calls.');
  assert.equal(replaceTerm('A context window holds it; context windows grow.', 'context window', 'quarn'), 'A quarn holds it; quarns grow.');
  assert.equal(replaceTerm('The frontend draws; the backend works. Frontend vs backend.', 'frontend vs backend', 'velk'), 'The velk-1 draws; the velk-2 works. Velk.');
  assert.deepEqual(viewerSceneLine('a fridge = the cache'), { text: 'a fridge', leaked: true });
  assert.deepEqual(viewerSceneLine('a fridge in a kitchen'), { text: 'a fridge in a kitchen', leaked: false });
});

test('shot subjects reach the readers as plain nouns: an entity id or what it stands for becomes what it is', () => {
  const board = [
    '## Anchor scene',
    '- hero: carrier — critter',
    '- entities:',
    '  - mailbox_flag — the red flag on the mailbox — stands for the notification — an orange slab — beats 1, 4',
    '  - carrier — a mail carrier critter — stands for the other app — a critter with a bag — beats 1, 4',
    '  - stands for nothing — broken line',
    '',
    '## Frame 4 — Analogy',
    '- look: world',
    '- scene: The carrier lifts mailbox_flag at the eye-level post',
    '- shots:',
    '  - medium — carrier — on "carrier" — angle: low — why: who brings it — cast: carrier',
    '  - close — the notification — on "flag" — angle: low — why: the news lands',
    '  - insert — the mailbox_flag snapping up — on "up" — angle: low — why: the moment',
    '  - wide — the whole drive — on "drive" — angle: high — why: the place',
    '- voiceover: "The flag pops up."',
    '',
  ].join('\n');
  const entities = anchorEntities(board);
  assert.deepEqual(entities, [
    { id: 'mailbox_flag', what: 'the red flag on the mailbox', standsFor: 'the notification' },
    { id: 'carrier', what: 'a mail carrier critter', standsFor: 'the other app' },
  ]);
  const t = reelTestMarkdown({ storyboard: board, script: '', term: 'webhook' }).text;
  assert.match(t, /^Shots: a mail carrier critter; the red flag on the mailbox; the red flag on the mailbox snapping up; the whole drive$/m);
  assert.match(t, /^On screen: The carrier lifts the red flag on the mailbox at the eye level post$/m);
  assert.doesNotMatch(t, /mailbox_flag|notification|stands for/);
  assert.equal(viewerNouns('Carrier', entities, { whole: true }), 'a mail carrier critter');
  assert.equal(viewerNouns('the other app', entities, { whole: true }), 'a mail carrier critter', 'what it stands for is meaning, never shown');
  assert.equal(viewerNouns('a cachedCopy on the shelf', entities), 'a cachedCopy on the shelf', 'camelCase that is no id is left alone');
  assert.equal(viewerNouns('the step_two box', entities), 'the step two box');
});

// ── The answer key and the readers' answers ───────────────────────────────────────────────

test("the answer key and the readers' replies are read leniently: a thin reply judges as thin", () => {
  assert.equal(parseAnswerKey(null), null);
  assert.equal(parseAnswerKey({ story_part: 'x' }), null, 'no term_is: no key');
  const key = parseAnswerKey({ term_is: ' a store ', mechanism_steps: ['look nearby', { step: 'fetch if missing', core: false }, { step: '' }], mapping: [{ story: 'fridge', real: 'cache' }, { story: 'x' }], false_beliefs_to_avoid: ['it never empties', 3] });
  assert.ok(key);
  assert.equal(key.term_is, 'a store');
  assert.deepEqual(key.mechanism_steps, [{ step: 'look nearby', core: true }, { step: 'fetch if missing', core: false }]);
  assert.deepEqual(key.mapping, [{ story: 'fridge', real: 'cache' }]);
  assert.equal(key.boundary, null);
  assert.deepEqual(key.false_beliefs_to_avoid, ['it never empties']);

  assert.throws(() => parseReaderAnswers({ beats: [] }), /no probes/);
  const a = parseReaderAnswers({
    beats: [{ beat: 2, could_not_follow: ['the word latency', { quote: 'payload', why: 'jargon' }] }],
    probes: { what_it_is: { answer: 'not from the video: a store', beats: ['3'], quotes: ['a nearby store'], sure: 'guessing' }, two_stories: { two: true }, where_lost: { lost_beat: 4 } },
  });
  assert.deepEqual(a.beats[0].could_not_follow, [{ quote: 'the word latency', why: '' }, { quote: 'payload', why: 'jargon' }]);
  assert.equal(a.probes.what_it_is.source, 'not from the video');
  assert.equal(a.probes.what_it_is.sure, 'guessing');
  assert.deepEqual(a.probes.what_it_is.beats, [3]);
  assert.equal(a.probes.two_stories.two, true);
  assert.equal(a.probes.where_lost.lost_beat, 4);
  assert.equal(a.probes.how_it_works.answer, '', 'a missing probe is empty');
  assert.equal(a.probes.the_takeaway.answer, '', '4.3: the takeaway probe replaces the question');
});

test("the readers' prompt: UNDERSTANDING.md's wording, cached and shared; who they are and the file come after it", () => {
  // A plain comprehension task (live runs 42–43: readers stopped by the safety classifier): no persona,
  // no role, no first-person viewer questions; the placeholder word is named openly as a placeholder.
  assert.match(READER_INSTRUCTIONS, /^Task: a comprehension check of a short educational video, done from its script\./);
  assert.doesNotMatch(READER_INSTRUCTIONS, /pretend|set that aside|invented|You are |\byou\b|\byour\b|viewer with|imagine/i);
  for (const line of Object.values(PERSONA_LINES)) assert.doesNotMatch(line, /\byou\b|the way a|pretend|imagine/i);
  assert.equal(readerLead({ persona: 'newcomer', term: 'velk', plain: true }), 'Answer only from what the video says.\nIn this copy of the script the topic\'s name is replaced by the placeholder word "velk", so the answers show what the video itself conveys; wherever the questions say [TERM], it means that word.');
  assert.equal(readerLead({ persona: 'curious', term: 'prompt caching' }).split('\n')[1], 'The video\'s topic is "prompt caching"; wherever the questions say [TERM], it means that.');
  assert.match(READER_INSTRUCTIONS, /Where an answer needs knowledge the video does not give, write "not from the video"\./);
  for (const q of ['[see_and_hear]', '[think_it_explains]', '[learned]', '[expect_next]', '[could_not_follow']) assert.ok(READER_INSTRUCTIONS.includes(q), q);
  for (let n = 1; n <= 11; n += 1) assert.match(READER_INSTRUCTIONS, new RegExp(`^${n}\\. `, 'm'));
  for (const k of ['what_it_is', 'which_one', 'two_stories', 'how_it_works', 'the_map', 'new_case', 'what_youd_assume', 'where_it_stops', 'the_example', 'the_takeaway', 'where_lost']) assert.ok(READER_INSTRUCTIONS.includes(`[${k}]`), k);
  const params = readerParams({ model: 'claude-sonnet-5-5', persona: 'newcomer', term: 'velk', reelTest: '## Beat 1\nVoice: hi' });
  const system = params.system as { text: string; cache_control?: unknown }[];
  assert.equal(system.length, 1);
  assert.equal(system[0].text, READER_INSTRUCTIONS, 'the cached prefix is identical for both readers');
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  const user = String(params.messages[0].content);
  assert.match(user, /^Write the answers in plain words, at the level of a general audience with no technical background\.\nIn this copy of the script [^\n]*"velk"[^\n]*\n\nHere is the file:\n\n## Beat 1\nVoice: hi$/);
  assert.deepEqual(readerParams({ model: 'm', persona: 'curious', term: 'cache', reelTest: 'x' }).system, params.system);
  // Live run 42: the reader schema was too large for structured output; plain JSON, parsed leniently.
  assert.ok(!('output_config' in params), 'no structured-output grammar for the readers');
  assert.match(READER_INSTRUCTIONS, /Reply with one JSON object only/);
  assert.deepEqual(textJson({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure:\n```json\n{"probes": {}}\n```' }] } as never, 'r'), { probes: {} });
  assert.throws(() => textJson({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no' }] } as never, 'r'), /no JSON/);
  // Any schema still sent as structured output stays small: few properties, shallow.
  const size = (node: unknown, depth = 0): { props: number; depth: number } => {
    const n = (node ?? {}) as { properties?: Record<string, unknown>; items?: unknown };
    const kids = [...Object.values(n.properties ?? {}), ...(n.items ? [n.items] : [])].map((k) => size(k, depth + 1));
    return { props: Object.keys(n.properties ?? {}).length + kids.reduce((a, k) => a + k.props, 0), depth: Math.max(depth, ...kids.map((k) => k.depth)) };
  };
  const dSchema = (diagnoserParams({ model: 'm', reelTest: 'x', key: null, readers: {}, serious: [] }) as { output_config: { format: { schema: unknown } } }).output_config.format.schema;
  assert.ok(size(dSchema).props <= 10 && size(dSchema).depth <= 4, JSON.stringify(size(dSchema)));
  // Structured outputs: every object closes and requires every property it names.
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
    if (n.type === 'object') {
      assert.equal(n.additionalProperties, false);
      assert.deepEqual([...(n.required ?? [])].sort(), Object.keys(n.properties ?? {}).sort());
    }
    for (const v of Object.values(n.properties ?? {})) walk(v);
    walk(n.items);
  };
  walk(READER_SCHEMA);
  const d = diagnoserParams({ model: 'claude-sonnet-5-5', reelTest: 'x', key: null, readers: {}, serious: [], standIn: 'velk', term: 'cache' });
  assert.deepEqual((d.system as { cache_control?: unknown }[])[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.match(String(d.messages[0].content), /The newcomer met the invented word "velk" everywhere in place of the term "cache"\./);
  assert.deepEqual(parseDiagnosis({ diagnoses: [{ finding: 1, beat: 3, cause: 'definition', why: 'w' }, { finding: 2, beat: 4, cause: 'vibes', why: '' }] }), [{ finding: 1, beat: 3, cause: 'definition', why: 'w' }]);
});

// ── Judging: Jev's checklist and the evidence rule ───────────────────────────────────────

const REEL = '## Beat 3\n\nVoice: A cache is a nearby store of things you used recently.\n\n## Beat 4\n\nVoice: The fridge keeps the milk close.\n';
const KEY: AnswerKey = {
  term_is: 'a nearby store of recently used things',
  story_part: 'the fridge',
  mechanism_steps: [{ step: 'look nearby first', core: true }, { step: 'old things get thrown out', core: false }],
  mapping: [{ story: 'the fridge', real: 'the cache' }],
  boundary: null,
  false_beliefs_to_avoid: ['it keeps everything forever'],
  example_answer: 'the page loads fast',
};
const p = (answer: string, extra: Partial<ProbeAnswer> = {}): ProbeAnswer => ({ answer, beats: [3], quotes: ['a nearby store of things'], sure: 'sure', source: 'video', ...extra });
const answers = (probes: Partial<ReaderAnswers['probes']> = {}): ReaderAnswers => ({
  beats: [],
  probes: {
    what_it_is: p('a store kept close'),
    which_one: p('the fridge'),
    two_stories: p('no', { two: false }),
    how_it_works: p('look nearby first'),
    the_map: p('fridge is the cache', { rows: [{ story: 'the fridge', real: 'the cache' }] }),
    new_case: p('my browser', { source: 'not from the video', quotes: [] }),
    what_youd_assume: p('it is quick', { beliefs: ['it is quick'] }),
    where_it_stops: p('not said'),
    the_example: p('the page loads fast', { other_answer: '' }),
    the_takeaway: p('pages I revisit open fast'),
    where_lost: p('nowhere', { lost_beat: 0 }),
    ...probes,
  },
});

/** Jev stubbed: `no` lists the questions answered against the reel (yes for bad ones, no for good ones). */
function jev(no: string[] = [], seen: { keys: string[]; state: Record<string, unknown> }[] = []): ExplainersJevRunner {
  const bad = new Set(['step_wrong', 'belief_contradicts', 'belief_listed']);
  return {
    callCount: 0,
    usd: 0,
    async ask(request) {
      const keys = Object.keys(request.questions);
      seen.push({ keys, state: request.state as Record<string, unknown> });
      const answersOut: Record<string, unknown> = {};
      for (const k of keys) {
        const against = no.includes(k) || no.includes(`${k}:${JSON.stringify(request.state)}`) || no.some((x) => x.startsWith(`${k}~`) && JSON.stringify(request.state).includes(x.slice(k.length + 1)));
        answersOut[k] = { type: 'noul', noul: bad.has(k) ? (against ? 0.9 : 0.1) : against ? 0.1 : 0.9 };
      }
      return { model: 'jev-stub', answers: answersOut, usage: { input_tokens: 1, output_tokens: 0 } } as never;
    },
  };
}

const judge = (a: ReaderAnswers, j: ExplainersJevRunner | null = jev(), key: AnswerKey | null = KEY) => judgeReader({ jev: j, topicId: 't', key, reader: 'curious', answers: a, reelTest: REEL });

test('a reader who understood: no serious finding; every checklist question asked once, with only its fields', async () => {
  const seen: { keys: string[]; state: Record<string, unknown> }[] = [];
  const f = await judge(answers(), jev([], seen));
  assert.deepEqual(f.serious, []);
  assert.deepEqual(f.minor, []);
  const keys = seen.map((s) => s.keys.join('+')).sort();
  assert.deepEqual(keys, ['belief_contradicts', 'belief_listed', 'example_matches', 'map_row', 'new_example', 'same_kind', 'same_story_part', 'step_present', 'step_present', 'step_wrong']);
  assert.deepEqual(Object.keys(seen.find((s) => s.keys[0] === 'step_present')!.state).sort(), ['step', 'viewer_explanation']);
});

test('the failure table: serious types with a quoted line; nice steps, maps, weak examples, listed beliefs and guesses are minor', async () => {
  // what it is, which one, a wrong step, a core step missing, a belief that contradicts, the example (4.3: no question)
  const f = await judge(answers(), jev(['same_kind', 'same_story_part', 'step_wrong', 'step_present~look nearby first', 'belief_contradicts', 'example_matches']));
  assert.deepEqual(f.serious.map((x) => x.type).sort(), ['example_wrong', 'missing_step', 'over_extension', 'wrong_referent', 'wrong_referent', 'wrong_step']);
  for (const s of f.serious) {
    assert.equal(s.script_quote, 'a nearby store of things');
    assert.equal(s.beat, 3, 'the beat the quote comes from');
    assert.equal(s.reader, 'curious');
  }
  // minor: the nice step missing, the map row, a weak example, a listed false belief, a lucky guess
  const m = await judge(
    answers({ which_one: p('the fridge', { sure: 'guessing' }) }),
    jev(['step_present~old things', 'map_row', 'new_example', 'belief_listed']),
  );
  assert.deepEqual(m.serious, []);
  const text = m.minor.map((x) => x.text).join('\n');
  assert.match(text, /leaves out a nice-to-have step: old things get thrown out/);
  assert.match(text, /did not map the fridge to the cache/);
  assert.match(text, /own new example is weak/);
  assert.match(text, /picked up a false belief the comparison invites/);
  assert.match(text, /got which story part is the term right but was guessing \(fragile\)/);
});

test('the evidence rule: no quoted line from the reel, or an answer from outside the video, is minor (reader noise)', async () => {
  const unquoted = await judge(answers({ what_it_is: p('a box', { quotes: ['words the video never said'] }) }), jev(['same_kind']));
  assert.deepEqual(unquoted.serious, []);
  assert.match(unquoted.minor[0].text, /no quoted line from the video behind it: recorded, not fixed/);
  const outside = await judge(answers({ what_it_is: p('a box', { source: 'not from the video', quotes: [] }) }));
  assert.deepEqual(outside.serious, [], 'an answer from outside the video never passes, and never counts as evidence');
  assert.match(outside.minor[0].text, /answered from outside the video/);
  assert.equal(quoteBeat(REEL, 'The fridge keeps the milk'), 4);
  assert.equal(quoteBeat(REEL, 'a nearby store … used recently'), 3, 'the longest piece around an ellipsis');
  assert.equal(quoteBeat(REEL, 'fridge'), null, 'one word is no evidence');
  assert.equal(quoteBeat(REEL, 'the milk is warm'), null);
});

test('code reads what needs no Jev: two stories, an ambiguous example, ear notes, where they got lost', async () => {
  const a = answers({
    two_stories: p('the fridge and then the milk', { two: true, quotes: ['A cache is a nearby store', 'The fridge keeps the milk'] }),
    the_example: p('the page loads fast', { other_answer: 'the page fails', quotes: ['The fridge keeps the milk close'] }),
    where_lost: p('beat 4', { lost_beat: 4, quotes: [] }),
  });
  a.beats = [{ beat: 3, see_and_hear: '', think_it_explains: '', learned: '', expect_next: '', could_not_follow: [{ quote: 'recently', why: 'too fast' }] }];
  for (const j of [null, jev()]) {
    const f = await judge(a, j, j ? KEY : null);
    assert.deepEqual(f.serious.map((x) => x.type), ['two_stories', 'example_ambiguous'], j ? 'with Jev' : 'without Jev or a key');
    assert.equal(f.serious[1].beat, 4);
    assert.ok(f.minor.some((x) => /^Beat 3, curious: could not follow "recently" \(too fast\)\.$/.test(x.text)));
    assert.ok(f.minor.some((x) => x.beat === 4 && /first got lost at beat 4/.test(x.text)));
  }
});

test('findings: both readers merged, the diagnosis folded in, the stand-in word turned back into the term', () => {
  const s = (over: Partial<SeriousFinding> = {}): SeriousFinding => ({ type: 'wrong_referent', reader: 'newcomer', reader_quote: 'a velk is a box', script_quote: 'A velk is a nearby store', beat: 3, cause: 'definition', why: 'The velks differ.', ...over });
  const merged = mergeFindings([
    { serious: [s()], minor: [{ text: 'same note', beat: 1 }] },
    { serious: [s({ reader: 'curious', type: 'missing_step', cause: 'missing_beat' })], minor: [{ text: 'same note', beat: 1 }, { text: 'other', beat: null }] },
  ]);
  assert.equal(merged.serious.length, 2, 'either reader can raise one');
  assert.deepEqual(merged.minor.map((m) => m.text), ['same note', 'other']);
  const back = unStandIn(merged, 'velk', 'cache');
  assert.equal(back.serious[0].script_quote, 'A cache is a nearby store');
  assert.equal(back.serious[0].why, 'The caches differ.');
  const diagnosed = applyDiagnosis(back.serious, [{ finding: 2, beat: 4, cause: 'order', why: 'used before it is introduced' }, { finding: 1, beat: 12, cause: 'wording', why: '' }]);
  assert.deepEqual(diagnosed.map((d) => [d.beat, d.cause, d.why]), [[3, 'wording', 'The caches differ.'], [4, 'order', 'used before it is introduced']]);
  assert.deepEqual(Object.keys(findingsJson({ serious: diagnosed, minor: merged.minor })), ['serious', 'minor']);
  assert.deepEqual(findingsJson({ serious: [], minor: merged.minor }).minor, ['same note', 'other']);
});

// ── Warnings ─────────────────────────────────────────────────────────────────────────────

test('warnings: the contract ids only, most important first, in plain words; minor notes capped', () => {
  const rows = [
    { rule: 'understanding:minor', frame: 4, detail: 'ear note', severity: 'warning' },
    { rule: 'text_bounds', frame: 2, detail: 'old rule', severity: 'warning' },
    { rule: 'picture:jump_cut', frame: 4, detail: '04-analogy: a jump cut', severity: 'warning' },
    { rule: 'understanding:wrong_referent', frame: 3, detail: 'took the term for the box', severity: 'warning' },
    { rule: 'breakage:bounds', frame: 2, detail: 'text off screen', severity: 'error' },
    { rule: 'spend_cap', frame: null, detail: 'the cap', severity: 'warning' },
    { rule: 'minimum:1', frame: null, detail: 'no world frame', severity: 'warning' },
    { rule: 'analogy:no_pass', frame: null, detail: 'least bad', severity: 'warning' },
  ];
  assert.deepEqual(reelWarnings(rows).map((r) => r.rule), ['spend_cap', 'analogy:no_pass', 'understanding:wrong_referent', 'picture:jump_cut', 'minimum:1', 'understanding:minor']);
  assert.ok(!isReelWarning({ rule: 'breakage:bounds', severity: 'error' }), 'an error is not a warning row');
  assert.ok(!isReelWarning({ rule: 'text_bounds', severity: 'warning' }), 'an old rule id is not a reel warning');
  assert.deepEqual(warningsSummary(rows), { count: 6, first: ['Spend cap: the cap', 'Analogy: least bad'] });
  assert.equal(warningText({ rule: 'understanding:wrong_referent', frame: 3, detail: 'x' }), 'Understanding, frame 3: x');
  assert.deepEqual(asReelWarning({ source: 'storyboard', rule: 'term', frame: null, severity: 'error', detail: 'd' }, 'lint'), { source: 'storyboard', rule: 'lint:term', frame: null, severity: 'warning', detail: 'd' });
  assert.equal(asReelWarning({ source: 'storyboard', rule: 'minimum:2', frame: null, severity: 'error', detail: 'd' }, 'lint').rule, 'minimum:2', 'a contract id is kept');

  const many = understandingWarnings({ serious: [], minor: Array.from({ length: MINOR_WARNINGS_MAX + 3 }, (_, i) => ({ text: `note ${i}`, beat: null })) });
  assert.equal(many.length, MINOR_WARNINGS_MAX + 1);
  assert.match(many.at(-1)!.detail, /^3 more minor notes are in the understanding report\.$/);
  assert.ok(many.every((r) => r.severity === 'warning' && r.rule === 'understanding:minor'));
});

test("try.mjs's leftovers become breakage:<check> warnings (F's problems, else its error strings)", () => {
  assert.deepEqual(
    tryViolations({ ok: false, errors: ['04-analogy: jump cut'], problems: [{ frame: '04-analogy', check: 'jump_cut', rule: 'breakage:jump_cut', message: 'shots 2 and 3: jump cut' }, { frame: null, check: 'identity', message: 'two looks' }] }),
    [
      { source: 'hyperframes', rule: 'breakage:jump_cut', frame: 4, severity: 'warning', detail: '04-analogy: shots 2 and 3: jump cut' },
      { source: 'hyperframes', rule: 'breakage:identity', frame: null, severity: 'warning', detail: 'two looks' },
    ],
  );
  assert.deepEqual(tryViolations({ ok: false, errors: ['06-example: something'] }), [{ source: 'hyperframes', rule: 'breakage:try', frame: 6, severity: 'warning', detail: '06-example: something' }]);
  assert.deepEqual(tryViolations({ ok: true, errors: [] }), []);
});

// ── The idea phase fails open; the gap writer is v2 again ────────────────────────────────

test('the least-bad analogy: gated before refused, fewest misses, lowest gates; none usable is null', () => {
  const c = (name: string) => ({ name, explanation: 'x', mapping: [{ analogy: 'a', concept: 'b' }] });
  const note = {
    version: 'analogy-writer-v8',
    golden_hidden: [],
    candidates: [
      { analogy: c('A refused one'), gates: null, misses: ['its name says the term'] },
      { analogy: c('A doorbell'), gates: { false_mapping: 0.9, is_the_system: 0.9, real_names: 0.1 }, misses: ['m1', 'm2'] },
    ],
    third: { analogy: c('A pager'), gates: { false_mapping: 0.6, is_the_system: 0.2, real_names: 0.1 }, misses: ['m1'] },
    below_bar: true,
    checked_at: 'now',
  } as unknown as AnalogyNote;
  assert.deepEqual(leastBadAnalogy(note), { analogy: c('A pager'), misses: ['m1'] });
  const empty = { version: 'v', golden_hidden: [], candidates: [{ analogy: null, gates: null, misses: ['down'] }], below_bar: true, checked_at: 'now' } as unknown as AnalogyNote;
  assert.equal(leastBadAnalogy(empty), null);
});

test('the least-bad gap line: scored before refused, fewest misses, highest total; a pick note for this render', () => {
  const g = (line: string) => ({ line, question: 'q?', way_in: 'w', why_it_pulls: 'p' });
  const note: GapNote = {
    version: GAP_WRITER_VERSION,
    analogy_name: 'A pager',
    passes: [
      { candidates: [g('refused'), g('low')], checks: [['quotes'], []], scores: [null, { pull: 1, clarity: 1, closable: 1 }], totals: [null, 25], false_claim: [null, 0.1], misses: [['quotes'], ['pull', 'clarity']] },
      { candidates: [g('better')], checks: [[]], scores: [{ pull: 2, clarity: 2, closable: 2 }], totals: [50], false_claim: [0.1], misses: [['clarity', 'closable']] },
    ],
    below_bar: true,
    checked_at: 'then',
  };
  const pick = leastBadGap(note);
  assert.ok(pick);
  assert.deepEqual(pick.pick, { pass: 1, index: 0 });
  assert.equal(pick.picked_at, 'then');
  assert.equal(leastBadGap({ version: GAP_WRITER_VERSION, analogy_name: 'x', error: 'down', failed_at: 'now' }), null);
});

test('the gap writer is v2 again (4.2, EX4-180), three candidates, and the no-quotation-marks check stays', () => {
  assert.equal(GAP_WRITER_VERSION, 'gap-writer-v2');
  assert.equal(GAPS_PER_TOPIC, 3);
  const q = 'So how does the app know right away?';
  const line = `You pay at a shop and your phone buzzes a second later with a "receipt" from the bank, though nobody asked it to. ${q}`;
  const problems = gapCheckProblems({ line, question: q, way_in: 'x', why_it_pulls: 'x' }, { term: 'webhook', analogy: { name: 'A pager', mapping: [{ analogy: 'the pager', concept: 'the webhook' }] } });
  assert.ok(problems.some((x) => /quotation marks/.test(x)), problems.join('; '));
});

// ── Policy and the meter ────────────────────────────────────────────────────────────────

test('the readers and the diagnosis only Read, whatever dispatches them; direct calls are charged to the meter', () => {
  for (const agent of ['reader', 'diagnoser']) {
    assert.equal(checkToolCall('Bash', { command: 'ls' }, '/j', agent).allow, false, agent);
    assert.equal(checkToolCall('Write', { file_path: 'x.json' }, '/j', agent).allow, false, agent);
    assert.equal(checkToolCall('Read', { file_path: '.hyperframes/reel-test.md' }, '/j', agent).allow, true, agent);
  }
  const meter = new SpendMeter(1, 0.5);
  meter.charge(0.2);
  meter.charge(Number.NaN);
  meter.charge(-1);
  assert.ok(Math.abs(meter.totalUsd - 0.7) < 1e-9);
  meter.charge(0.4);
  assert.equal(meter.overCap, true);
});

test('the agent path: each reader is a Read-only agent session reading its file; a refusal reads as one, no JSON fails', async () => {
  const runs: { prompt: string; agent: string; model: string }[] = [];
  const replies = ['{"probes": {}}', "I can't help with that.", 'no json here'];
  const written: string[] = [];
  const m = agentUnderstandingModel(async (input) => {
    runs.push(input);
    return { lastText: replies[runs.length - 1] ?? '', totalCostUsd: 0.05, isError: false, errors: [], capped: false };
  }, (rel) => written.push(rel));
  const ok = await m.read({ model: 'claude-sonnet-5-5', persona: 'newcomer', term: 'velk', reelTest: 'x' });
  assert.equal(ok.usd, 0.05, 'already metered by the session');
  assert.deepEqual([runs[0].agent, runs[0].model], ['reader', 'claude-sonnet-5-5']);
  assert.match(runs[0].prompt, /Read \.hyperframes\/reel-test-newcomer\.md and answer\.$/);
  // the comprehension framing reaches the stubbed model: a reading level and an open placeholder, no role
  assert.match(runs[0].prompt, /^Write the answers in plain words[^\n]*\nIn this copy of the script the topic's name is replaced by the placeholder word "velk"/);
  assert.doesNotMatch(runs[0].prompt, /pretend|imagine|you are|the way a viewer/i);
  await assert.rejects(m.read({ model: 'm', persona: 'curious', term: 'cache', reelTest: 'x' }), /declined/);
  await assert.rejects(m.read({ model: 'm', persona: 'curious', term: 'cache', reelTest: 'x' }), /no JSON/);
});

test('repeated warnings fold into one: same rule, frame and message pattern, with the count and the time span', () => {
  const rows = Array.from({ length: 220 }, (_, i) => ({ rule: 'breakage:objects', frame: 2, detail: `phone 'sign in' pin out of frame at ${(5.1 + i * 0.0205).toFixed(2)}s`, severity: 'warning' }));
  rows.push({ rule: 'breakage:objects', frame: 3, detail: "phone 'sign in' pin out of frame at 1.00s", severity: 'warning' });
  const g = groupWarnings(rows);
  assert.equal(g.length, 2);
  assert.equal(g[0].detail, "phone 'sign in' pin out of frame (×220, 5.1–9.6s)");
  assert.deepEqual(warningsSummary(rows), { count: 2, first: ["Breakage, frame 2: phone 'sign in' pin out of frame (×220, 5.1–9.6s)", "Breakage, frame 3: phone 'sign in' pin out of frame at 1.00s"] });
});

test('the picture check run by code: the dispatch carries only stills and lines; failures pick the fix; assets by the words seen', () => {
  const prompt = pictureCheckPrompt({ frames: [{ id: '04-analogy', number: 4, look: 'world', voiceover: 'The flag pops up.', stills: [{ t: 0.15, file: '.hyperframes/sequences/04-analogy-0.15.png' }] }] });
  assert.match(prompt, /- 04-analogy: stills \.hyperframes\/sequences\/04-analogy-0\.15\.png \(0\.15s\); the line heard: "The flag pops up\."/);
  assert.deepEqual(pictureFailures({ matches_line: 'yes', jump_cuts: [], floating: [], subject: 'a mug', mechanism: 'not_mechanism' }), []);
  assert.equal(pictureFailures({ matches_line: 'no', floating: ['a mug'], subject: 'cannot tell', mechanism: 'unclear' }, 'mechanism').length, 4);
  assert.equal(pictureFailures({ mechanism: 'unclear' }, 'world').length, 0, 'a world frame shows no mechanism');
  assert.match(pictureFixPrompt({ id: '04-analogy', problems: ['floating: a mug'] }), /- 04-analogy: floating: a mug\n.*Do not run the picture check and do not render/s);
  assert.deepEqual(pictureFailures({ matches_line: 'yes', jump_cuts: [{ between: ['1s', '2s'] }] }), [], 'felt jumps are code\'s: never a fix');
  assert.deepEqual(assetRows([{ name: 'yellow library request slip', file: 'f' }], ['a yellow request slip from a library', 'a book']).map((r) => r.pass), [true]);
  assert.deepEqual(assetRows([{ name: 'steel fryer basket', file: 'f' }], ['a pot']).map((r) => r.pass), [false]);
});
