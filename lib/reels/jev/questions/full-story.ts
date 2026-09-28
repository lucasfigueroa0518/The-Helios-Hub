import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-16. After a winning on-screen line and its caption are chosen, three
 * yes/no judgments decide a small "Full Story Below" cue (D-196).
 *
 * Code enforces the essential gate: the cue is off unless `storyDeferred`
 * clears the bar. A caption that does not hold a deferred story never gets
 * the words "Full story below," no matter how the other two land.
 *
 * `caption_preview` is the first line of the caption, cut at the Instagram
 * fold when that line is longer. It is the words a viewer sees before they
 * open the caption.
 */

export const FULL_STORY_CUE = defineQuestionSet({
  id: 'full-story-cue',
  version: 'full-story-cue-v1',
  questions: {
    storyDeferred: noul(
      'Does `caption` hold the rest of a story whose value was kept out of `on_screen_copy`, so that the words "Full story below" would honestly describe what the caption contains?',
      {
        true: 'The on-screen text starts a story, a turn, or a result, and the caption is where that story is actually told. A viewer who never opens the caption misses the point of the reel. The value was deferred to the caption.',
        false: 'The on-screen text already delivers the point. The caption adds color, a source, a reaction, a tip, a list, a restatement, or a call to action. Or the caption is interesting, but it is not a story whose value was held back. "Full story below" would name something the caption is not.',
      },
    ),
    previewMiss: noul(
      'Do the words in `caption_preview`, the first words a viewer sees before opening the caption, fail to read as a continuation or elaboration of `on_screen_copy`?',
      {
        true: 'Those opening words start a new thought, a greeting, a label, or a tangent. They do not pick up the on-screen line as the next sentence, or as a clearer telling of the same beat. From the preview alone, a viewer could not tell the caption continues the line.',
        false: 'The preview reads as the next line, the missing piece, or a plain elaboration of the on-screen text. The words themselves pull the viewer into the caption.',
      },
    ),
    incomplete: noul(
      'Is `on_screen_copy` catastrophically incomplete as its own thought, so the line breaks unless the viewer opens the caption?',
      {
        true: 'It cannot stand alone. It stops on a setup with no object, a dangling clause, or a sentence a viewer cannot hold without the next line. A small open loop is not this. This is a thought that fails if the caption never opens.',
        false: 'It is a complete thought, even when something stays interesting. A viewer can say what it claimed. Wanting the rest is not the same as the line failing as a sentence.',
      },
    ),
  },
});

export function fullStoryState(input: { onScreenCopy: string; caption: string; captionPreview: string }): {
  on_screen_copy: string;
  caption_preview: string;
  caption: string;
} {
  return {
    on_screen_copy: input.onScreenCopy.trim(),
    caption_preview: input.captionPreview.trim(),
    caption: input.caption.trim(),
  };
}
