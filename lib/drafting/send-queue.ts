/**
 * The send queue, rebuilt around handoff rather than scheduling.
 *
 * The hub no longer picks a minute or a mailbox. It decides which drafts go to
 * Smartlead on which day (`handoff_date`), hands them over in a batch, and
 * reads back what Smartlead actually did. `scheduled_for` and `schedule_date`
 * survive only on historical rows; nothing writes them.
 *
 * Everything the Queue board shows for a future day is a forecast — a model of
 * what Smartlead will choose to do, never a promise. See FORECAST_NOTE.
 */
import type { PoolClient } from 'pg';

import type { SenderIdentitySlug } from '@/lib/agentmail-inboxes';
import {
  EMAIL_SEND_QUEUE_STATUSES,
  LIVE_QUEUE_STATUSES,
  type EmailSendQueueStatus,
  type IdentitySlug,
  type WaitingReason,
} from '@/lib/delivery-states';
import { dbQuery, dbTransaction } from '@/lib/db';
import {
  addCalendarDays,
  formatNyDate,
  formatNyDateLabel,
  isNyCalendarWeekend,
  sendQueueBoardWindow,
  SEND_QUEUE_TIMEZONE,
} from '@/lib/drafting/send-queue-schedule';
import {
  FORECAST_NOTE,
  forecastForLane,
  identityCapacity,
  monthlyCeiling,
  plannedPerMailbox,
  stageCap,
  varianceFlag,
  type CapacityInbox,
} from '@/lib/inboxes/capacity';
import { toCapacityInbox } from '@/lib/inboxes/lifecycle';
import { listInboxes } from '@/lib/inboxes/repository';
import { DEFAULT_STAGE_PLAN } from '@/lib/inboxes/stage-plan';
import { enqueueWork } from '@/lib/orchestration/repository';
import {
  DEFAULT_PLAN_LIMITS,
  getOrgSettings,
  type PlanLimits,
  type UsageCache,
} from '@/lib/org-settings';
import { daysLeftInCycle, replanHandoffs } from '@/lib/smartlead/handoff';

export {
  addCalendarDays,
  formatNyDate,
  formatNyDateLabel,
  isNyCalendarWeekend,
  sendQueueBoardWindow,
  SEND_QUEUE_TIMEZONE,
};
export { FORECAST_NOTE };
export { EMAIL_SEND_QUEUE_STATUSES, type EmailSendQueueStatus };

export type EmailSendQueueRow = {
  id: string;
  owner_id: string;
  drafting_item_id: string;
  campaign_id: string;
  status: EmailSendQueueStatus;
  handoff_date: string | null;
  handed_off_at: string | null;
  lane_id: string | null;
  smartlead_lead_id: string | null;
  handoff_attempts: number;
  waiting_reason: WaitingReason | null;
  to_email: string;
  subject: string;
  recipient_name: string | null;
  orchestration_job_id: string | null;
  error_message: string | null;
  sender_identity_id: string | null;
  sender_inbox_id: string | null;
  from_email: string | null;
  created_at: string;
  updated_at: string;
};

/** Where a row stands with the delivery provider, for the board's status chip. */
export type DeliveryStatus =
  | 'waiting'
  | 'scheduled'
  | 'handing_off'
  | 'with_smartlead'
  | 'sent'
  | 'bounced'
  | 'replied'
  | 'cancelled'
  | 'failed';

export type QueueListItem = EmailSendQueueRow & {
  campaign_name: string;
  queue_color: string | null;
  identity_slug: SenderIdentitySlug | null;
  inbox_email: string | null;
  lane_status: string | null;
  delivery_status: DeliveryStatus;
  /** NY calendar date the send actually went out, when it has. */
  sent_date?: string | null;
  overdue: boolean;
};

export type QueueMailboxDayStat = {
  inbox_id: string;
  email: string;
  identity_slug: IdentitySlug;
  stage: string;
  cap: number;
  /** Estimate: Smartlead picks the sender, this splits by cap. */
  planned: number;
  actual: number;
  followups: number;
  variance_flag: boolean;
};

export type QueueCampaignDayStat = {
  campaign_id: string;
  name: string;
  queue_color: string | null;
  identity_slug: IdentitySlug;
  lane_status: string | null;
  planned: number;
  handed_off: number;
  forecast: number;
  actual: number;
  waiting_reason: WaitingReason | null;
};

export type QueueDayTotals = {
  queued_unassigned: number;
  planned: number;
  handed_off: number;
  forecast: number;
  actual: number;
  followups: number;
  capacity: number;
};

