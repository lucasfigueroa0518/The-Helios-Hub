import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { checkBriefIntegrity } from '@/lib/social/editorial/v2/brief-integrity';
import { parseBrief } from '@/lib/social/editorial/v2/parse';

const BASELINE_STORY_600 = 'x'.repeat(900); // filler so substance judgement passes when we care about quotes

function makeBrief(story: string) {
  const raw = `SINGLE STORY: yes
THE NEWS: A shipped a thing.
THE STORY:
${story}
TERMS:
- A: an AI company that builds models.
- B: a related product line for customers.
IMAGES:
None found
SOURCES:
- Outlet, 2026-09-01, https://x.example.com/one
`;
  return { brief: parseBrief(raw), briefRaw: raw };
}

describe('checkBriefIntegrity — unsourced quotes are cut from THE STORY', () => {
  test('quote that appears in a fetched source is kept', () => {
    const story = `${BASELINE_STORY_600} The founder said "our team is thoughtful, principled, and intellectually honest people working under extraordinary pressures" during the call.`;
    const { brief, briefRaw } = makeBrief(story);
    const sourceTexts = [
      { url: 'https://x.example.com/one', title: null as string | null, text: 'The founder wrote: "our team is thoughtful, principled, and intellectually honest people working under extraordinary pressures" as part of the essay.' },
    ];
    const r = checkBriefIntegrity(brief, briefRaw, sourceTexts);
    assert.equal(r.droppedQuotes.length, 0);
    assert.match(r.cleanedBrief.story ?? '', /thoughtful, principled/);
  });

  test('quote NOT in any fetched source is redacted', () => {
    const story = `${BASELINE_STORY_600} The founder said "our team is thoughtful, principled, and intellectually honest people working under extraordinary pressures" during the call.`;
    const { brief, briefRaw } = makeBrief(story);
    const sourceTexts = [
      { url: 'https://x.example.com/one', title: null as string | null, text: 'The article covers other topics like model releases and does not include any quotes from the founder.' },
    ];
    const r = checkBriefIntegrity(brief, briefRaw, sourceTexts);
    assert.equal(r.droppedQuotes.length, 1);
    assert.match(r.droppedQuotes[0]!.quote, /thoughtful, principled/);
    assert.match(r.cleanedBrief.story ?? '', /\[quote redacted: not in fetched sources\]/);
    assert.doesNotMatch(r.cleanedBrief.story ?? '', /thoughtful, principled/);
  });

  test('no unsourced quotes → droppedQuotes empty, brief unchanged', () => {
    const story = `${BASELINE_STORY_600} Regular narrative content here without quotes.`;
    const { brief, briefRaw } = makeBrief(story);
    const r = checkBriefIntegrity(brief, briefRaw, []);
    assert.equal(r.droppedQuotes.length, 0);
    assert.equal(r.cleanedBrief.story, brief.story);
  });

  test('possessive apostrophes are NOT treated as quote delimiters', () => {
    // Bug fixed 2026-09-29: 14 fragments were dropped on the Suleyman
    // run because two possessive apostrophes ("Anthropic's ... Suleyman's")
    // bracketed normal narrative text. Only DOUBLE quotes are delimiters now.
    const story = `${BASELINE_STORY_600} Anthropic's essay says something. Suleyman's response was measured. Google's teams reacted.`;
    const { brief, briefRaw } = makeBrief(story);
    const r = checkBriefIntegrity(brief, briefRaw, []);
    assert.equal(r.droppedQuotes.length, 0, `should not drop possessives; got: ${JSON.stringify(r.droppedQuotes)}`);
  });

  test('curly quotes + em dashes + ellipses are normalized before matching', () => {
    const story = `${BASELINE_STORY_600} She said "we may — potentially… as sources put it — be right" about it.`;
    const { brief, briefRaw } = makeBrief(story);
    // Source uses straight quotes, regular hyphen, three dots.
    const r = checkBriefIntegrity(brief, briefRaw, [
      { url: 'https://x.example.com/one', title: null as string | null, text: 'She said "we may - potentially... as sources put it - be right" about all of it.' },
    ]);
    assert.equal(r.droppedQuotes.length, 0, `normalization should have matched despite curly/dash/ellipsis differences; got: ${JSON.stringify(r.droppedQuotes)}`);
  });

  test('short brief with NO redactions → cleanedBrief unchanged (Reporter\'s editorial call)', () => {
    // Thin-brief bail now happens post-Writer by counting slides, not
    // here — so a short-but-clean brief passes through untouched.
    const story = `Short but source-clean story with no quotes at all.`;
    const { brief, briefRaw } = makeBrief(story);
    const r = checkBriefIntegrity(brief, briefRaw, []);
    assert.equal(r.droppedQuotes.length, 0);
    assert.equal(r.cleanedBrief.story, brief.story);
  });
});
