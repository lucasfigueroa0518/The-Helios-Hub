/**
 * Analytics Drill-Down Engine — generates trend points, campaign comparisons,
 * and individual lead/email item rows for any selected statistic.
 */

import {
  loadAttributedCostDaily,
} from '@/lib/analytics-attributed-cost';
import { dbQuery } from '@/lib/db';
import { parseAnalyticsMessageMode, resolveAnalyticsQueryWindow } from '@/lib/analytics';
import {
  AGENTMAIL_USD_PER_SEND,
  applyWorkerShare,
  classifySpendIdentity,
  loadLeadCampaignFacts,
  loadUnallocatedSpend,
  prorateGcpWorkerUsd,
  uniqueLeadFacts,
} from '@/lib/analytics-lead-facts';
import { getCloudWorkerSpendState } from '@/lib/billing-guard';

export type DailyTrendPoint = {
  date: string;
  value: number;
  secondary_value?: number | null;
};

export type DrilldownCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  metric_value: number;
  formatted_value: string;
  lead_count: number;
  emails_sent: number;
  total_spend_usd: number;
};

export type DrilldownItemRow = {
  id: string;
  lead_name: string;
  lead_company: string | null;
  lead_email: string | null;
  campaign_name: string;
  status_or_event: string;
  cost_usd: number | null;
  occurred_at: string;
  subject?: string | null;
  details?: string | null;
};

export type AnalyticsDrilldownData = {
  metricKey: string;
  title: string;
  unit: 'usd' | 'percent' | 'count';
  totalFormatted: string;
  trend: DailyTrendPoint[];
  campaigns: DrilldownCampaignRow[];
  items: DrilldownItemRow[];
  notes?: string[];
};

export type AnalyticsDrilldownInput = {
  metricKey: string;
  period?: string | null;
  from?: string | null;
  to?: string | null;
  campaignIds?: string[] | null;
  tags?: string[] | null;
  userId?: string | null;
  messageMode?: string | null;
};

function formatUsd(num: number | null | undefined): string {
  if (num == null || Number.isNaN(num)) return '—';
  return `$${num.toFixed(2)}`;
}

function formatPct(num: number | null | undefined): string {
  if (num == null || Number.isNaN(num)) return '—';
  return `${(num * 100).toFixed(1)}%`;
}

