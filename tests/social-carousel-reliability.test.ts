/**
 * Carousel reliability fixes (2026-10-12), all offline: stubbed Claude, no network.
 *   1. Reporter: a rejected brief's retry is not refused by the cost-cap margin.
 *   2. Writer: a length fix on a slide is not "words changed for a photo".
 *   3. Writer: headline + body over 168 is rescued by the shorten call, even beside photo-request errors.
 *   4. Writer: an empty company visual (a dropped request) no longer fails the draft.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { parseArticleHtml } from '@/lib/social/reporter/read-page';
import { PAGE_HERO_OUTSIDE_MAIN } from '@/fixtures/social/pages';
import type { Brief } from '@/lib/social/reporter/brief';
import { runReporter, type MessagesCreate } from '@/lib/social/reporter/reporter';
import { LIMITS } from '@/lib/social/mechanical/checks';
import { checkDraft, type DraftSubmission, type VisualRequest } from '@/lib/social/writer/draft';
import { overLimitLines } from '@/lib/social/writer/shorten';
import { runWriter } from '@/lib/social/writer/writer';

const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });
const usage = (o: Record<string, number> = {}) => ({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 }, ...o });
const msg = (stop: string, content: unknown[], u: object = usage()) =>
  ({ id: `m_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, content, usage: u }) as unknown as Anthropic.Message;

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

// ── 1. Reporter ──────────────────────────────────────────────────────

const STORY = { story: 'Trump unveils his new Super Intelligence Force', startingSources: [TC_URL], today: 'October 4, 2026' };
const submitBrief = (b: unknown) => ({ type: 'tool_use', id: `s_${Math.random()}`, name: 'submit_brief', input: b });
function withAggregator(): Brief {
  const b = briefSuperIntelligenceForce();
  b.sources.push({ outlet: 'Implicator.ai (partly AI-generated summary)', date: null, url: 'https://www.implicator.ai/x', kind: 'aggregator' });
  b.facts[3]!.sources = ['Implicator.ai'];
  b.numbers[0]!.sources = ['Implicator.ai', 'TechCrunch'];
  return b;
}
const stubRead = async (url: string) => (url === TC_URL ? parseArticleHtml(PAGE_HERO_OUTSIDE_MAIN, url)! : { ok: false as const, url, error: 'fetch failed' });

test('Reporter: a brief the check rejected gets its retry even inside the cap margin (the Oct 11 and Oct 12 losses)', async () => {
  // First turn costs ≈ $0.39: past cap − margin ($0.35) but under the cap ($0.45).
  const heavy = usage({ input_tokens: 128_000, output_tokens: 12_800 });
  const s = scripted([msg('tool_use', [submitBrief(withAggregator())], heavy), msg('tool_use', [submitBrief(withAggregator())])]);
  const r = await runReporter(STORY, { create: s.create, readPage: stubRead, costCapUsd: 0.45 });
  assert.equal(s.requests.length, 2, 'the retry ran');
  assert.ok(r.ok, !r.ok ? r.detail : '');
  assert.equal(r.submitRetries, 1);
  assert.ok(r.turnUsage[0]!.costUsd >= 0.35 && r.turnUsage[0]!.costUsd < 0.45, String(r.turnUsage[0]!.costUsd));
});

test('Reporter: the margin still stops an ordinary turn, and the cap itself still stops a retry', async () => {
  const heavy = usage({ input_tokens: 128_000, output_tokens: 12_800 });
  const plain = scripted([msg('tool_use', [{ type: 'tool_use', id: 'a', name: 'read_page', input: { url: TC_URL } }], heavy), msg('tool_use', [submitBrief(briefSuperIntelligenceForce())])]);
  const r1 = await runReporter(STORY, { create: plain.create, readPage: stubRead, costCapUsd: 0.45 });
  assert.equal(!r1.ok && r1.reason, 'cost-cap');
  assert.equal(plain.requests.length, 1);
  const over = usage({ input_tokens: 160_000, output_tokens: 16_000 }); // ≈ $0.48 ≥ cap
  const retry = scripted([msg('tool_use', [submitBrief(withAggregator())], over), msg('tool_use', [submitBrief(withAggregator())])]);
  const r2 = await runReporter(STORY, { create: retry.create, readPage: stubRead, costCapUsd: 0.45 });
  assert.equal(!r2.ok && r2.reason, 'cost-cap');
  assert.equal(retry.requests.length, 1);
});

// ── Writer helpers ───────────────────────────────────────────────────

const submitDraft = (input: unknown) => ({ type: 'tool_use', id: `t_${Math.random()}`, name: 'submit_draft', input });
const submitLines = (lines: Array<{ id: string; text: string }>) => ({ type: 'tool_use', id: `l_${Math.random()}`, name: 'submit_lines', input: { lines } });
const notWellKnown = async () => false;
const brief = briefSuperIntelligenceForce;

/** Slide 2 with headline + body of `total` characters, each within its own limit. */
function overCombined(d: DraftSubmission, total: number) {
  const s = d.slides[0]!;
  s.headline.text = 'The force is real and it is new'; // 32
  s.body = { ...(s.body ?? { facts: [] }), text: 'x'.repeat(total - s.headline.text.length) } as typeof s.body;
  s.body!.text = ('Trump says the force will guard the nation and its data from every foreign threat. ' + 'a'.repeat(100)).slice(0, total - s.headline.text.length).trim();
  while (s.headline.text.length + s.body!.text.length < total) s.body!.text += 'a';
}

