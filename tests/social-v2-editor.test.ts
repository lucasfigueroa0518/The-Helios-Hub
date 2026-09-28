import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { trimToLastCoverLabel, buildEditorUserMessage } from '@/lib/social/editorial/v2/editor';

/**
 * The last-"COVER:" trim mirrors what the Reporter's joinBriefFromTurns
 * does for "SINGLE STORY:" — a labeled-lines payload has ONE canonical
 * start line; anything Sonnet wrote before it ("Here's the revised
 * post:") is preamble and gets dropped.
 */
describe('trimToLastCoverLabel', () => {
  test('drops preamble before the last COVER: line', () => {
    const raw = `Here's the revised post with your fixes applied:

COVER: Anthropic says its own AI writes 26% of R&D code.
COVER HIGHLIGHT: 26% of R&D code
COVER IMAGE: type only

SLIDE 2
BODY: x

FOLLOW: Follow.

EDIT NOTES:
None`;
    const trimmed = trimToLastCoverLabel(raw);
    assert.ok(trimmed.startsWith('COVER: Anthropic'));
    assert.doesNotMatch(trimmed, /Here's the revised/);
  });

  test('when multiple COVER: lines appear, keeps only from the last one', () => {
    // Model sometimes emits an intermediate outline block that also has a
    // COVER: line before the final post. Keep the LAST one.
    const raw = `Intermediate draft:

COVER: draft cover
SLIDE 2
BODY: draft body

Final version:

COVER: final cover
COVER HIGHLIGHT: final cover
COVER IMAGE: type only

SLIDE 2
BODY: final body

FOLLOW: Follow.

EDIT NOTES:
None`;
    const trimmed = trimToLastCoverLabel(raw);
    assert.ok(trimmed.startsWith('COVER: final cover'));
    assert.doesNotMatch(trimmed, /draft cover/);
    assert.doesNotMatch(trimmed, /Intermediate draft/);
  });

  test('leaves input unchanged when there is no COVER: label', () => {
    const raw = 'nothing looks like a label here';
    assert.equal(trimToLastCoverLabel(raw), raw);
  });

  test('recognizes markdown-decorated **COVER:** the model sometimes emits', () => {
    const raw = `Preamble.

**COVER:** Anthropic says its own AI writes 26% of R&D code.
COVER HIGHLIGHT: 26% of R&D code
COVER IMAGE: type only`;
    const trimmed = trimToLastCoverLabel(raw);
    // Trims at the "COVER" token position; the surrounding "**" stays and
    // gets stripped later by normalizeMarkdown before parseEditedPost.
    assert.ok(trimmed.startsWith('COVER:'));
    assert.doesNotMatch(trimmed, /Preamble/);
  });
});

/**
 * The LENGTHS block from renderLengthsBlock must appear at the very top of
 * the Editor's user message when provided, so the model sees the field
 * lengths before any POST content — one glance and it knows what to cut.
 */
describe('buildEditorUserMessage', () => {
  const brief = {
    briefRaw: 'BRIEF text',
    sourceTexts: [{ url: 'https://x.example.com', title: 't', text: 'source text body' }],
    post: 'COVER: x\nSLIDE 2\nBODY: y\nFOLLOW: z',
  };

  test('when lengthsBlock is provided, it appears BEFORE the POST section', () => {
    const msg = buildEditorUserMessage({
      brief: {} as never,
      briefRaw: brief.briefRaw,
      sourceTexts: brief.sourceTexts,
      post: brief.post,
      lengthsBlock: 'LENGTHS:\n- COVER: 5 characters (limit 100)',
    });
    const lengthsIdx = msg.indexOf('LENGTHS:');
    const postIdx = msg.indexOf('POST:');
    assert.ok(lengthsIdx >= 0, 'LENGTHS block must appear');
    assert.ok(postIdx >= 0, 'POST section must appear');
    assert.ok(lengthsIdx < postIdx, 'LENGTHS must come before POST');
  });

  test('when lengthsBlock is omitted, the message starts with POST as before', () => {
    const msg = buildEditorUserMessage({
      brief: {} as never,
      briefRaw: brief.briefRaw,
      sourceTexts: brief.sourceTexts,
      post: brief.post,
    });
    assert.ok(msg.startsWith('POST:'));
  });
});
