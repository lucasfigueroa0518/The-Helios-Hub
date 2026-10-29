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
const STATIC: Partial<Record<Vertical, ContentTypeDescription>> = {};

let extra: Partial<Record<Vertical, ContentTypeDescription>> = {};

export function descriptionFor(v: Vertical): ContentTypeDescription | null {
  return extra[v] ?? STATIC[v] ?? null;
}

/** Register a description (tests register fakes; it overrides the static map). */
export function registerDescription(d: ContentTypeDescription): void {
  extra[d.vertical] = d;
}

export function clearRegistryForTest(): void {
  extra = {};
}