export type QueueDayBucket = {
  date: string;
  totals: QueueDayTotals;
  mailboxes: QueueMailboxDayStat[];
  campaigns: QueueCampaignDayStat[];
  items: QueueListItem[];
  /** Kept so the homepage week roll-up keeps working against the same shape. */
  used: number;
  capacity: number;
  remaining: number;
  reserved: number;
  sent_count: number;
  queued_count: number;
  over_cap: boolean;
};

export type QueueMonthly = {
  limit: number;
  used: number;
  warmup_used: number;
  remaining: number;
  days_left: number;
  billing_day: number;
  /** True when the monthly allowance, not mailbox capacity, is the binding limit. */
  ceiling_binding: boolean;
};

export type SendQueueBoard = {
  today: string;
  from: string;
  to: string;
  days: QueueDayBucket[];
  monthly: QueueMonthly;
  forecast_note: string;
  identities: IdentitySlug[];
  inboxes: Array<{ id: string; email: string; identity_slug: IdentitySlug; stage: string }>;
};

export type ActiveQueueInfo = {
  queue_id: string;
  handoff_date: string | null;
  status: EmailSendQueueStatus;
};

const QUEUE_ROW_SELECT = `
  id::text, owner_id::text, drafting_item_id::text, campaign_id::text, status,
  handoff_date::text, handed_off_at::text, lane_id::text, smartlead_lead_id::text,
  handoff_attempts, waiting_reason, to_email, subject, recipient_name,
  orchestration_job_id::text, error_message, sender_identity_id::text,
  sender_inbox_id::text, from_email, created_at::text, updated_at::text
`;

// ---------------------------------------------------------------------------
// Writers used by the drafting pipeline
// ---------------------------------------------------------------------------

export type EnqueueSendInput = {
  ownerId: string;
  draftingItemId: string;
  campaignId: string;
  toEmail: string;
  subject: string;
  recipientName?: string | null;
  senderIdentityId?: string | null;
  senderInboxId?: string | null;
  fromEmail?: string | null;
};

/**
 * Approval queues a draft; it does not send it. The row lands with no handoff
 * date and the planner assigns one under the current capacity model.
 */
export async function enqueueOverflowBatch(
  inputs: EnqueueSendInput[],
): Promise<EmailSendQueueRow[]> {
  if (!inputs.length) return [];

  const rows = await dbTransaction(async (client) => {
    const inserted: EmailSendQueueRow[] = [];
    for (const input of inputs) {
      const { rows: result } = await client.query<EmailSendQueueRow>(
        `INSERT INTO outreach.email_send_queue (
           owner_id, drafting_item_id, campaign_id, status,
           handoff_date, scheduled_for, schedule_date,
           to_email, subject, recipient_name,
           sender_identity_id, sender_inbox_id, from_email
         )
         SELECT $1, $2, $3, 'queued', NULL, NULL, NULL, $4, $5, $6, $7, $8, $9
          WHERE NOT EXISTS (
                  SELECT 1 FROM outreach.email_send_queue
                   WHERE drafting_item_id = $2
                     AND status IN ('queued', 'handing_off', 'handed_off')
                )
         RETURNING ${QUEUE_ROW_SELECT}`,
        [
          input.ownerId,
          input.draftingItemId,
          input.campaignId,
          input.toEmail,
          input.subject,
          input.recipientName ?? null,
          input.senderIdentityId ?? null,
          input.senderInboxId ?? null,
          input.fromEmail ?? null,
        ],
      );
      if (result[0]) inserted.push(result[0]);
    }
    return inserted;
  });

  // Plan immediately so the board shows a date rather than an empty cell.
  if (rows.length) await replanHandoffs().catch(() => undefined);
  return rows;
}

export async function enqueueOverflowSend(input: EnqueueSendInput): Promise<EmailSendQueueRow | null> {
  const [row] = await enqueueOverflowBatch([input]);
  return row ?? null;
}

/** Marks the queue row complete once Smartlead reports the step-1 send. */
export async function markQueueItemSent(
  queueId: string,
  payload: { subject: string; toEmail: string; recipientName: string },
): Promise<void> {
  await dbQuery(
    `UPDATE outreach.email_send_queue
        SET status = 'sent',
            subject = $2,
            to_email = $3,
            recipient_name = $4,
            error_message = NULL,
            waiting_reason = NULL,
            updated_at = now()
      WHERE id = $1
        AND status IN ('queued', 'handing_off', 'handed_off', 'failed')`,
    [queueId, payload.subject, payload.toEmail, payload.recipientName],
  );
}

/**
 * Records an outbound step. The unique index on
 * `(drafting_item_id, sequence_number) WHERE status='sent'` makes a repeat a
 * no-op, so webhook replays and the reconcile backfill are both safe.
 */
