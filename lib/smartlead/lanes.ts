/**
 * Campaign lanes: one Smartlead campaign per (hub campaign × sending identity),
 * with only that identity's mailboxes attached.
 *
 * `ensureCampaignLane` is idempotent per step and persists after each one, so a
 * crash resumes at the first unfinished step rather than starting over. The
 * dangerous window is between `POST /campaigns/create` returning an id and that
 * id reaching the database — a crash there would orphan a Smartlead campaign
 * and create a duplicate on retry. Step 1 closes it two ways: the id write is
 * the very next statement, and the campaign name carries the lane's own id so
 * a retry can find and adopt the orphan.
 */
import type { IdentitySlug, LaneStatus } from '@/lib/delivery-states';
import { dbQuery } from '@/lib/db';
import { listSendingInboxes } from '@/lib/inboxes/repository';
import type { DispatchWork } from '@/lib/orchestration/types';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { toCustomBodyHtml } from '@/lib/smartlead/body';
import { redactApiKey } from '@/lib/smartlead/client';
import {
  DEFAULT_DELIVERY_SETTINGS,
  resolveDeliverySettings,
  type DeliverySettings,
} from '@/lib/smartlead/delivery-settings';

export type CampaignLane = {
  id: string;
  campaign_id: string;
  identity_slug: IdentitySlug;
  smartlead_campaign_id: number | null;
  status: LaneStatus;
  sequence_version: number;
  attached_account_ids: number[];
  smartlead_webhook_id: number | null;
  webhook_registered_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_LANE = `
  SELECT id::text, campaign_id::text, identity_slug, smartlead_campaign_id, status,
         sequence_version, attached_account_ids, smartlead_webhook_id,
         webhook_registered_at, error, created_at, updated_at
    FROM outreach.campaign_lanes`;

export async function getLane(
  campaignId: string,
  identitySlug: IdentitySlug,
): Promise<CampaignLane | null> {
  const { rows } = await dbQuery<CampaignLane>(
    `${SELECT_LANE} WHERE campaign_id = $1 AND identity_slug = $2`,
    [campaignId, identitySlug],
  );
  return rows[0] ?? null;
}

export async function getLaneById(laneId: string): Promise<CampaignLane | null> {
  const { rows } = await dbQuery<CampaignLane>(`${SELECT_LANE} WHERE id = $1`, [laneId]);
  return rows[0] ?? null;
}

/** The webhook's entry point: Smartlead campaign id → hub lane, by unique index. */
export async function laneBySmartleadCampaignId(
  smartleadCampaignId: number,
): Promise<CampaignLane | null> {
  const { rows } = await dbQuery<CampaignLane>(
    `${SELECT_LANE} WHERE smartlead_campaign_id = $1`,
    [smartleadCampaignId],
  );
  return rows[0] ?? null;
}

export async function listLanesForCampaign(campaignId: string): Promise<CampaignLane[]> {
  const { rows } = await dbQuery<CampaignLane>(
    `${SELECT_LANE} WHERE campaign_id = $1 ORDER BY identity_slug`,
    [campaignId],
  );
  return rows;
}

export async function listLanesForIdentities(
  identities: IdentitySlug[],
): Promise<CampaignLane[]> {
  if (!identities.length) return [];
  const { rows } = await dbQuery<CampaignLane>(
    `${SELECT_LANE} WHERE identity_slug = ANY($1::text[]) AND status <> 'error'`,
    [identities],
  );
  return rows;
}

/** Lanes reconcile should retry: half-built or failed. */
export async function listUnfinishedLanes(): Promise<CampaignLane[]> {
  const { rows } = await dbQuery<CampaignLane>(
    `${SELECT_LANE} WHERE status IN ('creating', 'error') ORDER BY updated_at ASC LIMIT 50`,
  );
  return rows;
}

/** Job that builds or repairs one lane. `reviveTerminal` so a skipped-while-disabled run retries. */
export function laneEnsureWork(
  campaignId: string,
  identitySlug: IdentitySlug,
): DispatchWork<'smartlead.lane_ensure'> {
  return {
    kind: 'smartlead.lane_ensure',
    payload: { campaignId, identitySlug },
    dedupeKey: `lane:${campaignId}:${identitySlug}`,
    scopeKey: campaignId,
    reviveTerminal: true,
  };
}

/** Creates the lane row first, so every later step has somewhere to write. */
export async function upsertLane(
  campaignId: string,
  identitySlug: IdentitySlug,
): Promise<CampaignLane> {
  await dbQuery(
    `INSERT INTO outreach.campaign_lanes (campaign_id, identity_slug, status)
     VALUES ($1, $2, 'creating')
     ON CONFLICT (campaign_id, identity_slug) DO NOTHING`,
    [campaignId, identitySlug],
  );
  const lane = await getLane(campaignId, identitySlug);
  if (!lane) throw new Error(`Failed to create lane for ${campaignId}/${identitySlug}`);
  return lane;
}

export async function setLaneStatus(
  laneId: string,
  status: LaneStatus,
  error?: string | null,
): Promise<void> {
  await dbQuery(
    `UPDATE outreach.campaign_lanes
        SET status = $2, error = $3, updated_at = now()
      WHERE id = $1`,
    [laneId, status, error ? redactApiKey(error).slice(0, 1000) : null],
  );
}

/**
 * Writes the Smartlead campaign id, and only if the lane does not already have
 * one — a concurrent retry that already adopted an orphan must win.
 */
export async function claimSmartleadCampaignId(
  laneId: string,
  smartleadCampaignId: number,
): Promise<boolean> {
  const { rowCount } = await dbQuery(
    `UPDATE outreach.campaign_lanes
        SET smartlead_campaign_id = $2, updated_at = now()
      WHERE id = $1 AND smartlead_campaign_id IS NULL`,
    [laneId, smartleadCampaignId],
  );
  return (rowCount ?? 0) > 0;
}

async function setAttachedAccounts(laneId: string, accountIds: number[]): Promise<void> {
  await dbQuery(
    `UPDATE outreach.campaign_lanes
        SET attached_account_ids = $2::bigint[], updated_at = now()
      WHERE id = $1`,
    [laneId, accountIds],
  );
}

async function setSequenceVersion(laneId: string, version: number): Promise<void> {
  await dbQuery(
    `UPDATE outreach.campaign_lanes
        SET sequence_version = $2, updated_at = now()
      WHERE id = $1`,
    [laneId, version],
  );
}

async function setWebhook(laneId: string, webhookId: number | null): Promise<void> {
  await dbQuery(
    `UPDATE outreach.campaign_lanes
        SET smartlead_webhook_id = $2,
            webhook_registered_at = CASE WHEN $2 IS NULL THEN NULL ELSE now() END,
            updated_at = now()
      WHERE id = $1`,
    [laneId, webhookId],
  );
}

/**
 * The lane's stable fingerprint inside the Smartlead campaign name. Derived
 * from `campaign_lanes.id`, so renaming the hub campaign cannot break recovery.
 */
export function laneNameSuffix(laneId: string): string {
  return laneId.replace(/-/g, '').slice(0, 8);
}

export function laneCampaignName(
  hubName: string,
  identitySlug: IdentitySlug,
  laneId: string,
): string {
  const identity = identitySlug === 'lucas' ? 'Lucas' : 'Tommy';
  return `${hubName} · ${identity} · ${laneNameSuffix(laneId)}`;
}

export type CampaignRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  emails_per_day: number | null;
  follow_up_enabled: boolean;
  delivery_settings: unknown;
};

