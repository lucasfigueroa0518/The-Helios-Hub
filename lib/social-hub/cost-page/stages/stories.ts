import type { Stage } from '@/lib/social-hub/cost-page/normalize';

/** Exact `stories.cost_events.component` names (lib/stories/**). Prompt ids carry `@<n>`; those match by prefix. */
export const STORIES_STAGES: Record<string, Stage> = {
  'md-merge': 'research', 'md-rank': 'research', 'md-grounding': 'research', 'md-headlines': 'writing',
  'gtn-prescore': 'research', 'gtn-rescore': 'research', 'gtn-extract': 'research', 'gtn-question': 'writing',
  'fvp-score': 'research', 'fvp-pair': 'research', 'fvp-verify': 'writing', 'fvp-copy': 'writing',
  'photo-finder': 'visuals', 'stories-render-review': 'visuals',
  search: 'research',
};
