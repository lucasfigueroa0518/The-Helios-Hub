/**
 * The handoff planner and executor (§5D).
 *
 * The hub decides *what* and *how much per day*; Smartlead decides *which
 * mailbox* and *when*. `planHandoffs` is pure so the whole allocation policy is
 * testable offline; `executeHandoffBatch` is the one place that pushes leads.
 */
import type { IdentitySlug, WaitingReason } from '@/lib/delivery-states';
import { dbQuery, dbTransaction } from '@/lib/db';
import { isReadyForBulkSend } from '@/lib/drafting/draft-review-order';
import { hasRetrySuggestedLint } from '@/lib/drafting/lint';
import type { LintResult } from '@/lib/drafting/types';
import {
  addCalendarDays,
  formatNyDate,
  nyWallTimeToUtc,
} from '@/lib/drafting/send-queue-schedule';
import {
  identityCapacity,
  laneCapacity,
  monthlyCeiling,
  roundRobinAllocate,
  type CapacityInbox,
  type LaneDemand,
  type MonthlyUsage,
} from '@/lib/inboxes/capacity';
import { toCapacityInbox } from '@/lib/inboxes/lifecycle';
import { listInboxes } from '@/lib/inboxes/repository';
import { DEFAULT_STAGE_PLAN } from '@/lib/inboxes/stage-plan';
import {
  DEFAULT_PLAN_LIMITS,
  getOrgSettings,
  type PlanLimits,
  type UsageCache,
} from '@/lib/org-settings';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { assertCustomFieldLength, textToCustomBodyHtml, toCustomBodyHtml } from '@/lib/smartlead/body';
import { getLaneById, listLanesForCampaign, type CampaignLane } from '@/lib/smartlead/lanes';
import { resolveDeliverySettings } from '@/lib/smartlead/delivery-settings';
import { SMARTLEAD_MAX_LEADS_PER_REQUEST, type SmartleadLeadInput } from '@/lib/smartlead/types';

/** NY hour the day's handoff job becomes available. A planner constant; never stored. */
export const HANDOFF_HOUR_NY = 7;
export const HANDOFF_MINUTE_NY = 30;
export const PLAN_HORIZON_DAYS = 14;

// ---------------------------------------------------------------------------
// Planner (pure)
// ---------------------------------------------------------------------------

export type PendingRow = {
  queueId: string;
  campaignId: string;
  laneId: string | null;
  identitySlug: IdentitySlug;
  /** Oldest first; ties broken by id so the plan is deterministic. */
  createdAt: string;
};

export type PlannerLane = {
  laneId: string;
  campaignId: string;
  identitySlug: IdentitySlug;
  ready: boolean;
  maxNewLeadsPerDay: number | null;
  emailsPerDay: number | null;
};

export type PlanInput = {
  today: string;
  horizonDays?: number;
  rows: PendingRow[];
  lanes: PlannerLane[];
  inboxesByIdentity: Map<IdentitySlug, CapacityInbox[]>;
  /** `${identity}:${date}` → follow-up steps Smartlead will send that day. */
  followupsDue: Map<string, number>;
  /** `${identity}:${date}` → already handed off for that day but not yet sent. */
  carryOver: Map<string, number>;
  monthly: MonthlyUsage;
};

export type PlanAssignment = { queueId: string; laneId: string; date: string };
export type PlanWaiting = { queueId: string; reason: WaitingReason };

export type PlanResult = {
  assignments: PlanAssignment[];
  waiting: PlanWaiting[];
  /** Per identity per day, for the board's capacity row. */
  days: Array<{ date: string; identitySlug: IdentitySlug; pool: number; assigned: number }>;
};

function key(identity: string, date: string): string {
  return `${identity}:${date}`;
}

/**
 * Walks the horizon day by day, handing each identity's pool to its lanes round
 * robin. Rows that never fit carry a reason so the board can explain itself
 * rather than showing an unexplained empty column.
 */
