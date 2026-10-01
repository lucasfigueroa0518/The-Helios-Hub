import { FULL_STORY_CUE_ENABLED } from '@/lib/reels/config';
import { CAPTION_FOLD_CHARS } from '@/lib/reels/copy/report';
import { FULL_STORY_CUE, fullStoryState } from '@/lib/reels/jev/questions/full-story';
import type { JevRunner } from '@/lib/reels/jev/runner';

/**
 * One fixed pointer. Apple's downward hand is drawn after these words.
 * The line is placed unless Jev says it would read badly (D-228).
 */
export const FULL_STORY_LABEL = 'Full story below';
/** A score under this is a clear no. Anything at or above it places the line. */
export const FULL_STORY_FIT_BAR = 0.4;

/** Drawn after the line. The words do not include it. */
export const FULL_STORY_HAND = '👇';

/** A stored cue is drawn only while the feature is on. */
export function cueToDraw(stored: string | null | undefined): string | null {
  if (!FULL_STORY_CUE_ENABLED) return null;
  const cue = stored?.trim();
  return cue || null;
}

export type FullStoryAnswers = {
  readsWell: number;
};

/** The words Instagram shows before "more": the first line, cut at the fold. */
export function captionPreview(caption: string, fold = CAPTION_FOLD_CHARS): string {
  const firstLine = caption.trim().split(/\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length <= fold) return firstLine;
  const cut = firstLine.slice(0, fold);
  const space = cut.lastIndexOf(' ');
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}

export function showFullStoryCue(readsWell: number, bar = FULL_STORY_FIT_BAR): boolean {
  return readsWell >= bar;
}

/**
 * One Jev request after the winning line and caption are fixed. Returns the
 * fixed phrase, or null when the line would read badly. A throw leaves the
 * cue off; the caller still publishes the copy.
 */
export async function decideFullStory(
  jev: JevRunner,
  input: { onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null },
): Promise<string | null> {
  const result = await jev.ask({
    component: 'full-story-cue',
    state: fullStoryState({ onScreenCopy: input.onScreenCopy, caption: input.caption }),
    sets: [FULL_STORY_CUE],
    questions: FULL_STORY_CUE.questions,
    runId: input.runId,
    postIdeaId: input.postIdeaId,
  });
  return showFullStoryCue(result.answers.readsWell.noul) ? FULL_STORY_LABEL : null;
}
