import { isDbConnectTimeout } from '@/lib/db';
import type { HubDataset } from '@/lib/social-hub/dataset';

export const STALE_DATASET_NOTE = 'The database connection timed out. Showing the last loaded content.';
export const STALE_DATASET_EMPTY = 'The database connection timed out, so this page could not load. Refresh to try again.';

function connectTimeoutsOnly(dataset: HubDataset): boolean {
  return dataset.errors.length > 0
    && dataset.errors.every((error) => isDbConnectTimeout(error.message));
}

/**
 * A read that failed only because the pool checkout timed out.
 * Returns the previous good payload when one exists, otherwise the same
 * payload with one note instead of one line per pipeline.
 * Returns null when the failure is anything else, so that failure still shows.
 */
export function preferDatasetAfterConnectFailure(
  failed: HubDataset,
  previous: HubDataset | null,
): HubDataset | null {
  if (!connectTimeoutsOnly(failed)) return null;
  if (previous && previous.errors.length === 0 && !previous.staleNote) {
    return { ...previous, staleNote: STALE_DATASET_NOTE };
  }
  return { ...failed, errors: [], staleNote: STALE_DATASET_EMPTY };
}

/** Last good read on this isolate. A cold isolate has none. */
let lastGood: HubDataset | null = null;

export function resetHubDatasetMemory(): void {
  lastGood = null;
}

/** Remember a clean read. A connect-timeout read returns the remembered one when it exists. */
export function finishDatasetLoad(dataset: HubDataset): HubDataset {
  if (dataset.errors.length === 0) {
    if (!dataset.staleNote) lastGood = dataset;
    return dataset;
  }
  return preferDatasetAfterConnectFailure(dataset, lastGood) ?? dataset;
}
