/**
 * Helios Social rebuild — M3 Writer tests (offline: stubbed Claude, stubbed
 * Wikidata; no network).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { Q1_TEXT, briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { STAGE_MODELS } from '@/lib/social/pipeline/models';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import { createWriterStage } from '@/lib/social/pipeline/writer-stage';
import { RULES_BLOCK, WRITER_RULES, renderRulesFor } from '@/lib/social/prompts/rules-block';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { DraftValidationError, checkDraft, fillDraft, isExactExcerpt, type DraftSubmission, type VisualRequest } from '@/lib/social/writer/draft';
import { WRITER_ADDED_RULES, WRITER_MOMENTUM_RULES, WRITER_SYSTEM, writerUserMessage } from '@/lib/social/writer/prompt';
import { briefForWriter, runWriter } from '@/lib/social/writer/writer';
import { checkLines } from '@/lib/social/writer/shorten';

const PROMPTS = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
const codeBlocks = (from: string) => [...PROMPTS.slice(PROMPTS.indexOf(from)).matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]!);

const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });

/** A valid draft for the Super Intelligence Force fixture brief. */
function draft(): DraftSubmission {
  const d: DraftSubmission = {
    cover_options: [
      { text: 'Trump launches a Super Intelligence Force, led by his spy chief', facts: ['F1', 'F2'], visual: v('person', 'Donald Trump'), fallback_visual: v('setting', 'government building'), subject_ids: ['S1', 'S3'], icon: 'landmark' },
      { text: "Trump's new AI task force has 120 days", facts: ['F4'], visual: v('thematic', 'wall clock'), fallback_visual: v('thematic', 'desk calendar'), subject_ids: ['S1'] },
      { text: 'The White House names its AI czar', facts: ['F3'], visual: v('setting', 'government building'), fallback_visual: v('thematic', 'office desk'), subject_ids: [] },
    ],
    chosen_cover: 1,
    slides: [
      { type: 'text', headline: { text: 'Announced on Truth Social', facts: ['F1'] }, body: { text: 'Trump announced the force in a Sunday morning post.', facts: ['F1'] }, quote_id: null, quote_excerpt: null, number_ids: [], visual: v('thematic', 'smartphone screen'), fallback_visual: v('setting', 'press briefing room'), subject_ids: ['S1'], icon: 'smartphone' },
      { type: 'quote', headline: { text: 'His pitch for the force', facts: ['Q1'] }, body: null, quote_id: 'Q1', quote_excerpt: 'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government … of all Americans,', number_ids: [], visual: v('person', 'Donald Trump'), fallback_visual: v('thematic', 'press podium'), subject_ids: ['S1'], icon: 'message-square-quote' },
      { type: 'stat', headline: { text: 'It has a deadline', facts: ['N1'] }, body: null, quote_id: null, quote_excerpt: null, number_ids: ['N1'], visual: v('thematic', 'wall clock'), fallback_visual: v('thematic', 'desk calendar'), subject_ids: [], icon: 'clock' },
      { type: 'text', headline: { text: 'What the charter says', facts: ['F6'] }, body: { text: 'The charter reportedly says it will plan responses to SI-enabled threats.', facts: ['F6'] }, quote_id: null, quote_excerpt: null, number_ids: [], visual: v('thematic', 'stacks of documents'), fallback_visual: v('setting', 'government office'), subject_ids: [], icon: 'file-text' },
      { type: 'text', headline: { text: 'Why the name matters', facts: ['B2'] }, body: { text: 'Trump signed an executive order seeking to rebrand AI as super intelligence.', facts: ['B2'] }, quote_id: null, quote_excerpt: null, number_ids: [], visual: v('thematic', 'pen and paper'), fallback_visual: v('thematic', 'signed document'), subject_ids: ['S1'], icon: 'file-text' },
    ],
    follow: 'Follow Helios for AI news without the hype.',
    caption: { text: 'Trump announced a Super Intelligence Force. Source: TechCrunch, October 4, 2026.', facts: ['F1'] },
    edit_notes: ['Led with the spy chief role, not the name.'],
  };
  // alt_visuals are required (2026-10-09): two plain scenes per place, distinct from every visual and fallback here.
  const alts = () => [v('thematic', 'server racks'), v('setting', 'empty meeting room')];
  d.cover_options.forEach((c) => (c.alt_visuals = alts()));
  d.slides.forEach((x) => (x.alt_visuals = alts()));
  return d;
}

