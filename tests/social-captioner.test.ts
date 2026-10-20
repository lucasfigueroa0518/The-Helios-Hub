/**
 * Social captions redesign, Task 4: the carousel captioner (offline: stubbed
 * Claude; no network). Prompt shape and caching, the per-post user message,
 * and the code check with its one retry.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { buildLineInstruction, type RecentClosing } from '@/lib/social/captions/build-line';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';
import { joinCaption, runCaptioner } from '@/lib/social/captioner/captioner';
import { CAPTIONER_CAROUSEL_RULES, CAPTIONER_CLOSING, CAPTIONER_INTRO, CAPTIONER_SYSTEM, SUBMIT_CAPTION_TOOL, captionerUserMessage } from '@/lib/social/captioner/prompt';
import { applySilentFixes } from '@/lib/social/mechanical/checks';
import { withJoinedCaption } from '@/lib/social/pipeline/mechanical-stage';
import { STAGE_MODELS } from '@/lib/social/pipeline/models';
import { CAPTIONER_CHECKED_RULES, renderRulesFor } from '@/lib/social/prompts/rules-block';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { checkDraft, fillDraft } from '@/lib/social/writer/draft';

const PROMPTS = readFileSync('docs/superpowers/specs/2026-10-04-helios-social-prompts.md', 'utf8');
const codeBlocks = (from: string) => [...PROMPTS.slice(PROMPTS.indexOf(from)).matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]!);

const usage = { input_tokens: 4000, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (stop: string, content: unknown[]) =>
  ({ id: `m_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, content, usage }) as unknown as Anthropic.Message;
const submit = (input: unknown) => ({ type: 'tool_use', id: `t_${Math.random()}`, name: 'submit_caption', input });

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

const brief = briefSuperIntelligenceForce();
function draft() {
  const submission = checkDraft(sifDraftHandoff(), brief);
  return { submission, filled: fillDraft(submission, brief) };
}

const NEWS = {
  text: "The White House now has a task force for super intelligence, and it has 120 days to say what that means.\n\nTrump announced the Super Intelligence Force in a Sunday post on Truth Social. National intelligence director Jay Clayton will lead it, the Wall Street Journal reports.\n\nIts charter reportedly asks for plans against SI-enabled threats while preventing overregulation.\n\nThat is a short clock for a big question.\n\nWhat would you want that report to settle first?",
  facts: ['F1', 'F2', 'F3', 'N1', 'F6'],
};
const READ = {
  text: 'For a law firm or an insurance broker, the rules on AI tools may get looser before they get tighter. At Helios we would build for both: systems you own, ready for whichever way the report lands.',
  facts: ['F6'],
};
const good = () => ({ news: structuredClone(NEWS), read: structuredClone(READ) });

const closings: RecentClosing[] = [
  { closing: 'Send this to the person on your team still copying leads by hand.', buildLine: false, createdAt: new Date('2026-10-18T02:00:00Z') },
  { closing: 'Which part of your week would you hand to an agent first?', buildLine: true, createdAt: new Date('2026-10-17T02:00:00Z') },
];

const run = (responses: Anthropic.Message[], recent: RecentClosing[] = [], include = false) => {
  const s = scripted(responses);
  return { s, result: runCaptioner(brief, draft(), recent, include, { create: s.create }) };
};

// ── Prompt ──────────────────────────────────────────────────────────────

test('system is static and cached', async () => {
  const { s, result } = run([msg('tool_use', [submit(good())])]);
  const r = await result;
  assert.ok(r.ok, r.ok ? '' : r.detail);
  const req = s.requests[0];
  assert.equal(req.system[0].text, CAPTIONER_SYSTEM);
  assert.ok(CAPTIONER_SYSTEM.includes(HELIOS_CONTEXT));
  assert.equal(req.system[0].cache_control?.type, 'ephemeral');
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0].name, 'submit_caption');
  assert.equal(req.tools[0].cache_control?.type, 'ephemeral');
  assert.equal(req.model, STAGE_MODELS.captioner.model);
  assert.deepEqual(req.output_config, { effort: 'medium' });
  assert.deepEqual(STAGE_MODELS.captioner, { model: 'claude-sonnet-5-5', effort: 'medium' });
});

test('per-post inputs go in the user message', async () => {
  const { s, result } = run([msg('tool_use', [submit(good())])], closings, true);
  assert.ok((await result).ok);
  const user = s.requests[0].messages[0].content as string;
  for (const c of closings) {
    assert.ok(user.includes(c.closing), c.closing);
    assert.ok(!CAPTIONER_SYSTEM.includes(c.closing));
  }
  assert.ok(user.includes(buildLineInstruction(true)));
  assert.ok(!CAPTIONER_SYSTEM.includes(buildLineInstruction(true)) && !CAPTIONER_SYSTEM.includes(buildLineInstruction(false)));
  // The final slides and the BRIEF ride along too.
  assert.ok(user.includes('Announced on Truth Social') && user.includes('120 days'));
  assert.ok(user.includes('BRIEF\n{'));
});

test('captionerUserMessage: slides, the BRIEF as the Writer sees it, closings, then the build-line instruction', () => {
  const { filled } = draft();
  const m = captionerUserMessage(filled, brief, closings, false);
  assert.ok(m.startsWith('SLIDES'));
  assert.ok(m.includes(`BRIEF\n${JSON.stringify(brief, null, 2)}`));
  assert.ok(m.includes(filled.cover));
  for (const s of filled.slides) {
    assert.ok(m.includes(s.headline.text), s.headline.text);
    if (s.body) assert.ok(m.includes(s.body.text), s.body.text);
  }
  assert.ok(m.indexOf('SLIDES') < m.indexOf('BRIEF') && m.indexOf('BRIEF') < m.indexOf(closings[0]!.closing));
  assert.ok(m.trimEnd().endsWith(buildLineInstruction(false)));
  // An empty closings log adds no block.
  assert.ok(!captionerUserMessage(filled, brief, [], false).includes('Recent captions'));
});

test('CAPTIONER_SYSTEM retires the wire framing', () => {
  assert.doesNotMatch(CAPTIONER_SYSTEM, /Reuters/);
  assert.doesNotMatch(CAPTIONER_SYSTEM, /No opinions/);
  assert.match(CAPTIONER_SYSTEM, /the Helios line/);
  assert.ok(!CAPTIONER_SYSTEM.includes('—'), 'no em dashes');
  assert.ok(!CAPTIONER_SYSTEM.includes('${'), 'no unrendered template');
  // Review fixes (2026-10-19): the caption's sentence-length rule lives here, not in the shared VOICE_BLOCK.
  assert.ok(CAPTIONER_CAROUSEL_RULES.includes('three short sentences in a row is too many'));
  assert.ok(!/caption/i.test(VOICE_BLOCK), 'the Writer and Editor get no caption voice rule');
  // Hedges only where they change belief (spec shared rule 3); background capped at one clause.
  assert.doesNotMatch(CAPTIONER_SYSTEM, /Keep every hedge/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /at most one clause about an earlier event/);
});

test('CAPTIONER_SYSTEM = intro, Helios context, shared rules, carousel rules, voice, checked rules, closing; pinned to the prompts file', () => {
  assert.equal(
    CAPTIONER_SYSTEM,
    [CAPTIONER_INTRO, HELIOS_CONTEXT, CAPTION_SHARED_RULES, CAPTIONER_CAROUSEL_RULES, `## Voice\n\n${VOICE_BLOCK}`, renderRulesFor('captioner'), CAPTIONER_CLOSING].join('\n\n'),
  );
  const [intro, carousel, checked, closing] = codeBlocks('## 9. Captioner');
  assert.equal(CAPTIONER_INTRO, intro);
  assert.equal(CAPTIONER_CAROUSEL_RULES, carousel);
  assert.equal(CAPTIONER_CHECKED_RULES, checked);
  assert.equal(CAPTIONER_CLOSING, closing);
  assert.equal(renderRulesFor('captioner'), CAPTIONER_CHECKED_RULES);
});

test('carousel shape (Task 8b): news ends on a specific question, read is the one-or-two-sentence Helios line', () => {
  assert.match(CAPTIONER_CAROUSEL_RULES, /news: everything before the Helios line/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /one plain, surprising sentence/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /2 or 3 short paragraphs/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /so-what line/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Last, one short, specific question/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /read: the Helios line, one or two plain sentences that close the caption/);
  assert.doesNotMatch(CAPTIONER_CAROUSEL_RULES, /1 or 2 short paragraphs that close the caption/);
  assert.doesNotMatch(CAPTIONER_CAROUSEL_RULES, /End where the story wants/);
  const schema = SUBMIT_CAPTION_TOOL.input_schema as any;
  assert.match(schema.properties.news.properties.text.description, /question/);
  assert.match(schema.properties.read.properties.text.description, /Helios line/);
});

test('the posted carousel caption ends on the question, then the Helios line, then the Source line', () => {
  const { filled } = draft();
  const joined = withJoinedCaption({ ...filled, caption: structuredClone(NEWS), caption_read: structuredClone(READ) });
  const text = applySilentFixes(joined, brief).draft.caption.text;
  const at = text.indexOf(READ.text);
  assert.ok(at > 0, 'the read is in the caption');
  assert.ok(text.slice(0, at).trimEnd().endsWith('settle first?'), 'the question ends the news part');
  assert.ok(text.slice(0, at).endsWith('?\n\n'));
  assert.match(text.slice(at + READ.text.length), /^\n\nSource: [^\n]+\.$/);
});

test('SUBMIT_CAPTION_TOOL: news and read, each text plus facts', () => {
  assert.equal(SUBMIT_CAPTION_TOOL.name, 'submit_caption');
  const schema = SUBMIT_CAPTION_TOOL.input_schema as any;
  assert.deepEqual(schema.required, ['news', 'read']);
  for (const k of ['news', 'read']) assert.deepEqual(schema.properties[k].required, ['text', 'facts']);
});

// ── Code check (one retry) ──────────────────────────────────────────────

test('runCaptioner returns the two parts; joinCaption puts the news first', async () => {
  const r = await run([msg('tool_use', [submit(good())])]).result;
  assert.ok(r.ok);
  assert.deepEqual(r.value, { news: NEWS, read: READ });
  assert.equal(r.retries, 0);
  assert.equal(joinCaption(r.value), `${NEWS.text}\n\n${READ.text}`);
});

test('check rejects read without Helios', async () => {
  const bad = good();
  bad.read = { text: 'This matters for agencies.', facts: [] };
  const { s, result } = run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(good())])]);
  const r = await result;
  assert.ok(r.ok);
  assert.equal(s.requests.length, 2);
  const last = s.requests[1].messages.at(-1).content[0];
  assert.equal(last.type, 'tool_result');
  assert.equal(last.is_error, true);
  assert.match(last.content, /Helios/);
});

test('check rejects unknown fact ids in news', async () => {
  const bad = good();
  bad.news.facts = ['F99'];
  const { s, result } = run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(good())])]);
  assert.ok((await result).ok);
  assert.equal(s.requests.length, 2);
  assert.match(s.requests[1].messages.at(-1).content[0].content, /F99/);
});

test('check rejects unknown fact ids in read', async () => {
  const bad = good();
  bad.read.facts = ['F42'];
  const { s, result } = run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(good())])]);
  assert.ok((await result).ok);
  assert.match(s.requests[1].messages.at(-1).content[0].content, /F42/);
});

test('check rejects a hashtag or a Source line', async () => {
  for (const extra of [' #AI', '\nSource: TechCrunch.', '\nPhotos: Getty.']) {
    const bad = good();
    bad.news.text += extra;
    const { s, result } = run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(good())])]);
    assert.ok((await result).ok, extra);
    assert.equal(s.requests.length, 2, extra);
  }
  const bad = good();
  bad.read.text += ' #agents';
  const { s, result } = run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(good())])]);
  assert.ok((await result).ok);
  assert.equal(s.requests.length, 2);
});

test('check runs the voice list and the length limit with room for the Source and Photos lines', async () => {
  const voice = good();
  voice.read.text = 'At Helios we think this will unlock a lot for a law firm.';
  const v = run([msg('tool_use', [submit(voice)]), msg('tool_use', [submit(good())])]);
  assert.ok((await v.result).ok);
  assert.match(v.s.requests[1].messages.at(-1).content[0].content, /unlock/);

  const long = good();
  // Pad the news to a 2,000-character caption: under the 2,200 cap, over the 1,900 left after the Source and Photos room.
  const pad = 2000 - joinCaption(good()).length - 2;
  long.news.text = `${NEWS.text}\n\n${'Trump announced the force on Truth Social. '.repeat(60).slice(0, pad - 1)}.`;
  assert.ok(joinCaption(long).length <= 2200 && joinCaption(long).length + 300 > 2200, 'under the hard limit, over it with headroom');
  const l = run([msg('tool_use', [submit(long)]), msg('tool_use', [submit(good())])]);
  assert.ok((await l.result).ok);
  assert.match(l.s.requests[1].messages.at(-1).content[0].content, /1,900|1900/);
});

test('a style problem (voice) only blocks the first attempt; a missing Helios still fails after the retry', async () => {
  const voice = good();
  voice.read.text = 'At Helios we think this will unlock a lot for a law firm.';
  const v = await run([msg('tool_use', [submit(voice)]), msg('tool_use', [submit(voice)])]).result;
  assert.ok(v.ok, 'voice is a warning on the retry, like the Writer');

  const bad = good();
  bad.read = { text: 'This matters for agencies.', facts: [] };
  const h = await run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(bad)])]).result;
  assert.ok(!h.ok);
  assert.equal(h.reason, 'malformed-output');
  assert.match(h.detail, /Helios/);
});

test('hashtags and Source/Photos lines block only the first attempt; the retry passes and the mechanical stage strips them', async () => {
  const bad = good();
  bad.news.text = `${NEWS.text} #AI\n#policy #agents\nSource: TechCrunch.\nPhotos: Getty.`;
  bad.read.text = `${READ.text} #Helios`;
  const { s, result } = run([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(bad)])]);
  const r = await result;
  assert.ok(r.ok, r.ok ? '' : r.detail);
  assert.equal(s.requests.length, 2, 'the first attempt still goes back once');
  assert.match(s.requests[1].messages.at(-1).content[0].content, /no hashtags/);

  const { filled } = draft();
  const joined = withJoinedCaption({ ...filled, caption: r.value.news, caption_read: r.value.read });
  const { draft: fixed, fixes } = applySilentFixes(joined, brief);
  const text = fixed.caption.text;
  assert.doesNotMatch(text, /#/, 'no hashtag survives');
  assert.doesNotMatch(text, /TechCrunch\.|Photos:/, 'the model-written credit lines are gone');
  assert.equal(text.match(/^Source: /gm)?.length, 1, 'one Source line, the code-built one');
  assert.ok(text.includes(`settle first?\n\n${READ.text}\n\nSource: `), text);
  assert.ok(fixes.some((f) => f.id === 'F6'), 'the strip is logged');
});

test('Helios in the read, claim tags and the length limit stay hard on the retry', async () => {
  const tag = good();
  tag.news.facts = ['F99'];
  const t = await run([msg('tool_use', [submit(tag)]), msg('tool_use', [submit(tag)])]).result;
  assert.ok(!t.ok);
  assert.match(t.detail, /F99/);

  const long = good();
  long.news.text = `${NEWS.text}\n\n${'Trump announced the force on Truth Social. '.repeat(60)}`;
  const l = await run([msg('tool_use', [submit(long)]), msg('tool_use', [submit(long)])]).result;
  assert.ok(!l.ok);
  assert.match(l.detail, /length/);
});

test('a malformed submission is rejected with the shape errors', async () => {
  const { s, result } = run([msg('tool_use', [submit({ news: 'just text' })]), msg('tool_use', [submit(good())])]);
  assert.ok((await result).ok);
  assert.match(s.requests[1].messages.at(-1).content[0].content, /news|read/);
});

test('Task 8b part 2: carousel emoji and industry rules', () => {
  assert.match(CAPTIONER_CAROUSEL_RULES, /at most two emoji/i);
  assert.match(CAPTIONER_CAROUSEL_RULES, /never in read/i);
  assert.match(CAPTIONER_CAROUSEL_RULES, /the industry from the Helios context that best matches this story/);
  assert.match(CAPTIONER_CHECKED_RULES, /at most two emoji, none in read/);
  assert.doesNotMatch(CAPTIONER_CHECKED_RULES, /no emoji/);
  // The Writer's and Editor's checked rules keep the ban.
  assert.match(renderRulesFor('writer'), /no emoji/);
  assert.match(renderRulesFor('editor'), /no emoji/);
  assert.match(VOICE_BLOCK, /emoji/);
});

test('two emoji in news pass; an emoji in read, or a third, goes back once', async () => {
  const two = good();
  two.news.text = `🚨 ${NEWS.text} 👇`;
  const ok = run([msg('tool_use', [submit(two)])]);
  assert.ok((await ok.result).ok);
  assert.equal(ok.s.requests.length, 1);

  const inRead = good();
  inRead.read.text = `${READ.text} 🚀`;
  const r = run([msg('tool_use', [submit(inRead)]), msg('tool_use', [submit(good())])]);
  assert.ok((await r.result).ok);
  assert.equal(r.s.requests.length, 2);
  assert.match(r.s.requests[1].messages.at(-1).content[0].content, /read: no emoji in the Helios line/);

  const three = good();
  three.news.text = `🚨 ${NEWS.text} 🔥 👇`;
  const t = run([msg('tool_use', [submit(three)]), msg('tool_use', [submit(good())])]);
  assert.ok((await t.result).ok);
  assert.match(t.s.requests[1].messages.at(-1).content[0].content, /emoji: 3 in the caption, at most 2/);
});

test('fix round 1: the news part has no opinion; the so-what line is its one casual aside', () => {
  assert.match(CAPTIONER_CAROUSEL_RULES, /Third person, no opinion and no "we\." The so-what line is the news part's one casual aside; opinion and "we" live in read\./);
});

test('copy fix (2026-10-20): the carousel caption is the take, about 500 to 900 characters, not a recap', () => {
  assert.match(CAPTIONER_CAROUSEL_RULES, /about 500 to 900 characters in all, the Helios line included, before the credits and Source line/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Every paragraph is one or two sentences/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Then 2 or 3 short paragraphs on what happened, one or two sentences each/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Cut secondary facts the slides already carry/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /The caption is the take, not a recap/);
  assert.doesNotMatch(CAPTIONER_CAROUSEL_RULES, /At most one attribution clause/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Attribute a claim only where it is contested or comes from a single source/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Keep any hedge \("says," "reportedly," "up to"\) whose removal would change what a reader believes/);
  assert.doesNotMatch(CAPTIONER_CAROUSEL_RULES, /4 to 6 short paragraphs|2 to 4 short paragraphs/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /Usually one comes before the hook, at the start of the first line of news, and one right after the closing question/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /read: the Helios line, one or two plain sentences that close the caption/);
  assert.match(CAPTIONER_CAROUSEL_RULES, /A follow invite is rare: at most a short clause, never the default\./);
  const schema = SUBMIT_CAPTION_TOOL.input_schema as any;
  assert.match(schema.properties.news.properties.text.description, /500 to 900 characters/);
  assert.match(schema.properties.read.properties.text.description, /one concrete point/);
  assert.doesNotMatch(schema.properties.read.properties.text.description, /doing something specific it builds/);
});
