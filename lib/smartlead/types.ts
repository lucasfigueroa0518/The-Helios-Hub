/**
 * Hand-written Smartlead response types.
 *
 * Fields marked `verified S0` were observed in a live GET against the Helios
 * account on 2026-09-16 and are captured in tests/fixtures/smartlead/.
 * Fields marked `docs only` come from api.smartlead.ai and have not been seen
 * on the wire yet — treat them as optional and never key logic on them alone.
 *
 * Smartlead returns several counters as strings ("2", "100%"). Parse with the
 * coercion helpers at the bottom rather than trusting the declared type.
 */

/** `x-ratelimit-limit` observed as 200 on this plan. verified S0 */
export const SMARTLEAD_OBSERVED_RATE_LIMIT = 200;

/** Max leads accepted by POST /campaigns/{id}/leads. verified S0 (docs + enforced) */
export const SMARTLEAD_MAX_LEADS_PER_REQUEST = 400;

/** Max custom_fields key/value pairs per lead. docs only */
export const SMARTLEAD_MAX_CUSTOM_FIELDS = 200;

// ---------------------------------------------------------------------------
// Email accounts
// ---------------------------------------------------------------------------

/** verified S0 — every Helios mailbox reports OUTLOOK (M365 OAuth). */
export type SmartleadAccountType = 'OUTLOOK' | 'GMAIL' | 'SMTP' | (string & {});

/** verified S0 — 'ACTIVE' observed; other values are docs only. */
export type SmartleadWarmupStatus = 'ACTIVE' | 'PAUSED' | 'BLOCKED' | (string & {});

/**
 * Warmup sub-object. The list and detail endpoints disagree, so both spellings
 * are optional here and `normalizeWarmupDetails` reconciles them.
 * verified S0 (both variants observed)
 */
export type SmartleadWarmupDetails = {
  /** detail only. verified S0 */
  id?: number;
  status: SmartleadWarmupStatus; // verified S0
  /** detail spelling. verified S0 */
  created_at?: string;
  /** list spelling of the same value. verified S0 */
  warmup_created_at?: string;
  reply_rate: number; // verified S0
  warmup_key_id: string; // verified S0
  blocked_reason: string | null; // verified S0
  total_sent_count: number; // verified S0
  total_spam_count: number; // verified S0
  warmup_min_count: number; // verified S0
  warmup_max_count: number; // verified S0
  max_email_per_day: number; // verified S0
  /** detail only. verified S0 */
  is_warmup_blocked?: boolean;
  /** number in detail (100), percent string in list ("100%"). verified S0 */
  warmup_reputation: number | string;
};

/** Fields present on both GET /email-accounts/ and GET /email-accounts/{id}/. */
type SmartleadEmailAccountCommon = {
  id: number; // verified S0
  created_at: string; // verified S0
  updated_at: string; // verified S0
  user_id: number; // verified S0
  from_name: string; // verified S0
  from_email: string; // verified S0
  username: string | null; // verified S0
  password: string | null; // verified S0 (null for OAuth accounts)
  smtp_host: string | null; // verified S0
  smtp_port: number | null; // verified S0
  smtp_port_type: string | null; // verified S0
  /** Current daily campaign cap. The PATCH body calls this max_email_per_day. verified S0 */
  message_per_day: number; // verified S0
  different_reply_to_address: string; // verified S0
  is_different_imap_account: boolean; // verified S0
  imap_username: string | null; // verified S0
  imap_password: string | null; // verified S0
  imap_host: string | null; // verified S0
  imap_port: number | null; // verified S0
  imap_port_type: string | null; // verified S0
  signature: string | null; // verified S0
  custom_tracking_domain: string | null; // verified S0
  bcc_email: string | null; // verified S0
  is_smtp_success: boolean; // verified S0
  is_imap_success: boolean; // verified S0
  smtp_failure_error: string | null; // verified S0
  imap_failure_error: string | null; // verified S0
  type: SmartleadAccountType; // verified S0
  daily_sent_count: number; // verified S0
  client_id: number | null; // verified S0
  warmup_details: SmartleadWarmupDetails | null; // verified S0 (null before warmup starts)
};

