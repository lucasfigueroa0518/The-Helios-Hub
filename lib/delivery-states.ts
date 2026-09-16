/**
 * The state vocabularies the Smartlead delivery schema encodes as CHECK
 * constraints. Everything that reads or writes these columns imports from
 * here, and tests/smartlead-schema.test.ts asserts that
 * db/smartlead_schema.sql still spells them the same way — a drifted CHECK
 * fails at test time instead of at INSERT time in production.
 */

/**
 * `sending` is the retired AgentMail state. It stays in the vocabulary so
 * historical rows remain valid; nothing writes it any more.
 */
export const EMAIL_SEND_QUEUE_STATUSES = [
  'queued',
  'handing_off',
  'handed_off',
  'sending',
  'sent',
  'cancelled',
  'failed',
] as const;
export type EmailSendQueueStatus = typeof EMAIL_SEND_QUEUE_STATUSES[number];

/** Queue rows in these states occupy the one-live-row-per-item slot. */
export const LIVE_QUEUE_STATUSES = ['queued', 'handing_off', 'handed_off'] as const;
export type LiveQueueStatus = typeof LIVE_QUEUE_STATUSES[number];

export const LANE_STATUSES = ['creating', 'ready', 'paused', 'error'] as const;
export type LaneStatus = typeof LANE_STATUSES[number];

export const IDENTITY_SLUGS = ['lucas', 'tommy'] as const;
export type IdentitySlug = typeof IDENTITY_SLUGS[number];

export const LIFECYCLE_STAGES = [
  'provisioning',
  'warming',
  'ramping',
  'production',
  'resting',
  'retired',
] as const;
export type LifecycleStage = typeof LIFECYCLE_STAGES[number];

/** Stages that may send campaign mail, and so may be attached to a lane. */
export const SENDING_STAGES = ['ramping', 'production'] as const;

export const CONTACT_STATUSES = [
  'active',
  'bounced',
  'unsubscribed',
  'complained',
  'blocked',
] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

export const REPLY_SEND_STATUSES = [
  'queued',
  'awaiting_human',
  'drafting',
  'sent',
  'failed',
  'skipped',
  'scheduled',
  'cancelled',
] as const;
export type ReplySendStatus = typeof REPLY_SEND_STATUSES[number];

export const REPLY_SEND_KINDS = ['immediate', 'followup', 'human'] as const;
export type ReplySendKind = typeof REPLY_SEND_KINDS[number];

export const COST_PHASES = ['enrichment', 'drafting', 'delivery', 'subscription'] as const;
export type CostPhaseWithDelivery = typeof COST_PHASES[number];

export const HEALTH_SCOPES = ['inbox', 'domain'] as const;
export type HealthScope = typeof HEALTH_SCOPES[number];

export const HEALTH_SOURCES = ['smartlead_warmup', 'postmaster', 'forecast'] as const;
export type HealthSource = typeof HEALTH_SOURCES[number];

export const HEALTH_STATUSES = ['ok', 'no_data', 'error'] as const;
export type HealthStatus = typeof HEALTH_STATUSES[number];

/** Per-campaign behaviour when nobody replies inside the 5-minute window. */
export const REPLY_FALLBACKS = ['claude', 'human_only'] as const;
export type ReplyFallback = typeof REPLY_FALLBACKS[number];

/** Why a queue row has no handoff date yet. Surfaced on the Queue board. */
export const WAITING_REASONS = ['no_capacity', 'lane_not_ready', 'monthly_ceiling'] as const;
export type WaitingReason = typeof WAITING_REASONS[number];
