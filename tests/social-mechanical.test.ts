/**
 * M7 mechanical guarantees (spec §6): one test per fix and per check.
 * Pure functions, offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraft, sifDraftHandoff } from '@/fixtures/social/drafts';
import {
  applySilentFixes, buildSourceLine, checkBackground, checkCaption, checkDroppedText, checkLimits, checkPhotoCredit, checkQuoteMarks, checkVoice,
  expectedSlideText, fixDashes, fixQuoteMarks, fixTrailingComma, fixWhitespace, LIMITS, quotedSpans,
} from '@/lib/social/mechanical/checks';
import { voiceHits } from '@/lib/social/mechanical/voice-lists';
import type { Photo } from '@/lib/social/photos/find';
import { fillDraft, type FilledDraft } from '@/lib/social/writer/draft';

const brief = briefSuperIntelligenceForce;
const draft = (edit?: (d: FilledDraft) => void): FilledDraft => {
  const d = fillDraft(sifDraft(), brief());
  d.caption.text = 'Trump announced a Super Intelligence Force on Sunday.\n\nSource: TechCrunch, October 4, 2026.';
  edit?.(d);
  return d;
};
const ids = (f: Array<{ id: string }>) => f.map((x) => x.id);

// ── A. Silent fixes ──────────────────────────────────────────────────────

test('F1 dashes: em dash → comma, numeric en dash → hyphen, spaced double hyphen → comma; hyphens kept', () => {
  assert.equal(fixDashes('Le Chonk is live — the weights are not.'), 'Le Chonk is live, the weights are not.');
  assert.equal(fixDashes('2024–2025 results'), '2024-2025 results');
  assert.equal(fixDashes('fast -- and cheap'), 'fast, and cheap');
  assert.equal(fixDashes('AI-driven, open-weight'), 'AI-driven, open-weight');
});

test('F2 quote marks: straight → typographic; apostrophes → ’', () => {
  assert.equal(fixQuoteMarks(`He said "no" and it's done`), 'He said “no” and it’s done');
  assert.equal(fixQuoteMarks("the 'duct tape' line"), 'the ‘duct tape’ line');
});

test('F3 whitespace and markdown leftovers', () => {
  assert.equal(fixWhitespace('**Bold**  claim .\n\n\n\n- item'), 'Bold claim.\n\nitem');
});

test('F4 trailing comma stripped from a displayed quote; words unchanged', () => {
  assert.equal(fixTrailingComma('of all Americans,'), 'of all Americans');
  assert.equal(fixTrailingComma('of all Americans , '), 'of all Americans');
  assert.equal(fixTrailingComma('a, b'), 'a, b');
});

test('applySilentFixes: fixes the stages’ text, never a quote’s words, and logs each fix', () => {
  const d = draft((x) => {
    x.slides[0]!.body!.text = 'Trump announced it — on Truth Social.';
    x.slides[2]!.quote!.text = 'coordinating — the effort,';
  });
  const r = applySilentFixes(d);
  assert.equal(r.draft.slides[0]!.body!.text, 'Trump announced it, on Truth Social.');
  assert.equal(r.draft.slides[2]!.quote!.text, 'coordinating — the effort', 'quote: only the trailing comma');
  assert.ok(ids(r.fixes).includes('F1') && ids(r.fixes).includes('F4'));
  assert.ok(r.fixes.every((f) => f.before !== f.after));
});

// ── B. Checks ────────────────────────────────────────────────────────────

test('C1 limits: over the limit fails with the exact overage; never trimmed', () => {
  const long = 'x'.repeat(LIMITS.headline + 7);
  const d = draft((x) => (x.slides[1]!.headline.text = long));
  const f = checkLimits(d);
  assert.deepEqual(ids(f), ['C1']);
  assert.match(f[0]!.detail, /52 chars, limit 45 \(7 over\)/);
  assert.equal(d.slides[1]!.headline.text, long);
  assert.deepEqual(checkLimits(draft()), []);
});

test('C1 copy budget (2026-10-08): headline and body share 168; the split is elastic within headline 15–45 and body ≤140', () => {
  const set = (h: number, b: number) => draft((x) => { x.slides[0]!.headline.text = 'h'.repeat(h); x.slides[0]!.body!.text = 'b'.repeat(b); });
  assert.deepEqual(checkLimits(set(28, 140)), [], 'short headline, full body');
  assert.deepEqual(checkLimits(set(45, 123)), [], 'full headline, shorter body');
  const both = checkLimits(set(45, 130));
  assert.deepEqual(both.map((f) => f.where), ['slide 2 headline + body']);
  assert.match(both[0]!.detail, /175 chars together, limit 168 \(7 over\)/);
  const tiny = checkLimits(set(10, 50));
  assert.deepEqual(tiny.map((f) => f.where), ['slide 2 headline']);
  assert.match(tiny[0]!.detail, /at least 15/);
});

test('C2 quote marks: allowed only around a QUOTES entry word for word', () => {
  assert.deepEqual(quotedSpans('He called it “freaking insane” and ‘bad’, but it’s fine'), ['freaking insane', 'bad']);
  const ok = draft((x) => (x.slides[0]!.body!.text = 'Clayton said it was about “not being first.”'));
  assert.deepEqual(checkQuoteMarks(ok, brief()), []);
  const bad = draft((x) => (x.slides[0]!.body!.text = 'Critics called it “extremely reckless”.'));
  const f = checkQuoteMarks(bad, brief());
  assert.deepEqual(ids(f), ['C2']);
  assert.match(f[0]!.detail, /extremely reckless/);
});

test('C3 voice list: banned words, phrases, openers, "!" and emoji in the stages’ words; quoted speech exempt', () => {
  assert.deepEqual(voiceHits('A groundbreaking step').map((h) => h.match), ['groundbreaking']);
  assert.deepEqual(voiceHits('It reshapes the AI space').map((h) => h.kind).sort(), ['phrase', 'word']);
  assert.deepEqual(voiceHits('It rose. Meanwhile, rivals fell!').map((h) => h.kind).sort(), ['exclamation', 'opener']);
  assert.deepEqual(voiceHits('Transformers are a model design'), [], '"transformer" is not "transform"');
  const quoted = draft((x) => (x.slides[0]!.body!.text = 'He called it “a revolutionary moment”.'));
  assert.deepEqual(checkVoice(quoted), []);
  const own = draft((x) => (x.slides[0]!.body!.text = 'A revolutionary moment, experts say.'));
  assert.deepEqual(checkVoice(own).map((f) => f.detail).sort(), ['phrase: "experts say"', 'word: "revolutionary"']);
});

test('C4 caption: no hashtags', () => {
  assert.deepEqual(checkCaption(draft()), []);
  assert.match(checkCaption(draft((x) => (x.caption.text += '\n#AI #Trump')))[0]!.detail, /hashtags: #AI #Trump/);
  assert.deepEqual(checkCaption(draft((x) => (x.caption.text = 'Issue #3 is out'))), [], '"#3" is a number, not a hashtag');
});

test('F5 Source line: built from the outlets the post’s claim tags cite, deduped, in SOURCES order; replaces the Writer’s line', () => {
  const b = brief();
  b.sources = [{ outlet: 'TechCrunch', date: null, url: 'u1', kind: 'original' }, { outlet: 'The Wall Street Journal (paywalled)', date: null, url: 'u2', kind: 'original' }];
  b.facts[0]!.sources = ['The Wall Street Journal (paywalled)', 'TechCrunch'];
  const d = draft((x) => (x.caption.text = 'Trump announced it.\n\nSource: Somewhere Else, 2026.'));
  assert.equal(buildSourceLine(d, b), 'Source: TechCrunch and The Wall Street Journal.');
  const r = applySilentFixes(d, b);
  assert.equal(r.draft.caption.text, 'Trump announced it.\n\nSource: TechCrunch and The Wall Street Journal.');
  assert.ok(r.fixes.some((f) => f.id === 'F5'));
  // No cited outlet → no line (the Writer's is still removed).
  const none = brief();
  [...none.facts, ...none.background].forEach((f) => (f.sources = []));
  none.quotes.forEach((q) => (q.via = []));
  none.numbers.forEach((n) => (n.sources = []));
  assert.equal(buildSourceLine(draft(), none), null);
});

test('C5 at most 2 background slides (slides resting only on B# entries)', () => {
  assert.deepEqual(checkBackground(draft()), []);
  const d = draft((x) => {
    for (const i of [0, 1, 4]) {
      x.slides[i]!.headline.facts = ['B1'];
      if (x.slides[i]!.body) x.slides[i]!.body!.facts = ['B2'];
    }
  });
  assert.match(checkBackground(d)[0]!.detail, /4 background slides/, 'the fixture already has one (B2)');
});

test('C6 photo credit: present, allowed licence, no agency credit', () => {
  const p = (credit: string, source: Photo['source'] = 'stock'): Photo => ({ url: 'u', credit, source, width: 1, height: 1, qid: null, subject: null });
  const b = brief();
  assert.deepEqual(checkPhotoCredit(p('Jane Doe, CC BY · via flickr'), 'slide 2', b), []);
  assert.deepEqual(checkPhotoCredit(p('NASA (public domain) · Wikimedia Commons', 'commons'), 'slide 2', b), []);
  assert.match(checkPhotoCredit(p(''), 'slide 2', b)[0]!.detail, /without a credit/);
  assert.match(checkPhotoCredit(p('Jane Doe · via flickr'), 'slide 2', b)[0]!.detail, /no allowed licence/);
  assert.match(checkPhotoCredit(p('Kevin Dietsch / Getty Images, CC BY'), 'slide 2', b)[0]!.detail, /agency/);
  assert.deepEqual(checkPhotoCredit(p('Official White House Photo by Daniel Torok', 'article'), 'slide 2', b), []);
  assert.match(checkPhotoCredit(p('Photo: John Smith', 'article'), 'slide 2', b)[0]!.detail, /not allowed/);
});

test('C7 dropped text: every draft field must appear on its rendered slide', () => {
  const d = draft();
  const rendered = expectedSlideText(d).map((f) => f.join(' ').toUpperCase());
  assert.deepEqual(checkDroppedText(d, rendered), [], 'case and quote marks are ignored');
  // The frozen quote layout drops the slide's headline.
  const quoteSlide = 1 + d.slides.findIndex((s) => s.type === 'quote');
  rendered[quoteSlide] = `${d.slides[quoteSlide - 1]!.quote!.text} ${d.slides[quoteSlide - 1]!.quote!.speaker}`;
  const f = checkDroppedText(d, rendered);
  assert.deepEqual(ids(f), ['C7']);
  assert.match(f[0]!.detail, /His pitch for the force/);
});

// ── Wiring (Tommy, 2026-10-06) ───────────────────────────────────────────

import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';

import { createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import { fitOkFor } from '@/fixtures/social/render-text';
import { createDesignStage } from '@/lib/social/pipeline/design-stage';
import { createMechanicalStage } from '@/lib/social/pipeline/mechanical-stage';
import type { Brief as PipelineBrief, Draft, ScoredCandidate } from '@/lib/social/pipeline/types';
import { CHECKED_RULES } from '@/lib/social/prompts/rules-block';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { runWriter } from '@/lib/social/writer/writer';
import type { DraftSubmission } from '@/lib/social/writer/draft';

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const submitMsg = (input: unknown) =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage, content: [{ type: 'tool_use', id: `t${Math.random()}`, name: 'submit_draft', input }] }) as unknown as Anthropic.Message;
function scripted(drafts: DraftSubmission[]): { create: MessagesCreate; requests: Anthropic.MessageCreateParamsNonStreaming[] } {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return { requests, create: async (p) => { requests.push(structuredClone(p)); return submitMsg(drafts.shift()); } };
}
const sub = (edit: (d: DraftSubmission) => void) => { const d = sifDraftHandoff(); edit(d); return d; };
const tooLong = 'x '.repeat(40).trim();

test('Writer code check: a C1 overage goes back once with the exact problem; fixed on the retry', async () => {
  const s = scripted([sub((d) => (d.slides[0]!.headline.text = tooLong)), sifDraftHandoff()]);
  const r = await runWriter(brief(), { create: s.create, isWellKnown: async () => false });
  assert.ok(r.ok);
  assert.equal(r.draftRetries, 1);
  assert.match(r.retryErrors[0]!, /C1 slide 2 headline: 79 chars, limit 45 \(34 over\)/);
});

test('Writer code check: style (C3) blocks only the first submission; a hard failure (C1) on the retry sets it aside', async () => {
  const style = sub((d) => (d.slides[0]!.body!.text = 'A groundbreaking post on Truth Social.'));
  const soft = await runWriter(brief(), { create: scripted([style, structuredClone(style)]).create, isWellKnown: async () => false });
  assert.ok(soft.ok, 'style survives the retry as a warning for later');
  const long = sub((d) => (d.slides[0]!.headline.text = tooLong));
  const hard = await runWriter(brief(), { create: scripted([long, structuredClone(long)]).create, isWellKnown: async () => false });
  assert.equal(hard.ok, false);
});

const pbrief = (): PipelineBrief => ({ storyId: 's1', parsed: brief(), raw: '', pages: [] });
const pdraft = (edit?: (d: FilledDraft) => void): Draft => ({ storyId: 's1', submission: sifDraft(), filled: draft(edit) });

test('mechanical stage: fixes applied and logged, Source line built, style failures carried as warnings', async () => {
  const r = await createMechanicalStage()(pdraft((x) => (x.slides[0]!.body!.text = 'A groundbreaking post — on Truth Social.')), pbrief());
  assert.ok(r.ok);
  assert.equal(r.value.filled.slides[0]!.body!.text, 'A groundbreaking post, on Truth Social.');
  assert.ok(r.value.filled.caption.text.endsWith('\n\nSource: TechCrunch and The Wall Street Journal.'), r.value.filled.caption.text);
  assert.deepEqual(r.value.mechanical!.warnings.map((w) => w.id), ['C3']);
  assert.ok(r.value.mechanical!.fixes.some((f) => f.id === 'F1') && r.value.mechanical!.fixes.some((f) => f.id === 'F5'));
});

test('mechanical stage: a hard failure after the Fact-checker sets the story aside (C1 over-limit, C2 malformed-output)', async () => {
  const long = await createMechanicalStage()(pdraft((x) => (x.slides[1]!.headline.text = tooLong)), pbrief());
  assert.equal(long.ok, false);
  assert.equal((long as { reasonCode: string }).reasonCode, 'over-limit');
  const quoted = await createMechanicalStage()(pdraft((x) => (x.slides[0]!.body!.text = 'Critics called it “extremely reckless”.')), pbrief());
  assert.equal((quoted as { reasonCode: string }).reasonCode, 'malformed-output');
});

const story = { id: 's1', title: 't', url: 'https://techcrunch.com/x', outlets: ['TechCrunch'], publishedAt: new Date('2026-10-04T12:00:00Z') } as ScoredCandidate;
const designDeps = (fitCheck = async (post: Parameters<typeof fitOkFor>[0]) => fitOkFor(post)) => ({
  jev: async (req: { state: unknown; questions: Record<string, unknown> }) => ({ answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { noul: k.startsWith('people') || k.startsWith('landmark') || k.startsWith('brand') || k.startsWith('repeats_') ? 0.05 : 0.95 }])), usage: { input_tokens: 100, output_tokens: 0 }, model: 'stub' }),
  http: createFakeHttp(SIF_WEB).http,
  fitCheck,
});

test('design: C7 dropped text fails the render (render-failed)', async () => {
  const fitCheck = async (post: Parameters<typeof fitOkFor>[0]) => {
    const r = fitOkFor(post);
    r.slideText[3] = r.slideText[3]!.replace('His pitch for the force', '');
    return r;
  };
  const r = await createDesignStage(designDeps(fitCheck) as never)(pdraft(), pbrief(), story);
  assert.equal(r.ok, false);
  assert.equal((r as { reasonCode: string }).reasonCode, 'render-failed');
  assert.match((r as { detail: string }).detail, /C7 slide 4: not on the rendered slide: "His pitch for the force"/);
});

test('design: C6 drops a story-slide photo whose credit fails (agency): text-only, logged', async () => {
  const getty = { url: 'https://s/getty.jpg', foreignLandingUrl: '', mime: 'image/jpeg', width: 2000, height: 1300, license: 'by', creator: 'Kevin Dietsch / Getty Images', source: 'flickr', title: 'wall clock', tags: [] };
  const deps = { ...designDeps(), stock: async () => [getty] };
  const r = await createDesignStage(deps as never)(pdraft(), pbrief(), story);
  assert.ok(r.ok);
  assert.ok(r.value.checks.photoReplacements.length >= 1, JSON.stringify(r.value.checks));
  assert.match(r.value.checks.photoReplacements[0]!, /agency credit \(getty\) → icon/);
  assert.ok(!r.value.render.slides.some((sl) => sl.photoUrl === getty.url), 'the Getty photo never reaches the render');
});

test('CHECKED_RULES matches the prompts file word for word', () => {
  const prompts = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
  const block = /\*\*Checked rules[\s\S]*?```\n([\s\S]*?)\n```/.exec(prompts)![1];
  assert.equal(CHECKED_RULES, block);
});

// ── C8: no repetition within a slide (Tommy and Lucas, 2026-10-06) ───────

import { checkRepetition } from '@/lib/social/mechanical/checks';
import { EDITOR_CHECKED_RULE, renderRulesFor as rulesFor } from '@/lib/social/prompts/rules-block';

test('C8: the same number in the headline and the big number fails (the Mistral "38" case)', () => {
  const d = draft((x) => (x.slides[3]!.headline.text = '120 days to report'));
  const f = checkRepetition(d, brief());
  assert.deepEqual(ids(f), ['C8']);
  assert.match(f[0]!.detail, /the number 120 is in both headline and number 1/);
  assert.deepEqual(checkRepetition(draft(), brief()), [], 'the fixture headline "It has a deadline" says what the number means');
});

test('C8: digits inside names are not numbers (Mistral Large 4, GPT-6); only NUMBERS values count', () => {
  const d = draft((x) => {
    x.slides[0]!.headline.text = 'GPT-6 meets Mistral Large 4';
    x.slides[0]!.body!.text = 'Mistral Large 4 and GPT-6 were both named.';
  });
  assert.deepEqual(checkRepetition(d, brief()).filter((f) => /the number/.test(f.detail)), []);
});

test('C8: a phrase of four or more words in two fields of one slide fails; across slides is fine', () => {
  const d = draft((x) => {
    x.slides[0]!.headline.text = 'Announced on Truth Social';
    x.slides[0]!.body!.text = 'Trump announced it, announced on Truth Social this morning.';
  });
  assert.match(checkRepetition(d, brief()).map((f) => f.detail).join(), /"announced on truth social" is in both headline and body/);
  const across = draft((x) => (x.slides[1]!.headline.text = 'Announced on Truth Social too'));
  assert.deepEqual(checkRepetition(across, brief()), []);
});

test('C8 goes back to the Editor only (once), not the Writer; after the Fact-checker it is a warning', async () => {
  const rep = sifDraftHandoff();
  rep.slides[3]!.headline = { text: '120 days to report', facts: ['N1'] };
  const w = await runWriter(brief(), { create: scripted([rep]).create, isWellKnown: async () => false });
  assert.ok(w.ok && w.draftRetries === 0, 'the Writer is not sent back for C8');
  const { runEditor } = await import('@/lib/social/editor/editor');
  const e = await runEditor(brief(), rep, { create: scripted([rep, sifDraftHandoff()]).create });
  assert.ok(e.ok);
  assert.equal(e.retries, 1);
  assert.match(e.retryErrors[0]!, /C8 slide 5: the number 120/);
  const m = await createMechanicalStage()(pdraft((x) => (x.slides[3]!.headline.text = '120 days to report')), pbrief());
  assert.ok(m.ok);
  assert.deepEqual(m.value.mechanical!.warnings.map((x) => x.id), ['C8']);
  assert.ok(rulesFor('editor').includes(EDITOR_CHECKED_RULE) && !rulesFor('writer').includes(EDITOR_CHECKED_RULE));
  const prompts = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
  const blocks = [...prompts.slice(prompts.indexOf('**No repetition within a slide')).matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(EDITOR_CHECKED_RULE, blocks[1], 'Editor line word for word from the prompts file');
});
