/**
 * Conversations, keyed on `drafting_item_id`.
 *
 * Under Smartlead a lead receives a sequence, not a single email, so one thread
 * now holds several `email_sends` rows — step 1 and each follow-up — plus every
 * inbound reply and every reply we sent back. Keying on the drafting item keeps
 * them in one conversation instead of splitting the thread per step, which is
 * what keying on `email_sends.id` used to do.
 */
import { dbQuery } from '@/lib/db';
import { REPLY_AUTO_DELAY_MS } from '@/lib/drafting/reply-constants';

export type ConversationFilter = 'all' | 'awaiting' | 'sent' | 'failed';

export type ConversationListItem = {
  drafting_item_id: string;
  /** Step-1 send, kept so old `?emailSendId=` links can be redirected. */
  email_send_id: string;
  campaign_id: string;
  campaign_name: string;
  lead_name: string | null;
  lead_company: string | null;
  lead_email: string;
  outbound_subject: string;
  last_inbound_preview: string | null;
  last_inbound_at: string;
  reply_status: string | null;
  reply_scheduled_for: string | null;
  reply_sent_at: string | null;
  /** Smartlead's classification of the reply (Interested, OOO, …). */
  lead_category: string | null;
  /** While set and in the future, a human still owns this thread. */
  human_window_expires_at: string | null;
  sequence_steps: number;
};

export type ConversationThreadMessage = {
  id: string;
  role: 'outbound' | 'inbound' | 'auto_reply' | 'human_reply' | 'scheduled_followup';
  subject: string | null;
  body_text: string | null;
  at: string;
  status?: string | null;
  error_message?: string | null;
  kind?: string | null;
  disposition?: string | null;
  defer_until?: string | null;
  defer_reason?: string | null;
  /** Sequence step this outbound message belongs to. */
  sequence_number?: number | null;
  lead_category?: string | null;
};

export type ConversationThread = {
  drafting_item_id: string;
  email_send_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_href: string;
  lead_name: string | null;
  lead_company: string | null;
  lead_email: string;
  messages: ConversationThreadMessage[];
  reply_status: string | null;
  reply_suppressed: boolean;
  lead_category: string | null;
  human_window_expires_at: string | null;
  /** False when the campaign is set to human_only, so the UI hides the countdown. */
  fallback_enabled: boolean;
  can_reply: boolean;
};

export type ConversationStats = {
  conversations: number;
  replied: number;
};

/** Statuses that mean the thread is still waiting on somebody. */
const AWAITING_STATUSES = "('awaiting_human', 'queued', 'drafting', 'scheduled')";

export const HUMAN_REPLY_WINDOW_MS = REPLY_AUTO_DELAY_MS;

