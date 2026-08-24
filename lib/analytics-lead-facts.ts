/**
 * Bottom-up Analytics Hub spend: work-row actuals allocated to leads,
 * then classified as outreach vs wasted.
 *
 * Do not read outreach.lead_cost_events (allocation table, not the bill).
 */

import { dbQuery } from '@/lib/db';

export const AGENTMAIL_MONTHLY_USD = 20;
export const AGENTMAIL_INCLUDED_SENDS = 10_000;
export const AGENTMAIL_USD_PER_SEND = AGENTMAIL_MONTHLY_USD / AGENTMAIL_INCLUDED_SENDS;

export const APOLLO_MONTHLY_USD = 59;
export const APOLLO_INCLUDED_CREDITS = 2_500;
export const APOLLO_USD_PER_CREDIT = APOLLO_MONTHLY_USD / APOLLO_INCLUDED_CREDITS;

export function isAutoInflightLead(campaignKind: string | null | undefined, emailsSent: number): boolean {
  return campaignKind === 'auto' && !(emailsSent > 0);
}

export type LeadCampaignFact = {
  lead_id: string;
  campaign_id: string;
  owner_id: string;
  from_email: string | null;
  identity_slug: string | null;
  emails_sent: number;
  campaign_kind: 'auto' | 'manual';
  is_outreached: boolean;
  is_auto_inflight: boolean;
  claude_enrichment_usd: number;
  apollo_usd: number;
  extraction_usd: number;
  enrichment_usd: number;
  drafting_usd: number;
  reply_usd: number;
  worker_usd: number;
  agentmail_usd: number;
  stack_usd: number;
};

export type UnallocatedSpend = {
  dashboard_usd: number;
  opening_balance_usd: number;
  total_usd: number;
};

export type SpendIdentity = {
  total_leads: number;
  outreached_leads: number;
  wasted_leads: number;
  emails_sent: number;
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
  claude_enrichment_usd: number;
  extraction_cost_usd: number;
  reply_cost_usd: number;
};

function asNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function agentMailSpendUsd(emailsSent: number): number {
  return Math.max(0, emailsSent) * AGENTMAIL_USD_PER_SEND;
}

export function apolloSpendUsd(credits: number): number {
  return Math.max(0, credits) * APOLLO_USD_PER_CREDIT;
}

