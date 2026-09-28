import { choice, type ChoiceCriteria } from '@typesafe-ai/sdk';

import { FULL_STORY_LINE_COUNT } from '@/lib/reels/copy/full-story-lines';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-17. After the cue is warranted, one Choice picks which of the bucket's
 * eight lines fits this reel (D-198). No escape option: the earlier Nouls
 * already decided a line belongs, and code uses the top choice.
 *
 * The hand is drawn after every line, so it is not part of the option text.
 */

export const FULL_STORY_LINE_VERSION = 'full-story-line-v1';

const INSTRUCTIONS = {
  question:
    'Which of these lines should sit under the on-screen text to send the viewer into the caption? A hand pointing down is drawn after whichever line you pick.',
  state:
    '`on_screen_copy` is the text on the video. `caption` is the caption. `caption_preview` is the first words of the caption, the part visible before it is opened.',
  judge:
    'Pick the line that names what this viewer will actually find in the caption. The hand is added to every line, so do not pick one because it already says "below." Match the line to this reel.',
};

export function fullStoryLineSet(lines: readonly string[]) {
  if (lines.length !== FULL_STORY_LINE_COUNT) {
    throw new Error(`Full story line pick needs exactly ${FULL_STORY_LINE_COUNT} lines, got ${lines.length}`);
  }
  const criteria: ChoiceCriteria = {};
  lines.forEach((line, index) => {
    criteria[`line_${index + 1}`] = line;
  });
  return defineQuestionSet({
    id: 'full-story-line',
    version: FULL_STORY_LINE_VERSION,
    questions: { line: choice(INSTRUCTIONS, criteria) },
  });
}

export function fullStoryLineState(input: { onScreenCopy: string; caption: string; captionPreview: string }) {
  return {
    on_screen_copy: input.onScreenCopy.trim(),
    caption_preview: input.captionPreview.trim(),
    caption: input.caption.trim(),
  };
}

/** `line_3` is index 2. Anything else is not one of the eight. */
export function fullStoryLineIndex(choiceId: string): number | null {
  const match = /^line_(\d+)$/.exec(choiceId);
  if (!match?.[1]) return null;
  const index = Number(match[1]) - 1;
  if (index < 0 || index >= FULL_STORY_LINE_COUNT) return null;
  return index;
}
