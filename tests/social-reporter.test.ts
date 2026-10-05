/**
 * Helios Social rebuild — M2 Reporter plumbing tests (offline: saved HTML,
 * no network, no Claude).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEAD_SENTENCE,
  PAGE_AGENCY_INLINE,
  PAGE_COMPANY_PHOTOS,
  PAGE_CREDIT_ELEMENT,
  PAGE_HERO_OUTSIDE_MAIN,
} from '@/fixtures/social/pages';
import { BRIEF_SUPER_INTELLIGENCE_FORCE, Q1_TEXT, TC_URL } from '@/fixtures/social/briefs';
import { BriefParseError, briefIndex, parseBrief } from '@/lib/social/reporter/brief';
import { parseArticleHtml, readPage } from '@/lib/social/reporter/read-page';
import type Anthropic from '@anthropic-ai/sdk';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { STAGE_MODELS } from '@/lib/social/pipeline/models';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createReporterStage, readableDate } from '@/lib/social/pipeline/reporter-stage';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import { REPORTER_SYSTEM } from '@/lib/social/reporter/prompt';
import {
  READ_PAGE_MAX_CALLS,
  WEB_SEARCH_TOOL_TYPE,
  runReporter,
  type MessagesCreate,
} from '@/lib/social/reporter/reporter';

// ── Brief parser (M2 accept) ───────────────────────────────────────────

test('brief: the Super Intelligence Force fixture parses completely', () => {
  const b = parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE);
  assert.equal(b.singleStory, true);
  assert.deepEqual(b.news.ids, ['F1', 'F2']);
  assert.deepEqual(b.whyItMatters.map((w) => w.ids), [['F6'], ['F4']]);
  assert.deepEqual(b.facts.map((f) => f.id), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  assert.deepEqual(b.facts[2]!.sources, ['TechCrunch', 'The Wall Street Journal']);
  assert.equal(b.facts[4]!.claimBy, 'Trump');
  assert.deepEqual(b.background.map((f) => f.id), ['B1', 'B2']);
  assert.equal(b.background[1]!.text, 'Trump signed an executive order seeking to rebrand AI as "super intelligence."');
  assert.equal(b.quotes.length, 3);
  assert.deepEqual(
    { ...b.quotes[0]!, text: b.quotes[0]!.text === Q1_TEXT },
    { id: 'Q1', text: true, speaker: 'Donald Trump', where: 'Truth Social post (via TechCrunch)', singleSource: true, cutOff: false },
  );
  assert.equal(b.quotes[2]!.cutOff, true);
  assert.deepEqual(b.numbers, [
    { id: 'N1', value: '120 days', type: 'duration', counts: 'time the task force has to report on the risks and opportunities presented by AI', source: 'TechCrunch' },
  ]);
  assert.equal(b.terms[0]!.name, 'Super Intelligence Force');
  assert.deepEqual(b.subjects[1], { name: 'Jay Clayton', role: 'national intelligence director; chair of the Super Intelligence Force' });
  assert.deepEqual(b.events, []);
  assert.deepEqual(b.articlePhotos, [
    { caption: null, credit: 'Image Credits:Kevin Dietsch / Staff / Getty Images', url: 'https://techcrunch.com/wp-content/uploads/2026/09/GettyImages-2297764008.jpg' },
  ]);
  assert.equal(b.notAnswered.length, 2);
  assert.deepEqual(b.sources, [{ outlet: 'TechCrunch', date: 'October 4, 2026', url: TC_URL }]);
  assert.deepEqual(b.fetchFailures, []);
});

test('brief: copy-by-ID lookups return the exact text (spec §4.2a)', () => {
  const idx = briefIndex(parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE));
  assert.equal(idx.quote.get('Q1')!.text, Q1_TEXT);
  assert.equal(idx.number.get('N1')!.value, '120 days');
  assert.ok(idx.fact.get('B1'));
});

function errorsOf(raw: string): string[] {
  try {
    parseBrief(raw);
  } catch (err) {
    assert.ok(err instanceof BriefParseError);
    return err.errors.map((e) => `${e.section}: ${e.message}`);
  }
  assert.fail('expected the brief to be rejected');
}

test('brief: malformed briefs fail with clear errors', () => {
  const B = BRIEF_SUPER_INTELLIGENCE_FORCE;
  assert.deepEqual(errorsOf(B.replace(/SOURCES:\n[\s\S]*?FETCH FAILURES:/, 'FETCH FAILURES:')), ['SOURCES: section missing']);
  assert.deepEqual(errorsOf(B.replace('F6: The task', 'F5: The task')), ['IDS: duplicate id F5', 'WHY IT MATTERS: cites F6, which isn\'t in the brief']);
  assert.deepEqual(errorsOf(B.replace(' presented by AI. (TechCrunch, The Wall Street Journal)', ' presented by AI.')), ['FACTS: F4 has no source']);
  assert.deepEqual(
    errorsOf(B.replace('| duration |', '| time |')),
    ['NUMBERS: N1 has type "time"; allowed: money, count, percent, duration, date, other'],
  );
  assert.match(errorsOf(B.replace('N1: 120 days | duration | ', 'N1: 120 days | '))[0]!, /^NUMBERS: expected "N#: value \| type \| what it counts \| source"/);
  assert.deepEqual(errorsOf(B.replace('SINGLE STORY: yes', 'SINGLE STORY: maybe')), ['SINGLE STORY: expected yes/no, got "maybe"']);
  assert.match(errorsOf(B.replace('Q2: "develop', 'Q2: develop'))[0]!, /^QUOTES: expected Q#: "quote" — speaker/);
});

test('brief: a sentence starting with "Background" is content, not a heading', () => {
  const b = parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE.replace('- The task force\'s budget and staff.', '- Background checks for task force members.'));
  assert.equal(b.notAnswered[0], 'Background checks for task force members.');
});

const URL_A = 'https://tech.example.com/2026/10/03/northwind-opens-model';

test('page reader returns raw text, word for word (spec §4.2c)', () => {
  const page = parseArticleHtml(PAGE_CREDIT_ELEMENT, URL_A)!;
  assert.ok(page.text.includes(LEAD_SENTENCE));
  assert.ok(page.text.includes('The company said it would publish further information in the coming weeks, according to a spokesperson.'));
  assert.equal(page.truncated, false);
  assert.equal(page.publishedTime, '2026-10-03T14:00:00Z');
  // Caption and credit text is reported as photo data, not mixed into nothing: the body still reads as prose.
  assert.ok(page.text.length > 500);
});

test('photos: credit in its own element is split from the caption; largest srcset; og:image last', () => {
  const { photos } = parseArticleHtml(PAGE_CREDIT_ELEMENT, URL_A)!;
  assert.equal(photos.length, 2);
  assert.deepEqual(photos[0], {
    src: 'https://tech.example.com/img/ceo-1600.jpg',
    caption: "Northwind Labs CEO Dana Whitlock at the company's developer event in Seattle.",
    credit: 'Photo: Lee Park for Example Tech',
    alt: 'Dana Whitlock on stage',
    from: 'figure',
  });
  assert.deepEqual(photos[1], {
    src: 'https://cdn.example.com/og/northwind-share.jpg', caption: null, credit: null, alt: null, from: 'og:image',
  });
});

test('photos: agency credits written inside the caption are copied exactly (spec §5.1 ABC example)', () => {
  const { photos } = parseArticleHtml(PAGE_AGENCY_INLINE, 'https://news.example.com/task-force')!;
  assert.equal(photos[0]!.caption, 'Vice President JD Vance speaks at the White House.');
  assert.equal(photos[0]!.credit, 'Kent Nishimura/AFP via Getty Images');
  assert.equal(photos[1]!.caption, 'The Capitol on Thursday.');
  assert.equal(photos[1]!.credit, 'J. Scott Applewhite/AP');
});

test('photos: "Courtesy of", the last labelled credit, lazy src, and no caption', () => {
  const { photos } = parseArticleHtml(PAGE_COMPANY_PHOTOS, 'https://news.example.com/chip')!;
  assert.equal(photos.length, 3);
  assert.equal(photos[0]!.src, 'https://press.example.com/chip.jpg');
  assert.equal(photos[0]!.caption, 'The Northwind N1 chip on display at the launch.');
  assert.equal(photos[0]!.credit, 'Courtesy of Northwind Labs');
  // "An image of…" in the caption is not mistaken for the credit.
  assert.equal(photos[1]!.caption, 'An image of the robot arm used in the lab demo.');
  assert.equal(photos[1]!.credit, 'Photo: Google');
  assert.deepEqual([photos[2]!.caption, photos[2]!.credit], [null, null]);
});

test('photos: hero outside <main> is found, a credit-only caption is a credit, nav figures are skipped (TechCrunch shape)', () => {
  const { photos } = parseArticleHtml(PAGE_HERO_OUTSIDE_MAIN, 'https://techcrunch.example.com/task-force')!;
  assert.equal(photos.length, 1);
  assert.equal(photos[0]!.src, 'https://cdn.example.com/hero.jpg');
  assert.equal(photos[0]!.caption, null);
  assert.equal(photos[0]!.credit, 'Image Credits: Kevin Dietsch / Staff / Getty Images');
});

test('readPage: failed fetch and non-article pages fail cleanly', async () => {
  const failed = await readPage(URL_A, async () => null);
  assert.deepEqual(failed, { ok: false, url: URL_A, error: 'fetch failed' });
  const empty = await readPage(URL_A, async () => '<html><body><p>Hi</p></body></html>');
  assert.equal(empty.ok, false);
  const ok = await readPage(URL_A, async () => PAGE_CREDIT_ELEMENT);
  assert.equal(ok.ok, true);
});

// ── Reporter stage (stubbed Claude: no live API) ───────────────────────



const STORY = { story: 'Trump unveils his new Super Intelligence Force', startingSources: [TC_URL], today: 'October 4, 2026' };

const usage = (o: Partial<Anthropic.Usage> & { web?: number } = {}) => ({
  input_tokens: o.input_tokens ?? 1000,
  output_tokens: o.output_tokens ?? 500,
  cache_read_input_tokens: o.cache_read_input_tokens ?? 0,
  cache_creation_input_tokens: o.cache_creation_input_tokens ?? 0,
  server_tool_use: { web_search_requests: o.web ?? 0 },
});

function msg(stop: string, content: unknown[], u = usage()): Anthropic.Message {
  return { id: `msg_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, content, usage: u } as unknown as Anthropic.Message;
}
const toolUse = (id: string, url: string) => ({ type: 'tool_use', id, name: 'read_page', input: { url } });
const text = (t: string) => ({ type: 'text', text: t });

/** Scripted Claude: returns the responses in order and records every request. */
function scripted(responses: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create: MessagesCreate = async (params) => {
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  };
  return { create, requests };
}

