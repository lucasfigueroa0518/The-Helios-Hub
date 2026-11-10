import type { Stage } from '@/lib/social-hub/cost-page/normalize';

/** Exact `stories.cost_events.component` names (lib/stories/**). Prompt ids carry `@<n>`; those match by prefix. */
export const STORIES_STAGES: Record<string, Stage> = {
  'md-merge': 'research', 'md-rank': 'research', 'md-grounding': 'research', 'md-headlines': 'writing',
  // Guess the Number is retired (AT-14); its components stay so its past spend still sorts.
  'gtn-prescore': 'research', 'gtn-rescore': 'research', 'gtn-extract': 'research', 'gtn-question': 'writing',
  'gtn-pick': 'research', 'gtn-gate': 'research', 'gtn-same-subject': 'research',
  'trivia-write': 'writing', 'trivia-score': 'research', 'trivia-check': 'research', 'trivia-music': 'visuals',
  'fvp-score': 'research', 'fvp-pair': 'research', 'fvp-verify': 'writing', 'fvp-copy': 'writing',
  'photo-finder': 'visuals', 'stories-render-review': 'visuals',
  search: 'research',
};