export function planHandoffs(input: PlanInput): PlanResult {
  const horizon = input.horizonDays ?? PLAN_HORIZON_DAYS;
  const laneById = new Map(input.lanes.map((lane) => [lane.laneId, lane]));

  const queueByLane = new Map<string, PendingRow[]>();
  const waiting: PlanWaiting[] = [];

  for (const row of [...input.rows].sort(byAge)) {
    const lane = row.laneId ? laneById.get(row.laneId) : undefined;
    if (!lane || !lane.ready) {
      waiting.push({ queueId: row.queueId, reason: 'lane_not_ready' });
      continue;
    }
    const list = queueByLane.get(lane.laneId) ?? [];
    list.push(row);
    queueByLane.set(lane.laneId, list);
  }

  const assignments: PlanAssignment[] = [];
  const days: PlanResult['days'] = [];
  const identities = [...input.inboxesByIdentity.keys()];
  let plannedSoFar = 0;
  let ceilingBound = false;

  for (let offset = 0; offset < horizon; offset += 1) {
    const date = addCalendarDays(input.today, offset);
    const ceiling = monthlyCeiling(input.monthly, plannedSoFar);

    for (const identitySlug of identities) {
      const inboxes = input.inboxesByIdentity.get(identitySlug) ?? [];
      const capacity = identityCapacity(
        { inboxes, followupsDue: input.followupsDue.get(key(identitySlug, date)) ?? 0 },
        date,
      );
      const pool = Math.max(
        0,
        Math.min(capacity, ceiling) - (input.carryOver.get(key(identitySlug, date)) ?? 0),
      );
      if (Number.isFinite(ceiling) && ceiling < capacity) ceilingBound = true;

      const laneDemands: LaneDemand[] = input.lanes
        .filter((lane) => lane.identitySlug === identitySlug)
        .map((lane) => ({
          laneId: lane.laneId,
          campaignId: lane.campaignId,
          identitySlug: lane.identitySlug,
          demand: queueByLane.get(lane.laneId)?.length ?? 0,
          maxNewLeadsPerDay: lane.maxNewLeadsPerDay,
          emailsPerDay: lane.emailsPerDay,
          laneReady: lane.ready,
        }));

      const allocated = roundRobinAllocate(laneDemands, pool);
      let assignedToday = 0;
      for (const [laneId, count] of allocated) {
        const queue = queueByLane.get(laneId);
        if (!queue?.length || count <= 0) continue;
        for (const row of queue.splice(0, count)) {
          assignments.push({ queueId: row.queueId, laneId, date });
          assignedToday += 1;
        }
      }
      plannedSoFar += assignedToday;
      days.push({ date, identitySlug, pool, assigned: assignedToday });
    }
  }

  // Whatever is still queued after the horizon could not be placed.
  for (const [laneId, rows] of queueByLane) {
    const lane = laneById.get(laneId);
    const reason: WaitingReason = ceilingBound && laneHasNoCap(lane)
      ? 'monthly_ceiling'
      : 'no_capacity';
    for (const row of rows) waiting.push({ queueId: row.queueId, reason });
  }

  return { assignments, waiting, days };
}

function laneHasNoCap(lane: PlannerLane | undefined): boolean {
  return !lane?.maxNewLeadsPerDay && !lane?.emailsPerDay;
}

function byAge(a: PendingRow, b: PendingRow): number {
  return a.createdAt === b.createdAt
    ? a.queueId.localeCompare(b.queueId)
    : a.createdAt.localeCompare(b.createdAt);
}

/** UTC instant of 07:30 NY on a calendar date — when the day's job may run. */
export function handoffAvailableAt(date: string): Date {
  return nyWallTimeToUtc(date, HANDOFF_HOUR_NY, HANDOFF_MINUTE_NY);
}

// ---------------------------------------------------------------------------
// Planner I/O
// ---------------------------------------------------------------------------

