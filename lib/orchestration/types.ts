import type { IdentitySlug } from '@/lib/delivery-states';

export const WORK_KINDS = [
  'run.process',
  'upload.extract',
  'run.prepare',
  'run.enrich',
  'research.company',
  'research.profile_rescue',
  'research.email_rescue',
  'run.finalize',
  'domain.verify',
  'mailbox.lead',
  'mailbox.run',
  'pre_enriched.ingest',
  'pre_enriched.extract_file',
  'pre_enriched.assemble',
  'drafting.run.start',
  'drafting.job.verify_mailbox',
  'drafting.job.process',
  'drafting.job.write',
  'email.send',
  'reply.respond',
  'reply.followup',
  'dashboards.daily_update',
  'anthropic.cost_sync',
  'auto.cycle',
  'networking.weekly_ingest',
  'system.reconcile',
  'smartlead.lane_ensure',
  'smartlead.handoff',
  'smartlead.lead_op',
  'smartlead.reconcile',
  'inbox.lifecycle_daily',
  'inbox.health_snapshot',
  'postmaster.daily',
] as const;

export type WorkKind = typeof WORK_KINDS[number];

export const WORK_LANES = [
  'extraction',
  'research',
  'profile_rescue',
  'email_rescue',
  'finalize',
  'domain_verify',
  'mailbox_verify',
  'mailbox_sweep',
  'drafting',
  'drafting_write',
  'email_send',
  'dashboards',
  'maintenance',
  'auto_campaign',
  // Serializes every Smartlead write so one lane cannot burn the shared
  // per-API-key rate limit or reorder handoffs against lane creation.
  'smartlead_api',
] as const;

export type WorkLane = typeof WORK_LANES[number];

export type WorkPayloadMap = {
  'run.process': { runId: string };
  'upload.extract': { runId: string; uploadId: string };
  'run.prepare': { runId: string };
  'run.enrich': { runId: string };
  'research.company': { jobId: string };
  'research.profile_rescue': { jobId: string };
  'research.email_rescue': { jobId: string };
  'run.finalize': { runId: string };
  'domain.verify': { domain: string; runId?: string };
  'mailbox.lead': {
    leadId: string;
    runId: string;
    emailStatus: string;
    email?: string;
  };
  'mailbox.run': { runId: string };
  'pre_enriched.ingest': {
    campaignId: string;
    ownerId: string;
    runId: string;
    senderProfileId?: string;
    idempotencyKey?: string;
  };
  'pre_enriched.extract_file': {
    campaignId: string;
    ownerId: string;
    runId: string;
    uploadId: string;
  };
  'pre_enriched.assemble': {
    campaignId: string;
    ownerId: string;
    runId: string;
    senderProfileId?: string;
    idempotencyKey?: string;
    filesTotal: number;
  };
  'drafting.run.start': { draftingRunId: string };
  'drafting.job.verify_mailbox': { jobId: string };
  'drafting.job.process': { jobId: string };
  'drafting.job.write': { jobId: string };
  'email.send': { queueId: string };
  'reply.respond': { replySendId: string };
  'reply.followup': { replySendId: string };
  'dashboards.daily_update': { reason?: string };
  'anthropic.cost_sync': { reason?: string };
  'auto.cycle': { campaignId: string; ownerId: string };
  'networking.weekly_ingest': { reason?: string };
  'system.reconcile': { reason?: string };
  'smartlead.lane_ensure': { campaignId: string; identitySlug: IdentitySlug };
  'smartlead.handoff': {
    campaignId: string;
    identitySlug: IdentitySlug;
    /** Absent for a "send now" batch, which carries explicit queue ids instead. */
    handoffDate?: string;
    queueIds?: string[];
  };
  'smartlead.lead_op': { op: SmartleadLeadOp; queueId: string };
  'smartlead.reconcile': { reason?: string };
  'inbox.lifecycle_daily': { dayKey: string };
  'inbox.health_snapshot': { dayKey: string };
  'postmaster.daily': { dayKey: string };
};

/** Per-lead corrections the hub pushes to Smartlead after a handoff. */
export const SMARTLEAD_LEAD_OPS = ['delete', 'pause', 'resume', 'block'] as const;
export type SmartleadLeadOp = typeof SMARTLEAD_LEAD_OPS[number];

export type DispatchWork<K extends WorkKind = WorkKind> = {
  kind: K;
  payload: WorkPayloadMap[K];
  dedupeKey: string;
  scopeKey: string;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
  reviveTerminal?: boolean;
};

export type OrchestrationJob<K extends WorkKind = WorkKind> = {
  id: string;
  kind: K;
  lane: WorkLane;
  payload: WorkPayloadMap[K];
  dedupe_key: string;
  scope_key: string;
  status: 'pending' | 'in_flight' | 'done' | 'failed' | 'cancelled';
  priority: number;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  created_at: string;
};

export type WorkHandlerResult = {
  children?: DispatchWork[];
  result?: Record<string, unknown>;
};

export class RetryableWorkError extends Error {
  readonly delayMs: number;
  readonly code: string;

  constructor(message: string, delayMs: number, code = 'retryable_error', options?: ErrorOptions) {
    super(message, options);
    this.name = 'RetryableWorkError';
    this.delayMs = Math.max(250, delayMs);
    this.code = code;
  }
}