/** GET /email-accounts/?offset&limit → SmartleadEmailAccountListItem[] */
export type SmartleadEmailAccountListItem = SmartleadEmailAccountCommon & {
  expires_at: string | null; // verified S0 — OAuth token expiry
  minTimeToWaitInMins: number | null; // verified S0
  campaign_count: number; // verified S0
  is_connected_to_campaign: boolean | null; // verified S0
  tags: unknown[]; // verified S0 (always [] so far)
};

/** GET /email-accounts/{id}/ */
export type SmartleadEmailAccount = SmartleadEmailAccountCommon & {
  is_suspended: boolean; // verified S0
  use_whitelabel_credentials: boolean; // verified S0
};

/** GET /email-accounts/{id}/warmup-stats */
export type SmartleadWarmupStats = {
  id: number; // verified S0
  /** Counters arrive as strings at this level. verified S0 */
  sent_count: string | number; // verified S0
  spam_count: string | number; // verified S0
  warmup_email_received_count: string | number; // verified S0
  inbox_count: string | number; // verified S0
  /** Per-day rows carry numbers, and no spam/inbox split. verified S0 */
  stats_by_date: Array<{
    id: number; // verified S0
    date: string; // verified S0 — YYYY-MM-DD
    sent_count: number; // verified S0
    reply_count: number; // verified S0
    save_from_spam_count: number; // verified S0
  }>;
};

/** PATCH /email-accounts/{id} body. docs only — no live write performed in S0. */
export type SmartleadEmailAccountUpdate = {
  max_email_per_day?: number;
  custom_tracking_url?: string;
  bcc?: string;
  signature?: string;
  client_id?: number | null;
  time_to_wait_in_mins?: number;
  from_name?: string;
};

/** POST /email-accounts/{id}/warmup body. docs only */
export type SmartleadWarmupUpdate = {
  warmup_enabled: boolean;
  total_warmup_per_day?: number;
  daily_rampup?: number;
  reply_rate_percentage?: number;
  warmup_key_id?: string;
};

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/** verified S0 — 'DRAFTED' observed; rest are docs only. */
export type SmartleadCampaignStatus =
  | 'DRAFTED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'STOPPED'
  | 'ARCHIVED'
  | (string & {});

/**
 * Tracking opt-outs. The live account reports `[]` (track everything);
 * the opt-out literals below are docs only and are the reason tracking
 * defaults to off in delivery_settings by *adding* both entries.
 */
export type SmartleadTrackSetting = 'DONT_EMAIL_OPEN' | 'DONT_LINK_CLICK' | (string & {});

/** verified S0 — 'REPLY_TO_AN_EMAIL' observed. */
export type SmartleadStopLeadSetting =
  | 'REPLY_TO_AN_EMAIL'
  | 'OPENED_EMAIL'
  | 'CLICKED_LINK'
  | 'NEVER'
  | (string & {});

/** `scheduler_cron_value`. null until a schedule is set. verified S0 (null observed) */
export type SmartleadSchedulerCron = {
  tz: string; // docs only — IANA, e.g. America/New_York
  days: number[]; // docs only — 0=Sunday … 6=Saturday
  startHour: string; // docs only — "09:00"
  endHour: string; // docs only — "17:00"
};

/** GET /campaigns/ and GET /campaigns/{id} */
export type SmartleadCampaign = {
  id: number; // verified S0
  user_id: number; // verified S0
  created_at: string; // verified S0
  updated_at: string; // verified S0
  status: SmartleadCampaignStatus; // verified S0
  name: string; // verified S0
  track_settings: SmartleadTrackSetting[]; // verified S0
  scheduler_cron_value: SmartleadSchedulerCron | null; // verified S0
  min_time_btwn_emails: number; // verified S0
  max_leads_per_day: number; // verified S0
  stop_lead_settings: SmartleadStopLeadSetting; // verified S0
  schedule_start_time: string | null; // verified S0
  enable_ai_esp_matching: boolean; // verified S0
  send_as_plain_text: boolean; // verified S0
  follow_up_percentage: number; // verified S0
  unsubscribe_text: string | null; // verified S0
  parent_campaign_id: number | null; // verified S0
  client_id: number | null; // verified S0
  /** List response only. verified S0 */
  campaign_activity_logs?: Record<string, unknown>;
};

/** POST /campaigns/create response. docs only */
export type SmartleadCreateCampaignResponse = {
  ok?: boolean;
  id: number;
  name?: string;
  created_at?: string;
};

