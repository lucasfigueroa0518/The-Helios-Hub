/**
 * Offline tests for the Full Story Below cue (D-196). No model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { FULL_STORY_LINES, fullStoryLines } from '@/lib/reels/copy/full-story-lines';
import { captionPreview, chooseFullStoryLine, decideFullStory, showFullStoryBelow } from '@/lib/reels/copy/full-story';
import { FULL_STORY_CUE, fullStoryState } from '@/lib/reels/jev/questions/full-story';
import { fullStoryLineIndex, fullStoryLineSet, FULL_STORY_LINE_VERSION } from '@/lib/reels/jev/questions/full-story-line';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';
import { BUCKET_IDS } from '@/lib/reels/scoring/decide';

test('the caption preview is the first line, cut at the fold', () => {
  assert.equal(captionPreview('The rest of it happened at dawn.'), 'The rest of it happened at dawn.');
  assert.equal(captionPreview('First line stays.\nSecond line is hidden.'), 'First line stays.');
  const long = `${'word '.repeat(40)}tail`;
  const preview = captionPreview(long);
  assert.ok(preview.length <= 125);
  assert.ok(!preview.endsWith(' '));
  assert.ok(long.startsWith(preview));
});

test('a caption that does not hold a deferred story never gets the cue', () => {
  assert.equal(showFullStoryBelow({ storyDeferred: 0.69, previewMiss: 1, incomplete: 1 }), false);
  assert.equal(showFullStoryBelow({ storyDeferred: 0, previewMiss: 1, incomplete: 1 }), false);
});

test('the cue needs the deferred story at 0.7 and one pointer at 0.26', () => {
  assert.equal(showFullStoryBelow({ storyDeferred: 0.7, previewMiss: 0.26, incomplete: 0 }), true);
  assert.equal(showFullStoryBelow({ storyDeferred: 0.7, previewMiss: 0, incomplete: 0.26 }), true);
  assert.equal(showFullStoryBelow({ storyDeferred: 1, previewMiss: 0.25, incomplete: 0.25 }), false);
});

test('Jev sees the winning line, the preview, and the caption', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub: JevRunner = {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      seen.push(request as JevRequest<Questions>);
      return {
        model: 'jev-test',
        answers: {
          storyDeferred: { type: 'noul', noul: 0.91 },
          previewMiss: { type: 'noul', noul: 0.2 },
          incomplete: { type: 'noul', noul: 0.88 },
        },
        usage: { input_tokens: 40, output_tokens: 6 },
      } as unknown as SystemOneResult<Q>;
    },
  };
  const show = await decideFullStory(stub, {
    onScreenCopy: ' Google shut the API ',
    caption: 'Then every app that called it went dark overnight.\nMore after that.',
    postIdeaId: 'idea-1',
    runId: 'run-1',
  });
  assert.equal(show, true);
  assert.deepEqual(
    seen[0]?.state,
    fullStoryState({
      onScreenCopy: 'Google shut the API',
      caption: 'Then every app that called it went dark overnight.\nMore after that.',
      captionPreview: 'Then every app that called it went dark overnight.',
    }),
  );
  assert.deepEqual(Object.keys(seen[0]?.state ?? {}), ['on_screen_copy', 'caption_preview', 'caption']);
  assert.deepEqual(seen[0]?.sets, [FULL_STORY_CUE]);
  assert.equal(FULL_STORY_CUE.version, 'full-story-cue-v1');
  assert.equal(seen[0]?.component, 'full-story-cue');
});

test('each bucket has eight distinct cue lines', () => {
  for (const bucket of BUCKET_IDS) {
    const lines = fullStoryLines(bucket);
    assert.equal(lines.length, 8);
    assert.equal(new Set(lines).size, 8);
    for (const line of lines) assert.equal(line.includes('\n'), false);
  }
  assert.equal(FULL_STORY_LINES.the_saga[0], 'What happened next');
});

test('Jev picks one of the eight lines for this reel', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub: JevRunner = {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      seen.push(request as JevRequest<Questions>);
      return {
        model: 'jev-test',
        answers: { line: { type: 'choice', choice: 'line_2', confidence: 0.4, probabilities: {} } },
        usage: { input_tokens: 30, output_tokens: 4 },
      } as unknown as SystemOneResult<Q>;
    },
  };
  const line = await chooseFullStoryLine(stub, {
    bucket: 'the_saga',
    onScreenCopy: 'The board fired him on a Friday.',
    caption: 'By Monday, 700 people had threatened to quit.',
    postIdeaId: 'idea-1',
    runId: 'run-1',
  });
  assert.equal(line, 'How it ended');
  assert.equal(fullStoryLineIndex('line_2'), 1);
  assert.equal(fullStoryLineIndex('line_9'), null);
  const set = fullStoryLineSet(fullStoryLines('the_saga'));
  assert.equal(set.version, FULL_STORY_LINE_VERSION);
  assert.deepEqual(Object.keys(set.questions.line.criteria), ['line_1', 'line_2', 'line_3', 'line_4', 'line_5', 'line_6', 'line_7', 'line_8']);
  assert.equal(seen[0]?.component, 'full-story-line');
  assert.equal(seen[0]?.sets[0]?.version, FULL_STORY_LINE_VERSION);
});

test('an unknown cue line is not used', async () => {
  const stub: JevRunner = {
    callCount: 0,
    async ask() {
      return {
        model: 'jev-test',
        answers: { line: { type: 'choice', choice: 'line_0', confidence: 0.9, probabilities: {} } },
        usage: { input_tokens: 1, output_tokens: 1 },
      } as never;
    },
  };
  await assert.rejects(() =>
    chooseFullStoryLine(stub, {
      bucket: 'the_warning',
      onScreenCopy: 'Stop paying per seat.',
      caption: 'Switch to usage.',
      postIdeaId: 'idea-1',
      runId: null,
    }),
  );
});
