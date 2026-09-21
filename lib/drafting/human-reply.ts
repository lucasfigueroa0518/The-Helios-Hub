/**
 * Human in-thread reply (§5F).
 *
 * The rule is cancel first, send second. A human clicking Send inside the
 * five-minute window must atomically take the thread away from the Claude
 * fallback *before* anything leaves the building — otherwise both could send.
 *
 * The one case that cannot be prevented is the worker having already claimed
 * the row a moment earlier. That race is surfaced to the human as a 409 rather
 * than hidden, because two replies from Helios in one thread is worse than one
 * extra confirmation click.
 */
import { dbQuery, dbTransaction } from '@/lib/db';
import { cancelWorkByIds } from '@/lib/orchestration/repository';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { getLaneById } from '@/lib/smartlead/lanes';

export class AutomatedReplyInFlightError extends Error {
  readonly code = 'automated_reply_in_flight';

  constructor(readonly automatedReply: 'sent' | 'in_flight') {
    super(
      automatedReply === 'sent'
        ? 'The automated reply has already gone out on this thread.'
        : 'The automated reply is going out right now.',
    );
    this.name = 'AutomatedReplyInFlightError';
  }
}

export class ThreadNotReplyableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ThreadNotReplyableError';
  }
}

export type HumanReplyInput = {
  draftingItemId: string;
  bodyText: string;
  userId: string;
  confirmDuplicate?: boolean;
  adapter?: SmartleadAdapter;
};

export type HumanReplyResult = {
  replySendId: string;
  cancelledFallback: boolean;
  providerMessageId: string | null;
};

type ThreadContext = {
  ownerId: string;
  campaignId: string;
  emailSendId: string;
  inboundEmailId: string | null;
  laneId: string | null;
  smartleadLeadId: string | null;
  /** Smartlead's stats id for the message being replied to — required by the API. */
  replyStatsId: string | null;
  replyMessageId: string | null;
  replyBody: string | null;
  replyTime: string | null;
  suppressedAt: string | null;
};

