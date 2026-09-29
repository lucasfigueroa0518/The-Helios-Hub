import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { injectIntoSlide3Body, runCreatorPipeline, type OrchestrateDeps } from '@/lib/social/editorial/v2/orchestrate';
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
HEADLINE: From 1% to 26% in six months, Anthropic says
BODY: Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship.
BIG NUMBER: 26%
NUMBER NOTE: of R&D code, per Anthropic
HIGHLIGHT: 26% of the code its researchers ship
IMAGE: type only

SLIDE 3
HEADLINE: Measured by Claude's own pull requests
BODY: The company said it measured the share by tracking which pull requests were opened by Claude vs. human engineers.
HIGHLIGHT: pull requests were opened by Claude
IMAGE: type only

SLIDE 4
HEADLINE: The rollout continues across research teams.
IMAGE: type only

SLIDE 5
HEADLINE: The change lands inside the model's own tooling.
BODY: Claude Code is now the primary way researchers ship changes to the codebase.
IMAGE: type only

SLIDE 6
HEADLINE: What the numbers do not say.
IMAGE: type only

FOLLOW: Follow Helios to keep up with how AI companies are actually using their own tools.`;

const EDITED_RAW = `COVER: Anthropic says its own AI writes 26% of its R&D code.
COVER HIGHLIGHT: 26% of its R&D code
COVER IMAGE: brief image 1

SLIDE 2
HEADLINE: 1% to 26% in six months
BODY: Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship.
BIG NUMBER: 26%
NUMBER NOTE: of R&D code, per Anthropic
HIGHLIGHT: 26% of the code
IMAGE: type only

SLIDE 3
HEADLINE: Measured by Claude's own pull requests
BODY: The company said it measured the share by tracking which pull requests were opened by Claude vs. human engineers.
HIGHLIGHT: pull requests were opened by Claude
IMAGE: type only

SLIDE 4
HEADLINE: The rollout continues across research teams.
IMAGE: type only

SLIDE 5
HEADLINE: The change lands inside the model's own tooling.
BODY: Claude Code is now the primary way researchers ship changes to the codebase.
IMAGE: type only

