import { fullStoryLines } from '@/lib/reels/copy/full-story-lines';
import { CAPTION_FOLD_CHARS } from '@/lib/reels/copy/report';
import { HIGH_CONFIDENCE } from '@/lib/reels/config';
import { FULL_STORY_CUE, fullStoryState } from '@/lib/reels/jev/questions/full-story';
import { fullStoryLineIndex, fullStoryLineSet, fullStoryLineState } from '@/lib/reels/jev/questions/full-story-line';
import type { JevRunner } from '@/lib/reels/jev/runner';
import type { BucketId } from '@/lib/reels/scoring/decide';

/**
 * The cue is a pointer, not a second headline. It is on only when the caption
 * is where a story was deferred, and the viewer still needs the pointer:
 * the preview does not continue the line, or the on-screen line cannot stand
 * as its own thought. A Noul in the middle stays off.
 */
export const FULL_STORY_BAR = HIGH_CONFIDENCE;

/** Drawn after the chosen line. The words themselves do not include it. */
export const FULL_STORY_HAND = '👇';

export type FullStoryAnswers = {
  storyDeferred: number;
  previewMiss: number;
  incomplete: number;
};

/** The words Instagram shows before "more": the first line, cut at the fold. */
export function captionPreview(caption: string, fold = CAPTION_FOLD_CHARS): string {
  const firstLine = caption.trim().split(/\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length <= fold) return firstLine;
  const cut = firstLine.slice(0, fold);
  const space = cut.lastIndexOf(' ');
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}

export function showFullStoryBelow(answers: FullStoryAnswers, bar = FULL_STORY_BAR): boolean {
  if (answers.storyDeferred < bar) return false;
  return answers.previewMiss >= bar || answers.incomplete >= bar;
}

/**
 * One Jev request after the winning line and caption are fixed. A throw
 * leaves the cue off; the caller still publishes the copy.
 */
export async function decideFullStory(
  jev: JevRunner,
  input: { onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null },
): Promise<boolean> {
  const preview = captionPreview(input.caption);
  const result = await jev.ask({
    component: 'full-story-cue',
    state: fullStoryState({ onScreenCopy: input.onScreenCopy, caption: input.caption, captionPreview: preview }),
    sets: [FULL_STORY_CUE],
    questions: FULL_STORY_CUE.questions,
    runId: input.runId,
    postIdeaId: input.postIdeaId,
  });
  return showFullStoryBelow({
    storyDeferred: result.answers.storyDeferred.noul,
    previewMiss: result.answers.previewMiss.noul,
    incomplete: result.answers.incomplete.noul,
  });
}

/**
 * The second call, only after the cue is warranted. Jev picks one of the
 * bucket's eight lines. The hand is added later, on the frame.
 */
export async function chooseFullStoryLine(
  jev: JevRunner,
  input: { bucket: BucketId; onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null },
): Promise<string> {
  const lines = fullStoryLines(input.bucket);
  const set = fullStoryLineSet(lines);
  const preview = captionPreview(input.caption);
  const result = await jev.ask({
    component: 'full-story-line',
    state: fullStoryLineState({ onScreenCopy: input.onScreenCopy, caption: input.caption, captionPreview: preview }),
    sets: [set],
    questions: set.questions,
    runId: input.runId,
    postIdeaId: input.postIdeaId,
  });
  const index = fullStoryLineIndex(String(result.answers.line.choice));
  const line = index == null ? undefined : lines[index];
  if (!line) throw new Error(`Jev returned an unknown cue line: ${String(result.answers.line.choice)}`);
  return line;
}