/** Loads the planner's inputs and writes the resulting handoff dates. */
export async function replanHandoffs(
  options: { today?: string; horizonDays?: number } = {},
): Promise<{ assigned: number; waiting: number; days: PlanResult['days'] }> {
  const today = options.today ?? formatNyDate();
  const settings = await getOrgSettings([
    'stage_plan.default',
    'smartlead.plan_limits',
    'smartlead.usage_cache',
  ]);
  const orgPlan = settings.get('stage_plan.default') ?? DEFAULT_STAGE_PLAN;
  const limits = (settings.get('smartlead.plan_limits') ?? DEFAULT_PLAN_LIMITS) as PlanLimits;
  const usage = (settings.get('smartlead.usage_cache') ?? {}) as UsageCache;

  const inboxes = await listInboxes({ enabledOnly: true });
  const inboxesByIdentity = new Map<IdentitySlug, CapacityInbox[]>();
  for (const inbox of inboxes) {
    const list = inboxesByIdentity.get(inbox.identity_slug) ?? [];
    list.push(await toCapacityInbox(inbox, orgPlan));
    inboxesByIdentity.set(inbox.identity_slug, list);
  }

  const result = planHandoffs({
    today,
    horizonDays: options.horizonDays,
    rows: await loadPendingRows(),
    lanes: await loadPlannerLanes(),
    inboxesByIdentity,
    followupsDue: await loadFollowupsDue(today, options.horizonDays ?? PLAN_HORIZON_DAYS),
    carryOver: await loadCarryOver(today),
    monthly: {
      limit: limits.emails_per_month ?? 0,
      used: usage.sent ?? 0,
      warmupUsed: usage.warmup_sent ?? 0,
      daysLeft: daysLeftInCycle(today),
    },
  });

  await applyPlan(result);
  return { assigned: result.assignments.length, waiting: result.waiting.length, days: result.days };
}

async function applyPlan(plan: PlanResult): Promise<void> {
  await dbTransaction(async (client) => {
    for (const assignment of plan.assignments) {
      await client.query(
        `UPDATE outreach.email_send_queue
            SET handoff_date = $2::date, lane_id = $3, waiting_reason = NULL, updated_at = now()
          WHERE id = $1 AND status = 'queued'`,
        [assignment.queueId, assignment.date, assignment.laneId],
      );
    }
    for (const row of plan.waiting) {
      await client.query(
        `UPDATE outreach.email_send_queue
            SET handoff_date = NULL, waiting_reason = $2, updated_at = now()
          WHERE id = $1 AND status = 'queued'`,
        [row.queueId, row.reason],
      );
    }
  });
}

async function loadPendingRows(): Promise<PendingRow[]> {
  const { rows } = await dbQuery<{
    id: string;
    campaign_id: string;
    lane_id: string | null;
    identity_slug: IdentitySlug | null;
    created_at: string;
  }>(
    `SELECT q.id::text,
            q.campaign_id::text,
            coalesce(q.lane_id, lane.id)::text AS lane_id,
            coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') AS identity_slug,
            q.created_at::text
       FROM outreach.email_send_queue q
       JOIN outreach.campaigns c ON c.id = q.campaign_id
       LEFT JOIN outreach.campaign_lanes lane
              ON lane.campaign_id = q.campaign_id
             AND lane.identity_slug = coalesce(c.sender_identity_slug, 'lucas')
      WHERE q.status = 'queued'
      ORDER BY q.created_at ASC, q.id ASC`,
  );
  return rows.map((row) => ({
    queueId: row.id,
    campaignId: row.campaign_id,
    laneId: row.lane_id,
    identitySlug: row.identity_slug ?? 'lucas',
    createdAt: row.created_at,
  }));
}

async function loadPlannerLanes(): Promise<PlannerLane[]> {
  const { rows } = await dbQuery<{
    lane_id: string;
    campaign_id: string;
    identity_slug: IdentitySlug;
    status: string;
    kind: string;
    emails_per_day: number | null;
    delivery_settings: unknown;
    campaign_status: string;
  }>(
    `SELECT lane.id::text AS lane_id, lane.campaign_id::text, lane.identity_slug, lane.status,
            c.kind, c.emails_per_day, c.delivery_settings, c.status AS campaign_status
       FROM outreach.campaign_lanes lane
       JOIN outreach.campaigns c ON c.id = lane.campaign_id`,
  );
  return rows.map((row) => {
    const settings = resolveDeliverySettings(row.delivery_settings);
    return {
      laneId: row.lane_id,
      campaignId: row.campaign_id,
      identitySlug: row.identity_slug,
      ready: row.status === 'ready' && row.campaign_status === 'active',
      maxNewLeadsPerDay: settings.max_new_leads_per_day,
      emailsPerDay: row.kind === 'auto' ? row.emails_per_day : null,
    };
  });
}