function previewText(value: string | null | undefined, max = 120): string | null {
  if (!value?.trim()) return null;
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function stripHtml(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

export async function listConversationStats(
  ownerId: string,
  campaignId?: string | null,
): Promise<ConversationStats> {
  const params: unknown[] = [ownerId];
  let campaignClause = '';
  if (campaignId) {
    params.push(campaignId);
    campaignClause = ` AND ib.campaign_id = $2::uuid`;
  }
  const { rows } = await dbQuery<{
    conversations: string;
    replied: string;
  }>(
    `WITH threads AS (
       SELECT DISTINCT ON (ib.drafting_item_id)
              ib.drafting_item_id,
              rs.status AS reply_status,
              rs.sent_at AS reply_sent_at
         FROM outreach.inbound_emails ib
         LEFT JOIN LATERAL (
           SELECT status, sent_at
             FROM outreach.reply_sends
            WHERE drafting_item_id = ib.drafting_item_id
              AND status <> 'cancelled'
            ORDER BY coalesce(sent_at, scheduled_for, created_at) DESC
            LIMIT 1
         ) rs ON true
        WHERE ib.owner_id = $1::uuid
          ${campaignClause}
        ORDER BY ib.drafting_item_id, ib.received_at DESC
     )
     SELECT count(*)::text AS conversations,
            count(*) FILTER (
              WHERE reply_status = 'sent' OR reply_sent_at IS NOT NULL
            )::text AS replied
       FROM threads`,
    params,
  );
  const row = rows[0];
  return {
    conversations: Number(row?.conversations ?? 0),
    replied: Number(row?.replied ?? 0),
  };
}

export async function listConversations(input: {
  ownerId: string;
  campaignId?: string | null;
  filter?: ConversationFilter;
  limit?: number;
}): Promise<{ stats: ConversationStats; items: ConversationListItem[] }> {
  const stats = await listConversationStats(input.ownerId, input.campaignId);
  const params: unknown[] = [input.ownerId];
  const clauses = ['ib.owner_id = $1::uuid'];
  if (input.campaignId) {
    params.push(input.campaignId);
    clauses.push(`ib.campaign_id = $${params.length}::uuid`);
  }

  const filter = input.filter ?? 'all';
  let having = '';
  if (filter === 'awaiting') {
    having = `AND (rs.status IN ${AWAITING_STATUSES} OR rs.status IS NULL)`;
  } else if (filter === 'sent') {
    having = `AND rs.status = 'sent'`;
  } else if (filter === 'failed') {
    having = `AND rs.status IN ('failed', 'skipped')`;
  }

  params.push(Math.min(200, Math.max(1, input.limit ?? 100)));
  const limitIdx = params.length;

  const { rows } = await dbQuery<{
    drafting_item_id: string;
    email_send_id: string;
    campaign_id: string;
    campaign_name: string;
    lead_name: string | null;
    lead_company: string | null;
    lead_email: string;
    outbound_subject: string;
    last_inbound_preview: string | null;
    last_inbound_at: string;
    reply_status: string | null;
    reply_scheduled_for: string | null;
    reply_sent_at: string | null;
    lead_category: string | null;
    sequence_steps: string;
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (ib.drafting_item_id)
              ib.drafting_item_id,
              ib.campaign_id,
              ib.text_body,
              ib.html_body,
              ib.received_at,
              ib.lead_category
         FROM outreach.inbound_emails ib
        WHERE ${clauses.join(' AND ')}
        ORDER BY ib.drafting_item_id, ib.received_at DESC
     )
     SELECT latest.drafting_item_id::text,
            step1.id::text AS email_send_id,
            latest.campaign_id::text,
            c.name AS campaign_name,
            coalesce(
              nullif(trim(i.input_snapshot #>> '{lead,fullName}'), ''),
              nullif(trim(i.input_snapshot #>> '{lead,firstName}'), '')
            ) AS lead_name,
            nullif(trim(i.input_snapshot #>> '{lead,company}'), '') AS lead_company,
            step1.to_email AS lead_email,
            step1.subject AS outbound_subject,
            coalesce(latest.text_body, latest.html_body) AS last_inbound_preview,
            latest.received_at::text AS last_inbound_at,
            rs.status AS reply_status,
            rs.scheduled_for::text AS reply_scheduled_for,
            rs.sent_at::text AS reply_sent_at,
            latest.lead_category,
            (SELECT count(*)::text
               FROM outreach.email_sends steps
              WHERE steps.drafting_item_id = latest.drafting_item_id
                AND steps.status = 'sent') AS sequence_steps
       FROM latest
       JOIN outreach.campaigns c ON c.id = latest.campaign_id
       JOIN outreach.drafting_items i ON i.id = latest.drafting_item_id
       JOIN LATERAL (
         SELECT id, to_email, subject
           FROM outreach.email_sends
          WHERE drafting_item_id = latest.drafting_item_id
          ORDER BY sequence_number ASC, created_at ASC
          LIMIT 1
       ) step1 ON true
       LEFT JOIN LATERAL (
         SELECT status, scheduled_for, sent_at
           FROM outreach.reply_sends
          WHERE drafting_item_id = latest.drafting_item_id
            AND status <> 'cancelled'
          ORDER BY coalesce(sent_at, scheduled_for, created_at) DESC
          LIMIT 1
       ) rs ON true
      WHERE true
        ${having}
      ORDER BY CASE
                 WHEN rs.status = 'awaiting_human' AND rs.scheduled_for > now() THEN 0
                 ELSE 1
               END,
               latest.received_at DESC
      LIMIT $${limitIdx}`,
    params,
  );

  const items = rows.map((row) => ({
    ...row,
    sequence_steps: Number(row.sequence_steps ?? 1),
    last_inbound_preview: previewText(row.last_inbound_preview),
    human_window_expires_at: humanWindowExpiry(row.reply_status, row.reply_scheduled_for),
  }));

  return { stats, items };
}

/** The countdown only exists while a fallback row is still awaiting a human. */
function humanWindowExpiry(status: string | null, scheduledFor: string | null): string | null {
  return status === 'awaiting_human' ? scheduledFor : null;
}

/** Old links carried `email_sends.id`; this maps one to its thread. */
export async function draftingItemIdForEmailSend(
  emailSendId: string,
): Promise<string | null> {
  const { rows } = await dbQuery<{ drafting_item_id: string }>(
    'SELECT drafting_item_id::text FROM outreach.email_sends WHERE id = $1::uuid',
    [emailSendId],
  );
  return rows[0]?.drafting_item_id ?? null;
}

export async function getConversationThread(input: {
  ownerId: string;
  draftingItemId: string;
}): Promise<ConversationThread | null> {
  const { rows } = await dbQuery<{
    drafting_item_id: string;
    campaign_id: string;
    campaign_name: string;
    lead_name: string | null;
    lead_company: string | null;
    delivery_settings: unknown;
  }>(
    `SELECT i.id::text AS drafting_item_id,
            w.campaign_id::text,
            c.name AS campaign_name,
            coalesce(
              nullif(trim(i.input_snapshot #>> '{lead,fullName}'), ''),
              nullif(trim(i.input_snapshot #>> '{lead,firstName}'), '')
            ) AS lead_name,
            nullif(trim(i.input_snapshot #>> '{lead,company}'), '') AS lead_company,
            c.delivery_settings
       FROM outreach.drafting_items i
       JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
       JOIN outreach.campaigns c ON c.id = w.campaign_id
      WHERE i.id = $1::uuid
        AND c.owner_id = $2::uuid
      LIMIT 1`,
    [input.draftingItemId, input.ownerId],
  );
  const head = rows[0];
  if (!head) return null;

  // Every sequence step, oldest first.
  const { rows: sends } = await dbQuery<{
    id: string;
    subject: string;
    to_email: string;
    sequence_number: number;
    at: string;
    status: string;
    reply_suppressed: boolean;
    body_text: string | null;
  }>(
    `SELECT s.id::text,
            s.subject,
            s.to_email,
            s.sequence_number,
            coalesce(s.sent_at, s.created_at)::text AS at,
            s.status,
            (s.reply_suppressed_at IS NOT NULL) AS reply_suppressed,
            CASE WHEN s.sequence_number = 1 THEN d.body_text ELSE NULL END AS body_text
       FROM outreach.email_sends s
       LEFT JOIN outreach.email_drafts d ON d.drafting_item_id = s.drafting_item_id
      WHERE s.drafting_item_id = $1::uuid
      ORDER BY s.sequence_number ASC, s.created_at ASC`,
    [input.draftingItemId],
  );
  if (!sends.length) return null;

  const { rows: inbounds } = await dbQuery<{
    id: string;
    subject: string | null;
    text_body: string | null;
    html_body: string | null;
    received_at: string;
    lead_category: string | null;
    sequence_number: number | null;
  }>(
    `SELECT id::text, subject, text_body, html_body, received_at::text,
            lead_category, sequence_number
       FROM outreach.inbound_emails
      WHERE drafting_item_id = $1::uuid
        AND owner_id = $2::uuid
      ORDER BY received_at ASC`,
    [input.draftingItemId, input.ownerId],
  );

  const { rows: replies } = await dbQuery<{
    id: string;
    subject: string | null;
    body_text: string | null;
    sent_at: string | null;
    scheduled_for: string;
    status: string;
    kind: string;
    disposition: string | null;
    defer_until: string | null;
    defer_reason: string | null;
    error_message: string | null;
  }>(
    `SELECT id::text, subject, body_text, sent_at::text, scheduled_for::text,
            status, kind, disposition, defer_until::text, defer_reason, error_message
       FROM outreach.reply_sends
      WHERE drafting_item_id = $1::uuid
        AND status <> 'cancelled'
      ORDER BY coalesce(sent_at, scheduled_for, created_at) ASC`,
    [input.draftingItemId],
  );

  const messages: ConversationThreadMessage[] = sends.map((send) => ({
    id: `outbound:${send.id}`,
    role: 'outbound' as const,
    subject: send.subject,
    body_text: send.body_text,
    at: send.at,
    status: send.status,
    sequence_number: send.sequence_number,
  }));

  for (const inbound of inbounds) {
    messages.push({
      id: inbound.id,
      role: 'inbound',
      subject: inbound.subject,
      body_text: inbound.text_body || stripHtml(inbound.html_body),
      at: inbound.received_at,
      sequence_number: inbound.sequence_number,
      lead_category: inbound.lead_category,
    });
  }

  let latestReplyStatus: string | null = null;
  let humanWindowExpiresAt: string | null = null;
  for (const reply of replies) {
    latestReplyStatus = reply.status;
    if (reply.status === 'awaiting_human') humanWindowExpiresAt = reply.scheduled_for;

    const isScheduledFollowup = reply.kind === 'followup' && reply.status === 'scheduled';
    const role = reply.kind === 'human'
      ? 'human_reply'
      : isScheduledFollowup
        ? 'scheduled_followup'
        : 'auto_reply';

    messages.push({
      id: reply.id,
      role,
      subject: reply.subject,
      body_text: reply.body_text
        || (isScheduledFollowup
          ? `Scheduled follow-up${reply.defer_until ? ` for ${reply.defer_until}` : ''}${
            reply.defer_reason ? ` · ${reply.defer_reason}` : ''
          }`
          : null),
      at: reply.sent_at ?? reply.scheduled_for,
      status: reply.status,
      error_message: reply.error_message,
      kind: reply.kind,
      disposition: reply.disposition,
      defer_until: reply.defer_until,
      defer_reason: reply.defer_reason,
    });
  }

  messages.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const { resolveDeliverySettings } = await import('@/lib/smartlead/delivery-settings');
  const settings = resolveDeliverySettings(head.delivery_settings);
  const suppressed = sends.some((send) => send.reply_suppressed);
  const latestCategory = [...inbounds].reverse().find((row) => row.lead_category)?.lead_category
    ?? null;

  return {
    drafting_item_id: head.drafting_item_id,
    email_send_id: sends[0].id,
    campaign_id: head.campaign_id,
    campaign_name: head.campaign_name,
    campaign_href: `/campaigns/${head.campaign_id}/draft`,
    lead_name: head.lead_name,
    lead_company: head.lead_company,
    lead_email: sends[0].to_email,
    messages,
    reply_status: latestReplyStatus,
    reply_suppressed: suppressed,
    lead_category: latestCategory,
    human_window_expires_at: humanWindowExpiresAt,
    fallback_enabled: settings.reply_fallback === 'claude',
    can_reply: !suppressed && inbounds.length > 0,
  };
}
