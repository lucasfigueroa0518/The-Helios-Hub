/**
 * Reply transport.
 *
 * The automated reply goes out through Smartlead's `reply-email-thread` so it
 * lands in the same conversation the lead is already in. Three things the old
 * AgentMail path did are deliberately gone:
 *
 *   - threading headers: Smartlead owns `In-Reply-To` / `References`, and a
 *     second set built from provider ids only broke threading;
 *   - inline images: the `cid:` headshot is a spam signal and Smartlead has no
 *     per-message attachment slot;
 *   - signatures: those are account-level in Smartlead.
 */
import { dbQuery } from '@/lib/db';
import { smartleadAdapter, type SmartleadAdapter } from '@/lib/smartlead/adapter';
import { getLaneById } from '@/lib/smartlead/lanes';

export class ReplyTransportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ReplyTransportError';
  }
}

/**
 * Accepts the shape the old transport took so the reply pipeline is unchanged
 * above this line. Fields Smartlead owns are accepted and ignored.
 */
export type ReplySendInput = {
  fromName?: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  itemId: string;
  campaignId: string;
  title?: string | null;
  companyName?: string | null;
  senderProfileId?: string | null;
  headshotStoragePath?: string | null;
  headers?: Record<string, string>;
  linkifyReplyBody?: boolean;
  inReplyToMessageId?: string | null;
  firstName?: string | null;
  adapter?: SmartleadAdapter;
};

export type ReplySendResult = { providerMessageId: string };

export async function sendReplyViaSmartlead(input: ReplySendInput): Promise<ReplySendResult> {
  const adapter = input.adapter ?? smartleadAdapter;
  const thread = await loadThreadRefs(input.itemId);

  if (!thread?.laneId || !thread.replyStatsId) {
    throw new ReplyTransportError(
      'thread_not_in_smartlead',
      `No Smartlead thread for drafting item ${input.itemId}`,
    );
  }
  const lane = await getLaneById(thread.laneId);
  if (!lane?.smartlead_campaign_id) {
    throw new ReplyTransportError('lane_missing', 'The sending lane is no longer available');
  }

  const response = await adapter.replyInThread(lane.smartlead_campaign_id, {
    email_stats_id: thread.replyStatsId,
    email_body: input.bodyText,
    reply_message_id: thread.inboundMessageId ?? undefined,
    reply_email_time: thread.inboundReceivedAt ?? undefined,
    reply_email_body: thread.inboundBody ?? undefined,
    add_signature: false,
  });

  return {
    providerMessageId: response?.message_id ?? response?.stats_id ?? `sl-reply:${Date.now()}`,
  };
}

type ThreadRefs = {
  laneId: string | null;
  /** Smartlead addresses a reply by the stats id of the message being answered. */
  replyStatsId: string | null;
  inboundMessageId: string | null;
  inboundBody: string | null;
  inboundReceivedAt: string | null;
};

async function loadThreadRefs(itemId: string): Promise<ThreadRefs | null> {
  const { rows } = await dbQuery<ThreadRefs>(
    `SELECT es.lane_id::text AS "laneId",
            es.provider_message_id AS "replyStatsId",
            inb.provider_email_id AS "inboundMessageId",
            inb.text_body AS "inboundBody",
            inb.received_at::text AS "inboundReceivedAt"
       FROM outreach.email_sends es
       LEFT JOIN LATERAL (
         SELECT provider_email_id, text_body, received_at
           FROM outreach.inbound_emails
          WHERE drafting_item_id = es.drafting_item_id
          ORDER BY received_at DESC
          LIMIT 1
       ) inb ON true
      WHERE es.drafting_item_id = $1::uuid
        AND es.status = 'sent'
      ORDER BY es.sequence_number DESC
      LIMIT 1`,
    [itemId],
  );
  return rows[0] ?? null;
}
