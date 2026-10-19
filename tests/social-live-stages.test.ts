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
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v5';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { BudgetExhausted, createLiveStages, createRunBudget } from '@/lib/social/pipeline/live-stages';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import type { FitCheck } from '@/lib/social/render/fit-check';
import { fitOkFor } from '@/fixtures/social/render-text';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { BUILD_FIT, buildLineInstruction, type RecentClosing } from '@/lib/social/captions/build-line';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import { jevCostUsd } from '@/lib/social/jev/client';
import { createCaptionerStage } from '@/lib/social/pipeline/captioner-stage';
import type { Brief as PipelineBrief, Draft } from '@/lib/social/pipeline/types';
import { checkDraft, fillDraft } from '@/lib/social/writer/draft';

const usage = { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (name: string, input: unknown) =>
  ({
    id: `m_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage,
    content: [{ type: 'tool_use', id: `t_${Math.random()}`, name, input }],
  }) as unknown as Anthropic.Message;

/** A caption for the Super Intelligence Force fixtures that passes the captioner's check. */
const NEWS = {
  text: "The White House now has a task force for super intelligence, and it has 120 days to say what that means.\n\nTrump announced the Super Intelligence Force in a Sunday post on Truth Social. National intelligence director Jay Clayton will lead it, the Wall Street Journal reports.\n\nIts charter reportedly asks for plans against SI-enabled threats while preventing overregulation.",
  facts: ['F1', 'F2', 'F3', 'N1', 'F6'],
};
const READ = {
  text: 'For a law firm or an insurance broker, the rules on AI tools may get looser before they get tighter. At Helios we would build for both: systems you own, ready for whichever way the report lands.',
  facts: ['F6'],
};

/** Answers whichever submit tool the request offers. */
function fakeClaude(calls: string[], flags: unknown = { flags: [], main_claim_false: false }): MessagesCreate {
  return async (params) => {
    const names = (params.tools ?? []).map((t) => (t as { name?: string }).name);
    if (names.includes('submit_brief')) { calls.push('reporter'); return msg('submit_brief', briefSuperIntelligenceForce()); }
    if (names.includes('submit_caption')) { calls.push('captioner'); return msg('submit_caption', { news: NEWS, read: READ }); }
    if (names.includes('submit_flags')) { calls.push('fact-checker'); return msg('submit_flags', flags); }
    if (names.includes('submit_draft')) { calls.push('draft'); return msg('submit_draft', sifDraftHandoff()); }
    throw new Error(`unexpected request: ${names.join(',')}`);
  };
}

const identityJev: JevAsk = async (req, meta) => {
  // The photo decision nodes (photo-slide@2, spread-fit@1): fits, never a repeat.
  if (meta.version === 'photo-slide@2' || meta.version === 'spread-fit@1') {
    return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { noul: k.startsWith('repeats_') ? 0.05 : 0.9 }])), usage: { input_tokens: 300, output_tokens: 0 }, model: 'stub-jev' };
  }
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

/** An in-memory closings log for tests: `rows` newest first. */
function memoryClosings(rows: RecentClosing[] = []): ClosingsLog & { rows: RecentClosing[]; recorded: Array<[string, string, boolean]> } {
  const recorded: Array<[string, string, boolean]> = [];
  return {
    rows,
    recorded,
    recent: async () => rows,
    async record(subjectId, closing, buildLine) {
      recorded.push([subjectId, closing, buildLine]);
      rows.unshift({ closing, buildLine, createdAt: new Date() });
    },
  };
}

function setup(opts: { capUsd?: number; fitCheck?: FitCheck; flags?: unknown } = {}) {
  const calls: string[] = [];
  const budget = createRunBudget({ capUsd: opts.capUsd ?? 1.5, otherSpendUsd: () => 0 });
  const { stages, logs } = createLiveStages({
    score: createStubStages({ costUsd: Object.fromEntries(['jev-scoring'].map((k) => [k, 0])) }).score,
    create: fakeClaude(calls, opts.flags),
    jev: identityJev,
    closings: memoryClosings(),
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

test('live stages: two stories run Reporter → Writer → Editor → captioner → Fact-checker → mechanical → design', async () => {
  const { calls, budget, stages, logs } = setup();
  const meter = createCostMeter({ capUsd: 1.5 });
  const r = await runDay({ articles: STUB_ARTICLES, stages, meter, log: createInMemorySetAsideLog(), now: new Date('2026-10-06T15:00:00Z'), targetPosts: 2 });
  assert.equal(r.posts.length, 2);
  assert.deepEqual(r.posts[0]!.stages, ['jev-scoring', 'reporter', 'writer', 'editor', 'captioner', 'fact-checker', 'mechanical', 'design']);
  assert.deepEqual(calls, ['reporter', 'draft', 'draft', 'captioner', 'fact-checker', 'reporter', 'draft', 'draft', 'captioner', 'fact-checker']);
  const post = r.posts[0]!;
  assert.ok(post.render.slides.length > 0);
  assert.ok(post.photos[0]!.photo, 'the cover has a photo');
  // A quote slide whose speaker's main photo is already on the cover and has no second photo here renders type-led (photo spec §4).
  const isQuote = (i: number) => post.render.slides[i + 1]?.layoutVariant === 'quote';
  assert.ok(post.photos.slice(1).every((t, i) => t.photo || t.via === 'icon' || (t.via === 'type-led' && isQuote(i))), 'every story slide has a photo, its icon background or (quote) a type-led slide');
  const l = logs.get(post.storyId)!;
  assert.equal(l.writer.length, 1);
  assert.equal(l.factCheck.length, 1);
  assert.equal(l.captioner.length, 1);
  assert.ok(l.captioner[0]!.ok);
  // The rendered caption is the news, the read, then the code-built Source line.
  assert.ok(post.render.caption!.startsWith(`${NEWS.text}\n\n${READ.text}\n\nSource: `), post.render.caption);
  assert.ok(l.design);
  assert.ok(budget.claudeUsd() > 0);
  assert.ok((r.costByStage.reporter ?? 0) > 0 && (r.costByStage.writer ?? 0) > 0 && (r.costByStage.editor ?? 0) > 0 && (r.costByStage.captioner ?? 0) > 0 && (r.costByStage['fact-checker'] ?? 0) > 0);
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

test('run budget: with wiggle the guard lets a call through past the cap and refuses one that could pass the ceiling', async () => {
  let called = 0;
  const create = async () => { called++; return msg('x', {}); };
  const params = { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [] };
  const past = createRunBudget({ capUsd: 1.5, wiggleUsd: 0.5, otherSpendUsd: () => 1.6 });
  assert.equal(past.ceilingUsd, 2);
  await past.guard(create)(params);
  assert.equal(called, 1);
  const near = createRunBudget({ capUsd: 1.5, wiggleUsd: 0.5, otherSpendUsd: () => 1.85 });
  await assert.rejects(() => near.guard(create)(params), /run ceiling \$2 \(cap \$1\.5 \+ wiggle\)/);
  assert.equal(called, 1);
});

test('cap: between stages the day stops only at the full cap, so a no-Claude stage (design) still runs near it', async () => {
  const { stages } = setup({ capUsd: 1.5 });
  const meter = createCostMeter({ capUsd: 1.5, alreadySpentUsd: 1.38 });
  const designed: string[] = [];
  const design = stages.design;
  stages.design = async (d, b, s) => { designed.push(d.storyId); return design(d, b, s); };
  // Reporter, Writer, Editor, Fact-checker stubbed through as zero-cost so only the meter matters here.
  const free = createStubStages({ costUsd: Object.fromEntries(['jev-scoring', 'reporter', 'writer', 'editor', 'captioner', 'fact-checker'].map((k) => [k, 0])) });
  const r = await runDay({ articles: STUB_ARTICLES, stages: { ...free, design: stages.design, mechanical: stages.mechanical }, meter, log: createInMemorySetAsideLog(), now: new Date('2026-10-06T15:00:00Z'), targetPosts: 1 });
  assert.equal(designed.length, 1, 'design ran at $1.38 of $1.50');
  assert.notEqual(r.stopReason, 'cost-cap');
});

// ── Captioner stage (social-captions redesign, 2026-10-19) ─────────────

function captionerSetup(opts: { recent?: RecentClosing[]; jev?: JevAsk } = {}) {
  const requests: Array<Parameters<MessagesCreate>[0]> = [];
  const create: MessagesCreate = async (params) => {
    requests.push(params);
    return msg('submit_caption', { news: NEWS, read: READ });
  };
  const jevCalls: string[] = [];
  const jev: JevAsk = opts.jev ?? (async (_req, meta) => {
    jevCalls.push(meta.version);
    return { answers: { builds: { noul: 0.9 } }, usage: { input_tokens: 1000, output_tokens: 0 }, model: 'stub-jev' };
  });
  const closings = memoryClosings(opts.recent ?? []);
  const stage = createCaptionerStage({ create, jev, closings });
  const parsed = briefSuperIntelligenceForce();
  const submission = checkDraft(sifDraftHandoff(), parsed);
  const draft: Draft = { storyId: 'sif', submission, filled: fillDraft(submission, parsed) };
  const brief: PipelineBrief = { storyId: 'sif', parsed, raw: '', pages: [] };
  const lastUser = () => {
    const m = requests.at(-1)!.messages[0]!.content;
    return typeof m === 'string' ? m : JSON.stringify(m);
  };
  return { stage, draft, brief, requests, jevCalls, closings, lastUser };
}

const built = (n: number): RecentClosing[] => Array.from({ length: n }, (_, i) => ({ closing: `closing ${i}`, buildLine: true, createdAt: new Date(`2026-10-1${i}T02:00:00Z`) }));

test('captioner stage sets the news and the read, asks Jev for the build fit, and charges Claude + Jev', async () => {
  const { stage, draft, brief, jevCalls, lastUser } = captionerSetup();
  const r = await stage(draft, brief);
  assert.ok(r.ok, r.ok ? '' : r.detail);
  assert.deepEqual(r.value.submission.caption, NEWS);
  assert.deepEqual(r.value.submission.caption_read, READ);
  assert.deepEqual(r.value.filled.caption, NEWS);
  assert.deepEqual(r.value.filled.caption_read, READ);
  assert.deepEqual(r.value.submission.slides, draft.submission.slides, 'the slides pass through');
  assert.deepEqual(jevCalls, [BUILD_FIT.version]);
  assert.ok(lastUser().includes(buildLineInstruction(true)));
  assert.ok(r.costUsd > jevCostUsd({ input_tokens: 1000, output_tokens: 0 }));
});

test('captioner stage skips Jev when the ceiling is hit', async () => {
  const { stage, draft, brief, jevCalls, lastUser, closings } = captionerSetup({ recent: built(2) });
  const r = await stage(draft, brief);
  assert.ok(r.ok);
  assert.equal(jevCalls.length, 0);
  assert.ok(lastUser().includes(buildLineInstruction(false)));
  assert.deepEqual(closings.recorded, [['sif', READ.text, false]]);
});

test('captioner stage survives a Jev failure', async () => {
  const { stage, draft, brief, lastUser, closings } = captionerSetup({ jev: async () => { throw new Error('jev down'); } });
  const r = await stage(draft, brief);
  assert.ok(r.ok);
  assert.ok(lastUser().includes(buildLineInstruction(false)));
  assert.equal(closings.recorded[0]![2], false, 'include is false');
});

test('captioner stage records the closing', async () => {
  const { stage, draft, brief, closings } = captionerSetup();
  const r = await stage(draft, brief);
  assert.ok(r.ok);
  assert.deepEqual(closings.recorded, [['sif', READ.text, true]]);
});

test('captioner stage: a closings log that fails to read or write never fails the caption', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { draft, brief } = captionerSetup();
  const stage = createCaptionerStage({
    create: async () => msg('submit_caption', { news: NEWS, read: READ }),
    jev: async () => ({ answers: { builds: { noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 0 }, model: 'stub-jev' }),
    closings: { recent: async () => { throw new Error('db down'); }, record: async () => { throw new Error('db down'); } },
  });
  const r = await stage(draft, brief);
  assert.ok(r.ok);
  assert.equal(warn.mock.callCount(), 2, 'one warning for the read, one for the write');
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /could not read carousel closings/);
  assert.match(String(warn.mock.calls[1]!.arguments[0]), /could not record the carousel closing/);
});

test('captioner stage: a fresh-caption rerun reuses the story\'s Jev fit (Jev called once, charged once)', async () => {
  const { stage, draft, brief, jevCalls, lastUser } = captionerSetup();
  const first = await stage(draft, brief);
  const second = await stage(draft, brief);
  assert.ok(first.ok && second.ok);
  assert.equal(jevCalls.length, 1);
  assert.ok(lastUser().includes(buildLineInstruction(true)), 'the cached fit still decides the build line');
  assert.ok(Math.abs(first.costUsd - second.costUsd - jevCostUsd({ input_tokens: 1000, output_tokens: 0 })) < 1e-9);
});

test('captioner stage: a captioner failure is a set-aside reason with its cost', async () => {
  const { draft, brief } = captionerSetup();
  const stage = createCaptionerStage({
    create: async () => msg('submit_caption', { news: NEWS, read: { text: 'No brand name here.', facts: [] } }),
    jev: async () => ({ answers: { builds: { noul: 0.1 } }, usage: { input_tokens: 10, output_tokens: 0 }, model: 'stub-jev' }),
    closings: memoryClosings(),
  });
  const r = await stage(draft, brief);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reasonCode, 'malformed-output');
    assert.ok(r.costUsd > 0);
  }
});
