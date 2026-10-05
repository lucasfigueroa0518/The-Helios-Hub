import { COPY_PAYOFF } from '@/lib/reels/jev/questions/copy-payoff';
import { COPY_PICK, copyPickState } from '@/lib/reels/jev/questions/copy-pick';
import { COPY_STORY_MATCH, copyStoryMatchState } from '@/lib/reels/jev/questions/copy-story-match';
import { mergeSets, type JevRunner } from '@/lib/reels/jev/runner';
import type { CopyLineJudgment, CopyLineScore } from '@/lib/reels/copy/pick';
import type { BucketId } from '@/lib/reels/scoring/decide';

/**
 * One Jev request for one on-screen line. The five scores are answered
 * together, and the line is not shown beside the others. Ball Knowledge
 * adds payoff to that same request.
 */
export async function scoreCopyLine(
  jev: JevRunner,
  input: { onScreenCopy: string; postIdeaId: string; runId: string | null; bucket: BucketId },
): Promise<CopyLineScore & { payoff: number | null }> {
  const shared = {
    component: 'copy-pick',
    state: copyPickState(input.onScreenCopy),
    runId: input.runId,
    postIdeaId: input.postIdeaId,
  };
  if (input.bucket === 'ball_knowledge') {
    const merged = mergeSets(COPY_PICK, COPY_PAYOFF);
    const result = await jev.ask({ ...shared, sets: merged.sets, questions: merged.questions });
    return {
      plain: result.answers.plain.score,
      stake: result.answers.stake.score,
      loop: result.answers.loop.score,
      care: result.answers.care.score,
      reward: result.answers.reward.score,
      payoff: result.answers.payoff.score,
    };
  }
  const result = await jev.ask({ ...shared, sets: [COPY_PICK], questions: COPY_PICK.questions });
  return {
    plain: result.answers.plain.score,
    stake: result.answers.stake.score,
    loop: result.answers.loop.score,
    care: result.answers.care.score,
    reward: result.answers.reward.score,
    payoff: null,
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
  input: { onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null; bucket: BucketId },
): Promise<CopyLineJudgment> {
  const [scores, sameStory] = await Promise.all([
    scoreCopyLine(jev, input),
    judgeSameStory(jev, input),
  ]);
  return { ...scores, sameStory };
}
