/**
 * One-shot S4 cutover: live AgentMail queue rows become undated handoff
 * rows, pending `email.send` jobs are cancelled, and the planner assigns
 * `handoff_date`s under the Smartlead capacity model.
 *
 * Idempotent. Re-running after a successful pass is a no-op besides a
 * fresh plan (which is itself idempotent for rows already dated).
 */
import { dbQuery } from '@/lib/db';
import { enqueueWork } from '@/lib/orchestration/repository';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { replanHandoffs } from '@/lib/smartlead/handoff';
import { laneEnsureWork, upsertLane } from '@/lib/smartlead/lanes';
import { setOrgSetting } from '@/lib/org-settings';
import type { IdentitySlug } from '@/lib/delivery-states';

export type CutoverCampaignReport = {
  campaignId: string;
  replanned: number;
  waiting: number;
};

export type CutoverReport = {
  ranAt: string;
  cancelledEmailSendJobs: number;
  resetQueueRows: number;
  lanesEnsured: number;
  assigned: number;
  waiting: number;
  byCampaign: CutoverCampaignReport[];
};

/**
 * Live queue statuses that still need a handoff date. `sending` is the
 * AgentMail-era name; after the schema migration the CHECK list no longer
 * includes it, but a half-applied cutover might still have those rows.
 */
export const CUTOVER_LIVE_STATUSES = ['queued', 'sending', 'handing_off'] as const;

export function cutoverTargetStatus(status: string): 'queued' | null {
  if (status === 'sending' || status === 'queued' || status === 'handing_off') return 'queued';
  return null;
}

export async function migrateQueueToHandoff(): Promise<CutoverReport> {
  const cancelled = await dbQuery<{ n: string }>(
    `WITH updated AS (
       UPDATE outreach.orchestration_jobs
          SET status = 'cancelled',
              finished_at = now(),
              last_error_code = 'smartlead_cutover',
              last_error_message = 'Replaced by smartlead.handoff',
              lease_owner = NULL,
              lease_expires_at = NULL
        WHERE kind = 'email.send'
          AND status IN ('pending', 'in_flight')
        RETURNING 1
     )
     SELECT count(*)::text AS n FROM updated`,
  );
  const cancelledEmailSendJobs = Number(cancelled.rows[0]?.n ?? 0);

  const reset = await dbQuery<{ n: string }>(
    `WITH updated AS (
       UPDATE outreach.email_send_queue
          SET status = 'queued',
              scheduled_for = NULL,
              handoff_date = NULL,
              waiting_reason = NULL,
              updated_at = now()
        WHERE status IN ('queued', 'sending', 'handing_off')
        RETURNING campaign_id
     )
     SELECT count(*)::text AS n FROM updated`,
  );
  const resetQueueRows = Number(reset.rows[0]?.n ?? 0);

  const { rows: needingLanes } = await dbQuery<{
    campaign_id: string;
    identity_slug: IdentitySlug;
  }>(
    `SELECT DISTINCT q.campaign_id::text,
            coalesce(c.sender_identity_slug, 'lucas') AS identity_slug
       FROM outreach.email_send_queue q
       JOIN outreach.campaigns c ON c.id = q.campaign_id
       LEFT JOIN outreach.campaign_lanes lane
              ON lane.campaign_id = q.campaign_id
             AND lane.identity_slug = coalesce(c.sender_identity_slug, 'lucas')
            AND lane.status = 'ready'
      WHERE q.status = 'queued'
        AND lane.id IS NULL`,
  );

  let lanesEnsured = 0;
  for (const row of needingLanes) {
    await upsertLane(row.campaign_id, row.identity_slug);
    await enqueueWork(laneEnsureWork(row.campaign_id, row.identity_slug));
    lanesEnsured += 1;
  }

  const plan = await replanHandoffs({ today: formatNyDate() });

  const { rows: byCampaignRows } = await dbQuery<{
    campaign_id: string;
    replanned: string;
    waiting: string;
  }>(
    `SELECT campaign_id::text,
            count(*) FILTER (WHERE handoff_date IS NOT NULL)::text AS replanned,
            count(*) FILTER (WHERE waiting_reason IS NOT NULL)::text AS waiting
       FROM outreach.email_send_queue
      WHERE status = 'queued'
      GROUP BY campaign_id
      ORDER BY campaign_id`,
  );

  const report: CutoverReport = {
    ranAt: new Date().toISOString(),
    cancelledEmailSendJobs,
    resetQueueRows,
    lanesEnsured,
    assigned: plan.assigned,
    waiting: plan.waiting,
    byCampaign: byCampaignRows.map((row) => ({
      campaignId: row.campaign_id,
      replanned: Number(row.replanned),
      waiting: Number(row.waiting),
    })),
  };

  await setOrgSetting('smartlead.cutover_report', report);
  return report;
}