export function utcDayCountInclusive(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** GCP MTD snapshot → window dollars (current UTC month overlap only). */
export function prorateGcpWorkerUsd(input: {
  monthToDateUsd: number | null | undefined;
  windowFrom: Date;
  windowTo: Date;
  now?: Date;
}): number {
  const amount = input.monthToDateUsd;
  if (amount == null || !(amount > 0)) return 0;
  const now = input.now ?? new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysElapsed = utcDayCountInclusive(monthStart, now);
  if (daysElapsed <= 0) return 0;
  const overlapFrom = input.windowFrom > monthStart ? input.windowFrom : monthStart;
  const overlapTo = input.windowTo < now ? input.windowTo : now;
  const overlapDays = utcDayCountInclusive(overlapFrom, overlapTo);
  if (overlapDays <= 0) return 0;
  return (amount / daysElapsed) * overlapDays;
}

export function splitEqually(totalUsd: number, count: number): number {
  if (!(totalUsd > 0) || count <= 0) return 0;
  return totalUsd / count;
}

export function leadStackUsd(input: {
  enrichment_usd: number;
  drafting_usd: number;
  worker_usd: number;
  agentmail_usd: number;
}): number {
  return input.enrichment_usd + input.drafting_usd + input.worker_usd + input.agentmail_usd;
}

export function uniqueLeadFacts(rows: LeadCampaignFact[]): LeadCampaignFact[] {
  const byLead = new Map<string, LeadCampaignFact>();
  for (const row of rows) {
    const existing = byLead.get(row.lead_id);
    if (!existing) {
      byLead.set(row.lead_id, { ...row });
      continue;
    }
    existing.emails_sent += row.emails_sent;
    existing.is_outreached = existing.is_outreached || row.is_outreached;
    existing.is_auto_inflight = (existing.is_auto_inflight || row.is_auto_inflight) && !existing.is_outreached;
    if (row.campaign_kind === 'auto') existing.campaign_kind = 'auto';
    existing.claude_enrichment_usd += row.claude_enrichment_usd;
    existing.apollo_usd += row.apollo_usd;
    existing.extraction_usd += row.extraction_usd;
    existing.enrichment_usd += row.enrichment_usd;
    existing.drafting_usd += row.drafting_usd;
    existing.reply_usd += row.reply_usd;
    existing.worker_usd += row.worker_usd;
    existing.agentmail_usd += row.agentmail_usd;
    existing.stack_usd += row.stack_usd;
    if (!existing.from_email && row.from_email) existing.from_email = row.from_email;
    if (!existing.identity_slug && row.identity_slug) existing.identity_slug = row.identity_slug;
  }
  return [...byLead.values()];
}

export function classifySpendIdentity(input: {
  facts: Array<{
    lead_id: string;
    emails_sent: number;
    is_outreached: boolean;
    is_auto_inflight?: boolean;
    enrichment_usd: number;
    drafting_usd: number;
    worker_usd: number;
    agentmail_usd: number;
    apollo_usd?: number;
    claude_enrichment_usd?: number;
    extraction_usd?: number;
    reply_usd?: number;
  }>;
  unallocatedWastedUsd?: number;
}): SpendIdentity {
  const unique = new Map<string, (typeof input.facts)[number]>();
  for (const fact of input.facts) {
    const existing = unique.get(fact.lead_id);
    if (!existing) {
      unique.set(fact.lead_id, { ...fact });
      continue;
    }
    existing.emails_sent += fact.emails_sent;
    existing.is_outreached = existing.is_outreached || fact.is_outreached;
    existing.is_auto_inflight = Boolean(existing.is_auto_inflight || fact.is_auto_inflight);
    existing.enrichment_usd += fact.enrichment_usd;
    existing.drafting_usd += fact.drafting_usd;
    existing.worker_usd += fact.worker_usd;
    existing.agentmail_usd += fact.agentmail_usd;
    existing.apollo_usd = (existing.apollo_usd ?? 0) + (fact.apollo_usd ?? 0);
    existing.claude_enrichment_usd = (existing.claude_enrichment_usd ?? 0) + (fact.claude_enrichment_usd ?? 0);
    existing.extraction_usd = (existing.extraction_usd ?? 0) + (fact.extraction_usd ?? 0);
    existing.reply_usd = (existing.reply_usd ?? 0) + (fact.reply_usd ?? 0);
  }

  const facts = [...unique.values()].map((fact) => ({
    ...fact,
    is_auto_inflight: Boolean(fact.is_auto_inflight) && !fact.is_outreached,
  }));
  const unallocated = Math.max(0, input.unallocatedWastedUsd ?? 0);
  let emails_sent = 0;
  let outreach_spend_usd = 0;
  let sent_outreach_spend_usd = 0;
  let lead_wasted_usd = 0;
  let outreached_leads = 0;
  let wasted_leads = 0;
  let enrichment_cost_usd = 0;
  let drafting_cost_usd = 0;
  let worker_cost_usd = 0;
  let agentmail_cost_usd = 0;
  let apollo_cost_usd = 0;
  let claude_enrichment_usd = 0;
  let extraction_cost_usd = 0;
  let reply_cost_usd = 0;

  for (const fact of facts) {
    const stack = leadStackUsd(fact);
    emails_sent += fact.emails_sent;
    enrichment_cost_usd += fact.enrichment_usd;
    drafting_cost_usd += fact.drafting_usd;
    worker_cost_usd += fact.worker_usd;
    agentmail_cost_usd += fact.agentmail_usd;
    apollo_cost_usd += fact.apollo_usd ?? 0;
    claude_enrichment_usd += fact.claude_enrichment_usd ?? 0;
    extraction_cost_usd += fact.extraction_usd ?? 0;
    reply_cost_usd += fact.reply_usd ?? 0;
    if (fact.is_outreached) {
      outreached_leads += 1;
      outreach_spend_usd += stack;
      sent_outreach_spend_usd += stack;
    } else if (fact.is_auto_inflight) {
      // Auto queue: pulled and waiting to send. Still committed spend, not waste.
      outreach_spend_usd += stack;
    } else {
      wasted_leads += 1;
      lead_wasted_usd += stack;
    }
  }

  const total_leads = facts.length;
  const wasted_spend_usd = lead_wasted_usd + unallocated;
  const total_spend_usd = outreach_spend_usd + wasted_spend_usd;

  return {
    total_leads,
    outreached_leads,
    wasted_leads,
    emails_sent,
    outreach_spend_usd,
    wasted_spend_usd,
    total_spend_usd,
    spend_per_outreach_usd: emails_sent > 0 ? sent_outreach_spend_usd / emails_sent : null,
    wasted_lead_rate: total_leads > 0 ? wasted_leads / total_leads : null,
    enrichment_cost_usd,
    drafting_cost_usd,
    worker_cost_usd,
    agentmail_cost_usd,
    apollo_cost_usd,
    claude_enrichment_usd,
    extraction_cost_usd,
    reply_cost_usd,
  };
}

export function applyWorkerShare(
  rows: LeadCampaignFact[],
  workerWindowUsd: number,
): LeadCampaignFact[] {
  const uniqueLeadIds = [...new Set(rows.map((row) => row.lead_id))];
  const perLead = splitEqually(workerWindowUsd, uniqueLeadIds.length);
  const campaignsByLead = new Map<string, number>();
  for (const row of rows) {
    campaignsByLead.set(row.lead_id, (campaignsByLead.get(row.lead_id) ?? 0) + 1);
  }
  return rows.map((row) => {
    const camps = campaignsByLead.get(row.lead_id) ?? 1;
    const worker_usd = perLead / camps;
    const enrichment_usd = row.claude_enrichment_usd + row.apollo_usd + row.extraction_usd;
    const agentmail_usd = agentMailSpendUsd(row.emails_sent);
    const stack_usd = leadStackUsd({
      enrichment_usd,
      drafting_usd: row.drafting_usd,
      worker_usd,
      agentmail_usd,
    });
    return {
      ...row,
      enrichment_usd,
      worker_usd,
      agentmail_usd,
      stack_usd,
      is_outreached: row.emails_sent > 0,
      is_auto_inflight: isAutoInflightLead(row.campaign_kind, row.emails_sent),
    };
  });
}

type LeadFactRow = {
  lead_id: string;
  campaign_id: string;
  owner_id: string;
  from_email: string | null;
  identity_slug: string | null;
  campaign_kind: string;
  emails_sent: string;
  claude_enrichment_usd: string;
  apollo_usd: string;
  extraction_usd: string;
  drafting_usd: string;
  reply_usd: string;
};

export async function loadLeadCampaignFacts(input: {
  from: string;
  to: string;
  campaignIds: string[];
  excludedLeadIds: string[];
  excludedRunIds: string[];
}): Promise<LeadCampaignFact[]> {
  const campaignIds = input.campaignIds.length
    ? input.campaignIds
    : ['00000000-0000-0000-0000-000000000000'];
  const excludedLeads = input.excludedLeadIds.length ? input.excludedLeadIds : null;
  const excludedRuns = input.excludedRunIds.length ? input.excludedRunIds : null;

  const { rows } = await dbQuery<LeadFactRow>(
    `WITH params AS (
       SELECT $1::timestamptz AS win_from, $2::timestamptz AS win_to
     ),
     filtered_campaigns AS (
       SELECT c.id, c.owner_id, coalesce(c.kind, 'manual') AS kind
         FROM outreach.campaigns c
        WHERE c.id = ANY($3::uuid[])
     ),
     enrichment_targets AS (
       SELECT DISTINCT
              job.id AS job_id,
              cl.lead_id,
              r.campaign_id,
              fc.owner_id,
              job.actual_cost_usd AS job_cost
         FROM outreach.company_research_jobs job
         JOIN LATERAL unnest(job.requested_by_runs) AS req_run_id ON true
         JOIN outreach.runs r ON r.id = req_run_id
         JOIN filtered_campaigns fc ON fc.id = r.campaign_id
         JOIN outreach.campaign_leads cl ON cl.run_id = r.id
         CROSS JOIN params p
        WHERE job.updated_at >= p.win_from
          AND job.updated_at <= p.win_to
          AND job.actual_cost_usd > 0
          AND ($5::uuid[] IS NULL OR cardinality($5::uuid[]) = 0 OR req_run_id <> ALL($5::uuid[]))
          AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR cl.lead_id <> ALL($4::uuid[]))
     ),
     enrichment_lead_n AS (
       SELECT job_id, count(DISTINCT lead_id)::numeric AS leads_in_job
         FROM enrichment_targets
        GROUP BY job_id
     ),
     enrichment_camps AS (
       SELECT job_id, lead_id, count(*)::numeric AS camps_for_lead
         FROM enrichment_targets
        GROUP BY job_id, lead_id
     ),
     claude_enrichment AS (
       SELECT t.lead_id,
              t.campaign_id,
              t.owner_id,
              sum(t.job_cost / n.leads_in_job / c.camps_for_lead) AS claude_enrichment_usd
         FROM enrichment_targets t
         JOIN enrichment_lead_n n ON n.job_id = t.job_id
         JOIN enrichment_camps c ON c.job_id = t.job_id AND c.lead_id = t.lead_id
        GROUP BY t.lead_id, t.campaign_id, t.owner_id
     ),
     extraction AS (
       SELECT cl.lead_id,
              r.campaign_id,
              fc.owner_id,
              sum(u.cost_usd / u.lead_count) AS extraction_usd
         FROM (
           SELECT u.id AS upload_id,
                  u.run_id,
                  coalesce(nullif(u.extraction_summary->>'actual_cost_usd', '')::numeric, 0) AS cost_usd,
                  greatest(
                    (SELECT count(DISTINCT cl2.lead_id)
                       FROM outreach.campaign_leads cl2
                      WHERE cl2.run_id = u.run_id
                        AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR cl2.lead_id <> ALL($4::uuid[]))),
                    1
                  ) AS lead_count
             FROM outreach.uploads u
             CROSS JOIN params p
            WHERE u.created_at >= p.win_from
              AND u.created_at <= p.win_to
              AND u.extraction_summary ? 'actual_cost_usd'
              AND ($5::uuid[] IS NULL OR cardinality($5::uuid[]) = 0 OR u.run_id <> ALL($5::uuid[]))
         ) u
         JOIN outreach.runs r ON r.id = u.run_id
         JOIN filtered_campaigns fc ON fc.id = r.campaign_id
         JOIN outreach.campaign_leads cl ON cl.run_id = u.run_id
        WHERE ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR cl.lead_id <> ALL($4::uuid[]))
        GROUP BY cl.lead_id, r.campaign_id, fc.owner_id
     ),
     drafting AS (
       SELECT x.lead_id,
              x.campaign_id,
              x.owner_id,
              sum(x.drafting_usd) AS drafting_usd
         FROM (
           SELECT item.lead_id,
                  w.campaign_id,
                  fc.owner_id,
                  event.actual_cost_usd AS drafting_usd
             FROM outreach.drafting_job_cost_events event
             JOIN outreach.drafting_items item ON item.id = event.drafting_item_id
             JOIN outreach.drafting_workspaces w ON w.id = item.workspace_id
             JOIN filtered_campaigns fc ON fc.id = w.campaign_id
             CROSS JOIN params p
            WHERE event.created_at >= p.win_from
              AND event.created_at <= p.win_to
              AND event.actual_cost_usd > 0
              AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR item.lead_id <> ALL($4::uuid[]))
           UNION ALL
           SELECT item.lead_id,
                  w.campaign_id,
                  fc.owner_id,
                  0::numeric AS drafting_usd
             FROM outreach.email_drafts d
             JOIN outreach.drafting_items item ON item.id = d.drafting_item_id
             JOIN outreach.drafting_workspaces w ON w.id = item.workspace_id
             JOIN filtered_campaigns fc ON fc.id = w.campaign_id
             CROSS JOIN params p
            WHERE d.generation_mode = 'template'
              AND coalesce(d.generated_at, d.edited_at, now()) >= p.win_from
              AND coalesce(d.generated_at, d.edited_at, now()) <= p.win_to
              AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR item.lead_id <> ALL($4::uuid[]))
         ) x
        GROUP BY x.lead_id, x.campaign_id, x.owner_id
     ),
     replies AS (
       SELECT item.lead_id,
              rs.campaign_id,
              fc.owner_id,
              sum(coalesce(rs.actual_cost_usd, 0)) AS reply_usd
         FROM outreach.reply_sends rs
         JOIN filtered_campaigns fc ON fc.id = rs.campaign_id
         JOIN outreach.drafting_items item ON item.id = rs.drafting_item_id
         CROSS JOIN params p
        WHERE rs.created_at >= p.win_from
          AND rs.created_at <= p.win_to
          AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR item.lead_id <> ALL($4::uuid[]))
        GROUP BY item.lead_id, rs.campaign_id, fc.owner_id
     ),
     sends AS (
       SELECT i.lead_id,
              w.campaign_id,
              fc.owner_id,
              min(lower(s.from_email)) FILTER (WHERE s.from_email IS NOT NULL) AS from_email,
              min(si.slug) FILTER (WHERE si.slug IS NOT NULL) AS identity_slug,
              count(*) FILTER (
                WHERE i.delivery_snapshot ? 'sentAt'
                   OR i.delivery_snapshot ? 'gmailMessageId'
                   OR s.status = 'sent'
              )::int AS emails_sent
         FROM outreach.drafting_items i
         JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
         JOIN filtered_campaigns fc ON fc.id = w.campaign_id
         LEFT JOIN outreach.email_sends s ON s.drafting_item_id = i.id AND s.status IN ('sent', 'bounced')
         LEFT JOIN outreach.sender_inboxes ib ON ib.id = s.sender_inbox_id OR lower(ib.email) = lower(s.from_email)
         LEFT JOIN outreach.sender_identities si ON si.id = ib.identity_id
         CROSS JOIN params p
        WHERE i.updated_at >= p.win_from
          AND i.updated_at <= p.win_to
          AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR i.lead_id <> ALL($4::uuid[]))
        GROUP BY i.lead_id, w.campaign_id, fc.owner_id
     ),
     apollo AS (
       SELECT DISTINCT ON (l.id)
              l.id AS lead_id,
              coalesce(r.campaign_id, cl.campaign_id) AS campaign_id,
              fc.owner_id,
              ${APOLLO_USD_PER_CREDIT}::numeric AS apollo_usd
         FROM outreach.leads l
         JOIN outreach.campaign_leads cl ON cl.lead_id = l.id
         JOIN filtered_campaigns fc ON fc.id = cl.campaign_id
         LEFT JOIN outreach.runs r ON r.id = l.source_run_id
         CROSS JOIN params p
        WHERE l.apollo_person_id IS NOT NULL
          AND l.created_at >= p.win_from
          AND l.created_at <= p.win_to
          AND ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR l.id <> ALL($4::uuid[]))
          AND ($5::uuid[] IS NULL OR cardinality($5::uuid[]) = 0
               OR l.source_run_id IS NULL OR l.source_run_id <> ALL($5::uuid[]))
        ORDER BY l.id, (r.campaign_id IS NOT NULL AND r.campaign_id = cl.campaign_id) DESC
     ),
     attached AS (
       SELECT cl.lead_id,
              cl.campaign_id,
              fc.owner_id
         FROM outreach.campaign_leads cl
         JOIN filtered_campaigns fc ON fc.id = cl.campaign_id
         JOIN outreach.leads l ON l.id = cl.lead_id
         LEFT JOIN outreach.runs r ON r.id = cl.run_id
         CROSS JOIN params p
        WHERE ($4::uuid[] IS NULL OR cardinality($4::uuid[]) = 0 OR cl.lead_id <> ALL($4::uuid[]))
          AND (
            l.created_at >= p.win_from AND l.created_at <= p.win_to
            OR (cl.sourced_on IS NOT NULL AND cl.sourced_on >= p.win_from::date AND cl.sourced_on <= p.win_to::date)
            OR (r.started_at IS NOT NULL AND r.started_at >= p.win_from AND r.started_at <= p.win_to)
          )
     ),
     universe AS (
       SELECT lead_id, campaign_id, owner_id FROM claude_enrichment
       UNION
       SELECT lead_id, campaign_id, owner_id FROM extraction
       UNION
       SELECT lead_id, campaign_id, owner_id FROM drafting
       UNION
       SELECT lead_id, campaign_id, owner_id FROM replies
       UNION
       SELECT lead_id, campaign_id, owner_id FROM sends
       UNION
       SELECT lead_id, campaign_id, owner_id FROM apollo
       UNION
       SELECT lead_id, campaign_id, owner_id FROM attached
     )
     SELECT u.lead_id::text AS lead_id,
            u.campaign_id::text AS campaign_id,
            u.owner_id::text AS owner_id,
            s.from_email,
            s.identity_slug,
            coalesce(fc.kind, 'manual') AS campaign_kind,
            coalesce(s.emails_sent, 0)::text AS emails_sent,
            coalesce(ce.claude_enrichment_usd, 0)::text AS claude_enrichment_usd,
            coalesce(ap.apollo_usd, 0)::text AS apollo_usd,
            coalesce(ex.extraction_usd, 0)::text AS extraction_usd,
            (coalesce(d.drafting_usd, 0) + coalesce(rp.reply_usd, 0))::text AS drafting_usd,
            coalesce(rp.reply_usd, 0)::text AS reply_usd
       FROM universe u
  LEFT JOIN filtered_campaigns fc ON fc.id = u.campaign_id
  LEFT JOIN claude_enrichment ce
         ON ce.lead_id = u.lead_id AND ce.campaign_id = u.campaign_id
  LEFT JOIN extraction ex
         ON ex.lead_id = u.lead_id AND ex.campaign_id = u.campaign_id
  LEFT JOIN drafting d
         ON d.lead_id = u.lead_id AND d.campaign_id = u.campaign_id
  LEFT JOIN replies rp
         ON rp.lead_id = u.lead_id AND rp.campaign_id = u.campaign_id
  LEFT JOIN sends s
         ON s.lead_id = u.lead_id AND s.campaign_id = u.campaign_id
  LEFT JOIN apollo ap
         ON ap.lead_id = u.lead_id AND ap.campaign_id = u.campaign_id`,
    [input.from, input.to, campaignIds, excludedLeads, excludedRuns],
  );

  return rows.map((row) => {
    const emails_sent = asNumber(row.emails_sent);
    const campaign_kind = row.campaign_kind === 'auto' ? 'auto' : 'manual';
    const claude_enrichment_usd = asNumber(row.claude_enrichment_usd);
    const apollo_usd = asNumber(row.apollo_usd);
    const extraction_usd = asNumber(row.extraction_usd);
    const drafting_usd = asNumber(row.drafting_usd);
    const reply_usd = asNumber(row.reply_usd);
    const enrichment_usd = claude_enrichment_usd + apollo_usd + extraction_usd;
    const agentmail_usd = agentMailSpendUsd(emails_sent);
    return {
      lead_id: row.lead_id,
      campaign_id: row.campaign_id,
      owner_id: row.owner_id,
      from_email: row.from_email,
      identity_slug: row.identity_slug,
      emails_sent,
      campaign_kind,
      is_outreached: emails_sent > 0,
      is_auto_inflight: isAutoInflightLead(campaign_kind, emails_sent),
      claude_enrichment_usd,
      apollo_usd,
      extraction_usd,
      enrichment_usd,
      drafting_usd,
      reply_usd,
      worker_usd: 0,
      agentmail_usd,
      stack_usd: leadStackUsd({
        enrichment_usd,
        drafting_usd,
        worker_usd: 0,
        agentmail_usd,
      }),
    };
  });
}

export async function loadUnallocatedSpend(input: {
  from: string;
  to: string;
  campaignIds: string[];
}): Promise<UnallocatedSpend> {
  const campaignIds = input.campaignIds.length
    ? input.campaignIds
    : ['00000000-0000-0000-0000-000000000000'];

  const [dashboards, openings] = await Promise.all([
    dbQuery<{ cost: string }>(
      `SELECT coalesce(sum(cu.actual_cost_usd), 0)::text AS cost
         FROM dashboards.context_updates cu
        WHERE cu.generated_at >= $1::timestamptz
          AND cu.generated_at <= $2::timestamptz`,
      [input.from, input.to],
    ),
    dbQuery<{ cost: string }>(
      `SELECT coalesce(sum(opening.actual_cost_usd), 0)::text AS cost
         FROM outreach.drafting_run_cost_opening_balances opening
        WHERE opening.occurred_at >= $1::timestamptz
          AND opening.occurred_at <= $2::timestamptz
          AND opening.campaign_id = ANY($3::uuid[])`,
      [input.from, input.to, campaignIds],
    ),
  ]);

  const dashboard_usd = asNumber(dashboards.rows[0]?.cost);
  const opening_balance_usd = asNumber(openings.rows[0]?.cost);
  return {
    dashboard_usd,
    opening_balance_usd,
    total_usd: dashboard_usd + opening_balance_usd,
  };
}
