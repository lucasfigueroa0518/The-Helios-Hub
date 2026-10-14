import type { Stage } from '@/lib/social-hub/cost-page/normalize';

/** Exact `reels.cost_events.component` names (lib/reels/**, REEL_DIRECT_COMPONENTS) plus the ledger's own labels. */
export const REELS_STAGES: Record<string, Stage> = {
  'scoring-pass1': 'research', 'scoring-pass2': 'research', 'reels-rescore': 'research',
  grouping: 'research', 'idea-merge': 'research', 'ingest-screen': 'research', 'b6-web-search': 'research', 'a4-editor': 'research',
  'copy-pick': 'writing', 'copy-story-match': 'writing', 'copy-caption': 'writing', 'copy-rewrite': 'writing',
  'full-story-cue': 'writing', 'full-story-line': 'writing',
  'reel-scene': 'visuals', 'reel-background': 'visuals', 'reel-color': 'visuals', 'reel-hook': 'visuals',
  'reel-motion': 'video', 'reel-video (Kling)': 'video', 'Kling clip': 'video', 'reels-generate': 'video',
  'song-pick': 'video', 'song-narrow': 'video', 'song-tag': 'video',
};
