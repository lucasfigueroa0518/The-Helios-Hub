/**
 * One campaign's send count for a day: its percentage of the sender's
 * inbox capacity, scaled down when several campaigns share that sender.
 */
import type { IdentitySlug } from '@/lib/delivery-states';
import { dbQuery } from '@/lib/db';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import {
  allocateCapacityShares,
  identityCapacity,
  nextCampaignCap,
  type LaneDemand,
} from '@/lib/inboxes/capacity';
import { toCapacityInbox } from '@/lib/inboxes/lifecycle';
import { listInboxes } from '@/lib/inboxes/repository';
import { DEFAULT_STAGE_PLAN } from '@/lib/inboxes/stage-plan';
import { getOrgSetting } from '@/lib/org-settings';
import { resolveDeliverySettings } from '@/lib/smartlead/delivery-settings';

type ShareRow = {
  id: string;
  kind: string;
  emails_per_day: number | null;
  delivery_settings: unknown;
};

async function identityPool(
  identitySlug: IdentitySlug,
  day: string,
  standing: boolean,
): Promise<number> {
  const orgPlan = await getOrgSetting('stage_plan.default', DEFAULT_STAGE_PLAN);
  const rows = await listInboxes({ identitySlug, enabledOnly: true });
  const inboxes = [];
  for (const row of rows) inboxes.push(await toCapacityInbox(row, orgPlan));
  if (standing) return inboxes.reduce((sum, inbox) => sum + nextCampaignCap(inbox, day), 0);
  return identityCapacity({ inboxes, followupsDue: 0 }, day);
}

async function loadShareClaims(identitySlug: IdentitySlug): Promise<ShareRow[]> {
  const { rows } = await dbQuery<ShareRow>(
    `SELECT id::text, COALESCE(kind, 'manual') AS kind, emails_per_day, delivery_settings
       FROM outreach.campaigns
      WHERE status = 'active'
        AND COALESCE(sender_identity_slug, 'lucas') = $1
        AND (
          COALESCE(kind, 'manual') <> 'auto'
          OR auto_status = 'live'
        )`,
    [identitySlug],
  );
  return rows;
}

/**
 * How many new leads this campaign may send.
 *
 * `standing` uses the next day that actually has campaign capacity, so a
 * weekend ramp still publishes a weekday limit to Smartlead and to the
 * campaign's stored snapshot. The live planner uses today's real cap.
 */
export async function campaignDailyQuota(input: {
  campaignId: string;
  identitySlug: IdentitySlug;
  capacityPct: number;
  day?: string;
  standing?: boolean;
}): Promise<number> {
  const day = input.day ?? formatNyDate();
  const pool = await identityPool(input.identitySlug, day, input.standing === true);
  if (pool <= 0) return 0;

  const rows = await loadShareClaims(input.identitySlug);
  const claims = new Map(rows.map((row) => [row.id, row]));
  if (!claims.has(input.campaignId)) {
    claims.set(input.campaignId, {
      id: input.campaignId,
      kind: 'manual',
      emails_per_day: null,
      delivery_settings: { capacity_pct: input.capacityPct },
    });
  }

  const lanes: LaneDemand[] = [...claims.values()].map((row) => {
    const settings = resolveDeliverySettings(row.delivery_settings);
    const pct = row.id === input.campaignId ? input.capacityPct : settings.capacity_pct;
    return {
      laneId: row.id,
      campaignId: row.id,
      identitySlug: input.identitySlug,
      demand: pool,
      maxNewLeadsPerDay: pct != null ? null : settings.max_new_leads_per_day,
      emailsPerDay: pct != null || row.kind !== 'auto' ? null : row.emails_per_day,
      capacityPct: pct,
      laneReady: true,
    };
  });

  return allocateCapacityShares(lanes, pool).get(input.campaignId) ?? 0;
}
