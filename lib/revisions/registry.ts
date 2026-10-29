import { aiEventsDescription } from './descriptions/ai-events';
import { carouselsDescription } from './descriptions/carousels';
import { lastFewDaysDescription } from './descriptions/last-few-days';
import type { ContentTypeDescription, Vertical } from './types';

/** Reels are shown to people as "text on screen", never "trial reels". */
export const VERTICAL_LABELS: Record<Vertical, string> = {
  reels: 'text on screen',
  explainers: 'explainers',
  carousels: 'carousels',
  stories: 'stories',
  last_few_days: 'last few days',
  ai_events: 'AI events',
};

// Real descriptions (Tasks 6-11) are added here.
const STATIC: Partial<Record<Vertical, ContentTypeDescription>> = { ai_events: aiEventsDescription, carousels: carouselsDescription, last_few_days: lastFewDaysDescription };

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