const stubRead = (calls: string[] = []) => async (url: string) => {
  calls.push(url);
  return url === TC_URL ? parseArticleHtml(PAGE_HERO_OUTSIDE_MAIN, url)! : { ok: false as const, url, error: 'fetch failed' };
};

test('Reporter: model + effort from the stage config, cached tools and system, STORY line in the user message', async () => {
  const { create, requests } = scripted([msg('end_turn', [text(BRIEF_SUPER_INTELLIGENCE_FORCE)])]);
  const r = await runReporter(STORY, { create, readPage: stubRead() });
  assert.equal(r.ok, true);
  const req = requests[0]! as unknown as Record<string, any>;
  assert.equal(req.model, STAGE_MODELS.reporter.model);
  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.deepEqual(req.output_config, { effort: 'high' });
  assert.equal(req.system[0].text, REPORTER_SYSTEM);
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(req.tools[0].type, WEB_SEARCH_TOOL_TYPE);
  assert.equal(req.tools[0].max_uses, 8);
  assert.equal(req.tools[1].name, 'read_page');
  assert.ok(req.tools[1].cache_control, 'breakpoint on the last tool');
  assert.equal(req.messages[0].content[0].text, `STORY: ${STORY.story}. Starting sources: ${TC_URL}. Today is October 4, 2026.`);
  assert.ok(req.messages[0].content[0].cache_control, 'conversation breakpoint on the newest user block');
});

