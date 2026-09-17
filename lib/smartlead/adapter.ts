/**
 * The provider seam. Every Smartlead call in the app goes through here, so
 * tests stub `fetch` once and nothing else needs to know the wire format.
 *
 * Two invariants hold for every function below:
 *   - campaign send ops check the kill switch first;
 *   - account + warmup ops need an API key, even while sending is off;
 *   - endpoints and payload shapes are the ones recorded in
 *     docs/smartlead-s0-findings.md, not the ones the build plan guessed.
 */
import { assertSmartleadApiKey, assertSmartleadEnabled } from '@/lib/smartlead/enabled';
import { smartleadPaginate, smartleadRequest } from '@/lib/smartlead/client';
import {
  SMARTLEAD_MAX_LEADS_PER_REQUEST,
  type SmartleadAddLeadsResponse,
  type SmartleadCampaign,
  type SmartleadCampaignAnalyticsByDate,
  type SmartleadCampaignEmailAccount,
  type SmartleadCampaignLeadsPage,
  type SmartleadCampaignStatistics,
  type SmartleadCreateCampaignResponse,
  type SmartleadEmailAccount,
  type SmartleadEmailAccountListItem,
  type SmartleadEmailAccountUpdate,
  type SmartleadLeadByEmail,
  type SmartleadLeadImportSettings,
  type SmartleadLeadInput,
  type SmartleadMessageHistory,
  type SmartleadSequence,
  type SmartleadWarmupStats,
  type SmartleadWebhook,
  type SmartleadWebhookEventType,
} from '@/lib/smartlead/types';

/**
 * Wraps an operation so the kill switch is enforced before any I/O. The wrapper
 * is `async` so a disabled call *rejects* rather than throwing synchronously —
 * otherwise a caller's `.catch()` would never see it.
 */
function op<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    assertSmartleadEnabled(name);
    return fn(...args);
  };
}

/** Account + warmup: allowed with an API key even while campaign sending is off. */
function opAccount<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    assertSmartleadApiKey(name);
    return fn(...args);
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

// ---------------------------------------------------------------------------
// Email accounts
// ---------------------------------------------------------------------------

export const listEmailAccounts = opAccount('listEmailAccounts', async (): Promise<
  SmartleadEmailAccountListItem[]
> => smartleadPaginate<SmartleadEmailAccountListItem>('/email-accounts/', { limit: 100 }));

export const getEmailAccount = opAccount('getEmailAccount', async (accountId: number) =>
  smartleadRequest<SmartleadEmailAccount>(`/email-accounts/${accountId}/`));

/** POST, not PATCH — Smartlead's account update endpoint is a POST. */
export const updateEmailAccount = opAccount(
  'updateEmailAccount',
  async (accountId: number, patch: SmartleadEmailAccountUpdate) =>
    smartleadRequest<{ ok?: boolean }>(`/email-accounts/${accountId}`, {
      method: 'POST',
      body: patch,
    }),
);

export type WarmupSettings = {
  warmup_enabled: boolean;
  total_warmup_per_day?: number;
  daily_rampup?: number;
  reply_rate_percentage?: number;
  auto_adjust_warmup?: boolean;
  is_rampup_enabled?: boolean;
};

/** Smartlead 400s below 5 and above 20 (`"daily_rampup" must be larger than or equal to 5`). */
const WARMUP_RAMPUP_MIN = 5;
const WARMUP_RAMPUP_MAX = 20;

function clampWarmupRampup(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return WARMUP_RAMPUP_MIN;
  return Math.min(WARMUP_RAMPUP_MAX, Math.max(WARMUP_RAMPUP_MIN, n));
}

export const setWarmup = opAccount('setWarmup', async (accountId: number, settings: WarmupSettings) =>
  smartleadRequest<{ ok?: boolean }>(`/email-accounts/${accountId}/warmup`, {
    method: 'POST',
    body: {
      ...settings,
      daily_rampup: clampWarmupRampup(settings.daily_rampup),
      is_rampup_enabled: settings.is_rampup_enabled ?? settings.warmup_enabled,
    },
  }));

export const warmupStats = opAccount('warmupStats', async (accountId: number) =>
  smartleadRequest<SmartleadWarmupStats>(`/email-accounts/${accountId}/warmup-stats`));

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

export const listCampaigns = op('listCampaigns', async () =>
  smartleadRequest<SmartleadCampaign[]>('/campaigns/'));

export const getCampaign = op('getCampaign', async (campaignId: number) =>
  smartleadRequest<SmartleadCampaign>(`/campaigns/${campaignId}`));

export const createCampaign = op('createCampaign', async (name: string) =>
  smartleadRequest<SmartleadCreateCampaignResponse>('/campaigns/create', {
    method: 'POST',
    body: { name },
  }));

export type CampaignSettingsInput = {
  /** Opt-outs. An empty array means Smartlead tracks everything. */
  track_settings?: string[];
  stop_lead_settings?: string;
  unsubscribe_text?: string;
  send_as_plain_text?: boolean;
  enable_ai_esp_matching?: boolean;
  max_leads_per_day?: number;
  min_time_between_emails?: number;
  follow_up_percentage?: number;
};

