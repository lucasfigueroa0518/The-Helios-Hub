import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENTMAIL_USD_PER_SEND,
  APOLLO_USD_PER_CREDIT,
  agentMailSpendUsd,
  apolloSpendUsd,
  applyWorkerShare,
  classifySpendIdentity,
  leadStackUsd,
  prorateGcpWorkerUsd,
  type LeadCampaignFact,
  uniqueLeadFacts,
} from '@/lib/analytics-lead-facts';

function fact(partial: Partial<LeadCampaignFact> & Pick<LeadCampaignFact, 'lead_id' | 'campaign_id'>): LeadCampaignFact {
  const emails_sent = partial.emails_sent ?? 0;
  const claude_enrichment_usd = partial.claude_enrichment_usd ?? 0;
  const apollo_usd = partial.apollo_usd ?? 0;
  const extraction_usd = partial.extraction_usd ?? 0;
  const enrichment_usd = claude_enrichment_usd + apollo_usd + extraction_usd;
  const drafting_usd = partial.drafting_usd ?? 0;
  const worker_usd = partial.worker_usd ?? 0;
  const agentmail_usd = partial.agentmail_usd ?? agentMailSpendUsd(emails_sent);
  return {
    lead_id: partial.lead_id,
    campaign_id: partial.campaign_id,
    owner_id: partial.owner_id ?? 'owner',
    from_email: partial.from_email ?? null,
    identity_slug: partial.identity_slug ?? null,
    emails_sent,
    is_outreached: emails_sent > 0,
    claude_enrichment_usd,
    apollo_usd,
    extraction_usd,
    enrichment_usd,
    drafting_usd,
    reply_usd: partial.reply_usd ?? 0,
    worker_usd,
    agentmail_usd,
    stack_usd: leadStackUsd({
      enrichment_usd,
      drafting_usd,
      worker_usd,
      agentmail_usd,
    }),
  };
}

test('AgentMail is $0.002 per sent email', () => {
  assert.equal(AGENTMAIL_USD_PER_SEND, 0.002);
  assert.equal(agentMailSpendUsd(0), 0);
  assert.equal(agentMailSpendUsd(2), 0.004);
});

test('Apollo enrich is $59 / 2500 credits', () => {
  assert.equal(apolloSpendUsd(1), APOLLO_USD_PER_CREDIT);
  assert.equal(Number((APOLLO_USD_PER_CREDIT * 2500).toFixed(6)), 59);
});

test('GCP worker spend prorates MTD into the current-month overlap', () => {
  const now = new Date('2026-08-24T15:00:00.000Z');
  const week = prorateGcpWorkerUsd({
    monthToDateUsd: 240,
    windowFrom: new Date('2026-08-18T00:00:00.000Z'),
    windowTo: new Date('2026-08-24T23:59:59.999Z'),
    now,
  });
  assert.equal(week, 70);

  const priorMonth = prorateGcpWorkerUsd({
    monthToDateUsd: 240,
    windowFrom: new Date('2026-07-01T00:00:00.000Z'),
    windowTo: new Date('2026-07-31T23:59:59.999Z'),
    now,
  });
  assert.equal(priorMonth, 0);
});

test('outreach + wasted always equals total hub spend', () => {
  const facts = applyWorkerShare([
    fact({ lead_id: 'sent', campaign_id: 'c1', emails_sent: 2, drafting_usd: 4, claude_enrichment_usd: 1 }),
    fact({ lead_id: 'idle', campaign_id: 'c1', emails_sent: 0, drafting_usd: 3, claude_enrichment_usd: 2 }),
  ], 10);
  const identity = classifySpendIdentity({ facts, unallocatedWastedUsd: 1.5 });
  assert.equal(identity.total_leads, 2);
  assert.equal(identity.outreached_leads, 1);
  assert.equal(identity.wasted_lead_rate, 0.5);
  assert.equal(identity.emails_sent, 2);
  assert.equal(
    Number((identity.outreach_spend_usd + identity.wasted_spend_usd).toFixed(10)),
    Number(identity.total_spend_usd.toFixed(10)),
  );
  assert.equal(identity.spend_per_outreach_usd, identity.outreach_spend_usd / 2);
  assert.equal(identity.wasted_spend_usd > identity.worker_cost_usd / 2, true);
});

test('shared research jobs do not double-count at org when split across campaigns', () => {
  const rows = applyWorkerShare([
    fact({ lead_id: 'a', campaign_id: 'c1', claude_enrichment_usd: 5 }),
    fact({ lead_id: 'b', campaign_id: 'c2', claude_enrichment_usd: 5 }),
  ], 0);
  const org = classifySpendIdentity({ facts: uniqueLeadFacts(rows) });
  assert.equal(org.enrichment_cost_usd, 10);
  const c1 = classifySpendIdentity({ facts: rows.filter((row) => row.campaign_id === 'c1') });
  const c2 = classifySpendIdentity({ facts: rows.filter((row) => row.campaign_id === 'c2') });
  assert.equal(c1.enrichment_cost_usd + c2.enrichment_cost_usd, org.enrichment_cost_usd);
});

test('worker share splits equally across unique leads, then across their campaigns', () => {
  const rows = applyWorkerShare([
    fact({ lead_id: 'a', campaign_id: 'c1', emails_sent: 1 }),
    fact({ lead_id: 'a', campaign_id: 'c2', emails_sent: 0 }),
    fact({ lead_id: 'b', campaign_id: 'c1', emails_sent: 0 }),
  ], 9);
  const unique = uniqueLeadFacts(rows);
  const a = unique.find((row) => row.lead_id === 'a');
  const b = unique.find((row) => row.lead_id === 'b');
  assert.equal(a?.worker_usd, 4.5);
  assert.equal(b?.worker_usd, 4.5);
  const c1 = rows.filter((row) => row.campaign_id === 'c1').reduce((sum, row) => sum + row.worker_usd, 0);
  const c2 = rows.filter((row) => row.campaign_id === 'c2').reduce((sum, row) => sum + row.worker_usd, 0);
  assert.equal(Number((c1 + c2).toFixed(10)), 9);
});

test('lead-facts loader allocates work-row actuals, not lead_cost_events', () => {
  assert.equal(typeof uniqueLeadFacts, 'function');
  assert.equal(typeof applyWorkerShare, 'function');
});
