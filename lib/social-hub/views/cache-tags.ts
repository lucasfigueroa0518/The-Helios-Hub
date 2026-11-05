import type { Vertical } from '@/lib/social-hub/types';

/** The whole hub dataset. Clearing this drops every per-type slice too. */
export const HUB_DATA_TAG = 'social-hub:data';

/** Per-item cost totals, cached apart from the content. */
export const HUB_COST_TAG = 'social-hub:cost';

/** One content type's read. An action clears this and leaves the other types warm. */
export function hubDataTag(vertical: Vertical): string {
  return `${HUB_DATA_TAG}:${vertical}`;
}