function formatCount(num: number | null | undefined): string {
  if (num == null || Number.isNaN(num)) return '0';
  return num.toLocaleString();
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

function attributedDayTotal(row: {
  enrichment_cost: string;
  drafting_cost: string;
  replies_cost: string;
  extraction_cost: string;
  dashboards_cost: string;
}): number {
  return (
    Number(row.enrichment_cost)
    + Number(row.drafting_cost)
    + Number(row.replies_cost)
    + Number(row.extraction_cost)
    + Number(row.dashboards_cost)
  );
}

export async function getMetricDrilldown(input: AnalyticsDrilldownInput): Promise<AnalyticsDrilldownData> {
  const window = await resolveAnalyticsQueryWindow(input);
  const excludedRunIds = await loadExcludedRunIds();
  const excludedLeads = await loadExcludedLeadIds(excludedRunIds);

  const cleanCampaignIds = input.campaignIds?.filter(Boolean) ?? [];
  const cleanTags = input.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean) ?? [];
  const cleanUserId = input.userId?.trim() || null;
  const cleanMessageMode = parseAnalyticsMessageMode(input.messageMode);

  const { rows: matchingCampaigns } = await dbQuery<{ id: string; name: string }>(
    `SELECT c.id::text AS id, c.name
       FROM outreach.campaigns c
      WHERE ($1::uuid IS NULL OR c.owner_id = $1::uuid)
        AND ($2::uuid[] IS NULL OR cardinality($2::uuid[]) = 0 OR c.id = ANY($2::uuid[]))
        AND ($3::text[] IS NULL OR cardinality($3::text[]) = 0 OR c.id IN (
          SELECT ct.campaign_id FROM outreach.campaign_tags ct WHERE lower(ct.tag) = ANY($3::text[])
        ))
        AND ($4::text IS NULL OR COALESCE(c.message_mode, 'ai') = $4)`,
    [
      cleanUserId,
      cleanCampaignIds.length ? cleanCampaignIds : null,
      cleanTags.length ? cleanTags : null,
      cleanMessageMode === 'all' ? null : cleanMessageMode,
    ],
  );

  const campaignIds = matchingCampaigns.map((c) => c.id);
  const safeCampaignIds = campaignIds.length ? campaignIds : ['00000000-0000-0000-0000-000000000000'];
  const metricKeyRaw = input.metricKey || 'total_hub_spend';
  const metricKey = (
    metricKeyRaw === 'hub_attributed'
    || metricKeyRaw === 'total_spend'
    || metricKeyRaw === 'hub_spend'
  ) ? 'total_hub_spend'
    : metricKeyRaw === 'spend_per_lead' ? 'spend_per_outreach'
    : metricKeyRaw === 'aggregated_enrichment' || metricKeyRaw === 'cost_per_enrichment' ? 'enrichment'
    : metricKeyRaw === 'aggregated_drafting' || metricKeyRaw === 'cost_per_drafting' ? 'drafting'
    : metricKeyRaw;

  let title = 'Statistic Overview';
  let unit: 'usd' | 'percent' | 'count' = 'usd';
  let totalFormatted = '—';

  const [dailyCost, sendDaily, rawLeadFacts, unallocated, workerSpend] = await Promise.all([
    loadAttributedCostDaily({
      from: window.from,
      to: window.to,
      campaignIds: safeCampaignIds,
      excludedLeadIds: excludedLeads,
      excludedRunIds,
    }),
    dbQuery<{
      day: string;
      sent_count: string;
      delivered_count: string;
      opened_count: string;
      clicked_count: string;
      replied_count: string;
    }>(
      `WITH days AS (
         SELECT generate_series($1::timestamptz, $2::timestamptz, interval '1 day')::date AS day
       ),
       send_daily AS (
         SELECT date_trunc('day', i.updated_at)::date AS day,
                count(*) FILTER (WHERE i.delivery_snapshot ? 'sentAt' OR i.delivery_snapshot ? 'gmailMessageId' OR s.status = 'sent') AS sent_count,
                count(*) FILTER (WHERE s.status = 'sent' AND s.bounced_at IS NULL) AS delivered_count,
                count(*) FILTER (WHERE s.opened_at IS NOT NULL) AS opened_count,
                count(*) FILTER (WHERE s.clicked_at IS NOT NULL) AS clicked_count,
                count(*) FILTER (WHERE s.replied_at IS NOT NULL) AS replied_count
           FROM outreach.drafting_items i
           JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
           LEFT JOIN outreach.email_sends s ON s.drafting_item_id = i.id AND s.status = 'sent'
          WHERE i.updated_at >= $1::timestamptz AND i.updated_at <= $2::timestamptz
            AND w.campaign_id = ANY($3::uuid[])
            AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR i.lead_id <> ALL($4::uuid[]))
          GROUP BY 1
       )
       SELECT d.day::text AS day,
              coalesce(s.sent_count, 0)::text AS sent_count,
              coalesce(s.delivered_count, 0)::text AS delivered_count,
              coalesce(s.opened_count, 0)::text AS opened_count,
              coalesce(s.clicked_count, 0)::text AS clicked_count,
              coalesce(s.replied_count, 0)::text AS replied_count
         FROM days d
    LEFT JOIN send_daily s ON s.day = d.day
     ORDER BY d.day ASC`,
      [window.from, window.to, safeCampaignIds, excludedLeads.length ? excludedLeads : null],
    ),
    loadLeadCampaignFacts({
      from: window.from,
      to: window.to,
      campaignIds: safeCampaignIds,
      excludedLeadIds: excludedLeads,
      excludedRunIds,
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
  const orgIdentity = classifySpendIdentity({
    facts: uniqueLeadFacts(leadFacts),
    unallocatedWastedUsd: unallocated.total_usd,
  });
  const workerPerDay = dailyCost.length > 0 ? workerWindowUsd / dailyCost.length : 0;

  const sendByDay = new Map(sendDaily.rows.map((r) => [r.day, r]));
  const trend: DailyTrendPoint[] = dailyCost.map((r) => {
    const send = sendByDay.get(r.day);
    const sent = Number(send?.sent_count ?? 0);
    const deliv = Number(send?.delivered_count ?? 0);
    const totalC = attributedDayTotal(r) + (sent * AGENTMAIL_USD_PER_SEND) + workerPerDay;
    const draftC = Number(r.drafting_cost) + Number(r.replies_cost);
    const enrichC = Number(r.enrichment_cost) + Number(r.extraction_cost);
    let val = 0;
    if (metricKey === 'total_hub_spend' || metricKey === 'outreach_spend' || metricKey === 'wasted_spend' || metricKey === 'spend_per_outreach') val = totalC;
    else if (metricKey === 'drafting') val = draftC;
    else if (metricKey === 'enrichment') val = enrichC;
    else if (metricKey === 'worker') val = workerPerDay;
    else if (metricKey === 'agentmail') val = sent * AGENTMAIL_USD_PER_SEND;
    else if (metricKey === 'delivery_rate') val = sent > 0 ? deliv / sent : 0;
    else if (metricKey === 'open_rate') val = deliv > 0 ? Number(send?.opened_count ?? 0) / deliv : 0;
    else if (metricKey === 'click_rate') val = deliv > 0 ? Number(send?.clicked_count ?? 0) / deliv : 0;
    else if (metricKey === 'reply_rate') val = deliv > 0 ? Number(send?.replied_count ?? 0) / deliv : 0;
    else if (metricKey === 'emails_sent') val = sent;
    else if (metricKey === 'emails_bounced') val = 0;
    else if (metricKey === 'wasted_lead_rate') val = 0;
    else if (metricKey === 'campaigns_count') val = safeCampaignIds[0] === '00000000-0000-0000-0000-000000000000' ? 0 : safeCampaignIds.length;
    return { date: r.day, value: val };
  });

  const { rows: campRows } = await dbQuery<{
    campaign_id: string;
    campaign_name: string;
    emails_sent: string;
    emails_delivered: string;
    emails_opened: string;
    emails_clicked: string;
    emails_replied: string;
    emails_bounced: string;
  }>(
    `SELECT c.id::text AS campaign_id,
            c.name AS campaign_name,
            coalesce(sum(CASE WHEN i.delivery_snapshot ? 'sentAt' OR i.delivery_snapshot ? 'gmailMessageId' OR s.status = 'sent' THEN 1 ELSE 0 END), 0)::text AS emails_sent,
            coalesce(sum(CASE WHEN s.status = 'sent' AND s.bounced_at IS NULL THEN 1 ELSE 0 END), 0)::text AS emails_delivered,
            coalesce(sum(CASE WHEN s.opened_at IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS emails_opened,
            coalesce(sum(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS emails_clicked,
            coalesce(sum(CASE WHEN s.replied_at IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS emails_replied,
            coalesce(sum(CASE WHEN s.bounced_at IS NOT NULL OR s.status = 'bounced' THEN 1 ELSE 0 END), 0)::text AS emails_bounced
       FROM outreach.campaigns c
  LEFT JOIN outreach.drafting_workspaces w ON w.campaign_id = c.id
  LEFT JOIN outreach.drafting_items i ON i.workspace_id = w.id AND i.updated_at >= $1::timestamptz AND i.updated_at <= $2::timestamptz
  LEFT JOIN outreach.email_sends s ON s.drafting_item_id = i.id AND s.status IN ('sent', 'bounced')
      WHERE c.id = ANY($3::uuid[])
   GROUP BY c.id, c.name`,
    [window.from, window.to, safeCampaignIds],
  );

  const factsByCampaign = new Map<string, typeof leadFacts>();
  for (const fact of leadFacts) {
    const list = factsByCampaign.get(fact.campaign_id) ?? [];
    list.push(fact);
    factsByCampaign.set(fact.campaign_id, list);
  }
  const costByLead = new Map(uniqueLeadFacts(leadFacts).map((fact) => [fact.lead_id, fact]));

  function metricSpec(identity: ReturnType<typeof classifySpendIdentity>, sent: number, deliv: number, opened: number, clicked: number, replied: number, bounced: number) {
    const baseDenom = deliv > 0 ? deliv : sent;
    switch (metricKey) {
      case 'total_hub_spend':
        return { title: 'Total Hub Spend', unit: 'usd' as const, val: identity.total_spend_usd, fmt: formatUsd(identity.total_spend_usd) };
      case 'outreach_spend':
        return { title: 'Outreach Spend', unit: 'usd' as const, val: identity.outreach_spend_usd, fmt: formatUsd(identity.outreach_spend_usd) };
      case 'wasted_spend':
        return { title: 'Wasted Spend', unit: 'usd' as const, val: identity.wasted_spend_usd, fmt: formatUsd(identity.wasted_spend_usd) };
      case 'spend_per_outreach':
        return { title: 'Spend Per Lead Outreach', unit: 'usd' as const, val: identity.spend_per_outreach_usd ?? 0, fmt: formatUsd(identity.spend_per_outreach_usd) };
      case 'wasted_lead_rate':
        return { title: 'Wasted Lead Rate', unit: 'percent' as const, val: identity.wasted_lead_rate ?? 0, fmt: formatPct(identity.wasted_lead_rate) };
      case 'enrichment':
        return { title: 'Enrichment Spend', unit: 'usd' as const, val: identity.enrichment_cost_usd, fmt: formatUsd(identity.enrichment_cost_usd) };
      case 'drafting':
        return { title: 'Drafting Spend', unit: 'usd' as const, val: identity.drafting_cost_usd, fmt: formatUsd(identity.drafting_cost_usd) };
      case 'worker':
        return { title: 'Worker Spend', unit: 'usd' as const, val: identity.worker_cost_usd, fmt: formatUsd(identity.worker_cost_usd) };
      case 'agentmail':
        return { title: 'AgentMail Spend', unit: 'usd' as const, val: identity.agentmail_cost_usd, fmt: formatUsd(identity.agentmail_cost_usd) };
      case 'delivery_rate':
        return { title: 'Email Delivery Rate', unit: 'percent' as const, val: sent > 0 ? deliv / sent : 0, fmt: sent > 0 ? formatPct(deliv / sent) : '—' };
      case 'open_rate':
        return { title: 'Email Open Rate', unit: 'percent' as const, val: baseDenom > 0 ? opened / baseDenom : 0, fmt: baseDenom > 0 ? formatPct(opened / baseDenom) : '—' };
      case 'click_rate':
        return { title: 'Email Click Rate', unit: 'percent' as const, val: baseDenom > 0 ? clicked / baseDenom : 0, fmt: baseDenom > 0 ? formatPct(clicked / baseDenom) : '—' };
      case 'reply_rate':
        return { title: 'Email Reply Rate', unit: 'percent' as const, val: baseDenom > 0 ? replied / baseDenom : 0, fmt: baseDenom > 0 ? formatPct(replied / baseDenom) : '—' };
      case 'emails_bounced':
        return { title: 'Emails Bounced', unit: 'count' as const, val: bounced, fmt: formatCount(bounced) };
      case 'emails_sent':
        return { title: 'Emails Sent Volume', unit: 'count' as const, val: sent, fmt: formatCount(sent) };
      case 'campaigns_count':
        return { title: 'Campaigns Conducted', unit: 'count' as const, val: 1, fmt: '1' };
      default:
        return { title: 'Total Hub Spend', unit: 'usd' as const, val: identity.total_spend_usd, fmt: formatUsd(identity.total_spend_usd) };
    }
  }

  const campaigns: DrilldownCampaignRow[] = campRows.map((r) => {
    const sent = Number(r.emails_sent);
    const deliv = Number(r.emails_delivered);
    const opened = Number(r.emails_opened);
    const clicked = Number(r.emails_clicked);
    const replied = Number(r.emails_replied);
    const bounced = Number(r.emails_bounced);
    const identity = classifySpendIdentity({ facts: factsByCampaign.get(r.campaign_id) ?? [] });
    const spec = metricSpec(identity, sent, deliv, opened, clicked, replied, bounced);
    title = spec.title;
    unit = spec.unit;
    return {
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      metric_value: spec.val,
      formatted_value: spec.fmt,
      lead_count: identity.total_leads,
      emails_sent: sent,
      total_spend_usd: identity.total_spend_usd,
    };
  }).sort((a, b) => b.metric_value - a.metric_value);

  const totalSent = campRows.reduce((acc, r) => acc + Number(r.emails_sent), 0);
  const totalDelivered = campRows.reduce((acc, r) => acc + Number(r.emails_delivered), 0);
  const totalOpened = campRows.reduce((acc, r) => acc + Number(r.emails_opened), 0);
  const totalClicked = campRows.reduce((acc, r) => acc + Number(r.emails_clicked), 0);
  const totalReplied = campRows.reduce((acc, r) => acc + Number(r.emails_replied), 0);
  const totalBounced = campRows.reduce((acc, r) => acc + Number(r.emails_bounced), 0);
  const orgSpec = metricSpec(orgIdentity, totalSent, totalDelivered, totalOpened, totalClicked, totalReplied, totalBounced);
  title = orgSpec.title;
  unit = orgSpec.unit;
  totalFormatted = metricKey === 'campaigns_count' ? formatCount(campaigns.length) : orgSpec.fmt;

  const { rows: itemRows } = await dbQuery<{
    id: string;
    lead_id: string;
    full_name: string;
    company_name: string | null;
    email_primary: string | null;
    campaign_name: string;
    state: string;
    created_at: Date;
    subject: string | null;
    delivered_at: Date | null;
    opened_at: Date | null;
    clicked_at: Date | null;
    replied_at: Date | null;
  }>(
    `SELECT i.id::text AS id,
            i.lead_id::text AS lead_id,
            coalesce(l.full_name, 'Unknown Lead') AS full_name,
            l.company_name,
            l.email_primary,
            c.name AS campaign_name,
            i.state,
            i.updated_at AS created_at,
            s.subject,
            s.delivered_at,
            s.opened_at,
            s.clicked_at,
            s.replied_at
       FROM outreach.drafting_items i
       JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
       JOIN outreach.campaigns c ON c.id = w.campaign_id
       JOIN outreach.leads l ON l.id = i.lead_id
  LEFT JOIN outreach.email_sends s ON s.drafting_item_id = i.id AND s.status = 'sent'
      WHERE c.id = ANY($3::uuid[])
        AND i.updated_at >= $1::timestamptz AND i.updated_at <= $2::timestamptz
        AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR i.lead_id <> ALL($4::uuid[]))
      ORDER BY i.updated_at DESC
      LIMIT 100`,
    [window.from, window.to, safeCampaignIds, excludedLeads.length ? excludedLeads : null],
  );

  const items: DrilldownItemRow[] = itemRows.map((r) => {
    let status = r.state;
    if (r.replied_at) status = 'Replied';
    else if (r.clicked_at) status = 'Clicked';
    else if (r.opened_at) status = 'Opened';
    else if (r.delivered_at) status = 'Delivered';
    const fact = costByLead.get(r.lead_id);

    return {
      id: r.id,
      lead_name: r.full_name,
      lead_company: r.company_name,
      lead_email: r.email_primary,
      campaign_name: r.campaign_name,
      status_or_event: fact?.is_outreached
        ? (status === r.state ? 'Outreached' : status)
        : fact?.is_auto_inflight
          ? (status === r.state ? 'Queued' : status)
          : (status === r.state ? 'Wasted' : status),
      cost_usd: fact?.stack_usd ?? null,
      occurred_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      subject: r.subject,
      details: fact
        ? `Enrich ${formatUsd(fact.enrichment_usd)} · Draft ${formatUsd(fact.drafting_usd)} · Worker ${formatUsd(fact.worker_usd)} · AgentMail ${formatUsd(fact.agentmail_usd)}`
        : null,
    };
  });

  return {
    metricKey,
    title,
    unit,
    totalFormatted,
    trend,
    campaigns,
    items,
    notes: [
      'Total Hub Spend = Outreach Spend + Wasted Spend.',
      'Each lead carries enrichment + drafting + worker + AgentMail. Unsent manual leads are wasted. Unsent auto-campaign leads are still queued.',
      'AgentMail is $0.002 per send. Apollo enrich is $59 / 2,500 credits. GCP worker is month-to-date prorated into this window.',
      'Dashboard summaries and leftover drafting opening balances are unallocated wasted spend.',
    ],
  };
}

