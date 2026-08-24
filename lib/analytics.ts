/**
 * Outreach Analytics Hub engine with multi-filtering and spend + conversion metrics.
 */

import { SENDER_IDENTITY_DEFAULTS, inferIdentitySlug } from '@/lib/agentmail-inboxes';
import {
  applyWorkerShare,
  classifySpendIdentity,
  loadLeadCampaignFacts,
  loadUnallocatedSpend,
  prorateGcpWorkerUsd,
  uniqueLeadFacts,
} from '@/lib/analytics-lead-facts';
import { getCloudWorkerSpendState } from '@/lib/billing-guard';
import { dbQuery } from '@/lib/db';

export type AnalyticsPeriod = 'week' | 'month' | 'all' | 'custom';

/** Inclusive lower bound when no earlier campaign/run/send exists. */
export const ANALYTICS_ALL_TIME_START = '2020-01-01T00:00:00.000Z';

export function isAllTimePeriod(period?: string | null): boolean {
  const raw = (period ?? '').trim().toLowerCase().replace(/[_-\s]/g, '');
  return raw === 'all' || raw === 'alltime';
}

export type AnalyticsWindow = {
  period: AnalyticsPeriod;
  from: string;
  to: string;
};

export type AnalyticsMetricBlock = {
  // Volume & Conversion
  emails_sent: number;
  emails_delivered: number;
  emails_bounced: number;
  emails_opened: number;
  emails_clicked: number;
  emails_replied: number;
  delivery_rate: number | null;
  bounce_rate: number | null;
  open_rate: number | null;
  click_rate: number | null;
  reply_rate: number | null;
  campaigns_count: number;
  total_leads: number;
  outreached_leads: number;
  wasted_lead_rate: number | null;

  // Review & Edit stats
  drafts_reviewed: number;
  drafts_approved: number;
  drafts_denied: number;
  approval_rate: number | null;
  drafts_revised: number;
  edit_rate: number | null;

  // Bottom-up spend (per-lead stack, then classified)
  enrichment_cost_usd: number;
  drafting_cost_usd: number;
  reply_cost_usd: number;
  extraction_cost_usd: number;
  apollo_cost_usd: number;
  worker_cost_usd: number;
  agentmail_cost_usd: number;
  dashboard_cost_usd: number;
  unattributed_cost_usd: number;
  outreach_spend_usd: number;
  wasted_spend_usd: number;
  total_spend_usd: number;
  spend_per_outreach_usd: number | null;
  spend_per_lead_usd: number | null;
  cost_per_email_usd: number | null;
  cost_per_enrichment_usd: number | null;
  cost_per_drafting_usd: number | null;
  enrichment_lead_events: number;
  drafting_lead_events: number;
  drafted_leads: number;
  drafting_jobs: number;

  // Orchestration Jobs
  orch_jobs_total: number;
  orch_jobs_retried: number;
  retry_rate: number | null;
};

export type AnalyticsUserRow = AnalyticsMetricBlock & {
  user_id: string;
  user_email: string | null;
  user_name: string | null;
};

export type AnalyticsInboxRow = AnalyticsMetricBlock & {
  from_email: string;
  identity_slug: string;
};

export type AnalyticsIdentityRow = AnalyticsMetricBlock & {
  identity_slug: string;
  display_name: string;
  inboxes: AnalyticsInboxRow[];
};

export type AnalyticsCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  owner_id: string;
  owner_name: string | null;
  owner_email: string | null;
  tags: string[];
  tag_details?: { tag: string; color: string | null }[];
  lead_count: number;
  outreached_leads: number;
  emails_sent: number;
  emails_delivered: number;
  emails_bounced: number;
  emails_opened: number;
  emails_clicked: number;
  emails_replied: number;
  delivery_rate: number | null;
  bounce_rate: number | null;
  open_rate: number | null;
  click_rate: number | null;
  reply_rate: number | null;
  wasted_lead_rate: number | null;
  enrichment_cost_usd: number;
  drafting_cost_usd: number;
  reply_cost_usd: number;
  extraction_cost_usd: number;
  worker_cost_usd: number;
  agentmail_cost_usd: number;
  apollo_cost_usd: number;
  outreach_spend_usd: number;
  wasted_spend_usd: number;
  total_spend_usd: number;
  spend_per_outreach_usd: number | null;
  spend_per_lead_usd: number | null;
  created_at: string;
};

export type AnalyticsSummaryFilters = {
  campaignIds?: string[] | null;
  tags?: string[] | null;
  userId?: string | null;
  identitySlug?: string | null;
  fromEmail?: string | null;
  messageMode?: 'all' | 'ai' | 'custom' | null;
};

export function parseAnalyticsMessageMode(value?: string | null): 'all' | 'ai' | 'custom' {
  return value === 'ai' || value === 'custom' ? value : 'all';
}

export type CloudWorkerSpendSummary = {
  cost_usd: number | null;
  currency_code: string | null;
  updated_at: string | null;
  console_url: string | null;
  detail: string | null;
};