/** GET /campaigns/{id}/sequences — [] on a campaign with no steps. verified S0 */
export type SmartleadSequence = {
  id: number; // docs only
  seq_number: number; // docs only
  seq_delay_details: { delay_in_days: number }; // docs only
  subject: string; // docs only
  email_body: string; // docs only
  sequence_variants?: Array<{
    id?: number;
    subject: string;
    email_body: string;
    variant_label?: string;
  }>;
};

/** GET /campaigns/{id}/statistics */
export type SmartleadCampaignStatistics = {
  total_stats: string | number; // verified S0 (string "0")
  offset: number; // verified S0
  limit: number; // verified S0
  data: SmartleadStatisticsRow[]; // verified S0 (empty on the live campaign)
};

/** Rows inside campaign statistics. docs only — the live campaign has never sent. */
export type SmartleadStatisticsRow = {
  lead_name?: string;
  lead_email: string;
  lead_category?: string | null;
  sequence_number: number | string;
  stats_id?: string;
  email_campaign_seq_id?: number | string;
  seq_variant_id?: number | string;
  email_subject?: string;
  email_message?: string;
  sent_time?: string;
  open_time?: string | null;
  click_time?: string | null;
  reply_time?: string | null;
  open_count?: number | string;
  click_count?: number | string;
  is_unsubscribed?: boolean;
  is_bounced?: boolean;
  email_account_id?: number | string;
};

/** GET /campaigns/{id}/analytics-by-date — every counter is a string. verified S0 */
export type SmartleadCampaignAnalyticsByDate = {
  id: number; // verified S0
  user_id: number; // verified S0
  created_at: string; // verified S0
  status: SmartleadCampaignStatus; // verified S0
  name: string; // verified S0
  start_date: string; // verified S0
  end_date: string; // verified S0
  sent_count: string; // verified S0
  unique_sent_count: string; // verified S0
  open_count: string; // verified S0
  unique_open_count: string; // verified S0
  click_count: string; // verified S0
  unique_click_count: string; // verified S0
  reply_count: string; // verified S0
  block_count: string; // verified S0
  total_count: string; // verified S0
  drafted_count: string; // verified S0
  bounce_count: string; // verified S0
  unsubscribed_count: string; // verified S0
  total_reply_count: string; // verified S0
  /** Replies excluding auto-responders — the OOO-aware reply signal. verified S0 */
  non_ooo_reply_count: string; // verified S0
};

/** GET /campaigns/{id}/email-accounts — [] when nothing is attached. verified S0 */
export type SmartleadCampaignEmailAccount = SmartleadEmailAccountListItem;

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** One entry of the `lead_list` in POST /campaigns/{id}/leads. docs only */
export type SmartleadLeadInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  company_name?: string;
  website?: string;
  location?: string;
  linkedin_profile?: string;
  company_url?: string;
  custom_fields?: Record<string, string>;
};

/** `settings` on the lead-import body. docs only */
export type SmartleadLeadImportSettings = {
  ignore_global_block_list?: boolean;
  ignore_unsubscribe_list?: boolean;
  ignore_duplicate_leads_in_other_campaign?: boolean;
  ignore_community_bounce_list?: boolean;
  /**
   * Asks Smartlead to echo the created lead ids. The base response is counts
   * only, so the handoff sets this and still falls back to a by-email lookup
   * for any row it cannot match.
   */
  return_lead_ids?: boolean;
};

/**
 * POST /campaigns/{id}/leads response.
 *
 * Answers §8.1: the base response carries **counts, not per-lead ids**. With
 * `settings.return_lead_ids` the ids may also appear, but nothing depends on
 * that — `resolveLeadIds` reconciles by email either way.
 * docs only (no live POST in S0)
 */
export type SmartleadAddLeadsResponse = {
  ok?: boolean;
  success?: boolean;
  message?: string;
  upload_count?: number;
  total_leads?: number;
  already_added_to_campaign?: number;
  added_count?: number;
  skipped_count?: number;
  invalid_emails?: string[];
  skipped_leads?: unknown[];
  error?: string;
  unsubscribed_leads?: string[];
  block_count?: number;
  /** Present only when settings.return_lead_ids was sent. docs only */
  lead_ids?: Array<number | { id?: number; lead_id?: number; email?: string }>;
  /** Alternate spelling seen in Smartlead examples. docs only */
  leads?: Array<{ id?: number; lead_id?: number; email?: string }>;
};