/**
 * Follow-up steps expected on each day: for every sent step k, the campaign's
 * step k+1 delay lands it on a date. An estimate — Smartlead may shift it — and
 * the reason the forecast is labelled a model.
 */
async function loadFollowupsDue(
  today: string,
  horizonDays: number,
): Promise<Map<string, number>> {
  const until = addCalendarDays(today, horizonDays);
  const { rows } = await dbQuery<{ identity_slug: IdentitySlug; due_date: string; n: string }>(
    `WITH steps AS (
       SELECT lane.identity_slug,
              es.sequence_number,
              (es.sent_at AT TIME ZONE 'America/New_York')::date AS sent_on,
              c.delivery_settings,
              c.follow_up_enabled
         FROM outreach.email_sends es
         JOIN outreach.campaign_lanes lane ON lane.id = es.lane_id
         JOIN outreach.campaigns c ON c.id = lane.campaign_id
        WHERE es.status = 'sent'
          AND es.replied_at IS NULL
          AND es.bounced_at IS NULL
          AND es.unsubscribed_at IS NULL
          AND es.reply_suppressed_at IS NULL
          AND es.sent_at >= now() - interval '60 days'
     )
     SELECT identity_slug,
            (sent_on + (step ->> 'delay_days')::int)::text AS due_date,
            count(*)::text AS n
       FROM steps
       CROSS JOIN LATERAL jsonb_array_elements(
              coalesce(delivery_settings -> 'follow_ups', '[]'::jsonb)) AS step
      WHERE follow_up_enabled
        AND (step ->> 'step')::int = sequence_number + 1
        AND (sent_on + (step ->> 'delay_days')::int) BETWEEN $1::date AND $2::date
      GROUP BY identity_slug, due_date`,
    [today, until],
  );
  return new Map(rows.map((row) => [key(row.identity_slug, row.due_date), Number(row.n)]));
}

/** Rows already handed to Smartlead for a day but not yet reported sent. */
async function loadCarryOver(today: string): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ identity_slug: IdentitySlug; handoff_date: string; n: string }>(
    `SELECT lane.identity_slug, q.handoff_date::text, count(*)::text AS n
       FROM outreach.email_send_queue q
       JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
      WHERE q.status IN ('handing_off', 'handed_off')
        AND q.handoff_date >= $1::date
      GROUP BY lane.identity_slug, q.handoff_date`,
    [today],
  );
  return new Map(rows.map((row) => [key(row.identity_slug, row.handoff_date), Number(row.n)]));
}

