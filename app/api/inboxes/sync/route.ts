import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { detectAndLinkSmartleadAccounts } from '@/lib/inboxes/lifecycle';
import { enqueueWork } from '@/lib/orchestration/repository';
import { getSession } from '@/lib/session';
import { hasSmartleadApiKey, isSmartleadEnabled } from '@/lib/smartlead/enabled';

export const runtime = 'nodejs';

/**
 * "Sync now" on the Inboxes tab. Always matches hub mailboxes to Smartlead
 * accounts by email (API key is enough). When campaign sending is on, also
 * queues reconcile + lifecycle on the worker.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  if (!hasSmartleadApiKey()) {
    return draftingJson(
      { error: 'Smartlead API key is missing', code: 'smartlead_unconfigured' },
      503,
    );
  }

  let detection: Awaited<ReturnType<typeof detectAndLinkSmartleadAccounts>>;
  try {
    detection = await detectAndLinkSmartleadAccounts({ force: true });
  } catch (error) {
    return draftingErrorResponse(error);
  }

  if (!isSmartleadEnabled()) {
    return draftingJson({
      queued: false,
      linked: detection.linked,
      matched: detection.matched,
      unassigned: detection.unassigned,
    });
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
    return draftingJson({
      queued: true,
      reconcile_job_id: reconcileJobId,
      lifecycle_job_id: lifecycleJobId,
      linked: detection.linked,
      matched: detection.matched,
      unassigned: detection.unassigned,
    });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
