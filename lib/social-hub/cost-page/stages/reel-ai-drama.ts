import type { Stage } from '@/lib/social-hub/cost-page/normalize';

/**
 * Exact `reel_ai_drama.cost_events.component` names (lib/reel-ai-drama/hub.ts DRAMA_COST_COMPONENTS).
 * Names with a model suffix (`writer:<model>`) match by prefix. Anything not listed is 'other'
 * (contract §4.7): drama never falls through to the shared keyword table.
 */
export const REEL_AI_DRAMA_STAGES: Record<string, Stage> = {
  producer: 'research', drama_score: 'research', material_score: 'research', same_event: 'research', rebrief: 'research', reporting: 'research',
  harvest_search: 'research', harvest_wish_search: 'research',
  visuals_check: 'visuals', harvest_look: 'visuals', harvest_sketch: 'visuals', design_review_fast: 'visuals', design_review_judge: 'visuals',
  writer: 'writing', writer_revise: 'writing', story_notes: 'writing', director: 'writing', creative_pass: 'writing', post_text: 'writing',
  facts_check: 'writing', integrity_check: 'writing', first_viewer: 'writing',
  make: 'video', voice: 'video', sound_design: 'video',
};
