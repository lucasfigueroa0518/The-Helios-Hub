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
import { DraftValidationError, checkDraft, fillDraft, isExactExcerpt, type DraftSubmission } from '@/lib/social/writer/draft';
import { WRITER_ADDED_RULES, WRITER_MOMENTUM_RULES, WRITER_SYSTEM, writerUserMessage } from '@/lib/social/writer/prompt';
import { briefForWriter, runWriter } from '@/lib/social/writer/writer';

const PROMPTS = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
const codeBlocks = (from: string) => [...PROMPTS.slice(PROMPTS.indexOf(from)).matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]!);

const stock = (value: string) => ({ kind: 'stock' as const, value });

/** A valid draft for the Super Intelligence Force fixture brief. */
function draft(): DraftSubmission {
  return {
    cover_options: [
      { text: 'Trump launches a Super Intelligence Force, led by his spy chief', facts: ['F1', 'F2'], image: { kind: 'subject', value: 'Donald Trump' }, subject_ids: ['S1', 'S3'] },
      { text: "Trump's new AI task force has 120 days", facts: ['F4'], image: stock('wall clock'), subject_ids: ['S1'] },
      { text: 'The White House names its AI czar', facts: ['F3'], image: stock('White House'), subject_ids: [] },
    ],
    chosen_cover: 1,
    slides: [
      { type: 'text', headline: { text: 'Announced on Truth Social', facts: ['F1'] }, body: { text: 'Trump announced the force in a Sunday morning post.', facts: ['F1'] }, quote_id: null, quote_excerpt: null, number_ids: [], image: { kind: 'none', value: '' }, subject_ids: ['S1'], spread_with_next: false },
      { type: 'quote', headline: { text: 'His pitch', facts: ['Q1'] }, body: null, quote_id: 'Q1', quote_excerpt: 'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government … of all Americans,', number_ids: [], image: { kind: 'subject', value: 'Donald Trump' }, subject_ids: ['S1'], spread_with_next: false },
      { type: 'stat', headline: { text: 'It has a deadline', facts: ['N1'] }, body: null, quote_id: null, quote_excerpt: null, number_ids: ['N1'], image: { kind: 'none', value: '' }, subject_ids: [], spread_with_next: false },
    ],
    follow: 'Follow Helios for AI news without the hype.',
    caption: { text: 'Trump announced a Super Intelligence Force. Source: TechCrunch, October 4, 2026.', facts: ['F1'] },
    edit_notes: ['Led with the spy chief role, not the name.', 'Slide 2: IMAGE none, a social-media post has nothing physical to show.'],
  };
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
  const sectionList = tested.slice(tested.indexOf('\n\nOUTPUT\n') + '\n\nOUTPUT\n'.length, tested.indexOf('\n\nBRIEF\n'));
  const caption = codeBlocks('## 3. Writer')[0]!
    .replace('${VOICE_BLOCK}', VOICE_BLOCK)
    .replace("${renderRulesFor('caption')}", renderRulesFor('writer'))
    // Caption wording fixes (2026-10-05).
    .replace('the final SLIDES you were given', 'the slides you wrote')
    .replace("that's the Writer/Editor's decision — respect it.", "that's the Writer/Editor's decision. Respect it.")
    // Source line built by code (2026-10-06): ending item 3 dropped.
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
  assert.ok(WRITER_ADDED_RULES.includes(codeBlocks('- **Change 2, the spread line:**')[0]!), 'spread line word for word');
  assert.equal(WRITER_MOMENTUM_RULES, codeBlocks('**Writer prompt v2')[0], 'v2 rules word for word from the prompts file');
  assert.ok(!WRITER_SYSTEM.includes('—'), 'no em dashes anywhere in the Writer prompt');
  assert.ok(!WRITER_SYSTEM.includes('Source:'), 'the Source line is built by code, not asked of the Writer');
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
  assert.deepEqual(errorsOf((d) => { d.slides[2]!.number_ids = []; }), ['slides[2]: stat slide needs 1 number ID(s), got 0']);
  assert.deepEqual(errorsOf((d) => { d.slides[2]!.number_ids = ['N7']; }), ["slides[2]: number N7 isn't in the brief"]);
  assert.deepEqual(errorsOf((d) => { d.slides[0]!.body!.facts = ['F99']; }), ["slides[0].body: claim tag F99 isn't in the brief"]);
  assert.deepEqual(errorsOf((d) => { d.chosen_cover = 4; }), ['chosen_cover: 4 is not one of the cover options']);
  assert.deepEqual(errorsOf((d) => { d.cover_options.pop(); d.chosen_cover = 1; }), ['cover_options: expected 3, got 2']);
  assert.match(errorsOf((d) => { (d.slides[0] as any).image = { kind: 'photo', value: 'x' }; })[0]!, /image\.kind: "photo" not one of subject, article, stock/);
  assert.match(errorsOf((d) => { (d as any).chosen_cover = 1.5; })[0]!, /chosen_cover: expected integer/);
  // Image subjects are single entities that exactly match a SUBJECTS name.
  assert.deepEqual(errorsOf((d) => { d.slides[0]!.image = { kind: 'subject', value: 'Jay Clayton / Donald Trump' }; }), [
    'slides[0].image: subject image "Jay Clayton / Donald Trump" isn\'t exactly a SUBJECTS name (one person or organization)',
  ]);
  assert.match(errorsOf((d) => { d.cover_options[0]!.image = { kind: 'subject', value: 'Trump' }; })[0]!, /cover_options\[0\]\.image: subject image "Trump"/);
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
          // The stub brief has no SUBJECTS, so subject images would fail the check.
          d.cover_options = d.cover_options.map((c) => ({ ...c, image: stock(c.text.split(' ').filter((w) => w.length >= 5)[0]!.toLowerCase()) }));
          d.slides[0]!.image = { kind: 'none', value: '' };
          d.edit_notes = ['Slide 2: IMAGE none, a post on social media has nothing physical to show.'];
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

// ── Handoff (Tommy, 2026-10-06): photo_available, filtered article photos, first-submission image check ──

import { dropFailingImageRequests, imageHandoffFailures } from '@/lib/social/writer/writer';
import { sifDraftHandoff } from '@/fixtures/social/drafts';

test('handoff: one EDIT NOTES line per none (the slide after a spread excepted)', () => {
  const d = sifDraftHandoff();
  assert.deepEqual(imageHandoffFailures(d, briefSuperIntelligenceForce(), null), []);
  d.edit_notes = d.edit_notes.slice(1);
  assert.match(imageHandoffFailures(d, briefSuperIntelligenceForce(), null).map((e) => e.message).join(), /IMAGE none but \d EDIT NOTES line/);
});

// ── Link A (Tommy, 2026-10-06): words stay, every check on every attempt, quote slides ──


test('a failing IMAGE request no longer kills a story: on the final attempt it becomes none (words unchanged), logged as image-request-dropped; the cover keeps its fallback', async () => {
  const bad = sifDraftHandoff();
  bad.cover_options[0]!.image = { kind: 'stock', value: 'city skyline' };
  bad.slides[0]!.image = { kind: 'stock', value: 'video call' };
  const r = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(structuredClone(bad))])]).create, isWellKnown: notWellKnown });
  assert.ok(r.ok, 'the story continues');
  assert.match(r.retryErrors[0]!, /cover\.image: stock "city skyline" doesn't name a physical thing this slide mentions; change the request .*never change the slide's words to fit a photo/);
  assert.equal(r.draft.cover_options[0]!.image.kind, 'none');
  assert.equal(r.draft.slides[0]!.image.kind, 'none');
  assert.equal(r.draft.cover_options[0]!.text, bad.cover_options[0]!.text, 'words unchanged');
  assert.equal(r.draft.slides[0]!.headline.text, bad.slides[0]!.headline.text);
  assert.ok(r.imageRequestsDropped.some((l) => /^image-request-dropped: cover stock: city skyline → none/.test(l)), r.imageRequestsDropped.join(' | '));
  assert.ok(r.imageRequestsDropped.some((l) => /^image-request-dropped: slide 2 stock: video call → none/.test(l)));
});

