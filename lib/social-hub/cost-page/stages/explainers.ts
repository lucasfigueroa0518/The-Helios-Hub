import type { Stage } from '@/lib/social-hub/cost-page/normalize';

/**
 * Exact `explainers.cost_events.component` names (lib/explainers/**). Names with a model suffix
 * (`session_a:<model>`, `repair:<model>`, `post_caption:<model>`, `<phase>:estimate`) match by prefix.
 * session_a is the plan phase (storyboard + script), session_b the build phase (scenes), repair re-runs the build.
 */
export const EXPLAINERS_STAGES: Record<string, Stage> = {
  idea_generator: 'research', idea_scoring: 'research', duplicate_gate: 'research', duplicate_pairs: 'research',
  scope_writer: 'writing', post_caption: 'writing', session_a: 'writing',
  session_b: 'video', repair: 'video', render: 'video', 'tts+bgm+sfx': 'video',
};
