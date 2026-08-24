import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { CampaignUploads } from '@/app/campaigns/[id]/campaign-uploads';
import { CampaignTagsHeader } from '@/app/campaigns/[id]/campaign-tags-header';
import { campaignHasDraftingWorkspace, campaignHasReviewableData } from '@/lib/campaign-review';
import { getCampaign } from '@/lib/campaigns';
import { displayNameFromEmail, getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/');

  const { id } = await params;
  const campaign = await getCampaign(session.userId, id);
  if (!campaign) notFound();
  if (campaign.kind === 'auto') redirect(`/campaigns/${id}/prospect`);
  const [reviewEnabled, draftEnabled] = await Promise.all([
    campaign.needs_enrichment ? campaignHasReviewableData(id) : Promise.resolve(false),
    campaignHasDraftingWorkspace(id),
  ]);

  return (
    <main className="app-shell" key={id}>
      <section className="card">
        <div className="card__header">
          <div>
            <Link href="/hub" className="back-link"><ArrowLeft size={14} /> Outreach Hub</Link>
            <div className="card__title">{campaign.name}</div>
            <div className="card__subtitle">{campaign.lead_count} leads · {campaign.status}</div>
            <CampaignTagsHeader campaignId={campaign.id} initialTags={campaign.tags} initialTagDetails={campaign.tag_details} />
          </div>
        </div>
        <div className="card__body">
          <CampaignUploads
            key={id}
            campaignId={campaign.id}
            needsEnrichment={campaign.needs_enrichment}
            reviewEnabledInitial={reviewEnabled}
            draftEnabledInitial={draftEnabled}
            defaultDisplayName={displayNameFromEmail(session.email)}
            defaultWorkEmail={session.email}
          />
        </div>
      </section>
    </main>
  );
}
