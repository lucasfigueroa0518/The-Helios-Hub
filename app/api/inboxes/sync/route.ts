import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { enqueueWork } from '@/lib/orchestration/repository';
import { getSession } from '@/lib/session';
import { isSmartleadEnabled } from '@/lib/smartlead/enabled';

export const runtime = 'nodejs';

/**
 * "Sync now" on the Inboxes tab. Queues a reconcile and an immediate lifecycle
 * pass on the worker rather than calling Smartlead from the request — Vercel
 * does not run the worker, and the Smartlead lane is where writes are
 * serialized.
 *
 * `reviveTerminal` re-runs today's job even if it already finished, which is
 * the whole point of a manual sync.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  if (!isSmartleadEnabled()) {
    return draftingJson(
      { error: 'Smartlead delivery is turned off (SMARTLEAD_ENABLED)', code: 'smartlead_disabled' },
      503,
    );
  }

  const dayKey = formatNyDate();
  try {
    const [reconcileJobId, lifecycleJobId] = await Promise.all([
      enqueueWork({
        kind: 'smartlead.reconcile',
        payload: { reason: 'manual_inbox_sync' },
        dedupeKey: `reconcile:manual:${dayKey}:${Math.floor(Date.now() / 60_000)}`,
        scopeKey: 'smartlead',
        reviveTerminal: true,
      }),
      enqueueWork({
        kind: 'inbox.lifecycle_daily',
        payload: { dayKey },
        dedupeKey: dayKey,
        scopeKey: 'inboxes',
        reviveTerminal: true,
      }),
    ]);
    return draftingJson({ queued: true, reconcile_job_id: reconcileJobId, lifecycle_job_id: lifecycleJobId });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