function errorsOf(edit: (d: DraftSubmission) => void): string[] {
  const d = draft();
  edit(d);
  try {
    checkDraft(d, briefSuperIntelligenceForce());
  } catch (err) {
    assert.ok(err instanceof DraftValidationError);
    return err.errors.map((e) => `${e.section}: ${e.message}`);
  }
  assert.fail('expected the draft to be rejected');
}

// ── Prompt (prompts file §2–3) ─────────────────────────────────────────

test('Writer prompt = tested intro + RULES (tested lines + 3 additions + shared policy) + submit_draft line + section list + caption section', () => {
  const tested = codeBlocks('## 2. Writer')[0]!;
  const intro = tested.slice(0, tested.indexOf('\n\nRULES\n'));
  const sectionList = tested.slice(tested.indexOf('\n\nOUTPUT\n') + '\n\nOUTPUT\n'.length, tested.indexOf('\n\nBRIEF\n')).replace('/ IMAGE   (repeat)', '/ VISUAL / FALLBACK VISUAL   (repeat)');
  const caption = codeBlocks('## 3. Writer')[0]!
    .replace('${VOICE_BLOCK}', VOICE_BLOCK)
    .replace("${renderRulesFor('caption')}", renderRulesFor('writer'))
    .replace('the final SLIDES you were given', 'the slides you wrote')
    .replace("that's the Writer/Editor's decision — respect it.", "that's the Writer/Editor's decision. Respect it.")
    .replace(/^3\. Source credits, always,.*\n/m, '');
  const expected = [
    intro,
    `## Rules\n\n${WRITER_RULES}\n${WRITER_ADDED_RULES}\n${codeBlocks('**Writer prompt v2')[0]}\n${codeBlocks('**No repetition within a slide')[0]}`,
    RULES_BLOCK.slice(RULES_BLOCK.indexOf('## Context policy')),
    `When you're done, call submit_draft with these sections:\n${sectionList}`,
    caption,
  ].join('\n\n');
  assert.equal(WRITER_SYSTEM, expected);
  assert.ok(!WRITER_SYSTEM.includes('{{brief}}') && !WRITER_SYSTEM.includes('\nOUTPUT\n') && !WRITER_SYSTEM.includes('${'));
  assert.equal(WRITER_ADDED_RULES.split('\n').length, 3);
  assert.ok(WRITER_ADDED_RULES.endsWith(codeBlocks('- **Copy budget, Writer stat line')[0]!), 'stat line word for word');
  assert.equal(WRITER_MOMENTUM_RULES, codeBlocks('**Writer prompt v2')[0], 'v2 rules word for word from the prompts file');
  assert.ok(!WRITER_SYSTEM.includes('—'), 'no em dashes anywhere in the Writer prompt');
  assert.ok(!WRITER_SYSTEM.includes('Source:'), 'the Source line is built by code, not asked of the Writer');
  assert.ok(!WRITER_SYSTEM.includes('Hook pass'), 'the Hook pass is gone');
});