export type AnalyticsSummary = {
  window: AnalyticsWindow;
  filters: {
    campaignIds: string[];
    tags: string[];
    userId: string | null;
    identitySlug: string | null;
    fromEmail: string | null;
    messageMode: 'all' | 'ai' | 'custom';
  };
  available_identities: { slug: string; name: string }[];
  available_inboxes: { email: string; identity_slug: string }[];
  aggregate: AnalyticsMetricBlock;
  cloud_worker_spend: CloudWorkerSpendSummary;
  by_user: AnalyticsUserRow[];
  by_identity: AnalyticsIdentityRow[];
  by_campaign: AnalyticsCampaignRow[];
  available_tags: string[];
  available_campaigns: { id: string; name: string; tags: string[] }[];
  available_users: { id: string; name: string; email: string }[];
  excluded_run_ids: string[];
  notes: string[];
};

export type AnalyticsRunRow = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  run_type: string;
  status: string;
  created_by: string;
  created_by_email: string | null;
  created_by_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  lead_count: number;
  excluded: boolean;
  excluded_at: string | null;
  excluded_by: string | null;
  reason: string | null;
};

function emptyMetrics(): AnalyticsMetricBlock {
  return {
    emails_sent: 0,
    emails_delivered: 0,
    emails_bounced: 0,
    emails_opened: 0,
    emails_clicked: 0,
    emails_replied: 0,
    delivery_rate: null,
    bounce_rate: null,
    open_rate: null,
    click_rate: null,
    reply_rate: null,
    campaigns_count: 0,
    total_leads: 0,
    outreached_leads: 0,
    wasted_lead_rate: null,
    drafts_reviewed: 0,
    drafts_approved: 0,
    drafts_denied: 0,
    approval_rate: null,
    drafts_revised: 0,
    edit_rate: null,
    enrichment_cost_usd: 0,
    drafting_cost_usd: 0,
    reply_cost_usd: 0,
    extraction_cost_usd: 0,
    apollo_cost_usd: 0,
    worker_cost_usd: 0,
    agentmail_cost_usd: 0,
    dashboard_cost_usd: 0,
    unattributed_cost_usd: 0,
    outreach_spend_usd: 0,
    wasted_spend_usd: 0,
    total_spend_usd: 0,
    spend_per_outreach_usd: null,
    spend_per_lead_usd: null,
    cost_per_email_usd: null,
    cost_per_enrichment_usd: null,
    cost_per_drafting_usd: null,
    enrichment_lead_events: 0,
    drafting_lead_events: 0,
    drafted_leads: 0,
    drafting_jobs: 0,
    orch_jobs_total: 0,
    orch_jobs_retried: 0,
    retry_rate: null,
  };
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function perUnit(total: number, count: number): number | null {
  if (count <= 0) return null;
  return total / count;
}

function applySpendIdentity<T extends AnalyticsMetricBlock>(m: T, identity: {
  total_leads: number;
  outreached_leads: number;
  outreach_spend_usd: number;
  wasted_spend_usd: number;
  total_spend_usd: number;
  spend_per_outreach_usd: number | null;
  wasted_lead_rate: number | null;
  enrichment_cost_usd: number;
  drafting_cost_usd: number;
  worker_cost_usd: number;
  agentmail_cost_usd: number;
  apollo_cost_usd: number;
  extraction_cost_usd: number;
  reply_cost_usd: number;
}): T {
  m.total_leads = identity.total_leads;
  m.outreached_leads = identity.outreached_leads;
  m.wasted_lead_rate = identity.wasted_lead_rate;
  m.outreach_spend_usd = identity.outreach_spend_usd;
  m.wasted_spend_usd = identity.wasted_spend_usd;
  m.total_spend_usd = identity.total_spend_usd;
  m.spend_per_outreach_usd = identity.spend_per_outreach_usd;
  m.spend_per_lead_usd = identity.spend_per_outreach_usd;
  m.cost_per_email_usd = identity.spend_per_outreach_usd;
  m.enrichment_cost_usd = identity.enrichment_cost_usd;
  m.drafting_cost_usd = identity.drafting_cost_usd;
  m.worker_cost_usd = identity.worker_cost_usd;
  m.agentmail_cost_usd = identity.agentmail_cost_usd;
  m.apollo_cost_usd = identity.apollo_cost_usd;
  m.extraction_cost_usd = identity.extraction_cost_usd;
  m.reply_cost_usd = identity.reply_cost_usd;
  m.drafted_leads = identity.outreached_leads;
  return m;
}

function finalizeMetrics<T extends AnalyticsMetricBlock>(m: T): T {
  const baseDenominator = m.emails_delivered > 0 ? m.emails_delivered : m.emails_sent;
  const total_spend_usd = m.outreach_spend_usd + m.wasted_spend_usd;
  const spend_per_outreach_usd = m.spend_per_outreach_usd
    ?? perUnit(m.outreach_spend_usd, m.emails_sent);
  return {
    ...m,
    total_spend_usd,
    delivery_rate: rate(m.emails_delivered, m.emails_sent),
    bounce_rate: rate(m.emails_bounced, m.emails_sent),
    open_rate: rate(m.emails_opened, baseDenominator),
    click_rate: rate(m.emails_clicked, baseDenominator),
    reply_rate: rate(m.emails_replied, baseDenominator),
    spend_per_outreach_usd,
    spend_per_lead_usd: spend_per_outreach_usd,
    approval_rate: rate(m.drafts_approved, m.drafts_reviewed),
    cost_per_email_usd: spend_per_outreach_usd,
    wasted_lead_rate: rate(m.total_leads - m.outreached_leads, m.total_leads),
    retry_rate: rate(m.orch_jobs_retried, m.orch_jobs_total),
    edit_rate: rate(m.drafts_revised, Math.max(m.drafts_reviewed, m.drafts_revised)),
  };
}

function toIsoDayStart(d: Date): string {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy.toISOString();
}

function toIsoDayEnd(d: Date): string {
  const copy = new Date(d);
  copy.setUTCHours(23, 59, 59, 999);
  return copy.toISOString();
}

export function resolveAnalyticsWindow(input: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): AnalyticsWindow {
  const now = input.now ?? new Date();
  const periodRaw = (input.period ?? 'week').toLowerCase();
  if (periodRaw === 'custom') {
    if (!input.from || !input.to) throw new Error('Custom range requires from and to (ISO dates)');
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('Invalid from/to date');
    }
    if (from.getTime() > to.getTime()) throw new Error('from must be on or before to');
    return { period: 'custom', from: toIsoDayStart(from), to: toIsoDayEnd(to) };
  }
  if (isAllTimePeriod(periodRaw)) {
    return { period: 'all', from: ANALYTICS_ALL_TIME_START, to: toIsoDayEnd(now) };
  }
  if (periodRaw === 'month') {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 29);
    return { period: 'month', from: toIsoDayStart(from), to: toIsoDayEnd(now) };
  }
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 6);
  return { period: 'week', from: toIsoDayStart(from), to: toIsoDayEnd(now) };
}

