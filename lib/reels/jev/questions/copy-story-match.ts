import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-18. Does the on-screen line and the opening of its caption tell one story
 * (D-215)? One yes/no per line, asked beside P-15. P-15 stays screen-only, so
 * this is its own set. Code needs a yes at SAME_STORY_BAR for the line to
 * clear the copy gate (lib/reels/copy/pick.ts).
 *
 * `caption_opening` is the caption's first paragraph: the words a viewer
 * reads right after tapping "more".
 */

export const SAME_STORY_QUESTION =
  'Do `on_screen_copy` and `caption_opening` tell the same story, about the same subject, so that a viewer who taps into the caption keeps reading the thing the screen told them about?';

export const SAME_STORY_PASS =
  'The caption opening picks up the subject and the event the screen named, and carries the same reason to care. It can add detail, a source, or a second fact about that same story.';

export const SAME_STORY_MISS =
  'The caption opening leads with a different subject, a different event, or a second thread from the sources. A viewer would have to wait or search to find the story the screen told them about.';

export const COPY_STORY_MATCH = defineQuestionSet({
  id: 'copy-story-match',
  version: 'copy-story-match-v1',
  questions: {
    sameStory: noul(SAME_STORY_QUESTION, {
      true: SAME_STORY_PASS,
      false: SAME_STORY_MISS,
    }),
  },
});

/** The caption's first paragraph, up to the first blank line. */
export function captionOpening(caption: string): string {
  return caption.trim().split(/\n\s*\n/, 1)[0]?.trim() ?? '';
}

export function copyStoryMatchState(input: { onScreenCopy: string; caption: string }): {
  on_screen_copy: string;
  caption_opening: string;
} {
  return {
    on_screen_copy: input.onScreenCopy.trim(),
    caption_opening: captionOpening(input.caption),
  };
}
