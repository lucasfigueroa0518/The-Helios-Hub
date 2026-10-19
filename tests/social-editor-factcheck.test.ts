/**
 * Helios Social rebuild — M4 Editor + Fact-checker tests (offline, stubbed
 * Claude).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import { checkEditorPowers, runEditor } from '@/lib/social/editor/editor';
import { EDITOR_SYSTEM } from '@/lib/social/editor/prompt';
import { runFactCheck } from '@/lib/social/factcheck/factcheck';
import { applyFlags, checkFlags, cutText, keySlideIndex, type Flag, type FlagsSubmission } from '@/lib/social/factcheck/flags';
import { FACTCHECK_SYSTEM } from '@/lib/social/factcheck/prompt';
import { HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { createEditorStage } from '@/lib/social/pipeline/editor-stage';
import { createFactCheckStage } from '@/lib/social/pipeline/factcheck-stage';
import { STAGE_MODELS } from '@/lib/social/pipeline/models';
import { MAX_FRESH_CAPTIONS, MAX_FRESH_DRAFTS, runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, STUB_READ, createStubStages } from '@/lib/social/pipeline/stubs';
import type { StageName } from '@/lib/social/pipeline/types';
import { RULES_BLOCK, renderRulesFor } from '@/lib/social/prompts/rules-block';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { DraftValidationError, fillDraft } from '@/lib/social/writer/draft';

const PROMPTS = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
const block = (h: string) => [...PROMPTS.slice(PROMPTS.indexOf(h)).matchAll(/```\n([\s\S]*?)\n```/g)][0]![1]!;
const brief = briefSuperIntelligenceForce;

// ── Prompts (prompts file §4–5) ────────────────────────────────────────

test('Editor prompt = §4 text with the submit_draft OUTPUT line, then RULES_BLOCK and VOICE_BLOCK', () => {
  const tested = block('## 4. Editor');
  const out = "OUTPUT: the full edited draft in the Writer's format, then EDIT NOTES: one line per change.";
  assert.ok(tested.endsWith(out));
  const expected = [
    tested.slice(0, -out.length).trimEnd(),
    "When you're done, call submit_draft with the full edited draft in the Writer's format, with EDIT NOTES: one line per change.",
    RULES_BLOCK,
    renderRulesFor('editor'),
    `## Voice\n\n${VOICE_BLOCK}`,
  ].join('\n\n');
  assert.equal(EDITOR_SYSTEM, expected);
  assert.ok(EDITOR_SYSTEM.includes('### Checked by code'));
  assert.doesNotMatch(EDITOR_SYSTEM, /goes to the caption/);
  assert.doesNotMatch(EDITOR_SYSTEM, /cover options, slides, caption/);
});

test('Fact-checker prompt = §5 text with OUTPUT → submit_flags, then the Helios context', () => {
  const tested = block('## 5. Fact-checker');
  assert.equal(FACTCHECK_SYSTEM, `${tested.replace('\nOUTPUT\n', "\nWhen you're done, call submit_flags with these sections:\n")}\n\n${HELIOS_CONTEXT}`);
});

test('FACTCHECK prompt includes Helios context and the caption_read rules', () => {
  assert.ok(FACTCHECK_SYSTEM.includes(HELIOS_CONTEXT));
  assert.match(FACTCHECK_SYSTEM, /opinion is allowed/i);
  assert.match(FACTCHECK_SYSTEM, /caption_read/);
  assert.match(FACTCHECK_SYSTEM, /where \(cover n \/ slide n \/ caption \/ caption_read\)/);
});

// ── Editor powers (code) ───────────────────────────────────────────────

const editErrors = (edit: (d: ReturnType<typeof sifDraft>) => void) => {
  const e = sifDraft();
  edit(e);
  try {
    checkEditorPowers(sifDraft(), e);
  } catch (err) {
    assert.ok(err instanceof DraftValidationError);
    return err.errors.map((x) => x.message);
  }
  return [];
};

test('Editor powers: cutting, reordering and rewording are fine; new IDs or visuals are not; swapping in the fallback is a cut', () => {
  assert.deepEqual(editErrors((d) => { d.slides.splice(5, 1); d.slides.reverse(); d.slides[0]!.headline.text = 'Sharper'; }), []);
  assert.deepEqual(editErrors((d) => { d.slides[0]!.body!.facts.push('F5'); }), ["claim tag F5 wasn't in the Writer's draft"]);
  assert.deepEqual(editErrors((d) => { d.slides[2]!.quote_id = 'Q2'; d.slides[2]!.quote_excerpt = null; }), ["quote Q2 wasn't in the Writer's draft (the Editor never adds facts)"]);
  assert.deepEqual(editErrors((d) => { d.slides[1]!.visual = { kind: 'thematic', query: 'city skyline' }; }), ['visual "thematic:city skyline" wasn\'t in the Writer\'s draft (you may only swap a slide\'s visual for its fallback)']);
  // Swapping a visual for its fallback is a cut, so it's allowed (Tommy, 2026-10-07).
  assert.deepEqual(editErrors((d) => { d.slides[1]!.visual = { ...d.slides[1]!.fallback_visual }; }), []);
});

// ── Stubbed Claude ─────────────────────────────────────────────────────

const usage = { input_tokens: 5000, output_tokens: 2500, cache_read_input_tokens: 0, cache_creation_input_tokens: 2500 };
const msg = (content: unknown[]) =>
  ({ id: `m_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, content, usage }) as unknown as Anthropic.Message;
const tool = (name: string, input: unknown) => ({ type: 'tool_use', id: `t_${Math.random()}`, name, input });
function scripted(responses: Anthropic.Message[]) {
  const requests: any[] = [];
  const create: MessagesCreate = async (p) => {
    requests.push(structuredClone(p));
    const next = responses.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  };
  return { create, requests };
}

test('Editor: gets the draft and the brief, returns submit_draft; a powers violation gets one retry', async () => {
  const edited = sifDraft();
  edited.slides.splice(5, 1);
  const bad = sifDraft();
  bad.slides[0]!.body!.facts.push('F5');
  const { create, requests } = scripted([msg([tool('submit_draft', bad)]), msg([tool('submit_draft', edited)])]);
  const r = await runEditor(brief(), sifDraft(), { create });
  assert.ok(r.ok);
  assert.equal(r.draft.slides.length, 5);
  assert.equal(r.retries, 1);
  assert.match(r.retryErrors[0]!, /claim tag F5 wasn't in the Writer's draft/);
  assert.equal(requests[0].model, STAGE_MODELS.editor.model);
  assert.equal(requests[0].system[0].text, EDITOR_SYSTEM);
  assert.ok(requests[0].messages[0].content.startsWith('DRAFT\n{'));
  assert.ok(requests[0].messages[0].content.includes('\n\nBRIEF\n{'));
});

// ── Flags: check ───────────────────────────────────────────────────────

const flag = (over: Partial<Flag> = {}): Flag => ({
  where: { part: 'slide', number: 2 }, quoted_text: 'on Truth Social', type: 2, fact_id: 'F1', fix: { kind: 'cut', replacement: null }, ...over,
});
/** What the Fact-checker sees: the Editor's draft after the captioner has written the news part and the read (the Writer and Editor leave both empty). */
const READ_TEXT = 'For a law firm, the rules on AI tools may get looser first. Helios builds systems you own.';
const captioned = () => ({
  ...sifDraft(),
  caption: { text: 'Trump announced a Super Intelligence Force on Sunday. Source: TechCrunch, October 4, 2026.', facts: ['F1'] },
  caption_read: { text: READ_TEXT, facts: [] as string[] },
});