async function loadAllTimeFromBound(now: Date): Promise<string> {
  const { rows } = await dbQuery<{ earliest: Date | string | null }>(
    `SELECT least(
       (SELECT min(created_at) FROM outreach.campaigns),
       (SELECT min(started_at) FROM outreach.runs),
       (SELECT min(created_at) FROM outreach.email_sends),
       (SELECT min(created_at) FROM outreach.drafting_job_cost_events)
     ) AS earliest`,
  );
  const earliest = rows[0]?.earliest;
  if (!earliest) return toIsoDayStart(now);
  const parsed = earliest instanceof Date ? earliest : new Date(earliest);
  if (Number.isNaN(parsed.getTime())) return toIsoDayStart(now);
  return toIsoDayStart(parsed);
}

/** Same as resolveAnalyticsWindow, but all-time starts at the earliest real row. */
export async function resolveAnalyticsQueryWindow(input: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): Promise<AnalyticsWindow> {
  const window = resolveAnalyticsWindow(input);
  if (window.period !== 'all') return window;
  return { ...window, from: await loadAllTimeFromBound(input.now ?? new Date()) };
}

async function loadExcludedRunIds(): Promise<string[]> {
  const { rows } = await dbQuery<{ run_id: string }>(
    `SELECT run_id::text AS run_id FROM outreach.analytics_run_exclusions`,
  );
  return rows.map((r) => r.run_id);
}

async function loadExcludedLeadIds(excludedRunIds: string[]): Promise<string[]> {
  if (!excludedRunIds.length) return [];
  const { rows } = await dbQuery<{ lead_id: string }>(
    `SELECT DISTINCT cl.lead_id::text AS lead_id
       FROM outreach.campaign_leads cl
      WHERE cl.run_id = ANY($1::uuid[])
     UNION
     SELECT DISTINCT l.id::text AS lead_id
       FROM outreach.leads l
      WHERE l.source_run_id = ANY($1::uuid[])`,
    [excludedRunIds],
  );
  return rows.map((r) => r.lead_id);
}

function ensureUser(
  map: Map<string, AnalyticsUserRow>,
  userId: string,
  email: string | null = null,
  name: string | null = null,
): AnalyticsUserRow {
  let row = map.get(userId);
  if (!row) {
    row = { user_id: userId, user_email: email, user_name: name, ...emptyMetrics() };
    map.set(userId, row);
  } else {
    if (!row.user_email && email) row.user_email = email;
    if (!row.user_name && name) row.user_name = name;
  }
  return row;
}

