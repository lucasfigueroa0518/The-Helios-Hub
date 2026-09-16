/**
 * Smartlead webhook normalization and application (§5F).
 *
 * Authentication is by path token: S0 confirmed Smartlead publishes no payload
 * signature and its registration body has no secret field. `verifySmartleadSignature`
 * exists so switching to HMAC later is a config change, not a rewrite.
 *
 * Everything here is written to be replayed. Smartlead retries for six hours,
 * events arrive out of order, and the reconcile backfill deliberately replays
 * the same sends — so each effect is idempotent and `applySmartleadEvent`
 * reports whether it changed anything.
 */
import crypto from 'node:crypto';

import { dbQuery, dbTransaction } from '@/lib/db';
import { laneBySmartleadCampaignId, type CampaignLane } from '@/lib/smartlead/lanes';
import {
  SMARTLEAD_EVENT_ALIASES,
  toNumber,
  type HubWebhookEvent,
  type SmartleadWebhookPayload,
} from '@/lib/smartlead/types';

/** Largest body we will parse; anything bigger is refused before JSON.parse. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export function webhookPathToken(): string | null {
  return process.env.SMARTLEAD_WEBHOOK_PATH_TOKEN?.trim() || null;
}

/**
 * Constant-time path-token comparison. A mismatch is answered with 404 rather
 * than 401 so the endpoint is not enumerable.
 */