const filled = () => fillDraft(captioned(), brief());
const flagErrors = (f: FlagsSubmission) => {
  try {
    checkFlags(f, filled(), brief());
    return [];
  } catch (err) {
    return (err as Error).message;
  }
};

test('flags check: quoted text must be in the named part; SWAP words must be copied from the brief', () => {
  assert.deepEqual(flagErrors({ flags: [flag()], main_claim_false: false }), []);
  assert.match(String(flagErrors({ flags: [flag({ quoted_text: 'on Facebook' })], main_claim_false: false })), /quoted text isn't in slide 2/);
  assert.match(String(flagErrors({ flags: [flag({ where: { part: 'slide', number: 9 } })], main_claim_false: false })), /slide 9 doesn't exist/);
  assert.match(String(flagErrors({ flags: [flag({ fix: { kind: 'swap', replacement: 'in a speech' } })], main_claim_false: false })), /SWAP words aren't copied from the brief/);
  assert.deepEqual(flagErrors({ flags: [flag({ fix: { kind: 'swap', replacement: 'in a Sunday morning post on Truth Social' } })], main_claim_false: false }), []);
  assert.match(String(flagErrors({ flags: [flag({ fact_id: 'F42' })], main_claim_false: false })), /fact ID F42 isn't in the brief/);
});

// ── Flags: apply (spec §4.2b) ──────────────────────────────────────────

const apply = (flags: Flag[], main = false) => applyFlags(captioned(), { flags, main_claim_false: main }, brief());

test('apply: SWAP and CUT are applied by code; nothing else changes', () => {
  const o = apply([
    flag({ quoted_text: 'Sunday morning post', fix: { kind: 'swap', replacement: 'Sunday morning post' } }),
    flag({ where: { part: 'slide', number: 3 }, quoted_text: ', with three vice chairs', fact_id: 'F3' }),
  ]);
  assert.equal(o.kind, 'ok');
  if (o.kind !== 'ok') return;
  assert.equal(o.draft.slides[1]!.body!.text, 'The Wall Street Journal reports Clayton will chair the force.');
  assert.equal(o.applied.length, 2);
  assert.equal(cutText('Trump said X, according to aides.', ', according to aides'), 'Trump said X.');
});

test('apply: a cut that empties a headline drops the slide; a flag inside the filled quote drops the slide', () => {
  const headline = apply([flag({ where: { part: 'slide', number: 7 }, quoted_text: 'Why the name matters', fact_id: 'B2' })]);
  assert.equal(headline.kind, 'ok');
  if (headline.kind === 'ok') assert.equal(headline.draft.slides.length, 5);
  const quote = apply([flag({ where: { part: 'slide', number: 4 }, quoted_text: 'coordinating the effort', fact_id: null, type: 3 })]);
  assert.equal(quote.kind, 'ok');
  if (quote.kind === 'ok') {
    assert.equal(quote.draft.slides.length, 5);
    assert.ok(!quote.draft.slides.some((s) => s.type === 'quote'));
    assert.match(quote.applied[0]!, /slide 4 dropped \(quote\/number text\)/);
  }
});

test('cutting the read to nothing asks for a fresh caption; so does emptying the news part (no longer a fresh draft)', () => {
  const f = [flag({ where: { part: 'slide', number: 3 }, quoted_text: ', with three vice chairs', fact_id: 'F3' })];
  assert.equal(applyFlags(sifDraft(), { flags: f, main_claim_false: false }, brief()).kind, 'ok'); // pre-captioner: caption is '', no read
  const read = apply([flag({ where: { part: 'caption_read', number: null }, quoted_text: READ_TEXT, fact_id: null, type: 5 })]);
  assert.deepEqual(read.kind === 'fresh-caption' && read.why, "the builder's read was cut to nothing");
  const cap = captioned();
  cap.caption.text = 'Trump announced it.';
  const o = applyFlags(cap, { flags: [flag({ where: { part: 'caption', number: null }, quoted_text: 'Trump announced it.', fix: { kind: 'cut', replacement: null } })], main_claim_false: false }, brief());
  assert.deepEqual(o.kind === 'fresh-caption' && o.why, 'the caption was cut to nothing');
  // A slide problem a fresh caption can't fix still asks for a fresh draft.
  const both = apply([flag({ quoted_text: 'Announced on Truth Social' }), flag({ where: { part: 'caption_read', number: null }, quoted_text: READ_TEXT, fact_id: null })]);
  assert.equal(both.kind, 'fresh-draft');
});

test('fact-check can flag the read: checkFlags accepts caption_read and applyFlags cuts inside it', () => {
  const cut = flag({ where: { part: 'caption_read', number: null }, quoted_text: 'For a law firm, the rules on AI tools may get looser first.', fact_id: null, type: 4 });
  assert.deepEqual(flagErrors({ flags: [cut], main_claim_false: false }), []);
  assert.match(String(flagErrors({ flags: [{ ...cut, quoted_text: 'Helios cut costs 40%' }], main_claim_false: false })), /quoted text isn't in caption_read/);
  const noRead = { ...filled(), caption_read: undefined };
  assert.throws(() => checkFlags({ flags: [cut], main_claim_false: false }, noRead, brief()), /caption_read null doesn't exist/);
  const o = apply([cut]);
  assert.equal(o.kind, 'ok');
  if (o.kind !== 'ok') return;
  // A partial cut that leaves the Helios mention is a free fix.
  assert.equal(o.draft.caption_read!.text, 'Helios builds systems you own.');
  assert.equal(o.draft.caption.text, captioned().caption.text, 'the news part is untouched');
  assert.match(o.applied[0]!, /CUT type 4 in caption_read/);
});

test('a partial cut that removes the read\'s Helios sentence asks for a fresh caption', () => {
  const o = apply([flag({ where: { part: 'caption_read', number: null }, quoted_text: 'Helios builds systems you own.', fact_id: null, type: 5 })]);
  assert.deepEqual(o.kind === 'fresh-caption' && o.why, "the builder's read no longer names Helios");
  // Slide problems still come first.
  const both = apply([flag({ quoted_text: 'Announced on Truth Social' }), flag({ where: { part: 'caption_read', number: null }, quoted_text: 'Helios builds systems you own.', fact_id: null })]);
  assert.equal(both.kind, 'fresh-draft');
});

test('the Fact-checker stage maps fresh-caption to needs-fresh-caption', async () => {
  const stage = createFactCheckStage({ create: async () => msg([tool('submit_flags', { flags: [flag({ where: { part: 'caption_read', number: null }, quoted_text: READ_TEXT, fact_id: null })], main_claim_false: false })]) });
  const r = await stage({ storyId: 's1', submission: captioned(), filled: filled() }, { storyId: 's1', parsed: brief(), raw: '', pages: [] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reasonCode, 'needs-fresh-caption');
    assert.equal(r.detail, "the builder's read was cut to nothing");
  }
});

test('apply: a draft that is short as written is not a fresh-draft trigger (only cuts are)', () => {
  const short = captioned();
  short.slides = short.slides.slice(0, 3);
  assert.equal(applyFlags(short, { flags: [], main_claim_false: false }, brief()).kind, 'ok');
});

test('apply: the chosen cover fails → next cover option; every cover fails → fresh draft', () => {
  const o = apply([flag({ where: { part: 'cover', number: 1 }, quoted_text: 'led by his spy chief' })]);
  assert.equal(o.kind, 'ok');
  if (o.kind === 'ok') {
    assert.equal(o.draft.chosen_cover, 2);
    assert.match(o.applied.at(-1)!, /chosen cover 1 failed → cover option 2/);
  }
  const all = apply([1, 2, 3].map((n) => flag({ where: { part: 'cover', number: n }, quoted_text: 'x' })));
  assert.deepEqual(all.kind === 'fresh-draft' && all.why, 'every cover option failed');
});

test('apply: fewer than 5 slides, or the key slide cut → fresh draft; main claim false → set aside', () => {
  assert.equal(keySlideIndex(sifDraft(), brief()), 0); // slide 2 carries THE NEWS (F1)
  const key = apply([flag({ quoted_text: 'Announced on Truth Social' })]);
  assert.deepEqual(key.kind === 'fresh-draft' && key.why, 'the key slide (slide 2) was cut');
  const few = apply([3, 6, 7].map((n) => flag({ where: { part: 'slide', number: n }, quoted_text: ['Clayton will chair it', 'What the charter says', 'Why the name matters'][[3, 6, 7].indexOf(n)]! })));
  assert.deepEqual(few.kind === 'fresh-draft' && few.why, 'cuts leave 3 story slides (< 5)');
  assert.deepEqual(apply([], true), { kind: 'set-aside', why: "the story's main claim is false" });
});

test('Fact-checker: reads all 3 covers with quotes and numbers filled; returns flags and the outcome', async () => {
  const { create, requests } = scripted([msg([tool('submit_flags', { flags: [flag({ where: { part: 'slide', number: 3 }, quoted_text: ', with three vice chairs', fact_id: 'F3' })], main_claim_false: false })])]);
  const r = await runFactCheck(brief(), { submission: captioned(), filled: filled() }, { create });
  assert.ok(r.ok);
  assert.equal(r.outcome.kind, 'ok');
  const sent = JSON.parse(requests[0].messages[0].content.split('\n\nBRIEF\n')[0].slice('DRAFT\n'.length));
  assert.equal(sent.cover_options.length, 3);
  assert.equal(sent.slides[3].numbers[0].value, '120 days');
  assert.ok(sent.slides[2].quote.text.startsWith('The Super Intelligence Force'));
  assert.equal(requests[0].model, STAGE_MODELS['fact-checker'].model);
  assert.equal(requests[0].system[0].text, FACTCHECK_SYSTEM);
});

// ── runDay: fresh drafts (spec §4.2b) ──────────────────────────────────

type Outcome = 'clean' | 'fresh' | 'false' | 'fresh-caption';

function factCheckScript(outcomes: Outcome[]) {
  return async () => {
    const o = outcomes.shift() ?? 'clean';
    const flags = o === 'false' ? { flags: [], main_claim_false: true }
      : o === 'fresh' ? { flags: [flag({ quoted_text: 'x', where: { part: 'cover', number: 1 } }), flag({ quoted_text: 'x', where: { part: 'cover', number: 2 } }), flag({ quoted_text: 'x', where: { part: 'cover', number: 3 } })], main_claim_false: false }
      // The stub captioner's whole read is cut (e.g. an unsupported Helios claim).
      : o === 'fresh-caption' ? { flags: [flag({ quoted_text: STUB_READ, where: { part: 'caption_read', number: null }, type: 5 })], main_claim_false: false }
      : { flags: [], main_claim_false: false };
    return msg([tool('submit_flags', flags)]);
  };
}

function dayWith(outcomes: Outcome[], calls?: Array<{ stage: StageName; storyId: string }>) {
  // Stub stages produce stubBrief/stubDraft; the Fact-checker checks against those.
  const stub = createStubStages({ calls });
  return runDay({
    articles: STUB_ARTICLES.slice(0, 1),
    targetPosts: 1,
    stages: {
      ...stub,
      factCheck: createFactCheckStage({
        create: async () => {
          const res = await factCheckScript(outcomes)();
          // Point the cover flags at text that exists in the stub draft's covers.
          const input = (res.content[0] as any).input;
          input.flags = input.flags.map((f: Flag) => (f.where.part === 'cover' ? { ...f, quoted_text: 'Lab ships new model' } : f)).map((f: Flag) => ({ ...f, fact_id: null }));
          return res;
        },
      }),
    },
    meter: createCostMeter(),
    log: createInMemorySetAsideLog(),
    now: new Date('2026-10-05T15:00:00Z'),
  });
}

test('runDay: a fresh draft reruns Writer → Editor → Fact-checker and is logged', async () => {
  const r = await dayWith(['fresh', 'clean']);
  assert.equal(r.posts.length, 1);
  assert.equal(r.freshDrafts.length, 1);
  assert.equal(r.freshDrafts[0]!.detail, 'every cover option failed');
  assert.deepEqual(r.posts[0]!.stages.filter((s) => s === 'writer').length, 2);
});

test(`runDay: after ${MAX_FRESH_DRAFTS} fresh drafts the story is set aside; a false main claim sets it aside at once`, async () => {
  const r = await dayWith(['fresh', 'fresh', 'fresh']);
  assert.equal(r.posts.length, 0);
  assert.equal(r.freshDrafts.length, MAX_FRESH_DRAFTS);
  assert.equal(r.setAsides[0]!.reasonCode, 'unfixable-draft');
  const f = await dayWith(['false']);
  assert.equal(f.setAsides[0]!.reasonCode, 'main-claim-false');
  assert.equal(f.setAsides[0]!.kind, 'should-not-run');
});

test('orchestrator reruns only the captioner: one fresh caption, then the post ships', async () => {
  assert.equal(MAX_FRESH_CAPTIONS, 1);
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const r = await dayWith(['fresh-caption', 'clean'], calls);
  assert.equal(r.posts.length, 1);
  const count = (stage: StageName) => calls.filter((c) => c.stage === stage).length;
  assert.equal(count('writer'), 1);
  assert.equal(count('editor'), 1);
  assert.equal(count('captioner'), 2);
  assert.deepEqual(r.freshDrafts, []);
  assert.equal(r.freshCaptions.length, 1);
  assert.equal(r.freshCaptions[0]!.detail, "the builder's read was cut to nothing");
  assert.deepEqual(r.posts[0]!.stages.slice(3, 8), ['editor', 'captioner', 'fact-checker', 'captioner', 'fact-checker']);
});

test('orchestrator: a second fresh caption falls through to the fresh-draft path', async () => {
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const r = await dayWith(['fresh-caption', 'fresh-caption', 'clean'], calls);
  assert.equal(r.posts.length, 1);
  assert.equal(calls.filter((c) => c.stage === 'writer').length, 2);
  assert.equal(calls.filter((c) => c.stage === 'captioner').length, 3);
  assert.equal(r.freshCaptions.length, 1);
  assert.equal(r.freshDrafts.length, 1);
  assert.match(r.freshDrafts[0]!.detail, /fresh caption.*the builder's read was cut to nothing/);
});

test('orchestrator: fresh captions never outlast the fresh-draft limit', async () => {
  const r = await dayWith(Array<Outcome>(10).fill('fresh-caption'));
  assert.equal(r.posts.length, 0);
  assert.equal(r.freshDrafts.length, MAX_FRESH_DRAFTS);
  assert.equal(r.setAsides[0]!.reasonCode, 'unfixable-draft');
});

test('runDay: the Editor stage passes its draft on in the same shape', async () => {
  const edited = createEditorStage({ create: async (p) => {
    const draft = JSON.parse((p.messages[0]!.content as string).split('\n\nBRIEF\n')[0]!.slice('DRAFT\n'.length));
    return msg([tool('submit_draft', draft)]);
  } });
  const r = await runDay({
    articles: STUB_ARTICLES.slice(0, 1), targetPosts: 1,
    stages: { ...createStubStages(), edit: edited },
    meter: createCostMeter(), log: createInMemorySetAsideLog(), now: new Date('2026-10-05T15:00:00Z'),
  });
  assert.equal(r.posts.length, 1);
});

// ── Subject tags re-checked right after the Editor (Tommy, 2026-10-07) ──

import { sifDraftHandoff } from '@/fixtures/social/drafts';

test('after the Editor: a tag its edits no longer name is removed and logged; a missing list becomes empty; words and requests stay', async () => {
  const writer = sifDraftHandoff();
  const edited = structuredClone(writer);
  edited.slides[1]!.headline.text = 'A new chair for the force';
  edited.slides[1]!.body!.text = 'The Wall Street Journal reports he will chair the force, with three vice chairs.'; // Clayton cut
  delete edited.slides[4]!.subject_ids;
  const { create } = scripted([msg([tool('submit_draft', edited)])]);
  const r = await runEditor(brief(), writer, { create });
  assert.ok(r.ok);
  assert.deepEqual(r.draft.slides[1]!.subject_ids, []);
  assert.deepEqual(r.draft.slides[4]!.subject_ids, []);
  assert.equal(r.draft.slides[1]!.body!.text, edited.slides[1]!.body!.text, 'the Editor\'s words stay');
  assert.deepEqual(r.draft.slides[1]!.visual, writer.slides[1]!.visual, 'the request stays as the Editor left it');
  assert.deepEqual(r.tagsDropped, ['subject-tag-dropped: slide 3 S2 (Jay Clayton) (not named on the slide)', 'subject-tag-dropped: slide 6 had no subject_ids → []']);
  assert.deepEqual(r.filled.slides[1]!.subject_ids, [], 'the filled draft carries the checked tags');
});

test('after the Editor: tags the edited words still name are kept, nothing logged', async () => {
  const writer = sifDraftHandoff();
  const { create } = scripted([msg([tool('submit_draft', structuredClone(writer))])]);
  const r = await runEditor(brief(), writer, { create });
  assert.ok(r.ok);
  assert.deepEqual(r.tagsDropped, []);
  assert.deepEqual(r.draft.slides.map((s) => s.subject_ids), writer.slides.map((s) => s.subject_ids));
});

test('after the Editor: the follow topic is the Writer’s, whatever the Editor returns', async () => {
  const writer = sifDraftHandoff();
  writer.follow_topic = 'AI policy stories';
  // The Editor drops it.
  const dropped = structuredClone(writer);
  delete dropped.follow_topic;
  const a = await runEditor(brief(), writer, { create: scripted([msg([tool('submit_draft', dropped)])]).create });
  assert.ok(a.ok);
  assert.equal(a.draft.follow_topic, 'AI policy stories');
  assert.equal(a.filled.follow, 'Follow Helios for more AI policy stories like this.');
  // The Editor changes it (the Writer owns this line).
  const changed = structuredClone(writer);
  changed.follow_topic = 'Amazon deal news';
  const b = await runEditor(brief(), writer, { create: scripted([msg([tool('submit_draft', changed)])]).create });
  assert.ok(b.ok);
  assert.equal(b.draft.follow_topic, 'AI policy stories');
});
