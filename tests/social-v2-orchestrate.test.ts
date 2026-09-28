import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { runCreatorPipeline, type OrchestrateDeps } from '@/lib/social/editorial/v2/orchestrate';
import type { FactCheckerOutput } from '@/lib/social/editorial/v2/fact-checker';
import { parseBrief, parseEditedPost } from '@/lib/social/editorial/v2/parse';

/**
 * All tests inject stub dependencies — never a live Claude call, never a real
 * DB write. `persistDebugAndCompose` is a no-op stub so `pipeline_v2_debug`
 * never gets written to any real table.
 */

const BRIEF_RAW = `SINGLE STORY: no, Bloomberg Tech video roundup

THE NEWS: Anthropic says Claude writes 26% of its own R&D code as of September 2026.

THE STORY: Anthropic told reporters on September 17 2026 that Claude now writes 26% of the code its researchers ship, up from 1% in March.

TERMS:
- Anthropic: an AI safety company.
- Claude: Anthropic's model family.

IMAGES:
IMAGE 1: Dario Amodei at a Senate hearing. Credit: AP Photo. Link: https://x.example.com/dario.jpg

SOURCES:
- Bloomberg, 2026-09-17, https://bloomberg.example.com/anthropic-claude-rd
- The Information, 2026-09-18, https://theinformation.example.com/anthropic-follow-up`;

const DRAFT_RAW = `COVER OPTIONS:
1. [Shock number] Anthropic says its own AI writes 26% of its R&D code.
2. [Frame shift] Anthropic went from 1% AI-written code in March to 26% now.
3. [Authority vs. hype] Anthropic's own numbers say AI does a quarter of research work.
CHOSEN: 1
COVER HIGHLIGHT: 26% of its R&D code
COVER IMAGE: brief image 1

SLIDE 2
HEADLINE: Anthropic says the number went from 1% to 26% in six months
BODY: Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship.
HIGHLIGHT: 26% of the code its researchers ship
IMAGE: type only

SLIDE 3
BODY: The company said it measured the share by tracking which pull requests were opened by Claude vs. human engineers.
HIGHLIGHT: pull requests were opened by Claude
IMAGE: type only

FOLLOW: Follow Helios to keep up with how AI companies are actually using their own tools.`;

const EDITED_RAW = `COVER: Anthropic says its own AI writes 26% of its R&D code.
COVER HIGHLIGHT: 26% of its R&D code
COVER IMAGE: brief image 1

SLIDE 2
HEADLINE: 1% to 26% in six months
BODY: Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship.
HIGHLIGHT: 26% of the code
IMAGE: type only

SLIDE 3
BODY: The company measured the share by tracking which pull requests were opened by Claude vs. human engineers.
HIGHLIGHT: pull requests were opened by Claude
IMAGE: type only

FOLLOW: Follow Helios to keep up with how AI companies are actually using their own tools.

EDIT NOTES:
None`;

const CAPTION_RAW = `CAPTION:
Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship, up from 1% in March. The company said it measured the share by tracking which pull requests Claude opened vs. those human engineers opened, and the rise came alongside a broader rollout of Claude Code across research teams.

Would you trust AI-written code inside a research lab's stack?

Follow Helios to keep up with how AI companies are actually using their own tools.

Source: Bloomberg, September 17, 2026. Additional reporting: The Information, September 18, 2026.`;

const ROW = {
  id: '00000000-0000-0000-0000-000000000001',
  source: 'Bloomberg',
  source_url: 'https://bloomberg.example.com/anthropic-claude-rd',
  headline: 'Anthropic Says Claude Drives 26% of Its Research and Development',
  body: 'Full source article body about Anthropic and the 26% of R&D code claim, September 17 2026. From 1% in March. Sam Altman is not mentioned.',
  published_at: '2026-09-17',
};

const SOURCE_TEXT = 'Full source article body about Anthropic and the 26% of R&D code claim, September 17 2026. From 1% in March. Claude Code adoption is up across research teams.';

function stageUsage(cost = 0.05) {
  return { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50, approxCostUsd: cost };
}

