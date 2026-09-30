import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { editorModeFor, injectIntoSlide3Body, runCreatorPipeline, type OrchestrateDeps } from '@/lib/social/editorial/v2/orchestrate';
import type { CheckError } from '@/lib/social/editorial/v2/code-checks';
import type { FactCheckerOutput } from '@/lib/social/editorial/v2/fact-checker';
import type { FieldRepairInput, FieldRepairOutput } from '@/lib/social/editorial/v2/field-repair';
import { parseBrief, parseEditedPost } from '@/lib/social/editorial/v2/parse';

/**
 * All tests inject stub dependencies — never a live Claude call, never a real
 * DB write. `persistDebugAndCompose` is a no-op stub so `pipeline_v2_debug`
 * never gets written to any real table.
 */

const BRIEF_RAW = `SINGLE STORY: yes

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

const DRAFT_RAW = `OUTLINE:
SLIDE 2: stat — HEADLINE: 1% to 26% in six months, Anthropic says | BIG: 26% | NOTE: of R&D code, per Anthropic
SLIDE 3: text — Measured by which pull requests Claude opened.
SLIDE 4: landing — HEADLINE: The rollout continues across research teams.
SLIDE 5: text — Claude Code is now the primary way researchers ship changes.
SLIDE 6: landing — HEADLINE: What the numbers do not say.
FOLLOW: A call to follow Helios for AI tool usage.

COVER OPTIONS:
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

/**
 * Test-only field-repair tracker. Records every call the pipeline makes to
 * runFieldRepair and lets the test decide what "newText" to hand back per
 * call. Simulates "repair still fails" (return the same over-limit text) or
 * "repair introduces a banned phrase" (return text with the banned literal).
 */
type FieldRepairStub = {
  fn: (input: FieldRepairInput) => Promise<FieldRepairOutput>;
  calls: FieldRepairInput[];
};

function makeFieldRepairStub(
  pick: (input: FieldRepairInput, callIndex: number) => string,
): FieldRepairStub {
  const calls: FieldRepairInput[] = [];
  const fn = async (input: FieldRepairInput): Promise<FieldRepairOutput> => {
    const callIndex = calls.length;
    calls.push(input);
    const newText = pick(input, callIndex);
    return {
      newText,
      stillOver: newText.length > input.limit,
      raw: newText,
      usage: { inputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, approxCostUsd: 0 },
    };
  };
  return { fn, calls };
}

/**
 * Build a ParsedPost from EDITED_RAW with SLIDE 2 BODY overridden to a
 * user-supplied string. Used to seed the char_limit path in the tests
 * below: pass a >220 char string to trip char_limit, or a valid
 * ≤220 string that also carries a hard-error trigger (banned phrase,
 * unsourced number) to test soft-repair verification bails.
 */
