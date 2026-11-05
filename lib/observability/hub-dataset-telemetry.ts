import { logInfo } from '@/lib/observability/log-event';
import type { HubDataset } from '@/lib/social-hub/dataset';

/** Set when unstable_cache runs the full dataset assembler (cache miss or revalidate). */
let rebuildPending = false;

export function logHubDatasetRebuild(detail: Record<string, unknown> = {}): void {
  rebuildPending = true;
  logInfo({
    component: 'social-hub-cache',
    event: 'dataset_rebuild',
    ...detail,
  });
}

export function logHubDatasetServe(
  dataset: HubDataset,
  detail: { durationMs: number; source: 'shared_cache' | 'partial_read' | 'error_path' },
): void {
  logInfo({
    component: 'social-hub-cache',
    event: 'dataset_serve',
    source: detail.source,
    cacheMiss: rebuildPending,
    durationMs: detail.durationMs,
    posts: dataset.posts.length,
    ideas: dataset.ideas.length,
    errorVerticals: dataset.errors.length,
    stale: Boolean(dataset.staleNote),
    hasCost: dataset.cost != null,
  });
  rebuildPending = false;
}
