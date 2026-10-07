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
import { briefSuperIntelligenceForce, Q1_TEXT, TC_URL } from '@/fixtures/social/briefs';
import { BRIEF_SCHEMA, BriefValidationError, SUBMIT_BRIEF_TOOL, briefIndex, validateBrief, type Brief } from '@/lib/social/reporter/brief';
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

// ── Brief: structured output + the small check ─────────────────────────

test('brief: the fixture passes the check; copy-by-ID lookups return exact text (spec §4.2a)', () => {
  const b = validateBrief(briefSuperIntelligenceForce());
  const idx = briefIndex(b);
  assert.equal(idx.quote.get('Q1')!.text, Q1_TEXT);
  assert.equal(idx.number.get('N1')!.value, '120 days');
  assert.ok(idx.fact.get('B1'));
});

function errorsOf(edit: (b: Brief) => void): string[] {
  const b = briefSuperIntelligenceForce();
  edit(b);
  try {
    validateBrief(b);
  } catch (err) {
    assert.ok(err instanceof BriefValidationError);
    return err.errors.map((e) => `${e.section}: ${e.message}`);
  }
  assert.fail('expected the brief to be rejected');
}

test('brief check: sources exist, IDs unique, cited IDs exist', () => {
  assert.deepEqual(errorsOf((b) => { b.facts[3]!.sources = []; }), ['facts: F4 has no source']);
  assert.deepEqual(errorsOf((b) => { b.numbers[0]!.sources = [' ']; }), ['numbers: N1 has no source']);
  assert.deepEqual(errorsOf((b) => { b.quotes[1]!.via = []; }), ['quotes: Q2 has no source']);
  assert.deepEqual(errorsOf((b) => { b.sources = []; }), ['sources: no sources']);
  assert.deepEqual(errorsOf((b) => { b.facts[5]!.id = 'F5'; }), ['ids: duplicate id F5', "why_it_matters: cites F6, which isn't in the brief"]);
  assert.deepEqual(errorsOf((b) => { b.the_news.ids.push('F9'); }), ["the_news: cites F9, which isn't in the brief"]);
});