test('the brief goes in the user message as JSON, with SUBJECTS marked well_known by code', async () => {
  const brief = briefSuperIntelligenceForce();
  const forWriter = await briefForWriter(brief, async (s) => s.name === 'Donald Trump');
  assert.deepEqual(forWriter.subjects.map((s) => [s.name, s.well_known]), [['Donald Trump', true], ['Jay Clayton', false], ['Super Intelligence Force', false]]);
  const msg = writerUserMessage(forWriter);
  assert.ok(msg.startsWith('BRIEF\n{'));
  assert.deepEqual(JSON.parse(msg.slice('BRIEF\n'.length)).subjects[1].well_known, false);
  // A failing lookup counts as not well known.
  const failing = await briefForWriter(brief, async () => { throw new Error('wikidata down'); });
  assert.ok(failing.subjects.every((s) => s.well_known === false));
});

// ── Code check and fill-in (spec §4.2a, §5.3) ──────────────────────────

test('a valid draft passes; code fills the exact quote excerpt and number value by ID', () => {
  const brief = briefSuperIntelligenceForce();
  const filled = fillDraft(checkDraft(draft(), brief), brief);
  assert.equal(filled.cover, 'Trump launches a Super Intelligence Force, led by his spy chief');
  assert.deepEqual(filled.slides[1]!.quote, {
    id: 'Q1',
    speaker: 'Donald Trump',
    speaker_subject: 'Donald Trump',
    speaker_role: 'President of the United States',
    text: 'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government … of all Americans,',
  });
  assert.deepEqual(filled.slides[2]!.numbers, [{ id: 'N1', value: '120 days', counts: 'time the task force has to report on the risks and opportunities presented by AI' }]);
  // Without an excerpt, the whole quote is used, word for word.
  const whole = draft();
  whole.slides[1]!.quote_excerpt = null;
  assert.equal(fillDraft(checkDraft(whole, brief), brief).slides[1]!.quote!.text, Q1_TEXT);
});

test('excerpts must be word for word, pieces in order', () => {
  assert.equal(isExactExcerpt('ensure that America … all Americans,', Q1_TEXT), true);
  assert.equal(isExactExcerpt('all Americans … ensure that America', Q1_TEXT), false);
  assert.equal(isExactExcerpt('America will lead the world in AI', Q1_TEXT), false);
});

test('the check rejects made-up excerpts, missing or cut-off quotes, wrong number IDs, unknown claim tags, bad cover choice', () => {
  assert.deepEqual(errorsOf((d) => { d.slides[1]!.quote_excerpt = 'America will lead the world in AI'; }), ["slides[1]: excerpt isn't word for word from Q1"]);
  assert.deepEqual(errorsOf((d) => { d.slides[1]!.quote_id = 'Q9'; }), ["slides[1]: quote Q9 isn't in the brief"]);
  assert.deepEqual(errorsOf((d) => { d.slides[1]!.quote_id = 'Q3'; d.slides[1]!.quote_excerpt = null; }), ['slides[1]: quote Q3 is marked cut off; never use it']);
  assert.deepEqual(errorsOf((d) => { d.slides[2]!.number_ids = []; }), ['slides[2]: stat slide needs 1 or 2 number ID(s), got 0']);
  assert.deepEqual(errorsOf((d) => { d.slides[2]!.number_ids = ['N7']; }), ["slides[2]: number N7 isn't in the brief"]);
  assert.deepEqual(errorsOf((d) => { d.slides[0]!.body!.facts = ['F99']; }), ["slides[0].body: claim tag F99 isn't in the brief"]);
  assert.deepEqual(errorsOf((d) => { d.chosen_cover = 4; }), ['chosen_cover: 4 is not one of the cover options']);
  assert.deepEqual(errorsOf((d) => { d.cover_options.pop(); d.chosen_cover = 1; }), ['cover_options: expected 3, got 2']);
  assert.match(errorsOf((d) => { (d.slides[0] as any).visual = { kind: 'photo', query: 'x' }; })[0]!, /visual\.kind: "photo" not one of person, company, logo/);
  assert.match(errorsOf((d) => { (d as any).chosen_cover = 1.5; })[0]!, /chosen_cover: expected integer/);
  // person, company and logo visuals name exactly one SUBJECTS entry.
  assert.deepEqual(errorsOf((d) => { d.slides[0]!.visual = v('person', 'Jay Clayton / Donald Trump'); }), [
    'slides[0].visual: person visual "Jay Clayton / Donald Trump" isn\'t exactly a SUBJECTS name',
  ]);
  assert.match(errorsOf((d) => { d.cover_options[0]!.fallback_visual = v('company', 'Trump'); })[0]!, /cover_options\[0\]\.fallback_visual: company visual "Trump"/);
  // A stat slide takes one or two numbers.
  assert.deepEqual(errorsOf((d) => { d.slides[2]!.number_ids = ['N1', 'N1', 'N1']; }), ['slides[2]: stat slide needs 1 or 2 number ID(s), got 3']);
});

