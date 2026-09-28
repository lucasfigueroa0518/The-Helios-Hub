import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  buildFromBriefDeps,
  buildSummaryMarkdown,
  type CachedBrief,
  type CapturedRun,
  wrapDepsForCapture,
} from '@/lib/social/editorial/v2/test-runner-support';
import { parseBrief } from '@/lib/social/editorial/v2/parse';
import type { PipelineV2Debug } from '@/lib/social/editorial/v2/log';
import type { ReporterOutput } from '@/lib/social/editorial/v2/reporter';
import type { OrchestrateResult } from '@/lib/social/editorial/v2/orchestrate';

/* ── Fixtures ────────────────────────────────────────────────────────── */

const BRIEF_RAW = `SINGLE STORY: no

THE NEWS: Anthropic says Claude writes 26% of its own R&D code.

THE STORY: Anthropic told reporters on 2026-09-17 that Claude now writes 26% of the code its researchers ship, up from 1% in March.

TERMS:
- Anthropic: an AI safety company.

IMAGES: None found

SOURCES:
- Bloomberg, 2026-09-17, https://bloomberg.example.com/x`;

const fakeReporterOutput: ReporterOutput = {
  brief: parseBrief(BRIEF_RAW),
  briefRaw: BRIEF_RAW,
  sanitizedBriefRaw: BRIEF_RAW,
  fetchedUrls: ['https://bloomberg.example.com/x'],
  stopReasons: ['end_turn'],
  usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 400, webSearchRequests: 3, approxCostUsd: 0.05 },
};

const fakeCachedBrief: CachedBrief = {
  reporterOutput: fakeReporterOutput,
  sourceTexts: [
    { url: 'https://bloomberg.example.com/x', title: 'Anthropic R&D', text: 'Full article text about Anthropic and Claude R&D usage in 2026.' },
  ],
};

/* ── wrapDepsForCapture ─────────────────────────────────────────────── */

describe('wrapDepsForCapture', () => {
  test('captures reporterOutput from a base runReporter dep', async () => {
    let inputSeen: unknown = null;
    const { deps, captured } = wrapDepsForCapture({
      runReporter: async (input) => { inputSeen = input; return fakeReporterOutput; },
    });
    assert.ok(deps.runReporter);
    const out = await deps.runReporter!({ headline: 'h', source: 's' });
    assert.equal(out, fakeReporterOutput);
    assert.equal(captured.reporterOutput, fakeReporterOutput);
    assert.deepEqual(inputSeen, { headline: 'h', source: 's' });
  });

  test('captures fetched source texts from every successful fetchPage', async () => {
    const { deps, captured } = wrapDepsForCapture({
      fetchPage: async (url) => ({ ok: true, url, resolvedUrl: url, title: 't', byline: null, text: `body of ${url}` }),
    });
    await deps.fetchPage!('https://a.example.com');
    await deps.fetchPage!('https://b.example.com');
    assert.equal(captured.fetchedSources.length, 2);
    assert.equal(captured.fetchedSources[0]!.url, 'https://a.example.com');
    assert.match(captured.fetchedSources[0]!.text, /body of https:\/\/a/);
  });

  test('captures failing fetchPage results but does NOT add them to fetchedSources', async () => {
    const { deps, captured } = wrapDepsForCapture({
      fetchPage: async (url) => ({ ok: false, url, error: 'timeout' }),
    });
    const r = await deps.fetchPage!('https://x.example.com');
    assert.equal(r.ok, false);
    assert.equal(captured.fetchedSources.length, 0);
  });

  test('persistDebugAndCompose intercepts the debug + columns without writing to a DB', async () => {
    const { deps, captured } = wrapDepsForCapture({});
    const debug: PipelineV2Debug = {
      version: 2,
      articleId: 'aaaa',
      startedAt: '2026-09-28T00:00:00Z',
      rounds: [],
      repairs: [],
      outcome: { status: 'shipped', totalCostUsd: 0.42 },
    };
    await deps.persistDebugAndCompose!('aaaa', debug, {
      composeStatus: 'composed',
      renderPostJson: { format: 'carousel' },
      renderSlug: 'test-slug',
    });
    assert.equal(captured.debug, debug);
    assert.equal(captured.composeStatus, 'composed');
    assert.deepEqual(captured.renderPostJson, { format: 'carousel' });
    assert.equal(captured.renderSlug, 'test-slug');
    assert.equal(captured.composeError, null);
  });

  test('when baseDeps has no runReporter/fetchPage, the wrapper omits those keys so the orchestrator falls back to its defaults', () => {
    const { deps } = wrapDepsForCapture({});
    assert.equal(deps.runReporter, undefined);
    assert.equal(deps.fetchPage, undefined);
    // But persist is always overridden (that's the "never write to DB" contract).
    assert.ok(deps.persistDebugAndCompose);
  });
});