SLIDE 6
HEADLINE: What the numbers do not say.
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
    runWriter: async () => ({ post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, stopReasons: ["end_turn"], usage: stageUsage(0.1) }),
    runEditor: async () => ({ post: parseEditedPost(EDITED_RAW), raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) }),
    runCaption: async () => ({ caption: 'x'.repeat(500) + '\n\nSource: Bloomberg, September 17, 2026.', raw: CAPTION_RAW, stopReasons: ["end_turn"], usage: stageUsage(0.02) }),
    runFactChecker: async (): Promise<FactCheckerOutput> => ({
      result: { verdict: 'PASS', flags: [] },
      raw: 'VERDICT: PASS\n\nFLAGS:\n',
      stopReasons: ["end_turn"],
      usage: stageUsage(0.05),
    }),
    fetchPage: async (url: string) => ({ ok: true, url, resolvedUrl: url, title: 'Anthropic R&D', byline: null, text: SOURCE_TEXT }),
    // Test stub: skip real HEAD requests. Accept every brief image as valid
    // so the pipeline can run end-to-end offline. Individual tests can pass
    // a validateBriefImages override to exercise the drop path.
    validateBriefImages: async (brief) => ({ valid: brief.images, dropped: [] }),
    // Image step: default to type-only (no photos picked) — individual
    // tests can pass an override to exercise the picked-image path.
    runImageStep: async () => ({ selected: new Map(), report: [], visionCalls: 0, visionUsage: [] }),
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
          return { post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, stopReasons: ["end_turn"], usage: stageUsage(0.1) };
        },
        runFactChecker: async () => {
          factCheckCall++;
          if (factCheckCall === 1) {
            return {
              result: { verdict: 'FLAGGED', flags: [{ where: 'SLIDE 3 / BODY', text: 'x', problem: 'unsupported', sourcesSay: 'Nothing', size: 'BIG' }] },
              raw: 'VERDICT: FLAGGED',
              stopReasons: ["end_turn"],
              usage: stageUsage(0.05),
            };
          }
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
      }),
    );
    assert.equal(result.status, 'shipped');
    // 1 initial writer + 1 rerun after BIG flag = 2
    assert.equal(writerCallCount, 2);
  });

  test('all rounds FLAGGED → needs_human_review, reason lists every open flag with WHERE/TEXT/PROBLEM/SOURCES SAY', async () => {
    // Round limit is now 2 (initial check + 1 fix round). After 2, bail.
    const openFlags = [
      { where: 'SLIDE 3 / BODY', text: 'invented claim', problem: 'not in sources', sourcesSay: 'Nothing', size: 'SMALL' as const },
      { where: 'CAPTION / TEXT', text: 'independent nonprofit', problem: 'descriptor not sourced', sourcesSay: 'Sources describe Epoch AI only as developer of the scale.', size: 'SMALL' as const },
    ];
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runFactChecker: async (): Promise<FactCheckerOutput> => ({
          result: { verdict: 'FLAGGED', flags: openFlags },
          raw: 'VERDICT: FLAGGED',
          stopReasons: ["end_turn"],
          usage: stageUsage(0.05),
        }),
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    // Reason names the round count correctly and enumerates every flag.
    assert.match(result.reason ?? '', /after 2 rounds/);
    assert.match(result.reason ?? '', /2 open flag\(s\)/);
    // Each flag's WHERE, TEXT, PROBLEM, SOURCES SAY appears in the reason.
    assert.match(result.reason ?? '', /SLIDE 3 \/ BODY/);
    assert.match(result.reason ?? '', /TEXT: invented claim/);
    assert.match(result.reason ?? '', /PROBLEM: not in sources/);
    assert.match(result.reason ?? '', /SOURCES SAY: Nothing/);
    assert.match(result.reason ?? '', /CAPTION \/ TEXT/);
    assert.match(result.reason ?? '', /TEXT: independent nonprofit/);
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
          return { post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, stopReasons: ["end_turn"], usage: stageUsage(0.1) };
        },
        runCaption: async () => {
          captionCallCount++;
          return { caption: 'x'.repeat(500) + '\n\nSource: Bloomberg.', raw: CAPTION_RAW, stopReasons: ["end_turn"], usage: stageUsage(0.02) };
        },
        runFactChecker: async () => {
          fcCall++;
          if (fcCall === 1) {
            return {
              result: { verdict: 'FLAGGED', flags: [{ where: 'CAPTION / TEXT', text: 'x', problem: 'p', sourcesSay: 's', size: 'SMALL' }] },
              raw: 'VERDICT: FLAGGED',
              stopReasons: ["end_turn"],
              usage: stageUsage(0.05),
            };
          }
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', stopReasons: ["end_turn"], usage: stageUsage(0.05) };
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
          return { post: overCap, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) };
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

describe('runCreatorPipeline — soft errors continue past code checks, block at final gate', () => {
  test('char_limit surviving all rounds → Fact-checker still runs → final gate bails as needs_human_review with the length errors listed', async () => {
    // Editor keeps returning a post whose SLIDE 2 body is over 220. That's a
    // SOFT error (char_limit). Round loop must not stop — Fact-checker still
    // runs. Fact-checker returns PASS. Final gate then bails to
    // needs_human_review with the char_limit error listed.
    const overPost = parseEditedPost(EDITED_RAW);
    (overPost.slides[0]!).body = 'x'.repeat(292); // 72 over the 220 limit
    let factCheckCalls = 0;
    let bailReason: string | undefined;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async () => ({ post: overPost, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) }),
        runFactChecker: async () => {
          factCheckCalls++;
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
        persistDebugAndCompose: async (_id, debug, cols) => {
          if (cols.composeStatus === 'needs_human_review') bailReason = debug.outcome.reason;
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    // Fact-checker MUST have run at least once — soft errors don't stop the round.
    assert.ok(factCheckCalls >= 1, `expected fact-check to run despite char_limit; ran ${factCheckCalls} times`);
    // Bail reason should name the surviving char_limit failure.
    assert.match(bailReason ?? '', /char_limit \/ highlight_substring errors survived/);
    assert.match(bailReason ?? '', /SLIDE 2 BODY \(292 characters, limit 220\)/);
    // Reason must name the ACTUAL number of rounds ran, not the max. The
    // fact-checker PASSed on round 1, so the loop exited after 1 round.
    assert.match(bailReason ?? '', /across 1 round:/);
    assert.doesNotMatch(bailReason ?? '', /across 3 rounds/);
  });

  test('hard error (banned voice) still stops before the Fact-checker', async () => {
    // Editor returns a post with an em dash in a body. Repair tries fail.
    // Pipeline must bail without ever calling the Fact-checker.
    const bannedPost = parseEditedPost(EDITED_RAW);
    (bannedPost.slides[0]!).body = 'This — has an em dash and is a hard error.';
    let factCheckCalls = 0;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async () => ({ post: bannedPost, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) }),
        runFactChecker: async () => {
          factCheckCalls++;
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.equal(factCheckCalls, 0, 'hard error must stop the round before the Fact-checker runs');
    assert.match(result.reason ?? '', /hard code checks failed/);
  });
});

describe('runCreatorPipeline — substantive-source filter for the Caption', () => {
  test('Caption receives a briefRaw with only sources whose fetched text passed the threshold', async () => {
    // Fetch returns full text for source 1, tiny preview for source 2.
    // Threshold defaults to 1500 chars. Caption's briefRaw SOURCES section
    // should include only source 1.
    let captionBriefSeen = '';
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        fetchPage: async (url: string) => {
          const isBloomberg = url.includes('anthropic-claude-rd');
          const text = isBloomberg ? 'full article body '.repeat(200) : 'short preview'; // ~3400 vs 13 chars
          return { ok: true, url, resolvedUrl: url, title: 't', byline: null, text };
        },
        runCaption: async (input) => {
          captionBriefSeen = input.briefRaw;
          return { caption: 'x'.repeat(500) + '\n\nSource: Bloomberg.', raw: 'CAPTION:\n…', stopReasons: ['end_turn'], usage: stageUsage(0.02) };
        },
      }),
    );
    // Bloomberg (the long one) must be in the SOURCES section the caption sees.
    assert.match(captionBriefSeen, /SOURCES:[\s\S]*Bloomberg/);
    // The Information (the short one) must be filtered out.
    assert.doesNotMatch(captionBriefSeen, /The Information/);
    // Pipeline should still ship (all other checks are OK in this stub).
    // Actually the caption stage is short enough that fact-check + final
    // gate proceed. Assert status is either shipped or needs_human_review
    // (soft errors possible from other fixture bits) but NOT failed.
    assert.notEqual(result.status, 'failed');
  });
});