// ── Stage (stubbed Claude) ─────────────────────────────────────────────

const usage = { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (stop: string, content: unknown[]) =>
  ({ id: `m_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, content, usage }) as unknown as Anthropic.Message;
const submit = (input: unknown) => ({ type: 'tool_use', id: `t_${Math.random()}`, name: 'submit_draft', input });

function scripted(responses: Anthropic.Message[]) {
  const requests: any[] = [];
  const create: MessagesCreate = async (params) => {
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  };
  return { create, requests };
}
const notWellKnown = async () => false;

test('Writer: model + effort from the stage config; cached tool and system; brief in the user message; filled draft back', async () => {
  const { create, requests } = scripted([msg('tool_use', [submit(draft())])]);
  const r = await runWriter(briefSuperIntelligenceForce(), { create, isWellKnown: notWellKnown });
  assert.ok(r.ok);
  assert.equal(r.filled.slides[2]!.numbers[0]!.value, '120 days');
  assert.equal(r.draftRetries, 0);
  assert.ok(r.costUsd > 0);
  const req = requests[0];
  assert.equal(req.model, STAGE_MODELS.writer.model);
  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.deepEqual(req.output_config, { effort: 'high' });
  assert.equal(req.system[0].text, WRITER_SYSTEM);
  assert.ok(req.system[0].cache_control);
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0].name, 'submit_draft');
  assert.ok(req.tools[0].cache_control && !req.tools[0].strict);
  assert.ok(!('tool_choice' in req));
  assert.ok(req.messages[0].content.startsWith('BRIEF\n'));
});

test('Writer: one retry with the check errors, then set aside', async () => {
  const bad = draft();
  bad.slides[1]!.quote_excerpt = 'America will lead the world in AI';
  const fixed = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(draft())])]).create, isWellKnown: notWellKnown });
  assert.ok(fixed.ok);
  assert.equal(fixed.draftRetries, 1);
  assert.equal(fixed.retryErrors.length, 1);
  assert.match(fixed.retryErrors[0]!, /excerpt isn't word for word from Q1/);

  const { create, requests } = scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(bad)])]);
  const failed = await runWriter(briefSuperIntelligenceForce(), { create, isWellKnown: notWellKnown });
  assert.equal(!failed.ok && failed.reason, 'malformed-output');
  assert.match(!failed.ok ? failed.detail : '', /excerpt isn't word for word/);
  const toolResult = requests[1].messages.at(-1).content[0];
  assert.equal(toolResult.is_error, true);
  assert.match(toolResult.content, /Fix these and call submit_draft again/);

  const noCall = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('end_turn', [{ type: 'text', text: 'Here is the draft…' }]), msg('end_turn', [{ type: 'text', text: '…' }])]).create, isWellKnown: notWellKnown });
  assert.equal(!noCall.ok && noCall.detail, 'ended without calling submit_draft');
});

test('runDay: the Writer stage drafts each brief; its cost lands under writer', async () => {
  const meter = createCostMeter();
  const r = await runDay({
    articles: STUB_ARTICLES,
    stages: {
      ...createStubStages(),
      write: createWriterStage({
        create: async (params) => {
          const brief = JSON.parse(((params.messages[0]!.content as string)).slice('BRIEF\n'.length));
          const d = draft();
          // A minimal valid draft for the stub brief (only F1 exists there).
          d.slides = [d.slides[0]!];
          d.cover_options = d.cover_options.map((c) => ({ ...c, facts: ['F1'] }));
          d.slides[0]!.headline.facts = ['F1'];
          d.slides[0]!.body!.facts = ['F1'];
          d.caption.facts = [];
          // The stub brief has no SUBJECTS: scenes only, and no tags.
          d.cover_options = d.cover_options.map((c) => ({ ...c, visual: v('thematic', 'office building'), fallback_visual: v('setting', 'open office'), subject_ids: [] }));
          d.slides[0]!.visual = v('thematic', 'smartphone screen');
          d.slides[0]!.fallback_visual = v('setting', 'open office');
          d.slides[0]!.subject_ids = [];
          assert.ok(brief.the_news.text);
          return msg('tool_use', [submit(d)]);
        },
        isWellKnown: notWellKnown,
      }),
    },
    meter,
    log: createInMemorySetAsideLog(),
    now: new Date('2026-10-05T15:00:00Z'),
  });
  assert.equal(r.posts.length, 2);
  assert.ok((meter.byStage().writer ?? 0) > 0);
  assert.equal(r.posts[0]!.render.slides[1]!.headline?.[0]?.text, 'Announced on Truth Social');
});

// ── Visual requests (sixth round, Tommy 2026-10-07; photo spec §4) ──

import { dropFailingVisuals, photoViewOf, visualHandoffFailures } from '@/lib/social/writer/writer';
import { sifDraftHandoff } from '@/fixtures/social/drafts';

test('visual requests by kind; a fallback that differs; scenes never name a SUBJECT; no stat-slide cap (seventh round)', () => {
  const brief = briefSuperIntelligenceForce();
  const fails = (edit: (d: DraftSubmission) => void) => {
    const d = sifDraftHandoff();
    edit(d);
    return visualHandoffFailures(d, brief, null).map((e) => `${e.section}: ${e.message}`).join(' | ');
  };
  assert.equal(fails(() => {}), '');
  // A conceptual scene the slide never mentions is fine; a scene naming a SUBJECT is not.
  assert.equal(fails((d) => (d.slides[0]!.fallback_visual = v('thematic', 'data center'))), '');
  assert.match(fails((d) => (d.slides[0]!.fallback_visual = v('thematic', 'Donald Trump podium'))), /slide 2\.fallback_visual: scene "Donald Trump podium" names Donald Trump/);
  assert.match(fails((d) => (d.slides[4]!.visual = v('setting', 'Clayton office'))), /names Jay Clayton/, "a person's last name counts");
  // person, company, logo: tagged on the slide, the right type.
  assert.match(fails((d) => (d.slides[4]!.visual = v('person', 'Donald Trump'))), /slide 6\.visual: person: Donald Trump isn't tagged on this slide/);
  assert.match(fails((d) => (d.slides[0]!.visual = v('company', 'Donald Trump'))), /Donald Trump is a person: ask for person:, not company:/);
  // product and event: 1–5 words.
  assert.equal(fails((d) => (d.slides[4]!.visual = v('event', 'executive order signing'))), '');
  assert.match(fails((d) => (d.slides[4]!.visual = v('event', 'a very long event name of many words'))), /name it in 1–5 words/);
  // The fallback differs; a quote's visual is its person speaker.
  assert.match(fails((d) => (d.slides[3]!.fallback_visual = { ...d.slides[3]!.visual })), /slide 5\.fallback_visual: the fallback visual repeats the visual/);
  assert.match(fails((d) => (d.slides[2]!.visual = v('thematic', 'flag on a pole'))), /slide 4\.visual: a quote slide's visual is its speaker \(person: Donald Trump\)/);
  // Seventh round: no stat-slide cap (variety comes from the rules and Jev's layouts).
  const stat = () => structuredClone(sifDraftHandoff().slides[3]!);
  assert.equal(fails((d) => d.slides.splice(4, 0, stat(), stat())), '');
  // Scenes may be 2–6 words, room for a word that rules out a homonym.
  assert.equal(fails((d) => (d.slides[0]!.fallback_visual = v('setting', 'university lecture hall with students'))), '');
  assert.match(fails((d) => (d.slides[0]!.fallback_visual = v('setting', 'a very large university lecture hall today'))), /a plain physical scene of 2–6 words/);
});

test('seventh round: a quote speaker without a verified headshot need not be the visual', async () => {
  const brief = briefSuperIntelligenceForce();
  const forWriter = await briefForWriter(brief, async () => true, async (s) => ({ kind: s.name === 'Super Intelligence Force' ? ('organization' as const) : ('person' as const), headshot: false, logo: false }));
  const view = photoViewOf(forWriter, { flags: true });
  const d = sifDraftHandoff();
  d.slides[2]!.visual = v('thematic', 'press briefing podium');
  const errs = visualHandoffFailures(d, brief, view).map((e) => `${e.section}: ${e.message}`).join(' | ');
  assert.doesNotMatch(errs, /a quote slide's visual is its speaker/);
});

test('final attempt: a failing visual becomes its fallback, else none (the icon); words unchanged; logged as visual-dropped', async () => {
  const bad = sifDraftHandoff();
  bad.cover_options[0]!.fallback_visual = v('thematic', 'Donald Trump rally');
  bad.slides[4]!.visual = v('setting', 'Clayton desk');
  const r = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(structuredClone(bad))])]).create, isWellKnown: notWellKnown });
  assert.ok(r.ok, 'the story continues');
  assert.match(r.retryErrors[0]!, /cover\.fallback_visual: scene "Donald Trump rally" names Donald Trump; .*never change the slide's words to fit a photo/);
  assert.equal(r.draft.cover_options[0]!.fallback_visual.query, '', 'a failing fallback → none');
  assert.deepEqual(r.draft.slides[4]!.visual, bad.slides[4]!.fallback_visual, 'a failing visual → its fallback');
  assert.equal(r.draft.slides[4]!.headline.text, bad.slides[4]!.headline.text, 'words unchanged');
  assert.ok(r.visualsDropped.some((l) => /^visual-dropped: slide 6 setting: Clayton desk → its fallback setting: government office/.test(l)), r.visualsDropped.join(' | '));
  assert.ok(r.visualsDropped.some((l) => /^visual-dropped: cover fallback thematic: Donald Trump rally → none/.test(l)));
});

test('dropFailingVisuals: visual and fallback both failing → none (the slide ends at its icon)', () => {
  const d = sifDraftHandoff();
  const { draft, dropped } = dropFailingVisuals(d, [{ section: 'slide 2.visual', message: 'x' }, { section: 'slide 2.fallback_visual', message: 'y' }]);
  assert.equal(draft.slides[0]!.visual.query, '');
  assert.equal(draft.slides[0]!.fallback_visual.query, '');
  assert.equal(dropped.length, 2);
});

test('link A: words stay when a visual request fails: rewriting the cover to fit the request fails; changing the request passes', async () => {
  const bad = sifDraftHandoff();
  bad.cover_options[0]!.fallback_visual = v('thematic', 'Donald Trump rally');
  const rewritten = structuredClone(bad);
  rewritten.cover_options[0]!.text = 'Trump launches a Super Intelligence Force at a rally';
  const r1 = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(rewritten)])]).create, isWellKnown: notWellKnown });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.detail, /cover: the words changed after its visual request failed; restore them and change the request instead/);
  const fixed = structuredClone(bad);
  fixed.cover_options[0]!.fallback_visual = v('setting', 'campaign rally');
  const r2 = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(fixed)])]).create, isWellKnown: notWellKnown });
  assert.ok(r2.ok);
});

test('fillDraft: a quote with no speaker_id has no speaker_subject (never the first subject by an undefined match)', () => {
  const b = briefSuperIntelligenceForce();
  b.quotes[0]!.speaker_id = null;
  b.subjects = b.subjects.map((x) => ({ ...x, id: undefined as unknown as string }));
  const filled = fillDraft(sifDraftHandoff(), b);
  assert.equal(filled.slides[2]!.quote!.speaker_subject, null);
});


test('a scene\'s fallback is a scene too: never a person, company or logo behind a thematic, setting, product or event visual', () => {
  const brief = briefSuperIntelligenceForce();
  const d = sifDraftHandoff();
  d.slides[0]!.visual = v('thematic', 'smartphone screen');
  d.slides[0]!.fallback_visual = v('person', 'Donald Trump');
  const errs = visualHandoffFailures(d, brief, null).map((e) => `${e.section}: ${e.message}`).join(' | ');
  assert.match(errs, /slide 2\.fallback_visual: the visual is thematic, so the fallback is a thematic, setting, product or event visual too, never person:/);
  d.slides[0]!.fallback_visual = v('setting', 'press briefing room');
  assert.doesNotMatch(visualHandoffFailures(d, brief, null).map((e) => e.message).join(), /so the fallback is/);
});

// ── Over-length rescue (2026-10-08: a story was set aside for a body 4 characters over) ──

test('a draft still over a length limit after the retry: one small call shortens just those lines, and the story survives', async () => {
  const long = sifDraftHandoff();
  long.slides[0]!.body = { text: `${'Trump announced the force in a Sunday morning post on Truth Social, and the White House said more details on its members and its budget would come soon '}after.`, facts: ['F1'] };
  assert.ok(long.slides[0]!.body!.text.length > 140);
  const calls: string[] = [];
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const reply = (name: string, input: unknown) => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, usage, content: [{ type: 'tool_use', id: `t${calls.length}`, name, input }] }) as unknown as Anthropic.Message;
  const create: MessagesCreate = async (params) => {
    const tool = (params.tools?.[0] as { name: string }).name;
    calls.push(tool);
    if (tool === 'submit_lines') {
      const lines = JSON.parse(String((params.messages[0]!.content as string).replace(/^LINES\n/, ''))) as Array<{ id: string }>;
      return reply('submit_lines', { lines: lines.map((l) => ({ id: l.id, text: 'Trump announced the force in a Sunday post on Truth Social.' })) });
    }
    return reply('submit_draft', long);
  };
  const r = await runWriter(briefSuperIntelligenceForce(), { create, isWellKnown: async () => false });
  assert.deepEqual(calls, ['submit_draft', 'submit_draft', 'submit_lines']);
  assert.ok(r.ok, r.ok ? '' : r.detail);
  assert.equal(r.filled.slides[0]!.body!.text, 'Trump announced the force in a Sunday post on Truth Social.');
  assert.ok(r.retryErrors.some((x) => /shortened to fit: slide 2 body \d+→\d+/.test(x)));
});

test('the shorten check: a line still over its limit, or with a new number, goes back', () => {
  const lines = [{ id: 'L1', where: 'slide 2 body', limit: 20, text: 'It costs $70 over a long stretch of time' }];
  assert.throws(() => checkLines({ lines: [{ id: 'L1', text: 'It costs $70 over a long stretch' }] }, lines), /limit 20/);
  assert.throws(() => checkLines({ lines: [{ id: 'L1', text: 'It costs $99' }] }, lines), /the number 99 wasn't in the line/);
  assert.equal(checkLines({ lines: [{ id: 'L1', text: 'It costs $70 now' }] }, lines).get('L1'), 'It costs $70 now');
});
