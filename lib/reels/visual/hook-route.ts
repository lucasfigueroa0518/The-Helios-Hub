import { HOOK_ROUTE } from '@/lib/reels/jev/questions/hook-route';
import { jevUsd, type JevRunner } from '@/lib/reels/jev/runner';
import { isHook, type Hook } from '@/lib/reels/visual/hook';

export type HookRoute = { hook: Hook; confidence: number; usd: number };

/** P-11. Jev reads only the on-screen copy and picks the hook. */
export async function routeHook(
  jev: JevRunner,
  input: { onScreenCopy: string; postIdeaId: string },
): Promise<HookRoute> {
  const result = await jev.ask({
    component: 'reel-hook',
    state: { on_screen_copy: input.onScreenCopy.trim() },
    sets: [HOOK_ROUTE],
    questions: HOOK_ROUTE.questions,
    runId: null,
    postIdeaId: input.postIdeaId,
  });
  const answer = result.answers.hook;
  if (!isHook(answer.choice)) throw new Error(`Jev returned an unknown hook: ${String(answer.choice)}`);
  return { hook: answer.choice, confidence: answer.confidence, usd: jevUsd(result.usage.input_tokens) };
}