export async function getAnalyticsSummary(input: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  campaignIds?: string[] | null;
  tags?: string[] | null;
  userId?: string | null;
  identitySlug?: string | null;
  fromEmail?: string | null;
  messageMode?: string | null;
}): Promise<AnalyticsSummary> {
  const window = await resolveAnalyticsQueryWindow(input);
  const excludedRunIds = await loadExcludedRunIds();
  const excludedLeadList = await loadExcludedLeadIds(excludedRunIds);

  const cleanCampaignIds = input.campaignIds?.filter(Boolean) ?? [];
  const cleanTags = input.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean) ?? [];
  const cleanUserId = input.userId?.trim() || null;
  const cleanIdentitySlug = input.identitySlug?.trim().toLowerCase() || null;
  const cleanFromEmail = input.fromEmail?.trim().toLowerCase() || null;
  const cleanMessageMode = parseAnalyticsMessageMode(input.messageMode);

  // 1. Fetch available filter options (tags, active campaigns, users)
  const [tagsRes, campaignsRes, usersRes] = await Promise.all([
    dbQuery<{ tag: string }>(`SELECT DISTINCT tag FROM outreach.campaign_tags ORDER BY tag ASC`),
    dbQuery<{ id: string; name: string; tags: string[] }>(
      `SELECT c.id::text AS id, c.name,
              COALESCE((SELECT array_agg(ct.tag ORDER BY ct.tag) FROM outreach.campaign_tags ct WHERE ct.campaign_id = c.id), '{}'::text[]) AS tags
         FROM outreach.campaigns c
        WHERE c.status = 'active'
        ORDER BY c.name ASC`,
    ),
    dbQuery<{ id: string; name: string; email: string }>(
      `SELECT id::text AS id, display_name AS name, email FROM outreach.users ORDER BY display_name ASC, email ASC`,
    ),
  ]);

  const available_tags = tagsRes.rows.map((r) => r.tag);
  const available_campaigns = campaignsRes.rows;
  const available_users = usersRes.rows;

  // 2. Resolve matching campaign IDs based on filters
  const { rows: matchingCampaigns } = await dbQuery<{
    id: string;
    name: string;
    owner_id: string;
    owner_name: string | null;
    owner_email: string | null;
    created_at: Date;
    tags: string[];
    tag_details: { tag: string; color: string | null }[];
    lead_count: string;
  }>(
    `SELECT
       c.id::text AS id,
       c.name,
       c.owner_id::text AS owner_id,
       u.display_name AS owner_name,
       u.email AS owner_email,
       c.created_at,
       COALESCE((SELECT array_agg(ct.tag ORDER BY ct.tag) FROM outreach.campaign_tags ct WHERE ct.campaign_id = c.id), '{}'::text[]) AS tags,
       COALESCE((SELECT json_agg(json_build_object('tag', ct.tag, 'color', ct.color) ORDER BY ct.tag) FROM outreach.campaign_tags ct WHERE ct.campaign_id = c.id), '[]'::json) AS tag_details,
       COALESCE((SELECT count(DISTINCT cl.lead_id)::text FROM outreach.campaign_leads cl WHERE cl.campaign_id = c.id), '0') AS lead_count
     FROM outreach.campaigns c
     JOIN outreach.users u ON u.id = c.owner_id
     WHERE ($1::uuid IS NULL OR c.owner_id = $1::uuid)
       AND ($2::uuid[] IS NULL OR cardinality($2::uuid[]) = 0 OR c.id = ANY($2::uuid[]))
       AND ($3::text[] IS NULL OR cardinality($3::text[]) = 0 OR c.id IN (
         SELECT ct.campaign_id FROM outreach.campaign_tags ct WHERE lower(ct.tag) = ANY($3::text[])
       ))
       AND ($4::text IS NULL OR COALESCE(c.message_mode, 'ai') = $4)
     ORDER BY c.updated_at DESC`,
    [
      cleanUserId,
      cleanCampaignIds.length ? cleanCampaignIds : null,
      cleanTags.length ? cleanTags : null,
      cleanMessageMode === 'all' ? null : cleanMessageMode,
    ],
  );

  const matchedCampaignIds = matchingCampaigns.map((c) => c.id);

  // 3. Draft & Engagement statistics grouped by campaign & user
  const { rows: draftRows } = await dbQuery<{
    campaign_id: string;
    user_id: string;
    user_email: string | null;
    user_name: string | null;
    identity_slug: string | null;
    from_email: string | null;
    emails_sent: string;
    emails_delivered: string;
    emails_bounced: string;
    emails_opened: string;
    emails_clicked: string;
    emails_replied: string;
    drafts_approved: string;
    drafts_denied: string;
    drafts_edited: string;
  }>(
    `SELECT
       c.id::text AS campaign_id,
       c.owner_id::text AS user_id,
       u.email AS user_email,
       u.display_name AS user_name,
       si.slug AS identity_slug,
       lower(s.from_email) AS from_email,
       count(*) FILTER (
         WHERE i.delivery_snapshot ? 'sentAt' OR i.delivery_snapshot ? 'gmailMessageId' OR s.status = 'sent'
       )::text AS emails_sent,
       count(*) FILTER (WHERE s.status = 'sent' AND s.bounced_at IS NULL)::text AS emails_delivered,
       count(*) FILTER (WHERE s.bounced_at IS NOT NULL OR s.status = 'bounced')::text AS emails_bounced,
       count(*) FILTER (WHERE s.opened_at IS NOT NULL)::text AS emails_opened,
       count(*) FILTER (WHERE s.clicked_at IS NOT NULL)::text AS emails_clicked,
       count(*) FILTER (WHERE s.replied_at IS NOT NULL)::text AS emails_replied,
       count(*) FILTER (WHERE i.state = 'approved')::text AS drafts_approved,
       count(*) FILTER (
         WHERE i.state IN ('queued_rewrite', 'rewriting', 'failed_rewrite')
       )::text AS drafts_denied,
       count(*) FILTER (WHERE d.manually_edited)::text AS drafts_edited
     FROM outreach.drafting_items i
     JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
     JOIN outreach.campaigns c ON c.id = w.campaign_id
     JOIN outreach.users u ON u.id = c.owner_id
     LEFT JOIN outreach.email_drafts d ON d.drafting_item_id = i.id
     LEFT JOIN outreach.email_sends s ON s.drafting_item_id = i.id AND s.status IN ('sent', 'bounced')
     LEFT JOIN outreach.sender_inboxes ib ON ib.id = s.sender_inbox_id OR lower(ib.email) = lower(s.from_email)
     LEFT JOIN outreach.sender_identities si ON si.id = ib.identity_id
     WHERE i.updated_at >= $1::timestamptz
       AND i.updated_at <= $2::timestamptz
       AND ($3::uuid[] IS NULL OR cardinality($3::uuid[]) = 0 OR c.id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR i.lead_id <> ALL($4::uuid[]))
       AND ($5::text IS NULL OR si.slug = $5)
       AND ($6::text IS NULL OR lower(s.from_email) = $6)
     GROUP BY c.id, c.owner_id, u.email, u.display_name, si.slug, s.from_email`,
    [
      window.from,
      window.to,
      matchedCampaignIds.length ? matchedCampaignIds : ['00000000-0000-0000-0000-000000000000'],
      excludedLeadList.length ? excludedLeadList : null,
      cleanIdentitySlug,
      cleanFromEmail,
    ],
  );

  // 4. Per-lead spend facts (work-row actuals allocated to leads)
  const safeCampaignIds = matchedCampaignIds.length
    ? matchedCampaignIds
    : ['00000000-0000-0000-0000-000000000000'];
  const [rawLeadFacts, unallocated, workerSpend] = await Promise.all([
    loadLeadCampaignFacts({
      from: window.from,
      to: window.to,
      campaignIds: safeCampaignIds,
      excludedLeadIds: excludedLeadList,
      excludedRunIds: excludedRunIds,
    }),
    loadUnallocatedSpend({
      from: window.from,
      to: window.to,
      campaignIds: safeCampaignIds,
    }),
    getCloudWorkerSpendState(),
  ]);
  const workerWindowUsd = prorateGcpWorkerUsd({
    monthToDateUsd: workerSpend.cost_amount,
    windowFrom: new Date(window.from),
    windowTo: new Date(window.to),
  });
  const leadFacts = applyWorkerShare(rawLeadFacts, workerWindowUsd);
  const orgLeadFacts = uniqueLeadFacts(leadFacts);
  const orgIdentity = classifySpendIdentity({
    facts: orgLeadFacts,
    unallocatedWastedUsd: unallocated.total_usd,
  });

  // 5. Orchestration Job Statistics
  const { rows: jobRows } = await dbQuery<{
    campaign_id: string;
    user_id: string;
    jobs_total: string;
    jobs_retried: string;
  }>(
    `SELECT
       c.id::text AS campaign_id,
       c.owner_id::text AS user_id,
       count(*)::text AS jobs_total,
       count(*) FILTER (WHERE coalesce(j.attempt_count, 1) > 1)::text AS jobs_retried
     FROM outreach.drafting_jobs j
     JOIN outreach.drafting_items i ON i.id = j.drafting_item_id
     JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
     JOIN outreach.campaigns c ON c.id = w.campaign_id
     WHERE j.created_at >= $1::timestamptz
       AND j.created_at <= $2::timestamptz
       AND ($3::uuid[] IS NULL OR cardinality($3::uuid[]) = 0 OR c.id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR i.lead_id <> ALL($4::uuid[]))
     GROUP BY c.id, c.owner_id`,
    [
      window.from,
      window.to,
      matchedCampaignIds.length ? matchedCampaignIds : ['00000000-0000-0000-0000-000000000000'],
      excludedLeadList.length ? excludedLeadList : null,
    ],
  );

  const byUser = new Map<string, AnalyticsUserRow>();
  const byIdentity = new Map<string, AnalyticsIdentityRow>();
  const campaignMetrics = new Map<string, {
    emails_sent: number;
    emails_delivered: number;
    emails_bounced: number;
    emails_opened: number;
    emails_clicked: number;
    emails_replied: number;
  }>();

  function emptyCampaignMetrics() {
    return {
      emails_sent: 0,
      emails_delivered: 0,
      emails_bounced: 0,
      emails_opened: 0,
      emails_clicked: 0,
      emails_replied: 0,
    };
  }

  function ensureIdentity(slug: string): AnalyticsIdentityRow {
    const key = slug === 'tommy' ? 'tommy' : 'lucas';
    let row = byIdentity.get(key);
    if (!row) {
      row = {
        identity_slug: key,
        display_name: SENDER_IDENTITY_DEFAULTS[key].displayName,
        inboxes: [],
        ...emptyMetrics(),
      };
      byIdentity.set(key, row);
    }
    return row;
  }

  function ensureInbox(identity: AnalyticsIdentityRow, fromEmail: string): AnalyticsInboxRow {
    const email = fromEmail.trim().toLowerCase();
    let inbox = identity.inboxes.find((row) => row.from_email === email);
    if (!inbox) {
      inbox = { from_email: email, identity_slug: identity.identity_slug, ...emptyMetrics() };
      identity.inboxes.push(inbox);
    }
    return inbox;
  }

  const aggregate = emptyMetrics();
  aggregate.campaigns_count = matchingCampaigns.length;
  aggregate.dashboard_cost_usd = unallocated.dashboard_usd;
  aggregate.unattributed_cost_usd = unallocated.opening_balance_usd;

  for (const row of draftRows) {
    const user = ensureUser(byUser, row.user_id, row.user_email, row.user_name);
    const sent = Number(row.emails_sent);
    const delivered = Number(row.emails_delivered);
    const bounced = Number(row.emails_bounced);
    const opened = Number(row.emails_opened);
    const clicked = Number(row.emails_clicked);
    const replied = Number(row.emails_replied);
    const approved = Number(row.drafts_approved);
    const denied = Number(row.drafts_denied);
    const edited = Number(row.drafts_edited);
    const identity = ensureIdentity(row.identity_slug ?? 'lucas');
    const inbox = row.from_email ? ensureInbox(identity, row.from_email) : null;

    user.emails_sent += sent;
    user.emails_delivered += delivered;
    user.emails_bounced += bounced;
    user.emails_opened += opened;
    user.emails_clicked += clicked;
    user.emails_replied += replied;
    user.drafts_approved += approved;
    user.drafts_denied += denied;
    user.drafts_reviewed += approved + denied;
    user.drafts_revised += edited;

    identity.emails_sent += sent;
    identity.emails_delivered += delivered;
    identity.emails_bounced += bounced;
    identity.emails_replied += replied;
    if (inbox) {
      inbox.emails_sent += sent;
      inbox.emails_delivered += delivered;
      inbox.emails_bounced += bounced;
      inbox.emails_replied += replied;
    }

    aggregate.emails_sent += sent;
    aggregate.emails_delivered += delivered;
    aggregate.emails_bounced += bounced;
    aggregate.emails_opened += opened;
    aggregate.emails_clicked += clicked;
    aggregate.emails_replied += replied;
    aggregate.drafts_approved += approved;
    aggregate.drafts_denied += denied;
    aggregate.drafts_reviewed += approved + denied;
    aggregate.drafts_revised += edited;

    const cm = campaignMetrics.get(row.campaign_id) ?? emptyCampaignMetrics();
    cm.emails_sent += sent;
    cm.emails_delivered += delivered;
    cm.emails_bounced += bounced;
    cm.emails_opened += opened;
    cm.emails_clicked += clicked;
    cm.emails_replied += replied;
    campaignMetrics.set(row.campaign_id, cm);
  }

  applySpendIdentity(aggregate, orgIdentity);
  aggregate.drafted_leads = orgIdentity.outreached_leads;

  const factsByOwner = new Map<string, typeof leadFacts>();
  const factsByCampaign = new Map<string, typeof leadFacts>();
  for (const fact of leadFacts) {
    const ownerFacts = factsByOwner.get(fact.owner_id) ?? [];
    ownerFacts.push(fact);
    factsByOwner.set(fact.owner_id, ownerFacts);
    const campFacts = factsByCampaign.get(fact.campaign_id) ?? [];
    campFacts.push(fact);
    factsByCampaign.set(fact.campaign_id, campFacts);
  }

  for (const [ownerId, facts] of factsByOwner) {
    const user = ensureUser(byUser, ownerId);
    applySpendIdentity(user, classifySpendIdentity({ facts }));
  }

  const uniqueOutreached = uniqueLeadFacts(leadFacts.filter((fact) => fact.is_outreached));
  for (const fact of uniqueOutreached) {
    if (!fact.from_email && !fact.identity_slug) continue;
    const slug = inferIdentitySlug({
      identitySlug: fact.identity_slug,
      workEmail: fact.from_email,
    });
    const identity = ensureIdentity(slug);
    const inbox = fact.from_email ? ensureInbox(identity, fact.from_email) : null;
    identity.outreach_spend_usd += fact.stack_usd;
    identity.total_spend_usd += fact.stack_usd;
    identity.enrichment_cost_usd += fact.enrichment_usd;
    identity.drafting_cost_usd += fact.drafting_usd;
    identity.worker_cost_usd += fact.worker_usd;
    identity.agentmail_cost_usd += fact.agentmail_usd;
    identity.apollo_cost_usd += fact.apollo_usd;
    identity.outreached_leads += 1;
    identity.total_leads += 1;
    if (inbox) {
      inbox.outreach_spend_usd += fact.stack_usd;
      inbox.total_spend_usd += fact.stack_usd;
      inbox.enrichment_cost_usd += fact.enrichment_usd;
      inbox.drafting_cost_usd += fact.drafting_usd;
      inbox.worker_cost_usd += fact.worker_usd;
      inbox.agentmail_cost_usd += fact.agentmail_usd;
      inbox.apollo_cost_usd += fact.apollo_usd;
      inbox.outreached_leads += 1;
      inbox.total_leads += 1;
    }
  }

  for (const row of jobRows) {
    const user = ensureUser(byUser, row.user_id);
    const total = Number(row.jobs_total);
    const retried = Number(row.jobs_retried);
    user.orch_jobs_total += total;
    user.orch_jobs_retried += retried;
    aggregate.orch_jobs_total += total;
    aggregate.orch_jobs_retried += retried;
  }

  const by_campaign: AnalyticsCampaignRow[] = matchingCampaigns.map((camp) => {
    const cm = campaignMetrics.get(camp.id) ?? emptyCampaignMetrics();
    const campFacts = factsByCampaign.get(camp.id) ?? [];
    const identity = classifySpendIdentity({ facts: campFacts });
    const baseDenominator = cm.emails_delivered > 0 ? cm.emails_delivered : cm.emails_sent;

    return {
      campaign_id: camp.id,
      campaign_name: camp.name,
      owner_id: camp.owner_id,
      owner_name: camp.owner_name,
      owner_email: camp.owner_email,
      tags: camp.tags,
      tag_details: camp.tag_details,
      lead_count: identity.total_leads,
      outreached_leads: identity.outreached_leads,
      emails_sent: cm.emails_sent,
      emails_delivered: cm.emails_delivered,
      emails_bounced: cm.emails_bounced,
      emails_opened: cm.emails_opened,
      emails_clicked: cm.emails_clicked,
      emails_replied: cm.emails_replied,
      delivery_rate: rate(cm.emails_delivered, cm.emails_sent),
      bounce_rate: rate(cm.emails_bounced, cm.emails_sent),
      open_rate: rate(cm.emails_opened, baseDenominator),
      click_rate: rate(cm.emails_clicked, baseDenominator),
      reply_rate: rate(cm.emails_replied, baseDenominator),
      wasted_lead_rate: identity.wasted_lead_rate,
      enrichment_cost_usd: identity.enrichment_cost_usd,
      drafting_cost_usd: identity.drafting_cost_usd,
      reply_cost_usd: identity.reply_cost_usd,
      extraction_cost_usd: identity.extraction_cost_usd,
      worker_cost_usd: identity.worker_cost_usd,
      agentmail_cost_usd: identity.agentmail_cost_usd,
      apollo_cost_usd: identity.apollo_cost_usd,
      outreach_spend_usd: identity.outreach_spend_usd,
      wasted_spend_usd: identity.wasted_spend_usd,
      total_spend_usd: identity.total_spend_usd,
      spend_per_outreach_usd: identity.spend_per_outreach_usd,
      spend_per_lead_usd: identity.spend_per_outreach_usd,
      created_at: camp.created_at ? new Date(camp.created_at).toISOString() : new Date().toISOString(),
    };
  });

  const cloud_worker_spend: CloudWorkerSpendSummary = {
    cost_usd: workerSpend.cost_amount,
    currency_code: workerSpend.currency_code,
    updated_at: workerSpend.updated_at,
    console_url: workerSpend.console_url,
    detail: workerSpend.detail,
  };

  const finalizedAggregate = finalizeMetrics(aggregate);

  return {
    window,
    filters: {
      campaignIds: cleanCampaignIds,
      tags: cleanTags,
      userId: cleanUserId,
      identitySlug: cleanIdentitySlug,
      fromEmail: cleanFromEmail,
      messageMode: cleanMessageMode,
    },
    available_identities: [
      { slug: 'lucas', name: 'Lucas Figueroa' },
      { slug: 'tommy', name: 'Thomas Pozo' },
    ],
    available_inboxes: [
      { email: 'lucas@heliosgroup.email', identity_slug: 'lucas' },
      { email: 'lucas@heliosgroup.online', identity_slug: 'lucas' },
      { email: 'l.figueroa@heliosgroup.email', identity_slug: 'lucas' },
      { email: 'lfigueroa@heliosgroup.email', identity_slug: 'lucas' },
      { email: 'thomas@heliosgroup.email', identity_slug: 'tommy' },
      { email: 'tommy@heliosgroup.email', identity_slug: 'tommy' },
      { email: 'thomas@heliosgroup.online', identity_slug: 'tommy' },
    ],
    aggregate: finalizedAggregate,
    cloud_worker_spend,
    by_user: [...byUser.values()]
      .map((row) => finalizeMetrics(row))
      .sort((a, b) => b.total_spend_usd - a.total_spend_usd),
    by_identity: [...byIdentity.values()]
      .map((row) => ({
        ...finalizeMetrics(row),
        inboxes: row.inboxes
          .map((inbox) => finalizeMetrics(inbox))
          .sort((a, b) => b.emails_sent - a.emails_sent),
      }))
      .sort((a, b) => b.emails_sent - a.emails_sent),
    by_campaign,
    available_tags,
    available_campaigns,
    available_users,
    excluded_run_ids: excludedRunIds,
    notes: [
      'Total Hub Spend = Outreach Spend + Wasted Spend. Every dollar is classified on a lead first, then rolled up.',
      'Outreach spend is the four-leg stack (enrichment + drafting + worker + AgentMail) on leads with a sent email in this window.',
      'Wasted spend is that same stack on leads with no sent email, plus unallocated dashboard summaries and leftover drafting opening balances.',
      'Spend per lead outreach = outreach spend / emails sent.',
      'Wasted lead rate = (leads in this window − outreached leads) / leads in this window.',
      'Enrichment = Claude company research + Apollo enrich credits ($59 / 2,500) + extraction. People search is free.',
      'Drafting includes researching/writing the email and reply Claude spend. Custom message campaigns record $0.00 drafting cost.',
      'Worker spend is GCP VM month-to-date prorated into this window and split across leads. Local worker is unmetered ($0).',
      'AgentMail is $20 / 10,000 emails ($0.002 per send). Unused monthly quota is not allocated.',
      'Sent count uses drafting_items.delivery_snapshot and email_sends (sent status).',
      'Excluded runs drop leads via campaign_leads.run_id and leads.source_run_id.',
    ],
  };
}


