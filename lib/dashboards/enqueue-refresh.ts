import { enqueueWorkBatch } from '@/lib/orchestration/repository';
import { scrubError } from '@/lib/dashboards/scrub-logs';

/**
 * Ask the cloud worker to run a GitHub sync + AI summary pass.
 * Uses a per-project daily dedupe key so a new dashboard is not stuck
 * waiting on the already-completed 09:00 UTC job.
 */
export async function enqueueDashboardRefresh(
  projectId: string,
  reason: string,
): Promise<void> {
  const dayKey = new Date().toISOString().slice(0, 10);
  try {
    await enqueueWorkBatch([
      {
        kind: 'dashboards.daily_update',
        payload: { reason },
        dedupeKey: `refresh:${projectId}:${dayKey}`,
        scopeKey: 'dashboards',
        maxAttempts: 2,
        priority: -5,
      },
    ]);
  } catch (error) {
    console.error('[dashboards] enqueue refresh failed:', scrubError(error));
  }
}