/* ── buildFromBriefDeps ─────────────────────────────────────────────── */

describe('buildFromBriefDeps', () => {
  test('runReporter returns the cached ReporterOutput verbatim', async () => {
    const deps = buildFromBriefDeps(fakeCachedBrief);
    const out = await deps.runReporter!({ headline: 'h', source: 's' });
    assert.equal(out, fakeReporterOutput);
  });

  test('fetchPage returns cached source text for a known URL', async () => {
    const deps = buildFromBriefDeps(fakeCachedBrief);
    const r = await deps.fetchPage!('https://bloomberg.example.com/x');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.title, 'Anthropic R&D');
      assert.match(r.text, /Anthropic and Claude R&D/);
    }
  });

  test('fetchPage returns an error result for URLs not in the cached brief', async () => {
    const deps = buildFromBriefDeps(fakeCachedBrief);
    const r = await deps.fetchPage!('https://unknown.example.com/y');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not in cached brief/);
  });
});

/* ── buildSummaryMarkdown ───────────────────────────────────────────── */

describe('buildSummaryMarkdown', () => {
  const result: OrchestrateResult = {
    ok: false,
    status: 'needs_human_review',
    reason: 'char_limit / highlight_substring errors survived every repair try across all 3 rounds:\nSLIDE 7 BODY (243 characters, limit 220): cut at least 23 characters (about 4 words).',
    costUsd: 0.62,
    stagesRun: ['reporter', 'writer', 'editor', 'caption', 'fact-checker(r1)'],
  };
  const debug: PipelineV2Debug = {
    version: 2,
    articleId: '8339205f',
    startedAt: '2026-09-28T00:00:00Z',
    finishedAt: '2026-09-28T00:01:20Z',
    reporter: {
      brief: parseBrief(BRIEF_RAW),
      briefRaw: BRIEF_RAW,
      stopReasons: ['pause_turn', 'end_turn'],
      usage: { inputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 800, webSearchRequests: 3, approxCostUsd: 0.10 },
    },
    sources: [
      { url: 'https://bloomberg.example.com/x', ok: true, length: 8000, textPreview: '...' },
      { url: 'https://broken.example.com/y', ok: false, error: 'timeout' },
    ],
    imageValidation: {
      kept: [{ number: 1, link: 'https://x.example.com/a.jpg', credit: 'AP Photo' }],
      dropped: [{ number: 2, link: 'https://x.example.com/b.jpg', credit: '[TBD]', reason: 'credit "[TBD]" is a bracketed placeholder' }],
    },
    draft: {
      post: parseBriefToPost('draft'),
      raw: '(raw)',
      usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500, approxCostUsd: 0.05 },
    },
    edited: {
      post: parseBriefToPost('edited'),
      raw: '(edited raw)',
      editNotes: ['Tightened cover.'],
      usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500, approxCostUsd: 0.05 },
    },
    caption: {
      caption: 'A caption body.\n\nSource: Bloomberg, 2026',
      raw: 'CAPTION:\nA caption body.\n\nSource: Bloomberg, 2026',
      usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 200, approxCostUsd: 0.02 },
    },
    repairs: [
      { round: 1, stage: 'editor', reason: '2 slide error(s), try 1/2', usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500, approxCostUsd: 0.05 } },
      { round: 1, stage: 'editor', reason: '1 slide error(s), try 2/2', usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500, approxCostUsd: 0.05 } },
    ],
    rounds: [
      {
        round: 1,
        post: parseBriefToPost('final'),
        caption: 'final caption',
        factCheck: { verdict: 'PASS', flags: [] },
        factCheckRaw: 'VERDICT: PASS',
        usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, approxCostUsd: 0.03 },
      },
    ],
    outcome: { status: 'needs_human_review', reason: 'char_limit soft errors', totalCostUsd: 0.62 },
  };
  const captured: CapturedRun = {
    result,
    debug,
    composeStatus: 'needs_human_review',
    composeError: 'char_limit soft errors',
    renderPostJson: null,
    renderSlug: null,
    reporterOutput: null,
    fetchedSources: [],
  };

  test('renders the top header with status + total cost', () => {
    const md = buildSummaryMarkdown(captured, {
      articleId: '8339205f-11ba-44c5-b7ab-026be791119b',
      articleHeadline: "Anthropic's Claude Takes Bigger Role in Building AI",
      runId: '2026-09-28T00-01-20-000Z',
      usedFromBrief: false,
    });
    assert.match(md, /# v2 pipeline run/);
    assert.match(md, /Status: \*\*needs_human_review\*\*/);
    assert.match(md, /Total cost: \*\*\$0\.6200\*\*/);
    assert.match(md, /Bloomberg's Claude|Anthropic's Claude/);
  });

  test('lists every stop_reason from the Reporter', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    assert.match(md, /Stop reasons: `pause_turn, end_turn`/);
  });

  test('shows the source fetch results (ok + failure)', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    assert.match(md, /✅ https:\/\/bloomberg.example.com\/x \(8000 chars\)/);
    assert.match(md, /❌ https:\/\/broken.example.com\/y — timeout/);
  });

  test('lists the image validation kept and dropped', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    assert.match(md, /Kept: 1/);
    assert.match(md, /IMAGE 1: credit "AP Photo"/);
    assert.match(md, /Dropped: 1/);
    assert.match(md, /IMAGE 2: credit "\[TBD\]" is a bracketed placeholder/);
  });

  test('renders each slide with per-field character count', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    // COVER (X chars, limit 100) — X depends on fixture
    assert.match(md, /\*\*COVER\*\* \(\d+ chars, limit 100\)/);
    // FOLLOW (X chars, limit 100)
    assert.match(md, /\*\*FOLLOW\*\* \(\d+ chars, limit 100\)/);
  });

  test('lists every repair attempt (round + stage + reason)', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    assert.match(md, /Round 1.*editor.*try 1\/2/);
    assert.match(md, /Round 1.*editor.*try 2\/2/);
  });

  test('renders the fact-check verdict', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    assert.match(md, /Round 1 — verdict: \*\*PASS\*\*/);
  });

  test('renders the cost summary with per-stage costs', () => {
    const md = buildSummaryMarkdown(captured, { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false });
    assert.match(md, /Reporter: \$0\.1000/);
    assert.match(md, /Writer \(initial\): \$0\.0500/);
    assert.match(md, /Repairs \(2\): \$0\.1000/);
    assert.match(md, /Total: \$0\.6200/);
  });

  test('when captured.debug is null, the summary still renders a header + note', () => {
    const md = buildSummaryMarkdown(
      { ...captured, debug: null },
      { articleId: 'x', articleHeadline: 'h', runId: 'r', usedFromBrief: false },
    );
    assert.match(md, /No debug object captured/);
  });
});

/* ── Helpers for fixtures ────────────────────────────────────────────── */

function parseBriefToPost(label: string): import('@/lib/social/editorial/v2/parse').ParsedPost {
  const raw = `COVER: An ${label} cover.
COVER HIGHLIGHT: cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: ${label} headline
BODY: ${label} body of moderate length that fits under 220 characters.
HIGHLIGHT: body
IMAGE: type only

FOLLOW: Follow Helios for the ${label}.

EDIT NOTES:
None`;
  return require('@/lib/social/editorial/v2/parse').parseEditedPost(raw);
}