export async function listAnalyticsRuns(): Promise<AnalyticsRunRow[]> {
  const { rows } = await dbQuery<{
    id: string;
    campaign_id: string;
    campaign_name: string;
    status: string;
    created_by: string;
    created_by_email: string | null;
    created_by_name: string | null;
    started_at: Date | null;
    finished_at: Date | null;
    created_at: Date;
    lead_count: string;
    excluded: boolean;
    excluded_at: Date | null;
    excluded_by: string | null;
    reason: string | null;
  }>(
    `SELECT
       r.id::text AS id,
       r.campaign_id::text AS campaign_id,
       c.name AS campaign_name,
       r.status,
       r.user_id::text AS created_by,
       u.email AS created_by_email,
       u.display_name AS created_by_name,
       r.started_at,
       r.finished_at,
       r.started_at AS created_at,
       coalesce((
         SELECT count(*)::text FROM outreach.campaign_leads cl WHERE cl.run_id = r.id
       ), '0') AS lead_count,
       (x.run_id IS NOT NULL) AS excluded,
       x.excluded_at,
       x.excluded_by::text AS excluded_by,
       x.reason
     FROM outreach.runs r
     JOIN outreach.campaigns c ON c.id = r.campaign_id
     LEFT JOIN outreach.users u ON u.id = r.user_id
     LEFT JOIN outreach.analytics_run_exclusions x ON x.run_id = r.id
     ORDER BY r.started_at DESC
     LIMIT 200`,
  );

  return rows.map((row) => ({
    id: row.id,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    run_type: 'enrichment',
    status: row.status,
    created_by: row.created_by,
    created_by_email: row.created_by_email,
    created_by_name: row.created_by_name,
    started_at: row.started_at?.toISOString() ?? null,
    completed_at: row.finished_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    lead_count: Number(row.lead_count),
    excluded: row.excluded,
    excluded_at: row.excluded_at?.toISOString() ?? null,
    excluded_by: row.excluded_by,
    reason: row.reason,
  }));
}

