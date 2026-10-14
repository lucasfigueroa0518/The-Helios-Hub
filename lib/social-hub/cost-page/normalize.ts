import { EXPLAINERS_STAGES } from '@/lib/social-hub/cost-page/stages/explainers';
import { REELS_STAGES } from '@/lib/social-hub/cost-page/stages/reels';
import { STORIES_STAGES } from '@/lib/social-hub/cost-page/stages/stories';
import type { Vertical } from '@/lib/social-hub/types';

export type Stage = 'research' | 'writing' | 'visuals' | 'video' | 'other';
export type VendorGroup = 'claude' | 'video' | 'images' | 'jev-search' | 'other';

export const STAGE_META: Record<Stage, { label: string; color: string }> = {
  research: { label: 'Research + scoring', color: '#0e5c0c' },
  writing: { label: 'Writing', color: '#138510' },
  visuals: { label: 'Visuals', color: '#5aa857' },
  video: { label: 'Video + render', color: '#a6d4a4' },
  other: { label: 'Other', color: '#d4d4d4' },
};
export const VENDOR_META: Record<VendorGroup, { label: string; color: string }> = {
  claude: { label: 'Claude', color: '#171717' },
  video: { label: 'Video (Kling, HeyGen)', color: '#525252' },
  images: { label: 'OpenAI images', color: '#a3a3a3' },
  'jev-search': { label: 'Jev + search', color: '#d4d4d4' },
  other: { label: 'Other', color: '#e5e5e5' },
};

/** Ordered keyword rules; first match wins. One table for every type (component names differ, words don't). */
const STAGE_RULES: ReadonlyArray<[RegExp, Stage]> = [
  [/kling|video|render|motion|heygen|tts|bgm|sfx|song|music/i, 'video'],
  [/background|image|frame|photo|visual|color|scene|design|vision|\btag\b|song-tag/i, 'visuals'],
  [/score|rank|idea|research|search|dedupe|duplicate|select|jev|generator|feed|story-match|reporter/i, 'research'],
  [/copy|writ|caption|script|hook|line|edit|fact|session|cue|story|draft/i, 'writing'],
];
const BY_TYPE: Partial<Record<Vertical, Record<string, Stage>>> = { reels: REELS_STAGES, explainers: EXPLAINERS_STAGES, stories: STORIES_STAGES };

/** Exact name, then the name before a `:` or `@` suffix, then the keyword table. */
export function stageOf(vertical: Vertical, label: string): Stage {
  const map = BY_TYPE[vertical];
  if (map) {
    const hit = map[label] ?? map[label.split(/[:@]/)[0]!];
    if (hit) return hit;
  }
  for (const [re, stage] of STAGE_RULES) if (re.test(label)) return stage;
  return 'other';
}

export function vendorOf(vendor: string | undefined): VendorGroup {
  switch (vendor) {
    case 'anthropic': case 'carousel-claude': return 'claude';
    case 'kling': case 'heygen': return 'video';
    case 'openai': return 'images';
    case 'jev': case 'web_search': case 'carousel-jev': case 'huggingface': return 'jev-search';
    default: return 'other';
  }
}
