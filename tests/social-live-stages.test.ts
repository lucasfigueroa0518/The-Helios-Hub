/**
 * The checkpoint runner's stage wiring (lib/social/pipeline/live-stages.ts),
 * offline: a fake Claude answers each submit tool from fixtures, fake
 * Wikidata / Commons / Openverse, stub Jev, stub fit check. No network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { createFakeHttp, SIF_WEB } from '@/fixtures/social/photo-http';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Identity from '@/lib/social/jev/questions/subject-identity.v1';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { BudgetExhausted, createLiveStages, createRunBudget } from '@/lib/social/pipeline/live-stages';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import type { FitCheck } from '@/lib/social/render/fit-check';
import { fitOkFor } from '@/fixtures/social/render-text';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

const usage = { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (name: string, input: unknown) =>
  ({
    id: `m_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage,
    content: [{ type: 'tool_use', id: `t_${Math.random()}`, name, input }],
  }) as unknown as Anthropic.Message;

/** Answers whichever submit tool the request offers. */
function fakeClaude(calls: string[], flags: unknown = { flags: [], main_claim_false: false }): MessagesCreate {
  return async (params) => {
    const names = (params.tools ?? []).map((t) => (t as { name?: string }).name);
    if (names.includes('submit_brief')) { calls.push('reporter'); return msg('submit_brief', briefSuperIntelligenceForce()); }
    if (names.includes('submit_flags')) { calls.push('fact-checker'); return msg('submit_flags', flags); }
    if (names.includes('submit_draft')) { calls.push('draft'); return msg('submit_draft', sifDraftHandoff()); }
    throw new Error(`unexpected request: ${names.join(',')}`);
  };
}