export async function sendHumanReply(input: HumanReplyInput): Promise<HumanReplyResult> {
  const adapter = input.adapter ?? smartleadAdapter;
  const body = input.bodyText.trim();
  if (!body) throw new ThreadNotReplyableError('empty_body', 'A reply body is required.');

  const thread = await loadThread(input.draftingItemId);
  if (!thread) throw new ThreadNotReplyableError('thread_not_found', 'No such conversation.');
  if (thread.suppressedAt) {
    throw new ThreadNotReplyableError('thread_suppressed', 'This thread is suppressed.');
  }

  // Step 1 — take the thread, in one transaction, before any network call.
  const claim = await dbTransaction(async (client) => {
    const cancelled = await client.query<{ id: string; orchestration_job_id: string | null }>(
      `UPDATE outreach.reply_sends
          SET status = 'cancelled',
              cancel_reason = 'human_replied',
              cancelled_at = now(),
              updated_at = now()
        WHERE drafting_item_id = $1 AND status = 'awaiting_human'
        RETURNING id::text, orchestration_job_id::text`,
      [input.draftingItemId],
    );

    const jobIds = cancelled.rows
      .map((row) => row.orchestration_job_id)
      .filter((id): id is string => Boolean(id));
    if (jobIds.length) await cancelWorkByIds(jobIds, client);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO outreach.reply_sends (
         owner_id, campaign_id, inbound_email_id, drafting_item_id, email_send_id,
         status, kind, body_text, scheduled_for, human_user_id
       ) VALUES ($1, $2, $3, $4, $5, 'drafting', 'human', $6, now(), $7)
       RETURNING id::text`,
      [
        thread.ownerId,
        thread.campaignId,
        thread.inboundEmailId,
        input.draftingItemId,
        thread.emailSendId,
        body,
        input.userId,
      ],
    );

    return { cancelled: cancelled.rowCount ?? 0, replySendId: inserted.rows[0].id };
  });

  // Step 2 — nothing to cancel means either no fallback was pending, or the
  // worker beat us to it. Only the second case is a problem.
  if (claim.cancelled === 0 && !input.confirmDuplicate) {
    const inFlight = await recentAutomatedReply(input.draftingItemId);
    if (inFlight) {
      await dbQuery(
        `UPDATE outreach.reply_sends
            SET status = 'cancelled', cancel_reason = 'superseded_by_automated',
                cancelled_at = now(), updated_at = now()
          WHERE id = $1`,
        [claim.replySendId],
      );
      throw new AutomatedReplyInFlightError(inFlight);
    }
  }

  // Step 3 — send. A failure leaves the human row failed and does **not**
  // revive the cancelled fallback: from here the human owns the thread.
  try {
    if (!thread.laneId || !thread.smartleadLeadId || !thread.replyStatsId) {
      throw new ThreadNotReplyableError(
        'thread_not_in_smartlead',
        'This conversation has no Smartlead thread to reply into.',
      );
    }
    const lane = await getLaneById(thread.laneId);
    if (!lane?.smartlead_campaign_id) {
      throw new ThreadNotReplyableError('lane_missing', 'The sending lane is no longer available.');
    }

    const response = await adapter.replyInThread(lane.smartlead_campaign_id, {
      email_stats_id: thread.replyStatsId,
      email_body: body,
      reply_message_id: thread.replyMessageId ?? undefined,
      reply_email_time: thread.replyTime ?? undefined,
      reply_email_body: thread.replyBody ?? undefined,
      // Signatures are account-level in Smartlead; the hub never inlines one.
      add_signature: false,
    });

    await dbQuery(
      `UPDATE outreach.reply_sends
          SET status = 'sent', sent_at = now(),
              provider_message_id = $2, error_message = NULL, updated_at = now()
        WHERE id = $1`,
      [claim.replySendId, response?.message_id ?? null],
    );

    return {
      replySendId: claim.replySendId,
      cancelledFallback: claim.cancelled > 0,
      providerMessageId: response?.message_id ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dbQuery(
      `UPDATE outreach.reply_sends
          SET status = 'failed', error_message = $2, updated_at = now()
        WHERE id = $1`,
      [claim.replySendId, message.slice(0, 1000)],
    );
    throw error;
  }
}

/**
 * Is there an automated reply on this thread that has fired or is firing?
 * A ten-minute window covers the five-minute delay plus drafting time.
 */
async function recentAutomatedReply(
  draftingItemId: string,
): Promise<'sent' | 'in_flight' | null> {
  const { rows } = await dbQuery<{ status: string }>(
    `SELECT status
       FROM outreach.reply_sends
      WHERE drafting_item_id = $1
        AND kind = 'immediate'
        AND status IN ('drafting', 'sent')
        AND updated_at > now() - interval '10 minutes'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [draftingItemId],
  );
  if (!rows[0]) return null;
  return rows[0].status === 'sent' ? 'sent' : 'in_flight';
}

async function loadThread(draftingItemId: string): Promise<ThreadContext | null> {
  const { rows } = await dbQuery<{
    owner_id: string;
    campaign_id: string;
    email_send_id: string;
    inbound_email_id: string | null;
    lane_id: string | null;
    smartlead_lead_id: string | null;
    reply_stats_id: string | null;
    reply_message_id: string | null;
    reply_body: string | null;
    reply_time: string | null;
    suppressed_at: string | null;
  }>(
    `SELECT q.owner_id::text,
            es.drafting_item_id::text AS drafting_item_id,
            w.campaign_id::text,
            es.id::text AS email_send_id,
            inb.id::text AS inbound_email_id,
            es.lane_id::text,
            es.smartlead_lead_id::text,
            -- Smartlead replies are addressed by the stats id of the message
            -- being answered, which arrives as the send's provider_message_id.
            es.provider_message_id AS reply_stats_id,
            inb.provider_email_id AS reply_message_id,
            inb.text_body AS reply_body,
            inb.received_at::text AS reply_time,
            es.reply_suppressed_at::text AS suppressed_at
       FROM outreach.email_sends es
       JOIN outreach.drafting_items i ON i.id = es.drafting_item_id
       JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
       LEFT JOIN LATERAL (
         SELECT id, provider_email_id, text_body, received_at, owner_id
           FROM outreach.inbound_emails
          WHERE drafting_item_id = es.drafting_item_id
          ORDER BY received_at DESC
          LIMIT 1
       ) inb ON true
       LEFT JOIN LATERAL (
         SELECT owner_id
           FROM outreach.email_send_queue
          WHERE drafting_item_id = es.drafting_item_id
          ORDER BY updated_at DESC
          LIMIT 1
       ) q ON true
      WHERE es.drafting_item_id = $1
        AND es.status = 'sent'
      ORDER BY es.sequence_number DESC
      LIMIT 1`,
    [draftingItemId],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    campaignId: row.campaign_id,
    emailSendId: row.email_send_id,
    inboundEmailId: row.inbound_email_id,
    laneId: row.lane_id,
    smartleadLeadId: row.smartlead_lead_id,
    replyStatsId: row.reply_stats_id,
    replyMessageId: row.reply_message_id,
    replyBody: row.reply_body,
    replyTime: row.reply_time,
    suppressedAt: row.suppressed_at,
  };
}