describe('injectIntoSlide3Body', () => {
  const raw = `COVER: A cover.
COVER HIGHLIGHT: cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: h2
BODY: original body 2
HIGHLIGHT: original
IMAGE: type only

SLIDE 3
HEADLINE: h3
BODY: original body 3.
HIGHLIGHT: original
IMAGE: type only

SLIDE 4
BODY: original body 4.

FOLLOW: follow.

EDIT NOTES:
None`;

  test('appends the sentence to SLIDE 3 BODY, leaves SLIDE 2 + SLIDE 4 untouched', () => {
    const out = injectIntoSlide3Body(raw, 'SoftBank is betting on the same loop with $21 billion.');
    // SLIDE 3 body must now include the injection.
    assert.match(out, /SLIDE 3\nHEADLINE: h3\nBODY: original body 3\. SoftBank is betting on the same loop with \$21 billion\.\n/);
    // SLIDE 2 body must stay original.
    assert.match(out, /SLIDE 2\nHEADLINE: h2\nBODY: original body 2\n/);
    // SLIDE 4 body must stay original.
    assert.match(out, /SLIDE 4\nBODY: original body 4\./);
  });

  test('no-op when SLIDE 3 is missing', () => {
    const noSlide3 = `COVER: x\nCOVER HIGHLIGHT: x\nCOVER IMAGE: type only\n\nSLIDE 2\nBODY: b.\n\nFOLLOW: f.\n\nEDIT NOTES:\nNone`;
    assert.equal(injectIntoSlide3Body(noSlide3, 'anything'), noSlide3);
  });
});

describe('runCreatorPipeline — --inject option', () => {
  test('injection lands in the POST the Fact-checker sees on round 1', async () => {
    // The canonical negative-test sentence contains "$21 billion" — a
    // number that would trigger number_trace (a HARD code check) and bail
    // BEFORE fact-check runs. That's actually the correct pipeline
    // behavior for a live run (fabrications get caught either by
    // number_trace OR the Fact-checker). For this UNIT test though we
    // want to verify the Fact-checker sees the injection — stub sources
    // to include "$21 billion" so number_trace passes.
    let fcPostSeen = '';
    await runCreatorPipeline(
      ROW,
      { injectSentence: 'SoftBank is betting on the same loop with $21 billion.' },
      buildDeps({
        fetchPage: async (url: string) => ({
          ok: true,
          url,
          resolvedUrl: url,
          title: 't',
          byline: null,
          // Add "$21 billion" and "SoftBank" so number_trace passes.
          text: `${SOURCE_TEXT} Separately, SoftBank raised $21 billion this quarter.`,
        }),
        runEditor: async (input) => ({
          post: parseEditedPost(input.post),
          raw: input.post,
          editNotes: null,
          stopReasons: ['end_turn'],
          usage: stageUsage(0.05),
        }),
        runFactChecker: async (input) => {
          fcPostSeen = input.post;
          return { result: { verdict: 'PASS', flags: [] }, raw: 'VERDICT: PASS', stopReasons: ['end_turn'], usage: stageUsage(0.05) };
        },
      }),
    );
    assert.match(fcPostSeen, /SLIDE 3\n[\s\S]*BODY: [\s\S]*SoftBank is betting on the same loop with \$21 billion\./);
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
          return { post: parseEditedPost(DRAFT_RAW), raw: DRAFT_RAW, stopReasons: ["end_turn"], usage: stageUsage(0.1) };
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
