import type { Vertical } from '@/lib/social-hub/types';

/** The whole hub dataset. Clearing this drops every per-type slice too. */
export const HUB_DATA_TAG = 'social-hub:data';

/** Per-item cost totals, cached apart from the content. */
export const HUB_COST_TAG = 'social-hub:cost';

/** One content type's read. An action clears this and leaves the other types warm. */
export function hubDataTag(vertical: Vertical): string {
  return `${HUB_DATA_TAG}:${vertical}`;
}

const changes = globalThis as typeof globalThis & { __hubDataChangedAt?: number };

/**
 * Note, in this process, that hub data just changed (an action or a finished run
 * revalidated a hub tag). A dataset rebuild that began before this is not shared with
 * the requests that come after it (views/cached-dataset.ts), so they never see the
 * state from before the change.
 */
export function noteHubDataChanged(): void {
  changes.__hubDataChangedAt = Date.now();
}

export function hubDataChangedAt(): number {
  return changes.__hubDataChangedAt ?? 0;
}