/** GET /campaigns/{id}/leads */
export type SmartleadCampaignLeadsPage = {
  total_leads: string | number; // verified S0 (string "0")
  offset: number; // verified S0
  limit: number; // verified S0
  data: SmartleadCampaignLeadRow[]; // verified S0 (empty on the live campaign)
};

/** docs only — the live campaign has no leads. */
export type SmartleadCampaignLeadRow = {
  campaign_lead_map_id?: number;
  status?: string;
  created_at?: string;
  lead: {
    id: number;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
    custom_fields?: Record<string, string> | null;
    is_unsubscribed?: boolean;
  };
};

/**
 * GET /leads/?email=… — returns `{}` for an unknown address. verified S0
 * This is the id-resolution path after a handoff.
 */
export type SmartleadLeadByEmail =
  | Record<string, never>
  | {
      id: number;
      email: string;
      first_name?: string | null;
      last_name?: string | null;
      company_name?: string | null;
      custom_fields?: Record<string, string> | null;
    };

/** GET /campaigns/{campaignId}/leads/{leadId}/message-history. docs only */
export type SmartleadMessageHistory = {
  history?: SmartleadMessageHistoryItem[];
  from?: string;
  to?: string;
};

export type SmartleadMessageHistoryItem = {
  type?: 'SENT' | 'REPLY' | (string & {});
  message_id?: string;
  stats_id?: string;
  time?: string;
  email_body?: string;
  subject?: string;
  email_seq_number?: number | string;
  open_count?: number;
  click_count?: number;
};

/** POST /campaigns/{id}/reply-email-thread body. docs only */
export type SmartleadReplyInThreadInput = {
  email_stats_id?: string;
  email_body: string;
  reply_message_id: string;
  reply_email_time?: string;
  reply_email_body?: string;
  cc?: string;
  bcc?: string;
  add_signature?: boolean;
};