const identityJev: JevAsk = async (req, meta) => {
  if (meta.version === Prescreen.VERSION) {
    const st = req.state as ReturnType<typeof Prescreen.buildState>;
    const a: Record<string, { noul: number }> = {};
    st.candidates.forEach((_, k) => { a[Prescreen.fitId(k)] = { noul: 0.9 }; a[Prescreen.peopleId(k)] = { noul: 0.05 }; });
    return { answers: a, usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
  }
  const state = req.state as ReturnType<typeof Identity.buildState>;
  const answers: Record<string, { noul: number }> = { is_person: { noul: 0.97 } };
  state.candidates.forEach((c, k) => { answers[Identity.matchId(k)] = { noul: /president|SEC/.test(c.description) ? 0.95 : 0.05 }; });
  return { answers, usage: { input_tokens: 400, output_tokens: 0 }, model: 'stub-jev' };
};

const fitOk: FitCheck = async (post) => fitOkFor(post);

function setup(opts: { capUsd?: number; fitCheck?: FitCheck; flags?: unknown } = {}) {
  const calls: string[] = [];
  const budget = createRunBudget({ capUsd: opts.capUsd ?? 1.5, otherSpendUsd: () => 0 });
  const { stages, logs } = createLiveStages({
    score: createStubStages({ costUsd: Object.fromEntries(['jev-scoring'].map((k) => [k, 0])) }).score,
    create: fakeClaude(calls, opts.flags),
    jev: identityJev,
    budget,
    readPage: async (url) => ({ ok: false, url, error: 'offline' }),
    isWellKnown: async () => false,
    fitCheck: opts.fitCheck ?? fitOk,
    http: createFakeHttp(SIF_WEB).http,
    now: new Date('2026-10-06T15:00:00Z'),
    reporterCapUsd: 0.45,
    maxReporterRuns: 4,
  });
  return { calls, budget, stages, logs };
}

test('live stages: two stories run Reporter → Writer → Editor → Fact-checker → mechanical → design', async () => {
  const { calls, budget, stages, logs } = setup();
  const meter = createCostMeter({ capUsd: 1.5 });
  const r = await runDay({ articles: STUB_ARTICLES, stages, meter, log: createInMemorySetAsideLog(), now: new Date('2026-10-06T15:00:00Z'), targetPosts: 2 });
  assert.equal(r.posts.length, 2);
  assert.deepEqual(r.posts[0]!.stages, ['jev-scoring', 'reporter', 'writer', 'editor', 'fact-checker', 'mechanical', 'design']);
  assert.deepEqual(calls, ['reporter', 'draft', 'draft', 'fact-checker', 'reporter', 'draft', 'draft', 'fact-checker']);
  const post = r.posts[0]!;
  assert.ok(post.render.slides.length > 0);
  assert.ok(post.photos[0]!.photo, 'the cover has a photo');
  // A quote slide whose speaker's main photo is already on the cover and has no second photo here renders type-led (photo spec §4).
  const isQuote = (i: number) => post.render.slides[i + 1]?.layoutVariant === 'quote';
  assert.ok(post.photos.slice(1).every((t, i) => t.photo || t.via === 'icon' || (t.via === 'type-led' && isQuote(i))), 'every story slide has a photo, its icon background or (quote) a type-led slide');
  const l = logs.get(post.storyId)!;
  assert.equal(l.writer.length, 1);
  assert.equal(l.factCheck.length, 1);
  assert.ok(l.design);
  assert.ok(budget.claudeUsd() > 0);
  assert.ok((r.costByStage.reporter ?? 0) > 0 && (r.costByStage.writer ?? 0) > 0 && (r.costByStage.editor ?? 0) > 0 && (r.costByStage['fact-checker'] ?? 0) > 0);
});

test('live stages: a render that still fails the fit check after the default layout is set aside, and the next story fills the slot', async () => {
  let n = 0;
  // The first story fails twice: its Jev layout, then the default layout for the failing slide (slide buckets spec).
  const fitCheck: FitCheck = async (post) => (++n <= 2 ? { ok: false, problems: [], slideText: [], violations: [{ slide: 5, element: 'div.helios-split-stat__number', text: '$99.99', over: { left: 0, top: 0, right: 300, bottom: 0 } }] } : fitOkFor(post));
  const { stages } = setup({ fitCheck });
  const r = await runDay({ articles: STUB_ARTICLES, stages, meter: createCostMeter({ capUsd: 5 }), log: createInMemorySetAsideLog(), now: new Date('2026-10-06T15:00:00Z'), targetPosts: 1 });
  assert.equal(r.posts.length, 1);
  assert.equal(r.setAsides.length, 1);
  assert.equal(r.setAsides[0]!.reasonCode, 'render-failed');
  assert.equal(r.setAsides[0]!.stage, 'design');
});

test('run budget: no Claude call starts that could pass the cap; the refusal is logged as cost-cap', async () => {
  const { stages, budget } = setup({ capUsd: 0.25 });
  const r = await runDay({ articles: STUB_ARTICLES, stages, meter: createCostMeter({ capUsd: 5 }), log: createInMemorySetAsideLog(), now: new Date('2026-10-06T15:00:00Z'), targetPosts: 2 });
  assert.ok(budget.exhausted());
  assert.ok(budget.spent() <= 0.25, `spent ${budget.spent()}`);
  assert.equal(r.posts.length, 0);
  assert.ok(r.setAsides.every((s) => s.reasonCode === 'cost-cap'), JSON.stringify(r.setAsides));
});

test('run budget: the guard refuses before calling when spend + reserve passes the cap', async () => {
  let called = 0;
  const budget = createRunBudget({ capUsd: 1.5, otherSpendUsd: () => 1.35 });
  const guarded = budget.guard(async () => { called++; return msg('x', {}); });
  await assert.rejects(() => guarded({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [] }), BudgetExhausted);
  assert.equal(called, 0);
});

test('cap: between stages the day stops only at the full cap, so a no-Claude stage (design) still runs near it', async () => {
  const { stages } = setup({ capUsd: 1.5 });
  const meter = createCostMeter({ capUsd: 1.5, alreadySpentUsd: 1.38 });
  const designed: string[] = [];
  const design = stages.design;
  stages.design = async (d, b, s) => { designed.push(d.storyId); return design(d, b, s); };
  // Reporter, Writer, Editor, Fact-checker stubbed through as zero-cost so only the meter matters here.
  const free = createStubStages({ costUsd: Object.fromEntries(['jev-scoring', 'reporter', 'writer', 'editor', 'fact-checker'].map((k) => [k, 0])) });
  const r = await runDay({ articles: STUB_ARTICLES, stages: { ...free, design: stages.design, mechanical: stages.mechanical }, meter, log: createInMemorySetAsideLog(), now: new Date('2026-10-06T15:00:00Z'), targetPosts: 1 });
  assert.equal(designed.length, 1, 'design ran at $1.38 of $1.50');
  assert.notEqual(r.stopReason, 'cost-cap');
});