test('Reporter: tool loop reads pages, sends results back, parses the brief, prices every turn', async () => {
  const reads: string[] = [];
  const { create, requests } = scripted([
    msg('tool_use', [text('Opening the source.'), toolUse('t1', TC_URL)], usage({ web: 2 })),
    msg('end_turn', [text(BRIEF_SUPER_INTELLIGENCE_FORCE)], usage({ cache_read_input_tokens: 4000 })),
  ]);
  const r = await runReporter(STORY, { create, readPage: stubRead(reads) });
  assert.ok(r.ok);
  assert.deepEqual(reads, [TC_URL]);
  assert.equal(r.pages.length, 1);
  assert.equal(r.brief.facts.length, 6);
  assert.equal(r.webSearches, 2);
  assert.equal(r.turns, 2);
  assert.ok(r.costUsd > 0.02 && r.costUsd < 0.1, `cost ${r.costUsd}`); // 2 searches ($0.02) + tokens at Sonnet 5.5 rates
  const second = requests[1]! as unknown as Record<string, any>;
  assert.equal(second.messages.length, 3); // user, assistant(tool_use), user(tool_result)
  const result = second.messages[2].content[0];
  assert.equal(result.type, 'tool_result');
  assert.equal(result.tool_use_id, 't1');
  assert.match(result.content, /PHOTOS \(caption \| credit \| URL\):\n- \(no caption\) \| Image Credits: Kevin Dietsch \/ Staff \/ Getty Images/);
  assert.match(result.content, /TEXT:\nThe president announced the formation/);
  // Only the newest block carries the conversation breakpoint.
  assert.ok(!second.messages[0].content[0].cache_control);
  assert.ok(result.cache_control);
});

