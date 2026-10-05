import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { CampaignCapacityControl } from '@/app/campaigns/[id]/campaign-capacity';
import { CampaignTabs } from '@/app/campaigns/[id]/campaign-tabs';
import { DraftWorkspace } from '@/app/campaigns/[id]/draft/draft-workspace';
import { CampaignTitle } from '@/app/campaigns/[id]/campaign-title';
import { campaignHasDraftingWorkspace, campaignHasReviewableData } from '@/lib/campaign-review';
import { getCampaign } from '@/lib/campaigns';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/');

  const { id } = await params;
  const campaign = await getCampaign(session.userId, id);
  if (!campaign) notFound();

  const showReview = campaign.needs_enrichment;
  const [reviewEnabled, workspaceStarted] = await Promise.all([
    showReview ? campaignHasReviewableData(id) : Promise.resolve(false),
    campaignHasDraftingWorkspace(id),
  ]);

  return (
    <main className="app-shell" key={id}>
      <section className="card">
        <div className="card__header">
          <div>
            <Link href="/hub" className="back-link"><ArrowLeft size={14} /> Outreach Hub</Link>
            <CampaignTitle
              name={campaign.name}
              senderIdentitySlug={campaign.kind === 'auto' ? campaign.sender_identity_slug : null}
            />
            <div className="card__subtitle">
              {[
                campaign.delivery_settings.capacity_pct != null
                  ? `${campaign.delivery_settings.capacity_pct}% of inbox capacity${campaign.kind === 'auto' && campaign.emails_per_day ? ` · about ${campaign.emails_per_day} today` : ''}`
                  : campaign.kind === 'auto'
                    ? `${campaign.emails_per_day ?? 0} emails/day`
                    : null,
                campaign.kind === 'auto' ? null : `${campaign.lead_count} leads`,
                campaign.last_run_at ? `last run ${new Date(campaign.last_run_at).toLocaleDateString()}` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <CampaignCapacityControl
            campaignId={campaign.id}
            senderIdentitySlug={campaign.sender_identity_slug}
            initialPct={campaign.delivery_settings.capacity_pct}
            legacyDailyCount={campaign.delivery_settings.max_new_leads_per_day ?? campaign.emails_per_day}
          />
        </div>
        <div className="card__body">
          <CampaignTabs
            key={`tabs-${id}`}
            campaignId={id}
            active="draft"
            showReview={showReview}
            reviewEnabled={reviewEnabled}
            draftEnabled={showReview ? (reviewEnabled || workspaceStarted) : true}
            mode={campaign.kind === 'auto' ? 'auto' : 'manual'}
          />
          <DraftWorkspace
            key={id}
            campaignId={id}
            autoMode={campaign.kind === 'auto'}
            autoStatus={campaign.auto_status}
            emailsPerDay={campaign.emails_per_day ?? 0}
            capacityPct={campaign.delivery_settings.capacity_pct}
            nextCycleAt={campaign.next_cycle_at}
            autoError={campaign.auto_error}
            expansionStep={campaign.expansion_step}
            senderIdentitySlug={campaign.sender_identity_slug}
          />
        </div>
      </section>
    </main>
  );
}
