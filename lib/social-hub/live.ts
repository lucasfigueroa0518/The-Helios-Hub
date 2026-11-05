import type { HubDataset } from '@/lib/social-hub/dataset';
import { liveHubQuery } from '@/lib/social-hub/db';
import { actionEnabled } from '@/lib/social-hub/flags';
import { queueRefreshIfStale, refreshState, type RefreshState } from '@/lib/social-hub/refresh';
import { loadHubDataset } from '@/lib/social-hub/views/cached-dataset';

export type LoadedPage = HubDataset & { refresh: RefreshState };

/**
 * Page loader: never throws; a total failure becomes a message (per-vertical
 * failures are notes). The dataset is shared for a minute across requests
 * (views/cached-dataset.ts); refresh state is always read fresh. With
 * refresh-on-visit on, a stale hub queues one refresh for the worker (SH-23).
 */
/** Refresh state for a visit. A failed read is "unknown", the same as a quiet hub. */
export function readRefresh(by = 'visit'): Promise<RefreshState> {
  return (actionEnabled('refreshOnVisit') ? queueRefreshIfStale(liveHubQuery, by) : refreshState(liveHubQuery))
    .catch((): RefreshState => ({ available: false, lastRefresh: null, pending: false }));
}

export async function loadForPage(by = 'visit'): Promise<LoadedPage | { error: string }> {
  try {
    const [refresh, dataset] = await Promise.all([readRefresh(by), loadHubDataset()]);
    return { ...dataset, refresh };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
