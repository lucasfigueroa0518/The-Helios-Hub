/**
 * Orchestration handlers for the Smartlead lane.
 *
 * Every handler starts with the kill switch. A disabled deploy completes each
 * job as done with `{skipped:'smartlead_disabled'}` rather than failing it, so
 * nothing retries in a loop, and the reconcile tick re-enqueues the work on the
 * next cycle once the flag is back. Enrichment and drafting lanes are
 * untouched by the flag.
 *
 * Smartlead errors map to orchestration outcomes in one place, `rethrowSmartlead`:
 *   429    → retryable, honouring Retry-After
 *   5xx    → retryable with jittered backoff
 *   4xx    → permanent, so the job fails with a redacted message
 */
import { jitteredBackoffMs } from '@/lib/orchestration/config';
import {
  RetryableWorkError,
  type OrchestrationJob,
  type WorkHandlerResult,
} from '@/lib/orchestration/types';
import {
  SmartleadRateLimitError,
  SmartleadServerError,
} from '@/lib/smartlead/client';
import { SMARTLEAD_DISABLED_RESULT, isSmartleadEnabled } from '@/lib/smartlead/enabled';

/** Translates a Smartlead failure into the orchestration retry contract. */
export function rethrowSmartlead(error: unknown, attempt: number): never {
  if (error instanceof SmartleadRateLimitError) {
    throw new RetryableWorkError(
      error.message,
      Math.max(error.retryAfterMs, jitteredBackoffMs(attempt)),
      'smartlead_rate_limited',
      { cause: error },
    );
  }
  if (error instanceof SmartleadServerError) {
    throw new RetryableWorkError(
      error.message,
      jitteredBackoffMs(attempt),
      'smartlead_transient',
      { cause: error },
    );
  }
  throw error;
}

/** Wraps a handler body with the kill switch and the error mapping. */
async function guarded(
  job: OrchestrationJob,
  run: () => Promise<WorkHandlerResult>,
): Promise<WorkHandlerResult> {
  if (!isSmartleadEnabled()) return { result: SMARTLEAD_DISABLED_RESULT };
  try {
    return await run();
  } catch (error) {
    rethrowSmartlead(error, job.attempt_count);
  }
}

export async function handleSmartleadLaneEnsure(
  job: OrchestrationJob<'smartlead.lane_ensure'>,
): Promise<WorkHandlerResult> {
  return guarded(job, async () => {
    const { ensureCampaignLane } = await import('@/lib/smartlead/lanes');
    const lane = await ensureCampaignLane(job.payload.campaignId, job.payload.identitySlug);
    return {
      result: {
        laneId: lane.id,
        status: lane.status,
        smartleadCampaignId: lane.smartlead_campaign_id,
      },
    };
  });
}

export async function handleSmartleadHandoff(
  job: OrchestrationJob<'smartlead.handoff'>,
): Promise<WorkHandlerResult> {
  return guarded(job, async () => {
    const { executeHandoffBatch } = await import('@/lib/smartlead/handoff');
    return { result: { ...(await executeHandoffBatch(job.payload)) } };
  });
}

export async function handleSmartleadLeadOp(
  job: OrchestrationJob<'smartlead.lead_op'>,
): Promise<WorkHandlerResult> {
  return guarded(job, async () => {
    const { executeLeadOp } = await import('@/lib/smartlead/handoff');
    return { result: { ...(await executeLeadOp(job.payload.op, job.payload.queueId)) } };
  });
}

export async function handleSmartleadReconcile(
  job: OrchestrationJob<'smartlead.reconcile'>,
): Promise<WorkHandlerResult> {
  return guarded(job, async () => {
    const { runSmartleadReconcile } = await import('@/lib/smartlead/reconcile');
    return {
      result: {
        reason: job.payload.reason ?? null,
        ...(await runSmartleadReconcile()),
      },
    };
  });
}

export async function handleInboxLifecycleDaily(
  job: OrchestrationJob<'inbox.lifecycle_daily'>,
): Promise<WorkHandlerResult> {
  return guarded(job, async () => {
    const { runLifecycleDaily } = await import('@/lib/inboxes/lifecycle');
    const report = await runLifecycleDaily({ today: job.payload.dayKey });

    // A mailbox that entered or left the sending stages changes which accounts
    // its identity's lanes should have attached.
    const children = report.identitiesToResync.length
      ? await buildLaneResyncChildren(report.identitiesToResync)
      : [];

    return {
      children,
      result: {
        day: report.day,
        examined: report.examined,
        detected: report.detected,
        transitions: report.transitions,
        smartleadWrites: report.smartleadWrites,
        unassignedAccounts: report.unassignedAccounts,
        errors: report.errors,
      },
    };
  });
}

async function buildLaneResyncChildren(identities: string[]) {
  const { listLanesForIdentities } = await import('@/lib/smartlead/lanes');
  const lanes = await listLanesForIdentities(identities as never);
  return lanes.map((lane) => ({
    kind: 'smartlead.lane_ensure' as const,
    payload: { campaignId: lane.campaign_id, identitySlug: lane.identity_slug },
    dedupeKey: `lane:${lane.campaign_id}:${lane.identity_slug}`,
    scopeKey: lane.campaign_id,
    reviveTerminal: true,
  }));
}

/**
 * Warmup counters need the API key, not the send kill switch — same split as
 * listing accounts. `runHealthSnapshot` no-ops without a key.
 */
export async function handleInboxHealthSnapshot(
  job: OrchestrationJob<'inbox.health_snapshot'>,
): Promise<WorkHandlerResult> {
  try {
    const { runHealthSnapshot } = await import('@/lib/inboxes/snapshot');
    return { result: { ...(await runHealthSnapshot(job.payload.dayKey)) } };
  } catch (error) {
    rethrowSmartlead(error, job.attempt_count);
  }
}

/**
 * Postmaster is Google, not Smartlead, so it is not behind the Smartlead kill
 * switch — but it is behind its own missing-credentials skip, in the same shape
 * as `handleAnthropicCostSync`.
 */
export async function handlePostmasterDaily(
  job: OrchestrationJob<'postmaster.daily'>,
): Promise<WorkHandlerResult> {
  const { runPostmasterSnapshot } = await import('@/lib/postmaster/snapshot');
  return { result: { ...(await runPostmasterSnapshot(job.payload.dayKey)) } };
}
