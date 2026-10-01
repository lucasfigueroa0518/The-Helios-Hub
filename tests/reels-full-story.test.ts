/**
 * Offline tests for the Full Story Below cue (D-196). No model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { FULL_STORY_FIT_BAR, FULL_STORY_LABEL, captionPreview, decideFullStory, showFullStoryCue } from '@/lib/reels/copy/full-story';
import { FULL_STORY_CUE, fullStoryState } from '@/lib/reels/jev/questions/full-story';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';

test('the caption preview is the first line, cut at the fold', () => {
  assert.equal(captionPreview('The rest of it happened at dawn.'), 'The rest of it happened at dawn.');
  assert.equal(captionPreview('First line stays.\nSecond line is hidden.'), 'First line stays.');
  const long = `${'word '.repeat(40)}tail`;
  const preview = captionPreview(long);
  assert.ok(preview.length <= 125);
  assert.ok(!preview.endsWith(' '));
  assert.ok(long.startsWith(preview));
});

test('the cue is placed unless Jev says it would read badly', () => {
  assert.equal(showFullStoryCue(FULL_STORY_FIT_BAR), true);
  assert.equal(showFullStoryCue(0.39), false);
  assert.equal(showFullStoryCue(1), true);
});

test('Jev sees the on-screen copy and the caption, and a yes returns the fixed line', async () => {
  const seen: JevRequest<Questions>[] = [];
  const stub: JevRunner = {
    callCount: 0,
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      seen.push(request as JevRequest<Questions>);
      return {
        model: 'jev-test',
        answers: { readsWell: { type: 'noul', noul: 0.41 } },
        usage: { input_tokens: 40, output_tokens: 6 },
      } as unknown as SystemOneResult<Q>;
    },
  };
  const cue = await decideFullStory(stub, {
    onScreenCopy: ' Google shut the API ',
    caption: 'Then every app that called it went dark overnight.\nMore after that.',
    postIdeaId: 'idea-1',
    runId: 'run-1',
  });
  assert.equal(cue, FULL_STORY_LABEL);
  assert.deepEqual(
    seen[0]?.state,
    fullStoryState({
      onScreenCopy: 'Google shut the API',
      caption: 'Then every app that called it went dark overnight.\nMore after that.',
    }),
  );
  assert.deepEqual(Object.keys(seen[0]?.state ?? {}), ['on_screen_copy', 'caption']);
  assert.deepEqual(seen[0]?.sets, [FULL_STORY_CUE]);
  assert.equal(FULL_STORY_CUE.version, 'full-story-cue-v2');
  assert.equal(seen[0]?.component, 'full-story-cue');
});

test('a clear no leaves the cue off', async () => {
  const stub: JevRunner = {
    callCount: 0,
    async ask() {
      return {
        model: 'jev-test',
        answers: { readsWell: { type: 'noul', noul: 0.2 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      } as never;
    },
  };
  const cue = await decideFullStory(stub, {
    onScreenCopy: 'The whole point is already on screen.',
    caption: 'The whole point is already on screen.',
    postIdeaId: 'idea-1',
    runId: null,
  });
  assert.equal(cue, null);
});