export const setSettings = op(
  'setSettings',
  async (campaignId: number, settings: CampaignSettingsInput) =>
    smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/settings`, {
      method: 'POST',
      body: settings,
    }),
);

export type CampaignScheduleInput = {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  start_hour: string;
  end_hour: string;
  min_time_btw_emails: number;
  max_new_leads_per_day?: number;
  schedule_start_time?: string | null;
};

/** The body is nested under `schedule`. */
export const setSchedule = op(
  'setSchedule',
  async (campaignId: number, schedule: CampaignScheduleInput) =>
    smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/schedule`, {
      method: 'POST',
      body: { schedule },
    }),
);

export type SequenceStepInput = {
  /** null creates, a number updates. */
  id?: number | null;
  seq_number: number;
  subject: string;
  email_body: string;
  seq_delay_details: { delay_in_days: number };
};

/**
 * Smartlead rejects sequence edits while a campaign is ACTIVE, so callers pause
 * first. `ensureCampaignLane` writes sequences before the lane is started;
 * later edits go through `pauseLane`.
 */
export const setSequences = op(
  'setSequences',
  async (campaignId: number, sequences: SequenceStepInput[]) =>
    smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/sequences`, {
      method: 'POST',
      body: { sequences },
    }),
);

export const getSequences = op('getSequences', async (campaignId: number) =>
  smartleadRequest<SmartleadSequence[]>(`/campaigns/${campaignId}/sequences`));

/** "START" activates — not "ACTIVE", which Smartlead rejects. */
export type CampaignStatusInput = 'START' | 'PAUSED' | 'STOPPED';

export const setStatus = op('setStatus', async (campaignId: number, status: CampaignStatusInput) =>
  smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/status`, {
    method: 'POST',
    body: { status },
  }));

export const listCampaignAccounts = op('listCampaignAccounts', async (campaignId: number) =>
  smartleadRequest<SmartleadCampaignEmailAccount[]>(`/campaigns/${campaignId}/email-accounts`));

export const attachAccounts = op(
  'attachAccounts',
  async (campaignId: number, accountIds: number[]) =>
    smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/email-accounts`, {
      method: 'POST',
      body: { email_account_ids: accountIds },
    }),
);

export const detachAccounts = op(
  'detachAccounts',
  async (campaignId: number, accountIds: number[]) =>
    smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/email-accounts`, {
      method: 'DELETE',
      body: { email_account_ids: accountIds },
    }),
);

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const DEFAULT_LEAD_IMPORT_SETTINGS: SmartleadLeadImportSettings = {
  ignore_global_block_list: false,
  ignore_unsubscribe_list: false,
  ignore_duplicate_leads_in_other_campaign: false,
  return_lead_ids: true,
};

export type HandoffBatchResult = {
  response: SmartleadAddLeadsResponse;
  /** Lower-cased email → Smartlead lead id, for ids the response echoed back. */
  leadIds: Map<string, number>;
};

/**
 * Imports one chunk. Callers chunk with `chunk(leads, SMARTLEAD_MAX_LEADS_PER_REQUEST)`;
 * this refuses an oversized batch rather than letting Smartlead truncate it.
 */
export const handoffLeads = op(
  'handoffLeads',
  async (
    campaignId: number,
    leads: SmartleadLeadInput[],
    settings: SmartleadLeadImportSettings = DEFAULT_LEAD_IMPORT_SETTINGS,
  ): Promise<HandoffBatchResult> => {
    if (leads.length > SMARTLEAD_MAX_LEADS_PER_REQUEST) {
      throw new Error(
        `handoffLeads got ${leads.length} leads; Smartlead accepts at most ${SMARTLEAD_MAX_LEADS_PER_REQUEST}`,
      );
    }
    const response = await smartleadRequest<SmartleadAddLeadsResponse>(
      `/campaigns/${campaignId}/leads`,
      { method: 'POST', body: { lead_list: leads, settings } },
    );
    return { response, leadIds: extractLeadIds(response) };
  },
);

/** Reads whatever id shape came back; an empty map is normal and expected. */
export function extractLeadIds(response: SmartleadAddLeadsResponse): Map<string, number> {
  const ids = new Map<string, number>();
  const rows = [...(response.lead_ids ?? []), ...(response.leads ?? [])];
  for (const row of rows) {
    if (typeof row === 'number' || !row) continue;
    const id = row.lead_id ?? row.id;
    if (row.email && typeof id === 'number') ids.set(row.email.toLowerCase(), id);
  }
  return ids;
}

/** `{}` means "no such lead" — Smartlead answers 200 either way. */
export const findLeadByEmail = op('findLeadByEmail', async (email: string) => {
  const found = await smartleadRequest<SmartleadLeadByEmail>('/leads/', { query: { email } });
  return found && 'id' in found && typeof found.id === 'number' ? found : null;
});