export function daysLeftInCycle(today: string, billingDay = 1): number {
  const [year, month, day] = today.split('-').map(Number);
  const anchor = Math.min(Math.max(1, billingDay), 28);
  const nextCycle = day >= anchor
    ? new Date(Date.UTC(year, month, anchor))
    : new Date(Date.UTC(year, month - 1, anchor));
  const todayUtc = Date.UTC(year, month - 1, day);
  return Math.max(1, Math.round((nextCycle.getTime() - todayUtc) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export type HandoffPayload = {
  campaignId: string;
  identitySlug: IdentitySlug;
  handoffDate?: string;
  queueIds?: string[];
};

export type HandoffResult = {
  laneId: string | null;
  attempted: number;
  handedOff: number;
  heldForApproval: number;
  failed: number;
  errors: string[];
};

type HandoffCandidate = {
  queueId: string;
  itemId: string;
  toEmail: string;
  recipientName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  state: string;
  reviewStatus: string;
  retrySuggested: boolean;
};

/**
 * Pushes one lane's leads for one day. Only rows this call moved to
 * `handing_off` are touched, so a concurrent run or a retry cannot double-send.
 */
export async function executeHandoffBatch(
  payload: HandoffPayload,
  options: { adapter?: SmartleadAdapter } = {},
): Promise<HandoffResult> {
  const adapter = options.adapter ?? smartleadAdapter;
  const lanes = await listLanesForCampaign(payload.campaignId);
  const lane = lanes.find((row) => row.identity_slug === payload.identitySlug);

  const result: HandoffResult = {
    laneId: lane?.id ?? null,
    attempted: 0,
    handedOff: 0,
    heldForApproval: 0,
    failed: 0,
    errors: [],
  };

  if (!lane || lane.status !== 'ready' || lane.smartlead_campaign_id === null) {
    await markWaiting(payload, 'lane_not_ready');
    result.errors.push('lane_not_ready');
    return result;
  }

  const settings = resolveDeliverySettings(
    (await getCampaignDeliverySettings(payload.campaignId)) ?? {},
  );

  // Claim: flip exactly the rows we intend to send, and read them back.
  const claimed = await claimRows(payload, lane.id);
  result.attempted = claimed.length;
  if (!claimed.length) return result;

  const sendable: HandoffCandidate[] = [];
  const held: string[] = [];
  for (const candidate of claimed) {
    const ready = isReadyForBulkSend({
      state: candidate.state,
      retrySuggested: candidate.retrySuggested,
      sendStatus: 'unsent',
      reviewStatus: candidate.reviewStatus,
      requireApproval: settings.require_approval,
    });
    if (ready) sendable.push(candidate);
    else held.push(candidate.queueId);
  }

  if (held.length) {
    await releaseRows(held, 'awaiting_approval');
    result.heldForApproval = held.length;
  }
  if (!sendable.length) return result;

  for (const batch of chunkRows(sendable, SMARTLEAD_MAX_LEADS_PER_REQUEST)) {
    try {
      const leads = batch.map((candidate) => toLeadInput(candidate, payload, lane));
      const { leadIds } = await adapter.handoffLeads(lane.smartlead_campaign_id, leads);
      const resolved = await resolveLeadIds(adapter, lane, batch, leadIds);

      for (const candidate of batch) {
        const leadId = resolved.get(candidate.toEmail.toLowerCase()) ?? null;
        await markHandedOff(candidate.queueId, lane.id, leadId);
        result.handedOff += 1;
      }
    } catch (error) {
      // Put the batch back so the retry re-claims it, then let the handler map
      // the error to a retry or a permanent failure.
      await releaseRows(batch.map((candidate) => candidate.queueId), null);
      result.failed += batch.length;
      result.errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  return result;
}

function toLeadInput(
  candidate: HandoffCandidate,
  payload: HandoffPayload,
  lane: CampaignLane,
): SmartleadLeadInput {
  const bodyHtml = candidate.bodyHtml
    ? toCustomBodyHtml(candidate.bodyHtml)
    : textToCustomBodyHtml(candidate.bodyText);

  assertCustomFieldLength('custom_subject', candidate.subject);
  assertCustomFieldLength('custom_body', bodyHtml);

  return {
    email: candidate.toEmail,
    first_name: candidate.firstName ?? undefined,
    last_name: candidate.lastName ?? undefined,
    company_name: candidate.companyName ?? undefined,
    custom_fields: {
      custom_subject: candidate.subject,
      custom_body: bodyHtml,
      hub_item_id: candidate.itemId,
      hub_campaign_id: payload.campaignId,
      hub_queue_id: candidate.queueId,
      hub_lane_id: lane.id,
    },
  };
}

/**
 * Smartlead's import returns counts, not ids (S0), so anything the response did
 * not echo is looked up by address. A lead with no id still counts as handed
 * off — the webhook can find it by `hub_queue_id`.
 */
async function resolveLeadIds(
  adapter: SmartleadAdapter,
  lane: CampaignLane,
  batch: HandoffCandidate[],
  echoed: Map<string, number>,
): Promise<Map<string, number>> {
  const resolved = new Map(echoed);
  for (const candidate of batch) {
    const email = candidate.toEmail.toLowerCase();
    if (resolved.has(email)) continue;
    try {
      const found = await adapter.findLeadByEmail(email);
      if (found?.id) resolved.set(email, found.id);
    } catch {
      // Id resolution is best effort; the webhook has other ways in.
    }
  }
  void lane;
  return resolved;
}

async function claimRows(
  payload: HandoffPayload,
  laneId: string,
): Promise<HandoffCandidate[]> {
  const byIds = Array.isArray(payload.queueIds) && payload.queueIds.length > 0;
  const { rows } = await dbQuery<{
    queue_id: string;
    item_id: string;
    to_email: string;
    recipient_name: string | null;
    subject: string;
    body_text: string;
    body_html: string | null;
    generation_mode: string | null;
    lint_result: unknown;
    state: string;
    review_status: string;
    company_name: string | null;
  }>(
    `WITH claimed AS (
       UPDATE outreach.email_send_queue q
          SET status = 'handing_off',
              lane_id = $1,
              handoff_attempts = q.handoff_attempts + 1,
              waiting_reason = NULL,
              updated_at = now()
        WHERE q.id IN (
                SELECT id
                  FROM outreach.email_send_queue
                 WHERE status = 'queued'
                   AND campaign_id = $2
                   AND (${byIds ? 'id = ANY($3::uuid[])' : 'handoff_date = $3::date'})
                 ORDER BY created_at ASC
                 FOR UPDATE SKIP LOCKED
              )
        RETURNING q.id, q.drafting_item_id, q.to_email, q.recipient_name
     )
     SELECT claimed.id::text AS queue_id,
            claimed.drafting_item_id::text AS item_id,
            coalesce(
              nullif(trim(i.input_overrides ->> 'email'), ''),
              nullif(trim(i.input_snapshot #>> '{lead,email}'), ''),
              claimed.to_email
            ) AS to_email,
            coalesce(claimed.recipient_name,
                     nullif(trim(i.input_snapshot #>> '{lead,fullName}'), '')) AS recipient_name,
            d.subject,
            d.body_text,
            d.body_html,
            d.generation_mode,
            d.lint_result,
            i.state,
            i.review_status,
            nullif(trim(i.input_snapshot #>> '{company,name}'), '') AS company_name
       FROM claimed
       JOIN outreach.drafting_items i ON i.id = claimed.drafting_item_id
       LEFT JOIN outreach.email_drafts d ON d.drafting_item_id = i.id`,
    byIds
      ? [laneId, payload.campaignId, payload.queueIds]
      : [laneId, payload.campaignId, payload.handoffDate],
  );

  return rows
    .filter((row) => row.subject && (row.body_text || row.body_html) && row.to_email)
    .map((row) => ({
      queueId: row.queue_id,
      itemId: row.item_id,
      toEmail: row.to_email,
      recipientName: row.recipient_name,
      firstName: splitName(row.recipient_name).first,
      lastName: splitName(row.recipient_name).last,
      companyName: row.company_name,
      subject: row.subject,
      bodyText: row.body_text ?? '',
      bodyHtml: row.body_html,
      state: row.state,
      reviewStatus: row.review_status,
      // Template drafts are never lint-flagged; AI drafts inherit the same
      // hard-lint rule the review list uses.
      retrySuggested: row.generation_mode === 'template'
        ? false
        : hasRetrySuggestedLint(parseLintResult(row.lint_result)),
    }));
}

function parseLintResult(raw: unknown): LintResult {
  const value = (raw ?? {}) as Partial<LintResult>;
  return {
    hard: Array.isArray(value.hard) ? value.hard : [],
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
  };
}

function splitName(fullName: string | null): { first: string | null; last: string | null } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

async function markHandedOff(
  queueId: string,
  laneId: string,
  smartleadLeadId: number | null,
): Promise<void> {
  await dbQuery(
    `UPDATE outreach.email_send_queue
        SET status = 'handed_off',
            lane_id = $2,
            smartlead_lead_id = $3,
            handed_off_at = now(),
            error_message = NULL,
            updated_at = now()
      WHERE id = $1 AND status = 'handing_off'`,
    [queueId, laneId, smartleadLeadId],
  );
}

async function releaseRows(queueIds: string[], waitingReason: string | null): Promise<void> {
  if (!queueIds.length) return;
  await dbQuery(
    `UPDATE outreach.email_send_queue
        SET status = 'queued', waiting_reason = $2, updated_at = now()
      WHERE id = ANY($1::uuid[]) AND status = 'handing_off'`,
    [queueIds, waitingReason],
  );
}

async function markWaiting(payload: HandoffPayload, reason: WaitingReason): Promise<void> {
  const params: unknown[] = [payload.campaignId, reason];
  let filter = '';
  if (payload.queueIds?.length) {
    params.push(payload.queueIds);
    filter = ` AND id = ANY($3::uuid[])`;
  } else if (payload.handoffDate) {
    params.push(payload.handoffDate);
    filter = ` AND handoff_date = $3::date`;
  }
  await dbQuery(
    `UPDATE outreach.email_send_queue
        SET waiting_reason = $2, updated_at = now()
      WHERE campaign_id = $1 AND status = 'queued'${filter}`,
    params,
  );
}

async function getCampaignDeliverySettings(campaignId: string): Promise<unknown> {
  const { rows } = await dbQuery<{ delivery_settings: unknown }>(
    'SELECT delivery_settings FROM outreach.campaigns WHERE id = $1',
    [campaignId],
  );
  return rows[0]?.delivery_settings ?? null;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += size) out.push(rows.slice(at, at + size));
  return out;
}

// ---------------------------------------------------------------------------
// Per-lead corrections
// ---------------------------------------------------------------------------

export type LeadOp = 'delete' | 'pause' | 'resume' | 'block';

/**
 * Applies one correction to a lead already inside Smartlead. `block` also adds
 * the address to the global block list so no other campaign picks it up.
 */
export async function executeLeadOp(
  op: LeadOp,
  queueId: string,
  options: { adapter?: SmartleadAdapter } = {},
): Promise<{ op: LeadOp; applied: boolean; reason?: string }> {
  const adapter = options.adapter ?? smartleadAdapter;
  const { rows } = await dbQuery<{
    lane_id: string | null;
    smartlead_lead_id: string | null;
    to_email: string;
  }>(
    `SELECT lane_id::text, smartlead_lead_id::text, to_email
       FROM outreach.email_send_queue WHERE id = $1`,
    [queueId],
  );
  const row = rows[0];
  if (!row) return { op, applied: false, reason: 'queue_row_missing' };

  if (op === 'block') {
    await adapter.addToBlockList([row.to_email]);
    return { op, applied: true };
  }

  if (!row.lane_id || !row.smartlead_lead_id) {
    return { op, applied: false, reason: 'lead_not_in_smartlead' };
  }
  const lane = await getLaneById(row.lane_id);
  if (!lane?.smartlead_campaign_id) return { op, applied: false, reason: 'lane_missing' };

  const leadId = Number(row.smartlead_lead_id);
  if (op === 'delete') await adapter.deleteLead(lane.smartlead_campaign_id, leadId);
  if (op === 'pause') await adapter.pauseLead(lane.smartlead_campaign_id, leadId);
  if (op === 'resume') await adapter.resumeLead(lane.smartlead_campaign_id, leadId);
  return { op, applied: true };
}

/**
 * Reconcile's repair for rows stuck mid-handoff: if Smartlead already has the
 * lead the row is completed, otherwise it goes back in the queue.
 */
export async function reclaimStaleHandoffs(
  olderThanMinutes = 15,
  options: { adapter?: SmartleadAdapter } = {},
): Promise<{ completed: number; requeued: number }> {
  const adapter = options.adapter ?? smartleadAdapter;
  const { rows } = await dbQuery<{ id: string; lane_id: string | null; to_email: string }>(
    `SELECT id::text, lane_id::text, to_email
       FROM outreach.email_send_queue
      WHERE status = 'handing_off'
        AND updated_at < now() - make_interval(mins => $1)
      LIMIT 200`,
    [olderThanMinutes],
  );

  let completed = 0;
  let requeued = 0;
  for (const row of rows) {
    let leadId: number | null = null;
    try {
      leadId = (await adapter.findLeadByEmail(row.to_email))?.id ?? null;
    } catch {
      leadId = null;
    }
    if (leadId !== null && row.lane_id) {
      await markHandedOff(row.id, row.lane_id, leadId);
      completed += 1;
    } else {
      await releaseRows([row.id], null);
      requeued += 1;
    }
  }
  return { completed, requeued };
}