export function verifyWebhookPathToken(candidate: string): boolean {
  const expected = webhookPathToken();
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * HMAC-SHA256 over the raw body. Unused while the webhook mode is `path_token`;
 * kept so enabling `hmac` is a settings change if Smartlead ever signs.
 */
export function verifySmartleadSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.SMARTLEAD_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signature.replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ipAllowed(sourceIp: string | null, allowList: string[]): boolean {
  if (!allowList.length) return true;
  return Boolean(sourceIp) && allowList.includes(sourceIp!);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export type NormalizedEvent = {
  eventId: string;
  type: HubWebhookEvent;
  smartleadCampaignId: number;
  smartleadLeadId: number | null;
  smartleadEmailAccountId: number | null;
  sequenceNumber: number;
  eventAt: string;
  leadEmail: string | null;
  subject: string | null;
  messageId: string | null;
  reply: { subject: string | null; body: string | null; messageId: string | null } | null;
  leadCategory: string | null;
  hubQueueId: string | null;
  hubItemId: string | null;
  bounceReason: string | null;
  openedCount: number | null;
};

/**
 * Accepts every event-name spelling Smartlead's docs use and returns null for
 * anything unrecognised, so a new event type is ignored rather than fatal.
 */
export function normalizeSmartleadEvent(
  payload: SmartleadWebhookPayload,
): NormalizedEvent | null {
  const rawType = String(payload.event_type ?? payload.event ?? '').trim().toUpperCase();
  const type = SMARTLEAD_EVENT_ALIASES[rawType];
  if (!type) return null;

  const smartleadCampaignId = toNumber(payload.campaign_id, 0);
  if (!smartleadCampaignId) return null;

  const sequenceNumber = Math.max(1, toNumber(payload.sequence_number, 1));
  const eventAt = normalizeTimestamp(
    payload.event_timestamp ?? payload.timestamp ?? payload.reply?.received_at,
  );
  const leadEmail = (payload.lead?.email ?? payload.to_email ?? '').trim().toLowerCase() || null;
  const custom = payload.lead?.custom_fields ?? {};

  return {
    // Smartlead sends no event id, so a content hash is the normal path.
    eventId: payload.event_id?.trim()
      || sha1(`${type}|${smartleadCampaignId}|${payload.lead_id ?? leadEmail}|${sequenceNumber}|${eventAt}`),
    type,
    smartleadCampaignId,
    smartleadLeadId: payload.lead_id ? toNumber(payload.lead_id) : null,
    smartleadEmailAccountId: payload.email_account_id ? toNumber(payload.email_account_id) : null,
    sequenceNumber,
    eventAt,
    leadEmail,
    subject: payload.email?.subject?.trim() || null,
    messageId: payload.email?.message_id?.trim() || null,
    reply: payload.reply
      ? {
          subject: payload.reply.subject?.trim() || null,
          body: payload.reply.body ?? null,
          messageId: payload.reply.message_id?.trim() || null,
        }
      : null,
    leadCategory: normalizeCategory(payload.lead_category),
    hubQueueId: custom.hub_queue_id?.trim() || null,
    hubItemId: custom.hub_item_id?.trim() || null,
    bounceReason: payload.bounce_reason?.trim() || null,
    openedCount: typeof payload.opened_count === 'number' ? payload.opened_count : null,
  };
}

function normalizeCategory(raw: SmartleadWebhookPayload['lead_category']): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  return raw.name?.trim() || null;
}

function normalizeTimestamp(raw: string | undefined): string {
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/** A Do-not-contact category suppresses the lead outright. */
export function isDoNotContact(category: string | null): boolean {
  return /do\s*not\s*contact|dnc|blocked/i.test(category ?? '');
}

export function isOutOfOfficeCategory(category: string | null): boolean {
  return /out\s*of\s*office|ooo|vacation/i.test(category ?? '');
}

// ---------------------------------------------------------------------------
// Dedupe helpers (moved here from agentmail-engagement)
// ---------------------------------------------------------------------------

const MAX_TRACKED_EVENT_IDS = 50;

export function webhookIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

export function alreadyProcessed(processedIds: unknown, eventId: string | null): boolean {
  if (!eventId) return false;
  return webhookIds(processedIds).includes(eventId);
}

export function nextProcessed(raw: unknown, eventId: string | null): string {
  const ids = webhookIds(raw);
  if (eventId && !ids.includes(eventId)) ids.push(eventId);
  return JSON.stringify(ids.slice(-MAX_TRACKED_EVENT_IDS));
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type ApplyOutcome = {
  applied: boolean;
  reason?: string;
  emailSendId?: string;
  draftingItemId?: string;
};

type ResolvedTarget = {
  lane: CampaignLane;
  queueId: string | null;
  draftingItemId: string;
  campaignId: string;
  ownerId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  senderInboxId: string | null;
  leadId: string | null;
};

/**
 * Resolves the event to a hub row, in the order that is cheapest and most
 * certain first: the lane's unique Smartlead campaign id, then the lead id we
 * recorded at handoff, then the queue id we planted in a custom field, then the
 * address.
 */
export async function resolveTarget(event: NormalizedEvent): Promise<ResolvedTarget | null> {
  const lane = await laneBySmartleadCampaignId(event.smartleadCampaignId);
  if (!lane) return null;

  const { rows } = await dbQuery<{
    queue_id: string | null;
    drafting_item_id: string;
    campaign_id: string;
    owner_id: string;
    to_email: string;
    subject: string;
    sender_inbox_id: string | null;
    from_email: string | null;
    lead_id: string | null;
  }>(
    `SELECT q.id::text AS queue_id,
            q.drafting_item_id::text,
            q.campaign_id::text,
            q.owner_id::text,
            q.to_email,
            q.subject,
            coalesce(q.sender_inbox_id, ib.id)::text AS sender_inbox_id,
            coalesce(ib.email, q.from_email) AS from_email,
            l.id::text AS lead_id
       FROM outreach.email_send_queue q
       LEFT JOIN outreach.sender_inboxes ib
              ON ib.smartlead_email_account_id = $5::bigint
       LEFT JOIN outreach.leads l ON lower(l.email_primary) = lower(q.to_email)
      WHERE q.lane_id = $1
        AND (
              ($2::bigint IS NOT NULL AND q.smartlead_lead_id = $2::bigint)
           OR ($3::uuid   IS NOT NULL AND q.id = $3::uuid)
           OR ($4::text   IS NOT NULL AND lower(q.to_email) = $4::text)
        )
      ORDER BY q.updated_at DESC
      LIMIT 1`,
    [
      lane.id,
      event.smartleadLeadId,
      isUuid(event.hubQueueId) ? event.hubQueueId : null,
      event.leadEmail,
      event.smartleadEmailAccountId,
    ],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    lane,
    queueId: row.queue_id,
    draftingItemId: row.drafting_item_id,
    campaignId: row.campaign_id,
    ownerId: row.owner_id,
    toEmail: row.to_email,
    fromEmail: row.from_email ?? '',
    subject: row.subject,
    senderInboxId: row.sender_inbox_id,
    leadId: row.lead_id,
  };
}

function isUuid(value: string | null): boolean {
  return Boolean(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value!);
}

export async function applySmartleadEvent(event: NormalizedEvent): Promise<ApplyOutcome> {
  const target = await resolveTarget(event);
  if (!target) return { applied: false, reason: 'unmatched_event' };

  switch (event.type) {
    case 'EMAIL_SENT':
      return applyEmailSent(event, target);
    case 'EMAIL_OPENED':
    case 'EMAIL_CLICKED':
      return applyEngagement(event, target);
    case 'EMAIL_BOUNCED':
      return applyBounced(event, target);
    case 'EMAIL_UNSUBSCRIBED':
      return applyUnsubscribed(event, target);
    case 'EMAIL_REPLIED':
      return applyReplied(event, target);
    case 'LEAD_CATEGORY_UPDATED':
      return applyCategory(event, target);
  }
}

/**
 * Records the send and completes the queue row. The unique index on
 * `(drafting_item_id, sequence_number) WHERE status='sent'` makes a replay a
 * no-op, which is what lets the reconcile backfill run the same events again.
 */
async function applyEmailSent(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<ApplyOutcome> {
  return dbTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO outreach.email_sends (
         drafting_item_id, lane_id, provider, provider_message_id, status,
         from_email, to_email, subject, sent_at, sequence_number,
         smartlead_lead_id, smartlead_email_account_id, sender_inbox_id,
         processed_webhook_ids
       ) VALUES ($1, $2, 'smartlead', $3, 'sent', $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (drafting_item_id, sequence_number) WHERE (status = 'sent')
       DO UPDATE SET
         processed_webhook_ids = $12::jsonb,
         smartlead_email_account_id = coalesce(
           outreach.email_sends.smartlead_email_account_id, EXCLUDED.smartlead_email_account_id),
         last_event_at = now(),
         updated_at = now()
       RETURNING id::text`,
      [
        target.draftingItemId,
        target.lane.id,
        event.messageId,
        target.fromEmail,
        target.toEmail,
        event.subject ?? target.subject,
        event.eventAt,
        event.sequenceNumber,
        event.smartleadLeadId,
        event.smartleadEmailAccountId,
        target.senderInboxId,
        nextProcessed([], event.eventId),
      ],
    );

    if (event.sequenceNumber === 1 && target.queueId) {
      await client.query(
        `UPDATE outreach.email_send_queue
            SET status = 'sent', error_message = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('queued', 'handing_off', 'handed_off')`,
        [target.queueId],
      );
    }

    return {
      applied: true,
      emailSendId: rows[0]?.id,
      draftingItemId: target.draftingItemId,
    };
  });
}

async function applyEngagement(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<ApplyOutcome> {
  const column = event.type === 'EMAIL_OPENED' ? 'opened_at' : 'clicked_at';
  const counter = event.type === 'EMAIL_OPENED' ? 'open_count' : 'click_count';
  const { rows } = await dbQuery<{ id: string; processed_webhook_ids: unknown }>(
    `SELECT id::text, processed_webhook_ids
       FROM outreach.email_sends
      WHERE drafting_item_id = $1 AND sequence_number = $2 AND status = 'sent'`,
    [target.draftingItemId, event.sequenceNumber],
  );
  const send = rows[0];
  if (!send) return { applied: false, reason: 'send_row_missing' };
  if (alreadyProcessed(send.processed_webhook_ids, event.eventId)) {
    return { applied: false, reason: 'duplicate_event' };
  }

  await dbQuery(
    `UPDATE outreach.email_sends
        SET ${column} = coalesce(${column}, $2::timestamptz),
            ${counter} = ${counter} + 1,
            last_event_at = now(),
            processed_webhook_ids = $3::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [send.id, event.eventAt, nextProcessed(send.processed_webhook_ids, event.eventId)],
  );
  return { applied: true, emailSendId: send.id, draftingItemId: target.draftingItemId };
}

/**
 * A bounce suppresses the address everywhere: the send row, the lead, any other
 * live queue row for the same address, and Smartlead's own block list.
 */
async function applyBounced(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<ApplyOutcome> {
  await dbTransaction(async (client) => {
    await client.query(
      `UPDATE outreach.email_sends
          SET bounced_at = coalesce(bounced_at, $2::timestamptz),
              bounce_type = coalesce(bounce_type, $3),
              last_event_at = now(),
              updated_at = now()
        WHERE drafting_item_id = $1 AND sequence_number = $4`,
      [target.draftingItemId, event.eventAt, event.bounceReason, event.sequenceNumber],
    );
    await suppressLead(client, target, 'bounced', event.eventAt);
    await cancelOtherLiveRows(client, target);
  });
  await enqueueBlock(target);
  return { applied: true, draftingItemId: target.draftingItemId };
}

async function applyUnsubscribed(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<ApplyOutcome> {
  await dbTransaction(async (client) => {
    await client.query(
      `UPDATE outreach.email_sends
          SET unsubscribed_at = coalesce(unsubscribed_at, $2::timestamptz),
              reply_suppressed_at = coalesce(reply_suppressed_at, $2::timestamptz),
              reply_suppress_reason = coalesce(reply_suppress_reason, 'unsubscribed'),
              last_event_at = now(),
              updated_at = now()
        WHERE drafting_item_id = $1`,
      [target.draftingItemId, event.eventAt],
    );
    await client.query(
      `UPDATE outreach.reply_sends
          SET status = 'cancelled', cancel_reason = 'unsubscribed',
              cancelled_at = now(), updated_at = now()
        WHERE drafting_item_id = $1 AND status IN ('awaiting_human', 'queued', 'scheduled')`,
      [target.draftingItemId],
    );
    await suppressLead(client, target, 'unsubscribed', event.eventAt);
    await cancelOtherLiveRows(client, target);
  });
  await enqueueBlock(target);
  return { applied: true, draftingItemId: target.draftingItemId };
}

/**
 * A reply may arrive before its own EMAIL_SENT — Smartlead does not guarantee
 * ordering — so the send row is synthesized from the queue row first.
 */
async function applyReplied(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<ApplyOutcome> {
  const sendId = await ensureSendRow(event, target);
  if (!sendId) return { applied: false, reason: 'send_row_unavailable' };

  await dbQuery(
    `UPDATE outreach.email_sends
        SET replied_at = coalesce(replied_at, $2::timestamptz),
            last_event_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [sendId, event.eventAt],
  );

  const providerEmailId = event.reply?.messageId
    ?? `sl:${event.smartleadCampaignId}:${event.smartleadLeadId ?? event.leadEmail}:${Date.parse(event.eventAt)}`;

  const { processInboundLeadReply } = await import('@/lib/drafting/reply-inbound');
  const result = await processInboundLeadReply({
    emailSendId: sendId,
    providerEmailId,
    eventAt: event.eventAt,
    content: {
      providerEmailId,
      fromEmail: event.leadEmail ?? target.toEmail,
      toEmails: target.fromEmail ? [target.fromEmail] : [],
      subject: event.reply?.subject ?? null,
      textBody: event.reply?.body ?? null,
      htmlBody: null,
      headers: event.reply?.subject ? { subject: event.reply.subject } : {},
      receivedAt: event.eventAt,
    },
  });

  if (result.inboundId) {
    await dbQuery(
      `UPDATE outreach.inbound_emails
          SET sequence_number = coalesce(sequence_number, $2), updated_at = now()
        WHERE id = $1`,
      [result.inboundId, event.sequenceNumber],
    );
  }
  return { applied: true, emailSendId: sendId, draftingItemId: target.draftingItemId };
}

async function applyCategory(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<ApplyOutcome> {
  await dbQuery(
    `UPDATE outreach.inbound_emails
        SET lead_category = $2, lead_category_updated_at = now(), updated_at = now()
      WHERE drafting_item_id = $1`,
    [target.draftingItemId, event.leadCategory],
  );

  if (isDoNotContact(event.leadCategory)) {
    await dbTransaction(async (client) => {
      await suppressLead(client, target, 'blocked', event.eventAt);
      await client.query(
        `UPDATE outreach.email_sends
            SET reply_suppressed_at = coalesce(reply_suppressed_at, now()),
                reply_suppress_reason = coalesce(reply_suppress_reason, 'do_not_contact'),
                updated_at = now()
          WHERE drafting_item_id = $1`,
        [target.draftingItemId],
      );
      await cancelOtherLiveRows(client, target);
    });
    await enqueueBlock(target);
  }

  // An out-of-office reply is not a human reply; drop the pending fallback.
  if (isOutOfOfficeCategory(event.leadCategory)) {
    await dbQuery(
      `UPDATE outreach.reply_sends
          SET status = 'cancelled', cancel_reason = 'out_of_office',
              cancelled_at = now(), updated_at = now()
        WHERE drafting_item_id = $1 AND status = 'awaiting_human'`,
      [target.draftingItemId],
    );
  }
  return { applied: true, draftingItemId: target.draftingItemId };
}

/** Finds the step's send row, synthesizing one when the reply beat the send. */
async function ensureSendRow(
  event: NormalizedEvent,
  target: ResolvedTarget,
): Promise<string | null> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id::text FROM outreach.email_sends
      WHERE drafting_item_id = $1 AND sequence_number = $2 AND status = 'sent'`,
    [target.draftingItemId, event.sequenceNumber],
  );
  if (rows[0]) return rows[0].id;

  const synthesized = await applyEmailSent(
    { ...event, type: 'EMAIL_SENT', eventId: `${event.eventId}:synth` },
    target,
  );
  return synthesized.emailSendId ?? null;
}

type Client = Parameters<Parameters<typeof dbTransaction>[0]>[0];

async function suppressLead(
  client: Client,
  target: ResolvedTarget,
  status: 'bounced' | 'unsubscribed' | 'complained' | 'blocked',
  at: string,
): Promise<void> {
  await client.query(
    `UPDATE outreach.leads
        SET contact_status = $2,
            contact_status_at = $3::timestamptz,
            contact_status_source = 'smartlead'
      WHERE (id = $1::uuid OR lower(email_primary) = lower($4))
        AND contact_status = 'active'`,
    [target.leadId, status, at, target.toEmail],
  );
}

/** A suppressed address must not go out from any other campaign either. */
async function cancelOtherLiveRows(client: Client, target: ResolvedTarget): Promise<void> {
  await client.query(
    `UPDATE outreach.email_send_queue
        SET status = 'cancelled',
            error_message = 'recipient_suppressed',
            updated_at = now()
      WHERE lower(to_email) = lower($1)
        AND status IN ('queued', 'handing_off', 'handed_off')
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [target.toEmail, target.queueId],
  );
}

/** Mirrors the suppression into Smartlead's global block list, off the hot path. */
async function enqueueBlock(target: ResolvedTarget): Promise<void> {
  if (!target.queueId) return;
  const { enqueueWork } = await import('@/lib/orchestration/repository');
  await enqueueWork({
    kind: 'smartlead.lead_op',
    payload: { op: 'block', queueId: target.queueId },
    dedupeKey: `lead-op:block:${target.queueId}`,
    scopeKey: target.campaignId,
  });
}