export const listCampaignLeads = op(
  'listCampaignLeads',
  async (campaignId: number, offset: number = 0, limit: number = 100) =>
    smartleadRequest<SmartleadCampaignLeadsPage>(`/campaigns/${campaignId}/leads`, {
      query: { offset, limit },
    }),
);

export const deleteLead = op('deleteLead', async (campaignId: number, leadId: number) =>
  smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/leads/${leadId}`, {
    method: 'DELETE',
  }));

export const pauseLead = op('pauseLead', async (campaignId: number, leadId: number) =>
  smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/leads/${leadId}/pause`, {
    method: 'POST',
  }));

export const resumeLead = op(
  'resumeLead',
  async (campaignId: number, leadId: number, delayDays: number = 0) =>
    smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/leads/${leadId}/resume`, {
      method: 'POST',
      body: { resume_lead_with_delay_days: delayDays },
    }),
);

export const unsubscribeLead = op('unsubscribeLead', async (campaignId: number, leadId: number) =>
  smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/leads/${leadId}/unsubscribe`, {
    method: 'POST',
  }));

/** Takes both bare domains and full addresses. */
export const addToBlockList = op('addToBlockList', async (entries: string[]) =>
  smartleadRequest<{ ok?: boolean }>('/leads/add-domain-block-list', {
    method: 'POST',
    body: { domain_block_list: entries, client_id: null },
  }));

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type ReplyInThreadInput = {
  /** Smartlead's stats id for the message being replied to — required. */
  email_stats_id: string;
  email_body: string;
  reply_message_id?: string;
  reply_email_time?: string;
  reply_email_body?: string;
  cc?: string;
  bcc?: string;
  /** Signatures are account-level, so the hub never inlines one. */
  add_signature?: boolean;
};

export const replyInThread = op(
  'replyInThread',
  async (campaignId: number, input: ReplyInThreadInput) =>
    smartleadRequest<{ ok?: boolean; message_id?: string; stats_id?: string }>(
      `/campaigns/${campaignId}/reply-email-thread`,
      { method: 'POST', body: { add_signature: false, ...input } },
    ),
);

export const messageHistory = op(
  'messageHistory',
  async (campaignId: number, leadId: number) =>
    smartleadRequest<SmartleadMessageHistory>(
      `/campaigns/${campaignId}/leads/${leadId}/message-history`,
    ),
);

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export const campaignStatistics = op(
  'campaignStatistics',
  async (campaignId: number, offset: number = 0, limit: number = 100) =>
    smartleadRequest<SmartleadCampaignStatistics>(`/campaigns/${campaignId}/statistics`, {
      query: { offset, limit },
    }),
);

export const campaignAnalyticsByDate = op(
  'campaignAnalyticsByDate',
  async (campaignId: number, startDate: string, endDate: string) =>
    smartleadRequest<SmartleadCampaignAnalyticsByDate>(
      `/campaigns/${campaignId}/analytics-by-date`,
      { query: { start_date: startDate, end_date: endDate } },
    ),
);

// ---------------------------------------------------------------------------
// Webhooks (campaign-scoped — see types.ts for why not the account-level API)
// ---------------------------------------------------------------------------

export type RegisterWebhookInput = {
  name: string;
  webhookUrl: string;
  events: SmartleadWebhookEventType[];
  /** Pass the existing id to update in place instead of creating a duplicate. */
  id?: number | null;
};

export const registerWebhook = op(
  'registerWebhook',
  async (campaignId: number, input: RegisterWebhookInput) =>
    smartleadRequest<SmartleadWebhook>(`/campaigns/${campaignId}/webhooks`, {
      method: 'POST',
      body: {
        id: input.id ?? null,
        name: input.name,
        webhook_url: input.webhookUrl,
        event_types: input.events,
        categories: [],
      },
    }),
);

export const listWebhooks = op('listWebhooks', async (campaignId: number) =>
  smartleadRequest<SmartleadWebhook[]>(`/campaigns/${campaignId}/webhooks`));

export const deleteWebhook = op('deleteWebhook', async (campaignId: number, webhookId: number) =>
  smartleadRequest<{ ok?: boolean }>(`/campaigns/${campaignId}/webhooks`, {
    method: 'DELETE',
    body: { id: webhookId },
  }));

/** Everything the app may do to Smartlead, in one object for stubbing. */
export const smartleadAdapter = {
  listEmailAccounts,
  getEmailAccount,
  updateEmailAccount,
  setWarmup,
  warmupStats,
  listCampaigns,
  getCampaign,
  createCampaign,
  setSettings,
  setSchedule,
  setSequences,
  getSequences,
  setStatus,
  listCampaignAccounts,
  attachAccounts,
  detachAccounts,
  handoffLeads,
  findLeadByEmail,
  listCampaignLeads,
  deleteLead,
  pauseLead,
  resumeLead,
  unsubscribeLead,
  addToBlockList,
  replyInThread,
  messageHistory,
  campaignStatistics,
  campaignAnalyticsByDate,
  registerWebhook,
  listWebhooks,
  deleteWebhook,
};

export type SmartleadAdapter = typeof smartleadAdapter;
