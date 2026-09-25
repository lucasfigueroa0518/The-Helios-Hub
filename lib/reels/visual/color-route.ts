import { COLOR_ROUTE } from '@/lib/reels/jev/questions/color-route';
import { jevUsd, type JevRunner } from '@/lib/reels/jev/runner';
import { isColorProfile, type ColorProfile } from '@/lib/reels/visual/color';

export type ColorRoute = { profile: ColorProfile; confidence: number; usd: number };

/** P-12. Jev reads only the on-screen copy and picks the grade. */
export async function routeColor(
  jev: JevRunner,
  input: { onScreenCopy: string; postIdeaId: string },
): Promise<ColorRoute> {
  const result = await jev.ask({
    component: 'reel-color',
    state: { on_screen_copy: input.onScreenCopy.trim() },
    sets: [COLOR_ROUTE],
    questions: COLOR_ROUTE.questions,
    runId: null,
    postIdeaId: input.postIdeaId,
  });
  const answer = result.answers.color;
  if (!isColorProfile(answer.choice)) throw new Error(`Jev returned an unknown color profile: ${String(answer.choice)}`);
  return { profile: answer.choice, confidence: answer.confidence, usd: jevUsd(result.usage.input_tokens) };
}