export async function recordEmailSend(input: {
  itemId: string;
  status: 'sent' | 'failed';
  fromEmail: string;
  toEmail: string;
  subject: string;
  provider?: string;
  sequenceNumber?: number;
  laneId?: string | null;
  providerMessageId?: string | null;
  smartleadLeadId?: number | null;
  smartleadEmailAccountId?: number | null;
  senderInboxId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const values = [
    input.itemId,
    input.provider ?? 'smartlead',
    input.providerMessageId ?? null,
    input.laneId ?? null,
    input.senderInboxId ?? null,
    input.status,
    input.fromEmail,
    input.toEmail,
    input.subject,
    input.errorMessage ?? null,
    input.status === 'sent' ? new Date().toISOString() : null,
    input.sequenceNumber ?? 1,
    input.smartleadLeadId ?? null,
    input.smartleadEmailAccountId ?? null,
  ];
  const insertSql = `INSERT INTO outreach.email_sends (
       drafting_item_id, provider, provider_message_id, lane_id, sender_inbox_id, status,
       from_email, to_email, subject, error_message, sent_at, sequence_number,
       smartlead_lead_id, smartlead_email_account_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;
  if (input.status === 'sent') {
    await dbQuery(
      `${insertSql}
       ON CONFLICT (drafting_item_id, sequence_number) WHERE (status = 'sent') DO NOTHING`,
      values,
    );
    return;
  }
  await dbQuery(insertSql, values);
}

/** True once the lead has been contacted — step 1 specifically. */
export async function itemAlreadySent(itemId: string): Promise<boolean> {
  const { rows } = await dbQuery<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM outreach.email_sends
        WHERE drafting_item_id = $1 AND status = 'sent' AND sequence_number = 1
     ) AS ok`,
    [itemId],
  );
  return Boolean(rows[0]?.ok);
}

