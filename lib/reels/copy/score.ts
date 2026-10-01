import { COPY_PICK, copyPickState } from '@/lib/reels/jev/questions/copy-pick';
import { COPY_STORY_MATCH, copyStoryMatchState } from '@/lib/reels/jev/questions/copy-story-match';
import type { JevRunner } from '@/lib/reels/jev/runner';
import type { CopyLineJudgment, CopyLineScore } from '@/lib/reels/copy/pick';

/**
 * One Jev request for one on-screen line. The five scores are answered
 * together, and the line is not shown beside the others.
 */
export async function scoreCopyLine(
  jev: JevRunner,
  input: { onScreenCopy: string; postIdeaId: string; runId: string | null },
): Promise<CopyLineScore> {
  const result = await jev.ask({
    component: 'copy-pick',
    state: copyPickState(input.onScreenCopy),
    sets: [COPY_PICK],
    questions: COPY_PICK.questions,
    runId: input.runId,
    postIdeaId: input.postIdeaId,
  });
  return {
    plain: result.answers.plain.score,
    stake: result.answers.stake.score,
    loop: result.answers.loop.score,
    care: result.answers.care.score,
    reward: result.answers.reward.score,
  };
}

/** One Jev request: the probability that the line and its caption's opening tell one story. */
export async function judgeSameStory(
  jev: JevRunner,
  input: { onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null },
): Promise<number> {
  const result = await jev.ask({
    component: 'copy-story-match',
    state: copyStoryMatchState({ onScreenCopy: input.onScreenCopy, caption: input.caption }),
    sets: [COPY_STORY_MATCH],
    questions: COPY_STORY_MATCH.questions,
    runId: input.runId,
    postIdeaId: input.postIdeaId,
  });
  return result.answers.sameStory.noul;
}

/** Both judgments for one line, asked in parallel. */
export async function judgeCopyLine(
  jev: JevRunner,
  input: { onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null },
): Promise<CopyLineJudgment> {
  const [scores, sameStory] = await Promise.all([
    scoreCopyLine(jev, input),
    judgeSameStory(jev, input),
  ]);
  return { ...scores, sameStory };
}