function makeOverPost(bodyText: string) {
  const p = parseEditedPost(EDITED_RAW);
  (p.slides[0]!).body = bodyText;
  return p;
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

  test('ship path: image step\'s cover photo lands on the persisted Post as photoUrl + photoCredit', async () => {
    // 2026-09-29 late: the reconstructPost bail-path fix has a mirror
    // requirement on the ship path — the adapter must receive the
    // selectedImages Map and attach photos to the composed Post. This
    // test proves it end-to-end: the image-step stub returns a Suleyman
    // cover selection, and we verify the persisted Post carries it.
    let persistedPost: unknown = null;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runImageStep: async () => ({
          selected: new Map([['cover', {
            // Anthropic (single-token subject) so the cover-name-of-pictured-
            // person check doesn't fire on this attachment test. Cover text
            // in EDITED_RAW says "Anthropic says its own AI writes 26%...".
            wikidataId: 'Q4574171',
            subject: 'Anthropic',
            label: 'Anthropic',
            commonsFile: 'File:Anthropic HQ.jpg',
            storageUrl: 'https://commons.example/Mustafa.jpg',
            license: 'CC BY 2.0',
            licenseUrl: null,
            author: 'Joi Ito',
            credit: 'Joi Ito. Via Wikimedia Commons.',
            isPortrait: true,
            source: 'wikimedia',
          }]]),
          report: [],
          visionCalls: 1,
          visionUsage: [],
        }),
        persistDebugAndCompose: async (_id, _debug, cols) => { persistedPost = cols.renderPostJson; },
      }),
    );
    assert.equal(result.status, 'shipped');
    const p = persistedPost as { slides?: Array<{ photoUrl?: string; photoCredit?: string }> } | null;
    assert.ok(p?.slides && p.slides.length > 0, 'expected persisted Post with slides');
    // Cover is slides[0]. The Suleyman photo must be attached with its credit.
    assert.equal(p!.slides![0]!.photoUrl, 'https://commons.example/Mustafa.jpg');
    assert.match(p!.slides![0]!.photoCredit ?? '', /Joi Ito/);
  });

  test('ship path: image step placed a photo but adapter dropped it → bail (not silent ship)', async () => {
    // Simulates a regression where the adapter ignores selectedImages.
    // We stub the image step to return a non-empty Map, then stub adaptToPost
    // indirectly by making the "Writer draft has no cover.image" while
    // ALSO passing a selected image — the real adapter would still attach
    // it. To force the guard to fire we make the runImageStep return an
    // entry keyed by a slide position that doesn't exist in the Post, so
    // the adapter can't attach it anywhere.
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runImageStep: async () => ({
          // Key '99' — no slide at position 99, so adapter attaches nothing.
          selected: new Map([[99 as never, {
            wikidataId: 'Q1',
            subject: 'Nobody',
            label: 'Nobody',
            commonsFile: 'File:Nobody.jpg',
            storageUrl: 'https://commons.example/Nobody.jpg',
            license: 'CC0',
            licenseUrl: null,
            author: 'A',
            credit: 'A. Via Wikimedia Commons.',
            isPortrait: true,
            source: 'wikimedia',
          }]]),
          report: [],
          visionCalls: 0,
          visionUsage: [],
        }),
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.match(result.reason ?? '', /image step placed 1 photo/);
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

describe('runCreatorPipeline — SINGLE STORY: No triggers Reporter narrow-to-one retry (2026-09-29 late)', () => {
  test('first pass "no" → Reporter re-called with narrow input; second pass "yes" continues pipeline', async () => {
    const briefRawNo = BRIEF_RAW.replace('SINGLE STORY: yes', 'SINGLE STORY: no, podcast interview covering multiple topics');
    let reporterCalls = 0;
    const narrowReceived: string[] = [];
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runReporter: async (input) => {
          reporterCalls += 1;
          if (input.narrow) {
            narrowReceived.push(input.narrow.reason);
            // Second pass returns a proper single-story brief.
            return {
              brief: parseBrief(BRIEF_RAW),
              briefRaw: BRIEF_RAW,
              sanitizedBriefRaw: BRIEF_RAW,
              fetchedUrls: ['https://bloomberg.example.com/anthropic-claude-rd'],
              stopReasons: ['end_turn'],
              usage: stageUsage(0.05),
            };
          }
          // First pass returns "no".
          return {
            brief: parseBrief(briefRawNo),
            briefRaw: briefRawNo,
            sanitizedBriefRaw: briefRawNo,
            fetchedUrls: ['https://bloomberg.example.com/anthropic-claude-rd'],
            stopReasons: ['end_turn'],
            usage: stageUsage(0.1),
          };
        },
      }),
    );
    assert.equal(reporterCalls, 2, 'Reporter must be called twice: initial + narrow-to-one');
    assert.match(narrowReceived[0]!, /podcast interview/);
    // Pipeline continues past the gate (may still bail later for other reasons, but not on SINGLE STORY).
    assert.doesNotMatch(result.reason ?? '', /SINGLE STORY: No after narrow/);
  });

  test('second pass still "no" → bail to human review', async () => {
    const briefRawNo = BRIEF_RAW.replace('SINGLE STORY: yes', 'SINGLE STORY: no, source has no single main event');
    let reporterCalls = 0;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runReporter: async () => {
          reporterCalls += 1;
          return {
            brief: parseBrief(briefRawNo),
            briefRaw: briefRawNo,
            sanitizedBriefRaw: briefRawNo,
            fetchedUrls: ['https://bloomberg.example.com/anthropic-claude-rd'],
            stopReasons: ['end_turn'],
            usage: stageUsage(0.1),
          };
        },
      }),
    );
    assert.equal(reporterCalls, 2);
    assert.equal(result.status, 'needs_human_review');
    assert.match(result.reason ?? '', /SINGLE STORY: No after narrow-to-one retry/);
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
  // 2026-09-30 rewire: char_limit errors now route to `runFieldRepair`
  // (field-scoped Sonnet, per-field small call) inside the round; the
  // post-PASS soft-repair loop still uses `runEditor`. `runFieldRepair`
  // is now injectable via OrchestrateDeps so this test can stub both
  // ends without a live Claude call.
  test('in-round tries + post-PASS soft-repair loop; then bails when both run out', async () => {
    // First-pass Editor produces a body over 220; every field-repair try
    // returns the SAME over-limit text (simulating a repair that can't
    // trim enough); Fact-checker returns PASS so the post-PASS soft-repair
    // loop runs; the Editor in soft-repair mode ALSO returns the same
    // over-limit post 6 times. Final gate then bails to needs_human_review.
    const overBody = 'x'.repeat(292); // 72 over the 220 body limit.
    const overPost = makeOverPost(overBody);
    let editorCall = 0;
    let capturedRepairs: Array<{ stage: string; reason: string }> = [];
    // Field-repair keeps returning the SAME over-limit newText — simulates
    // "Sonnet can't cut enough to fit even in a field-scoped call."
    const fr = makeFieldRepairStub(() => overBody);
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async () => {
          editorCall++;
          return { post: overPost, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
        runFieldRepair: fr.fn,
        persistDebugAndCompose: async (_id, debug) => {
          capturedRepairs = debug.repairs.map((r) => ({ stage: r.stage, reason: r.reason }));
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    // Editor calls: 1 initial + 2 in-round non-length repair tries
    // (highlight_substring + term_unexplained also fire on overPost) +
    // 6 post-PASS soft-repair tries = 9 total. (char_limit itself no
    // longer goes through runEditor — it uses runFieldRepair.)
    assert.equal(editorCall, 9);
    // Field-repair calls: 2 in-round tries × 1 round (fact-check PASSes
    // so we don't reach round 2). Total 2.
    assert.equal(fr.calls.length, 2);
    assert.equal(fr.calls[0]!.fieldLabel, 'SLIDE 2 BODY');
    assert.equal(fr.calls[0]!.limit, 220);
    assert.equal(fr.calls[0]!.currentText.length, 292);
    // Post-PASS soft-repair tries appear in the debug repair log.
    const softTries = capturedRepairs.filter((r) => /post-PASS try/.test(r.reason));
    assert.equal(softTries.length, 6);
    assert.match(softTries[0]!.reason, /post-PASS try 1\/6/);
    assert.match(softTries[5]!.reason, /post-PASS try 6\/6/);
    // Field-repair entries also show up.
    const fieldTries = capturedRepairs.filter((r) => /field-repair SLIDE 2 BODY/.test(r.reason));
    assert.equal(fieldTries.length, 2);
    assert.match(fieldTries[0]!.reason, /292→292 chars \(limit 220\)/);
  });
});

describe('runCreatorPipeline — soft errors continue past code checks, block at final gate', () => {
  // 2026-09-30 rewire: char_limit routes to `runFieldRepair` in-round;
  // the soft-repair loop still uses `runEditor`. Both are stubbed here
  // to keep the same over-limit BODY across every try so the final gate
  // fires with the length error listed.
  test('char_limit surviving all rounds → Fact-checker still runs → final gate bails as needs_human_review with the length errors listed', async () => {
    // Editor keeps returning a post whose SLIDE 2 body is over 220. That's a
    // SOFT error (char_limit). Round loop must not stop — Fact-checker still
    // runs. Fact-checker returns PASS. Final gate then bails to
    // needs_human_review with the char_limit error listed.
    const overBody = 'x'.repeat(292); // 72 over the 220 limit
    const overPost = makeOverPost(overBody);
    let factCheckCalls = 0;
    let bailReason: string | undefined;
    const fr = makeFieldRepairStub(() => overBody);
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async () => ({ post: overPost, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) }),
        runFieldRepair: fr.fn,
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
    // Field-repair MUST have been tried in-round.
    assert.ok(fr.calls.length >= 1, `expected at least one field-repair call; ran ${fr.calls.length} times`);
    // Bail reason should name the surviving char_limit failure.
    assert.match(bailReason ?? '', /char_limit \/ highlight_substring errors survived/);
    assert.match(bailReason ?? '', /SLIDE 2 BODY \(292 characters, limit 220\)/);
  });

  test('hard error stops the run, and the Fact-checker runs ONCE for review context', async () => {
    // Editor returns a post with a banned voice phrase ("moving forward").
    // Repair tries fail (Editor keeps returning the same post). Pipeline
    // bails to needs_human_review — AND runs the Fact-checker once on
    // the bail post so the reviewer sees every problem together
    // (2026-09-29 rule: "A bail must never skip fact-check").
    //
    // Em/en dashes can't be used to test this any more — they're swapped
    // to compliant punctuation at parse-time (see swapBannedPunctuation).
    const bannedPost = parseEditedPost(EDITED_RAW);
    (bannedPost.slides[0]!).body = 'Moving forward, the company will ship this feature.';
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
    assert.equal(factCheckCalls, 1, 'hard bail must invoke the Fact-checker exactly once for review context');
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

/**
 * Post-PASS soft-repair loop safety. Trims aren't safe by default —
 * length repairs can invert numbers or introduce banned phrases, and
 * rhythm swaps can drop source-anchored clauses. The loop must:
 *   1. Re-run code checks after each pass and bail on any NEW hard error.
 *   2. After the loop ends, if any slide text changed vs. pre-loop,
 *      fact-check only the changed slides once.
 *   3. Any flag from that re-fact-check → human review.
 * The gap that motivated these tests: prior to 2026-09-29, soft-repair
 * output went straight to render unverified.
 */
describe('runCreatorPipeline — soft-repair verification', () => {
  // 2026-09-30 rewire: char_limit routes to `runFieldRepair` in-round,
  // then the post-PASS soft-repair loop calls `runEditor`. Both are
  // stubbable via OrchestrateDeps. Pattern in the four tests below:
  //   • Editor's first pass returns an over-limit BODY (SLIDE 2, 292 chars).
  //   • `runFieldRepair` returns the SAME over-limit text so char_limit
  //     survives the in-round budget (2 tries × 1 round; fact-check PASSes
  //     so we never enter round 2).
  //   • Fact-checker returns PASS on round 1 so the pipeline enters the
  //     post-PASS soft-repair loop with the char_limit still open.
  //   • `runEditor` on the soft-repair pass returns the "bad" post the
  //     test wants to verify against (banned phrase, number-trace miss,
  //     valid trim, etc.).
  const overBody = 'x'.repeat(292);

  // Discriminator: only the post-PASS SOFT-REPAIR Editor call passes
  // `checkErrors` containing a `char_limit` entry. The initial pass sends
  // `checkErrors` undefined; the in-round non-length repair sends only
  // non-length errors (e.g. highlight_substring, term_unexplained). We
  // key off char_limit presence so the "bad" post only gets returned
  // once we've actually entered the soft-repair loop.
  const isSoftRepairEditorCall = (input: { checkErrors?: readonly CheckError[] }): boolean =>
    !!input.checkErrors?.some((e) => e.kind === 'char_limit');

  test('soft-repair introducing a banned phrase bails immediately', async () => {
    const overPost = makeOverPost(overBody);
    // Soft-repair returns a body with the banned "moving forward" phrase.
    const badRepairPost = parseEditedPost(EDITED_RAW);
    (badRepairPost.slides[0]!).body = 'Moving forward, Anthropic told reporters Claude writes the code its researchers ship.';
    let bailReason: string | undefined;
    const fr = makeFieldRepairStub(() => overBody);
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async (input) => {
          const post = isSoftRepairEditorCall(input) ? badRepairPost : overPost;
          return { post, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
        runFieldRepair: fr.fn,
        persistDebugAndCompose: async (_id, debug) => {
          bailReason = debug.outcome.reason;
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    // Bail reason names soft-repair as the source of the introduced hard error.
    assert.match(bailReason ?? '', /soft-repair introduced hard code-check error/);
    // Field-repair was tried in-round before soft-repair even started.
    assert.ok(fr.calls.length >= 1);
  });

  test('soft-repair introducing a number-trace miss bails immediately', async () => {
    const overPost = makeOverPost(overBody);
    // Soft-repair introduces "52%" which is NOT in the fetched sources.
    const badRepairPost = parseEditedPost(EDITED_RAW);
    (badRepairPost.slides[0]!).body = 'Anthropic told reporters Claude now writes 52% of the code its researchers ship.';
    let bailReason: string | undefined;
    const fr = makeFieldRepairStub(() => overBody);
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async (input) => {
          const post = isSoftRepairEditorCall(input) ? badRepairPost : overPost;
          return { post, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
        runFieldRepair: fr.fn,
        persistDebugAndCompose: async (_id, debug) => {
          bailReason = debug.outcome.reason;
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.match(bailReason ?? '', /soft-repair introduced hard code-check error/);
    assert.match(bailReason ?? '', /"52%"/);
  });

  test('soft-repair that rewrites a slide triggers a targeted fact-check on only that slide', async () => {
    const overPost = makeOverPost(overBody);
    // Soft-repair returns a valid ≤220 char body — genuine repair.
    const goodRepairPost = parseEditedPost(EDITED_RAW);
    (goodRepairPost.slides[0]!).body = 'Anthropic told reporters Claude now writes 26% of the code its researchers ship, up from 1% in March.';
    const capturedFactCheckPosts: string[] = [];
    let capturedSoftRepair: unknown = null;
    const fr = makeFieldRepairStub(() => overBody);
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async (input) => {
          const post = isSoftRepairEditorCall(input) ? goodRepairPost : overPost;
          return { post, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
        runFieldRepair: fr.fn,
        runFactChecker: async (input): Promise<FactCheckerOutput> => {
          capturedFactCheckPosts.push(input.post);
          return {
            result: { verdict: 'PASS', flags: [] },
            raw: 'VERDICT: PASS\n\nFLAGS:\n',
            stopReasons: ["end_turn"],
            usage: stageUsage(0.03),
          };
        },
        persistDebugAndCompose: async (_id, debug) => {
          capturedSoftRepair = debug.softRepair;
        },
      }),
    );
    assert.equal(result.status, 'shipped');
    // Two fact-check calls: the initial round + the targeted re-check.
    assert.equal(capturedFactCheckPosts.length, 2);
    // The re-check POST contains only SLIDE 2 (the changed one).
    const rePost = capturedFactCheckPosts[1]!;
    assert.match(rePost, /SLIDE 2/);
    assert.doesNotMatch(rePost, /SLIDE 3\b/);
    assert.doesNotMatch(rePost, /SLIDE 4\b/);
    const sr = capturedSoftRepair as { runs: number; costUsd: number; changedSlides: number[]; reFactCheck: unknown };
    assert.ok(sr.runs >= 1);
    assert.ok(sr.costUsd > 0);
    assert.deepEqual(sr.changedSlides, [2]);
    assert.ok(sr.reFactCheck);
  });

  test('targeted re-fact-check FLAGGED → human review', async () => {
    const overPost = makeOverPost(overBody);
    const goodRepairPost = parseEditedPost(EDITED_RAW);
    (goodRepairPost.slides[0]!).body = 'Anthropic told reporters Claude now writes 26% of the code its researchers ship.';
    let fcCall = 0;
    let bailReason: string | undefined;
    const fr = makeFieldRepairStub(() => overBody);
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runEditor: async (input) => {
          const post = isSoftRepairEditorCall(input) ? goodRepairPost : overPost;
          return { post, raw: EDITED_RAW, editNotes: null, stopReasons: ["end_turn"], usage: stageUsage(0.05) };
        },
        runFieldRepair: fr.fn,
        runFactChecker: async (): Promise<FactCheckerOutput> => {
          fcCall++;
          if (fcCall === 1) {
            return {
              result: { verdict: 'PASS', flags: [] },
              raw: 'VERDICT: PASS\n\nFLAGS:\n',
              stopReasons: ["end_turn"],
              usage: stageUsage(0.03),
            };
          }
          return {
            result: {
              verdict: 'FLAGGED',
              flags: [{
                where: 'SLIDE 2 / BODY',
                text: 'Anthropic told reporters...',
                problem: 'Dropped hedge — soft repair cut "says"',
                sourcesSay: 'Anthropic SAYS Claude writes 26% ...',
                size: 'SMALL',
              }],
            },
            raw: 'VERDICT: FLAGGED\n\nFLAGS:\nWHERE: SLIDE 2 / BODY\n',
            stopReasons: ["end_turn"],
            usage: stageUsage(0.03),
          };
        },
        persistDebugAndCompose: async (_id, debug) => {
          bailReason = debug.outcome.reason;
        },
      }),
    );
    assert.equal(result.status, 'needs_human_review');
    assert.match(bailReason ?? '', /soft-repair re-fact-check FLAGGED/);
    assert.match(bailReason ?? '', /Dropped hedge/);
  });

  test('when soft-repair changes nothing (loop exits on iteration 1), no re-fact-check runs', async () => {
    // Editor initial returns a clean post; soft-repair loop exits immediately.
    let fcCall = 0;
    const result = await runCreatorPipeline(
      ROW,
      {},
      buildDeps({
        runFactChecker: async (): Promise<FactCheckerOutput> => {
          fcCall++;
          return {
            result: { verdict: 'PASS', flags: [] },
            raw: 'VERDICT: PASS\n\nFLAGS:\n',
            stopReasons: ["end_turn"],
            usage: stageUsage(0.03),
          };
        },
      }),
    );
    assert.equal(result.status, 'shipped');
    // Exactly one fact-check: the initial. No targeted re-check needed
    // because no soft repair ran.
    assert.equal(fcCall, 1);
  });
});

/**
 * Haiku boundary (docs/PROJECT-STATUS.md 2026-09-29 pm): the repair-mode
 * (Haiku) is safe ONLY for pure length trims. Every other class of
 * repair — rhythm, highlight_substring, any hard error — needs Sonnet.
 */
describe('editorModeFor — Haiku only for length-only batches', () => {
  const mk = (kind: CheckError['kind'], msg = 'x'): CheckError => ({ kind, target: 'slide', message: msg });

  test('empty errors → primary (Sonnet) by default', () => {
    assert.equal(editorModeFor([]), 'primary');
  });

  test('char_limit only → repair (Haiku)', () => {
    assert.equal(editorModeFor([mk('char_limit'), mk('char_limit')]), 'repair');
  });

  test('char_limit + rhythm → primary (Sonnet)', () => {
    assert.equal(editorModeFor([mk('char_limit'), mk('rhythm')]), 'primary');
  });

  test('char_limit + highlight_substring → primary (Sonnet)', () => {
    assert.equal(editorModeFor([mk('char_limit'), mk('highlight_substring')]), 'primary');
  });

  test('any hard error → primary (Sonnet)', () => {
    assert.equal(editorModeFor([mk('banned_always')]), 'primary');
    assert.equal(editorModeFor([mk('number_trace')]), 'primary');
    assert.equal(editorModeFor([mk('quote_verbatim')]), 'primary');
  });

  test('rhythm only → primary (Sonnet — needs judgment about slide kinds)', () => {
    assert.equal(editorModeFor([mk('rhythm')]), 'primary');
  });
});