export async function loadActiveQueueByItemIds(
  itemIds: string[],
): Promise<Map<string, ActiveQueueInfo>> {
  if (!itemIds.length) return new Map();
  const { rows } = await dbQuery<{
    drafting_item_id: string;
    queue_id: string;
    handoff_date: string | null;
    status: EmailSendQueueStatus;
  }>(
    `SELECT DISTINCT ON (drafting_item_id)
            drafting_item_id::text, id::text AS queue_id, handoff_date::text, status
       FROM outreach.email_send_queue
      WHERE drafting_item_id = ANY($1::uuid[])
        AND status = ANY($2::text[])
      ORDER BY drafting_item_id, updated_at DESC`,
    [itemIds, [...LIVE_QUEUE_STATUSES]],
  );
  return new Map(
    rows.map((row) => [
      row.drafting_item_id,
      { queue_id: row.queue_id, handoff_date: row.handoff_date, status: row.status },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Capacity snapshot
// ---------------------------------------------------------------------------

type CapacitySnapshot = {
  inboxes: CapacityInbox[];
  byIdentity: Map<IdentitySlug, CapacityInbox[]>;
  meta: Map<string, { email: string; stage: string; identitySlug: IdentitySlug }>;
  monthly: QueueMonthly;
};

async function loadCapacity(today: string): Promise<CapacitySnapshot> {
  const settings = await getOrgSettings([
    'stage_plan.default',
    'smartlead.plan_limits',
    'smartlead.usage_cache',
    'smartlead.billing_day',
  ]);
  const orgPlan = settings.get('stage_plan.default') ?? DEFAULT_STAGE_PLAN;
  const limits = (settings.get('smartlead.plan_limits') ?? DEFAULT_PLAN_LIMITS) as PlanLimits;
  const usage = (settings.get('smartlead.usage_cache') ?? {}) as UsageCache;
  const billingDay = Number(settings.get('smartlead.billing_day') ?? 1);

  const rows = await listInboxes({ enabledOnly: true });
  const inboxes: CapacityInbox[] = [];
  const byIdentity = new Map<IdentitySlug, CapacityInbox[]>();
  const meta = new Map<string, { email: string; stage: string; identitySlug: IdentitySlug }>();

  for (const row of rows) {
    const inbox = await toCapacityInbox(row, orgPlan);
    inboxes.push(inbox);
    byIdentity.set(row.identity_slug, [...(byIdentity.get(row.identity_slug) ?? []), inbox]);
    meta.set(row.id, {
      email: row.email,
      stage: row.lifecycle_stage,
      identitySlug: row.identity_slug,
    });
  }

  const daysLeft = daysLeftInCycle(today, billingDay);
  const used = usage.sent ?? 0;
  const warmupUsed = usage.warmup_sent ?? 0;
  const limit = limits.emails_per_month ?? 0;
  const ceiling = monthlyCeiling({ limit, used, warmupUsed, daysLeft });
  const totalCapacityToday = inboxes.reduce((sum, inbox) => sum + stageCap(inbox, today), 0);

  return {
    inboxes,
    byIdentity,
    meta,
    monthly: {
      limit,
      used,
      warmup_used: warmupUsed,
      remaining: Math.max(0, limit - used - warmupUsed),
      days_left: daysLeft,
      billing_day: billingDay,
      ceiling_binding: Number.isFinite(ceiling) && ceiling < totalCapacityToday,
    },
  };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export async function listSendQueue(input: {
  ownerId?: string;
  from: string;
  to: string;
  campaignId?: string | null;
  identitySlug?: SenderIdentitySlug | null;
  inboxEmail?: string | null;
}): Promise<SendQueueBoard> {
  const today = formatNyDate();
  const capacity = await loadCapacity(today);

  const params: unknown[] = [input.from, input.to];
  const clauses: string[] = [];
  if (input.campaignId) {
    params.push(input.campaignId);
    clauses.push(`q.campaign_id = $${params.length}::uuid`);
  }
  if (input.identitySlug) {
    params.push(input.identitySlug);
    clauses.push(`coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') = $${params.length}`);
  }
  const filter = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

  const { rows } = await dbQuery<QueueListItem & { sent_at: string | null; bounced_at: string | null; replied_at: string | null }>(
    `SELECT ${QUEUE_ROW_SELECT.split(',').map((col) => `q.${col.trim()}`).join(', ')},
            c.name AS campaign_name,
            c.queue_color,
            coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') AS identity_slug,
            lane.status AS lane_status,
            ib.email AS inbox_email,
            es.sent_at::text,
            es.bounced_at::text,
            es.replied_at::text,
            (es.sent_at AT TIME ZONE '${SEND_QUEUE_TIMEZONE}')::date::text AS sent_date
       FROM outreach.email_send_queue q
       JOIN outreach.campaigns c ON c.id = q.campaign_id
       LEFT JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
       LEFT JOIN outreach.sender_inboxes ib ON ib.id = q.sender_inbox_id
       LEFT JOIN LATERAL (
         SELECT sent_at, bounced_at, replied_at
           FROM outreach.email_sends
          WHERE drafting_item_id = q.drafting_item_id AND sequence_number = 1
          ORDER BY created_at DESC
          LIMIT 1
       ) es ON true
      WHERE (
              (q.handoff_date IS NOT NULL AND q.handoff_date BETWEEN $1::date AND $2::date)
           OR (q.handoff_date IS NULL AND q.status = 'queued')
           OR ((es.sent_at AT TIME ZONE '${SEND_QUEUE_TIMEZONE}')::date BETWEEN $1::date AND $2::date)
            )
        ${filter}
      ORDER BY q.handoff_date NULLS FIRST, q.created_at ASC`,
    params,
  );

  const items: QueueListItem[] = rows
    .filter((row) => !input.inboxEmail || row.inbox_email === input.inboxEmail)
    .map((row) => ({
      ...row,
      delivery_status: deliveryStatusFor(row),
      overdue: isOverdue(row, today),
    }));

  const days = await buildDays({
    from: input.from,
    to: input.to,
    today,
    items,
    capacity,
  });

  return {
    today,
    from: input.from,
    to: input.to,
    days,
    monthly: capacity.monthly,
    forecast_note: FORECAST_NOTE,
    identities: [...capacity.byIdentity.keys()],
    inboxes: [...capacity.meta.entries()].map(([id, meta]) => ({
      id,
      email: meta.email,
      identity_slug: meta.identitySlug,
      stage: meta.stage,
    })),
  };
}

function deliveryStatusFor(row: {
  status: EmailSendQueueStatus;
  handoff_date: string | null;
  bounced_at?: string | null;
  replied_at?: string | null;
}): DeliveryStatus {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'sent') {
    if (row.bounced_at) return 'bounced';
    if (row.replied_at) return 'replied';
    return 'sent';
  }
  if (row.status === 'handed_off') return 'with_smartlead';
  if (row.status === 'handing_off') return 'handing_off';
  return row.handoff_date ? 'scheduled' : 'waiting';
}

/**
 * A row is overdue when its handoff day has passed and it is still queued.
 * Rows with Smartlead are never overdue — Smartlead owns the timing from there.
 */
function isOverdue(row: { status: EmailSendQueueStatus; handoff_date: string | null }, today: string): boolean {
  return row.status === 'queued' && Boolean(row.handoff_date) && row.handoff_date! < today;
}

async function buildDays(input: {
  from: string;
  to: string;
  today: string;
  items: QueueListItem[];
  capacity: CapacitySnapshot;
}): Promise<QueueDayBucket[]> {
  const actuals = await actualsByDay(input.from, input.to);
  const followups = await followupsByDay(input.from, input.to);
  const variance = await varianceByInbox(input.from, input.to);

  const days: QueueDayBucket[] = [];
  for (let date = input.from; date <= input.to; date = addCalendarDays(date, 1)) {
    const dayItems = input.items.filter((item) => rowBelongsToDay(item, date));
    const isToday = date === input.today;

    const mailboxes: QueueMailboxDayStat[] = [];
    let capacityTotal = 0;

    for (const [identitySlug, inboxes] of input.capacity.byIdentity) {
      const identityPlanned = dayItems.filter(
        (item) => item.identity_slug === identitySlug && item.status !== 'cancelled',
      ).length;
      const planned = plannedPerMailbox(inboxes, date, identityPlanned);
      const followupsForIdentity = followups.get(`${identitySlug}:${date}`) ?? 0;
      capacityTotal += identityCapacity({ inboxes, followupsDue: followupsForIdentity }, date);

      for (const inbox of inboxes) {
        const meta = input.capacity.meta.get(inbox.id)!;
        mailboxes.push({
          inbox_id: inbox.id,
          email: meta.email,
          identity_slug: identitySlug,
          stage: meta.stage,
          cap: stageCap(inbox, date),
          planned: planned.get(inbox.id) ?? 0,
          actual: actuals.get(`${inbox.id}:${date}`) ?? 0,
          followups: actuals.get(`followup:${inbox.id}:${date}`) ?? 0,
          variance_flag: variance.get(inbox.id) ?? false,
        });
      }
    }

    const campaigns = buildCampaignStats(dayItems, date, isToday, input.capacity);
    const totals: QueueDayTotals = {
      queued_unassigned: input.items.filter(
        (item) => item.status === 'queued' && !item.handoff_date,
      ).length,
      planned: dayItems.filter((item) => item.status !== 'cancelled').length,
      handed_off: dayItems.filter(
        (item) => item.status === 'handed_off' || item.status === 'handing_off',
      ).length,
      forecast: campaigns.reduce((sum, row) => sum + row.forecast, 0),
      actual: mailboxes.reduce((sum, row) => sum + row.actual, 0),
      followups: mailboxes.reduce((sum, row) => sum + row.followups, 0),
      capacity: capacityTotal,
    };

    days.push({
      date,
      totals,
      mailboxes,
      campaigns,
      items: dayItems,
      // Legacy fields the homepage week roll-up reads.
      used: totals.planned,
      capacity: totals.capacity,
      remaining: Math.max(0, totals.capacity - totals.planned),
      reserved: 0,
      sent_count: totals.actual,
      queued_count: dayItems.filter((item) => item.status === 'queued').length,
      over_cap: totals.planned > totals.capacity,
    });
  }
  return days;
}

function rowBelongsToDay(item: QueueListItem, date: string): boolean {
  if (item.status === 'sent') return item.sent_date === date;
  return item.handoff_date === date;
}

function buildCampaignStats(
  dayItems: QueueListItem[],
  date: string,
  isToday: boolean,
  capacity: CapacitySnapshot,
): QueueCampaignDayStat[] {
  const byCampaign = new Map<string, QueueListItem[]>();
  for (const item of dayItems) {
    byCampaign.set(item.campaign_id, [...(byCampaign.get(item.campaign_id) ?? []), item]);
  }

  return [...byCampaign.entries()].map(([campaignId, items]) => {
    const identitySlug = (items[0].identity_slug ?? 'lucas') as IdentitySlug;
    const inboxes = capacity.byIdentity.get(identitySlug) ?? [];
    const laneCap = inboxes.reduce((sum, inbox) => sum + stageCap(inbox, date), 0);
    const actual = items.filter((item) => item.status === 'sent').length;
    const demand = items.filter((item) => item.status !== 'cancelled' && item.status !== 'sent').length;

    return {
      campaign_id: campaignId,
      name: items[0].campaign_name,
      queue_color: items[0].queue_color,
      identity_slug: identitySlug,
      lane_status: items[0].lane_status,
      planned: items.filter((item) => item.status !== 'cancelled').length,
      handed_off: items.filter(
        (item) => item.status === 'handed_off' || item.status === 'handing_off',
      ).length,
      forecast: forecastForLane({
        laneCapacityToday: laneCap,
        demand,
        actualToday: actual,
        isToday,
      }),
      actual,
      waiting_reason: items.find((item) => item.waiting_reason)?.waiting_reason ?? null,
    };
  });
}

/** Actual sends per mailbox per day, attributed by Smartlead's account id. */
async function actualsByDay(from: string, to: string): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ inbox_id: string; day: string; step: number; n: string }>(
    `SELECT ib.id::text AS inbox_id,
            (es.sent_at AT TIME ZONE $3)::date::text AS day,
            CASE WHEN es.sequence_number = 1 THEN 1 ELSE 2 END AS step,
            count(*)::text AS n
       FROM outreach.email_sends es
       JOIN outreach.sender_inboxes ib
         ON ib.smartlead_email_account_id = es.smartlead_email_account_id
      WHERE es.status = 'sent'
        AND (es.sent_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
      GROUP BY 1, 2, 3`,
    [from, to, SEND_QUEUE_TIMEZONE],
  );
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = row.step === 1 ? `${row.inbox_id}:${row.day}` : `followup:${row.inbox_id}:${row.day}`;
    out.set(key, (out.get(key) ?? 0) + Number(row.n));
  }
  return out;
}

/** Follow-ups the model expects per identity per day. */
async function followupsByDay(from: string, to: string): Promise<Map<string, number>> {
  const { rows } = await dbQuery<{ identity_slug: string; due_date: string; n: string }>(
    `WITH steps AS (
       SELECT lane.identity_slug,
              es.sequence_number,
              (es.sent_at AT TIME ZONE $3)::date AS sent_on,
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
      GROUP BY 1, 2`,
    [from, to, SEND_QUEUE_TIMEZONE],
  );
  return new Map(rows.map((row) => [`${row.identity_slug}:${row.due_date}`, Number(row.n)]));
}

async function varianceByInbox(from: string, to: string): Promise<Map<string, boolean>> {
  const { rows } = await dbQuery<{ scope_key: string; day: string; detail: Record<string, unknown> }>(
    `SELECT scope_key, to_char(day, 'YYYY-MM-DD') AS day, detail
       FROM outreach.inbox_health_daily
      WHERE source = 'forecast' AND day BETWEEN $1::date AND $2::date
      ORDER BY day ASC`,
    [from, to],
  );
  const history = new Map<string, Array<{ planned: number; actual: number }>>();
  for (const row of rows) {
    history.set(row.scope_key, [
      ...(history.get(row.scope_key) ?? []),
      { planned: Number(row.detail.planned ?? 0), actual: Number(row.detail.actual ?? 0) },
    ]);
  }
  return new Map([...history].map(([id, entries]) => [id, varianceFlag(entries)]));
}

// ---------------------------------------------------------------------------
// Board actions
// ---------------------------------------------------------------------------

/** Moves rows to another handoff day. Rows already with Smartlead are recalled. */
export async function moveSendQueueItems(input: {
  ids: string[];
  targetDate: string;
  ownerId?: string;
}): Promise<{ moved: number; recalled: number }> {
  if (!input.ids.length) return { moved: 0, recalled: 0 };

  const { rows } = await dbQuery<{ id: string; status: EmailSendQueueStatus }>(
    `SELECT id::text, status FROM outreach.email_send_queue
      WHERE id = ANY($1::uuid[]) AND status IN ('queued', 'handing_off', 'handed_off')`,
    [input.ids],
  );

  const handedOff = rows.filter((row) => row.status === 'handed_off').map((row) => row.id);
  // The lead is already inside Smartlead; delete it there before re-dating,
  // otherwise the same lead would be imported twice.
  for (const queueId of handedOff) await enqueueLeadOp('delete', queueId);

  const { rowCount } = await dbQuery(
    `UPDATE outreach.email_send_queue
        SET handoff_date = $2::date,
            status = 'queued',
            smartlead_lead_id = NULL,
            handed_off_at = NULL,
            waiting_reason = NULL,
            error_message = NULL,
            updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND status IN ('queued', 'handing_off', 'handed_off')`,
    [input.ids, input.targetDate],
  );
  return { moved: rowCount ?? 0, recalled: handedOff.length };
}

export async function cancelSendQueueItems(input: {
  ids: string[];
  ownerId?: string;
}): Promise<{ cancelled: number; recalled: number }> {
  if (!input.ids.length) return { cancelled: 0, recalled: 0 };

  const { rows } = await dbQuery<{ id: string; status: EmailSendQueueStatus }>(
    `SELECT id::text, status FROM outreach.email_send_queue
      WHERE id = ANY($1::uuid[]) AND status IN ('queued', 'handing_off', 'handed_off')`,
    [input.ids],
  );
  const handedOff = rows.filter((row) => row.status === 'handed_off').map((row) => row.id);
  for (const queueId of handedOff) await enqueueLeadOp('delete', queueId);

  const { rowCount } = await dbQuery(
    `UPDATE outreach.email_send_queue
        SET status = 'cancelled', waiting_reason = NULL, updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND status IN ('queued', 'handing_off', 'handed_off')`,
    [input.ids],
  );
  return { cancelled: rowCount ?? 0, recalled: handedOff.length };
}

/** "Send now" means hand off now; Smartlead still chooses the minute. */
export async function sendNowQueueItems(input: {
  ids: string[];
  ownerId?: string;
}): Promise<{ queued: number; jobs: string[] }> {
  if (!input.ids.length) return { queued: 0, jobs: [] };

  const today = formatNyDate();
  const { rows } = await dbQuery<{ campaign_id: string; identity_slug: IdentitySlug; ids: string[] }>(
    `WITH bumped AS (
       UPDATE outreach.email_send_queue q
          SET handoff_date = $2::date, waiting_reason = NULL, updated_at = now()
        WHERE q.id = ANY($1::uuid[]) AND q.status = 'queued'
        RETURNING q.id, q.campaign_id, q.lane_id
     )
     SELECT bumped.campaign_id::text,
            coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') AS identity_slug,
            array_agg(bumped.id::text) AS ids
       FROM bumped
       JOIN outreach.campaigns c ON c.id = bumped.campaign_id
       LEFT JOIN outreach.campaign_lanes lane ON lane.id = bumped.lane_id
      GROUP BY 1, 2`,
    [input.ids, today],
  );

  const jobs: string[] = [];
  let queued = 0;
  for (const group of rows) {
    queued += group.ids.length;
    jobs.push(
      await enqueueWork({
        kind: 'smartlead.handoff',
        payload: {
          campaignId: group.campaign_id,
          identitySlug: group.identity_slug,
          queueIds: group.ids,
        },
        dedupeKey: `handoff-now:${hashIds(group.ids)}`,
        scopeKey: group.campaign_id,
        reviveTerminal: true,
      }),
    );
  }
  return { queued, jobs };
}

export async function retryFailedQueueItems(input: {
  ids: string[];
  ownerId?: string;
}): Promise<{ retried: number; jobs: string[] }> {
  if (!input.ids.length) return { retried: 0, jobs: [] };
  const { rowCount } = await dbQuery(
    `UPDATE outreach.email_send_queue
        SET status = 'queued', error_message = NULL, waiting_reason = NULL, updated_at = now()
      WHERE id = ANY($1::uuid[]) AND status = 'failed'`,
    [input.ids],
  );
  if (!rowCount) return { retried: 0, jobs: [] };
  const { jobs } = await sendNowQueueItems({ ids: input.ids, ownerId: input.ownerId });
  return { retried: rowCount, jobs };
}

async function enqueueLeadOp(op: 'delete' | 'pause' | 'resume' | 'block', queueId: string) {
  await enqueueWork({
    kind: 'smartlead.lead_op',
    payload: { op, queueId },
    dedupeKey: `lead-op:${op}:${queueId}`,
    scopeKey: queueId,
    reviveTerminal: true,
  }).catch(() => undefined);
}

function hashIds(ids: string[]): string {
  const sorted = [...ids].sort().join(',');
  let hash = 0;
  for (let i = 0; i < sorted.length; i += 1) hash = (hash * 31 + sorted.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

export async function cancelQueueForItem(itemId: string): Promise<number> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id::text FROM outreach.email_send_queue
      WHERE drafting_item_id = $1 AND status = ANY($2::text[])`,
    [itemId, [...LIVE_QUEUE_STATUSES]],
  );
  if (!rows.length) return 0;
  const { cancelled } = await cancelSendQueueItems({ ids: rows.map((row) => row.id) });
  return cancelled;
}

export async function sendNowForItem(itemId: string): Promise<boolean> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id::text FROM outreach.email_send_queue
      WHERE drafting_item_id = $1 AND status = 'queued'
      ORDER BY updated_at DESC LIMIT 1`,
    [itemId],
  );
  if (!rows[0]) return false;
  const { queued } = await sendNowQueueItems({ ids: [rows[0].id] });
  return queued > 0;
}

// ---------------------------------------------------------------------------
// Detail + stats
// ---------------------------------------------------------------------------

export async function getSendQueueDetail(
  queueId: string,
  _ownerId?: string,
): Promise<(QueueListItem & { body_text: string | null }) | null> {
  const { rows } = await dbQuery<QueueListItem & { body_text: string | null; sent_date: string | null }>(
    `SELECT ${QUEUE_ROW_SELECT.split(',').map((col) => `q.${col.trim()}`).join(', ')},
            c.name AS campaign_name,
            c.queue_color,
            coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') AS identity_slug,
            lane.status AS lane_status,
            ib.email AS inbox_email,
            d.body_text,
            (es.sent_at AT TIME ZONE $2)::date::text AS sent_date
       FROM outreach.email_send_queue q
       JOIN outreach.campaigns c ON c.id = q.campaign_id
       LEFT JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
       LEFT JOIN outreach.sender_inboxes ib ON ib.id = q.sender_inbox_id
       LEFT JOIN outreach.email_drafts d ON d.drafting_item_id = q.drafting_item_id
       LEFT JOIN LATERAL (
         SELECT sent_at FROM outreach.email_sends
          WHERE drafting_item_id = q.drafting_item_id AND sequence_number = 1
          ORDER BY created_at DESC LIMIT 1
       ) es ON true
      WHERE q.id = $1::uuid`,
    [queueId, SEND_QUEUE_TIMEZONE],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    delivery_status: deliveryStatusFor(row),
    overdue: isOverdue(row, formatNyDate()),
  };
}

/**
 * Headline numbers for the drafting page. "Remaining today" is what the
 * identity's mailboxes can still send, which under Smartlead replaces the old
 * fixed per-user cap.
 */
export async function ownerQueueStats(
  _ownerId?: string,
  identitySlug?: SenderIdentitySlug | null,
): Promise<{ today_remaining: number; queued_count: number; next_schedule_date: string | null }> {
  const today = formatNyDate();
  const remaining = await todayRemaining(undefined, new Date(), identitySlug);

  const params: unknown[] = [];
  let identityClause = '';
  if (identitySlug) {
    params.push(identitySlug);
    identityClause = `AND coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') = $${params.length}`;
  }
  const { rows } = await dbQuery<{ queued_count: number; next_date: string | null }>(
    `SELECT count(*)::int AS queued_count, min(q.handoff_date)::text AS next_date
       FROM outreach.email_send_queue q
       JOIN outreach.campaigns c ON c.id = q.campaign_id
       LEFT JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
      WHERE q.status = ANY('{queued,handing_off,handed_off}'::text[])
        ${identityClause}`,
    params,
  );

  return {
    today_remaining: remaining,
    queued_count: Number(rows[0]?.queued_count ?? 0),
    next_schedule_date: rows[0]?.next_date && rows[0].next_date >= today ? rows[0].next_date : null,
  };
}

/** New-lead slots still open today across an identity's mailboxes. */
export async function todayRemaining(
  _ownerId?: string,
  now = new Date(),
  identitySlug?: SenderIdentitySlug | null,
): Promise<number> {
  const today = formatNyDate(now);
  const capacity = await loadCapacity(today);
  const groups = identitySlug
    ? [capacity.byIdentity.get(identitySlug) ?? []]
    : [...capacity.byIdentity.values()];

  const total = groups.reduce(
    (sum, inboxes) => sum + identityCapacity({ inboxes, followupsDue: 0 }, today),
    0,
  );

  const { rows } = await dbQuery<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM outreach.email_send_queue q
       JOIN outreach.campaigns c ON c.id = q.campaign_id
       LEFT JOIN outreach.campaign_lanes lane ON lane.id = q.lane_id
      WHERE q.handoff_date = $1::date
        AND q.status IN ('queued', 'handing_off', 'handed_off', 'sent')
        AND ($2::text IS NULL
             OR coalesce(lane.identity_slug, c.sender_identity_slug, 'lucas') = $2::text)`,
    [today, identitySlug ?? null],
  );
  return Math.max(0, total - Number(rows[0]?.n ?? 0));
}

/**
 * Reconcile repair: re-plan rows that lost their date and complete rows whose
 * send we already recorded.
 */
export async function reconcileEmailSendQueue(limit = 50): Promise<number> {
  const { rowCount: completed } = await dbQuery(
    `UPDATE outreach.email_send_queue q
        SET status = 'sent', updated_at = now()
       FROM outreach.email_sends es
      WHERE es.drafting_item_id = q.drafting_item_id
        AND es.status = 'sent'
        AND es.sequence_number = 1
        AND q.status IN ('queued', 'handing_off', 'handed_off')`,
  );

  const { rows: orphans } = await dbQuery<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM outreach.email_send_queue
      WHERE status = 'queued' AND handoff_date IS NULL
      LIMIT $1`,
    [Math.max(1, Math.min(500, limit))],
  );
  if (Number(orphans[0]?.n ?? 0) > 0) await replanHandoffs().catch(() => undefined);

  return completed ?? 0;
}

/** Backfills identity on legacy rows that predate lanes. */
export async function backfillQueueIdentities(): Promise<number> {
  const { rowCount } = await dbQuery(
    `UPDATE outreach.email_send_queue q
        SET sender_identity_id = si.id, updated_at = now()
       FROM outreach.campaigns c
       JOIN outreach.sender_identities si
         ON si.slug = coalesce(c.sender_identity_slug, 'lucas')
      WHERE c.id = q.campaign_id AND q.sender_identity_id IS NULL`,
  );
  return rowCount ?? 0;
}

export type { PoolClient };
