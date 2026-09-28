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

  test('main-story paragraph appears after the roundup rule (Run 5 addition)', () => {
    // Anti-cross-story-contamination paragraph inserted right after the
    // "Leave every other story out completely" paragraph.
    assert.match(
      REPORTER_PROMPT,
      /Leave every other story out completely, even ones the source mentions alongside it\.\n\nThe main story is the one announcement or event in the headline\. Anything else is a separate story, even if a source connects them: earlier statements, later announcements, other companies' news\. Leave those out\. Context means only what a reader needs to understand this announcement, like what the company does or what a term means\./,
    );
  });

  test('main-story paragraph ends with the Norland Labs speech example (Run 6 addition)', () => {
    // Concrete example bolts onto the main-story paragraph so the model
    // has a worked case for "earlier statement about the same company =
    // still a separate story."
    assert.match(
      REPORTER_PROMPT,
      /what the company does or what a term means\. For example \(fictional\): if Norland Labs' CEO gave a speech last week and the company releases new numbers today, the speech is a separate story\. Leave it out completely, even if the articles about today's numbers mention it\./,
    );
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

describe('Writer / Editor / Caption "fix by cutting, no new details" rule (Run 6 additions)', () => {
  test('Writer replaces the "rewrite the post" sentence with a fix-only + no-new-details rule', () => {
    assert.match(
      WRITER_PROMPT,
      /Fix only what was flagged, and keep every other slide and line exactly as it was\. Return the full post in the same format\. Fix a flag by cutting the claim or using the sources' own wording\. Don't add new details, even small ones\./,
    );
    // The old "Rewrite the post so every flag is fixed…" sentence must be gone.
    assert.doesNotMatch(WRITER_PROMPT, /Rewrite the post so every flag is fixed/);
  });

  test('Editor appends the "fix a flag by cutting" sentence to its when-sent-back rule', () => {
    // Line: "When you're sent back, fix exactly what you were given, update
    //   any highlight your fix affects, change nothing else, and return the
    //   full post again. Fix a flag by cutting the claim or using the
    //   sources' own wording. Don't add new details, even small ones."
    assert.match(
      EDITOR_PROMPT,
      /return the full post again\. Fix a flag by cutting the claim or using the sources' own wording\. Don't add new details, even small ones\./,
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
  test('main-story paragraph appears between the "check every time" and "flag anything" paragraphs, with the Run-6 BIG-severity extension', () => {
    // Run 5 added the first sentence. Run 6 added the second — a slide
    // about a separate story is BIG, even if the words are accurate. Run 5
    // showed the Fact-checker sometimes accepted cross-story slides
    // because every fact in them was verifiable in the sources; the new
    // sentence makes clear that main-story scope beats per-word accuracy.
    assert.match(
      FACT_CHECKER_PROMPT,
      /Check the whole post every time, not just the parts that changed\.\n\nThe main story is the one described in the brief's THE NEWS line\. Flag anything about a different event, date or company, even if the brief includes it\. A slide or caption line about a separate story is BIG, even if every word of it is accurate\.\n\nFlag anything that says more than the sources do:/,
    );
  });
});
