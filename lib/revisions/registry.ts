import { aiEventsDescription } from './descriptions/ai-events';
import { carouselsDescription } from './descriptions/carousels';
import { explainersDescription } from './descriptions/explainers';
import { lastFewDaysDescription } from './descriptions/last-few-days';
import { storiesDescription } from './descriptions/stories';
import { textOnScreenDescription } from './descriptions/text-on-screen';
import { reelAiDramaDescription } from '@/lib/reel-ai-drama/revisions';
import { VERTICAL_LABELS } from './labels';
import type { ContentTypeDescription, Vertical } from './types';

/** Reels are shown to people as "text on screen", never "trial reels" (labels.ts, shared with the post view). */
export { VERTICAL_LABELS };

// Real descriptions (Tasks 6-11) are added here.
const STATIC: Partial<Record<Vertical, ContentTypeDescription>> = { ai_events: aiEventsDescription, carousels: carouselsDescription, last_few_days: lastFewDaysDescription, stories: storiesDescription, reels: textOnScreenDescription, explainers: explainersDescription, reel_ai_drama: reelAiDramaDescription };

let extra: Partial<Record<Vertical, ContentTypeDescription>> = {};
let staticHidden = false;

export function descriptionFor(v: Vertical): ContentTypeDescription | null {
  return extra[v] ?? (staticHidden ? undefined : STATIC[v]) ?? null;
}

/** Register a description (tests register fakes; it overrides the static map). */
export function registerDescription(d: ContentTypeDescription): void {
  extra[d.vertical] = d;
}

/**
 * Test hook: empties the registered extras AND hides the static map, so tests
 * see an empty registry whatever real descriptions are added later. Call
 * restoreRegistryForTest() (in a finally) to bring the static map back.
 */
export function clearRegistryForTest(): void {
  extra = {};
  staticHidden = true;
}

/** Test hook: drops registered extras and un-hides the static map. */
export function restoreRegistryForTest(): void {
  extra = {};
  staticHidden = false;
}