/** Smartlead lead categories surfaced on inbound rows. docs only */
export type SmartleadLeadCategory = {
  id: number;
  name: string;
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Smartlead exposes two webhook APIs:
 *
 *   A. campaign-scoped — POST/GET /campaigns/{id}/webhooks, `event_types[]`
 *   B. account-scoped  — POST /webhook/create, `event_type_map{}` plus
 *                        `association_type: 'user' | 'client' | 'campaign'`
 *
 * We register per lane through (A). verified S0: `GET /campaigns/{id}/webhooks`
 * answers 200 `[]`, while `GET /webhooks` is 404 — so (A) is the form we can
 * list and reconcile against. (B)'s user-level hook would be one registration
 * instead of many, but it cannot be enumerated, which makes a silently missing
 * hook undetectable. §6 step 7's single global registration does not apply.
 */
export type SmartleadWebhook = {
  id: number; // docs only
  name: string; // docs only
  webhook_url: string; // docs only
  event_types: SmartleadWebhookEventType[]; // docs only
  categories?: string[]; // docs only
  is_active?: boolean; // docs only
};

/**
 * Smartlead's own docs disagree on these names: the campaign-scoped API uses
 * `LEAD_REPLIED` / `EMAIL_REPLIED`, the account-scoped one uses `EMAIL_REPLY`.
 * We register the longer `_ED` spellings and the normalizer accepts every
 * variant, so a rename on their side degrades to an ignored event, not a crash.
 */
export type SmartleadWebhookEventType =
  | 'EMAIL_SENT'
  | 'EMAIL_OPENED'
  | 'EMAIL_CLICKED'
  | 'EMAIL_REPLIED'
  | 'EMAIL_BOUNCED'
  | 'EMAIL_UNSUBSCRIBED'
  | 'LEAD_CATEGORY_UPDATED';

/** Canonical hub event names. The normalizer maps every Smartlead spelling here. */
export const HUB_WEBHOOK_EVENTS = [
  'EMAIL_SENT',
  'EMAIL_OPENED',
  'EMAIL_CLICKED',
  'EMAIL_REPLIED',
  'EMAIL_BOUNCED',
  'EMAIL_UNSUBSCRIBED',
  'LEAD_CATEGORY_UPDATED',
] as const;
export type HubWebhookEvent = typeof HUB_WEBHOOK_EVENTS[number];

/** Every spelling Smartlead's docs use, mapped to the hub's canonical name. */
export const SMARTLEAD_EVENT_ALIASES: Record<string, HubWebhookEvent> = {
  EMAIL_SENT: 'EMAIL_SENT',
  LEAD_SENT: 'EMAIL_SENT',
  EMAIL_OPEN: 'EMAIL_OPENED',
  EMAIL_OPENED: 'EMAIL_OPENED',
  LEAD_OPENED: 'EMAIL_OPENED',
  EMAIL_CLICK: 'EMAIL_CLICKED',
  EMAIL_CLICKED: 'EMAIL_CLICKED',
  EMAIL_LINK_CLICK: 'EMAIL_CLICKED',
  LEAD_CLICKED: 'EMAIL_CLICKED',
  EMAIL_REPLY: 'EMAIL_REPLIED',
  EMAIL_REPLIED: 'EMAIL_REPLIED',
  LEAD_REPLIED: 'EMAIL_REPLIED',
  EMAIL_BOUNCE: 'EMAIL_BOUNCED',
  EMAIL_BOUNCED: 'EMAIL_BOUNCED',
  LEAD_BOUNCED: 'EMAIL_BOUNCED',
  EMAIL_UNSUBSCRIBED: 'EMAIL_UNSUBSCRIBED',
  LEAD_UNSUBSCRIBED: 'EMAIL_UNSUBSCRIBED',
  LEAD_CATEGORY_UPDATED: 'LEAD_CATEGORY_UPDATED',
};

/**
 * Inbound webhook body.
 *
 * Smartlead publishes **no payload signature** (the registration body has no
 * secret field and the docs only show a generic HMAC snippet), so the route
 * authenticates by path token — org_settings.smartlead.webhook.mode = 'path_token'.
 * docs only for the field names; both `event` and `event_type` spellings appear
 * across Smartlead's docs, so the normalizer accepts either.
 */
export type SmartleadWebhookPayload = {
  event?: SmartleadWebhookEventType | string;
  event_type?: SmartleadWebhookEventType | string;
  event_timestamp?: string;
  timestamp?: string;
  /** Not documented; the normalizer falls back to a content hash. */
  event_id?: string;
  campaign_id?: number;
  campaign_name?: string;
  lead_id?: number;
  email_account_id?: number;
  sequence_number?: number | string;
  from_email?: string;
  to_email?: string;
  lead?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    custom_fields?: Record<string, string>;
  };
  email?: {
    subject?: string;
    message_id?: string;
    body?: string;
  };
  reply?: {
    subject?: string;
    body?: string;
    received_at?: string;
    message_id?: string;
  };
  /** LEAD_CATEGORY_UPDATED */
  lead_category?: string | { id?: number; name?: string };
  bounce_reason?: string;
  link?: { url?: string; clicked_at?: string };
  opened_count?: number;
  first_opened_at?: string;
  last_opened_at?: string;
};

// ---------------------------------------------------------------------------
// Coercion helpers — Smartlead mixes strings and numbers on the same field.
// ---------------------------------------------------------------------------

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[%,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** `warmup_reputation` is 100 in detail and "100%" in the list. Returns 0–100. */
export function toReputationPercent(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reconciles the list and detail spellings of the warmup sub-object. */
export function normalizeWarmupDetails(details: SmartleadWarmupDetails | null | undefined) {
  if (!details) return null;
  return {
    status: details.status,
    createdAt: details.created_at ?? details.warmup_created_at ?? null,
    replyRatePct: toNumber(details.reply_rate),
    totalSent: toNumber(details.total_sent_count),
    totalSpam: toNumber(details.total_spam_count),
    minPerDay: toNumber(details.warmup_min_count),
    maxPerDay: toNumber(details.warmup_max_count),
    maxEmailPerDay: toNumber(details.max_email_per_day),
    reputationPct: toReputationPercent(details.warmup_reputation),
    blocked: details.is_warmup_blocked ?? Boolean(details.blocked_reason),
    blockedReason: details.blocked_reason,
    warmupKeyId: details.warmup_key_id,
  };
}