export async function getCampaignForLane(campaignId: string): Promise<CampaignRow | null> {
  const { rows } = await dbQuery<CampaignRow>(
    `SELECT id::text, name, kind, status, emails_per_day, follow_up_enabled, delivery_settings
       FROM outreach.campaigns WHERE id = $1`,
    [campaignId],
  );
  return rows[0] ?? null;
}

export type EnsureLaneOptions = {
  adapter?: SmartleadAdapter;
  /** Public base URL the webhook is registered against. */
  webhookBaseUrl?: string;
  webhookPathToken?: string;
};

/**
 * Builds or repairs one lane, one API call per step, persisting after each.
 * Re-running is safe at any point: each step checks what is already recorded.
 */
export async function ensureCampaignLane(
  campaignId: string,
  identitySlug: IdentitySlug,
  options: EnsureLaneOptions = {},
): Promise<CampaignLane> {
  const adapter = options.adapter ?? smartleadAdapter;
  const campaign = await getCampaignForLane(campaignId);
  if (!campaign) throw new Error(`No such campaign: ${campaignId}`);

  // Step 0 — the row exists before any Smartlead call.
  let lane = await upsertLane(campaignId, identitySlug);
  const settings = resolveDeliverySettings(campaign.delivery_settings);

  try {
    // Step 1 — create, then write the id as the very next statement.
    if (lane.smartlead_campaign_id === null) {
      const adopted = await adoptOrphanedCampaign(adapter, lane, campaign.name);
      if (adopted !== null) {
        await claimSmartleadCampaignId(lane.id, adopted);
      } else {
        const created = await adapter.createCampaign(
          laneCampaignName(campaign.name, identitySlug, lane.id),
        );
        await claimSmartleadCampaignId(lane.id, created.id);
      }
      lane = (await getLaneById(lane.id))!;
    }
    const smartleadCampaignId = lane.smartlead_campaign_id!;

    // Step 2 — settings. Tracking is expressed as opt-outs.
    await adapter.setSettings(smartleadCampaignId, {
      track_settings: settings.tracking ? [] : ['DONT_EMAIL_OPEN', 'DONT_LINK_CLICK'],
      stop_lead_settings: settings.stop_on_reply ? 'REPLY_TO_AN_EMAIL' : 'NEVER',
      unsubscribe_text: settings.unsubscribe_text,
      send_as_plain_text: false,
      // Sender choice is the lifecycle's job, not an ESP-matching heuristic.
      enable_ai_esp_matching: false,
      max_leads_per_day: settings.max_new_leads_per_day ?? undefined,
      min_time_between_emails: settings.schedule.min_gap_min,
    });

    // Step 3 — schedule.
    await adapter.setSchedule(smartleadCampaignId, {
      timezone: settings.schedule.tz,
      days: settings.schedule.days,
      start_hour: settings.schedule.start,
      end_hour: settings.schedule.end,
      min_time_btw_emails: settings.schedule.min_gap_min,
      max_new_leads_per_day: settings.max_new_leads_per_day ?? undefined,
    });

    // Step 4 — sequences. Step 1 is the hub's per-lead draft; 2..N are templates.
    const sequences = buildSequences(settings, campaign.follow_up_enabled);
    const version = sequenceVersion(sequences);
    if (lane.sequence_version !== version) {
      await adapter.setSequences(smartleadCampaignId, sequences);
      await setSequenceVersion(lane.id, version);
    }

    // Step 5 — attach exactly this identity's sending mailboxes.
    const accountIds = (await listSendingInboxes(identitySlug))
      .map((inbox) => inbox.smartlead_email_account_id!)
      .filter((id): id is number => typeof id === 'number');
    await applyAccountDiff(adapter, smartleadCampaignId, lane, accountIds);

    // Step 6 — webhook, registered per campaign because that is the only
    // Smartlead form we can list back (see docs/smartlead-s0-findings.md).
    if (options.webhookBaseUrl && options.webhookPathToken && lane.smartlead_webhook_id === null) {
      const hook = await adapter.registerWebhook(smartleadCampaignId, {
        name: `Helios Hub · ${laneNameSuffix(lane.id)}`,
        webhookUrl: webhookUrlFor(options.webhookBaseUrl, options.webhookPathToken),
        events: [
          'EMAIL_SENT',
          'EMAIL_OPENED',
          'EMAIL_CLICKED',
          'EMAIL_REPLIED',
          'EMAIL_BOUNCED',
          'EMAIL_UNSUBSCRIBED',
          'LEAD_CATEGORY_UPDATED',
        ],
      });
      if (typeof hook?.id === 'number') await setWebhook(lane.id, hook.id);
    }

    // Step 7 — start. START, not ACTIVE: Smartlead rejects the latter.
    await adapter.setStatus(smartleadCampaignId, 'START');
    await setLaneStatus(lane.id, 'ready', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setLaneStatus(lane.id, 'error', message);
    throw error;
  }

  return (await getLaneById(lane.id))!;
}

export function webhookUrlFor(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/webhooks/smartlead/${token}`;
}

/**
 * Crash-window recovery only: if a campaign already exists carrying this lane's
 * suffix, adopt it rather than creating a second one. Name matching is never
 * the primary key — `smartlead_campaign_id` is.
 */
async function adoptOrphanedCampaign(
  adapter: SmartleadAdapter,
  lane: CampaignLane,
  hubName: string,
): Promise<number | null> {
  const suffix = laneNameSuffix(lane.id);
  try {
    const campaigns = await adapter.listCampaigns();
    const match = campaigns.find((campaign) => campaign.name?.endsWith(suffix));
    return match?.id ?? null;
  } catch {
    // A failed lookup must not stop lane creation; worst case we create one.
    void hubName;
    return null;
  }
}

/** Attaches what is missing and detaches what should no longer send. */
async function applyAccountDiff(
  adapter: SmartleadAdapter,
  smartleadCampaignId: number,
  lane: CampaignLane,
  desired: number[],
): Promise<void> {
  const current = new Set(lane.attached_account_ids ?? []);
  const target = new Set(desired);
  const toAttach = desired.filter((id) => !current.has(id));
  const toDetach = [...current].filter((id) => !target.has(id));

  if (toAttach.length) await adapter.attachAccounts(smartleadCampaignId, toAttach);
  // Smartlead refuses to leave an active campaign with no sender, so a full
  // detach is skipped and the lane is paused instead.
  if (toDetach.length && target.size > 0) {
    await adapter.detachAccounts(smartleadCampaignId, toDetach);
  }
  if (target.size === 0) {
    await adapter.setStatus(smartleadCampaignId, 'PAUSED');
  }
  await setAttachedAccounts(lane.id, desired);
}

export function buildSequences(settings: DeliverySettings, followUpEnabled: boolean) {
  const steps = [
    {
      id: null,
      seq_number: 1,
      subject: '{{custom_subject}}',
      email_body: '{{custom_body}}',
      seq_delay_details: { delay_in_days: 0 },
    },
  ];
  if (!followUpEnabled) return steps;

  for (const followUp of [...settings.follow_ups].sort((a, b) => a.step - b.step)) {
    steps.push({
      id: null,
      seq_number: followUp.step,
      // An empty subject keeps the follow-up on the original thread as "Re:".
      subject: '',
      email_body: toCustomBodyHtml(followUp.body_template, { allowLinks: true }),
      seq_delay_details: { delay_in_days: Math.max(1, followUp.delay_days) },
    });
  }
  return steps;
}

/** Cheap content hash so unchanged sequences are not rewritten every day. */
export function sequenceVersion(sequences: ReturnType<typeof buildSequences>): number {
  const text = JSON.stringify(sequences);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  // Keep it positive and non-zero so it never collides with the 0 default.
  return Math.abs(hash) || 1;
}

/** Pauses the Smartlead campaign without forgetting the lane. */
export async function pauseLane(
  laneId: string,
  options: { adapter?: SmartleadAdapter } = {},
): Promise<void> {
  const adapter = options.adapter ?? smartleadAdapter;
  const lane = await getLaneById(laneId);
  if (!lane?.smartlead_campaign_id) return;
  await adapter.setStatus(lane.smartlead_campaign_id, 'PAUSED');
  await setLaneStatus(laneId, 'paused', null);
}

/** Re-attaches an identity's current sending set to each of its ready lanes. */
export async function syncLaneAccounts(
  identitySlug: IdentitySlug,
  options: { adapter?: SmartleadAdapter } = {},
): Promise<{ lanes: number; attached: number[] }> {
  const adapter = options.adapter ?? smartleadAdapter;
  const accountIds = (await listSendingInboxes(identitySlug))
    .map((inbox) => inbox.smartlead_email_account_id)
    .filter((id): id is number => typeof id === 'number');

  const lanes = (await listLanesForIdentities([identitySlug]))
    .filter((lane) => lane.status === 'ready' && lane.smartlead_campaign_id !== null);

  for (const lane of lanes) {
    await applyAccountDiff(adapter, lane.smartlead_campaign_id!, lane, accountIds);
  }
  return { lanes: lanes.length, attached: accountIds };
}

export { DEFAULT_DELIVERY_SETTINGS };