test('submit_brief schema mirrors the prompt sections; every object closed and fully required', () => {
  const schema = BRIEF_SCHEMA as { properties: Record<string, any>; required: string[]; additionalProperties: boolean };
  assert.deepEqual(Object.keys(schema.properties), [
    'single_story', 'the_news', 'why_it_matters', 'facts', 'background', 'quotes', 'numbers',
    'terms', 'subjects', 'events', 'article_photos', 'not_answered', 'sources', 'fetch_failures',
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.deepEqual(Object.keys(schema.properties.facts.items.properties), ['id', 'text', 'sources', 'claim_by', 'notes']);
  assert.deepEqual(Object.keys(schema.properties.quotes.items.properties), ['id', 'text', 'speaker', 'speaker_id', 'where', 'via', 'single_source', 'cut_off', 'notes']);
  assert.deepEqual(Object.keys(schema.properties.numbers.items.properties), ['id', 'value', 'type', 'counts', 'sources', 'notes']);
  assert.deepEqual(schema.properties.numbers.items.properties.type.enum, ['money', 'count', 'percent', 'duration', 'date', 'other']);
  // Every nested object is closed and fully required (strict tool use).
  const walk = (node: any): void => {
    if (node?.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(node.required, Object.keys(node.properties));
      Object.values(node.properties).forEach(walk);
    }
    if (node?.type === 'array') walk(node.items);
  };
  walk(schema);
  // Not strict: the full schema is over the API's strict-grammar size limit; enforced in code.
  assert.ok(!('strict' in (SUBMIT_BRIEF_TOOL as object)));
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
const submit = (brief: unknown = briefSuperIntelligenceForce()) => ({ type: 'tool_use', id: `sub_${Math.random()}`, name: 'submit_brief', input: brief });

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
  const { create, requests } = scripted([msg('tool_use', [submit()])]);
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
  assert.equal(req.tools[2].name, 'submit_brief');
  assert.ok(!req.tools[2].strict && !req.tools[1].strict, 'no strict tools (grammar size limit)');
  assert.ok(req.tools[2].cache_control, 'breakpoint on the last tool');
  assert.ok(!req.tools[1].cache_control);
  assert.ok(!('tool_choice' in req), 'no forced tool use (Sonnet 5.5)');
  assert.equal(req.messages[0].content[0].text, `STORY: ${STORY.story}. Starting sources: ${TC_URL}. Today is October 4, 2026.`);
  assert.ok(req.messages[0].content[0].cache_control, 'conversation breakpoint on the newest user block');
});

test('Reporter: tool loop reads pages, sends results back, parses the brief, prices every turn', async () => {
  const reads: string[] = [];
  const { create, requests } = scripted([
    msg('tool_use', [text('Opening the source.'), toolUse('t1', TC_URL)], usage({ web: 2 })),
    msg('tool_use', [submit()], usage({ cache_read_input_tokens: 4000 })),
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
    msg('tool_use', [submit()]),
  ]);
  await runReporter(STORY, { create, readPage: stubRead() });
  const results = (requests[1]! as unknown as Record<string, any>).messages[2].content;
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((x: any) => [x.tool_use_id, !!x.is_error]), [['a', false], ['b', true]]);
});

test('Reporter: page-reading budget is enforced', async () => {
  const many = Array.from({ length: READ_PAGE_MAX_CALLS + 2 }, (_, i) => toolUse(`t${i}`, TC_URL));
  const reads: string[] = [];
  const { create, requests } = scripted([msg('tool_use', many), msg('tool_use', [submit()])]);
  await runReporter(STORY, { create, readPage: stubRead(reads) });
  assert.equal(reads.length, READ_PAGE_MAX_CALLS);
  const results = (requests[1]! as unknown as Record<string, any>).messages[2].content;
  assert.match(results.at(-1).content, /budget used up/);
});

test('Reporter: pause_turn continues without a conversation breakpoint on the assistant turn', async () => {
  const { create, requests } = scripted([
    msg('pause_turn', [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Super Intelligence Force' } }]),
    msg('tool_use', [submit()]),
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
  assert.match(!bad.ok ? bad.detail : '', /ended without calling submit_brief/);

  const unsourced = briefSuperIntelligenceForce();
  unsourced.facts[0]!.sources = [];
  const failed = await runReporter(STORY, { create: scripted([msg('tool_use', [submit(unsourced)]), msg('tool_use', [submit(unsourced)])]).create });
  assert.equal(!failed.ok && failed.reason, 'malformed-output');
  assert.match(!failed.ok ? failed.detail : '', /F1 has no source/);

  const refusal = await runReporter(STORY, { create: scripted([msg('refusal', [])]).create });
  assert.equal(!refusal.ok && refusal.reason, 'refused');

  const cut = await runReporter(STORY, { create: scripted([msg('max_tokens', [text('SINGLE STORY: yes')])]).create });
  assert.equal(!cut.ok && cut.reason, 'malformed-output');

  const down = await runReporter(STORY, { create: async () => { throw new Error('overloaded'); } });
  assert.equal(!down.ok && down.reason, 'service-error');
});

test('runDay: the Reporter stage researches each winner from its member URLs; a bad brief sets the story aside', async () => {
  const sent: string[] = [];
  const create: MessagesCreate = async (params) => {
    const first = (params.messages[0]!.content as Array<{ text: string }>)[0]!.text;
    sent.push(first);
    // story-a writes an unparseable brief; the others write the fixture brief.
    return first.includes('Lab ships new model') ? msg('end_turn', [text('not a brief')]) : msg('tool_use', [submit()]);
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

test('Reporter: a refusal sets the story aside as "refused" (should-not-run) and the next backup runs', async () => {
  const create: MessagesCreate = async (params) => {
    const first = (params.messages[0]!.content as Array<{ text: string }>)[0]!.text;
    return first.includes('Lab ships new model') ? msg('refusal', []) : msg('tool_use', [submit()]);
  };
  const now = new Date('2026-10-04T15:00:00Z');
  const r = await runDay({
    articles: STUB_ARTICLES,
    stages: { ...createStubStages(), report: createReporterStage({ create, readPage: stubRead(), now: () => now }) },
    meter: createCostMeter(),
    log: createInMemorySetAsideLog(),
    now,
  });
  assert.deepEqual(r.posts.map((p) => p.storyId), ['story-b', 'story-c']);
  assert.equal(r.setAsides[0]!.reasonCode, 'refused');
  assert.equal(r.setAsides[0]!.kind, 'should-not-run');
});

test('Reporter: no fallback model is requested', async () => {
  const { create, requests } = scripted([msg('tool_use', [submit()])]);
  await runReporter(STORY, { create });
  assert.ok(!('fallbacks' in (requests[0] as object)));
});

test('Reporter: cap rule: stop before a turn once actual spend ≥ cap − $0.10', async () => {
  const big = usage({ input_tokens: 60_000, output_tokens: 10_000, web: 5 }); // ≈ $0.27 per turn
  const { create, requests } = scripted([
    msg('tool_use', [toolUse('a', TC_URL)], big),
    msg('tool_use', [toolUse('b', TC_URL)], big),
    msg('tool_use', [submit()], big),
  ]);
  const r = await runReporter(STORY, { create, readPage: stubRead(), costCapUsd: 0.5 });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'cost-cap');
  // $0.27 < $0.40 → turn 2 runs; $0.54 ≥ $0.40 → stop before turn 3.
  assert.equal(requests.length, 2);
  assert.equal(r.turnUsage.length, 2);
  assert.ok(r.turnUsage.every((t) => t.costUsd > 0.2));
});

test('Reporter: under the cap a normal run finishes; per-turn usage is stored', async () => {
  const normal = usage({ input_tokens: 8_000, output_tokens: 1_500, web: 2 });
  const { create, requests } = scripted([
    msg('tool_use', [toolUse('a', TC_URL)], normal),
    msg('tool_use', [toolUse('b', TC_URL)], normal),
    msg('tool_use', [submit()], normal),
  ]);
  const r = await runReporter(STORY, { create, readPage: stubRead(), costCapUsd: 0.5 });
  assert.ok(r.ok);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((q) => q.max_tokens === 16_000));
  assert.deepEqual(r.turnUsage.map((t) => t.turn), [1, 2, 3]);
  assert.equal((r.turnUsage[0]!.usage as { input_tokens: number }).input_tokens, 8_000);
});
test('brief check: the shape is checked against the schema (no strict tool use)', () => {
  const missing = briefSuperIntelligenceForce() as any;
  delete missing.quotes;
  assert.throws(() => validateBrief(missing), /brief: missing quotes/);
  const badEnum = briefSuperIntelligenceForce() as any;
  badEnum.numbers[0].type = 'time';
  assert.throws(() => validateBrief(badEnum), /brief\.numbers\[0\]\.type: "time" not one of money/);
  const wrongType = briefSuperIntelligenceForce() as any;
  wrongType.facts[0].sources = 'TechCrunch';
  assert.throws(() => validateBrief(wrongType), /brief\.facts\[0\]\.sources: expected array, got string/);
  const extra = briefSuperIntelligenceForce() as any;
  extra.headline = 'x';
  assert.throws(() => validateBrief(extra), /unexpected field headline/);
  const nulls = briefSuperIntelligenceForce();
  nulls.quotes[0]!.where = null;
  assert.ok(validateBrief(nulls));
});

test('Reporter: a submission that fails the check gets one retry with the errors; a fixed one passes', async () => {
  const bad = briefSuperIntelligenceForce();
  bad.facts[0]!.sources = [];
  const { create, requests } = scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit()])]);
  const r = await runReporter(STORY, { create });
  assert.ok(r.ok);
  assert.equal(requests.length, 2);
  const result = (requests[1] as any).messages.at(-1).content[0];
  assert.equal(result.type, 'tool_result');
  assert.equal(result.is_error, true);
  assert.match(result.content, /facts: F1 has no source/);
  assert.equal(r.submitRetries, 1);
  assert.equal(r.retryErrors.length, 1);
  assert.match(r.retryErrors[0]!, /facts: F1 has no source/);
});

// ── Aggregator-only facts (Tommy, 2026-10-06) ─────────────────────────────

import { aggregatorOnly, dropAggregatorOnly } from '@/lib/social/reporter/brief';

function withAggregator(): Brief {
  const b = briefSuperIntelligenceForce();
  b.sources.push({ outlet: 'Implicator.ai (partly AI-generated summary)', date: null, url: 'https://www.implicator.ai/x', kind: 'aggregator' });
  b.facts[3]!.sources = ['Implicator.ai'];
  b.numbers[0]!.sources = ['Implicator.ai', 'TechCrunch'];
  return b;
}

test('aggregator-only: a fact resting only on aggregators is found; one with an original source is not', () => {
  assert.deepEqual(aggregatorOnly(withAggregator()).map((x) => x.id), ['F4']);
  assert.deepEqual(aggregatorOnly(briefSuperIntelligenceForce()), []);
});

test('aggregator-only: code drops the fact and anything citing it, and logs it', () => {
  const b = withAggregator();
  b.the_news.ids.push('F4');
  b.why_it_matters.push({ text: 'The deadline is short.', ids: ['F4'] });
  const { brief, dropped } = dropAggregatorOnly(b);
  assert.ok(!brief.facts.some((f) => f.id === 'F4'));
  assert.ok(!brief.the_news.ids.includes('F4'));
  assert.ok(!brief.why_it_matters.some((w) => w.ids.includes('F4')));
  assert.ok(dropped.includes('F4 (aggregator-only)') && dropped.filter((d) => d.startsWith('WHY IT MATTERS')).length === 2, dropped.join(' | '));
});

test('Reporter: aggregator-only goes back once ("open the primary or drop the fact"); what remains is dropped by code', async () => {
  const s = scripted([msg('tool_use', [submit(withAggregator())]), msg('tool_use', [submit(withAggregator())])]);
  const r = await runReporter(STORY, { create: s.create, readPage: stubRead() });
  assert.ok(r.ok);
  assert.equal(r.submitRetries, 1);
  assert.match(r.retryErrors[0]!, /F4 rests only on aggregators .*open the primary or drop the fact/);
  assert.ok(!r.brief.facts.some((f) => f.id === 'F4'));
  assert.ok(r.aggregatorDropped.includes('F4 (aggregator-only)'));
  assert.ok(r.aggregatorDropped.some((d) => /WHY IT MATTERS .*cites F4/.test(d)), 'the WHY IT MATTERS item citing it goes too');
});

// ── Every speaker is a SUBJECT (Tommy, 2026-10-07; photo spec §4) ─────────────

import { quoteSpeakersNotInSubjects } from '@/lib/social/reporter/brief';

test('every speaker is a SUBJECT: the Reporter prompt says so, and the QUOTES line no longer allows "none"', () => {
  assert.ok(REPORTER_SYSTEM.includes('- Everyone you quote is listed in SUBJECTS, with their role, and the quote names their SUBJECTS ID.'));
  assert.ok(!REPORTER_SYSTEM.includes('SUBJECTS ID (S1…), or none'));
});

test('every speaker is a SUBJECT: a quote with no speaker_id is found and fails the check while a retry is left', () => {
  const b = briefSuperIntelligenceForce();
  assert.deepEqual(quoteSpeakersNotInSubjects(b), [], 'the fixture lists every speaker');
  b.quotes[1]!.speaker_id = null;
  assert.deepEqual(quoteSpeakersNotInSubjects(b), [{ id: 'Q2', speaker: 'Super Intelligence Force charter' }]);
  assert.throws(() => validateBrief(b, { speakers: true }), /Q2's speaker \(Super Intelligence Force charter\) isn't in SUBJECTS: list them in SUBJECTS with their role and give Q2 their ID/);
  assert.doesNotThrow(() => validateBrief(b), 'without the flag (after the retry) the brief passes');
});

test('every speaker is a SUBJECT: the check changes nothing in a brief that passes', () => {
  const b = briefSuperIntelligenceForce();
  const before = structuredClone(b);
  assert.deepEqual(validateBrief(b, { aggregators: true, speakers: true }), before);
});

test('Reporter: a missing speaker goes back once with the fix; a fixed brief passes with nothing logged', async () => {
  const bad = briefSuperIntelligenceForce();
  bad.quotes[1]!.speaker_id = null;
  bad.subjects = bad.subjects.filter((s) => s.id !== 'S3');
  const { create, requests } = scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit()])]);
  const r = await runReporter(STORY, { create });
  assert.ok(r.ok);
  assert.match((requests[1] as any).messages.at(-1).content[0].content, /Q2's speaker \(Super Intelligence Force charter\) isn't in SUBJECTS/);
  assert.deepEqual(r.speakersNotInSubjects, []);
  assert.deepEqual(r.brief, briefSuperIntelligenceForce(), 'the fixed brief is used as submitted');
});

test('Reporter: a speaker still missing after the retry is kept and logged, never sent back twice', async () => {
  const bad = briefSuperIntelligenceForce();
  bad.quotes[1]!.speaker_id = null;
  const { create, requests } = scripted([msg('tool_use', [submit(bad)]), msg('tool_use', [submit(structuredClone(bad))])]);
  const r = await runReporter(STORY, { create });
  assert.ok(r.ok, 'the story continues');
  assert.equal(requests.length, 2);
  assert.deepEqual(r.speakersNotInSubjects, ['Q2 (Super Intelligence Force charter): speaker not in SUBJECTS after the retry; kept, no speaker photo']);
  assert.deepEqual(r.brief, bad, 'nothing else in the brief changes');
});
