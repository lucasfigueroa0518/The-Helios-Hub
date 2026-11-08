import type { Vertical } from '@/lib/social-hub/types';

/**
 * What each content type is called in any text a person reads. Reels are shown as "text on screen",
 * never "trial reels". Pure (no imports beyond a type), so the post view's revision box can use it
 * without pulling the per-type descriptions into the browser.
 */
export const VERTICAL_LABELS: Record<Vertical, string> = {
  reels: 'text on screen',
  explainers: 'explainers',
  carousels: 'carousels',
  stories: 'stories',
  last_few_days: 'last few days',
  ai_events: 'AI events',
  field_notes: 'Field Notes',
};