function buildDeps(override: Partial<OrchestrateDeps> = {}): OrchestrateDeps {
  return {
    runReporter: async () => ({
      brief: parseBrief(BRIEF_RAW),
      briefRaw: BRIEF_RAW,
      sanitizedBriefRaw: BRIEF_RAW,
      fetchedUrls: ['https://bloomberg.example.com/anthropic-claude-rd'],
      stopReasons: ['end_turn'],
      usage: stageUsage(0.1),
    }),
    runWriter: async () => ({ post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, usage: stageUsage(0.1) }),
    runEditor: async () => ({ post: parseEditedPost(EDITED_RAW), raw: EDITED_RAW, editNotes: null, usage: stageUsage(0.05) }),
    runCaption: async () => ({ caption: 'x'.repeat(500) + '\n\nSource: Bloomberg, September 17, 2026.', raw: CAPTION_RAW, usage: stageUsage(0.02) }),
    runFactChecker: async (): Promise<FactCheckerOutput> => ({
      result: { verdict: 'PASS', flags: [] },
      raw: 'VERDICT: PASS\n\nFLAGS:\n',
      usage: stageUsage(0.05),
    }),
    fetchPage: async (url: string) => ({ ok: true, url, resolvedUrl: url, title: 'Anthropic R&D', byline: null, text: SOURCE_TEXT }),
    // Test stub: skip real HEAD requests. Accept every brief image as valid
    // so the pipeline can run end-to-end offline. Individual tests can pass
    // a validateBriefImages override to exercise the drop path.
    validateBriefImages: async (brief) => ({ valid: brief.images, dropped: [] }),
    persistDebugAndCompose: async () => { /* no-op — never write to real DB in tests */ },
    ...override,
  };
}

describe('runCreatorPipeline — happy path', () => {
  test('PASS verdict on first round ships the post', async () => {
    const result = await runCreatorPipeline(ROW, {}, buildDeps());
    assert.equal(result.ok, true);
    assert.equal(result.status, 'shipped');
    assert.ok(result.slug);
    assert.ok(result.previewUrl?.includes(result.slug!));
  });
});

describe('runCreatorPipeline — cost cap', () => {
  test('trips → needs_human_review when a single stage returns huge cost', async () => {
    // 5.0 USD on Reporter alone → cap $1.50 → bail after Reporter.
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runReporter: async () => ({
          brief: parseBrief(BRIEF_RAW),
          briefRaw: BRIEF_RAW,
          sanitizedBriefRaw: BRIEF_RAW,
          fetchedUrls: [],
          stopReasons: ['end_turn'],
          usage: stageUsage(5.0),
        }),
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.match(result.reason ?? '', /cost cap/i);
  });
});

describe('runCreatorPipeline — no fetchable sources', () => {
  test('all fetches fail → needs_human_review', async () => {
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        fetchPage: async (url: string) => ({ ok: false, url, error: 'timeout' }),
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.match(result.reason ?? '', /no SOURCES/i);
  });
});

