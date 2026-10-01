import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-16. After the on-screen line and caption are fixed, one yes/no decides
 * the fixed cue "Full story below" (D-228).
 *
 * Code places the line unless this score is under 0.40. The false side is
 * only a line that would read badly, so a close call still places it.
 * `full-story-cue-v1` asked three questions and is retired.
 */

export const FULL_STORY_CUE = defineQuestionSet({
  id: 'full-story-cue',
  version: 'full-story-cue-v2',
  questions: {
    readsWell: noul(
      'Does the line "Full story below" read well in the gap under `on_screen_copy`, pointing the viewer at `caption`?',
      {
        true: 'The caption continues what the screen started: how it happened, what to do about it, or what comes next. "Full story below" is a plain pointer to that caption. It does not repeat the screen, and it does not promise a story the caption does not hold.',
        false: 'The line would read as the wrong thing to say. The caption does not continue the screen, the screen already said what the caption says, or the phrase would clash with the words on screen. Say no only when the line would be nonsense or a lie. A caption that adds a source, a detail, or a next step can still take the line.',
      },
    ),
  },
});

export function fullStoryState(input: { onScreenCopy: string; caption: string }): {
  on_screen_copy: string;
  caption: string;
} {
  return {
    on_screen_copy: input.onScreenCopy.trim(),
    caption: input.caption.trim(),
  };
}