export async function excludeAnalyticsRuns(input: {
  runIds: string[];
  userId: string;
  reason?: string | null;
}): Promise<{ excluded: number }> {
  const ids = [...new Set(input.runIds.filter(Boolean))];
  if (!ids.length) return { excluded: 0 };
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 500) {
    throw new Error('Exclusion reason must be 500 characters or fewer');
  }
  const { rowCount } = await dbQuery(
    `INSERT INTO outreach.analytics_run_exclusions (run_id, excluded_by, reason)
     SELECT r.id, $2::uuid, $3
       FROM outreach.runs r
      WHERE r.id = ANY($1::uuid[])
     ON CONFLICT (run_id) DO UPDATE SET
       excluded_by = EXCLUDED.excluded_by,
       excluded_at = now(),
       reason = EXCLUDED.reason`,
    [ids, input.userId, reason],
  );
  return { excluded: rowCount ?? 0 };
}

export async function includeAnalyticsRuns(input: {
  runIds: string[];
}): Promise<{ included: number }> {
  const ids = [...new Set(input.runIds.filter(Boolean))];
  if (!ids.length) return { included: 0 };
  const { rowCount } = await dbQuery(
    `DELETE FROM outreach.analytics_run_exclusions WHERE run_id = ANY($1::uuid[])`,
    [ids],
  );
  return { included: rowCount ?? 0 };
}