describe('runCreatorPipeline — fact-check FLAGGED loop', () => {
  test('BIG flag → Writer rerun, then PASS ships', async () => {
    let factCheckCall = 0;
    let writerCallCount = 0;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runWriter: async () => {
          writerCallCount++;
          return { post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, usage: stageUsage(0.1) };
        },
        runFactChecker: async () => {
          factCheckCall++;
          if (factCheckCall === 1) {
            return {
              result: { verdict: 'FLAGGED', flags: [{ where: 'SLIDE 3 / BODY', text: 'x', problem: 'unsupported', sourcesSay: 'Nothing', size: 'BIG' }] },
              raw: 'VERDICT: FLAGGED',
              usage: stageUsage(0.05),
            };
          }
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', usage: stageUsage(0.05) };
        },
      }),
    );
    assert.equal(result.status, 'shipped');
    // 1 initial writer + 1 rerun after BIG flag = 2
    assert.equal(writerCallCount, 2);
  });

  test('all 3 rounds FLAGGED → needs_human_review', async () => {
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runFactChecker: async (): Promise<FactCheckerOutput> => ({
          result: { verdict: 'FLAGGED', flags: [{ where: 'SLIDE 3 / BODY', text: 'x', problem: 'p', sourcesSay: 's', size: 'SMALL' }] },
          raw: 'VERDICT: FLAGGED',
          usage: stageUsage(0.05),
        }),
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.match(result.reason ?? '', /3 rounds/);
  });

  test('SMALL caption flag → Caption rerun (not Writer)', async () => {
    let writerCallCount = 0;
    let captionCallCount = 0;
    let fcCall = 0;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runWriter: async () => {
          writerCallCount++;
          return { post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, usage: stageUsage(0.1) };
        },
        runCaption: async () => {
          captionCallCount++;
          return { caption: 'x'.repeat(500) + '\n\nSource: Bloomberg.', raw: CAPTION_RAW, usage: stageUsage(0.02) };
        },
        runFactChecker: async () => {
          fcCall++;
          if (fcCall === 1) {
            return {
              result: { verdict: 'FLAGGED', flags: [{ where: 'CAPTION / TEXT', text: 'x', problem: 'p', sourcesSay: 's', size: 'SMALL' }] },
              raw: 'VERDICT: FLAGGED',
              usage: stageUsage(0.05),
            };
          }
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', usage: stageUsage(0.05) };
        },
      }),
    );
    assert.equal(result.status, 'shipped');
    assert.equal(writerCallCount, 1); // NOT rerun — only SMALL caption flag
    assert.ok(captionCallCount >= 2); // initial + fact-check rerun
  });
});

describe('runCreatorPipeline — code-check repair budget', () => {
  test('gives the Editor two tries per round for slide errors, then bails', async () => {
    // First-pass Editor produces a body over 220; every retry still fails.
    // Expect exactly two editor(check-errors r1.*) repair entries in the
    // debug transcript before the pipeline bails to needs_human_review.
    let editorCall = 0;
    let capturedRepairs: Array<{ stage: string; reason: string }> = [];
    const overCap = parseEditedPost(EDITED_RAW);
    // Mutate the first slide to be over 220 chars so checkPost keeps failing.
    (overCap.slides[0]!).body = 'x'.repeat(292);

    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async () => {
          editorCall++;
          // Every editor call returns the same over-limit post.
          return { post: overCap, raw: EDITED_RAW, editNotes: null, usage: stageUsage(0.05) };
        },
        persistDebugAndCompose: async (_id, debug) => {
          capturedRepairs = debug.repairs.map((r) => ({ stage: r.stage, reason: r.reason }));
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    // 1 initial editor + 2 repair tries = 3 total editor calls.
    assert.equal(editorCall, 3);
    // Two repair entries in the debug transcript, both for editor.
    const editorRepairs = capturedRepairs.filter((r) => r.stage === 'editor');
    assert.equal(editorRepairs.length, 2);
    assert.match(editorRepairs[0]!.reason, /try 1\/2/);
    assert.match(editorRepairs[1]!.reason, /try 2\/2/);
  });
});

describe('runCreatorPipeline — REVIEWER NOTES entry point', () => {
  test('passes REVIEWER NOTES to Writer, not FACT-CHECK FLAGS', async () => {
    let writerInputSeen: unknown = null;
    const result = await runCreatorPipeline(
      ROW,
      {
        reviewerNotes: 'Make the cover tighter and add the CEO name.',
        previousEditedPostRaw: EDITED_RAW,
      },
      buildDeps({
        runWriter: async (input) => {
          writerInputSeen = input;
          return { post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, usage: stageUsage(0.1) };
        },
      }),
    );
    assert.equal(result.status, 'shipped');
    const w = writerInputSeen as { reviewerNotes?: string; previousPost?: string; factCheckFlags?: unknown };
    assert.equal(w.reviewerNotes, 'Make the cover tighter and add the CEO name.');
    assert.ok(w.previousPost);
    assert.equal(w.factCheckFlags, undefined, 'reviewer entry must not send fact-check flags');
  });
});
