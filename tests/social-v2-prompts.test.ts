import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { REPORTER_PROMPT } from '@/lib/social/editorial/v2/prompts/reporter';
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

  test('main-story paragraph appears after the roundup rule (Run 5 addition)', () => {
    // Anti-cross-story-contamination paragraph inserted right after the
    // "Leave every other story out completely" paragraph.
    assert.match(
      REPORTER_PROMPT,
      /Leave every other story out completely, even ones the source mentions alongside it\.\n\nThe main story is the one announcement or event in the headline\. Anything else is a separate story, even if a source connects them: earlier statements, later announcements, other companies' news\. Leave those out\. Context means only what a reader needs to understand this announcement, like what the company does or what a term means\./,
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

  test('THE STORY instruction trimmed (Run 5 edit)', () => {
    // Before: "Tell the writer the full story: what's going on, the key
    // facts, the people and companies involved, and how they're
    // connected. Write as much as the story needs, so the writer fully
    // understands both the story and the context around it."
    // After: shorter — no "how they're connected" and no "context around it."
    assert.match(
      REPORTER_PROMPT,
      /Tell the writer the full story: what's going on, the key facts, and the people and companies involved\. Write as much as the story needs, so the writer fully understands the story\./,
    );
    assert.doesNotMatch(REPORTER_PROMPT, /how they're connected/);
    assert.doesNotMatch(REPORTER_PROMPT, /the context around it/);
  });
});

describe('Fact-checker prompt', () => {
  test('main-story paragraph appears between the "check every time" and "flag anything" paragraphs (Run 5 addition)', () => {
    assert.match(
      FACT_CHECKER_PROMPT,
      /Check the whole post every time, not just the parts that changed\.\n\nThe main story is the one described in the brief's THE NEWS line\. Flag anything about a different event, date or company, even if the brief includes it\.\n\nFlag anything that says more than the sources do:/,
    );
  });
});