test('dropping a spread\'s first photo also ends the spread', () => {
  const d = sifDraftHandoff();
  d.slides[0]!.image = { kind: 'stock', value: 'phone screen' };
  d.slides[0]!.spread_with_next = true;
  const { draft } = dropFailingImageRequests(d, [{ section: 'slide 2.image', message: 'x' }]);
  assert.equal(draft.slides[0]!.image.kind, 'none');
  assert.equal(draft.slides[0]!.spread_with_next, false);
});

test('link A: words stay when a photo request fails: rewriting the cover to fit the request fails; changing the request passes', async () => {
  const bad = sifDraftHandoff();
  bad.cover_options[0]!.image = { kind: 'stock', value: 'city skyline' };
  // Retry 1: the words change to mention the skyline (the Mistral "datacenters" case).
  const rewritten = structuredClone(bad);
  rewritten.cover_options[0]!.text = 'Trump launches a Super Intelligence Force under the city skyline';
  const r1 = await runWriter(briefSuperIntelligenceForce(), { create: scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(rewritten)])]).create, isWellKnown: notWellKnown });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.detail, /cover: the words changed after its IMAGE request failed; restore them and change the request instead/);
  // Retry 2: the request changes; the words stay.
  const fixed = structuredClone(bad);
  fixed.cover_options[0]!.image = { kind: 'subject', value: 'Donald Trump' };
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

