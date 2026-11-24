import type { ContentLeaf, KnowHowTier, Want } from '@/lib/field-notes/types';

/** About this many live photos keeps the pool fresh (CONTRACT section 2). */
export const POOL_TARGET = 25;
export const THUMB = (photoId: string) => `/api/media-library/thumb/${photoId}`;
export const nameOf = (email: string) => {
  const local = email.split('@')[0] ?? email;
  return local ? local[0]!.toUpperCase() + local.slice(1) : email;
};

export const KIND_LABEL = { working: 'Working', scenery: 'Scenery', people: 'Faces', event: 'Event' } as const;

/** Plain words for the content tree, the wants and the know-how tiers (lib/field-notes/types.ts). Used by the seed form and the review panel. */
export const LEAF_LABEL: Record<ContentLeaf, string> = {
  repo_free_alternative: 'Free alternative to a paid tool',
  repo_data: 'Data, datasets or scrapers',
  repo_mcp: 'MCP server or connector',
  repo_agent_runtime: 'Agent framework or local model',
  repo_automation: 'Automation or workflow tool',
  repo_memory: 'Memory or knowledge tool',
  skill: 'Agent skill',
  coding_agent_feature: 'Coding agent feature',
  llm_app_feature: 'Chat app feature',
  technique: 'Prompting or workflow technique',
};
export const WANT_LABEL: Record<Want, string> = {
  faster: 'Faster',
  better: 'Better',
  newly_possible: 'Newly possible',
  stay_current: 'Stay current',
  cheaper: 'Cheaper',
};
export const TIER_LABEL: Record<KnowHowTier, string> = { middle: 'Middle know-how', higher: 'Higher know-how' };