test('Reporter: parallel tool calls come back in ONE user message; failed reads are is_error', async () => {
  const { create, requests } = scripted([
    msg('tool_use', [toolUse('a', TC_URL), toolUse('b', 'https://paywalled.example/x')]),
    msg('end_turn', [text(BRIEF_SUPER_INTELLIGENCE_FORCE)]),
  ]);
  await runReporter(STORY, { create, readPage: stubRead() });
  const results = (requests[1]! as unknown as Record<string, any>).messages[2].content;
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((x: any) => [x.tool_use_id, !!x.is_error]), [['a', false], ['b', true]]);
});

test('Reporter: page-reading budget is enforced', async () => {
  const many = Array.from({ length: READ_PAGE_MAX_CALLS + 2 }, (_, i) => toolUse(`t${i}`, TC_URL));
  const reads: string[] = [];
  const { create, requests } = scripted([msg('tool_use', many), msg('end_turn', [text(BRIEF_SUPER_INTELLIGENCE_FORCE)])]);
  await runReporter(STORY, { create, readPage: stubRead(reads) });
  assert.equal(reads.length, READ_PAGE_MAX_CALLS);
  const results = (requests[1]! as unknown as Record<string, any>).messages[2].content;
  assert.match(results.at(-1).content, /budget used up/);
});

test('Reporter: pause_turn continues without a conversation breakpoint on the assistant turn', async () => {
  const { create, requests } = scripted([
    msg('pause_turn', [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Super Intelligence Force' } }]),
    msg('end_turn', [text(BRIEF_SUPER_INTELLIGENCE_FORCE)]),
  ]);
  const r = await runReporter(STORY, { create, readPage: stubRead() });
  assert.ok(r.ok);
  const second = (requests[1]! as unknown as Record<string, any>).messages;
  assert.equal(second.at(-1).role, 'assistant');
  assert.ok(!second.at(-1).content[0].cache_control);
});

test('Reporter: malformed brief, refusal, truncation and API errors fail with a reason (no retry here)', async () => {
  const bad = await runReporter(STORY, { create: scripted([msg('end_turn', [text('Here is the brief: …')])]).create });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.reason, 'malformed-output');
  assert.match(!bad.ok ? bad.detail : '', /SINGLE STORY: section missing/);

  const refusal = await runReporter(STORY, { create: scripted([msg('refusal', [])]).create });
  assert.equal(!refusal.ok && refusal.reason, 'service-error');

  const cut = await runReporter(STORY, { create: scripted([msg('max_tokens', [text('SINGLE STORY: yes')])]).create });
  assert.equal(!cut.ok && cut.reason, 'malformed-output');

  const down = await runReporter(STORY, { create: async () => { throw new Error('overloaded'); } });
  assert.equal(!down.ok && down.reason, 'service-error');
});

test('brief: a "Fetch failures:" line inside SOURCES opens the fetch-failure list', () => {
  const b = parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE.replace('FETCH FAILURES:\n- none', 'Fetch failures: https://www.bloomberg.com/x (paywall)'));
  assert.deepEqual(b.sources.length, 1);
  assert.deepEqual(b.fetchFailures, ['https://www.bloomberg.com/x (paywall)']);
});

test('runDay: the Reporter stage researches each winner from its member URLs; a bad brief sets the story aside', async () => {
  const sent: string[] = [];
  const create: MessagesCreate = async (params) => {
    const first = (params.messages[0]!.content as Array<{ text: string }>)[0]!.text;
    sent.push(first);
    // story-a writes an unparseable brief; the others write the fixture brief.
    return msg('end_turn', [text(first.includes('Lab ships new model') ? 'not a brief' : BRIEF_SUPER_INTELLIGENCE_FORCE)]);
  };
  const now = new Date('2026-10-04T15:00:00Z');
  const meter = createCostMeter();
  const r = await runDay({
    articles: STUB_ARTICLES,
    stages: { ...createStubStages(), report: createReporterStage({ create, readPage: stubRead(), now: () => now }) },
    meter,
    log: createInMemorySetAsideLog(),
    now,
  });
  assert.equal(readableDate(now), 'October 4, 2026');
  assert.equal(sent[0], 'STORY: Lab ships new model. Starting sources: https://example.com/story-a. Today is October 4, 2026.');
  assert.deepEqual(r.posts.map((p) => p.storyId), ['story-b', 'story-c']);
  assert.equal(r.setAsides[0]!.stage, 'reporter');
  assert.equal(r.setAsides[0]!.reasonCode, 'malformed-output');
  assert.ok((meter.byStage().reporter ?? 0) > 0);
});
