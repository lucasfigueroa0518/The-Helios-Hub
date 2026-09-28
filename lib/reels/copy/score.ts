import { COPY_PICK, copyPickState } from '@/lib/reels/jev/questions/copy-pick';
import type { JevRunner } from '@/lib/reels/jev/runner';
import type { CopyLineScore } from '@/lib/reels/copy/pick';

/**
 * One Jev request for one on-screen line. The four scores are answered
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
    loop: result.answers.loop.score,
    care: result.answers.care.score,
    reward: result.answers.reward.score,
  };
}
