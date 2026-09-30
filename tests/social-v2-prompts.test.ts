import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { REPORTER_PROMPT } from '@/lib/social/editorial/v2/prompts/reporter';
import { WRITER_PROMPT } from '@/lib/social/editorial/v2/prompts/writer';
import { EDITOR_PROMPT } from '@/lib/social/editorial/v2/prompts/editor';
import { CAPTION_PROMPT } from '@/lib/social/editorial/v2/prompts/caption';
import { FACT_CHECKER_PROMPT } from '@/lib/social/editorial/v2/prompts/fact-checker';

/**
 * Prompt-text regression tests. The prompts are the pipeline's behavioral
 * contract with the model, and small edits change everything downstream.
 * These tests pin the exact phrasing of every rule added or amended in
 * the runs 1-5 iteration so a well-intentioned copy-edit doesn't
 * silently regress an anti-fabrication rule.
 */

describe('Reporter prompt', () => {
  test('opening sentence no longer says "how it connects" (Run 5 edit)', () => {
    // Before: "You report what happened and how it connects, and the
    // writer takes it from there."
    // After:  "You report what happened, and the writer takes it from
    // there."
    assert.match(REPORTER_PROMPT, /You report what happened, and the writer takes it from there\./);
    assert.doesNotMatch(REPORTER_PROMPT, /You report what happened and how it connects/);
  });

  test('shared RULES_BLOCK Context policy replaces the old inline main-story paragraph (2026-09-30 rewrite)', () => {
    // The old Run-5 "main story is the one announcement or event in the
    // headline. Anything else is a separate story..." paragraph has been
    // retired. Reporter/Writer/Editor/Caption/Fact-checker all import a
    // shared RULES_BLOCK from ../rules-block.ts with a single canonical
    // Context policy, so context rules can't drift across prompts.
    assert.match(REPORTER_PROMPT, /## Context policy/);
    assert.match(
      REPORTER_PROMPT,
      /Stay on this one event\. Earlier events, other companies or other people appear in TWO shapes only:/,
    );
    // Old inline phrasings must be gone.
    assert.doesNotMatch(REPORTER_PROMPT, /The main story is the one announcement or event in the headline/);
    assert.doesNotMatch(REPORTER_PROMPT, /not even a passing clause/);
  });

  test('RULES_BLOCK Context policy names the TWO allowed shapes (2026-09-30 rewrite)', () => {
    // Two shapes: (1) one sourced clause, (2) at most one full "why now"
    // or "what stands in the way" slide per post. Reporter and Fact-checker
    // both cite these numbered shapes when explaining what context is
    // allowed. Retires the Run-6 Norland-Labs speech example.
    assert.match(
      REPORTER_PROMPT,
      /1\. \*\*One sourced clause\*\*, embedded in a slide that is otherwise about the main event/,
    );
    assert.match(
      REPORTER_PROMPT,
      /2\. \*\*At most ONE full slide per post\*\* on "why now"/,
    );
    // Old Norland-Labs speech example must be gone (retired with the
    // inline main-story paragraph).
    assert.doesNotMatch(REPORTER_PROMPT, /Norland Labs' CEO gave a speech last week/);
  });

  test('never-guess-a-link rule appears after the "Use original news reporting" rule (Run 6 addition)', () => {
    // Anti-hallucinated-URL guardrail. Run-5 saw Sonnet synthesize an
    // Anthropic Institute URL that 404'd — the URL wasn't in any fetched
    // source, the model guessed it from context.
    assert.match(
      REPORTER_PROMPT,
      /- Use original news reporting\. Don't use blogs or aggregators that summarize other coverage\.\n- Never list a link you didn't open\. If you can't open the original announcement, write "Original announcement: not retrieved" under SOURCES instead of guessing a link\. Only list sources that are about the main story itself\./,
    );
  });

  test('attribution example uses "The Ledger writes that..." (Run 5 edit)', () => {
    assert.match(REPORTER_PROMPT, /"The Ledger writes that\.\.\."/);
    assert.doesNotMatch(REPORTER_PROMPT, /Shattered\.io writes that/);
  });

  test('original-announcement rule + no-aggregator rule replaced the older single rule (Run 5 edit)', () => {
    // Before: "When the company has its own announcement, use it as a
    // source. Otherwise prefer major news outlets over aggregators."
    // After: two separate rules.
    assert.match(REPORTER_PROMPT, /- Find and use the original announcement first, like the company's own post\. If you can't find it, say so under SOURCES\./);
    assert.match(REPORTER_PROMPT, /- Use original news reporting\. Don't use blogs or aggregators that summarize other coverage\./);
    assert.doesNotMatch(REPORTER_PROMPT, /When the company has its own announcement, use it as a source\./);
    assert.doesNotMatch(REPORTER_PROMPT, /Otherwise prefer major news outlets over aggregators\./);
  });

  test('THE STORY instruction opens with the trimmed "full story" language and ends with "so the writer fully understands the story"', () => {
    // Before (Run 4): "…the people and companies involved, and how they're
    //   connected. Write as much as the story needs, so the writer fully
    //   understands both the story and the context around it."
    // After Run 5: no "how they're connected" and no "context around it."
    // 2026-09-30 addition: the paragraph now also names the two Context
    // policy shapes the writer may use ("one clause worth of…", "a single
    // 'why now' or 'what stands in the way' beat…"). Those still frame
    // the shorter opener and closer these assertions pin.
    assert.match(
      REPORTER_PROMPT,
      /Tell the writer the full story: what's going on, the key facts, and the people and companies involved\./,
    );
    assert.match(REPORTER_PROMPT, /so the writer fully understands the story\./);
    assert.doesNotMatch(REPORTER_PROMPT, /how they're connected/);
    assert.doesNotMatch(REPORTER_PROMPT, /the context around it/);
  });
});

describe('Writer / Editor / Caption "fix by cutting, no new details" rule (Run 6 additions)', () => {
  test('Writer fact-check-rerun rule says "fix what was flagged and change nothing else" and lists the allowed fix moves', () => {
    // The old "Rewrite the post so every flag is fixed…" sentence has
    // been retired. Current rule lives in the "PREVIOUS POST + FACT-CHECK
    // FLAGS" paragraph and enumerates the three allowed fixes (cut, use
    // the sources' own wording, or substitute a different supported fact
    // from the brief). It also forbids inventing details.
    assert.match(
      WRITER_PROMPT,
      /On a fact-check rerun, fix what was flagged and change nothing else\. Fix by cutting, by using the sources' own wording, or by replacing the cut claim with a different supported fact from the brief\. Don't invent details\./,
    );
    // Old sentence must be gone.
    assert.doesNotMatch(WRITER_PROMPT, /Rewrite the post so every flag is fixed/);
  });

  test('Editor repair-mode rule says "Fix ONLY what the CHECK ERRORS and FACT-CHECK FLAGS list" and forbids reinventing anything else', () => {
    // The 2026-09-30 Editor rewrite reorganized the repair-mode section
    // around a shared "Cut words, not facts" bullet + "Substitute, don't
    // just subtract" bullet. The one-line invariant these tests pin is
    // that the Editor is scoped strictly to the flagged fields and must
    // return the whole post again.
    assert.match(
      EDITOR_PROMPT,
      /Fix ONLY what the CHECK ERRORS and FACT-CHECK FLAGS list\. Update any highlight your fix affects\. Change nothing else\. Return the full post again\./,
    );
  });

  test('Caption appends the same sentence to its FIX NOTES rule', () => {
    assert.match(
      CAPTION_PROMPT,
      /Fix exactly those, keep everything else, and return the full caption\. Fix a flag by cutting the claim or using the sources' own wording\. Don't add new details, even small ones\./,
    );
  });
});

describe('Fact-checker prompt', () => {
  test('Fact-checker delegates context judgment to the shared Context policy in RULES_BLOCK (2026-09-30 rewrite)', () => {
    // The old Run-5/Run-6 inline "Flag anything about a different event,
    // date or company, even if the brief includes it. A slide or caption
    // line about a separate story is BIG…" absolutist rule has been
    // retired. It over-flagged: it made even the ONE sourced clause or
    // "why now" slide the Context policy explicitly allows read as a BIG
    // violation. Current Fact-checker cites the shared Context policy
    // (imported via RULES_BLOCK) and only flags context that goes beyond
    // the allowance — multiple outside-event slides, a market-context
    // paragraph, or recycling a subject's earlier statements as new.
    assert.match(FACT_CHECKER_PROMPT, /## Context policy/);
    assert.match(
      FACT_CHECKER_PROMPT,
      /Apply the shared Context policy: a slide or caption clause about an earlier event that fits shape \(1\) — one sourced clause — or shape \(2\) — the single "why now" or "what stands in the way" slot — is NOT a flag\. Only flag context that goes beyond the allowance \(multiple outside-event slides, a market-context paragraph, recycling a subject's earlier statements as new\)\./,
    );
    // Old absolutist sentence must be gone.
    assert.doesNotMatch(
      FACT_CHECKER_PROMPT,
      /Flag anything about a different event, date or company, even if the brief includes it\./,
    );
    assert.doesNotMatch(
      FACT_CHECKER_PROMPT,
      /A slide or caption line about a separate story is BIG, even if every word of it is accurate\./,
    );
  });
});