test('overLimitLines: headline + body over 168 with each in its own limit → the body is shortened to the room left', () => {
  const d = sifDraftHandoff();
  overCombined(d, 172);
  const lines = overLimitLines(d);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.where, 'slide 2 body');
  assert.equal(lines[0]!.limit, LIMITS.slide - d.slides[0]!.headline.text.length);
});

test('overLimitLines: slides and cover only; the caption is the captioner\'s, never the shortener\'s', () => {
  const d = sifDraftHandoff();
  d.caption = { text: 'x'.repeat(LIMITS.caption + 50), facts: [] };
  assert.deepEqual(overLimitLines(d), []);
});

test('Writer: 172 chars together beside photo-request errors on the final attempt → rescued by the shorten call, visuals dropped', async () => {
  const bad = sifDraftHandoff();
  overCombined(bad, 172);
  bad.slides[1]!.visual = v('thematic', 'Donald Trump podium'); // a scene naming a subject: fails the photo check
  const room = LIMITS.slide - bad.slides[0]!.headline.text.length;
  const shortBody = bad.slides[0]!.body!.text.slice(0, room - 6).trim();
  const s = scripted([msg('tool_use', [submitDraft(bad)]), msg('tool_use', [submitDraft(structuredClone(bad))]), msg('tool_use', [submitLines([{ id: 'L1', text: shortBody }])])]);
  const r = await runWriter(brief(), { create: s.create, isWellKnown: notWellKnown });
  assert.ok(r.ok, !r.ok ? r.detail : '');
  assert.equal(s.requests.length, 3, 'attempt, retry, shorten');
  assert.equal(r.draft.slides[0]!.body!.text, shortBody);
  assert.ok(r.visualsDropped.some((l) => /slide 3/.test(l)), r.visualsDropped.join(' | '));
  assert.ok(r.retryErrors.some((e) => /shortened to fit: slide 2 body/.test(e)));
});

// ── 2. The length fix is not a photo change ──────────────────────────

test('Writer: a slide sent back for length AND a photo request may change its words on the retry (the Oct 12 NYT loss)', async () => {
  const first = sifDraftHandoff();
  first.slides[0]!.body!.text = 'y'.repeat(150); // C1: body over 140
  first.slides[0]!.fallback_visual = v('thematic', 'Donald Trump podium'); // photo-request error on the same slide
  const fixed = sifDraftHandoff(); // retry: the body is back within its limit, the request is changed
  fixed.slides[0]!.body!.text = sifDraftHandoff().slides[0]!.body!.text;
  const s = scripted([msg('tool_use', [submitDraft(first)]), msg('tool_use', [submitDraft(fixed)])]);
  const r = await runWriter(brief(), { create: s.create, isWellKnown: notWellKnown });
  assert.ok(r.ok, !r.ok ? r.detail : '');
});

test('Writer: a slide sent back only for a photo request still may not change its words', async () => {
  const first = sifDraftHandoff();
  first.slides[0]!.fallback_visual = v('thematic', 'Donald Trump podium');
  const next = structuredClone(first);
  next.slides[0]!.fallback_visual = v('setting', 'campaign rally');
  next.slides[0]!.headline.text = 'A different headline altogether';
  const s = scripted([msg('tool_use', [submitDraft(first)]), msg('tool_use', [submitDraft(next)])]);
  const r = await runWriter(brief(), { create: s.create, isWellKnown: notWellKnown });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /the words changed after its visual request failed/);
});

// ── 4. An empty company visual ───────────────────────────────────────

test('checkDraft: a dropped (empty) company or person request passes; a wrong name still fails', () => {
  const d = sifDraftHandoff();
  d.slides[2]!.fallback_visual = v('company', '');
  d.cover_options[0]!.fallback_visual = v('person', '  ');
  assert.doesNotThrow(() => checkDraft(d, brief()));
  d.slides[2]!.fallback_visual = v('company', 'Nonexistent Corp');
  assert.throws(() => checkDraft(d, brief()), /isn't exactly a SUBJECTS name/);
});

test('Writer: an empty company fallback is told to the model on early attempts and dropped (not fatal) on the final one', async () => {
  const bad = sifDraftHandoff();
  bad.slides[3]!.fallback_visual = v('company', '');
  const s = scripted([msg('tool_use', [submitDraft(bad)]), msg('tool_use', [submitDraft(structuredClone(bad))])]);
  const r = await runWriter(brief(), { create: s.create, isWellKnown: notWellKnown });
  assert.ok(r.ok, !r.ok ? r.detail : '');
  assert.match(r.retryErrors[0]!, /slide 5\.fallback_visual: company visual is empty/);
  assert.ok(r.visualsDropped.some((l) => /fallback/.test(l)), r.visualsDropped.join(' | '));
});

// ── 5. The token ceiling ─────────────────────────────────────────────

test('Writer: the call asks for a 20,000-token ceiling (a ceiling, not a spend)', async () => {
  const s = scripted([msg('tool_use', [submitDraft(sifDraftHandoff())])]);
  await runWriter(brief(), { create: s.create, isWellKnown: notWellKnown });
  assert.equal(s.requests[0].max_tokens, 20_000);
});
